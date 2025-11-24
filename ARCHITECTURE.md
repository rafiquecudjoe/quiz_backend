# NestJS PDF Processor - Architecture Documentation

## Overview

This NestJS backend provides a production-ready API for processing exam PDFs using AI-powered batch processing. It integrates with an existing Python batch processor that uses Gemini Vision AI for OCR and question extraction.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                            │
│  (Web Browser, Mobile App, Swagger UI, cURL, etc.)            │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    NESTJS API LAYER (Port 3000)                 │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐    │
│  │   Health    │  │     PDF      │  │      Swagger       │    │
│  │  Endpoints  │  │  Controller  │  │   Documentation    │    │
│  └─────────────┘  └──────┬───────┘  └────────────────────┘    │
│                           │                                      │
│                           ▼                                      │
│                  ┌────────────────┐                             │
│                  │   PDF Service  │                             │
│                  └────────┬───────┘                             │
│                           │                                      │
│         ┌─────────────────┼─────────────────┐                  │
│         │                 │                 │                   │
│         ▼                 ▼                 ▼                   │
│  ┌──────────┐    ┌──────────────┐   ┌────────────┐            │
│  │  Prisma  │    │   Python     │   │   File     │            │
│  │  Service │    │  Executor    │   │  Manager   │            │
│  └────┬─────┘    └──────┬───────┘   └────────────┘            │
└───────┼──────────────────┼──────────────────────────────────────┘
        │                  │
        │                  ▼
        │         ┌─────────────────────┐
        │         │  PYTHON SUBPROCESS  │
        │         │                     │
        │         │  test_batch_        │
        │         │  processor.py       │
        │         └──────────┬──────────┘
        │                    │
        │                    ├─── Gemini Vision API
        │                    │    (OCR + Quiz Extraction)
        │                    │
        │                    ├─── DeepSeek API
        │                    │    (AI Analysis)
        │                    │
        │                    ├─── PDF Processing
        │                    │    (PyMuPDF, OpenCV)
        │                    │
        │                    ▼
        │         ┌─────────────────────┐
        │         │    results.json     │
        │         │   (Output File)     │
        │         └──────────┬──────────┘
        │                    │
        ▼                    │
┌─────────────┐             │
│   MongoDB   │◄────────────┘
│  (Prisma)   │
│             │
│ • Jobs      │
│ • Questions │
│ • Results   │
└─────────────┘
```

## Component Breakdown

### 1. NestJS Application Layer

#### Main Components

- **`main.ts`**: Application bootstrap, configures CORS, validation, and Swagger
- **`app.module.ts`**: Root module that imports all feature modules
- **`app.controller.ts`**: Health check endpoints

#### PDF Module (`src/pdf/`)

The core module handling PDF processing:

```typescript
PdfModule
├── PdfController       // API endpoints
├── PdfService          // Business logic & orchestration
└── PythonExecutorService // Python script execution
```

**Key Responsibilities:**
- Accept PDF file uploads
- Validate file type and size
- Create processing jobs in database
- Execute Python batch processor
- Parse and store results
- Provide job status and results APIs

### 2. Database Layer (Prisma + MongoDB)

#### Schema Design

**ProcessingJob Collection**
```prisma
- id: ObjectId (primary key)
- jobId: String (unique, UUID)
- filename: String
- originalPath: String (file path)
- status: String (pending/processing/completed/failed)
- batchSize: Int
- totalPages: Int
- apiCallsUsed: Int
- errorMessage: String (nullable)
- resultPath: String (nullable)
- resultData: Json (nullable)
- createdAt: DateTime
- updatedAt: DateTime
```

**QuizQuestion Collection**
```prisma
- id: ObjectId (primary key)
- jobId: String (indexed)
- questionNum: String
- pageNumber: Int
- questionText: String
- parts: Json[] (array of question parts)
- marks: Int
- diagrams: Json[]
- createdAt: DateTime
```

#### Why MongoDB?

- **Flexible Schema**: JSON storage for varying question structures
- **Scalability**: Horizontal scaling for large datasets
- **Performance**: Fast reads for job status queries
- **Prisma ORM**: Type-safe database access with excellent MongoDB support

### 3. Python Integration Layer

The `PythonExecutorService` manages the execution of the Python batch processor:

```typescript
executeBatchProcessor(pdfPath, batchSize)
  ├── Spawn Python subprocess
  ├── Pass PDF path and batch size as args
  ├── Capture stdout/stderr in real-time
  ├── Parse API call statistics
  ├── Return results when process completes
  └── Handle errors and timeouts
```

**Process Flow:**
1. NestJS spawns Python process with correct virtual environment
2. Streams output logs to NestJS logger
3. Extracts metrics (API calls, pages processed)
4. Waits for completion and collects exit code
5. Parses `results.json` output file
6. Stores results in MongoDB

### 4. Python Batch Processor

The existing Python backend (`test_batch_processor.py`) is called as a subprocess:

**What it does:**
1. Converts PDF to high-resolution images
2. Detects regions (text vs diagrams)
3. Batches multiple pages per API call (default: 5 pages)
4. Calls Gemini Vision API for OCR + quiz extraction
5. Extracts diagrams and saves them
6. Generates structured JSON output

**Benefits of Batch Processing:**
- 11-page PDF: 11 API calls → 3 API calls (73% reduction)
- Configurable batch size (1-10 pages per call)
- Lower costs and faster processing

## API Endpoints

### Core Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| POST | `/api/pdf/upload` | Upload PDF (multipart/form-data) |
| GET | `/api/pdf/jobs` | List all jobs |
| GET | `/api/pdf/jobs/:jobId` | Get job status |
| GET | `/api/pdf/results/:jobId` | Get processing results |

### Request/Response Flow

#### 1. Upload PDF

**Request:**
```http
POST /api/pdf/upload
Content-Type: multipart/form-data

file: exam.pdf (binary)
batchSize: 5 (optional)
```

**Response:**
```json
{
  "jobId": "abc-123-def-456",
  "filename": "exam.pdf",
  "status": "processing",
  "message": "PDF uploaded successfully. Processing started."
}
```

**Background Processing Starts:**
- Job record created in MongoDB with status "processing"
- Python script executed asynchronously
- Results parsed and stored when complete
- Job status updated to "completed" or "failed"

#### 2. Check Status

**Request:**
```http
GET /api/pdf/jobs/abc-123-def-456
```

**Response:**
```json
{
  "jobId": "abc-123-def-456",
  "filename": "exam.pdf",
  "status": "completed",
  "batchSize": 5,
  "totalPages": 11,
  "apiCallsUsed": 3,
  "createdAt": "2025-11-19T10:00:00.000Z",
  "updatedAt": "2025-11-19T10:05:00.000Z"
}
```

#### 3. Get Results

**Request:**
```http
GET /api/pdf/results/abc-123-def-456
```

**Response:**
```json
{
  "jobId": "abc-123-def-456",
  "filename": "exam.pdf",
  "status": "completed",
  "totalPages": 11,
  "apiCallsUsed": 3,
  "batchSize": 5,
  "results": {
    "pages": [
      {
        "page_number": 1,
        "page_text": "...",
        "quiz_data": {...},
        "diagrams": [...]
      }
    ]
  },
  "questions": [
    {
      "id": "...",
      "questionNum": "1",
      "pageNumber": 1,
      "questionText": "Consider the following numbers...",
      "parts": [
        {
          "part": "(a)",
          "question_text": "Write down the integer(s).",
          "marks": 1,
          "options": [...],
          "correct_option": "A",
          "sample_answer": "..."
        }
      ],
      "marks": 2,
      "diagrams": []
    }
  ]
}
```

## Data Flow Diagram

```
┌─────────┐
│  User   │
└────┬────┘
     │ 1. Upload PDF
     ▼
┌────────────┐
│   NestJS   │
│ Controller │
└─────┬──────┘
      │ 2. Save file & Create job
      ▼
┌────────────┐          ┌──────────┐
│   Multer   │─────────▶│  Uploads │
│  Middleware│          │   Dir    │
└────────────┘          └──────────┘
      │
      │ 3. Create job record
      ▼
┌────────────┐
│  MongoDB   │◄─────┐
│  (Prisma)  │      │ 8. Store results
└────────────┘      │
      │             │
      │ 4. Return jobId
      ▼             │
┌────────────┐      │
│   Client   │      │
└────────────┘      │
      │             │
      │ 5. Execute Python script
      ▼             │
┌────────────┐      │
│   Python   │      │
│  Executor  │      │
└─────┬──────┘      │
      │             │
      │ 6. Process PDF
      ▼             │
┌────────────┐      │
│   Python   │      │
│  Batch     │      │
│ Processor  │      │
└─────┬──────┘      │
      │             │
      │ 7. Generate results.json
      ▼             │
┌────────────┐      │
│ results.   │──────┘
│   json     │
└────────────┘
```

## Technology Stack

### Backend Framework
- **NestJS 10**: Modern TypeScript framework
- **Express**: HTTP server
- **Multer**: File upload handling

### Database
- **MongoDB**: NoSQL database
- **Prisma 5**: Type-safe ORM

### API Documentation
- **Swagger/OpenAPI**: Auto-generated API docs

### Python Integration
- **Child Process**: Spawn Python subprocess
- **IPC**: Real-time stdout/stderr streaming

### Validation & Transformation
- **class-validator**: DTO validation
- **class-transformer**: Data transformation

## Security Considerations

1. **File Upload Security**
   - MIME type validation (PDF only)
   - File size limits (default: 50MB)
   - Unique file naming to prevent collisions
   - Stored outside web root

2. **Input Validation**
   - DTOs with class-validator decorators
   - Whitelist validation (strip unknown properties)
   - Type coercion and transformation

3. **Error Handling**
   - Global exception filters
   - Sanitized error messages
   - Detailed logging for debugging

4. **API Rate Limiting** (Recommended for production)
   - Add throttler module
   - Limit uploads per IP/user

## Performance Optimizations

1. **Asynchronous Processing**
   - PDF processing runs in background
   - Immediate response to client
   - Non-blocking API endpoints

2. **Batch Processing**
   - 5 pages per API call (default)
   - Reduces API costs by 70%+
   - Configurable batch size

3. **Database Indexing**
   - `jobId` indexed for fast lookups
   - Queries optimized for status checks

4. **Streaming Logs**
   - Real-time Python output
   - Memory-efficient logging

## Scalability

### Horizontal Scaling

The architecture supports horizontal scaling:

```
┌─────────────┐
│ Load        │
│ Balancer    │
└──────┬──────┘
       │
   ┌───┴───┐
   │       │
   ▼       ▼
┌─────┐ ┌─────┐
│ App │ │ App │  (Multiple NestJS instances)
│  1  │ │  2  │
└──┬──┘ └──┬──┘
   └───┬───┘
       ▼
  ┌─────────┐
  │ MongoDB │  (Replica Set)
  └─────────┘
```

**Considerations:**
- Shared MongoDB instance
- Shared file storage (NFS, S3, etc.)
- Job queue for distributed processing (Bull, BullMQ)

### Vertical Scaling

- Increase Node.js memory limit
- More CPU cores for parallel processing
- SSD storage for faster file I/O

## Monitoring & Logging

### Built-in Logging

NestJS Logger provides:
- Timestamped logs
- Context-aware messages
- Error stack traces
- Python subprocess output

### Recommended Production Tools

- **Winston**: Advanced logging
- **Sentry**: Error tracking
- **Prometheus**: Metrics collection
- **Grafana**: Visualization

## Future Enhancements

1. **Job Queue**
   - Bull/BullMQ for distributed processing
   - Handle high upload volumes
   - Retry failed jobs

2. **WebSocket Support**
   - Real-time progress updates
   - Live processing status

3. **Caching**
   - Redis for job status caching
   - Reduce database queries

4. **S3 Storage**
   - Cloud storage for uploads/outputs
   - Better for multi-server deployments

5. **Authentication**
   - JWT-based auth
   - User-specific job access

6. **Admin Dashboard**
   - React/Vue frontend
   - Job management UI
   - Analytics and reporting

## Deployment

### Docker

See `docker-compose.yml` for containerized deployment:

```bash
docker-compose up -d
```

### Traditional Deployment

```bash
# Build
npm run build

# Run with PM2
pm2 start dist/main.js --name pdf-processor

# Or with node
node dist/main.js
```

### Environment Variables

Ensure all required variables are set:
- `DATABASE_URL`: MongoDB connection string
- `PYTHON_SCRIPT_PATH`: Path to batch processor
- `PYTHON_VENV_PATH`: Python virtual environment

## Conclusion

This architecture provides:
- ✅ Production-ready NestJS backend
- ✅ Type-safe database access with Prisma
- ✅ Seamless Python integration
- ✅ Scalable and maintainable design
- ✅ Well-documented API
- ✅ Background job processing
- ✅ Cost-efficient batch processing

The system is ready for production deployment and can scale to handle thousands of PDF processing requests.

