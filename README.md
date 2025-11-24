# NestJS PDF Processor Backend

A production-ready NestJS backend with Prisma ORM and MongoDB that processes exam PDFs using AI-powered batch processing.

## 🚀 Features

- **NestJS Framework**: Modern, scalable backend architecture
- **Prisma ORM**: Type-safe database access with MongoDB
- **PDF Processing**: Integrates with Python batch processor for efficient PDF analysis
- **Batch Processing**: Process multiple pages per API call to reduce costs
- **Gemini Vision AI**: Extract text and questions from PDFs with math notation support
- **RESTful API**: Well-documented endpoints with Swagger/OpenAPI
- **File Upload**: Secure PDF upload with validation
- **Job Tracking**: Monitor processing status and retrieve results
- **Database Storage**: Store processing jobs and extracted quiz questions

## 📋 Prerequisites

- Node.js 18+ and npm
- MongoDB (local or cloud instance)
- Python 3.10+ with the existing PDF processor backend setup
- Gemini API key (for OCR)

## 🛠️ Installation

### 1. Clone and Install Dependencies

```bash
cd nestjs-backend
npm install
```

### 2. Configure Environment

Copy the example environment file and configure it:

```bash
cp .env.example .env
```

Edit `.env` file:

```env
# MongoDB Connection
DATABASE_URL="mongodb://localhost:27017/pdf_processor"

# Server Configuration
PORT=3000
NODE_ENV=development

# Python Script Path (relative to project root)
PYTHON_SCRIPT_PATH=../pdf-processor-backend/test_batch_processor.py
PYTHON_VENV_PATH=../pdf-processor-backend/venv/bin/python

# File Upload Configuration
MAX_FILE_SIZE=52428800
UPLOAD_DIR=./uploads
OUTPUT_DIR=./output

# Batch Processing Configuration
BATCH_SIZE=5
```

### 3. Setup Prisma and MongoDB

Generate Prisma client:

```bash
npm run prisma:generate
```

Push the schema to MongoDB:

```bash
npm run prisma:push
```

### 4. Verify Python Environment

Make sure the Python backend is set up with required dependencies:

```bash
cd ../pdf-processor-backend
source venv/bin/activate
pip install -r requirements.txt
```

Ensure your Python backend has a `.env` file with API keys:

```env
GEMINI_API_KEY=your_gemini_api_key_here
DEEPSEEK_API_KEY=your_deepseek_api_key_here
```

## 🏃 Running the Application

### Development Mode

```bash
npm run start:dev
```

The server will start at:
- **API**: http://localhost:3000
- **Swagger Docs**: http://localhost:3000/api/docs

### Production Mode

```bash
npm run build
npm run start:prod
```

## 📚 API Documentation

### Endpoints

#### Health Check
```
GET /health
```
Returns server health status.

#### Upload and Process PDF
```
POST /api/pdf/upload
Content-Type: multipart/form-data

Parameters:
- file: PDF file (required)
- batchSize: Number of pages per API call (optional, default: 5)

Response:
{
  "jobId": "abc123",
  "filename": "exam.pdf",
  "status": "processing",
  "message": "PDF uploaded successfully. Processing started."
}
```

#### Get All Jobs
```
GET /api/pdf/jobs

Response:
{
  "jobs": [
    {
      "jobId": "abc123",
      "filename": "exam.pdf",
      "status": "completed",
      "totalPages": 11,
      "apiCallsUsed": 3,
      "createdAt": "2025-01-01T00:00:00.000Z",
      "updatedAt": "2025-01-01T00:05:00.000Z"
    }
  ]
}
```

#### Get Job Status
```
GET /api/pdf/jobs/:jobId

Response:
{
  "jobId": "abc123",
  "filename": "exam.pdf",
  "status": "completed",
  "batchSize": 5,
  "totalPages": 11,
  "apiCallsUsed": 3,
  "createdAt": "2025-01-01T00:00:00.000Z",
  "updatedAt": "2025-01-01T00:05:00.000Z"
}
```

#### Get Processing Results
```
GET /api/pdf/results/:jobId

Response:
{
  "jobId": "abc123",
  "filename": "exam.pdf",
  "status": "completed",
  "totalPages": 11,
  "apiCallsUsed": 3,
  "batchSize": 5,
  "results": {
    "pages": [...],
    "metadata": {...}
  },
  "questions": [
    {
      "id": "...",
      "questionNum": "1",
      "pageNumber": 1,
      "questionText": "Consider the following numbers...",
      "parts": [...],
      "marks": 2,
      "diagrams": [...]
    }
  ]
}
```

## 🧪 Testing

Test the API with curl:

```bash
# Upload a PDF
curl -X POST http://localhost:3000/api/pdf/upload \
  -F "file=@exam.pdf" \
  -F "batchSize=5"

# Get job status
curl http://localhost:3000/api/pdf/jobs/abc123

# Get results
curl http://localhost:3000/api/pdf/results/abc123
```

Or use the interactive Swagger UI at http://localhost:3000/api/docs

## 📊 Database Schema

### ProcessingJob
- `id`: MongoDB ObjectId
- `jobId`: Unique job identifier
- `filename`: Original PDF filename
- `status`: pending | processing | completed | failed
- `batchSize`: Pages per API call
- `totalPages`: Total pages in PDF
- `apiCallsUsed`: Number of API calls made
- `resultData`: Complete processing results (JSON)
- `timestamps`: createdAt, updatedAt

### QuizQuestion
- `id`: MongoDB ObjectId
- `jobId`: Reference to ProcessingJob
- `questionNum`: Question number
- `pageNumber`: Page where question appears
- `questionText`: Main question text
- `parts`: Array of question parts with options
- `marks`: Total marks for question
- `diagrams`: Associated diagrams

## 🏗️ Architecture

```
┌─────────────────┐
│   NestJS API    │
│  (Port 3000)    │
└────────┬────────┘
         │
         ├─── Upload PDF
         │
         ├─── Store Job (MongoDB via Prisma)
         │
         └─── Execute Python Script ──┐
                                       │
              ┌────────────────────────┘
              │
              ▼
     ┌─────────────────────┐
     │  Python Processor   │
     │  (Batch Processing) │
     └──────────┬──────────┘
                │
                ├─── Gemini Vision OCR
                ├─── Region Detection
                ├─── Quiz Extraction
                └─── Generate results.json
                         │
                         ▼
              ┌──────────────────┐
              │   Update MongoDB  │
              │   with Results    │
              └──────────────────┘
```

## 🔧 Development

### Available Scripts

```bash
npm run start:dev      # Start in watch mode
npm run build          # Build for production
npm run lint           # Run ESLint
npm run format         # Format with Prettier
npm run prisma:generate # Generate Prisma client
npm run prisma:push    # Push schema to DB
npm run prisma:studio  # Open Prisma Studio
```

### Project Structure

```
nestjs-backend/
├── prisma/
│   └── schema.prisma          # Database schema
├── src/
│   ├── app.module.ts          # Root module
│   ├── main.ts                # Application entry
│   ├── prisma/                # Prisma module
│   │   ├── prisma.module.ts
│   │   └── prisma.service.ts
│   └── pdf/                   # PDF processing module
│       ├── pdf.module.ts
│       ├── pdf.controller.ts
│       ├── pdf.service.ts
│       ├── python-executor.service.ts
│       └── dto/
│           └── upload-pdf.dto.ts
├── uploads/                   # Uploaded PDFs
├── output/                    # Processing output
├── package.json
├── tsconfig.json
└── .env                       # Environment variables
```

## 🐛 Troubleshooting

### Python Script Not Found
- Ensure `PYTHON_SCRIPT_PATH` in `.env` points to the correct location
- Use relative paths from the NestJS project root

### MongoDB Connection Error
- Check MongoDB is running: `mongosh`
- Verify `DATABASE_URL` in `.env`
- For MongoDB Atlas, whitelist your IP address

### Python Environment Issues
- Activate the virtual environment: `source ../pdf-processor-backend/venv/bin/activate`
- Install dependencies: `pip install -r requirements.txt`
- Verify Gemini API key is set in Python backend's `.env`

### File Upload Errors
- Check `MAX_FILE_SIZE` setting
- Ensure `UPLOAD_DIR` has write permissions
- Verify file is a valid PDF

## 📝 License

MIT

## 👨‍💻 Author

Built as a professional backend for the PDF processing system.

