import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';

interface AnswerPart {
    part: string;
    steps: string[];
    final_answer: string;
    marks: number;
    has_diagram: boolean;
}

interface ParsedAnswer {
    question_num: string;
    parts: AnswerPart[];
}

interface ParsedAnswersData {
    document_info: {
        filename: string;
        total_pages: number;
        api_calls_used: number;
        total_answers: number;
        processing_complete: boolean;
    };
    answers: ParsedAnswer[];
}

@Injectable()
export class AnswerLinkingService {
    private readonly logger = new Logger(AnswerLinkingService.name);

    constructor(private readonly prisma: PrismaService) { }

    /**
     * Link parsed answers to questions in database
     */
    async linkAnswersToQuestions(
        jobId: string,
        answersData: ParsedAnswersData,
        paperSection?: string,
    ): Promise<{ linked: number; failed: number; aiGenerated: number }> {
        this.logger.log(`Linking answers to questions for job ${jobId}${paperSection ? ` (${paperSection})` : ''}`);

        let linked = 0;
        let failed = 0;
        let aiGenerated = 0;

        // Get all questions for this job
        const questions = await this.prisma.question.findMany({
            where: { jobId },
            include: { parts: true },
        });

        this.logger.log(`Found ${questions.length} questions for job ${jobId}`);

        // Filter answers by paper section if specified
        let answersToProcess = answersData.answers;
        if (paperSection) {
            answersToProcess = answersData.answers.filter(
                (answer: any) => answer.paper_section === paperSection
            );
            this.logger.log(`Filtered to ${answersToProcess.length} answers for ${paperSection}`);
        }

        // Process each answer
        for (const answer of answersToProcess) {
            const questionNum = this.normalizeQuestionNum(answer.question_num);

            // Find matching question by questionNum
            const matchingQuestion = questions.find(
                (q) => this.normalizeQuestionNum(q.questionNum) === questionNum,
            );

            if (!matchingQuestion) {
                this.logger.warn(
                    `No matching question found for answer Q${answer.question_num}`,
                );
                failed++;
                continue;
            }

            // Link each part
            for (const answerPart of answer.parts) {
                const partLabel = this.normalizePartLabel(answerPart.part);

                // Find matching question part
                const matchingPart = matchingQuestion.parts.find(
                    (p) => this.normalizePartLabel(p.partLabel) === partLabel,
                );

                if (!matchingPart) {
                    // Try to match by index if no part label match
                    const partIndex = answer.parts.indexOf(answerPart);
                    const fallbackPart = matchingQuestion.parts[partIndex];

                    if (fallbackPart) {
                        await this.updateQuestionPartWithAnswer(
                            fallbackPart.id,
                            answerPart,
                            'official_pdf',
                        );
                        linked++;
                        this.logger.log(
                            `✓ Linked answer Q${answer.question_num}${answerPart.part} to part by index`,
                        );
                    } else {
                        this.logger.warn(
                            `No matching part for Q${answer.question_num}${answerPart.part}`,
                        );
                        failed++;
                    }
                } else {
                    await this.updateQuestionPartWithAnswer(
                        matchingPart.id,
                        answerPart,
                        'official_pdf',
                    );
                    linked++;
                    this.logger.log(
                        `✓ Linked answer Q${answer.question_num}${answerPart.part}`,
                    );
                }
            }
        }

        // Generate AI fallback answers for parts without official answers
        const partsWithoutAnswers = await this.prisma.questionPart.findMany({
            where: {
                question: { jobId },
                stepByStepAnswer: null,
            },
            include: {
                question: true,
            },
        });

        this.logger.log(
            `Generating AI fallback answers for ${partsWithoutAnswers.length} parts`,
        );

        for (const part of partsWithoutAnswers) {
            try {
                const aiAnswer = await this.generateAiFallbackAnswer(part);
                await this.prisma.questionPart.update({
                    where: { id: part.id },
                    data: {
                        stepByStepAnswer: aiAnswer,
                        answerSource: 'ai_generated',
                    },
                });
                aiGenerated++;
                this.logger.log(
                    `✓ Generated AI answer for Q${part.question.questionNum}${part.partLabel}`,
                );
            } catch (error) {
                this.logger.error(
                    `Failed to generate AI answer for part ${part.id}: ${error.message}`,
                );
            }
        }

        return { linked, failed, aiGenerated };
    }

    /**
     * Update question part with parsed answer
     */
    private async updateQuestionPartWithAnswer(
        partId: string,
        answerPart: AnswerPart,
        source: string,
    ): Promise<void> {
        // Format steps as readable text
        const formattedAnswer = this.formatStepByStepAnswer(answerPart);

        await this.prisma.questionPart.update({
            where: { id: partId },
            data: {
                stepByStepAnswer: formattedAnswer,
                answerSource: source,
                // Don't update marks - they're already set on the question part
            },
        });
    }

    /**
     * Format answer parts into readable step-by-step text
     */
    private formatStepByStepAnswer(answerPart: AnswerPart): string {
        let formatted = '';

        // Add steps
        if (answerPart.steps && answerPart.steps.length > 0) {
            formatted += answerPart.steps.join('\n\n') + '\n\n';
        }

        // Add final answer
        if (answerPart.final_answer) {
            formatted += `**Final Answer:** ${answerPart.final_answer}`;
        }

        return formatted.trim();
    }

    /**
     * Generate AI fallback answer using existing sample answer and explanation
     */
    private async generateAiFallbackAnswer(
        part: any,
    ): Promise<string> {
        // Use existing sample answer and explanation
        const steps: string[] = [];

        if (part.explanation) {
            steps.push(part.explanation);
        }

        if (part.sampleAnswer) {
            steps.push(`**Answer:** ${part.sampleAnswer}`);
        }

        if (part.hints && part.hints.length > 0) {
            steps.push(`**Hints:**\n${part.hints.map((h, i) => `${i + 1}. ${h}`).join('\n')}`);
        }

        return steps.join('\n\n') || 'Answer not available';
    }

    /**
     * Normalize question number for matching (e.g., "1", "01", "Q1" -> "1")
     */
    private normalizeQuestionNum(num: string): string {
        return num.replace(/[^\d]/g, '');
    }

    /**
     * Normalize part label for matching (e.g., "(a)", "a", "A" -> "a")
     */
    private normalizePartLabel(label: string): string {
        if (!label) return '';
        return label.replace(/[^\w]/g, '').toLowerCase();
    }

    /**
     * Load parsed answers from file
     */
    loadParsedAnswers(pythonScriptDir: string): ParsedAnswersData {
        const answersJsonPath = path.join(
            pythonScriptDir,
            'output/answers/parsed_answers.json',
        );

        if (!fs.existsSync(answersJsonPath)) {
            throw new Error(`Parsed answers not found at: ${answersJsonPath}`);
        }

        const data = JSON.parse(fs.readFileSync(answersJsonPath, 'utf-8'));
        return data;
    }
}
