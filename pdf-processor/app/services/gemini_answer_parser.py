"""
Gemini Answer Parser Service
Parses step-by-step answers from answer PDF using Gemini Vision
"""
import google.generativeai as genai
from PIL import Image
import json
from typing import List, Dict
import numpy as np


class GeminiAnswerParser:
    """Parse step-by-step answers from answer PDF"""
    
    def __init__(self, api_key: str):
        """
        Initialize Gemini Answer Parser
        
        Args:
            api_key: Google Gemini API key
        """
        genai.configure(api_key=api_key)
        self.model = genai.GenerativeModel('gemini-2.0-flash-exp')
    
    def extract_answers_from_batch(
        self, 
        images_with_page_nums: List[tuple[int, np.ndarray]]
    ) -> Dict[int, Dict]:
        """
        Extract step-by-step answers from multiple pages
        
        Args:
            images_with_page_nums: List of (page_number, image) tuples
            
        Returns:
            Dict mapping page_number -> answer_data
        """
        try:
            batch_size = len(images_with_page_nums)
            print(f"    → ANSWER PARSER: Processing {batch_size} pages in 1 API call...", flush=True)
            
            # Convert all images to PIL
            pil_images = []
            page_numbers = []
            for page_num, img in images_with_page_nums:
                pil_images.append(Image.fromarray(img))
                page_numbers.append(page_num)
            
            # Enhanced prompt for answer extraction
            prompt = """Extract ALL step-by-step answers from these answer pages.

CRITICAL: PAPER SECTION DETECTION
- These answer pages may contain answers for MULTIPLE papers (e.g., "Paper 1", "Paper 2", "Section A", "Section B")
- Look for headers like "Marking Scheme Paper 1", "Paper 2 Answers", "PAPER 1", etc.
- Detect which paper section each answer belongs to
- Include "paper_section" in the output to track this

CRITICAL OUTPUT REQUIREMENTS:
1. Extract complete working/steps for each answer
2. Preserve mathematical notation and formulas exactly as written
3. Maintain answer structure (parts a, b, c, etc.)
4. Include final answers clearly marked
5. Capture any diagrams or graphs in the solutions
6. Track which paper/section each answer belongs to

For each answer, extract:
- Paper section (e.g., "Paper 1", "Paper 2", "Section A")
- Question number (e.g., "1", "5", "13")
- Part label (e.g., "(a)", "(b)", "(i)", "(ii)")
- Step-by-step working with clear explanation
- Final answer
- Mark allocation if shown

FORMATTING RULES:
1. Preserve mathematical notation using LaTeX-style format for complex expressions
2. Use line breaks (\\n) to separate steps clearly
3. For equations, format as: "Step 1: 2x + 5 = 15\\nStep 2: 2x = 10\\nStep 3: x = 5"
4. Mark final answers clearly: "Answer: x = 5" or "Final Answer: 3.5 cm²"

Return JSON with this EXACT structure:

{
  "pages": [
    {
      "page_number": 1,
      "paper_section": "Paper 1",
      "answers": [
        {
          "question_num": "1",
          "parts": [
            {
              "part": "(a)",
              "steps": [
                "Step 1: Substitute x = 3 into the expression",
                "Step 2: 2(3) + 5 = 6 + 5",
                "Step 3: = 11"
              ],
              "final_answer": "11",
              "marks": 1,
              "has_diagram": false
            },
            {
              "part": "(b)",
              "steps": [
                "Step 1: Rearrange the equation: 3x - 7 = 14",
                "Step 2: Add 7 to both sides: 3x = 21",
                "Step 3: Divide by 3: x = 7"
              ],
              "final_answer": "x = 7",
              "marks": 2,
              "has_diagram": false
            }
          ]
        }
      ]
    },
    {
      "page_number": 5,
      "paper_section": "Paper 2",
      "answers": [
        {
          "question_num": "1",
          "parts": [
            {
              "part": "",
              "steps": [
                "Step 1: Use Pythagoras' Theorem: a² + b² = c²",
                "Step 2: 3² + 4² = c²",
                "Step 3: 9 + 16 = c²",
                "Step 4: c² = 25",
                "Step 5: c = 5 cm"
              ],
              "final_answer": "5 cm",
              "marks": 3,
              "has_diagram": true
            }
          ]
        }
      ]
    }
  ]
}

IMPORTANT: 
- Always detect and include "paper_section" for each page
- If no clear paper section is indicated, use the last detected section or "Unknown"
- If an answer spans multiple lines, include all steps
- If a diagram is part of the solution, set has_diagram: true
- Extract ALL answers visible on each page
- Question numbers should match the original exam questions
"""
            
            # Send all images at once
            print(f"    → Waiting for Gemini answer extraction...", flush=True)
            content_parts = [prompt] + pil_images
            response = self.model.generate_content(content_parts)
            print(f"    ✓ Answer extraction complete!", flush=True)
            
            # Parse response
            result = response.text.strip()
            
            # Remove markdown if present
            if result.startswith('```'):
                result = result.split('```')[1]
                if result.startswith('json'):
                    result = result[4:]
                result = result.strip()
            
            data = json.loads(result, strict=False)
            
            # Map results back to page numbers
            results = {}
            gemini_pages = data.get('pages', [])
            
            for idx, page_data in enumerate(gemini_pages):
                actual_page_num = page_numbers[idx] if idx < len(page_numbers) else page_data.get('page_number', 1)
                results[actual_page_num] = page_data
            
            print(f"    ✅ Extracted answers for {len(results)} pages!", flush=True)
            return results
            
        except Exception as e:
            print(f"  ⚠ Warning: Answer extraction failed - {e}", flush=True)
            import traceback
            traceback.print_exc()
            return {}
    
    def extract_single_page_answers(self, image: np.ndarray) -> Dict:
        """
        Extract answers from a single page
        
        Args:
            image: Image as numpy array (RGB)
            
        Returns:
            Answer data for the page
        """
        results = self.extract_answers_from_batch([(1, image)])
        return results.get(1, {})
    
    def is_available(self) -> bool:
        """Check if Gemini API is configured and working"""
        try:
            test_response = self.model.generate_content("Test")
            return True
        except Exception as e:
            print(f"Gemini API not available: {e}")
            return False
