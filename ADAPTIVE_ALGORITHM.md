# Adaptive Learning Algorithm - Technical Specification

## 🧠 Core Adaptive Logic

### Performance-Based Recommendations

```typescript
/**
 * Adaptive Learning Algorithm
 * 
 * Rules:
 * 1. Weak performance (< 60%) → 3 same-level questions
 * 2. Strong performance (≥ 80%) → 2 harder questions
 * 3. Medium performance (60-79%) → Mixed (1 same + 1 harder)
 */

interface AdaptiveRecommendation {
  questions: EnrichedQuestion[];
  reasoning: string;
  nextDifficulty: string;
}

async function getAdaptiveRecommendations(
  userId: string,
  topicId: string,
): Promise<AdaptiveRecommendation> {
  
  // Get user's performance on this topic
  const performance = await getPerformanceAnalytics(userId, topicId);
  
  // Calculate recent score (last 5-10 questions)
  const recentAttempts = await getRecentAttempts(userId, topicId, 5);
  const recentScore = calculateScore(recentAttempts);
  
  // Get current difficulty
  const currentDifficulty = performance.currentDifficulty;
  
  // Apply adaptive rules
  if (recentScore < 0.60) {
    // WEAK PERFORMANCE
    return {
      questions: await getQuestions(topicId, currentDifficulty, 3),
      reasoning: 'Practice more at current level to build confidence',
      nextDifficulty: currentDifficulty
    };
  } 
  else if (recentScore >= 0.80) {
    // STRONG PERFORMANCE
    const nextLevel = getNextDifficultyLevel(currentDifficulty);
    
    return {
      questions: await getQuestions(topicId, nextLevel, 2),
      reasoning: 'Ready for more challenging questions',
      nextDifficulty: nextLevel
    };
  } 
  else {
    // MEDIUM PERFORMANCE (60-79%)
    const sameLevelQ = await getQuestions(topicId, currentDifficulty, 1);
    const nextLevel = getNextDifficultyLevel(currentDifficulty);
    const harderQ = await getQuestions(topicId, nextLevel, 1);
    
    return {
      questions: [...sameLevelQ, ...harderQ],
      reasoning: 'Mixing current and challenging questions',
      nextDifficulty: currentDifficulty
    };
  }
}

function getNextDifficultyLevel(current: string): string {
  const levels = ['easy', 'medium', 'hard'];
  const currentIndex = levels.indexOf(current);
  
  if (currentIndex < levels.length - 1) {
    return levels[currentIndex + 1];
  }
  
  return current; // Already at hardest
}
```

---

## 📊 Performance Tracking

### Update Performance After Each Attempt

```typescript
async function updatePerformanceAnalytics(
  userId: string,
  questionAttempt: QuestionAttempt
) {
  const { topicId, isCorrect, timeSpent, difficulty } = questionAttempt;
  
  // Get or create performance record
  let performance = await prisma.performanceAnalytics.findUnique({
    where: {
      userId_topicId: { userId, topicId }
    }
  });
  
  if (!performance) {
    performance = await prisma.performanceAnalytics.create({
      data: {
        userId,
        topicId,
        currentDifficulty: 'medium',
        proficiency: 'beginner'
      }
    });
  }
  
  // Update metrics
  const updateData: any = {
    totalAttempts: { increment: 1 },
    totalTimeSpent: { increment: timeSpent },
    lastAttemptedAt: new Date()
  };
  
  if (isCorrect) {
    updateData.correctAttempts = { increment: 1 };
    updateData.currentStreak = { increment: 1 };
    
    // Update longest streak if needed
    if (performance.currentStreak + 1 > performance.longestStreak) {
      updateData.longestStreak = performance.currentStreak + 1;
    }
  } else {
    updateData.incorrectAttempts = { increment: 1 };
    updateData.currentStreak = 0; // Reset streak
  }
  
  // Calculate new average score
  const newCorrect = performance.correctAttempts + (isCorrect ? 1 : 0);
  const newTotal = performance.totalAttempts + 1;
  updateData.averageScore = newCorrect / newTotal;
  
  // Calculate average time per question
  const newTotalTime = performance.totalTimeSpent + timeSpent;
  updateData.averageTimePerQuestion = newTotalTime / newTotal;
  
  // Update proficiency level
  updateData.proficiency = calculateProficiency(updateData.averageScore);
  
  // Update difficulty progression
  if (updateData.averageScore >= 0.80 && performance.currentDifficulty !== 'hard') {
    updateData.currentDifficulty = getNextDifficultyLevel(performance.currentDifficulty);
  } else if (updateData.averageScore < 0.40 && performance.currentDifficulty !== 'easy') {
    updateData.currentDifficulty = getPreviousDifficultyLevel(performance.currentDifficulty);
  }
  
  // Save
  await prisma.performanceAnalytics.update({
    where: { userId_topicId: { userId, topicId } },
    data: updateData
  });
}

function calculateProficiency(averageScore: number): string {
  if (averageScore >= 0.80) return 'advanced';
  if (averageScore >= 0.60) return 'intermediate';
  return 'beginner';
}
```

---

## 🎯 Streak Detection

### Consecutive Correct/Incorrect Tracking

```typescript
async function checkStreakAndAdapt(
  userId: string,
  topicId: string
): Promise<{ shouldAdjust: boolean; action: string }> {
  
  const performance = await prisma.performanceAnalytics.findUnique({
    where: { userId_topicId: { userId, topicId } }
  });
  
  // Positive streak → Increase difficulty
  if (performance.currentStreak >= 5) {
    return {
      shouldAdjust: true,
      action: 'increase_difficulty'
    };
  }
  
  // Get recent attempts
  const recentAttempts = await prisma.questionAttempt.findMany({
    where: { userId, topicId },
    orderBy: { createdAt: 'desc' },
    take: 5
  });
  
  // Check for negative streak (5 consecutive wrong)
  const allWrong = recentAttempts.every(a => !a.isCorrect);
  
  if (allWrong && recentAttempts.length === 5) {
    return {
      shouldAdjust: true,
      action: 'decrease_difficulty'
    };
  }
  
  return { shouldAdjust: false, action: 'none' };
}
```

---

## 🎲 Question Selection Strategy

### Smart Question Selection

```typescript
async function selectQuestionsForQuiz(
  topicId: string,
  difficulty: string,
  count: number,
  userId?: string
): Promise<EnrichedQuestion[]> {
  
  // Get user's attempt history
  const attemptedQuestionIds = userId
    ? await getAttemptedQuestionIds(userId, topicId)
    : [];
  
  // Priority: Select questions not yet attempted
  const unattempedQuestions = await prisma.enrichedQuestion.findMany({
    where: {
      topicId,
      difficulty,
      status: 'active',
      isVerified: true,
      NOT: {
        id: { in: attemptedQuestionIds }
      }
    },
    take: count,
    orderBy: { timesAttempted: 'asc' } // Prioritize less-attempted globally
  });
  
  // If not enough unattempted questions, fill with attempted ones
  if (unattempedQuestions.length < count) {
    const needed = count - unattempedQuestions.length;
    
    const attemptedQuestions = await prisma.enrichedQuestion.findMany({
      where: {
        topicId,
        difficulty,
        status: 'active',
        isVerified: true,
        id: { in: attemptedQuestionIds }
      },
      take: needed,
      orderBy: { timesAttempted: 'asc' }
    });
    
    return [...unattempedQuestions, ...attemptedQuestions];
  }
  
  return unattempedQuestions;
}

async function getAttemptedQuestionIds(
  userId: string,
  topicId: string
): Promise<string[]> {
  const attempts = await prisma.questionAttempt.findMany({
    where: { userId, topicId },
    select: { questionId: true },
    distinct: ['questionId']
  });
  
  return attempts.map(a => a.questionId);
}
```

---

## 📈 Real-Time Difficulty Adjustment

### Adjust During Quiz Session

```typescript
async function getNextQuestionAdaptively(
  sessionId: string
): Promise<EnrichedQuestion> {
  
  const session = await prisma.quizSession.findUnique({
    where: { sessionId },
    include: {
      _count: {
        select: { questionAttempts: true }
      }
    }
  });
  
  // Get recent attempts in this session
  const recentAttempts = await prisma.questionAttempt.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: 'desc' },
    take: 3
  });
  
  // Calculate recent performance
  const recentCorrect = recentAttempts.filter(a => a.isCorrect).length;
  const recentScore = recentCorrect / recentAttempts.length;
  
  // Adjust difficulty
  let nextDifficulty = session.difficulty || 'medium';
  
  if (recentScore >= 0.80) {
    // User is doing well → increase difficulty
    nextDifficulty = getNextDifficultyLevel(nextDifficulty);
  } else if (recentScore < 0.40) {
    // User is struggling → decrease difficulty
    nextDifficulty = getPreviousDifficultyLevel(nextDifficulty);
  }
  
  // Select next question
  const questions = await selectQuestionsForQuiz(
    session.topicId,
    nextDifficulty,
    1,
    session.userId
  );
  
  return questions[0];
}

function getPreviousDifficultyLevel(current: string): string {
  const levels = ['easy', 'medium', 'hard'];
  const currentIndex = levels.indexOf(current);
  
  if (currentIndex > 0) {
    return levels[currentIndex - 1];
  }
  
  return current; // Already at easiest
}
```

---

## 🎓 Mastery Detection

### Detect Topic Mastery

```typescript
async function checkTopicMastery(
  userId: string,
  topicId: string
): Promise<{
  isMastered: boolean;
  masteryLevel: number;
  recommendation: string;
}> {
  
  const performance = await prisma.performanceAnalytics.findUnique({
    where: { userId_topicId: { userId, topicId } }
  });
  
  // Mastery criteria:
  // 1. Completed at least 20 questions
  // 2. Average score ≥ 85%
  // 3. Current difficulty is 'hard'
  // 4. Average time per question is within expected range
  
  const meetsAttemptThreshold = performance.totalAttempts >= 20;
  const meetsScoreThreshold = performance.averageScore >= 0.85;
  const atHardestLevel = performance.currentDifficulty === 'hard';
  const efficientTime = performance.averageTimePerQuestion <= 120; // 2 minutes
  
  const isMastered = 
    meetsAttemptThreshold && 
    meetsScoreThreshold && 
    atHardestLevel && 
    efficientTime;
  
  // Calculate mastery percentage
  const masteryLevel = Math.min(
    100,
    (performance.averageScore * 0.4 +
     (performance.totalAttempts / 20) * 0.2 +
     (atHardestLevel ? 0.3 : 0) +
     (efficientTime ? 0.1 : 0)) * 100
  );
  
  let recommendation = '';
  
  if (isMastered) {
    recommendation = 'Congratulations! You have mastered this topic. Try a new topic or review periodically.';
  } else if (masteryLevel >= 70) {
    recommendation = 'Almost there! Complete a few more hard questions to achieve mastery.';
  } else if (masteryLevel >= 50) {
    recommendation = 'Good progress. Continue practicing to improve your proficiency.';
  } else {
    recommendation = 'Keep practicing. Focus on understanding concepts before moving forward.';
  }
  
  return {
    isMastered,
    masteryLevel,
    recommendation
  };
}
```

---

## 🔄 Complete Adaptive Flow

### End-to-End Example

```typescript
/**
 * Complete adaptive quiz flow
 */
async function conductAdaptiveQuiz(
  userId: string,
  topicId: string
): Promise<void> {
  
  // 1. Get user's current proficiency
  const performance = await prisma.performanceAnalytics.findUnique({
    where: { userId_topicId: { userId, topicId } }
  });
  
  const startDifficulty = performance?.currentDifficulty || 'medium';
  
  // 2. Create quiz session
  const session = await prisma.quizSession.create({
    data: {
      sessionId: uuidv4(),
      userId,
      topicId,
      quizType: 'adaptive',
      difficulty: startDifficulty,
      questionIds: [],
      totalQuestions: 0, // Will be dynamic
      status: 'in_progress'
    }
  });
  
  // 3. Adaptive quiz loop
  let questionsAnswered = 0;
  const maxQuestions = 10;
  
  while (questionsAnswered < maxQuestions) {
    // Get next adaptive question
    const question = await getNextQuestionAdaptively(session.sessionId);
    
    // Present question to user (via API)
    // ... user answers ...
    
    // Record attempt
    const isCorrect = await submitAnswer(
      session.sessionId,
      question.id,
      userAnswer
    );
    
    // Update performance
    await updatePerformanceAnalytics(userId, {
      topicId,
      isCorrect,
      timeSpent: userTimeSpent,
      difficulty: question.difficulty
    });
    
    // Check for streak adjustment
    const { shouldAdjust, action } = await checkStreakAndAdapt(userId, topicId);
    
    if (shouldAdjust && action === 'increase_difficulty') {
      // Immediately give harder questions
      console.log('User on hot streak! Increasing difficulty...');
    } else if (shouldAdjust && action === 'decrease_difficulty') {
      // Drop to easier questions
      console.log('User struggling. Decreasing difficulty...');
    }
    
    questionsAnswered++;
  }
  
  // 4. Complete session
  await completeQuiz(session.sessionId);
  
  // 5. Check mastery
  const mastery = await checkTopicMastery(userId, topicId);
  
  // 6. Generate recommendations
  const recommendations = await getAdaptiveRecommendations(userId, topicId);
  
  // Return final results
  return {
    session,
    mastery,
    recommendations
  };
}
```

---

## 📊 Visualization

### Performance Dashboard Data

```typescript
async function getDashboardData(userId: string) {
  // Get all topics attempted
  const performanceData = await prisma.performanceAnalytics.findMany({
    where: { userId },
    include: {
      topic: {
        select: { name: true, subject: true }
      }
    }
  });
  
  // Format for charts
  return performanceData.map(p => ({
    topic: p.topic.name,
    subject: p.topic.subject,
    proficiency: p.proficiency,
    averageScore: p.averageScore,
    currentDifficulty: p.currentDifficulty,
    totalAttempts: p.totalAttempts,
    currentStreak: p.currentStreak,
    longestStreak: p.longestStreak,
    masteryLevel: calculateMasteryLevel(p)
  }));
}

// Sample visualization data
{
  "topics": [
    {
      "name": "Algebra - Linear Equations",
      "proficiency": "intermediate",
      "averageScore": 0.72,
      "currentDifficulty": "medium",
      "masteryLevel": 65,
      "trend": "improving"
    },
    {
      "name": "Geometry - Triangles",
      "proficiency": "advanced",
      "averageScore": 0.88,
      "currentDifficulty": "hard",
      "masteryLevel": 92,
      "trend": "stable"
    }
  ]
}
```

---

## 🧪 Testing Adaptive Logic

```typescript
describe('Adaptive Algorithm', () => {
  it('should recommend 3 same-level questions for weak performance', async () => {
    // Setup: User with 40% score on topic
    const userId = await createTestUser();
    const topicId = await createTestTopic();
    
    await createPerformanceRecord(userId, topicId, {
      averageScore: 0.40,
      currentDifficulty: 'medium'
    });
    
    // Act
    const recommendations = await getAdaptiveRecommendations(userId, topicId);
    
    // Assert
    expect(recommendations.questions.length).toBe(3);
    expect(recommendations.questions.every(q => q.difficulty === 'medium')).toBe(true);
    expect(recommendations.reasoning).toContain('Practice more at current level');
  });
  
  it('should recommend 2 harder questions for strong performance', async () => {
    // Setup: User with 85% score on topic
    const userId = await createTestUser();
    const topicId = await createTestTopic();
    
    await createPerformanceRecord(userId, topicId, {
      averageScore: 0.85,
      currentDifficulty: 'medium'
    });
    
    // Act
    const recommendations = await getAdaptiveRecommendations(userId, topicId);
    
    // Assert
    expect(recommendations.questions.length).toBe(2);
    expect(recommendations.questions.every(q => q.difficulty === 'hard')).toBe(true);
    expect(recommendations.nextDifficulty).toBe('hard');
  });
  
  it('should adjust difficulty mid-quiz based on streak', async () => {
    // Setup: User answers 5 consecutive correct
    const sessionId = await createQuizSession();
    
    // Act: Submit 5 correct answers
    for (let i = 0; i < 5; i++) {
      await submitCorrectAnswer(sessionId);
    }
    
    // Get next question
    const nextQuestion = await getNextQuestionAdaptively(sessionId);
    
    // Assert: Difficulty increased
    expect(nextQuestion.difficulty).toBe('hard');
  });
});
```

---

## Summary

This adaptive algorithm provides:

✅ **Performance-based recommendations** - 3 same-level or 2 harder questions  
✅ **Real-time difficulty adjustment** - Changes during quiz  
✅ **Streak detection** - Rewards consistent performance  
✅ **Mastery tracking** - Knows when topic is mastered  
✅ **Smart question selection** - Prioritizes unattempted questions  
✅ **Proficiency levels** - Beginner → Intermediate → Advanced  

The system continuously learns from user performance and adapts to provide the optimal learning experience.

