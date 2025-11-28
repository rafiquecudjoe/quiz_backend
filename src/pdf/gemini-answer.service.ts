import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

@Injectable()
export class GeminiAnswerService {
    private readonly logger = new Logger(GeminiAnswerService.name);
    private readonly genAI: GoogleGenerativeAI;
    private readonly model: any;

    constructor(private readonly configService: ConfigService) {
        const apiKey = this.configService.get<string>('GEMINI_API_KEY');
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY is not set');
        }
        this.genAI = new GoogleGenerativeAI(apiKey);
        this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
    }

    /**
     * Generate step-by-step answer using Gemini
     */
    async generateStepByStepAnswer(
        questionText: string,
        sampleAnswer?: string,
        explanation?: string,
        hints?: string[],
    ): Promise<string> {
        try {
            const prompt = this.buildPrompt(questionText, sampleAnswer, explanation, hints);

            this.logger.log(`Generating AI answer for: ${questionText.substring(0, 50)}...`);

            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            const generatedAnswer = response.text();

            this.logger.log('AI answer generated successfully');

            return this.formatAnswer(generatedAnswer);
        } catch (error) {
            this.logger.error(`Error generating AI answer: ${error.message}`);
            return this.fallbackAnswer(sampleAnswer, explanation);
        }
    }

    /**
     * Build prompt for Gemini
     */
    private buildPrompt(
        questionText: string,
        sampleAnswer?: string,
        explanation?: string,
        hints?: string[],
    ): string {
        let prompt = `You are a mathematics teacher creating step-by-step solutions for Secondary 2 students.

Question: ${questionText}

`;

        if (sampleAnswer) {
            prompt += `Sample Answer: ${sampleAnswer}\n\n`;
        }

        if (explanation) {
            prompt += `Explanation: ${explanation}\n\n`;
        }

        if (hints && hints.length > 0) {
            prompt += `Hints:\n${hints.map((h, i) => `${i + 1}. ${h}`).join('\n')}\n\n`;
        }

        prompt += `Generate a clear, detailed step-by-step solution following this format:

Step 1: [Describe what you're doing]
[Show the work]

Step 2: [Describe the next step]
[Show the work]

...

**Final Answer:** [Clear, concise final answer]

Requirements:
- Number each step (Step 1, Step 2, etc.)
- Explain what you're doing in each step
- Show all mathematical work
- Use proper mathematical notation
- Keep steps concise but complete
- End with "**Final Answer:**" followed by the answer
- If the answer involves fractions, keep them in simplified form
- If solving equations, show each algebraic manipulation

Generate ONLY the solution steps, no additional commentary.`;

        return prompt;
    }

    /**
     * Format the generated answer
     */
    private formatAnswer(generatedText: string): string {
        // Clean up the response
        let formatted = generatedText.trim();

        // Ensure proper step numbering
        formatted = formatted.replace(/^(\d+)\./gm, 'Step $1:');

        // Ensure **Final Answer:** format
        if (!formatted.includes('**Final Answer:**')) {
            // Try to find answer patterns
            const answerPatterns = [
                /(?:Answer|Solution|Result):\s*(.+?)$/im,
                /Therefore,?\s+(.+?)$/im,
                /Thus,?\s+(.+?)$/im,
            ];

            for (const pattern of answerPatterns) {
                const match = formatted.match(pattern);
                if (match) {
                    formatted = formatted.replace(pattern, `**Final Answer:** ${match[1]}`);
                    break;
                }
            }
        }

        return formatted;
    }

    /**
     * Fallback answer if Gemini fails
     */
    private fallbackAnswer(sampleAnswer?: string, explanation?: string): string {
        const parts: string[] = [];

        if (explanation) {
            parts.push(`Step 1: ${explanation}`);
        }

        if (sampleAnswer) {
            parts.push(`**Final Answer:** ${sampleAnswer}`);
        }

        return parts.join('\n\n') || 'Answer not available';
    }
}
