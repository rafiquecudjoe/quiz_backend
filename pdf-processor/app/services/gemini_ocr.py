"""
Gemini Vision OCR Service
Uses Google's Gemini Flash for accurate math OCR (FREE tier available)
"""
import google.generativeai as genai
import base64
from PIL import Image
import io
import numpy as np
from typing import Optional


class GeminiOCR:
    """Use Gemini Flash for vision-based OCR with math support"""
    
    def __init__(self, api_key: str):
        """
        Initialize Gemini OCR
        
        Args:
            api_key: Google Gemini API key (get free at https://makersuite.google.com/app/apikey)
        """
        genai.configure(api_key=api_key)
        # Use gemini-2.5-flash - stable with good free tier
        self.model = genai.GenerativeModel('gemini-2.5-flash')
    
    def extract_text_from_image(self, image: np.ndarray) -> str:
        """
        Extract text from image using Gemini Vision
        
        Args:
            image: Image as numpy array (RGB)
            
        Returns:
            Extracted text with proper math notation
        """
        try:
            # Convert numpy array to PIL Image
            pil_image = Image.fromarray(image)
            
            # Create prompt for OCR
            prompt = """Extract all text from this exam paper page, preserving the exact formatting and mathematical notation.

Instructions:
- Write mathematical expressions clearly (e.g., x², √3, fractions as a/b)
- Preserve question numbers and structure
- Keep answer spaces as [Answer: _______]
- Include all marks indicators like [1], [2], etc.
- Maintain paragraph and section breaks
- Be precise with mathematical symbols

Return only the extracted text, nothing else."""
            
            # Generate response
            response = self.model.generate_content([prompt, pil_image])
            
            return response.text.strip()
            
        except Exception as e:
            print(f"  Warning: Gemini OCR failed - {e}")
            return ""
    
    def extract_questions_from_image(self, image: np.ndarray) -> str:
        """
        Extract only questions from exam page, filtering out headers/footers
        
        Args:
            image: Image as numpy array (RGB)
            
        Returns:
            Extracted questions in structured format with numbers
        """
        try:
            # Convert numpy array to PIL Image
            pil_image = Image.fromarray(image)
            
            # Create prompt specifically for question extraction
            prompt = """Extract ONLY the exam questions from this page. Do NOT include:
- Headers, titles, school names, exam names
- Page numbers, footers, watermarks (like "KiasuExamPaper.com")
- Instructions like "Answer all questions"
- Answer blanks or spaces

FOR EACH QUESTION:
1. Start with the question number (e.g., "1", "2", "3")
2. Include all parts: (a), (b), (c), etc.
3. Preserve mathematical notation: x², √3, fractions, etc.
4. Keep mark allocations like [1], [2]
5. Separate questions with "---"

Example format:
1 Consider the following numbers.
3 √3 -4 1/√4 1/3

(a) Write down the integer(s). [1]

(b) Write down the irrational number(s). [1]

---

2 Factorise completely

(a) 2y - 14x - 8, [1]

(b) x² - 7x - 8. [2]

---

Return ONLY the questions, nothing else."""
            
            # Generate response
            response = self.model.generate_content([prompt, pil_image])
            
            return response.text.strip()
            
        except Exception as e:
            print(f"  Warning: Gemini question extraction failed - {e}")
            return ""
    
    def extract_quiz_with_answers(self, image: np.ndarray) -> str:
        """
        Extract questions in quiz format with sample answers
        
        Args:
            image: Image as numpy array (RGB)
            
        Returns:
            JSON string with questions and sample answers
        """
        try:
            print(f"    → Calling Gemini API for quiz extraction...", flush=True)
            # Convert numpy array to PIL Image
            pil_image = Image.fromarray(image)
            
            # Create prompt for quiz format with answers
            prompt = """Extract exam questions and provide sample answers in JSON format with multiple choice options.

IMPORTANT: Return ONLY valid JSON, no markdown, no code blocks, no explanations.

For each question:
1. Extract ONLY the main question text (without sub-parts) - preserve mathematical notation: x², √3, fractions
2. Each sub-part (a, b, c, etc.) goes in the "parts" array
3. Generate 4 plausible multiple choice options (A, B, C, D) for each part
4. Indicate which option is correct
5. Provide a comprehensive sample answer showing the working steps
6. Include the mark allocation

JSON Format:
{
  "questions": [
    {
      "number": "1",
      "question": "Consider the following numbers: 3, √3, -4, 1/√4, 1/3",
      "parts": [
        {
          "part": "(a)",
          "question_text": "Write down the integer(s).",
          "marks": 1,
          "options": [
            {"label": "A", "text": "3 and -4"},
            {"label": "B", "text": "3, √3, and -4"},
            {"label": "C", "text": "3 only"},
            {"label": "D", "text": "-4 only"}
          ],
          "correct_option": "A",
          "sample_answer": "The integers are: 3 and -4",
          "explanation": "Integers are whole numbers (positive, negative, or zero)"
        },
        {
          "part": "(b)",
          "question_text": "Write down the irrational number(s).",
          "marks": 1,
          "options": [
            {"label": "A", "text": "√3 and 1/√4"},
            {"label": "B", "text": "√3 only"},
            {"label": "C", "text": "1/3 and √3"},
            {"label": "D", "text": "All of them"}
          ],
          "correct_option": "B",
          "sample_answer": "The irrational number is: √3",
          "explanation": "√3 cannot be expressed as a fraction; 1/√4 = 1/2 is rational"
        }
      ]
    }
  ]
}

CRITICAL: The "question" field should NOT include the parts (a), (b), etc. Only the main question stem.

Return ONLY the JSON object, nothing else."""
            
            # Generate response with timeout handling
            print(f"    → Waiting for Gemini response...", flush=True)
            response = self.model.generate_content([prompt, pil_image])
            print(f"    ✓ Gemini response received", flush=True)
            
            return response.text.strip()
            
        except Exception as e:
            print(f"  ⚠ Warning: Gemini quiz extraction failed - {e}", flush=True)
            return ""
    
    def extract_text_and_quiz(self, image: np.ndarray) -> tuple[str, str]:
        """
        OPTIMIZED: Extract both text and quiz data in ONE API call
        
        Args:
            image: Image as numpy array (RGB)
            
        Returns:
            Tuple of (plain_text, quiz_json)
        """
        try:
            print(f"    → Single Gemini API call for text + quiz...", flush=True)
            # Convert numpy array to PIL Image
            pil_image = Image.fromarray(image)
            
            # Combined prompt for both OCR and quiz extraction
            prompt = """Extract ALL text from this exam page AND structure questions in quiz format with multiple choice options.

Return a JSON with two fields:
1. "text" - Complete OCR text with mathematical notation (x², √3, fractions)
2. "quiz" - Structured quiz data with questions, parts, options, answers

IMPORTANT: Return ONLY valid JSON, no markdown, no code blocks.

JSON Format:
{
  "text": "Full OCR text from the page with all content...",
  "quiz": {
    "questions": [
      {
        "number": "1",
        "question": "Main question stem only (no sub-parts)",
        "parts": [
          {
            "part": "(a)",
            "question_text": "Sub-question text",
            "marks": 1,
            "options": [
              {"label": "A", "text": "Option A text"},
              {"label": "B", "text": "Option B text"},
              {"label": "C", "text": "Option C text"},
              {"label": "D", "text": "Option D text"}
            ],
            "correct_option": "A",
            "sample_answer": "Detailed answer with working",
            "explanation": "Why this answer is correct"
          }
        ]
      }
    ]
  }
}

Return ONLY the JSON object."""
            
            # Generate response
            print(f"    → Waiting for Gemini response...", flush=True)
            response = self.model.generate_content([prompt, pil_image])
            print(f"    ✓ Gemini response received", flush=True)
            
            # Parse response
            import json
            result = response.text.strip()
            
            # Remove markdown code blocks if present
            if result.startswith('```'):
                result = result.split('```')[1]
                if result.startswith('json'):
                    result = result[4:]
                result = result.strip()
            
            data = json.loads(result)
            plain_text = data.get('text', '')
            quiz_data = json.dumps(data.get('quiz', {}))
            
            return plain_text, quiz_data
            
        except Exception as e:
            print(f"  ⚠ Warning: Gemini combined extraction failed - {e}", flush=True)
            return "", ""
    
    def extract_batch_quiz(self, images_with_page_nums: list[tuple[int, np.ndarray]]) -> dict[int, tuple[str, str]]:
        """
        SUPER OPTIMIZED: Extract quiz data from MULTIPLE pages in ONE API call
        
        Args:
            images_with_page_nums: List of (page_number, image) tuples
            
        Returns:
            Dict mapping page_number -> (text, quiz_json)
        """
        try:
            batch_size = len(images_with_page_nums)
            print(f"    → BATCH: Processing {batch_size} pages in 1 API call...", flush=True)
            
            # Convert all images to PIL
            pil_images = []
            page_numbers = []
            for page_num, img in images_with_page_nums:
                pil_images.append(Image.fromarray(img))
                page_numbers.append(page_num)
            
            # Batch prompt
            prompt = f"""Extract ALL text and quiz data from these {batch_size} exam pages.

Return JSON with page-by-page data:

{{
  "pages": [
    {{
      "page_number": 1,
      "text": "Full OCR text from page 1...",
      "quiz": {{
        "questions": [
          {{
            "number": "1",
            "question": "Main question (no sub-parts)",
            "parts": [
              {{
                "part": "(a)",
                "question_text": "Sub-question",
                "marks": 1,
                "options": [
                  {{"label": "A", "text": "Option A"}},
                  {{"label": "B", "text": "Option B"}},
                  {{"label": "C", "text": "Option C"}},
                  {{"label": "D", "text": "Option D"}}
                ],
                "correct_option": "A",
                "sample_answer": "Detailed answer",
                "explanation": "Why correct"
              }}
            ]
          }}
        ]
      }}
    }}
  ]
}}

CRITICAL: 
- Process pages in order: {', '.join(map(str, page_numbers))}
- Each page gets its own entry in "pages" array
- Preserve math notation: x², √3, fractions
- Generate 4 plausible multiple choice options per part
- Return ONLY valid JSON, no markdown"""
            
            # Send all images at once
            print(f"    → Waiting for Gemini batch response...", flush=True)
            content_parts = [prompt] + pil_images
            response = self.model.generate_content(content_parts)
            print(f"    ✓ Batch response received!", flush=True)
            
            # Parse batch response
            import json
            result = response.text.strip()
            
            # Remove markdown
            if result.startswith('```'):
                result = result.split('```')[1]
                if result.startswith('json'):
                    result = result[4:]
                result = result.strip()
            
            data = json.loads(result)
            
            # Map results back to page numbers
            results = {}
            for page_data in data.get('pages', []):
                page_num = page_data.get('page_number')
                text = page_data.get('text', '')
                quiz = json.dumps(page_data.get('quiz', {}))
                results[page_num] = (text, quiz)
            
            print(f"    ✅ Extracted data for {len(results)} pages in 1 call!", flush=True)
            return results
            
        except Exception as e:
            print(f"  ⚠ Warning: Batch extraction failed - {e}", flush=True)
            return {}
    
    def is_available(self) -> bool:
        """Check if Gemini API is configured and working"""
        try:
            # Test with a simple request
            test_response = self.model.generate_content("Test")
            return True
        except Exception as e:
            print(f"Gemini API not available: {e}")
            return False
