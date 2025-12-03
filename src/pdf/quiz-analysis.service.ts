import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) { }

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
      // Handle case where correctOption might be 0 (falsy) but valid
      const correctOptionObj = correctOptionIndex !== null && correctOptionIndex !== undefined
        ? optionsArray[correctOptionIndex]
        : null;

      const correctOptionLabel = correctOptionObj?.label;
      const userAnswer = answers[questionId];

      // Normalize for comparison
      const normalizedCorrect = correctOptionLabel?.trim().toLowerCase();
      const normalizedUser = userAnswer?.trim().toLowerCase();

      this.logger.debug(
        `Q: ${questionId} | User: "${userAnswer}" (${normalizedUser}) | Correct: "${correctOptionLabel}" (${normalizedCorrect}) | Index: ${correctOptionIndex}`
      );

      if (normalizedCorrect && normalizedUser && normalizedCorrect === normalizedUser) {
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

    // Get all question IDs from the quiz parts to avoid suggesting them again
    const allQuizPartIds = [...wrongAnswers.map((wa) => wa.questionId), ...correctAnswers];
    const quizPartsWithQuestionId = await this.prisma.questionPart.findMany({
      where: { id: { in: allQuizPartIds } },
      select: { questionId: true },
    });
    const allQuizQuestionIds = [
      ...new Set(quizPartsWithQuestionId.map((p) => p.questionId).filter(Boolean)),
    ];

    this.logger.log(`Analyzing ${wrongAnswers.length} wrong answers and ${correctAnswers.length} correct answers`);

    // 1. For WRONG answers: Find 2 questions on same topic (ANY difficulty, NO images)
    for (const wrong of wrongAnswers) {
      let questionsFound = 0;
      const targetCount = 2;

      // Try to find questions on same topic, ANY difficulty, NO diagrams
      // We need to check for diagrams, so we include them in the query
      let practiceQs = await this.prisma.question.findMany({
        where: {
          topic: wrong.topic,
          id: { notIn: allQuizQuestionIds },
        },
        include: {
          parts: true,
          diagrams: true
        },
        // Take more than needed to filter in memory
        take: 20,
      });

      // Filter out questions with diagrams
      const validPracticeQs = practiceQs.filter(q => q.diagrams.length === 0);

      if (validPracticeQs.length > 0) {
        this.logger.log(`Found ${validPracticeQs.length} valid practice questions (no images) in DB for ${wrong.topic}`);
      } else {
        this.logger.log(`No valid practice questions (no images) found in DB for ${wrong.topic}`);
      }

      for (const pq of validPracticeQs) {
        // Skip if we already have enough for this wrong answer
        if (questionsFound >= targetCount) break;

        // Check if we already used this question in this practice set
        if (practiceQuestions.some(p => p.id === pq.parts[0]?.id)) continue;

        for (const part of pq.parts) {
          if (questionsFound < targetCount) {
            practiceQuestions.push({
              id: part.id,
              topic: pq.topic,
              text: part.questionText,
              difficulty: pq.difficulty,
              level: 'next_level', // Just label it next level for now
              marks: part.marks,
              explanation: part.explanation,
            });
            questionsFound++;
            // Mark as used for this run
            allQuizQuestionIds.push(pq.id);
          }
        }
      }

      // If not enough questions, use Gemini Fallback
      if (questionsFound < targetCount) {
        const needed = targetCount - questionsFound;
        this.logger.log(`Generating ${needed} AI fallback questions for wrong answer in ${wrong.topic}`);

        // Create a temporary array of wrong answers just for this topic to pass to fallback
        const topicWrongAnswers = Array(needed).fill(wrong);
        const aiQuestions = await this.generateFallbackPracticeQuestions(topicWrongAnswers, needed);

        practiceQuestions.push(...aiQuestions);
      }
    }

    // 2. For CORRECT answers: Find 1 question on same topic (ANY difficulty, NO images)
    for (const correctId of correctAnswers) {
      const part = await this.prisma.questionPart.findUnique({
        where: { id: correctId },
        include: { question: true },
      });

      if (!part) continue;

      let questionsFound = 0;
      const targetCount = 1;

      let practiceQs = await this.prisma.question.findMany({
        where: {
          topic: part.question.topic,
          id: { notIn: allQuizQuestionIds },
        },
        include: {
          parts: true,
          diagrams: true
        },
        take: 10,
      });

      // Filter out questions with diagrams
      const validPracticeQs = practiceQs.filter(q => q.diagrams.length === 0);

      for (const pq of validPracticeQs) {
        if (questionsFound >= targetCount) break;
        if (practiceQuestions.some(p => p.id === pq.parts[0]?.id)) continue;

        for (const p of pq.parts) {
          if (questionsFound < targetCount) {
            practiceQuestions.push({
              id: p.id,
              topic: pq.topic,
              text: p.questionText,
              difficulty: pq.difficulty,
              level: 'same_level',
              marks: p.marks,
              explanation: p.explanation,
            });
            questionsFound++;
            allQuizQuestionIds.push(pq.id);
          }
        }
      }

      // If not enough, use Gemini Fallback
      if (questionsFound < targetCount) {
        const needed = targetCount - questionsFound;
        const mockWrongAnswer: WrongAnswer = {
          questionId: part.id,
          questionText: part.questionText,
          topic: part.question.topic,
          difficulty: part.question.difficulty,
          chapter: part.question.chapter
        };

        const aiQuestions = await this.generateFallbackPracticeQuestions([mockWrongAnswer], needed);
        aiQuestions.forEach(q => q.level = 'same_level');

        practiceQuestions.push(...aiQuestions);
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
   * Uses Gemini AI to generate contextual practice questions
   */
  async generateFallbackPracticeQuestions(
    wrongAnswers: WrongAnswer[],
    count: number = 5,
    forceDifficulty?: string,
  ): Promise<PracticeQuestion[]> {
    const fallbackQuestions: PracticeQuestion[] = [];

    this.logger.warn(
      `⚠️ DATABASE INSUFFICIENT: Generating ${count} AI practice questions using Gemini`,
    );

    try {
      // Dynamic import of Gemini
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const apiKey = this.configService.get<string>('GEMINI_API_KEY');

      if (!apiKey) {
        this.logger.error('GEMINI_API_KEY is missing in configuration');
        // Debug: Print available keys (masked)
        const keys = Object.keys(process.env);
        this.logger.debug(`Available env keys: ${keys.join(', ')}`);
        return this.generateTemplateFallback(wrongAnswers, count);
      }

      this.logger.debug(`Using Gemini API Key: ${apiKey.substring(0, 4)}...`);

      const genAI = new GoogleGenerativeAI(apiKey);
      // Try using the specific version or latest alias
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

      for (const wrong of wrongAnswers.slice(0, count)) {
        // Determine target difficulty
        const targetDifficulty = forceDifficulty || this.getNextDifficultyLevel(wrong.difficulty)[0];

        const prompt = `Generate a math practice question for Singapore Secondary school level.

Topic: ${wrong.topic}
Chapter: ${wrong.chapter}
Difficulty: ${targetDifficulty}
Context: Student was working on "${wrong.questionText}"

Create ONE similar but different practice question that:
1. Tests the same concept
2. Is at ${targetDifficulty} difficulty level
3. Is clear and specific with actual numbers/values
4. Can be solved in 2-3 steps
5. Is suitable for Singapore Secondary students

Return ONLY the question text, no explanation or answer. Make it concise and practical.`;

        try {
          this.logger.debug(`Sending prompt to Gemini for ${wrong.topic}...`);
          const result = await model.generateContent(prompt);
          const response = await result.response;
          const questionText = response.text().trim();

          if (!questionText) {
            throw new Error('Empty response from Gemini');
          }

          fallbackQuestions.push({
            id: `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            topic: wrong.topic,
            text: questionText,
            difficulty: targetDifficulty,
            level: forceDifficulty ? 'same_level' : 'next_level',
            marks: 1,
            explanation: `AI-generated practice question for ${wrong.topic} (${targetDifficulty})`,
          });

          this.logger.log(`✅ Generated AI question for topic: ${wrong.topic}`);

          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 7000));
        } catch (error) {
          this.logger.error(`Failed to generate AI question for ${wrong.topic}: ${error.message}`);
          // Fallback to template
          fallbackQuestions.push(this.createTemplateQuestion(wrong, targetDifficulty));
        }
      }
    } catch (error) {
      this.logger.error(`Gemini integration error: ${error.message}`);
      return this.generateTemplateFallback(wrongAnswers, count);
    }

    return fallbackQuestions;
  }

  /**
   * Create a template question (used as last resort)
   */
  private createTemplateQuestion(wrong: WrongAnswer, difficulty: string): PracticeQuestion {
    return {
      id: `template_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      topic: wrong.topic,
      text: `Practice ${wrong.topic} at ${difficulty} level - solve problems similar to the ones you found challenging.`,
      difficulty,
      level: 'next_level',
      marks: 1,
      explanation: `Practice question for ${wrong.topic}`,
    };
  }

  /**
   * Generate template fallback questions (when Gemini is unavailable)
   */
  private generateTemplateFallback(
    wrongAnswers: WrongAnswer[],
    count: number,
  ): PracticeQuestion[] {
    return wrongAnswers.slice(0, count).map(wrong => {
      const difficulty = this.getNextDifficultyLevel(wrong.difficulty)[0];
      return this.createTemplateQuestion(wrong, difficulty);
    });
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
