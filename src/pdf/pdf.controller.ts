import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  UploadedFile,
  UseInterceptors,
  ParseIntPipe,
  HttpException,
  HttpStatus,
  Logger,
  BadRequestException,
  Res,
  Patch,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PdfService } from './pdf.service';
import { diskStorage } from 'multer';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import { SubmitQuizDto } from './dto/submit-quiz.dto';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import * as fs from 'fs';

@Controller('pdf')
export class PdfController {
  private readonly logger = new Logger(PdfController.name);

  constructor(
    private readonly pdfService: PdfService,
    private readonly configService: ConfigService,
  ) { }

  /**
   * Upload and process PDF
   * POST /pdf/upload
   *
   * This endpoint:
   * 1. Accepts PDF file upload
   * 2. Executes Python script to extract questions and diagrams
   * 3. Stores questions in database with diagram uploads to MinIO
   * 4. Copies enriched_questions.json to bbc-main/public/ for frontend
   * 5. Copies diagram images to bbc-main/public/diagrams/ for frontend
   */
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads',
        filename: (req, file, cb) => {
          const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
          cb(null, uniqueName);
        },
      }),
      fileFilter: (req, file, cb) => {
        if (file.mimetype !== 'application/pdf') {
          return cb(
            new HttpException('Only PDF files allowed', HttpStatus.BAD_REQUEST),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  async uploadPdf(
    @UploadedFile() file: Express.Multer.File,
    @Body('batchSize') batchSize?: string,
  ) {
    if (!file) {
      throw new HttpException('No file uploaded', HttpStatus.BAD_REQUEST);
    }

    const batchSizeNum = batchSize ? parseInt(batchSize, 10) : 5;
    return await this.pdfService.processPdf(file, batchSizeNum);
  }

  /**
   * Get job status
   * GET /pdf/jobs/:jobId/status
   */
  @Get('jobs/:jobId/status')
  async getJobStatus(@Param('jobId') jobId: string) {
    const status = await this.pdfService.getJobStatus(jobId);

    if (!status) {
      throw new HttpException('Job not found', HttpStatus.NOT_FOUND);
    }

    return status;
  }

  /**
   * Delete a job
   * DELETE /pdf/jobs/:jobId
   */
  @Delete('jobs/:jobId')
  async deleteJob(@Param('jobId') jobId: string) {
    try {
      return await this.pdfService.deleteJob(jobId);
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.NOT_FOUND);
    }
  }

  /**
   * Get all quiz questions for a job (transformed for frontend)
   * GET /pdf/jobs/:jobId/questions
   * Query params:
   *   - minConfidence: Minimum diagram confidence (default from config)
   */
  @Get('jobs/:jobId/questions')
  async getJobQuestions(
    @Param('jobId') jobId: string,
    @Query('minConfidence') minConfidence?: string,
  ) {
    const minConf = minConfidence ? parseFloat(minConfidence) : undefined;
    // Admin endpoint: Include excluded questions so they can be managed
    const questions = await this.pdfService.getQuizQuestions(jobId, minConf, true);
    if (!questions) {
      throw new HttpException('Job not found or not completed', HttpStatus.NOT_FOUND);
    }
    return questions;
  }

  /**
   * Toggle question exclusion
   * POST /pdf/questions/:id/exclude
   */
  @Post('questions/:id/exclude')
  async toggleQuestionExclusion(
    @Param('id') id: string,
    @Body('exclude') exclude: boolean,
  ) {
    return this.pdfService.toggleQuestionExclusion(id, exclude);
  }

  /**
   * Get random quiz questions (default 5)
   * GET /pdf/jobs/:jobId/questions/random
   * Query params:
   *   - count: Number of questions (default 5)
   *   - minConfidence: Minimum diagram confidence
   */
  @Get('jobs/:jobId/questions/random')
  async getRandomQuizQuestions(
    @Param('jobId') jobId: string,
    @Query('count') count?: string,
    @Query('minConfidence') minConfidence?: string,
  ) {
    const countNum = count ? parseInt(count, 10) : 5;
    const minConf = minConfidence ? parseFloat(minConfidence) : undefined;

    const questions = await this.pdfService.getRandomQuizQuestions(
      jobId,
      countNum,
      minConf,
    );

    if (!questions) {
      throw new HttpException(
        'Job not found or not completed',
        HttpStatus.NOT_FOUND,
      );
    }

    return questions;
  }

  /**
   * Submit quiz attempt
   * POST /pdf/quiz/submit
   */
  @Post('quiz/submit')
  async submitQuizAttempt(
    @Body()
    body: {
      userName: string;
      userEmail: string;
      questionIds: string[];
      answers: Record<string, string>;
      questionTimings?: Record<string, { startedAt: string; answeredAt: string; durationSeconds: number }>;
      startedAt?: string;
    },
  ) {
    const { userName, userEmail, questionIds, answers, questionTimings, startedAt } = body;

    if (!userName || !userEmail || !questionIds || !answers) {
      throw new HttpException(
        'Missing required fields',
        HttpStatus.BAD_REQUEST,
      );
    }

    return await this.pdfService.submitQuizAttempt(
      userName,
      userEmail,
      questionIds,
      answers,
      questionTimings,
      startedAt,
    );
  }

  /**
   * Get all jobs
   * GET /pdf/jobs
   */
  @Get('jobs')
  async getAllJobs() {
    return await this.pdfService.getAllJobs();
  }

  /**
   * Upload answer PDF for a specific job
   * POST /pdf/jobs/:jobId/upload-answers
   */
  @Post('jobs/:jobId/upload-answers')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads',
        filename: (req, file, cb) => {
          const uniqueName = `answers-${uuidv4()}${path.extname(file.originalname)}`;
          cb(null, uniqueName);
        },
      }),
      fileFilter: (req, file, cb) => {
        if (file.mimetype !== 'application/pdf') {
          return cb(
            new HttpException('Only PDF files allowed', HttpStatus.BAD_REQUEST),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  async uploadAnswerPdf(
    @Param('jobId') jobId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('paperSection') paperSection?: string,
  ) {
    if (!file) {
      throw new HttpException('No file uploaded', HttpStatus.BAD_REQUEST);
    }

    // Verify job exists
    const job = await this.pdfService.getJobStatus(jobId);
    if (!job || job.status !== 'completed') {
      throw new HttpException(
        'Job not found or not completed yet',
        HttpStatus.BAD_REQUEST,
      );
    }

    this.logger.log(`Processing answer PDF for job ${jobId}: ${file.originalname}${paperSection ? ` (${paperSection})` : ''}`);

    return await this.pdfService.processAnswersPdf(jobId, file, paperSection);
  }

  /**
   * Get answer status for a job
   * GET /pdf/jobs/:jobId/answers-status
   */
  @Get('jobs/:jobId/answers-status')
  async getAnswersStatus(@Param('jobId') jobId: string) {
    const status = await this.pdfService.getAnswersStatus(jobId);

    if (!status) {
      throw new HttpException('Job not found', HttpStatus.NOT_FOUND);
    }

    return status;
  }

  /**
   * Generate AI answer for a specific question part
   * POST /pdf/questions/:questionId/parts/:partId/generate-answer
   */
  @Post('questions/:questionId/parts/:partId/generate-answer')
  async generateAiAnswer(
    @Param('questionId') questionId: string,
    @Param('partId') partId: string,
  ) {
    this.logger.log(`Generating AI answer for question ${questionId}, part ${partId}`);

    const result = await this.pdfService.generateAiAnswerForPart(questionId, partId);

    return {
      success: true,
      questionId,
      partId,
      answer: result.answer,
      message: 'AI answer generated successfully',
    };
  }

  /**
   * Bulk generate AI answers for all parts in a job without answers
   * POST /pdf/jobs/:jobId/generate-all-answers
   */
  @Post('jobs/:jobId/generate-all-answers')
  async generateAllAnswers(@Param('jobId') jobId: string) {
    this.logger.log(`Bulk generating AI answers for job ${jobId}`);

    const result = await this.pdfService.bulkGenerateAiAnswers(jobId);

    return {
      success: true,
      jobId,
      generated: result.generated,
      failed: result.failed,
      message: `Generated ${result.generated} AI answers`,
    };
  }

  /**
   * Get quiz questions (frontend endpoint)
   * GET /quiz/questions
   * Query params:
   *   - jobId: Job ID (optional, uses latest if not provided)
   *   - count: Number of questions (default 5)
   *   - minConfidence: Minimum diagram confidence (default 90)
   *   - difficulty: Filter by difficulty (easy, medium, hard - optional)
   *   - topic: Filter by topic (optional)
   */
  @Get('quiz/questions')
  async getQuizQuestionsForFrontend(
    @Query('jobId') jobId?: string,
    @Query('count') count?: string,
    @Query('minConfidence') minConfidence?: string,
    @Query('difficulty') difficulty?: string,
    @Query('topic') topic?: string,
  ) {
    const countNum = count ? parseInt(count, 10) : 5;
    const minConf = minConfidence ? parseFloat(minConfidence) : 90;

    // If no jobId provided, get the latest completed job with questions
    let actualJobId = jobId;
    if (!actualJobId) {
      const jobs = await this.pdfService.getAllJobs();
      const completedJobs = jobs.jobs.filter(j => j.status === 'completed');

      // Find the latest job that actually has questions stored
      for (const job of completedJobs) {
        const questions = await this.pdfService.getQuizQuestions(job.jobId);
        if (questions && questions.totalQuestions > 0) {
          actualJobId = job.jobId;
          break;
        }
      }

      if (!actualJobId) {
        throw new HttpException(
          'No completed jobs with questions found',
          HttpStatus.NOT_FOUND,
        );
      }
    }

    const questions = await this.pdfService.getRandomQuizQuestions(
      actualJobId,
      countNum,
      minConf,
      undefined, // Allow all difficulties (was: 'easy')
      topic,
    );

    if (!questions) {
      throw new HttpException(
        'Job not found or not completed',
        HttpStatus.NOT_FOUND,
      );
    }

    return questions;
  }

  /**
   * Start quiz
   * POST /pdf/quiz/start
   */
  @Post('quiz/start')
  async startQuiz(@Body() body: { userName?: string; userEmail?: string }) {
    return this.pdfService.startQuizAttempt(body.userName, body.userEmail);
  }

  /**
   * Submit quiz
   * POST /pdf/quiz/submit
   */
  @Post('quiz/submit')
  async submitQuiz(@Body() submitQuizDto: SubmitQuizDto) {
    const { userName, userEmail, questionIds, answers, attemptId, questionTimings, startedAt } = submitQuizDto;
    return this.pdfService.submitQuizAttempt(
      userName,
      userEmail,
      questionIds,
      answers,
      questionTimings,
      startedAt,
      attemptId,
    );
  }

  /**
   * Reshuffle questions
   * GET /pdf/quiz/reshuffle
   */
  @Get('quiz/replacement')
  async getReplacementQuestion(
    @Query('jobId') jobId: string,
    @Query('excludeIds') excludeIds: string,
  ) {
    if (!jobId) {
      throw new HttpException('Job ID is required', HttpStatus.BAD_REQUEST);
    }
    const excludedIds = excludeIds ? excludeIds.split(',') : [];
    const question = await this.pdfService.getReplacementQuestion(jobId, excludedIds);

    if (!question) {
      throw new HttpException('No replacement question available', HttpStatus.NOT_FOUND);
    }

    return question;
  }
  /**
   * Test email service directly
   * POST /pdf/test-email
   */
  @Post('test-email')
  async testEmailService(
    @Body() body: { userEmail: string; userName?: string },
  ) {
    const { userEmail, userName = 'Test User' } = body;

    if (!userEmail) {
      throw new HttpException('userEmail is required', HttpStatus.BAD_REQUEST);
    }

    // Mock quiz data for testing
    const quizData = {
      score: 8,
      totalMarks: 10,
      percentage: 80,
      correctAnswers: 8,
      wrongAnswers: 2,
      duration: 600,
    };

    // Create a simple mock PDF buffer
    const mockPdfBuffer = Buffer.from(
      '%PDF-1.4\n%Mock PDF for testing email attachment\n%%EOF',
      'utf-8',
    );

    // Import EmailService dynamically to avoid circular dependencies
    const { EmailService } = await import('../email/email.service');
    const emailService = new EmailService(this.configService);

    const result = await emailService.sendQuizResultsEmail(
      userEmail,
      userName,
      quizData,
      mockPdfBuffer,
      'test-quiz-results.pdf',
    );

    return {
      message: 'Email test completed',
      result,
    };
  }

  /**
   * Get quiz analytics
   * GET /pdf/analytics
   */
  @Get('analytics')
  async getAnalytics() {
    return await this.pdfService.getQuizAnalytics();
  }

  @Get('diagrams/:jobId')
  async getDiagramsForJob(@Param('jobId') jobId: string) {
    return this.pdfService.getDiagramsForJob(jobId);
  }

  @Post('diagrams/:diagramId/replace')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads',
        filename: (req, file, cb) => {
          const uniqueName = `diagram-replace-${uuidv4()}${path.extname(file.originalname)}`;
          cb(null, uniqueName);
        },
      }),
      fileFilter: (req, file, cb) => {
        if (!file.mimetype.match(/^image\/(jpg|jpeg|png)$/)) {
          return cb(
            new HttpException('Only image files (jpg, jpeg, png) are allowed!', HttpStatus.BAD_REQUEST),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  async replaceDiagram(
    @Param('diagramId') diagramId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new HttpException('No file uploaded', HttpStatus.BAD_REQUEST);
    }
    return this.pdfService.replaceDiagram(diagramId, file);
  }

  @Delete('diagrams/:diagramId')
  async deleteDiagram(@Param('diagramId') diagramId: string) {
    return this.pdfService.deleteDiagram(diagramId);
  }

  @Post('questions/:questionId/diagrams')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads',
        filename: (req, file, cb) => {
          const uniqueName = `diagram-add-${uuidv4()}${path.extname(file.originalname)}`;
          cb(null, uniqueName);
        },
      }),
      fileFilter: (req, file, cb) => {
        if (!file.mimetype.match(/^image\/(jpg|jpeg|png)$/)) {
          return cb(
            new HttpException('Only image files (jpg, jpeg, png) are allowed!', HttpStatus.BAD_REQUEST),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  async addDiagram(
    @Param('questionId') questionId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new HttpException('No file uploaded', HttpStatus.BAD_REQUEST);
    }
    return this.pdfService.addDiagram(questionId, file);
  }

  @Post('questions/:questionId/link-diagram/:diagramId')
  async linkDiagram(
    @Param('questionId') questionId: string,
    @Param('diagramId') diagramId: string,
  ) {
    return this.pdfService.linkDiagram(questionId, diagramId);
  }

  @Get('download/:jobId')
  async downloadOriginalPdf(
    @Param('jobId') jobId: string,
    @Res() res: Response,
  ) {
    const job = await this.pdfService.getJobStatus(jobId);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Get the full job object with originalPath
    const fullJob = await this.pdfService.getJobWithOriginalPath(jobId);

    if (!fullJob || !fullJob.originalPath) {
      return res.status(404).json({ error: 'PDF path not found' });
    }

    // Resolve the path - if it's relative, make it absolute from the project root
    const pdfPath = path.isAbsolute(fullJob.originalPath)
      ? fullJob.originalPath
      : path.join(process.cwd(), fullJob.originalPath);

    if (!fs.existsSync(pdfPath)) {
      this.logger.error(`PDF file not found at: ${pdfPath}`);
      return res.status(404).json({ error: 'PDF file not found on server' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fullJob.filename}"`);

    const stream = fs.createReadStream(pdfPath);
    stream.pipe(res);
  }

  @Patch('question-part/:partId/answer')
  async updateQuestionAnswer(
    @Param('partId') partId: string,
    @Body() body: { options?: any[]; correctOption?: number | string; sampleAnswer?: string },
  ) {
    return this.pdfService.updateQuestionAnswer(partId, body.options, body.correctOption, body.sampleAnswer);
  }
}


