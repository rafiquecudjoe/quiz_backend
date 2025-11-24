#!/bin/bash

# Test email sending after quiz completion

echo "=== Testing Email Service - Quiz Completion ==="
echo ""

# Test 1: Simple email test endpoint
echo "Test 1: Testing email service directly with /pdf/test-email"
echo ""

curl -X POST http://localhost:3000/pdf/test-email \
  -H "Content-Type: application/json" \
  -d '{
    "userEmail": "rafique@eyesonground.com",
    "userName": "Test User"
  }' \
  -w "\n\nStatus: %{http_code}\n\n"

echo ""
echo "---"
echo ""

# Test 2: Simulate quiz submission with sample data
echo "Test 2: Simulating quiz submission (this should send results email)"
echo ""

# First, let's get all jobs to see if we have questions
echo "Fetching available jobs..."
JOBS_RESPONSE=$(curl -s http://localhost:3000/pdf/jobs)
echo "Jobs Response: $JOBS_RESPONSE"
echo ""

# Get a sample job ID from the response
JOB_ID=$(echo "$JOBS_RESPONSE" | grep -o '"jobId":"[^"]*"' | head -1 | sed 's/"jobId":"\(.*\)"/\1/')

if [ -z "$JOB_ID" ]; then
  echo "❌ No jobs found. Need to upload a PDF first."
  echo ""
  echo "To test the full flow:"
  echo "1. Upload a PDF: POST /pdf/upload"
  echo "2. Wait for processing to complete"
  echo "3. Get questions: GET /pdf/jobs/{jobId}/questions"
  echo "4. Submit quiz with answers"
else
  echo "✅ Found Job ID: $JOB_ID"
  echo ""
  echo "Fetching questions for this job..."
  
  QUESTIONS_RESPONSE=$(curl -s "http://localhost:3000/pdf/jobs/$JOB_ID/questions?minConfidence=0")
  QUESTION_IDS=$(echo "$QUESTIONS_RESPONSE" | grep -o '"id":"[^"]*"' | sed 's/"id":"\(.*\)"/\1/' | head -3)
  
  if [ -z "$QUESTION_IDS" ]; then
    echo "❌ No questions found for job $JOB_ID"
  else
    echo "✅ Found questions: $(echo $QUESTION_IDS | tr '\n' ' ')"
    echo ""
    echo "Submitting quiz with sample answers..."
    
    # Create JSON array of question IDs
    IDS_JSON=$(echo "$QUESTION_IDS" | sed 's/^/"/; s/$/"/' | paste -sd ',' - | sed 's/^/[/; s/$/]/')
    
    # Create answers object (all multiple choice answers)
    ANSWERS_JSON="{"
    for QID in $QUESTION_IDS; do
      ANSWERS_JSON="$ANSWERS_JSON\"$QID\":\"A\","
    done
    ANSWERS_JSON="${ANSWERS_JSON%,}}"
    
    echo "Question IDs: $IDS_JSON"
    echo "Answers: $ANSWERS_JSON"
    echo ""
    
    curl -X POST http://localhost:3000/pdf/quiz/submit \
      -H "Content-Type: application/json" \
      -d "{
        \"userName\": \"Test User\",
        \"userEmail\": \"rafique@eyesonground.com\",
        \"questionIds\": $(echo "$QUESTION_IDS" | sed 's/^/"/; s/$/"/' | paste -sd ',' - | sed 's/^/[/; s/$/]/'),
        \"answers\": $ANSWERS_JSON
      }" \
      -w "\n\nStatus: %{http_code}\n\n"
  fi
fi

echo ""
echo "=== Test Complete ==="
echo ""
echo "Check your email for the quiz results!"
