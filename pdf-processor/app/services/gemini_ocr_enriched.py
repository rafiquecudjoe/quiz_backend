"""
Enhanced Gemini Vision OCR Service with Auto-Enrichment
Uses Google's Gemini Flash for accurate math OCR + automatic metadata extraction
"""
import google.generativeai as genai
import base64
from PIL import Image
import io
import numpy as np
from typing import Optional
import json
import ast
from pathlib import Path


class GeminiOCREnriched:
    """Enhanced Gemini OCR with automatic question enrichment"""
    
    def __init__(self, api_key: str):
        """
        Initialize Gemini OCR with enrichment capabilities
        
        Args:
            api_key: Google Gemini API key
        """
        genai.configure(api_key=api_key)
        self.model = genai.GenerativeModel('gemini-2.0-flash-exp')
    
    def extract_enriched_batch_quiz(
        self, 
        images_with_page_nums: list[tuple[int, np.ndarray]]
    ) -> dict[int, dict]:
        """
        Extract quiz data with AUTOMATIC ENRICHMENT from multiple pages
        
        Returns enriched format ready for adaptive learning platform:
        - Topic detection
        - Difficulty assessment
        - Question type classification
        - Keywords extraction
        - Learning outcomes
        - Time estimates
        
        Args:
            images_with_page_nums: List of (page_number, image) tuples
            
        Returns:
            Dict mapping page_number -> enriched_data
        """
        try:
            batch_size = len(images_with_page_nums)
            print(f"    → ENRICHED BATCH: Processing {batch_size} pages in 1 API call...", flush=True)
            
            # Convert all images to PIL
            pil_images = []
            page_numbers = []
            for page_num, img in images_with_page_nums:
                pil_images.append(Image.fromarray(img))
                page_numbers.append(page_num)
            
            # Enhanced batch prompt with auto-enrichment
            prompt = """Extract ALL text and quiz data from these exam pages WITH AUTOMATIC ENRICHMENT.

⚠️ IMPORTANT: When generating step-by-step answers, be CONCISE and ACCURATE. 
Double-check all math internally BEFORE writing. NEVER show self-corrections or errors.
Students need clean, professional, error-free solutions.

CRITICAL OUTPUT FORMAT REQUIREMENTS:
1. ALL parts of a question MUST be grouped under ONE question object (same question number)
2. Each question object should have ALL its parts (a), (b), (c), etc. in the same "parts" array
3. Dependent parts (that use "Hence", "Therefore", etc.) MUST include context from previous parts directly in their question_text
4. PRESERVE FORMATTING: 
   - For number lists, add commas and spaces: "3, √3, -4, 1/√4, 1, 3" (not "3√3-4 1 1/√4")
   - For simultaneous equations: MUST separate with line breaks (\\n) - each equation on its own line
   - Format: "Solve the simultaneous equations:\\n  2x + 5y = 8\\n  x + 3y = 6"
   - NEVER put both equations on same line: "2x + 5y = 8 x + 3y = 6" ❌
5. Generate MULTIPLE-CHOICE OPTIONS for *every* question part (if applicable, or create plausible options if the question is open-ended):
   - Include exactly 4 options labeled A, B, C, D.
   - Ensure one option is correct and mark it as "correct_option" (e.g., "A", "B").
   - Provide plausible distractors for the incorrect options. For open-ended questions, generate options that represent common correct and incorrect answers.
6. Generate STEP-BY-STEP ANSWERS for EVERY question part - CRITICAL REQUIREMENTS:
   - Be CONCISE and DIRECT - verify your work mentally BEFORE writing
   - NO self-correction, NO "let's try again", NO error acknowledgments
   - NO verbose explanations or thinking out loud
   - Maximum 4-5 steps for most problems (keep it simple!)
   - Format with numbered "Step X:" labels
   - Show ONLY the correct mathematical working
   - Use proper mathematical notation
   - End with "**Final Answer:**" followed by the answer
   - Separate steps with double newline (\\n\\n)
   - IMPORTANT: Double-check your math BEFORE generating the answer
   - Example format (CONCISE):
     "Step 1: Multiply equation 2 by -2\\n-2x - 6y = -12\\n\\nStep 2: Add to equation 1\\n2x + 5y + (-2x - 6y) = 8 - 12\\n-y = -4\\ny = 4\\n\\nStep 3: Substitute y = 4 into equation 2\\nx + 3(4) = 6\\nx = -6\\n\\n**Final Answer:** x = -6, y = 4"
7. This format will be used directly in database and frontend - NO further processing needed

DIAGRAM DETECTION INSTRUCTIONS (CRITICAL FOR MULTIPLE DIAGRAMS):
For EACH question that has a diagram, graph, chart, table, or visual element:
1. Identify the EXACT location of the diagram on the page
2. Provide precise bounding box coordinates in the "enrichment" object as "diagram_bbox"
3. Format: {"x": left_pixel, "y": top_pixel, "width": width_pixels, "height": height_pixels}
4. If a page has MULTIPLE diagrams for different questions, provide SEPARATE bounding boxes for EACH question
5. Set "requires_diagram": true for questions that reference visual elements
6. Include a brief "diagram_description" describing what the diagram shows

Example for a page with 3 diagrams:
- Question 1 has a bar chart at top: diagram_bbox: {"x": 50, "y": 100, "width": 400, "height": 300}
- Question 2 has a triangle diagram in middle: diagram_bbox: {"x": 50, "y": 500, "width": 350, "height": 250}
- Question 3 has a coordinate grid at bottom: diagram_bbox: {"x": 50, "y": 900, "width": 400, "height": 400}

CHAPTER DETECTION INSTRUCTIONS:
If the exam paper is identified as "Secondary 2 (Normal Academic - Grade 2)" or similar, you MUST detect the specific chapter from the following list and include it in the "enrichment" object as "chapter".

Also detect the specific Grade level and include it as "question_level":
IMPORTANT: There are ONLY 3 valid grade levels:
- "Grade 1" (for Normal Academic)
- "Grade 2" 
- "Grade 3"

Detection rules:
- Look for explicit Grade mentions like "Grade 1", "Grade 2", "Grade 3" in the paper header/title
- If the paper says "Secondary 2 (Normal Academic - Grade 2)", the question_level should be "Grade 2"
- If the paper says "Normal Academic" (without explicit grade), the question_level should be "Grade 2"
- NEVER use other grade numbers like "Grade 4", "Grade 8", etc. - only use Grade 1, 2, or 3
- Ensure "question_level" is populated for EVERY question using one of these 3 values

Chapter List:

Secondary 2 Normal Academic (G2) Math Lobby – Full Chapter Compilation (Chapters 1–14)
Chapter 1 – Linear Expressions, Linear Equations and Simple Inequalities
Chapter 2 – Linear Functions and Graphs
Chapter 3 – Simultaneous Linear Equations
Chapter 4 – Expansion and Factorisation of Algebraic Expressions
Chapter 5 – Expansion and Factorisation Using Special Algebraic Identities
Chapter 6 – Algebraic Fractions
Chapter 7 – Direct and Inverse Proportion
Chapter 8 – Polygons and Geometrical Constructions
Chapter 9 – Congruence and Similarity
Chapter 10 – Pythagoras' Theorem
Chapter 11 – Volume and Surface Area of Pyramids, Cones and Spheres
Chapter 12 – Probability of Single Events
Chapter 13 – Statistical Diagrams
Chapter 14 – Averages of Statistical Data

If the paper does not match this level/stream, use your best judgment for the topic/chapter.

Return JSON with this EXACT structure:

{
  "pages": [
    {
      "page_number": 1,
      "text": "Full OCR text from page...",
      "quiz": {
        "questions": [
          {
            "number": "1",
            "question": "Main question stem (if exists, otherwise null)",
            "parts": [
              {
                "part": "(a)",
                "question_text": "First sub-question text",
                "marks": 1,
                "options": [
                  {"label": "A", "text": "Option A"},
                  {"label": "B", "text": "Option B"},
                  {"label": "C", "text": "Option C"},
                  {"label": "D", "text": "Option D"}
                ],
                "correct_option": "A",
                "sample_answer": "Detailed answer with working",
                "explanation": "Why this is correct",
                "step_by_step_answer": "Step 1: Set up the equation\\n2x + 3 = 9\\n\\nStep 2: Subtract 3 from both sides\\n2x = 6\\n\\nStep 3: Divide both sides by 2\\nx = 3\\n\\n**Final Answer:** x = 3",
                "hints": [
                  "Hint 1: A gentle nudge in the right direction without revealing too much",
                  "Hint 2: A more specific hint that guides toward the solution method"
                ]
              },
              {
                "part": "(b)",
                "question_text": "Hence, find the value of 3x - 1. [Given: x = 5]",
                "marks": 2,
                "options": [],
                "correct_option": null,
                "sample_answer": "3(5) - 1 = 15 - 1 = 14",
                "explanation": "Substitute x = 5 from part (a) into 3x - 1",
                "step_by_step_answer": "Step 1: Use x from part (a)\\nx = 5\\n\\nStep 2: Substitute into 3x - 1\\n3(5) - 1\\n\\nStep 3: Simplify\\n= 15 - 1\\n= 14\\n\\n**Final Answer:** 14",
                "hints": [
                  "Use the value of x found in part (a)",
                  "Substitute x = 5 into the expression 3x - 1"
                ]
              }
            ],
            "enrichment": {
              "topic": "Algebra - Linear Equations",
              "chapter": "Chapter 1 – Linear Expressions, Linear Equations and Simple Inequalities",
              "difficulty": "medium",
              "question_level": "Grade 2",
              "keywords": ["linear equations", "algebra"],
              "learning_outcomes": ["Solve linear equations", "Understand substitution"],
              "time_estimate_minutes": 5,
              "requires_diagram": true,
              "diagram_bbox": {"x": 50, "y": 100, "width": 400, "height": 300},
              "diagram_description": "Bar chart showing frequency distribution"
            }
          }
        ]
      }
    }
  ]
}
"""

            # Send all images at once
            print(f"    → Waiting for Gemini enriched batch response...", flush=True)
            content_parts = [prompt] + pil_images
            response = self.model.generate_content(content_parts)
            print(f"    ✓ Enriched batch response received!", flush=True)
            
            # Parse batch response
            result = response.text.strip()
            
            # Debug: Save raw response for inspection
            debug_path = Path('output/gemini_debug_response.json')
            debug_path.parent.mkdir(exist_ok=True)
            with open(debug_path, 'w') as f:
                f.write(result)
            
            # Remove markdown if present
            if result.startswith('```'):
                result = result.split('```')[1]
                if result.startswith('json'):
                    result = result[4:]
                result = result.strip()
            
            try:
                data = json.loads(result, strict=False)
            except json.JSONDecodeError as e:
                print(f"    ⚠ JSON Decode Error: {str(e)} - Trying fallback parsing...", flush=True)
                try:
                    # Fix common LLM JSON errors
                    # 1. Replace single quotes with double quotes (risky but worth a try if ast fails)
                    # 2. Handle Python-style booleans/None if using ast.literal_eval
                    
                    # Try ast.literal_eval which handles single quotes and Python syntax
                    # First convert JSON null/true/false to Python None/True/False
                    python_style = result.replace('null', 'None').replace('true', 'True').replace('false', 'False')
                    data = ast.literal_eval(python_style)
                    print(f"    ✓ Fallback parsing successful using ast.literal_eval!", flush=True)
                except Exception as e2:
                    print(f"    ❌ Fallback parsing failed: {str(e2)}", flush=True)
                    # Last ditch effort: regex cleanup for trailing commas
                    try:
                        clean_json = re.sub(r',\s*([\]}])', r'\1', result)
                        data = json.loads(clean_json, strict=False)
                        print(f"    ✓ Fallback parsing successful using regex cleanup!", flush=True)
                    except Exception as e3:
                        raise e # Re-raise original error if all fallbacks fail
            
            # Map results back to page numbers
            # IMPORTANT: Gemini always returns page_number:1, so we need to map using our input page numbers
            results = {}
            gemini_pages = data.get('pages', [])
            
            for idx, page_data in enumerate(gemini_pages):
                # Use the actual page number from our input, not from Gemini's response
                actual_page_num = page_numbers[idx] if idx < len(page_numbers) else page_data.get('page_number', 1)
                results[actual_page_num] = page_data
            
            print(f"    ✅ Extracted ENRICHED data for {len(results)} pages in 1 call!", flush=True)
            return results
            
        except Exception as e:
            print(f"  ⚠ Warning: Enriched batch extraction failed - {e}", flush=True)
            import traceback
            traceback.print_exc()
            return {}
    
    def extract_single_enriched_quiz(self, image: np.ndarray) -> dict:
        """
        Extract enriched quiz data from a single page
        
        Args:
            image: Image as numpy array (RGB)
            
        Returns:
            Enriched page data
        """
        results = self.extract_enriched_batch_quiz([(1, image)])
        return results.get(1, {})
    
    def is_available(self) -> bool:
        """Check if Gemini API is configured and working"""
        try:
            test_response = self.model.generate_content("Test")
            return True
        except Exception as e:
            print(f"Gemini API not available: {e}")
            return False

