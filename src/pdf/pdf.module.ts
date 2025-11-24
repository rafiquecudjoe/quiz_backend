import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { diskStorage } from 'multer';
import { extname } from 'path';
import * as fs from 'fs';
import { PdfController } from './pdf.controller';
import { PdfService } from './pdf.service';
import { PythonExecutorService } from './python-executor.service';
import { PdfGeneratorService } from './pdf-generator.service';
import { QuizAnalysisService } from './quiz-analysis.service';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    MulterModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const uploadDir = configService.get('UPLOAD_DIR') || './uploads';
        
        // Ensure upload directory exists
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }

        return {
          storage: diskStorage({
            destination: uploadDir,
            filename: (req, file, callback) => {
              const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
              const ext = extname(file.originalname);
              callback(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
            },
          }),
          fileFilter: (req, file, callback) => {
            if (file.mimetype !== 'application/pdf') {
              return callback(new Error('Only PDF files are allowed!'), false);
            }
            callback(null, true);
          },
          limits: {
            fileSize: configService.get('MAX_FILE_SIZE') || 52428800, // 50MB default
          },
        };
      },
      inject: [ConfigService],
    }),
    EmailModule,
  ],
  controllers: [PdfController],
  providers: [PdfService, PythonExecutorService, PdfGeneratorService, QuizAnalysisService],
})
export class PdfModule {}

