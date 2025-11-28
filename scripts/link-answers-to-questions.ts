#!/usr/bin/env ts-node
/**
 * Test script to link parsed answers to questions in database
 * Usage: npx ts-node link-answers-to-questions.ts <jobId>
 */

import { PrismaClient } from '@prisma/client';
import { AnswerLinkingService } from './src/pdf/answer-linking.service';
import * as path from 'path';

const prisma = new PrismaClient();

async function linkAnswers(jobId: string) {
    console.log(`🔗 Linking answers to questions for job ${jobId}...\n`);

    try {
        // Create answer linking service
        const answerLinkingService = new AnswerLinkingService(prisma);

        // Load parsed answers
        const pythonScriptDir = path.join(__dirname, 'pdf-processor');
        const answersData = answerLinkingService.loadParsedAnswers(pythonScriptDir);

        console.log(`📚 Loaded ${answersData.answers.length} answers from parsed file`);
        console.log(`📄 Source: ${answersData.document_info.filename}\n`);

        // Link answers to questions
        const result = await answerLinkingService.linkAnswersToQuestions(
            jobId,
            answersData,
        );

        console.log('\n✅ Answer linking complete!\n');
        console.log(`📊 Results:`);
        console.log(`   Official answers linked: ${result.linked}`);
        console.log(`   Failed to link: ${result.failed}`);
        console.log(`   AI-generated fallbacks: ${result.aiGenerated}`);
        console.log(`   Total: ${result.linked + result.aiGenerated}\n`);

        // Verify results
        const partsWithAnswers = await prisma.questionPart.count({
            where: {
                question: { jobId },
                stepByStepAnswer: { not: null },
            },
        });

        const totalParts = await prisma.questionPart.count({
            where: { question: { jobId } },
        });

        console.log(`📈 Coverage: ${partsWithAnswers}/${totalParts} parts have step-by-step answers`);
        console.log(`   Success rate: ${((partsWithAnswers / totalParts) * 100).toFixed(1)}%\n`);

    } catch (error) {
        console.error('❌ Error linking answers:', error);
        throw error;
    } finally {
        await prisma.$disconnect();
    }
}

// Run the script
if (process.argv.length < 3) {
    console.error('Usage: npx ts-node link-answers-to-questions.ts <jobId>');
    console.error('Example: npx ts-node link-answers-to-questions.ts abc123-def456');
    process.exit(1);
}

const jobId = process.argv[2];

linkAnswers(jobId)
    .then(() => {
        console.log('✨ Script finished successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n💥 Script failed:', error);
        process.exit(1);
    });
