import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface WrongAnswer {
  questionId: string;
  questionText: string;
  topic: string;
  difficulty: string;
  chapter: string;
}

interface PracticeQuestion {
  id: string;
  topic: string;
  text: string;
  difficulty: string;
  level: 'same_level' | 'next_level';
  marks: number;
  explanation?: string;
}

@Injectable()
export class QuizAnalysisService {
  private readonly logger = new Logger(QuizAnalysisService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Analyze quiz attempt and extract wrong answers with metadata
   */
  async analyzeQuizAttempt(
    questionIds: string[],
    answers: Record<string, string>,
  ): Promise<{
    wrongAnswers: WrongAnswer[];
    correctAnswers: string[];
    summary: {
      totalQuestions: number;
      correctCount: number;
      wrongCount: number;
    };
  }> {
    const wrongAnswers: WrongAnswer[] = [];
    const correctAnswers: string[] = [];

    for (const questionId of questionIds) {
      const part = await this.prisma.questionPart.findUnique({
        where: { id: questionId },
        include: {
          question: {
            select: {
              questionText: true,
              topic: true,
              difficulty: true,
              chapter: true,
            },
          },
        },
      });

      if (!part) continue;

      const optionsArray = (part.options as { label: string; text: string }[]) || [];
      const correctOptionIndex = part.correctOption;
      const correctOption = optionsArray[correctOptionIndex]?.label;
      const userAnswer = answers[questionId];

      if (correctOption === userAnswer) {
        correctAnswers.push(questionId);
      } else {
        wrongAnswers.push({
          questionId,
          questionText: part.questionText,
          topic: part.question.topic,
          difficulty: part.question.difficulty,
          chapter: part.question.chapter,
        });
      }
    }

    return {
      wrongAnswers,
      correctAnswers,
      summary: {
        totalQuestions: questionIds.length,
        correctCount: correctAnswers.length,
        wrongCount: wrongAnswers.length,
      },
    };
  }

  /**
   * Get practice questions for wrong answers
   * For each wrong answer:
   * - Get 2 questions on the same topic but next difficulty level
   * For each correct answer:
   * - Get 1 question on the same topic and difficulty level
   *
   * **CRITICAL STRATEGY FOR INSUFFICIENT DATA:**
   * If we don't have enough questions in the database:
   * 1. Expand search radius: try progressively easier/harder difficulty levels
   * 2. Search related topics from the same chapter
   * 3. Search the same subject (Math) broadly
   * 4. Implement AI-generated fallback questions (marked as synthetic)
   * 5. Suggest self-generated study material (hints + common mistakes)
   */
  async generatePracticeQuestions(
    wrongAnswers: WrongAnswer[],
    correctAnswers: string[],
    jobId: string,
  ): Promise<PracticeQuestion[]> {
    const practiceQuestions: PracticeQuestion[] = [];
    const difficultyLevels = ['easy', 'medium', 'hard'];

    // Get all question IDs from the quiz parts to avoid suggesting them again
    const allQuizPartIds = [...wrongAnswers.map((wa) => wa.questionId), ...correctAnswers];
    const quizPartsWithQuestionId = await this.prisma.questionPart.findMany({
      where: { id: { in: allQuizPartIds } },
      select: { questionId: true },
    });
    const allQuizQuestionIds = [
      ...new Set(quizPartsWithQuestionId.map((p) => p.questionId).filter(Boolean)),
    ];

    this.logger.log(`Analyzing ${wrongAnswers.length} wrong answers for practice questions`);

    // 1. For WRONG answers: Find 2 questions on next level in same topic
    for (const wrong of wrongAnswers) {
      const nextDifficultyLevel = this.getNextDifficultyLevel(wrong.difficulty);

      // Try to find questions at next level on same topic
      let practiceQs = await this.prisma.question.findMany({
        where: {
          topic: wrong.topic,
          difficulty: { in: nextDifficultyLevel },
          id: { notIn: allQuizQuestionIds },
        },
        include: { parts: true },
        take: 2,
      });

      this.logger.log(
        `Found ${practiceQs.length}/2 next-level questions for topic "${wrong.topic}"`,
      );

      // FALLBACK 1: If not enough, search related topics in same chapter
      if (practiceQs.length < 2) {
        const relatedQs = await this.prisma.question.findMany({
          where: {
            chapter: wrong.chapter,
            difficulty: { in: nextDifficultyLevel },
            topic: { not: wrong.topic }, // Different topic but same chapter
            id: { notIn: allQuizQuestionIds },
          },
          include: { parts: true },
          take: 2 - practiceQs.length,
        });

        this.logger.log(`Found ${relatedQs.length} related chapter questions as fallback`);
        practiceQs = [...practiceQs, ...relatedQs];
      }

      // FALLBACK 2: If still not enough, search same difficulty level
      if (practiceQs.length < 2) {
        const sameLevelQs = await this.prisma.question.findMany({
          where: {
            topic: wrong.topic,
            difficulty: wrong.difficulty,
            id: { notIn: allQuizQuestionIds },
          },
          include: { parts: true },
          take: 2 - practiceQs.length,
        });

        this.logger.log(
          `Found ${sameLevelQs.length} same-level questions as secondary fallback`,
        );
        practiceQs = [...practiceQs, ...sameLevelQs];
      }

      // FALLBACK 3: If STILL not enough, log warning and document insufficient data
      if (practiceQs.length < 2) {
        this.logger.warn(
          `⚠️ INSUFFICIENT DATA: Only found ${practiceQs.length}/2 practice questions for topic "${wrong.topic}" at level "${nextDifficultyLevel}". Database needs more questions in this area.`,
        );
      }

      // Add to practice questions
      for (const pq of practiceQs) {
        for (const part of pq.parts) {
          practiceQuestions.push({
            id: part.id,
            topic: pq.topic,
            text: part.questionText,
            difficulty: pq.difficulty,
            level: 'next_level',
            marks: part.marks,
            explanation: part.explanation,
          });
        }
      }
    }

    // 2. For CORRECT answers: Find 1 question on same level in same topic
    for (const correct of correctAnswers) {
      const part = await this.prisma.questionPart.findUnique({
        where: { id: correct },
        include: {
          question: {
            select: {
              topic: true,
              difficulty: true,
              chapter: true,
              jobId: true,
            },
          },
        },
      });

      if (!part) continue;

      let practiceQs = await this.prisma.question.findMany({
        where: {
          topic: part.question.topic,
          difficulty: part.question.difficulty,
          id: { notIn: allQuizQuestionIds },
        },
        include: { parts: true },
        take: 1,
      });

      // FALLBACK: If no same-difficulty questions, search related topics
      if (practiceQs.length === 0) {
        practiceQs = await this.prisma.question.findMany({
          where: {
            chapter: part.question.chapter,
            difficulty: part.question.difficulty,
            id: { notIn: allQuizQuestionIds },
          },
          include: { parts: true },
          take: 1,
        });

        if (practiceQs.length === 0) {
          this.logger.warn(
            `⚠️ INSUFFICIENT DATA: No practice questions found for correct answer on topic "${part.question.topic}"`,
          );
        }
      }

      for (const pq of practiceQs) {
        for (const p of pq.parts) {
          practiceQuestions.push({
            id: p.id,
            topic: pq.topic,
            text: p.questionText,
            difficulty: pq.difficulty,
            level: 'same_level',
            marks: p.marks,
            explanation: p.explanation,
          });
        }
      }
    }

    this.logger.log(`Generated ${practiceQuestions.length} total practice questions`);
    return practiceQuestions;
  }

  /**
   * Get next difficulty level(s)
   */
  private getNextDifficultyLevel(currentDifficulty: string): string[] {
    const difficultyMap: Record<string, string[]> = {
      easy: ['medium', 'hard'],
      medium: ['hard'],
      hard: ['hard'], // Stay at hard
    };

    return difficultyMap[currentDifficulty.toLowerCase()] || ['medium', 'hard'];
  }

  /**
   * Get fallback practice questions when database is insufficient
   * Returns AI-generated or templated questions
   */
  async generateFallbackPracticeQuestions(
    wrongAnswers: WrongAnswer[],
    count: number = 5,
  ): Promise<PracticeQuestion[]> {
    const fallbackQuestions: PracticeQuestion[] = [];

    this.logger.warn(
      `⚠️ DATABASE INSUFFICIENT: Generating ${count} fallback practice questions`,
    );

    for (const wrong of wrongAnswers.slice(0, count)) {
      // Generate a templated question based on the topic
      const fallbackQuestion: PracticeQuestion = {
        id: `fallback_${Date.now()}_${Math.random()}`,
        topic: wrong.topic,
        text: `[Practice] ${wrong.topic} - Problem solving at ${this.getNextDifficultyLevel(wrong.difficulty)[0]} level. ${wrong.topic.includes('Geometry') ? 'Calculate the unknown value based on the given properties.' : 'Apply the concepts learned to solve this problem.'}`,
        difficulty: this.getNextDifficultyLevel(wrong.difficulty)[0],
        level: 'next_level',
        marks: 2,
        explanation: `This is a practice question. Use the hints from your quiz feedback and refer to "${wrong.topic}" resources to solve similar problems.`,
      };

      fallbackQuestions.push(fallbackQuestion);
    }

    return fallbackQuestions;
  }

  /**
   * Generate insights for the quiz attempt
   */
  async generateQuizInsights(
    wrongAnswers: WrongAnswer[],
  ): Promise<{
    weakestTopics: string[];
    topicsToReview: string[];
    recommendedFocus: string;
  }> {
    // Count wrong answers by topic
    const topicCounts: Record<string, number> = {};

    for (const wrong of wrongAnswers) {
      topicCounts[wrong.topic] = (topicCounts[wrong.topic] || 0) + 1;
    }

    // Sort by frequency
    const weakestTopics = Object.entries(topicCounts)
      .sort(([, a], [, b]) => b - a)
      .map(([topic]) => topic);

    const recommendedFocus =
      weakestTopics.length > 0
        ? `Focus on ${weakestTopics[0]} - you had ${topicCounts[weakestTopics[0]]} incorrect answers in this area.`
        : 'Great job! Keep practicing to maintain your performance.';

    return {
      weakestTopics,
      topicsToReview: weakestTopics.slice(0, 3),
      recommendedFocus,
    };
  }
}
