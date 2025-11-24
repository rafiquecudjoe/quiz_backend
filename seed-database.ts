import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PdfService } from './src/pdf/pdf.service';
import { PrismaService } from './src/prisma/prisma.service';
import { MinioService } from './src/minio/minio.service';
import * as fs from 'fs';
import * as path from 'path';

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
}

async function seedDatabase() {
  console.log('🚀 Starting database seeding...');

  const app = await NestFactory.createApplicationContext(AppModule);
  const pdfService = app.get(PdfService);
  const prisma = app.get(PrismaService);
  const minioService = app.get(MinioService);

  try {
    // Read enriched questions from bbc-main
    const enrichedQuestionsPath = '/home/rafique/Documents/maths-exams/bbc-main/public/enriched_questions.json';

    if (!fs.existsSync(enrichedQuestionsPath)) {
      throw new Error(`Enriched questions file not found: ${enrichedQuestionsPath}`);
    }

    console.log('📖 Reading enriched questions...');
    const enrichedData: EnrichedQuestionData = JSON.parse(
      fs.readFileSync(enrichedQuestionsPath, 'utf-8')
    );

    console.log(`📊 Found ${enrichedData.enriched_questions.length} questions to seed`);

    // Create a fake job ID for seeding
    const seedJobId = 'seed-job-' + Date.now();

    // Create processing job record
    console.log('💾 Creating processing job record...');
    await prisma.processingJob.create({
      data: {
        jobId: seedJobId,
        pdfHash: `seed-hash-${Date.now()}`,
        filename: enrichedData.document_info.filename,
        originalPath: '/seed/path',
        status: 'completed',
        batchSize: 1,
        totalPages: enrichedData.document_info.total_pages,
        apiCallsUsed: enrichedData.document_info.api_calls_used,
        totalQuestions: enrichedData.document_info.total_questions,
        resultData: enrichedData as any,
      },
    });

    console.log('🔄 Processing questions and uploading diagrams...');

    let processedQuestions = 0;
    let uploadedDiagrams = 0;

    for (const enrichedQ of enrichedData.enriched_questions) {
      console.log(`\n📝 Processing question ${enrichedQ.question_num}...`);

      // Process diagrams - convert local paths to actual file paths
      const processedDiagrams: DiagramData[] = [];

      for (const diag of enrichedQ.diagrams) {
        const diagramPath = path.join(
          '/home/rafique/Documents/maths-exams/bbc-main/public/diagrams',
          path.basename(diag.local_path)
        );

        if (fs.existsSync(diagramPath)) {
          // Calculate confidence score (mock for seeding)
          const confidence = diag.confidence || 95; // High confidence for seeded data

          processedDiagrams.push({
            ...diag,
            local_path: diagramPath,
            confidence: confidence,
          });
        } else {
          console.warn(`⚠️  Diagram file not found: ${diagramPath}`);
        }
      }

      // Filter diagrams by confidence (reuse existing logic)
      const filteredDiagrams = processedDiagrams.filter((diag) => {
        return (diag.confidence || 0) >= 90; // Use 90% threshold
      });

      console.log(`📊 Question ${enrichedQ.question_num}: ${filteredDiagrams.length}/${processedDiagrams.length} diagrams passed confidence filter`);

      // Upload diagrams to MinIO
      const uploadedDiagramsData: any[] = [];
      for (const diag of filteredDiagrams) {
        try {
          const uploadResult = await minioService.uploadDiagram(
            seedJobId,
            diag.local_path,
            diag.page_number,
            uploadedDiagramsData.length
          );

          uploadedDiagramsData.push({
            pageNumber: diag.page_number,
            minioUrl: uploadResult.url,
            minioKey: uploadResult.key,
            fileName: path.basename(diag.local_path),
            contentType: uploadResult.contentType,
            fileSize: diag.file_size,
            source: diag.source || 'seeded',
            confidence: diag.confidence || null,
            area: diag.area || null,
            density: diag.density || null,
            bbox: null,
          });

          uploadedDiagrams++;
          console.log(`✅ Uploaded diagram: ${path.basename(diag.local_path)} → ${uploadResult.url}`);
        } catch (error) {
          console.error(`❌ Failed to upload diagram ${path.basename(diag.local_path)}: ${error.message}`);
        }
      }

      // Create main question record
      const question = await prisma.question.create({
        data: {
          jobId: seedJobId,
          questionNum: enrichedQ.question_num,
          pageNumber: enrichedQ.page_number,
          questionText: enrichedQ.question_text || '', // Provide empty string if null
          topic: enrichedQ.topic,
          chapter: enrichedQ.chapter,
          subject: enrichedQ.subject || 'Mathematics',
          schoolLevel: enrichedQ.school_level,
          difficulty: enrichedQ.difficulty,
          questionType: enrichedQ.question_type,
          timeEstimateMinutes: enrichedQ.time_estimate_minutes,
          learningOutcomes: enrichedQ.learning_outcomes,
          keywords: enrichedQ.keywords,
          prerequisiteTopics: enrichedQ.prerequisite_topics,
          commonMistakes: enrichedQ.common_mistakes,
          totalMarks: enrichedQ.marks,
          status: enrichedQ.status || 'published',
          isVerified: enrichedQ.is_verified || true,
        },
      });

      // Create question parts
      const difficultyMarks = {
        'easy': 1,
        'medium': 2,
        'hard': 3,
      };
      const defaultMarks = difficultyMarks[enrichedQ.difficulty.toLowerCase()] || 2;

      for (const part of enrichedQ.parts) {
        const partMarks = part.marks || defaultMarks;

        await prisma.questionPart.create({
          data: {
            questionId: question.id,
            partLabel: part.part || '', // Provide empty string if null
            questionText: part.question_text,
            marks: partMarks,
            sampleAnswer: part.sample_answer,
            explanation: part.explanation,
            hints: part.hints,
            options: part.options && part.options.length > 0 ? part.options : null,
            correctOption: part.correct_option,
          },
        });
      }

      // Create diagram records
      for (const diag of uploadedDiagramsData) {
        await prisma.diagram.create({
          data: {
            questionId: question.id,
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

      processedQuestions++;
      console.log(`✅ Stored question ${enrichedQ.question_num} with ${enrichedQ.parts.length} parts and ${uploadedDiagramsData.length} diagrams`);
    }

    console.log('\n🎉 Database seeding completed!');
    console.log(`📊 Summary:`);
    console.log(`   - Questions processed: ${processedQuestions}`);
    console.log(`   - Diagrams uploaded: ${uploadedDiagrams}`);
    console.log(`   - Job ID: ${seedJobId}`);

    console.log('\n🔍 You can now test the API:');
    console.log(`   GET /quiz/questions?jobId=${seedJobId}&count=5`);

  } catch (error) {
    console.error('❌ Seeding failed:', error);
    throw error;
  } finally {
    await app.close();
  }
}

// Run the seeding script
seedDatabase().catch((error) => {
  console.error('💥 Script failed:', error);
  process.exit(1);
});