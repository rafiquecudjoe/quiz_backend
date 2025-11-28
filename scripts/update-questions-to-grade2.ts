#!/usr/bin/env ts-node
/**
 * Simple script to update all existing questions to Grade 2
 * Usage: npx ts-node update-questions-to-grade2.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function updateAllQuestionsToGrade2() {
    console.log('🔄 Starting update of all questions to Grade 2...\n');

    try {
        // Count total questions before update
        const totalQuestions = await prisma.question.count();
        console.log(`📊 Total questions in database: ${totalQuestions}`);

        // Count questions that are NOT Grade 2
        const questionsToUpdate = await prisma.question.count({
            where: {
                questionLevel: {
                    not: 'Grade 2',
                },
            },
        });
        console.log(`📝 Questions to update: ${questionsToUpdate}\n`);

        if (questionsToUpdate === 0) {
            console.log('✅ All questions are already Grade 2. No updates needed.');
            return;
        }

        // Update all questions to Grade 2
        const result = await prisma.question.updateMany({
            data: {
                questionLevel: 'Grade 2',
            },
        });

        console.log(`✅ Successfully updated ${result.count} questions to Grade 2!\n`);

        // Verify the update
        const grade2Count = await prisma.question.count({
            where: {
                questionLevel: 'Grade 2',
            },
        });

        console.log('📊 Verification:');
        console.log(`   Total questions: ${totalQuestions}`);
        console.log(`   Grade 2 questions: ${grade2Count}`);
        console.log(`   Success rate: ${((grade2Count / totalQuestions) * 100).toFixed(1)}%\n`);

        console.log('🎉 Update complete!');
    } catch (error) {
        console.error('❌ Error updating questions:', error);
        throw error;
    } finally {
        await prisma.$disconnect();
    }
}

// Run the update
updateAllQuestionsToGrade2()
    .then(() => {
        console.log('\n✨ Script finished successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n💥 Script failed:', error);
        process.exit(1);
    });
