# Adaptive Learning Platform - Implementation Plan

## 🎯 Project Goals

Transform the PDF processor into a comprehensive adaptive learning platform with:

1. **Content Management** - Tag questions by chapter, difficulty, topic
2. **Adaptive Learning** - Personalized question recommendations based on performance
3. **Lead Generation** - Wix-integrated sample quiz with lead capture
4. **Analytics** - Track attempts, completions, and performance
5. **Anti-Bot** - reCAPTCHA integration

---

## 📊 Current State vs Target State

### Current System

```
PDF Upload → Extract Questions → Store in MongoDB → API to retrieve
```

**What we have:**
- ✅ PDF processing with Gemini AI
- ✅ Question extraction with parts and options
- ✅ Diagram storage in MinIO
- ✅ Basic job tracking

**What we need:**
- ❌ Question tagging (chapter, difficulty, topic)
- ❌ User/session management
- ❌ Attempt tracking and analytics
- ❌ Performance-based recommendations
- ❌ Lead capture and marketing integration
- ❌ reCAPTCHA validation
- ❌ Wix integration endpoints

### Target System

```
PDF Upload → Extract & Tag Questions → Store with Metadata
                                              ↓
User Takes Quiz → Track Attempts → Analyze Performance
                                              ↓
                                    Adaptive Recommendations
                                              ↓
                                    Generate New Question Sets
                                              ↓
                                    Lead Capture & Marketing
```

---

## 🗄️ Database Schema Updates

### New Collections

#### 1. **Topic** Collection

Organize questions by educational topics/chapters.

```prisma
model Topic {
  id          String   @id @default(auto()) @map("_id") @db.ObjectId
  name        String   @unique  // e.g., "Algebra - Linear Equations"
  chapter     String              // e.g., "Chapter 3"
  subject     String              // e.g., "Mathematics"
  level       String              // e.g., "Primary 6", "Secondary 2"
  description String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@map("topic")
  @@index([subject, level])
  @@index([chapter])
}
```

#### 2. **EnrichedQuestion** Collection

Extended question model with tagging and metadata.

```prisma
model EnrichedQuestion {
  id              String   @id @default(auto()) @map("_id") @db.ObjectId
  
  // Original question data
  jobId           String?  // Link to original PDF job (nullable for manual entry)
  questionNum     String
  questionText    String
  parts           Json[]   // Array of question parts with options
  diagrams        Diagram[]
  
  // Tagging and metadata
  topicId         String   @db.ObjectId  // Link to Topic
  difficulty      String   // "easy", "medium", "hard"
  marks           Int
  timeEstimate    Int      // Estimated time in minutes
  
  // Question type
  questionType    String   // "multiple_choice", "open_ended", "diagram_based"
  
  // Learning outcomes
  learningOutcomes String[] // ["Calculate area", "Apply Pythagoras theorem"]
  keywords        String[]  // ["triangle", "area", "geometry"]
  
  // Usage stats
  timesAttempted  Int      @default(0)
  averageScore    Float?
  
  // Status
  status          String   @default("active") // "active", "archived", "draft"
  isVerified      Boolean  @default(false)
  
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@map("enriched_question")
  @@index([topicId])
  @@index([difficulty])
  @@index([status])
  @@index([questionType])
}
```

#### 3. **User** Collection

Track quiz takers (both leads and registered users).

```prisma
model User {
  id              String   @id @default(auto()) @map("_id") @db.ObjectId
  
  // Basic info
  email           String   @unique
  name            String
  level           String   // "Primary 6", "Secondary 2", etc.
  
  // User type
  userType        String   @default("lead") // "lead", "trial", "premium"
  
  // Marketing
  marketingConsent Boolean @default(false)
  source          String?  // "wix_widget", "landing_page", etc.
  
  // Metadata
  ipAddress       String?
  userAgent       String?
  
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@map("user")
  @@index([email])
  @@index([userType])
  @@index([level])
}
```

#### 4. **QuizSession** Collection

Track individual quiz attempts.

```prisma
model QuizSession {
  id              String   @id @default(auto()) @map("_id") @db.ObjectId
  
  // Session info
  sessionId       String   @unique  // UUID for anonymous sessions
  userId          String?  @db.ObjectId  // Linked after lead capture
  
  // Quiz details
  quizType        String   // "sample", "adaptive", "exam"
  topicId         String?  @db.ObjectId
  difficulty      String?  // Starting difficulty
  
  // Questions in this session
  questionIds     String[] @db.ObjectId
  totalQuestions  Int
  
  // Status
  status          String   @default("in_progress") // "in_progress", "completed", "abandoned"
  
  // Performance
  correctAnswers  Int      @default(0)
  incorrectAnswers Int     @default(0)
  score           Float?   // Percentage
  
  // Timing
  startedAt       DateTime @default(now())
  completedAt     DateTime?
  timeSpent       Int?     // Seconds
  
  // Lead capture
  leadCaptured    Boolean  @default(false)
  
  // Security
  recaptchaScore  Float?   // Google reCAPTCHA v3 score
  ipAddress       String?
  
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@map("quiz_session")
  @@index([sessionId])
  @@index([userId])
  @@index([status])
  @@index([quizType])
}
```

#### 5. **QuestionAttempt** Collection

Track individual question attempts.

```prisma
model QuestionAttempt {
  id              String   @id @default(auto()) @map("_id") @db.ObjectId
  
  // Links
  sessionId       String   @db.ObjectId
  questionId      String   @db.ObjectId
  userId          String?  @db.ObjectId
  
  // Attempt details
  questionPart    String?  // "(a)", "(b)", etc. - null for full question
  userAnswer      String   // User's selected option or answer
  correctAnswer   String
  isCorrect       Boolean
  
  // Timing
  timeSpent       Int      // Seconds spent on this question
  attemptOrder    Int      // Order in the quiz (1st, 2nd, 3rd question)
  
  // Context
  difficulty      String   // Difficulty at time of attempt
  
  createdAt       DateTime @default(now())

  @@map("question_attempt")
  @@index([sessionId])
  @@index([questionId])
  @@index([userId])
}
```

#### 6. **Lead** Collection

Store captured leads for marketing.

```prisma
model Lead {
  id              String   @id @default(auto()) @map("_id") @db.ObjectId
  
  // Contact info
  email           String   @unique
  name            String
  level           String
  
  // Quiz performance
  sessionId       String   @db.ObjectId
  score           Float?
  questionsCompleted Int
  
  // Marketing
  marketingConsent Boolean @default(false)
  emailSent       Boolean  @default(false)
  emailSentAt     DateTime?
  
  // Source tracking
  source          String?  // "wix_widget", "landing_page"
  referrer        String?
  utmSource       String?
  utmMedium       String?
  utmCampaign     String?
  
  // Status
  status          String   @default("new") // "new", "contacted", "converted", "unsubscribed"
  
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@map("lead")
  @@index([email])
  @@index([status])
  @@index([createdAt])
}
```

#### 7. **PerformanceAnalytics** Collection

Aggregate performance data for adaptive learning.

```prisma
model PerformanceAnalytics {
  id              String   @id @default(auto()) @map("_id") @db.ObjectId
  
  userId          String   @db.ObjectId
  topicId         String   @db.ObjectId
  
  // Performance metrics
  totalAttempts   Int      @default(0)
  correctAttempts Int      @default(0)
  incorrectAttempts Int    @default(0)
  averageScore    Float?
  
  // Difficulty progression
  currentDifficulty String // "easy", "medium", "hard"
  
  // Streaks
  currentStreak   Int      @default(0) // Consecutive correct answers
  longestStreak   Int      @default(0)
  
  // Time
  totalTimeSpent  Int      @default(0) // Seconds
  averageTimePerQuestion Float?
  
  // Status
  proficiency     String   @default("beginner") // "beginner", "intermediate", "advanced"
  lastAttemptedAt DateTime?
  
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@map("performance_analytics")
  @@unique([userId, topicId])
  @@index([userId])
  @@index([topicId])
  @@index([proficiency])
}
```

### Updated Collections

#### Update **ProcessingJob** Collection

Add enrichment status:

```prisma
model ProcessingJob {
  // ... existing fields ...
  
  // New fields
  enrichmentStatus String @default("pending") // "pending", "enriching", "enriched"
  questionsEnriched Int   @default(0)
  totalQuestions    Int?
  
  // ... rest of fields ...
}
```

---

## 🏗️ New Backend Modules

### 1. Topics Module

**Responsibilities:**
- CRUD operations for topics
- Organize by subject, chapter, level
- Bulk import from CSV

**Endpoints:**
```
POST   /api/topics                 Create topic
GET    /api/topics                 List all topics
GET    /api/topics/:id             Get topic details
PUT    /api/topics/:id             Update topic
DELETE /api/topics/:id             Delete topic
GET    /api/topics/by-level/:level Get topics by level
```

### 2. Questions Module

**Responsibilities:**
- Enrich extracted questions with metadata
- Tag questions (topic, difficulty, keywords)
- CRUD operations
- Search and filter questions

**Endpoints:**
```
POST   /api/questions/enrich/:jobId    Enrich questions from PDF job
GET    /api/questions                  List questions (with filters)
GET    /api/questions/:id              Get question details
PUT    /api/questions/:id              Update question
DELETE /api/questions/:id              Delete question
POST   /api/questions/:id/tag          Add tags to question
GET    /api/questions/by-topic/:topicId Get questions by topic
GET    /api/questions/by-difficulty/:level Filter by difficulty
```

### 3. Quiz Module

**Responsibilities:**
- Generate quiz sessions
- Adaptive question selection
- Track attempts
- Calculate scores

**Endpoints:**
```
POST   /api/quiz/start                 Start new quiz session
POST   /api/quiz/sample                Generate sample quiz (5 questions)
GET    /api/quiz/:sessionId            Get quiz questions
POST   /api/quiz/:sessionId/submit     Submit answer
POST   /api/quiz/:sessionId/complete   Complete quiz
GET    /api/quiz/:sessionId/score      Get scorecard
POST   /api/quiz/:sessionId/next       Get next adaptive question
```

### 4. Adaptive Learning Module

**Responsibilities:**
- Analyze user performance
- Recommend questions based on proficiency
- Implement adaptive logic

**Endpoints:**
```
GET    /api/adaptive/recommend/:userId/:topicId  Get recommended questions
POST   /api/adaptive/analyze/:sessionId          Analyze session performance
GET    /api/adaptive/proficiency/:userId         Get user proficiency across topics
```

**Adaptive Logic:**

```typescript
// Weak performance (score < 60% on topic)
→ Return 3 questions of SAME difficulty level

// Strong performance (score >= 80% on topic)
→ Return 2 questions of HIGHER difficulty level

// Medium performance (60-79%)
→ Return mixed: 1 same level + 1 harder
```

### 5. Users Module

**Responsibilities:**
- User registration (after lead capture)
- User profiles
- Performance tracking

**Endpoints:**
```
POST   /api/users                  Create user
GET    /api/users/:id              Get user profile
PUT    /api/users/:id              Update user
GET    /api/users/:id/performance  Get performance analytics
GET    /api/users/:id/history      Get quiz history
```

### 6. Leads Module

**Responsibilities:**
- Capture leads from sample quiz
- Validate reCAPTCHA
- Trigger marketing emails
- Lead management

**Endpoints:**
```
POST   /api/leads/capture                Capture lead from quiz
GET    /api/leads                        List all leads (admin)
GET    /api/leads/:id                    Get lead details
PUT    /api/leads/:id/status             Update lead status
POST   /api/leads/:id/send-email         Send marketing email
GET    /api/leads/stats                  Get lead statistics
```

### 7. Analytics Module

**Responsibilities:**
- Track question attempts
- Generate reports
- Dashboard data

**Endpoints:**
```
GET    /api/analytics/overview           Overall statistics
GET    /api/analytics/questions/:id      Question-level analytics
GET    /api/analytics/topics/:id         Topic-level analytics
GET    /api/analytics/abandonment        Abandonment analysis
GET    /api/analytics/popular-questions  Most attempted questions
GET    /api/analytics/difficulty-distribution Performance by difficulty
```

### 8. Integration Module (Wix)

**Responsibilities:**
- Wix widget integration
- CORS configuration
- Embedded quiz endpoints

**Endpoints:**
```
GET    /api/widget/quiz                  Get quiz for widget
POST   /api/widget/submit                Submit widget quiz
POST   /api/widget/capture-lead          Capture lead from widget
GET    /api/widget/config                Get widget configuration
```

---

## 🔄 Workflow Examples

### Workflow 1: PDF to Enriched Questions

```
1. Upload PDF → Extract questions (existing)
2. Admin reviews extraction → Trigger enrichment
3. System shows extracted questions
4. Admin adds:
   - Topic (dropdown)
   - Difficulty (easy/medium/hard)
   - Keywords
   - Learning outcomes
5. Questions saved as EnrichedQuestions
6. Now available for quiz generation
```

### Workflow 2: Sample Quiz (Lead Generation)

```
1. User visits website → Clicks "Try Sample Quiz"
2. System generates 5 random questions (medium difficulty)
3. User answers questions (tracked in QuestionAttempt)
4. After 5 questions → Show scorecard
5. Prompt lead capture form:
   - Name
   - Email
   - Level (Primary 6, Secondary 1, etc.)
6. reCAPTCHA validation
7. Save lead → Send welcome email
8. Show "Sign up for full access" CTA
```

### Workflow 3: Adaptive Learning

```
1. User selects topic: "Algebra - Linear Equations"
2. System starts with medium difficulty question
3. User answers correctly → Track in QuestionAttempt
4. System analyzes: "User got 3/3 correct (strong)"
5. System recommends: 2 HARD questions on same topic
6. User struggles (1/2 correct)
7. System adapts: Return to medium difficulty
8. Continue until user completes session or quits
```

### Workflow 4: Analytics Dashboard

```
Admin Dashboard shows:

1. Total questions attempted today/week/month
2. Abandonment rate (sessions not completed)
3. Average scores by topic
4. Popular questions (most attempted)
5. Difficult questions (lowest success rate)
6. User proficiency distribution
7. Lead conversion funnel
```

---

## 🔐 Security & Validation

### reCAPTCHA Integration

**reCAPTCHA v3** (invisible, score-based):

```typescript
// Frontend (Wix widget)
grecaptcha.execute('YOUR_SITE_KEY', {action: 'submit_quiz'})
  .then(token => {
    // Send token with quiz submission
  });

// Backend validation
async function validateRecaptcha(token: string): Promise<number> {
  const response = await axios.post(
    'https://www.google.com/recaptcha/api/siteverify',
    {
      secret: process.env.RECAPTCHA_SECRET_KEY,
      response: token
    }
  );
  
  return response.data.score; // 0.0 - 1.0
}

// Block submissions with score < 0.5
if (recaptchaScore < 0.5) {
  throw new Error('Bot detected');
}
```

### Rate Limiting

```typescript
// Limit quiz starts per IP
@Throttle(10, 60) // 10 requests per 60 seconds
async startQuiz() { ... }

// Limit lead capture
@Throttle(3, 3600) // 3 captures per hour per IP
async captureLead() { ... }
```

---

## 📱 Wix Integration

### Embedded Quiz Widget

**Option 1: iFrame Embed**

```html
<!-- In Wix Custom HTML -->
<iframe 
  src="https://your-api.com/widget/quiz?embed=true"
  width="100%"
  height="600px"
  frameborder="0"
></iframe>
```

**Option 2: JavaScript SDK**

```javascript
// Wix Velo code
import { fetch } from 'wix-fetch';

$w.onReady(async function () {
  // Load quiz
  const quiz = await fetch('https://your-api.com/api/widget/quiz')
    .then(res => res.json());
  
  // Display questions
  displayQuestions(quiz.questions);
  
  // Handle submission
  $w('#submitBtn').onClick(async () => {
    const answers = collectAnswers();
    
    // Get reCAPTCHA token
    const token = await grecaptcha.execute();
    
    // Submit
    const result = await fetch('https://your-api.com/api/widget/submit', {
      method: 'POST',
      body: JSON.stringify({ answers, recaptchaToken: token }),
      headers: { 'Content-Type': 'application/json' }
    }).then(res => res.json());
    
    // Show scorecard
    showScorecard(result.score);
    
    // Show lead form
    showLeadForm();
  });
});
```

### CORS Configuration

```typescript
// Allow Wix domain
app.enableCors({
  origin: [
    'https://your-wix-site.com',
    'https://www.your-wix-site.com'
  ],
  credentials: true
});
```

---

## 📧 Marketing Automation

### Email Integration

Use **SendGrid** or **Mailchimp** API:

```typescript
// After lead capture
async function sendWelcomeEmail(lead: Lead) {
  await sendgrid.send({
    to: lead.email,
    from: 'hello@yoursite.com',
    subject: 'Your Quiz Results & Next Steps',
    templateId: 'd-welcome-template-id',
    dynamicTemplateData: {
      name: lead.name,
      score: lead.score,
      level: lead.level,
      ctaLink: 'https://yoursite.com/signup'
    }
  });
  
  // Update lead
  await prisma.lead.update({
    where: { id: lead.id },
    data: { emailSent: true, emailSentAt: new Date() }
  });
}
```

### Email Sequences

1. **Immediate:** Welcome + Quiz results
2. **Day 1:** "Here's what you can unlock"
3. **Day 3:** Success stories + Limited offer
4. **Day 7:** Last chance reminder

---

## 📊 Admin Dashboard Features

### Question Management

- ✅ View all extracted questions
- ✅ Enrich with metadata (topic, difficulty, tags)
- ✅ Edit question text and options
- ✅ Upload diagrams manually
- ✅ Bulk import questions from CSV
- ✅ Archive/unarchive questions

### Analytics

- ✅ Total users, sessions, questions
- ✅ Completion rate
- ✅ Average scores by topic
- ✅ Abandonment points
- ✅ Question difficulty accuracy
- ✅ User proficiency distribution

### Lead Management

- ✅ View all leads
- ✅ Filter by status, date, score
- ✅ Export to CSV
- ✅ Trigger marketing emails
- ✅ View conversion funnel

---

## 🧪 Testing Strategy

### Unit Tests

```typescript
describe('AdaptiveService', () => {
  it('should recommend 3 same-level questions for weak performance', async () => {
    // User scored 40% on topic
    const recommendations = await adaptiveService.getRecommendations(
      userId, topicId, 0.4
    );
    
    expect(recommendations.length).toBe(3);
    expect(recommendations.every(q => q.difficulty === 'medium')).toBe(true);
  });
  
  it('should recommend 2 harder questions for strong performance', async () => {
    // User scored 90% on topic
    const recommendations = await adaptiveService.getRecommendations(
      userId, topicId, 0.9
    );
    
    expect(recommendations.length).toBe(2);
    expect(recommendations.every(q => q.difficulty === 'hard')).toBe(true);
  });
});
```

### Integration Tests

```typescript
describe('Sample Quiz Flow', () => {
  it('should complete full quiz and capture lead', async () => {
    // Start quiz
    const session = await request(app).post('/api/quiz/sample');
    
    // Submit 5 answers
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post(`/api/quiz/${session.sessionId}/submit`)
        .send({ questionId, answer: 'A' });
    }
    
    // Complete quiz
    const scorecard = await request(app)
      .post(`/api/quiz/${session.sessionId}/complete`);
    
    expect(scorecard.score).toBeDefined();
    
    // Capture lead
    const lead = await request(app)
      .post('/api/leads/capture')
      .send({ 
        sessionId: session.sessionId,
        name: 'John Doe',
        email: 'john@example.com',
        level: 'Primary 6',
        recaptchaToken: 'valid-token'
      });
    
    expect(lead.status).toBe(201);
  });
});
```

---

## 📦 Implementation Phases

### Phase 1: Foundation (Week 1-2)

**Backend:**
- ✅ Update Prisma schema with new collections
- ✅ Create Topics module (CRUD)
- ✅ Create Questions enrichment endpoints
- ✅ Create QuizSession tracking

**Deliverables:**
- Updated schema
- API to enrich questions
- Basic quiz session tracking

### Phase 2: Adaptive Learning (Week 3-4)

**Backend:**
- ✅ Implement adaptive algorithm
- ✅ Performance analytics collection
- ✅ Question recommendation engine
- ✅ QuestionAttempt tracking

**Deliverables:**
- Adaptive question selection working
- Performance tracking
- Recommendation API

### Phase 3: Lead Generation (Week 5-6)

**Backend:**
- ✅ Sample quiz generation
- ✅ Lead capture endpoints
- ✅ reCAPTCHA integration
- ✅ SendGrid email integration

**Frontend (Wix):**
- ✅ Quiz widget UI
- ✅ Scorecard display
- ✅ Lead capture form
- ✅ reCAPTCHA v3 integration

**Deliverables:**
- Working Wix widget
- Lead capture flow
- Email automation

### Phase 4: Analytics & Admin (Week 7-8)

**Backend:**
- ✅ Analytics endpoints
- ✅ Dashboard data APIs
- ✅ Export functionality

**Frontend (Admin):**
- ✅ Question management UI
- ✅ Lead management dashboard
- ✅ Analytics visualizations

**Deliverables:**
- Admin dashboard
- Analytics reports
- Lead management tools

---

## 🚀 Quick Start Implementation

See separate document: `IMPLEMENTATION_STEPS.md`

---

## 📝 Summary

This plan transforms your PDF processor into a complete adaptive learning platform with:

### ✅ New Features

1. **Question Tagging** - Organize by topic, difficulty, chapter
2. **Adaptive Learning** - Smart question recommendations
3. **Lead Generation** - Sample quiz with capture
4. **Analytics** - Track everything
5. **Wix Integration** - Embeddable widget
6. **Marketing** - Automated email sequences
7. **Anti-Bot** - reCAPTCHA protection

### 📊 New Collections

1. Topic (subjects & chapters)
2. EnrichedQuestion (tagged questions)
3. User (quiz takers)
4. QuizSession (quiz attempts)
5. QuestionAttempt (individual answers)
6. Lead (captured leads)
7. PerformanceAnalytics (proficiency tracking)

### 🔌 New Modules

1. Topics Module
2. Questions Module
3. Quiz Module
4. Adaptive Learning Module
5. Users Module
6. Leads Module
7. Analytics Module
8. Wix Integration Module

### 📈 Implementation Timeline

**8 weeks total**
- Week 1-2: Foundation & schema
- Week 3-4: Adaptive learning
- Week 5-6: Lead generation & Wix
- Week 7-8: Analytics & admin dashboard

---

**Next Steps:** See `IMPLEMENTATION_STEPS.md` for detailed step-by-step guide.

