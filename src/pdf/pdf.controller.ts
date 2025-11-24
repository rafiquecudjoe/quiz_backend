import {
  Controller,
  Post,
  Get,
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
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PdfService } from './pdf.service';
import { diskStorage } from 'multer';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import { SubmitQuizDto } from './dto/submit-quiz.dto';
import { ConfigService } from '@nestjs/config';

@Controller('pdf')
export class PdfController {
  private readonly logger = new Logger(PdfController.name);

  constructor(
    private readonly pdfService: PdfService,
    private readonly configService: ConfigService,
  ) {}

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
   * Get all quiz questions for a job (transformed for frontend)
   * GET /pdf/jobs/:jobId/questions
   * Query params:
   *   - minConfidence: Minimum diagram confidence (default from config)
   */
  @Get('jobs/:jobId/questions')
  async getQuizQuestions(
    @Param('jobId') jobId: string,
    @Query('minConfidence') minConfidence?: string,
  ) {
    const minConf = minConfidence ? parseFloat(minConfidence) : undefined;
    const questions = await this.pdfService.getQuizQuestions(jobId, minConf);

    if (!questions) {
      throw new HttpException(
        'Job not found or not completed',
        HttpStatus.NOT_FOUND,
      );
    }

    return questions;
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
    },
  ) {
    const { userName, userEmail, questionIds, answers } = body;

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
      difficulty,
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
   * Submit quiz
   * POST /pdf/quiz/submit
   */
  @Post('quiz/submit')
  async submitQuiz(@Body() submitQuizDto: SubmitQuizDto) {
    const { userName, userEmail, questionIds, answers } = submitQuizDto;
    return this.pdfService.submitQuizAttempt(
      userName,
      userEmail,
      questionIds,
      answers,
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
    return this.pdfService.getReplacementQuestion(jobId, excludedIds);
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
}


