import { Injectable, Logger } from '@nestjs/common';
import * as puppeteer from 'puppeteer';

interface QuizResult {
  questionId: string;
  questionText: string;
  isCorrect: boolean;
  userAnswer?: string;
  correctAnswer?: string;
  marks: number;
}

interface PracticeQuestion {
  id: string;
  topic: string;
  text: string;
  level: string;
  marks: number;
  explanation?: string;
}

@Injectable()
export class PdfGeneratorService {
  private readonly logger = new Logger(PdfGeneratorService.name);

  async generateQuizResultsPdf(
    userName: string,
    quizResults: QuizResult[],
    practiceQuestions: PracticeQuestion[],
    score: number,
    totalMarks: number,
  ): Promise<Buffer> {
    let browser;
    try {
      this.logger.log(`Generating HTML-based PDF for ${userName}`);

      // 1. Launch Browser
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'], // Required for many server/docker environments
      });

      const page = await browser.newPage();

      // 2. Generate HTML Content
      const htmlContent = this.generateHtml(
        userName,
        quizResults,
        practiceQuestions,
        score,
        totalMarks,
      );

      // 3. Set content and wait for render
      await page.setContent(htmlContent, {
        waitUntil: 'networkidle0',
      });

      // 4. Generate PDF
      // We use displayHeaderFooter to handle page numbers automatically
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true, // Ensures background colors (like the score boxes) show up
        margin: {
          top: '60px',
          bottom: '60px', // Space for footer
          left: '50px',
          right: '50px',
        },
        displayHeaderFooter: true,
        headerTemplate: '<div></div>', // Empty header
        footerTemplate: `
          <div style="font-size: 10px; width: 100%; text-align: center; color: #ccc; font-family: Helvetica, sans-serif;">
            Page <span class="pageNumber"></span> of <span class="totalPages"></span> 
            <br/> 
            © 2025 Mathlobby All rights reserved.
          </div>
        `,
      });

      this.logger.log(`PDF generated successfully: ${pdfBuffer.length} bytes`);
      return Buffer.from(pdfBuffer);
    } catch (error) {
      this.logger.error(`Error generating PDF: ${error.message}`, error.stack);
      throw error;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  /**
   * Constructs the full HTML string with CSS
   */
  private generateHtml(
    userName: string,
    results: QuizResult[],
    practiceQuestions: PracticeQuestion[],
    score: number,
    totalMarks: number,
  ): string {
    const percentage = Math.round((score / totalMarks) * 100);
    const correctAnswers = results.filter((r) => r.isCorrect).length;
    const wrongAnswers = results.length - correctAnswers;

    const date = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    // Prepare Practice Questions HTML
    let practiceSectionHtml = '';
    if (practiceQuestions.length > 0) {
      const grouped = this.groupBy(practiceQuestions, 'topic');

      practiceSectionHtml += `
        <div class="section-title">Practice Questions</div>
        <p class="subtitle">These questions are tailored to help you improve on topics you found challenging.</p>
      `;

      for (const [topic, questions] of Object.entries(grouped)) {
        practiceSectionHtml += `
          <div class="topic-block">
            <div class="topic-header">Topic: ${topic}</div>
            <div class="questions-list">
              ${questions
            .map(
              (q, i) => `
                  <div class="question-item">
                    <div class="question-text"><strong>${i + 1}.</strong> ${q.text}</div>
                  </div>
                `,
            )
            .join('')}
            </div>
          </div>
        `;
      }
    }

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body {
            font-family: 'Helvetica', 'Arial', sans-serif;
            color: #333;
            line-height: 1.5;
          }
          
          /* Header */
          .header {
            text-align: center;
            border-bottom: 1px solid #eee;
            padding-bottom: 20px;
            margin-bottom: 30px;
          }
          .title {
            font-size: 24px;
            font-weight: bold;
            margin-bottom: 5px;
          }
          .student-name {
            font-size: 14px;
            color: #666;
          }
          .date {
            font-size: 12px;
            color: #999;
            margin-top: 5px;
          }

          /* Score Summary */
          .score-section {
            text-align: center;
            margin-bottom: 40px;
          }
          .percentage {
            font-size: 48px;
            font-weight: bold;
            color: #667eea;
            margin: 10px 0;
          }
          .score-text {
            font-size: 14px;
            color: #555;
            margin-bottom: 20px;
          }

          /* Stats Grid (Flexbox) */
          .stats-grid {
            display: flex;
            justify-content: center;
            gap: 20px;
          }
          .stat-box {
            width: 140px;
            padding: 15px;
            border-radius: 8px;
            border: 1px solid;
            text-align: center;
          }
          
          .box-correct { border-color: #10b981; color: #10b981; }
          .box-wrong { border-color: #ef4444; color: #ef4444; }
          .box-total { border-color: #f59e0b; color: #f59e0b; }

          .stat-number {
            font-size: 20px;
            font-weight: bold;
            display: block;
          }
          .stat-label {
            font-size: 12px;
            text-transform: uppercase;
          }

          /* Practice Questions */
          .section-title {
            font-size: 18px;
            font-weight: bold;
            text-decoration: underline;
            margin-bottom: 10px;
          }
          .subtitle {
            font-size: 12px;
            color: #666;
            margin-bottom: 20px;
          }
          
          .topic-block {
            margin-bottom: 25px;
            /* Important: Avoid breaking a topic header from its first question */
            break-inside: avoid; 
          }
          .topic-header {
            font-weight: bold;
            color: #667eea;
            font-size: 14px;
            margin-bottom: 10px;
            border-bottom: 1px solid #eee;
            display: inline-block;
          }
          
          .question-item {
            margin-bottom: 15px;
            /* prevent splitting a single question across pages */
            break-inside: avoid; 
          }
          .question-text {
            font-size: 12px;
            color: #333;
          }
          .marks {
            font-size: 10px;
            color: #999;
            margin-top: 2px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="title">Quiz Results Report</div>
          <div class="student-name">Student: ${userName}</div>
          <div class="date">Generated: ${date}</div>
        </div>

        <div class="score-section">
          <div class="section-title" style="text-decoration:none; border-bottom: 2px solid #333; display:inline-block; margin-bottom:15px;">Your Performance</div>
          <div class="percentage">${percentage}%</div>
          <div class="score-text">Score: ${correctAnswers}/${results.length} questions correct</div>

          <div class="stats-grid">
            <div class="stat-box box-correct">
              <span class="stat-number">${correctAnswers}</span>
              <span class="stat-label">Correct</span>
            </div>
            <div class="stat-box box-wrong">
              <span class="stat-number">${wrongAnswers}</span>
              <span class="stat-label">Incorrect</span>
            </div>
            <div class="stat-box box-total">
              <span class="stat-number">${results.length}</span>
              <span class="stat-label">Total</span>
            </div>
          </div>
        </div>

        ${practiceSectionHtml}

      </body>
      </html>
    `;
  }

  private groupBy<T>(array: T[], key: keyof T): Record<string, T[]> {
    return array.reduce((result, item) => {
      const groupKey = String(item[key]);
      if (!result[groupKey]) {
        result[groupKey] = [];
      }
      result[groupKey].push(item);
      return result;
    }, {} as Record<string, T[]>);
  }
}