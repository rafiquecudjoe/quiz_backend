import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function backfillQuizAttemptsStatus() {
  console.log('Starting backfill of QuizAttempt status fields...');

  // Update completed attempts
  const completedAttempts = await prisma.quizAttempt.findMany({
    where: {
      completedAt: { not: null },
    },
  });

  for (const attempt of completedAttempts) {
    await prisma.quizAttempt.update({
      where: { id: attempt.id },
      data: {
        status: 'completed',
        lastActivityAt: attempt.completedAt,
      },
    });
  }

  console.log(`✓ Updated ${completedAttempts.length} completed attempts`);

  // Update abandoned attempts (incomplete and older than 24 hours)
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  const abandonedAttempts = await prisma.quizAttempt.findMany({
    where: {
      completedAt: null,
      startedAt: { lt: twentyFourHoursAgo },
    },
  });

  for (const attempt of abandonedAttempts) {
    await prisma.quizAttempt.update({
      where: { id: attempt.id },
      data: {
        status: 'abandoned',
        lastActivityAt: attempt.startedAt,
      },
    });
  }

  console.log(`✓ Updated ${abandonedAttempts.length} abandoned attempts`);

  // Count remaining in-progress (recent incomplete attempts)
  const inProgressCount = await prisma.quizAttempt.count({
    where: {
      status: 'in_progress',
    },
  });

  console.log(`✓ ${inProgressCount} attempts remain in-progress (recent, within 24h)`);

  console.log('Backfill complete!');
}

backfillQuizAttemptsStatus()
  .then(() => {
    console.log('Migration successful');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
