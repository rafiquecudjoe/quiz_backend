/**
 * Example Node.js client for the NestJS PDF Processor API
 * 
 * This demonstrates how to interact with the API programmatically.
 * You can run this with: node example-client.js
 */

const fs = require('fs');
const FormData = require('form-data');
const axios = require('axios');

const API_BASE_URL = 'http://localhost:3000';
const PDF_FILE_PATH = '../pdf-processor-backend/exam.pdf';

/**
 * Helper function to delay execution
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Upload a PDF file for processing
 */
async function uploadPDF(filePath, batchSize = 5) {
  console.log('\n📤 Uploading PDF...');
  
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath));
  form.append('batchSize', batchSize);

  try {
    const response = await axios.post(
      `${API_BASE_URL}/api/pdf/upload`,
      form,
      {
        headers: form.getHeaders(),
      }
    );

    console.log('✅ Upload successful!');
    console.log('Response:', response.data);
    return response.data;
  } catch (error) {
    console.error('❌ Upload failed:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Get the status of a processing job
 */
async function getJobStatus(jobId) {
  try {
    const response = await axios.get(
      `${API_BASE_URL}/api/pdf/jobs/${jobId}`
    );
    return response.data;
  } catch (error) {
    console.error('❌ Failed to get job status:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Poll job status until it's completed or failed
 */
async function waitForCompletion(jobId, maxAttempts = 30) {
  console.log('\n⏳ Waiting for processing to complete...');
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const status = await getJobStatus(jobId);
    
    console.log(`Attempt ${attempt}/${maxAttempts}: Status = ${status.status}`);
    
    if (status.status === 'completed') {
      console.log('✅ Processing completed!');
      return status;
    } else if (status.status === 'failed') {
      console.error('❌ Processing failed:', status.errorMessage);
      throw new Error(`Processing failed: ${status.errorMessage}`);
    }
    
    // Wait 5 seconds before next check
    await sleep(5000);
  }
  
  throw new Error('Processing timeout - job did not complete in expected time');
}

/**
 * Get the processing results
 */
async function getResults(jobId) {
  console.log('\n📊 Fetching results...');
  
  try {
    const response = await axios.get(
      `${API_BASE_URL}/api/pdf/results/${jobId}`
    );
    
    console.log('✅ Results retrieved successfully!');
    return response.data;
  } catch (error) {
    console.error('❌ Failed to get results:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Get all jobs
 */
async function getAllJobs() {
  console.log('\n📋 Fetching all jobs...');
  
  try {
    const response = await axios.get(
      `${API_BASE_URL}/api/pdf/jobs`
    );
    
    console.log(`✅ Found ${response.data.jobs.length} jobs`);
    return response.data.jobs;
  } catch (error) {
    console.error('❌ Failed to get jobs:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Check API health
 */
async function checkHealth() {
  console.log('\n🏥 Checking API health...');
  
  try {
    const response = await axios.get(`${API_BASE_URL}/health`);
    console.log('✅ API is healthy!');
    console.log('Response:', response.data);
    return response.data;
  } catch (error) {
    console.error('❌ Health check failed:', error.message);
    throw error;
  }
}

/**
 * Main function - demonstrates the complete workflow
 */
async function main() {
  console.log('='.repeat(70));
  console.log('  NestJS PDF Processor - Example Client');
  console.log('='.repeat(70));

  try {
    // Step 1: Health check
    await checkHealth();

    // Step 2: Upload PDF
    const uploadResult = await uploadPDF(PDF_FILE_PATH, 5);
    const jobId = uploadResult.jobId;

    // Step 3: Wait for processing to complete
    const finalStatus = await waitForCompletion(jobId);

    // Step 4: Get results
    const results = await getResults(jobId);

    // Display summary
    console.log('\n' + '='.repeat(70));
    console.log('  Processing Summary');
    console.log('='.repeat(70));
    console.log(`Job ID: ${results.jobId}`);
    console.log(`Filename: ${results.filename}`);
    console.log(`Total Pages: ${results.totalPages}`);
    console.log(`API Calls Used: ${results.apiCallsUsed}`);
    console.log(`Batch Size: ${results.batchSize}`);
    console.log(`Questions Extracted: ${results.questions.length}`);

    if (results.totalPages && results.apiCallsUsed) {
      const efficiency = ((results.totalPages - results.apiCallsUsed) / results.totalPages * 100).toFixed(1);
      console.log(`Efficiency Gain: ${efficiency}% reduction in API calls`);
    }

    // Display first question
    if (results.questions.length > 0) {
      const firstQuestion = results.questions[0];
      console.log('\n📝 First Question:');
      console.log(`  Question ${firstQuestion.questionNum}: ${firstQuestion.questionText}`);
      console.log(`  Page: ${firstQuestion.pageNumber}`);
      console.log(`  Total Marks: ${firstQuestion.marks}`);
      console.log(`  Parts: ${firstQuestion.parts.length}`);
    }

    // Optionally, get all jobs
    const allJobs = await getAllJobs();
    console.log(`\n📊 Total jobs in database: ${allJobs.length}`);

    console.log('\n' + '='.repeat(70));
    console.log('  ✅ All operations completed successfully!');
    console.log('='.repeat(70));

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

// Run the example
if (require.main === module) {
  main().catch(console.error);
}

// Export functions for use in other scripts
module.exports = {
  uploadPDF,
  getJobStatus,
  waitForCompletion,
  getResults,
  getAllJobs,
  checkHealth,
};

