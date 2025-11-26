"""
AI Processor Service
Handles DeepSeek API integration for text parsing and diagram description
"""
from openai import OpenAI
from typing import Dict, List, Optional
import json
import base64
import os


class AIProcessor:
    """Process content using DeepSeek AI"""
    
    def __init__(self, api_key: str, api_base: str = "https://api.deepseek.com/v1"):
        """
        Initialize AI processor with DeepSeek credentials
        
        Args:
            api_key: DeepSeek API key
            api_base: API base URL (default: https://api.deepseek.com/v1)
        """
        self.client = OpenAI(
            api_key=api_key,
            base_url=api_base
        )
        self.model = "deepseek-chat"  # Default model for text
        self.vision_model = "deepseek-chat"  # Model for vision tasks
        
    def parse_question_text(self, text: str) -> Dict:
        """
        Parse question text into structured JSON
        
        Args:
            text: Raw question text from OCR
            
        Returns:
            Structured question data
        """
        print("Parsing question text with DeepSeek AI...")
        
        prompt = f"""
You are an expert at parsing exam questions. Given the following text extracted from an exam paper, 
parse it into structured JSON format.

Text:
{text}

Return a JSON object with the following structure:
{{
    "questions": [
        {{
            "question_number": "1(a)" or "Question 1",
            "question_text": "The actual question text",
            "marks": 5,
            "question_type": "calculation|proof|explanation|diagram",
            "parts": ["part a text", "part b text"] if multiple parts,
            "has_diagram": true|false
        }}
    ]
}}

Only return valid JSON, no additional text.
"""
        
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": "You are an expert exam question parser. Always respond with valid JSON."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.1,
                response_format={"type": "json_object"}
            )
            
            result = json.loads(response.choices[0].message.content)
            print(f"  Parsed {len(result.get('questions', []))} questions")
            return result
            
        except Exception as e:
            print(f"  Error parsing question: {e}")
            return {
                "questions": [],
                "error": str(e),
                "raw_text": text
            }
    
    def describe_diagram(self, diagram_base64: str, context: str = "") -> Dict:
        """
        Describe a diagram using DeepSeek vision model
        
        Note: DeepSeek's current API doesn't support vision/image inputs like OpenAI.
        This is a placeholder that returns basic diagram info without AI analysis.
        For production, consider using:
        - OpenAI GPT-4V
        - Google Gemini Vision
        - Anthropic Claude with vision
        - Or a dedicated OCR + diagram detection model
        
        Args:
            diagram_base64: Base64 encoded diagram image
            context: Optional context about the diagram
            
        Returns:
            Diagram description and analysis
        """
        print("Processing diagram (Vision API not available with current DeepSeek model)...")
        
        # For now, return a placeholder structure
        # In production, you'd integrate with a vision-capable model
        return {
            "diagram_type": "diagram",
            "description": "Diagram extracted from PDF (AI analysis requires vision-capable model)",
            "key_elements": ["Diagram image saved for manual review or future AI analysis"],
            "measurements": {},
            "labels": [],
            "mathematical_notation": [],
            "is_recreatable": False,
            "recreation_instructions": None,
            "note": "DeepSeek API doesn't support vision inputs. Consider using OpenAI GPT-4V, Google Gemini, or Claude for diagram analysis."
        }
    
    def extract_text_from_region(self, region_base64: str) -> str:
        """
        Extract text from a region using vision model
        
        Note: DeepSeek doesn't support vision. Use pytesseract or similar OCR in production.
        
        Args:
            region_base64: Base64 encoded region image
            
        Returns:
            Extracted text (placeholder)
        """
        print("Skipping text extraction (requires OCR or vision-capable model)...")
        return ""
    
    def analyze_page(self, page_data: Dict) -> Dict:
        """
        Analyze complete page: extract text and describe diagrams
        
        Args:
            page_data: Page data from PDFProcessor
            
        Returns:
            Enhanced page data with AI analysis
        """
        page_num = page_data['page_number']
        print(f"\n{'='*50}")
        print(f"AI Analysis - Page {page_num}")
        print(f"{'='*50}\n")
        
        # Parse questions from extracted text
        questions = []
        page_text = page_data.get('page_text', '')
        if page_text:
            print(f"\nParsing questions from text...")
            try:
                parsed = self.parse_question_text(page_text)
                questions = parsed.get('questions', [])
                print(f"✓ Found {len(questions)} questions")
            except Exception as e:
                print(f"Error parsing questions: {e}")
        
        # Analyze diagrams
        diagram_descriptions = []
        for idx, diagram_crop in enumerate(page_data.get('diagram_crops', [])):
            print(f"\nAnalyzing diagram {idx + 1}...")
            description = self.describe_diagram(diagram_crop['base64'])
            diagram_descriptions.append({
                'diagram_index': idx,
                'bbox': diagram_crop['bbox'],
                'image_path': diagram_crop['crop_path'],
                'analysis': description
            })
        
        result = {
            **page_data,
            'questions': questions,
            'diagrams_analyzed': diagram_descriptions,
            'ai_processed': True
        }
        
        print(f"\nPage {page_num} AI analysis complete!")
        return result
    
    def generate_structured_output(self, processed_pages: List[Dict]) -> Dict:
        """
        Generate final structured output from all processed pages
        
        Args:
            processed_pages: List of processed page data
            
        Returns:
            Complete structured document
        """
        print("\n" + "="*50)
        print("Generating structured output...")
        print("="*50 + "\n")
        
        output = {
            "document_info": {
                "total_pages": len(processed_pages),
                "processing_complete": True
            },
            "pages": []
        }
        
        for page_data in processed_pages:
            page_summary = {
                "page_number": page_data['page_number'],
                "page_image": page_data['page_image_path'],
                "page_text": page_data.get('page_text', ''),
                "page_questions": page_data.get('page_questions', ''),
                "quiz_data": page_data.get('quiz_data', ''),
                "questions": page_data.get('questions', []),
                "regions_detected": {
                    "text_blocks": len(page_data['regions']['text_blocks']),
                    "diagram_blocks": len(page_data['regions']['diagram_blocks']),
                    "mixed_blocks": len(page_data['regions']['mixed_blocks'])
                },
                "diagrams": page_data.get('diagrams_analyzed', [])
            }
            output['pages'].append(page_summary)
        
        print("Structured output generated successfully!")
        return output
