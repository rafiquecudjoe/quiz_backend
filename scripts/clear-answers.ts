#!/usr/bin/env ts-node
/**
 * Clear all step-by-step answers from database
 * This prepares the database for fresh AI-generated answers
 * Usage: npx ts-node scripts/clear-answers.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function clearAnswers() {
    console.log('🗑️  Clearing all step-by-step answers...\n');

    try {
        // Get count before clearing
        const beforeCount = await prisma.questionPart.count({
            where: {
                stepByStepAnswer: { not: null },
            },
        });

        console.log(`📊 Found ${beforeCount} question parts with answers\n`);

        if (beforeCount === 0) {
            console.log('✅ No answers to clear!\n');
            return;
        }

        // Show breakdown by source
        const officialCount = await prisma.questionPart.count({
            where: { answerSource: 'official_pdf' },
        });

        const aiCount = await prisma.questionPart.count({
            where: { answerSource: 'ai_generated' },
        });

        console.log('📋 Breakdown:');
        console.log(`   🎓 Official (PDF): ${officialCount}`);
        console.log(`   🤖 AI Generated: ${aiCount}\n`);

        // Clear all step-by-step answers
        const result = await prisma.questionPart.updateMany({
            where: {
                stepByStepAnswer: { not: null },
            },
            data: {
                stepByStepAnswer: null,
                answerSource: null,
            },
        });

        console.log(`✅ Cleared ${result.count} answers successfully!\n`);

        // Verify
        const afterCount = await prisma.questionPart.count({
            where: {
                stepByStepAnswer: { not: null },
            },
        });

        console.log(`✓ Verification: ${afterCount} answers remaining (should be 0)\n`);

        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('✨ Answers cleared successfully!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        console.log('🎯 Next step: Run bulk AI generation');
        console.log('   POST /pdf/jobs/{jobId}/generate-all-answers\n');
    } catch (error) {
        console.error('❌ Error clearing answers:', error);
        throw error;
    } finally {
        await prisma.$disconnect();
    }
}

clearAnswers()
    .then(() => {
        console.log('✨ Done!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n💥 Failed:', error);
        process.exit(1);
    });
