import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { PythonExecutorService } from './python-executor.service';
import { EmailService } from '../email/email.service';
import { PdfGeneratorService } from './pdf-generator.service';
import { QuizAnalysisService } from './quiz-analysis.service';
import { AnswerLinkingService } from './answer-linking.service';
import { GeminiAnswerService } from './gemini-answer.service';

import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';

interface EnrichedQuestionData {
  document_info: {
    filename: string;
    total_pages: number;
    api_calls_used: number;
    total_questions: number;
    processing_complete: boolean;
  };
  enriched_questions: EnrichedQuestion[];
}

interface EnrichedQuestion {
  page_number: number;
  question_num: string;
  question_text: string;
  parts: QuestionPart[];
  diagrams: DiagramData[];
  topic: string;
  chapter: string;
  subject?: string;
  school_level: string;
  question_level?: string;
  difficulty: string;
  question_type: string;
  time_estimate_minutes?: number;
  learning_outcomes: string[];
  keywords: string[];
  prerequisite_topics: string[];
  common_mistakes: string[];
  marks: number;
  status?: string;
  is_verified?: boolean;
}

interface QuestionPart {
  part: string;
  question_text: string;
  marks: number;
  options: any[];
  correct_option: number | null;
  sample_answer: string;
  explanation: string;
  hints: string[];
}

interface DiagramData {
  local_path: string;
  filename: string;
  page_number: number;
  file_size: number;
  source?: string;
  confidence?: number;
  area?: number;
  density?: number;
  is_page_snapshot?: boolean;
}

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);
  private readonly outputDir: string;
  private readonly minConfidenceThreshold: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly pythonExecutor: PythonExecutorService,
    private readonly minioService: MinioService,
    private readonly emailService: EmailService,
    private readonly pdfGenerator: PdfGeneratorService,
    private readonly quizAnalysis: QuizAnalysisService,
    private readonly answerLinkingService: AnswerLinkingService,
    private readonly geminiAnswerService: GeminiAnswerService,
  ) {
    this.outputDir = this.configService.get('OUTPUT_DIR') || './output';
    this.minConfidenceThreshold = parseFloat(
      this.configService.get('MIN_DIAGRAM_CONFIDENCE') || '90',
    );

    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Main entry point: Upload and process PDF
   */

  async processPdf(
    file: Express.Multer.File,
    batchSize?: number,
  ): Promise<any> {
    // Generate SHA-256 hash of the PDF file
    const pdfHash = await this.generatePdfHash(file.path);

    // Check for duplicate by hash
    const existingJob = await this.prisma.processingJob.findFirst({
      where: { pdfHash },
    });
    if (existingJob) {
      this.logger.warn(`Duplicate PDF detected. Skipping processing. JobId: ${existingJob.jobId}`);
      // return {
      //   jobId: existingJob.jobId,
      //   filename: existingJob.filename,
      //   status: existingJob.status,
      //   message: 'PDF already processed. Returning existing job.',
      // };
    }

    const jobId = uuidv4();
    const batchSizeValue =
      batchSize || this.configService.get('BATCH_SIZE') || 5;

    this.logger.log(`Creating job ${jobId} for file: ${file.originalname}`);

    // Create job record with hash
    const job = await this.prisma.processingJob.create({
      data: {
        jobId,
        filename: file.originalname,
        originalPath: file.path,
        status: 'processing',
        batchSize: batchSizeValue,
        pdfHash,
      },
    });

    // Process in background
    this.processInBackground(jobId, file.path, batchSizeValue).catch(
      (error) => {
        this.logger.error(`Job ${jobId} failed: ${error.message}`);
      },
    );

    return {
      jobId,
      filename: file.originalname,
      status: 'processing',
      message: 'PDF uploaded successfully. Processing started.',
    };
  }

  /**
   * Generate SHA-256 hash for a PDF file
   */
  private async generatePdfHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  /**
   * Background processing: Execute Python script and store results
   */
  private async processInBackground(
    jobId: string,
    pdfPath: string,
    batchSize: number,
  ): Promise<void> {
    try {
      this.logger.log(`Starting background processing for job ${jobId}`);

      // Execute Python enriched batch processor
      const pythonScriptPath = this.configService.get('PYTHON_SCRIPT_PATH');
      const pythonScriptDir = path.dirname(pythonScriptPath);

      this.logger.log(`Python script directory: ${pythonScriptDir}`);

      const result = await this.pythonExecutor.executeBatchProcessor(
        pdfPath,
        batchSize,
      );

      this.logger.log(`Python script completed for job ${jobId}`);

      // Load enriched_questions.json
      const enrichedJsonPath = path.join(
        pythonScriptDir,
        'output/enriched/enriched_questions.json',
      );

      this.logger.log(`Checking for enriched_questions.json at: ${enrichedJsonPath}`);

      // Wait a bit for file system to sync
      await new Promise(resolve => setTimeout(resolve, 1000));

      if (!fs.existsSync(enrichedJsonPath)) {
        this.logger.error(`Enriched questions JSON not found at: ${enrichedJsonPath}`);
        // List files in the directory to debug
        const outputDir = path.join(pythonScriptDir, 'output');
        if (fs.existsSync(outputDir)) {
          const files = fs.readdirSync(outputDir);
          this.logger.log(`Files in output directory: ${files.join(', ')}`);
          const enrichedDir = path.join(outputDir, 'enriched');
          if (fs.existsSync(enrichedDir)) {
            const enrichedFiles = fs.readdirSync(enrichedDir);
            this.logger.log(`Files in enriched directory: ${enrichedFiles.join(', ')}`);
          }
        }
        throw new Error('Enriched questions JSON not found');
      }

      const enrichedData: EnrichedQuestionData = JSON.parse(
        fs.readFileSync(enrichedJsonPath, 'utf-8'),
      );

      // Process and store questions
      await this.storeEnrichedQuestions(jobId, enrichedData, pythonScriptDir);

      // Copy enriched_questions.json to bbc-main public directory for frontend
      const bbcMainPublicDir = path.join(__dirname, '../../bbc-main/public');
      const bbcMainJsonPath = path.join(bbcMainPublicDir, 'enriched_questions.json');

      try {
        // Ensure bbc-main public directory exists
        if (!fs.existsSync(bbcMainPublicDir)) {
          fs.mkdirSync(bbcMainPublicDir, { recursive: true });
        }

        // Copy the enriched questions JSON to bbc-main
        fs.copyFileSync(enrichedJsonPath, bbcMainJsonPath);
        this.logger.log(`✅ Copied enriched_questions.json to bbc-main public directory: ${bbcMainJsonPath}`);

        // Also copy any diagram images to bbc-main public/diagrams
        const sourceDiagramsDir = path.join(pythonScriptDir, 'output');
        const targetDiagramsDir = path.join(bbcMainPublicDir, 'diagrams');

        if (fs.existsSync(sourceDiagramsDir)) {
          if (!fs.existsSync(targetDiagramsDir)) {
            fs.mkdirSync(targetDiagramsDir, { recursive: true });
          }

          // Copy diagram files
          const diagramFiles = fs.readdirSync(sourceDiagramsDir)
            .filter(file => file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.jpeg'));

          for (const diagramFile of diagramFiles) {
            const sourcePath = path.join(sourceDiagramsDir, diagramFile);
            const targetPath = path.join(targetDiagramsDir, diagramFile);
            fs.copyFileSync(sourcePath, targetPath);
            this.logger.log(`✅ Copied diagram: ${diagramFile} to bbc-main`);
          }
        }
      } catch (error) {
        this.logger.warn(`⚠️  Failed to copy files to bbc-main: ${error.message}`);
        // Don't fail the entire process if copying to bbc-main fails
      }

      // Update job status
      await this.prisma.processingJob.update({
        where: { jobId },
        data: {
          status: 'completed',
          totalPages: enrichedData.document_info.total_pages,
          apiCallsUsed: enrichedData.document_info.api_calls_used,
          totalQuestions: enrichedData.document_info.total_questions,
          resultData: enrichedData as any,
        },
      });

      this.logger.log(`Job ${jobId} completed successfully`);
    } catch (error) {
      this.logger.error(`Job ${jobId} failed: ${error.message}`);

      await this.prisma.processingJob.update({
        where: { jobId },
        data: {
          status: 'failed',
          errorMessage: error.message,
        },
      });

      throw error;
    }
  }

  /**
   * Store enriched questions in database with diagram upload to MinIO
   */
  private async storeEnrichedQuestions(
    jobId: string,
    data: EnrichedQuestionData,
    pythonScriptDir: string,
  ): Promise<void> {
    let qIndex = 0;
    for (const enrichedQ of data.enriched_questions) {
      qIndex++;
      const safeQuestionNum = enrichedQ.question_num || `Unknown-${qIndex}`;

      // TEMPORARILY DISABLE DUPLICATE CHECK FOR TESTING IMPROVED DIAGRAM DETECTION
      // Check for duplicates based on question content
      // const existingQuestion = await this.prisma.question.findFirst({
      //   where: {
      //     OR: [
      //       // Check by question text and page number
      //       {
      //         questionText: enrichedQ.question_text || 'Question text not available',
      //         pageNumber: enrichedQ.page_number,
      //       },
      //       // Check by question number and topic (for cross-document duplicates)
      //       {
      //         questionNum: safeQuestionNum,
      //         topic: enrichedQ.topic,
      //         subject: enrichedQ.subject || 'Mathematics',
      //       },
      //     ],
      //   },
      // });

      // if (existingQuestion) {
      //   this.logger.warn(
      //     `Skipping duplicate question ${safeQuestionNum} (matches existing question ${existingQuestion.questionNum} from job ${existingQuestion.jobId})`,
      //   );
      //   continue;
      // }

      // Filter diagrams to only those with confidence scores
      const filteredDiagrams = this.filterDiagramsByConfidence(
        enrichedQ.diagrams,
      );

      this.logger.log(
        `Question ${safeQuestionNum}: ${filteredDiagrams.length}/${enrichedQ.diagrams.length} diagrams passed confidence filter`,
      );

      // Upload diagrams to MinIO
      const uploadedDiagrams: any[] = [];
      for (const diag of filteredDiagrams) {
        const localPath = path.join(pythonScriptDir, diag.local_path);

        if (fs.existsSync(localPath)) {
          try {
            const uploadResult = await this.minioService.uploadDiagram(
              jobId,
              localPath,
              diag.page_number,
              0, // Index not needed, use filename
            );

            uploadedDiagrams.push({
              pageNumber: diag.page_number,
              minioUrl: uploadResult.url,
              minioKey: uploadResult.key,
              fileName: diag.filename,
              contentType: uploadResult.contentType,
              fileSize: diag.file_size,
              source: diag.source || 'unknown',
              confidence: diag.confidence || null,
              area: diag.area || null,
              density: diag.density || null,
              bbox: null, // Add if available in future
            });

            this.logger.log(
              `✅ Uploaded diagram: ${diag.filename} → ${uploadResult.url}`,
            );
          } catch (error) {
            this.logger.error(
              `Failed to upload diagram ${diag.filename}: ${error.message}`,
            );
          }
        } else {
          this.logger.warn(`Diagram file not found: ${localPath}`);
        }
      }

      // Create main question record
      const question = await this.prisma.question.create({
        data: {
          job: {
            connect: { jobId },
          },
          questionNum: safeQuestionNum,
          pageNumber: enrichedQ.page_number,
          questionText: enrichedQ.question_text || 'Question text not available', // Handle null case
          topic: enrichedQ.topic,
          chapter: enrichedQ.chapter || 'General', // Provide default value for null chapter
          subject: enrichedQ.subject || 'Mathematics',
          schoolLevel: enrichedQ.school_level,
          questionLevel: enrichedQ.question_level, // Save question level
          difficulty: enrichedQ.difficulty,
          questionType: enrichedQ.question_type || 'open_ended', // Provide default value for null questionType
          timeEstimateMinutes: enrichedQ.time_estimate_minutes,
          learningOutcomes: enrichedQ.learning_outcomes,
          keywords: enrichedQ.keywords,
          prerequisiteTopics: enrichedQ.prerequisite_topics,
          commonMistakes: enrichedQ.common_mistakes,
          totalMarks: enrichedQ.marks,
          status: enrichedQ.status || 'draft',
          isVerified: enrichedQ.is_verified || false,
        },
      });

      // Create question parts (sub-questions)
      // Calculate marks based on difficulty if not provided
      const difficultyMarks = {
        'easy': 1,
        'medium': 2,
        'hard': 3,
      };
      const defaultMarks = difficultyMarks[enrichedQ.difficulty.toLowerCase()] || 2;

      // Skip questions with no parts or no text content
      if (!enrichedQ.parts || enrichedQ.parts.length === 0) {
        this.logger.warn(
          `⚠️  Skipping question ${enrichedQ.question_num} - no parts found`,
        );
        // Delete the question since it has no content
        await this.prisma.question.delete({
          where: { id: question.id },
        });
        continue; // Skip to next question
      }

      for (const part of enrichedQ.parts) {
        // All questions worth 1 mark
        const partMarks = 1;

        await this.prisma.questionPart.create({
          data: {
            question: {
              connect: { id: question.id },
            },
            partLabel: part.part || '', // Handle null case
            questionText: part.question_text,
            marks: partMarks,
            sampleAnswer: part.sample_answer,
            explanation: part.explanation,
            hints: part.hints,
            options: part.options && part.options.length > 0 ? part.options : null,
            correctOption: typeof part.correct_option === 'string' && part.options ? part.options.findIndex(opt => opt.label === part.correct_option) : part.correct_option,
            stepByStepAnswer: (part as any).step_by_step_answer || null,
            answerSource: (part as any).step_by_step_answer ? 'ai_generated' : null,
          },
        });
      }

      // Create diagram records linked to question
      for (const diag of uploadedDiagrams) {
        await this.prisma.diagram.create({
          data: {
            question: {
              connect: { id: question.id },
            },
            pageNumber: diag.pageNumber,
            minioUrl: diag.minioUrl,
            minioKey: diag.minioKey,
            fileName: diag.fileName,
            contentType: diag.contentType,
            fileSize: diag.fileSize,
            source: diag.source,
            confidence: diag.confidence,
            area: diag.area,
            density: diag.density,
            bbox: diag.bbox,
          },
        });
      }

      this.logger.log(
        `✅ Stored question ${enrichedQ.question_num} with ${enrichedQ.parts.length} parts and ${uploadedDiagrams.length} diagrams`,
      );
    }
  }

  /**
   * Generate a hash for question deduplication
   */
  private generateQuestionHash(question: any): string {
    const crypto = require('crypto');
    const content = `${question.question_text || ''}${question.question_num}${question.page_number}`;
    return crypto.createHash('md5').update(content).digest('hex');
  }

  /**
   * Filter diagrams by confidence threshold
   * Include fallback diagrams and AI-detected diagrams with reasonable confidence
   */
  private filterDiagramsByConfidence(diagrams: DiagramData[]): DiagramData[] {
    return diagrams.filter((diag) => {
      // Always include fallback diagrams (page snapshots)
      if (diag.is_page_snapshot) {
        this.logger.debug(
          `Including fallback diagram ${diag.filename} (page snapshot)`,
        );
        return true;
      }

      // Include AI-detected diagrams with confidence >= 70% (more lenient than 90%)
      if (
        diag.confidence !== null &&
        diag.confidence !== undefined &&
        diag.confidence >= 70
      ) {
        this.logger.debug(
          `Including AI diagram ${diag.filename} (confidence ${diag.confidence}%)`,
        );
        return true;
      }

      // Include diagrams without confidence scores (legacy support)
      if (diag.confidence === null || diag.confidence === undefined) {
        this.logger.debug(
          `Including diagram ${diag.filename} (no confidence score)`,
        );
        return true;
      }

      this.logger.debug(
        `Excluding diagram ${diag.filename} (confidence ${diag.confidence}% < 70%)`,
      );
      return false;
    });
  }

  /**
   * Toggle question exclusion status
   */
  async toggleQuestionExclusion(partId: string, exclude: boolean): Promise<any> {
    return this.prisma.questionPart.update({
      where: { id: partId },
      data: { isExcluded: exclude },
    });
  }

  /**
   * Get all questions for a job (transformed for frontend)
   * This replaces frontend's transformQuestions() function
   */
  async getQuizQuestions(
    jobId: string,
    minConfidence?: number,
    includeExcluded: boolean = false,
  ): Promise<any> {
    const job = await this.prisma.processingJob.findUnique({
      where: { jobId },
    });

    if (!job || job.status !== 'completed') {
      return null;
    }

    // Get all questions with parts and diagrams
    const questions = await this.prisma.question.findMany({
      where: { jobId },
      include: {
        parts: {
          orderBy: { partLabel: 'asc' },
        },
        diagrams: true,
      },
      orderBy: { pageNumber: 'asc' },
    });

    // Transform to frontend format
    const transformedQuestions = [];
    let questionNumber = 1;

    for (const q of questions) {
      // Filter diagrams by confidence if specified
      let filteredDiagrams = q.diagrams;
      if (minConfidence !== undefined) {
        filteredDiagrams = q.diagrams.filter(
          (d) => d.confidence === null || d.confidence === undefined || d.confidence >= minConfidence,
        );
      }

      // Each part becomes a separate quiz question
      for (const part of q.parts) {
        // Skip excluded questions unless explicitly included
        if (!includeExcluded && part.isExcluded) {
          continue;
        }

        transformedQuestions.push({
          id: part.id,
          number: questionNumber++,
          originalQuestionNum: q.questionNum,
          text: part.questionText,
          context: q.questionText && q.questionText !== part.questionText && q.questionText !== 'Question text not available' ? q.questionText : undefined,
          marks: part.marks, // Marks per part (1 for easy, 2 for medium, 3 for hard)
          sampleAnswer: part.sampleAnswer,
          explanation: part.explanation,
          hints: part.hints,
          options: part.options || [],
          correctOption: part.correctOption,
          hasImage: filteredDiagrams.length > 0,
          isExcluded: part.isExcluded,
          diagrams: filteredDiagrams.map((d) => ({
            id: d.id,
            url: d.minioUrl,
            fileName: d.fileName,
            confidence: d.confidence,
            source: d.source,
          })),
          // Step-by-step answer (if available)
          stepByStepAnswer: part.stepByStepAnswer,
          answerSource: part.answerSource,
          // Metadata
          pageNumber: q.pageNumber,
          chapter: q.chapter,
          topic: q.topic,
          schoolLevel: q.schoolLevel,
          questionLevel: q.questionLevel,
          difficulty: q.difficulty, // easy = 1 mark, medium = 2 marks, hard = 3 marks
          questionType: q.questionType,
          learningOutcomes: q.learningOutcomes,
          commonMistakes: q.commonMistakes,
        });
      }
    }

    return {
      jobId: job.jobId,
      filename: job.filename,
      totalQuestions: transformedQuestions.length,
      questions: transformedQuestions,
    };
  }

  /**
   * Get random quiz questions (5 by default)
   */
  async getRandomQuizQuestions(
    jobId: string,
    count: number = 5,
    minConfidence?: number,
    difficulty?: string,
    topic?: string,
    userEmail?: string,
  ): Promise<any> {
    // Never include excluded questions in random quiz
    const result = await this.getQuizQuestions(jobId, minConfidence, false);

    if (!result) {
      return null;
    }

    // Get previously seen question IDs for this user
    let previouslySeenIds: string[] = [];
    if (userEmail) {
      const previousAttempts = await this.prisma.quizAttempt.findMany({
        where: {
          userEmail,
          status: 'completed', // Only count completed quizzes
        },
        select: {
          questionIds: true,
        },
      });

      // Flatten all question IDs from all attempts
      previouslySeenIds = previousAttempts.flatMap(attempt => attempt.questionIds);

      this.logger.log(`User ${userEmail} has seen ${previouslySeenIds.length} questions previously`);
    }

    // Apply filters
    let filtered = result.questions;

    // Exclude previously seen questions
    if (previouslySeenIds.length > 0) {
      filtered = filtered.filter(q => !previouslySeenIds.includes(q.id));
      this.logger.log(`After excluding seen questions: ${filtered.length} available`);
    }

    if (difficulty) {
      filtered = filtered.filter(
        (q) => q.difficulty.toLowerCase() === difficulty.toLowerCase(),
      );
    }

    if (topic) {
      filtered = filtered.filter(
        (q) => q.topic.toLowerCase().includes(topic.toLowerCase()),
      );
    }

    // If all questions have been seen, reset and use all questions
    if (filtered.length === 0 && previouslySeenIds.length > 0) {
      this.logger.log(`User has seen all questions - allowing repeats`);
      filtered = result.questions;

      // Reapply difficulty/topic filters
      if (difficulty) {
        filtered = filtered.filter(
          (q) => q.difficulty.toLowerCase() === difficulty.toLowerCase(),
        );
      }
      if (topic) {
        filtered = filtered.filter(
          (q) => q.topic.toLowerCase().includes(topic.toLowerCase()),
        );
      }
    }

    // Shuffle and select random questions
    const shuffled = filtered.sort(() => Math.random() - 0.5);
    let selected = shuffled.slice(0, Math.min(count, shuffled.length));

    // For debugging: ensure the coordinate geometry question is included
    const coordinateGeometryQuestion = filtered.find(q => q.topic === 'Coordinate Geometry');
    if (coordinateGeometryQuestion && !selected.some(q => q.id === coordinateGeometryQuestion.id)) {
      if (selected.length < count) {
        selected.push(coordinateGeometryQuestion);
      } else {
        selected[selected.length - 1] = coordinateGeometryQuestion;
      }
    }

    // Renumber the selected questions from 1 for display
    selected = selected.map((q, index) => ({
      ...q,
      number: index + 1,
    }));

    return {
      ...result,
      totalQuestions: result.questions.length,
      filteredCount: filtered.length,
      selectedCount: selected.length,
      questions: selected,
      previouslySeenCount: previouslySeenIds.length,
    };
  }

  /**
   * Start a quiz attempt
   */
  async startQuizAttempt(userName?: string, userEmail?: string) {
    const attempt = await this.prisma.quizAttempt.create({
      data: {
        userName: userName || 'Anonymous',
        userEmail: userEmail || `anonymous-${Date.now()}@example.com`,
        questionIds: [],
        answers: {},
        totalMarks: 0,
        status: 'in_progress',
        startedAt: new Date(),
        lastActivityAt: new Date(),
      },
    });

    return { attemptId: attempt.id };
  }

  /**
   * Submit quiz attempt and send results email
   */
  async submitQuizAttempt(
    userName: string,
    userEmail: string,
    questionIds: string[],
    answers: Record<string, string>,
    questionTimings?: Record<string, { startedAt: string; answeredAt: string; durationSeconds: number }>,
    quizStartedAt?: string,
    attemptId?: string,
  ): Promise<any> {
    let score = 0;
    let totalMarks = 0;
    const results = [];

    for (const questionId of questionIds) {
      const part = await this.prisma.questionPart.findUnique({
        where: { id: questionId },
        include: {
          question: {
            select: { jobId: true },
          },
        },
      });

      if (part) {
        totalMarks += part.marks;
        const correctOptionIndex = part.correctOption;

        const optionsArray = (part.options as { label: string; text: string }[]) || [];
        // Handle case where correctOption might be 0 (falsy) but valid
        const correctOptionObj = correctOptionIndex !== null && correctOptionIndex !== undefined
          ? optionsArray[correctOptionIndex]
          : null;

        const correctOption = correctOptionObj?.label;
        const userAnswer = answers[questionId];

        // Normalize for comparison
        const normalizedCorrect = correctOption?.trim().toLowerCase();
        const normalizedUser = userAnswer?.trim().toLowerCase();

        const isCorrect = !!(normalizedCorrect && normalizedUser && normalizedCorrect === normalizedUser);

        if (isCorrect) {
          score += part.marks;
          this.logger.debug(`Correct answer for ${questionId}. Marks: ${part.marks}. New Score: ${score}`);
        } else {
          this.logger.debug(`Wrong answer for ${questionId}. User: ${normalizedUser}, Correct: ${normalizedCorrect}`);
        }

        results.push({
          questionId: part.id,
          questionText: part.questionText,
          isCorrect,
          userAnswer,
          correctAnswer: correctOption,
          marks: part.marks,
          jobId: part.question.jobId,
        });
      }
    }

    const completedAt = new Date();
    const startedAt = quizStartedAt ? new Date(quizStartedAt) : completedAt;
    const duration = Math.floor((completedAt.getTime() - startedAt.getTime()) / 1000);

    let attempt;

    if (attemptId) {
      // Update existing attempt
      attempt = await this.prisma.quizAttempt.update({
        where: { id: attemptId },
        data: {
          userName,
          userEmail,
          questionIds,
          answers,
          questionTimings: questionTimings || undefined,
          score,
          totalMarks,
          // Keep original startedAt if it exists, otherwise update
          // startedAt: startedAt, 
          completedAt,
          duration,
          status: 'completed',
          lastActivityAt: completedAt,
        },
      });
    } else {
      // Create new attempt (fallback)
      attempt = await this.prisma.quizAttempt.create({
        data: {
          userName,
          userEmail,
          questionIds,
          answers,
          questionTimings: questionTimings || null,
          score,
          totalMarks,
          startedAt,
          completedAt,
          duration,
          status: 'completed',
          lastActivityAt: completedAt,
        },
      });
    }

    // Get job ID from first result
    const jobId = results.length > 0 ? results[0].jobId : null;

    // Send results email asynchronously (non-blocking)
    this.sendQuizResultsEmailAsync(
      userName,
      userEmail,
      score,
      totalMarks,
      results,
      jobId,
    ).catch((error) => {
      this.logger.error(`Failed to send quiz results email: ${error.message}`);
    });

    return {
      attemptId: attempt.id,
      userName,
      userEmail,
      score,
      totalMarks,
      percentage: Math.round((score / totalMarks) * 100),
      results,
      message: 'Quiz submitted successfully. Results email is being sent...',
    };
  }

  /**
   * Send quiz results email (async, non-blocking)
   */
  private async sendQuizResultsEmailAsync(
    userName: string,
    userEmail: string,
    score: number,
    totalMarks: number,
    results: any[],
    jobId: string | null,
  ): Promise<void> {
    try {
      this.logger.log(`Preparing results email for ${userEmail}...`);

      const correctAnswers = results.filter((r) => r.isCorrect).length;
      const wrongAnswers = results.filter((r) => !r.isCorrect);
      const percentage = (score / totalMarks) * 100;

      // Analyze quiz for practice questions
      const analysisResults = await this.quizAnalysis.analyzeQuizAttempt(
        results.map((r) => r.questionId),
        results.reduce((acc, r) => {
          acc[r.questionId] = r.userAnswer || '';
          return acc;
        }, {} as Record<string, string>),
      );

      // Get practice questions (if we have wrong answers)
      let practiceQuestions = [];
      if (jobId && wrongAnswers.length > 0) {
        try {
          practiceQuestions = await this.quizAnalysis.generatePracticeQuestions(
            analysisResults.wrongAnswers,
            analysisResults.correctAnswers,
            jobId,
          );

          // If database is insufficient, add fallback suggestions
          const targetCount = wrongAnswers.length * 2;
          if (practiceQuestions.length < targetCount) {
            const shortage = targetCount - practiceQuestions.length;
            this.logger.log(`Database has ${practiceQuestions.length}/${targetCount} practice questions. Generating ${shortage} fallback questions.`);
            const fallbackQs = await this.quizAnalysis.generateFallbackPracticeQuestions(
              analysisResults.wrongAnswers,
              shortage,
            );
            practiceQuestions = [...practiceQuestions, ...fallbackQs];
          }
        } catch (error) {
          this.logger.warn(`Could not generate practice questions: ${error.message}`);
        }
      }

      // Generate PDF with results and practice questions
      const pdfBuffer = await this.pdfGenerator.generateQuizResultsPdf(
        userName,
        results,
        practiceQuestions,
        score,
        totalMarks,
      );

      // Send email with PDF attachment
      const attemptId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
      const emailResult = await this.emailService.sendQuizResultsEmail(
        userEmail,
        userName,
        {
          score,
          totalMarks,
          percentage,
          correctAnswers,
          wrongAnswers: wrongAnswers.length,
        },
        pdfBuffer,
        `quiz-results-${attemptId}.pdf`,
      );

      if (emailResult.success) {
        this.logger.log(`✅ Results email sent to ${userEmail}`);
      } else {
        this.logger.error(`❌ Failed to send results email: ${JSON.stringify(emailResult)}`);
      }
    } catch (error) {
      this.logger.error(
        `Error in sendQuizResultsEmailAsync: ${error.message}`,
        error.stack,
      );
    }
  }

  async getJobStatus(jobId: string): Promise<any> {
    const job = await this.prisma.processingJob.findUnique({
      where: { jobId },
    });

    if (!job) {
      return null;
    }

    // Generate a signed URL for the original PDF if it exists
    let pdfUrl = null;
    if (job.originalPath && fs.existsSync(job.originalPath)) {
      // Upload to MinIO temporarily or serve directly
      // For now, you can serve it via a static endpoint
      pdfUrl = `/api/pdf/download/${jobId}`;
    }

    return {
      jobId: job.jobId,
      filename: job.filename,
      status: job.status,
      batchSize: job.batchSize,
      totalPages: job.totalPages,
      totalQuestions: job.totalQuestions,
      apiCallsUsed: job.apiCallsUsed,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      pdfUrl, // Original PDF URL for cropping
    };
  }

  async getAllJobs(): Promise<any> {
    const jobs = await this.prisma.processingJob.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        jobId: true,
        filename: true,
        status: true,
        totalPages: true,
        totalQuestions: true,
        apiCallsUsed: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return { jobs };
  }

  async getJobWithOriginalPath(jobId: string): Promise<any> {
    return await this.prisma.processingJob.findUnique({
      where: { jobId },
      select: {
        jobId: true,
        filename: true,
        originalPath: true,
        status: true,
      },
    });
  }

  /**
   * Get a replacement question that is not in the excluded list
   */
  async getReplacementQuestion(
    jobId: string,
    excludeIds: string[],
  ): Promise<any> {
    const allQuestions = await this.getQuizQuestions(jobId);
    if (!allQuestions || allQuestions.questions.length === 0) {
      return null;
    }

    const availableQuestions = allQuestions.questions.filter(
      (q) => !excludeIds.includes(q.id) && q.difficulty?.toLowerCase() === 'easy',
    );

    if (availableQuestions.length === 0) {
      // If no unused questions are available, try to find ANY easy question (allow repeats)
      const anyEasyQuestions = allQuestions.questions.filter(
        (q) => q.difficulty?.toLowerCase() === 'easy',
      );

      if (anyEasyQuestions.length > 0) {
        const randomIndex = Math.floor(Math.random() * anyEasyQuestions.length);
        return anyEasyQuestions[randomIndex];
      }

      // No easy questions exist at all
      return null;
    }

    const randomIndex = Math.floor(Math.random() * availableQuestions.length);
    return availableQuestions[randomIndex];
  }

  /**
   * Process answers PDF for a job
   */
  async processAnswersPdf(jobId: string, file: Express.Multer.File, paperSection?: string): Promise<any> {
    try {
      this.logger.log(`Processing answers PDF for job ${jobId}: ${file.originalname}${paperSection ? ` (${paperSection})` : ''}`);

      // Execute Python script to process answers
      const pythonScriptPath = this.configService.get('PYTHON_SCRIPT_PATH');
      const pythonScriptDir = path.dirname(pythonScriptPath);
      const answersScriptPath = path.join(pythonScriptDir, 'process_answers_pdf.py');

      this.logger.log(`Executing Python answers processor: ${answersScriptPath}`);

      // Execute Python script
      const { spawn } = require('child_process');
      const python = spawn('python3', [answersScriptPath, file.path, '5']);

      let stdout = '';
      let stderr = '';

      python.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        this.logger.log(output.trim());
      });

      python.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      await new Promise((resolve, reject) => {
        python.on('close', (code) => {
          if (code !== 0) {
            this.logger.error(`Python script failed with code ${code}`);
            this.logger.error(stderr);
            reject(new Error(`Answer processing failed: ${stderr}`));
          } else {
            this.logger.log('Python answer processing completed successfully');
            resolve(null);
          }
        });
      });

      // Load parsed answers
      const answersData = this.answerLinkingService.loadParsedAnswers(pythonScriptDir);

      this.logger.log(`Loaded ${answersData.answers.length} answers from parsed file`);

      // Link answers to questions (with optional paper section filter)
      const result = await this.answerLinkingService.linkAnswersToQuestions(
        jobId,
        answersData,
        paperSection,
      );

      this.logger.log(`Answer linking complete: ${result.linked} linked, ${result.failed} failed, ${result.aiGenerated} AI-generated`);

      return {
        jobId,
        filename: file.originalname,
        status: 'completed',
        totalAnswers: answersData.answers.length,
        linked: result.linked,
        failed: result.failed,
        aiGenerated: result.aiGenerated,
        papers: (answersData.document_info as any).papers || [],
        message: 'Answers processed and linked successfully',
      };
    } catch (error) {
      this.logger.error(`Failed to process answers PDF: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get answer status for a job
   */
  async getAnswersStatus(jobId: string): Promise<any> {
    const job = await this.prisma.processingJob.findUnique({
      where: { jobId },
    });

    if (!job) {
      return null;
    }

    // Count parts with answers
    const totalParts = await this.prisma.questionPart.count({
      where: {
        question: { jobId },
      },
    });

    const partsWithAnswers = await this.prisma.questionPart.count({
      where: {
        question: { jobId },
        stepByStepAnswer: { not: null },
      },
    });

    const officialAnswers = await this.prisma.questionPart.count({
      where: {
        question: { jobId },
        answerSource: 'official_pdf',
      },
    });

    const aiAnswers = await this.prisma.questionPart.count({
      where: {
        question: { jobId },
        answerSource: 'ai_generated',
      },
    });

    const coverage = totalParts > 0 ? (partsWithAnswers / totalParts) * 100 : 0;

    return {
      jobId,
      hasAnswers: partsWithAnswers > 0,
      totalParts,
      partsWithAnswers,
      officialAnswers,
      aiAnswers,
      coverage: Math.round(coverage * 10) / 10, // Round to 1 decimal
    };
  }

  /**
   * Generate AI answer for a specific question part
   */
  async generateAiAnswerForPart(questionId: string, partId: string): Promise<{ answer: string }> {
    // Get the question part with question data
    const part = await this.prisma.questionPart.findUnique({
      where: { id: partId },
      include: { question: true },
    });

    if (!part) {
      throw new Error('Question part not found');
    }

    // Generate AI answer using Gemini
    const answer = await this.geminiAnswerService.generateStepByStepAnswer(
      part.question.questionText,
      part.sampleAnswer || undefined,
      part.explanation || undefined,
      part.hints || undefined,
    );

    // Update the question part with AI answer
    await this.prisma.questionPart.update({
      where: { id: partId },
      data: {
        stepByStepAnswer: answer,
        answerSource: 'ai_generated',
      },
    });

    this.logger.log(`Generated AI answer for part ${partId}`);

    return { answer };
  }

  /**
   * Bulk generate AI answers for all question parts in a job without answers
   */
  async bulkGenerateAiAnswers(jobId: string): Promise<{ generated: number; failed: number }> {
    this.logger.log(`Starting bulk AI answer generation for job ${jobId}`);

    // Get all question parts without step-by-step answers
    const partsWithoutAnswers = await this.prisma.questionPart.findMany({
      where: {
        question: { jobId },
        stepByStepAnswer: null,
      },
      include: { question: true },
    });

    this.logger.log(`Found ${partsWithoutAnswers.length} parts without answers`);

    let generated = 0;
    let failed = 0;

    for (const part of partsWithoutAnswers) {
      try {
        const answer = await this.geminiAnswerService.generateStepByStepAnswer(
          part.question.questionText,
          part.sampleAnswer || undefined,
          part.explanation || undefined,
          part.hints || undefined,
        );

        await this.prisma.questionPart.update({
          where: { id: part.id },
          data: {
            stepByStepAnswer: answer,
            answerSource: 'ai_generated',
          },
        });

        generated++;
        this.logger.log(`Generated AI answer for part ${part.id} (${generated}/${partsWithoutAnswers.length})`);

        // Add delay to avoid rate limiting (10 requests/minute = 1 request per 6 seconds)
        await new Promise(resolve => setTimeout(resolve, 7000));
      } catch (error) {
        this.logger.error(`Failed to generate AI answer for part ${part.id}: ${error.message}`);
        failed++;
      }
    }

    this.logger.log(`Bulk generation complete: ${generated} generated, ${failed} failed`);

    return { generated, failed };
  }

  /**
   * Get comprehensive quiz analytics
   */
  async getQuizAnalytics() {
    // Auto-mark stale in_progress attempts as abandoned (older than 4 hours)
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
    await this.prisma.quizAttempt.updateMany({
      where: {
        status: 'in_progress',
        lastActivityAt: {
          lt: fourHoursAgo,
        },
      },
      data: {
        status: 'abandoned',
      },
    });

    // Get all quiz attempts (refresh after update)
    const allAttempts = await this.prisma.quizAttempt.findMany({
      orderBy: { startedAt: 'desc' },
    });

    const totalAttempts = allAttempts.length;
    const completedAttempts = allAttempts.filter((a) => a.status === 'completed');
    const abandonedAttempts = allAttempts.filter((a) => a.status === 'abandoned');
    const inProgressAttempts = allAttempts.filter((a) => a.status === 'in_progress');

    // Calculate completion rate
    const completionRate = totalAttempts > 0
      ? Math.round((completedAttempts.length / totalAttempts) * 100)
      : 0;

    // Calculate average score and duration for completed quizzes
    const avgScore = completedAttempts.length > 0
      ? Math.round(
        completedAttempts.reduce((sum, a) => sum + (a.score || 0), 0) /
        completedAttempts.length,
      )
      : 0;

    const avgDuration = completedAttempts.length > 0
      ? Math.round(
        completedAttempts.reduce((sum, a) => sum + (a.duration || 0), 0) /
        completedAttempts.length,
      )
      : 0;

    // Get unique users
    const uniqueUsers = new Set(allAttempts.map((a) => a.userEmail)).size;

    // Recent attempts (last 10)
    const recentAttempts = allAttempts.slice(0, 10).map((a) => ({
      id: a.id,
      userName: a.userName,
      userEmail: a.userEmail,
      score: a.score,
      totalMarks: a.totalMarks,
      percentage: a.totalMarks > 0 ? Math.round(((a.score || 0) / a.totalMarks) * 100) : 0,
      duration: a.duration,
      status: a.status,
      startedAt: a.startedAt,
      completedAt: a.completedAt,
      questionCount: a.questionIds.length,
    }));

    // Per-question statistics
    const questionStats = this.calculateQuestionStatistics(allAttempts);

    // User performance (top performers)
    const userPerformance = this.calculateUserPerformance(completedAttempts);

    return {
      summary: {
        totalAttempts,
        completedAttempts: completedAttempts.length,
        abandonedAttempts: abandonedAttempts.length,
        inProgressAttempts: inProgressAttempts.length,
        completionRate,
        avgScore,
        avgDuration,
        uniqueUsers,
      },
      recentAttempts,
      questionStats,
      userPerformance,
    };
  }

  private calculateQuestionStatistics(attempts: any[]) {
    const questionMap = new Map<string, {
      questionId: string;
      timesAnswered: number;
      timesCorrect: number;
      totalDuration: number;
    }>();

    attempts.forEach((attempt) => {
      if (attempt.questionTimings) {
        Object.keys(attempt.questionTimings).forEach((qId) => {
          const timing = attempt.questionTimings[qId];
          if (!questionMap.has(qId)) {
            questionMap.set(qId, {
              questionId: qId,
              timesAnswered: 0,
              timesCorrect: 0,
              totalDuration: 0,
            });
          }

          const stats = questionMap.get(qId)!;
          stats.timesAnswered++;
          stats.totalDuration += timing.durationSeconds || 0;

          // Check if answer was correct
          if (attempt.answers && attempt.answers[qId]) {
            // We'd need to check against correct answer here
            // For now, we'll skip this part
          }
        });
      }
    });

    return Array.from(questionMap.values())
      .map((stat) => ({
        ...stat,
        avgDuration: stat.timesAnswered > 0
          ? Math.round(stat.totalDuration / stat.timesAnswered)
          : 0,
        successRate: stat.timesAnswered > 0
          ? Math.round((stat.timesCorrect / stat.timesAnswered) * 100)
          : 0,
      }))
      .slice(0, 20); // Top 20 questions
  }

  private calculateUserPerformance(completedAttempts: any[]) {
    const userMap = new Map<string, {
      userEmail: string;
      userName: string;
      attemptCount: number;
      totalScore: number;
      totalMarks: number;
      bestScore: number;
    }>();

    completedAttempts.forEach((attempt) => {
      if (!userMap.has(attempt.userEmail)) {
        userMap.set(attempt.userEmail, {
          userEmail: attempt.userEmail,
          userName: attempt.userName,
          attemptCount: 0,
          totalScore: 0,
          totalMarks: 0,
          bestScore: 0,
        });
      }

      const user = userMap.get(attempt.userEmail)!;
      user.attemptCount++;
      user.totalScore += attempt.score || 0;
      user.totalMarks += attempt.totalMarks || 0;
      user.bestScore = Math.max(user.bestScore, attempt.score || 0);
    });

    return Array.from(userMap.values())
      .map((user) => ({
        ...user,
        avgScore: user.attemptCount > 0
          ? Math.round(user.totalScore / user.attemptCount)
          : 0,
        avgPercentage: user.totalMarks > 0
          ? Math.round((user.totalScore / user.totalMarks) * 100)
          : 0,
      }))
      .sort((a, b) => b.avgPercentage - a.avgPercentage)
      .slice(0, 10); // Top 10 users
  }

  /**
   * Get all diagrams for a job with their questions
   */
  async getDiagramsForJob(jobId: string): Promise<any> {
    const diagrams = await this.prisma.diagram.findMany({
      where: {
        question: {
          jobId,
        },
      },
      include: {
        question: {
          select: {
            id: true,
            questionNum: true,
            questionText: true,
            topic: true,
            pageNumber: true,
          },
        },
      },
      orderBy: [
        { question: { pageNumber: 'asc' } },
        { pageNumber: 'asc' },
      ],
    });

    return {
      jobId,
      totalDiagrams: diagrams.length,
      diagrams: diagrams.map(d => ({
        id: d.id,
        fileName: d.fileName,
        minioUrl: d.minioUrl,
        confidence: d.confidence,
        source: d.source,
        pageNumber: d.pageNumber,
        question: {
          id: d.question.id,
          questionNum: d.question.questionNum,
          questionText: d.question.questionText.substring(0, 100) + '...',
          topic: d.question.topic,
          pageNumber: d.question.pageNumber,
        },
      })),
    };
  }

  /**
   * Replace a diagram with a manually cropped version
   */
  async replaceDiagram(
    diagramId: string,
    file: Express.Multer.File,
  ): Promise<any> {
    this.logger.log(`Replacing diagram ${diagramId} with file: ${file?.originalname} (${file?.size} bytes)`);

    const diagram = await this.prisma.diagram.findUnique({
      where: { id: diagramId },
      include: {
        question: {
          select: { jobId: true },
        },
      },
    });

    if (!diagram) {
      throw new Error('Diagram not found');
    }

    // Upload new diagram to MinIO
    const uploadResult = await this.minioService.uploadDiagram(
      diagram.question.jobId,
      file.path,
      diagram.pageNumber,
      Date.now(), // Use timestamp as index for uniqueness
    );

    // Update database with new diagram URL
    const updated = await this.prisma.diagram.update({
      where: { id: diagramId },
      data: {
        minioUrl: uploadResult.url,
        minioKey: uploadResult.key,
        fileName: uploadResult.key,
        fileSize: file.size,
        source: 'manual_crop',
        confidence: 100, // Manual crops are 100% confidence
      },
    });

    // Clean up uploaded file
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }

    this.logger.log(`✅ Replaced diagram ${diagramId} with manual crop`);

    return {
      success: true,
      diagram: {
        id: updated.id,
        fileName: updated.fileName,
        minioUrl: updated.minioUrl,
        confidence: updated.confidence,
        source: updated.source,
      },
    };
  }

  /**
   * Delete a diagram
   */
  async deleteDiagram(diagramId: string): Promise<any> {
    const diagram = await this.prisma.diagram.findUnique({
      where: { id: diagramId },
    });

    if (!diagram) {
      throw new Error('Diagram not found');
    }

    await this.prisma.diagram.delete({
      where: { id: diagramId },
    });

    return { success: true, message: 'Diagram deleted successfully' };
  }

  /**
   * Add a diagram to a question (via QuestionPart ID)
   */
  async addDiagram(questionPartId: string, file: Express.Multer.File): Promise<any> {
    // Find the question part to get the parent question
    const part = await this.prisma.questionPart.findUnique({
      where: { id: questionPartId },
      include: { question: true },
    });

    if (!part) {
      throw new Error('Question not found');
    }

    const question = part.question;

    // Upload to MinIO
    const uploadResult = await this.minioService.uploadDiagram(
      question.jobId,
      file.path,
      question.pageNumber,
      Date.now(),
    );

    // Create diagram record
    const diagram = await this.prisma.diagram.create({
      data: {
        question: { connect: { id: question.id } },
        pageNumber: question.pageNumber,
        minioUrl: uploadResult.url,
        minioKey: uploadResult.key,
        fileName: uploadResult.key,
        contentType: file.mimetype,
        fileSize: file.size,
        source: 'manual_upload',
        confidence: 100,
      },
    });

    // Clean up uploaded file
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }

    return {
      success: true,
      diagram: {
        id: diagram.id,
        fileName: diagram.fileName,
        minioUrl: diagram.minioUrl,
        confidence: diagram.confidence,
        source: diagram.source,
      },
    };
  }
  async linkDiagram(questionPartId: string, diagramId: string): Promise<any> {
    const sourceDiagram = await this.prisma.diagram.findUnique({
      where: { id: diagramId },
    });

    if (!sourceDiagram) {
      throw new Error('Source diagram not found');
    }

    const part = await this.prisma.questionPart.findUnique({
      where: { id: questionPartId },
      include: { question: true },
    });

    if (!part) {
      throw new Error('Target question not found');
    }

    const newDiagram = await this.prisma.diagram.create({
      data: {
        question: { connect: { id: part.question.id } },
        pageNumber: sourceDiagram.pageNumber,
        minioUrl: sourceDiagram.minioUrl,
        minioKey: sourceDiagram.minioKey,
        fileName: sourceDiagram.fileName,
        contentType: sourceDiagram.contentType,
        fileSize: sourceDiagram.fileSize,
        source: 'linked_from_existing',
        confidence: sourceDiagram.confidence,
      },
    });

    return {
      success: true,
      diagram: {
        id: newDiagram.id,
        fileName: newDiagram.fileName,
        minioUrl: newDiagram.minioUrl,
        confidence: newDiagram.confidence,
        source: newDiagram.source,
      },
    };
  }

  /**
   * Update question part options, correct answer, or sample answer
   */
  async updateQuestionAnswer(
    partId: string,
    options?: any[],
    correctOption?: number | string,
    sampleAnswer?: string,
    stepByStepAnswer?: string,
  ): Promise<any> {
    // Convert string correctOption (like "B") to index if needed
    let correctOptionIndex = correctOption;
    if (typeof correctOption === 'string' && options) {
      correctOptionIndex = options.findIndex(opt => opt.label === correctOption);
      if (correctOptionIndex === -1) {
        correctOptionIndex = correctOption; // Keep as-is if not found
      }
    }

    const dataToUpdate: any = {};

    if (options !== undefined) {
      dataToUpdate.options = options && options.length > 0 ? options : null;
    }

    if (correctOption !== undefined) {
      dataToUpdate.correctOption = typeof correctOptionIndex === 'number' ? correctOptionIndex : null;
    }

    if (sampleAnswer !== undefined) {
      dataToUpdate.sampleAnswer = sampleAnswer;
    }

    if (stepByStepAnswer !== undefined) {
      dataToUpdate.stepByStepAnswer = stepByStepAnswer;
    }

    const updated = await this.prisma.questionPart.update({
      where: { id: partId },
      data: dataToUpdate,
      include: {
        question: {
          select: {
            questionNum: true,
            topic: true,
          },
        },
      },
    });

    this.logger.log(
      `✅ Updated answer details for question part ${partId} (Q${updated.question.questionNum})`,
    );

    return {
      success: true,
      partId: updated.id,
      options: updated.options,
      correctOption: updated.correctOption,
      sampleAnswer: updated.sampleAnswer,
      stepByStepAnswer: updated.stepByStepAnswer,
      question: updated.question,
    };
  }

  /**
   * Delete a job and all associated data
   */
  async deleteJob(jobId: string): Promise<any> {
    const job = await this.prisma.processingJob.findUnique({
      where: { jobId },
    });

    if (!job) {
      throw new Error('Job not found');
    }

    // MongoDB doesn't handle cascade deletes well in concurrent scenarios
    // Delete related records manually to avoid write conflicts

    // First, get all questions for this job
    const questions = await this.prisma.question.findMany({
      where: { jobId },
      select: { id: true },
    });

    this.logger.log(`Deleting ${questions.length} questions for job ${jobId}`);

    // Delete all questions (this will cascade to parts and diagrams via Prisma)
    // Do this in batches to avoid overwhelming the database
    const batchSize = 10;
    for (let i = 0; i < questions.length; i += batchSize) {
      const batch = questions.slice(i, i + batchSize);
      await this.prisma.question.deleteMany({
        where: {
          id: { in: batch.map(q => q.id) },
        },
      });
    }

    // Now delete the job itself
    await this.prisma.processingJob.delete({
      where: { jobId },
    });

    this.logger.log(`Deleted job ${jobId} and all associated records`);

    return {
      success: true,
      message: `Job ${jobId} deleted successfully`,
    };
  }

  /**
   * Update question difficulty
   */
  async updateQuestionDifficulty(questionId: string, difficulty: string): Promise<any> {
    this.logger.log(`Attempting to update question ${questionId} difficulty to ${difficulty}`);

    // Validate difficulty value
    const validDifficulties = ['easy', 'medium', 'hard'];
    if (!validDifficulties.includes(difficulty.toLowerCase())) {
      throw new Error('Invalid difficulty. Must be easy, medium, or hard');
    }

    // Check if question exists first
    const existingQuestion = await this.prisma.question.findUnique({
      where: { id: questionId },
    });

    if (!existingQuestion) {
      this.logger.error(`Question not found with ID: ${questionId}`);
      throw new Error(`Question not found with ID: ${questionId}`);
    }

    const question = await this.prisma.question.update({
      where: { id: questionId },
      data: { difficulty: difficulty.toLowerCase() },
    });

    this.logger.log(`✅ Updated question ${questionId} difficulty to ${difficulty}`);

    return {
      success: true,
      questionId: question.id,
      difficulty: question.difficulty,
    };
  }
}
