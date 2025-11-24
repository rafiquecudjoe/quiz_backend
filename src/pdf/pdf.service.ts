import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { PythonExecutorService } from './python-executor.service';
import { EmailService } from '../email/email.service';
import { PdfGeneratorService } from './pdf-generator.service';
import { QuizAnalysisService } from './quiz-analysis.service';

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
    const existingJob = await this.prisma.processingJob.findUnique({
      where: { pdfHash },
    });
    if (existingJob) {
      this.logger.warn(`Duplicate PDF detected. Skipping processing. JobId: ${existingJob.jobId}`);
      return {
        jobId: existingJob.jobId,
        filename: existingJob.filename,
        status: existingJob.status,
        message: 'PDF already processed. Returning existing job.',
      };
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
    for (const enrichedQ of data.enriched_questions) {
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
      //         questionNum: enrichedQ.question_num,
      //         topic: enrichedQ.topic,
      //         subject: enrichedQ.subject || 'Mathematics',
      //       },
      //     ],
      //   },
      // });

      // if (existingQuestion) {
      //   this.logger.warn(
      //     `Skipping duplicate question ${enrichedQ.question_num} (matches existing question ${existingQuestion.questionNum} from job ${existingQuestion.jobId})`,
      //   );
      //   continue;
      // }

      // Filter diagrams to only those with confidence scores
      const filteredDiagrams = this.filterDiagramsByConfidence(
        enrichedQ.diagrams,
      );

      this.logger.log(
        `Question ${enrichedQ.question_num}: ${filteredDiagrams.length}/${enrichedQ.diagrams.length} diagrams passed confidence filter`,
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
          questionNum: enrichedQ.question_num,
          pageNumber: enrichedQ.page_number,
          questionText: enrichedQ.question_text || 'Question text not available', // Handle null case
          topic: enrichedQ.topic,
          chapter: enrichedQ.chapter || 'General', // Provide default value for null chapter
          subject: enrichedQ.subject || 'Mathematics',
          schoolLevel: enrichedQ.school_level,
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
        // Use part marks if provided, otherwise use difficulty-based marks
        const partMarks = part.marks || defaultMarks;

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
   * Get all questions for a job (transformed for frontend)
   * This replaces frontend's transformQuestions() function
   */
  async getQuizQuestions(
    jobId: string,
    minConfidence?: number,
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
        transformedQuestions.push({
          id: part.id,
          number: questionNumber++,
          originalQuestionNum: q.questionNum,
          text: part.questionText,
          context: q.questionText && q.questionText !== part.questionText ? q.questionText : undefined,
          marks: part.marks, // Marks per part (1 for easy, 2 for medium, 3 for hard)
          sampleAnswer: part.sampleAnswer,
          explanation: part.explanation,
          hints: part.hints,
          options: part.options || [],
          correctOption: part.correctOption,
          hasImage: filteredDiagrams.length > 0,
          diagrams: filteredDiagrams.map((d) => ({
            url: d.minioUrl,
            fileName: d.fileName,
            confidence: d.confidence,
            source: d.source,
          })),
          // Metadata
          chapter: q.chapter,
          topic: q.topic,
          schoolLevel: q.schoolLevel,
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
  ): Promise<any> {
    const result = await this.getQuizQuestions(jobId, minConfidence);

    if (!result) {
      return null;
    }

    // Apply filters
    let filtered = result.questions;

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
    };
  }

  /**
   * Submit quiz attempt and send results email
   */
  async submitQuizAttempt(
    userName: string,
    userEmail: string,
    questionIds: string[],
    answers: Record<string, string>,
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
        const correctOption = optionsArray[correctOptionIndex]?.label;
        const userAnswer = answers[questionId];

        const isCorrect = correctOption === userAnswer;
        if (isCorrect) {
          score += part.marks;
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

    const attempt = await this.prisma.quizAttempt.create({
      data: {
        userName,
        userEmail,
        questionIds,
        answers,
        score,
        totalMarks,
        completedAt: new Date(),
      },
    });

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
      (q) => !excludeIds.includes(q.id),
    );

    if (availableQuestions.length === 0) {
      // All questions have been used
      return null;
    }

    const randomIndex = Math.floor(Math.random() * availableQuestions.length);
    return availableQuestions[randomIndex];
  }
}
