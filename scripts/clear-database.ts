/**
 * Database Clear Script
 * 
 * This script deletes ALL data from ALL tables in the database.
 * Use this to start fresh with a clean database.
 * 
 * ⚠️  WARNING: This action is IRREVERSIBLE! All data will be permanently deleted.
 * 
 * Usage:
 *   npm run clear-db
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function clearDatabase() {
    console.log('🗑️  Starting database cleanup...\n');

    try {
        // Delete in correct order to respect foreign key constraints

        console.log('1️⃣  Deleting QuestionParts...');
        const partsCount = await prisma.questionPart.deleteMany();
        console.log(`   ✅ Deleted ${partsCount.count} question parts\n`);

        console.log('2️⃣  Deleting Diagrams...');
        const diagramsCount = await prisma.diagram.deleteMany();
        console.log(`   ✅ Deleted ${diagramsCount.count} diagrams\n`);

        console.log('3️⃣  Deleting Questions...');
        const questionsCount = await prisma.question.deleteMany();
        console.log(`   ✅ Deleted ${questionsCount.count} questions\n`);

        console.log('4️⃣  Deleting ProcessingJobs...');
        const jobsCount = await prisma.processingJob.deleteMany();
        console.log(`   ✅ Deleted ${jobsCount.count} processing jobs\n`);

        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('✨ Database cleared successfully!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        console.log('Summary:');
        console.log(`  • ${partsCount.count} question parts`);
        console.log(`  • ${diagramsCount.count} diagrams`);
        console.log(`  • ${questionsCount.count} questions`);
        console.log(`  • ${jobsCount.count} processing jobs`);
        console.log('\n🎉 Database is now clean and ready for fresh uploads!\n');

    } catch (error) {
        console.error('❌ Error clearing database:', error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

// Run the script
clearDatabase();
