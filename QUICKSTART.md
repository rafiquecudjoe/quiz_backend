# 🚀 Quick Start - Get Running in 5 Minutes

This guide will get you up and running as fast as possible.

## Prerequisites Check

```bash
# Check Node.js (need 18+)
node --version

# Check npm
npm --version

# Check MongoDB (if running locally)
mongosh --version

# Check Python (for existing backend)
python3 --version
```

## 1. Install Dependencies (1 minute)

```bash
cd nestjs-backend
npm install
```

## 2. Setup MongoDB (30 seconds)

**Option A - Local MongoDB:**
```bash
sudo systemctl start mongod
```

**Option B - MongoDB Atlas (cloud):**
1. Go to https://mongodb.com/cloud/atlas
2. Create free cluster
3. Get connection string
4. Update `.env` with your connection string

## 3. Configure Environment (30 seconds)

The `.env` file is already created. Just verify it has correct paths:

```bash
cat .env
```

Should look like:
```env
DATABASE_URL="mongodb://localhost:27017/pdf_processor"
PORT=3000
PYTHON_SCRIPT_PATH=../pdf-processor-backend/test_batch_processor.py
PYTHON_VENV_PATH=../pdf-processor-backend/venv/bin/python
```

## 4. Setup Prisma (30 seconds)

```bash
npm run prisma:generate
npm run prisma:push
```

## 5. Start the Server (30 seconds)

```bash
npm run start:dev
```

You should see:
```
======================================================================
🚀 NestJS PDF Processor Backend
======================================================================
📍 Server: http://localhost:3000
📖 API Docs: http://localhost:3000/api/docs
🗄️  Database: MongoDB
======================================================================
```

## 6. Test It! (2 minutes)

**Option A - Use the test script:**
```bash
./test-api.sh
```

**Option B - Use Swagger UI:**
1. Open http://localhost:3000/api/docs
2. Click on `POST /api/pdf/upload`
3. Click "Try it out"
4. Upload a PDF file
5. Click "Execute"

**Option C - Use curl:**
```bash
curl -X POST http://localhost:3000/api/pdf/upload \
  -F "file=@../pdf-processor-backend/exam.pdf" \
  -F "batchSize=5"
```

## That's It! 🎉

You now have a running NestJS backend that can:
- ✅ Accept PDF uploads
- ✅ Process them with AI
- ✅ Store results in MongoDB
- ✅ Return structured quiz data

## Next Steps

- 📖 Read [README.md](README.md) for detailed documentation
- 🏗️ See [ARCHITECTURE.md](ARCHITECTURE.md) for technical details
- 📚 Check [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md) for overview

## Common Issues

### "Cannot connect to MongoDB"
```bash
# Check MongoDB is running
mongosh

# If not running
sudo systemctl start mongod
```

### "PYTHON_SCRIPT_PATH not found"
```bash
# Verify the Python backend exists
ls -la ../pdf-processor-backend/test_batch_processor.py

# Make sure path in .env is correct
```

### "Python script failed"
```bash
# Test Python backend independently
cd ../pdf-processor-backend
source venv/bin/activate
python test_batch_processor.py exam.pdf 5
```

## Development Commands

```bash
npm run start:dev      # Development with auto-reload
npm run build          # Build for production
npm run start:prod     # Run production build
npm run lint           # Lint code
npm run format         # Format code
npm run prisma:studio  # Open database GUI
```

## Need Help?

1. Check logs in the console
2. Open Swagger docs: http://localhost:3000/api/docs
3. Review full documentation in README.md

Happy coding! 🚀

