import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import * as fs from 'fs';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private resend: Resend | undefined;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get('RESEND_API_KEY');
    if (!apiKey) {
      this.logger.warn('RESEND_API_KEY not configured - email service will be disabled');
      this.resend = undefined;
    } else {
      this.resend = new Resend(apiKey);
    }
  }

  /**
   * Send quiz results email with PDF attachment
   */
  async sendQuizResultsEmail(
    userEmail: string,
    userName: string,
    quizData: {
      score: number;
      totalMarks: number;
      percentage: number;
      correctAnswers: number;
      wrongAnswers: number;
      duration?: number;
    },
    pdfBuffer: Buffer,
    pdfFilename: string = 'quiz-results.pdf',
  ): Promise<any> {
    try {
      // Check if API key is configured
      if (!this.configService.get('RESEND_API_KEY')) {
        this.logger.warn('Email sending is disabled - RESEND_API_KEY not configured');
        return {
          success: false,
          message: 'Email service not configured',
        };
      }

      const fromEmail = this.configService.get('RESEND_FROM_EMAIL') || 'noreply@exams.example.com';
      
      const percentage = Math.round(quizData.percentage);
      const performance = this.getPerformanceMessage(percentage);

      if (!this.resend) {
        this.logger.warn('Resend client not initialized - cannot send email');
        return {
          success: false,
          message: 'Email service not configured',
        };
      }
      const response = await this.resend.emails.send({
        from: fromEmail,
        to: userEmail,
        subject: `Quiz Results - Congratulations ${userName}! 🎉`,
        html: this.generateQuizResultsHTML(userName, quizData, performance),
        attachments: [
          {
            filename: pdfFilename,
            content: pdfBuffer,
            contentType: 'application/pdf',
          },
        ],
      });

      if (response.error) {
        this.logger.error(`Failed to send email to ${userEmail}: ${response.error.message}`);
        return {
          success: false,
          error: response.error,
        };
      }

      this.logger.log(`✅ Quiz results email sent to ${userEmail} (Resend ID: ${response.data.id})`);
      return {
        success: true,
        emailId: response.data.id,
      };
    } catch (error) {
      this.logger.error(`Error sending email: ${error.message}`, error.stack);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Send practice questions email
   */
  async sendPracticeQuestionsEmail(
    userEmail: string,
    userName: string,
    practiceQuestionsData: any,
  ): Promise<any> {
    try {
      if (!this.configService.get('RESEND_API_KEY')) {
        this.logger.warn('Email sending is disabled - RESEND_API_KEY not configured');
        return { success: false, message: 'Email service not configured' };
      }

      const fromEmail = this.configService.get('RESEND_FROM_EMAIL') || 'noreply@exams.example.com';

      if (!this.resend) {
        this.logger.warn('Resend client not initialized - cannot send email');
        return { success: false, message: 'Email service not configured' };
      }
      const response = await this.resend.emails.send({
        from: fromEmail,
        to: userEmail,
        subject: `Practice Questions to Improve - Keep Learning! 📚`,
        html: this.generatePracticeQuestionsHTML(userName, practiceQuestionsData),
      });

      if (response.error) {
        this.logger.error(`Failed to send practice questions email to ${userEmail}: ${response.error.message}`);
        return { success: false, error: response.error };
      }

      this.logger.log(`✅ Practice questions email sent to ${userEmail}`);
      return { success: true, emailId: response.data.id };
    } catch (error) {
      this.logger.error(`Error sending practice questions email: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get performance message based on percentage
   */
  private getPerformanceMessage(percentage: number): string {
    if (percentage >= 90) {
      return 'Outstanding! You demonstrated excellent understanding of the material.';
    } else if (percentage >= 80) {
      return 'Great job! You have a strong grasp of the concepts.';
    } else if (percentage >= 70) {
      return 'Good effort! You\'re on the right track. Keep practicing to improve further.';
    } else if (percentage >= 60) {
      return 'You\'re making progress! Review the practice questions below to strengthen your understanding.';
    } else {
      return 'Don\'t get discouraged! Learning takes practice. Focus on the practice questions to improve.';
    }
  }

  /**
   * Generate HTML for quiz results email
   */
  private generateQuizResultsHTML(
    userName: string,
    quizData: {
      score: number;
      totalMarks: number;
      percentage: number;
      correctAnswers: number;
      wrongAnswers: number;
      duration?: number;
    },
    performance: string,
  ): string {
    const { score, totalMarks, percentage, correctAnswers, wrongAnswers, duration } = quizData;
    const percentage_rounded = Math.round(percentage);
    const scoreBarColor = percentage_rounded >= 80 ? '#10b981' : percentage_rounded >= 60 ? '#f59e0b' : '#ef4444';

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #333; line-height: 1.6; }
            .container { max-width: 600px; margin: 0 auto; background: #f9fafb; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 8px 8px 0 0; text-align: center; }
            .header h1 { margin: 0; font-size: 28px; font-weight: 700; }
            .content { background: white; padding: 30px; }
            .score-section { text-align: center; margin: 30px 0; }
            .score-display { font-size: 48px; font-weight: 700; color: ${scoreBarColor}; }
            .score-label { color: #6b7280; font-size: 14px; margin-top: 10px; }
            .score-bar { background: #e5e7eb; height: 10px; border-radius: 5px; margin: 20px 0; overflow: hidden; }
            .score-bar-fill { background: ${scoreBarColor}; height: 100%; width: ${percentage_rounded}%; }
            .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 20px 0; }
            .stat { background: #f3f4f6; padding: 15px; border-radius: 8px; text-align: center; }
            .stat-value { font-size: 24px; font-weight: 700; color: #667eea; }
            .stat-label { color: #6b7280; font-size: 14px; margin-top: 5px; }
            .message { background: #f0fdf4; border-left: 4px solid #10b981; padding: 15px; border-radius: 4px; margin: 20px 0; }
            .message p { margin: 0; color: #166534; }
            .cta-button { display: inline-block; background: #667eea; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; margin-top: 20px; font-weight: 600; }
            .footer { background: #f9fafb; padding: 20px; text-align: center; color: #6b7280; font-size: 12px; border-radius: 0 0 8px 8px; }
            .badge { display: inline-block; background: #fef3c7; color: #92400e; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; margin: 10px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🎉 Quiz Complete!</h1>
              <p>Great work, ${userName}!</p>
            </div>
            
            <div class="content">
              <p>Thank you for taking the quiz. Here's a summary of your performance:</p>
              
              <div class="score-section">
                <div class="score-display">${percentage_rounded}%</div>
                <div class="score-label">Your Score</div>
                <div class="score-bar">
                  <div class="score-bar-fill"></div>
                </div>
                <div class="badge">${score}/${totalMarks} Marks</div>
              </div>
              
              <div class="stats">
                <div class="stat">
                  <div class="stat-value">${correctAnswers}</div>
                  <div class="stat-label">Correct Answers</div>
                </div>
                <div class="stat">
                  <div class="stat-value">${wrongAnswers}</div>
                  <div class="stat-label">Incorrect Answers</div>
                </div>
              </div>
              
              ${duration ? `<div class="stat" style="grid-column: 1 / -1;">
                <div class="stat-value">${Math.round(duration / 60)}</div>
                <div class="stat-label">Minutes Taken</div>
              </div>` : ''}
              
              <div class="message">
                <p><strong>Your Performance:</strong> ${performance}</p>
              </div>
              
              <h2 style="margin-top: 30px; margin-bottom: 15px;">📚 Next Steps</h2>
              <p>We've included a detailed PDF report with your results and personalized practice questions based on the topics you found challenging. Download the PDF to review:</p>
              
              <ul>
                <li><strong>Your Results Summary</strong> - Detailed breakdown of your performance</li>
                <li><strong>Practice Questions</strong> - Questions to help you improve on weak areas</li>
                <li><strong>Study Tips</strong> - Personalized recommendations for your learning journey</li>
              </ul>
              
              <p style="color: #6b7280; font-size: 14px; margin-top: 20px;">
                <strong>📎 Attachment:</strong> Your results are attached as a PDF. You can download and save it for your records.
              </p>
            </div>
            
            <div class="footer">
              <p>This is an automated email. Please do not reply to this message.</p>
              <p>&copy; 2025 Maths Exams. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  /**
   * Generate HTML for practice questions email
   */
  private generatePracticeQuestionsHTML(userName: string, practiceData: any): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #333; }
            .container { max-width: 600px; margin: 0 auto; background: #f9fafb; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 8px 8px 0 0; text-align: center; }
            .content { background: white; padding: 30px; }
            .topic-section { background: #f3f4f6; padding: 15px; border-radius: 8px; margin: 15px 0; }
            .topic-title { font-weight: 700; color: #667eea; }
            .footer { background: #f9fafb; padding: 20px; text-align: center; color: #6b7280; font-size: 12px; border-radius: 0 0 8px 8px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>📚 Practice Questions for You</h1>
              <p>Let's improve together, ${userName}!</p>
            </div>
            
            <div class="content">
              <p>Based on your quiz performance, we've prepared practice questions on topics you found challenging:</p>
              
              <div class="topic-section">
                <p class="topic-title">🎯 Topics to Focus On:</p>
                <p>${practiceData.topics?.join(', ') || 'Various topics'}</p>
              </div>
              
              <p>Keep practicing, and you'll see improvement! Remember: consistent practice is the key to mastery.</p>
              
              <p style="margin-top: 30px; font-weight: 600;">Happy Learning! 🚀</p>
            </div>
            
            <div class="footer">
              <p>This is an automated email. Please do not reply to this message.</p>
              <p>&copy; 2025 Maths Exams. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;
  }
}
