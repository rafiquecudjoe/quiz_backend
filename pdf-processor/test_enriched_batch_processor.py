#!/usr/bin/env python3
"""
ENRICHED BATCH PDF Processor - Process PDF with AUTO-ENRICHMENT
Outputs questions in adaptive learning platform format with:
- Automatic topic detection
- Difficulty assessment  
- Keywords and learning outcomes
- All metadata for adaptive learning
"""

import warnings
# Suppress Python version warning from Google API
warnings.filterwarnings('ignore', category=FutureWarning, module='google.api_core')

import sys
import time
import os
from pathlib import Path
from app.services.pdf_processor import PDFProcessor
from app.services.gemini_ocr_enriched import GeminiOCREnriched
import numpy as np
import cv2
import json
from PIL import Image

def enriched_batch_process_pdf(pdf_path: str, batch_size: int = 5):
    """
    Process PDF with batched API calls AND auto-enrichment
    
    Args:
        pdf_path: Path to PDF file
        batch_size: Number of pages to process per API call (default: 5)
    """
    from PIL import Image
    
    print("="*70)
    print("ENRICHED BATCH PDF PROCESSOR")
    print(f"Batch size: {batch_size} pages per API call")
    print("Output: Questions with automatic metadata for adaptive learning")
    print("="*70)
    
    # Initialize processors
    print("\nInitializing processors...")
    
    # Load API key from environment
    import os
    from dotenv import load_dotenv
    load_dotenv()
    
    gemini_api_key = os.getenv('GEMINI_API_KEY')
    
    if not gemini_api_key:
        print("⚠ Error: GEMINI_API_KEY not found in .env file")
        sys.exit(1)
    
    gemini_ocr = GeminiOCREnriched(api_key=gemini_api_key)
    pdf_processor = PDFProcessor(gemini_ocr=None)  # We'll handle OCR separately
    
    print("✓ Enhanced Gemini Vision OCR enabled")
    print(f"\nProcessing PDF: {pdf_path}\n")
    
    # Convert PDF to images first
    print("="*50)
    print("Converting PDF to images...")
    print("="*50)
    
    page_images = pdf_processor.pdf_to_images(pdf_path)
    total_pages = len(page_images)
    print(f"✓ Converted {total_pages} pages\n")
    
    # Process pages in batches with enrichment
    enriched_questions = []
    total_api_calls = 0
    
    # Rate limiting configuration
    REQUESTS_PER_MINUTE = 8  # Stay under 10 RPM limit (with buffer)
    SECONDS_BETWEEN_REQUESTS = 60 / REQUESTS_PER_MINUTE  # 7.5 seconds
    
    for batch_start in range(0, total_pages, batch_size):
        # Rate limiting: Wait between batches (except first one)
        if batch_start > 0:
            print(f"\n⏱️  Rate limiting: Waiting {SECONDS_BETWEEN_REQUESTS:.1f}s to stay under API limits...")
            time.sleep(SECONDS_BETWEEN_REQUESTS)
        batch_end = min(batch_start + batch_size, total_pages)
        batch_page_images = page_images[batch_start:batch_end]
        batch_range = f"{batch_start + 1}-{batch_end}"
        
        print(f"\n{'='*50}")
        print(f"ENRICHED BATCH: Pages {batch_range} ({len(batch_page_images)} pages)")
        print(f"{'='*50}")
        
        # Process each page individually (Gemini API doesn't batch multiple images properly)
        for idx, page_image in enumerate(batch_page_images):
            actual_page_num = batch_start + idx + 1
            print(f"\nProcessing page {actual_page_num}...")
            
            # Single API call per page with ENRICHMENT
            print(f"🚀 Processing page {actual_page_num} with enrichment...")
            total_api_calls += 1
            
            batch_results = gemini_ocr.extract_enriched_batch_quiz([(actual_page_num, page_image)])
            
            # Get enriched results for this page
            if actual_page_num in batch_results:
                page_data = batch_results[actual_page_num]
                page_text = page_data.get('text', '')
                quiz_data = page_data.get('quiz', {})
                
                print(f"  ✓ Got {len(page_text)} chars text")
                if quiz_data is None:
                    quiz_data = {}
                print(f"  ✓ Got {len(quiz_data.get('questions', []))} enriched questions")
                
                # Extract enriched questions
                for question in quiz_data.get('questions', []):
                    enrichment = question.get('enrichment', {})
                    
                    # Use hybrid AI detection for better diagram extraction
                    diagrams = []
                    output_dir = Path('output')
                    page_snapshot = output_dir / f'page_{actual_page_num}.png'
                    
                    # Check if we should detect diagrams - COMPREHENSIVE CHECK
                    question_text = question.get('question', '') or ''
                    parts_text = ' '.join(
                        part.get('question_text', '') or '' for part in question.get('parts', [])
                    )
                    question_type = question.get('question_type') or enrichment.get('question_type')
                    
                    # Enhanced diagram detection - check keywords first
                    text_content = (question_text + ' ' + parts_text).lower()
                    diagram_keywords = ['diagram', 'figure', 'graph', 'chart', 'plot', 'sketch', 'grid', 'map', 'shape', 'triangle', 'circle', 'polygon', 'quadrilateral', 'coordinate', 'dot diagram']
                    has_diagram_keyword = any(keyword in text_content for keyword in diagram_keywords)
                    
                    needs_diagram = (
                        has_diagram_keyword
                        or question_type == 'diagram_based'
                        or enrichment.get('requires_diagram', False) is True
                    )
                    
                    if needs_diagram and page_snapshot.exists():
                        # Tier 1: Run hybrid AI detection (best accuracy)
                        try:
                            from detect_diagrams_hybrid import detect_diagrams_hybrid
                            detected = detect_diagrams_hybrid(str(page_snapshot))
                            
                            if detected:
                                # Save detected diagrams
                                from PIL import Image
                                page_img = Image.open(page_snapshot)
                                
                                # Filter out low confidence detections to prefer fallback
                                high_conf_detected = [d for d in detected if d.get('confidence', 0) > 85]
                                
                                for idx, diag_info in enumerate(high_conf_detected[:3]):  # Take up to 3 high-confidence detections
                                    x1, y1, x2, y2 = diag_info['bbox']
                                    padding = 40
                                    x1 = max(0, x1 - padding)
                                    y1 = max(0, y1 - padding)
                                    x2 = min(page_img.width, x2 + padding)
                                    y2 = min(page_img.height, y2 + padding)
                                    
                                    crop = page_img.crop((x1, y1, x2, y2))
                                    # Use index in filename to support multiple diagrams
                                    suffix = f"_{idx+1}" if idx > 0 else ""
                                    diagram_name = f'page_{actual_page_num}_diagram_ai{suffix}.png'
                                    diagram_path = output_dir / diagram_name
                                    crop.save(diagram_path, optimize=True)
                                    
                                    confidence = diag_info.get('confidence', 0)
                                    diagrams.append({
                                        'local_path': f'output/{diagram_name}',
                                        'filename': diagram_name,
                                        'page_number': actual_page_num,
                                        'file_size': os.path.getsize(diagram_path),
                                        'source': 'hybrid_ai_detection',
                                        'confidence': confidence,
                                        'area': diag_info.get('area'),
                                        'density': diag_info.get('density')
                                    })
                                    w = x2 - x1
                                    h = y2 - y1
                                    print(f"      ✓ AI detected diagram: {w}x{h} px (confidence: {confidence:.1f}%)")
                        except Exception as e:
                            print(f"      ⚠ Hybrid AI detection failed: {e}")
                        
                        # Tier 2: Try YOLOv8 if hybrid detection found nothing
                        if not diagrams and needs_diagram:
                            try:
                                print(f"      → Trying YOLOv8 fallback...")
                                from detect_diagrams_yolo import detect_diagrams_yolo
                                yolo_detected = detect_diagrams_yolo(str(page_snapshot))
                                
                                if yolo_detected:
                                    from PIL import Image
                                    page_img = Image.open(page_snapshot)
                                    
                                    for idx, diag_info in enumerate(yolo_detected[:3]):  # Take up to 3 detections
                                        x1, y1, x2, y2 = diag_info['bbox']
                                        padding = 40
                                        x1 = max(0, x1 - padding)
                                        y1 = max(0, y1 - padding)
                                        x2 = min(page_img.width, x2 + padding)
                                        y2 = min(page_img.height, y2 + padding)
                                        
                                        crop = page_img.crop((x1, y1, x2, y2))
                                        # Use index in filename to support multiple diagrams
                                        suffix = f"_{idx+1}" if idx > 0 else ""
                                        diagram_name = f'page_{actual_page_num}_diagram_yolo{suffix}.png'
                                        diagram_path = output_dir / diagram_name
                                        crop.save(diagram_path, optimize=True)
                                        
                                        confidence = diag_info.get('confidence', 0)
                                        diagrams.append({
                                            'local_path': f'output/{diagram_name}',
                                            'filename': diagram_name,
                                            'page_number': actual_page_num,
                                            'file_size': os.path.getsize(diagram_path),
                                            'source': 'yolov8_detection',
                                            'confidence': confidence,
                                            'area': diag_info.get('area')
                                        })
                                        w = x2 - x1
                                        h = y2 - y1
                                        print(f"      ✓ YOLOv8 detected diagram: {w}x{h} px (confidence: {confidence:.1f}%)")
                            except Exception as e:
                                print(f"      ⚠ YOLOv8 detection failed: {e}")
                                # Tier 3: Final fallback to existing detected diagrams
                                for diagram_file in output_dir.glob(f'page_{actual_page_num}_diagram_*.png'):
                                    diagrams.append({
                                        'local_path': f'output/{diagram_file.name}',
                                        'filename': diagram_file.name,
                                        'page_number': actual_page_num,
                                        'file_size': os.path.getsize(diagram_file)
                                    })
                    
                    # If Gemini provided diagram_bbox, use it to create a precise crop
                    diagram_bbox = enrichment.get('diagram_bbox')
                    if diagram_bbox and not diagrams:
                        page_snapshot = output_dir / f'page_{actual_page_num}.png'
                        if page_snapshot.exists():
                            try:
                                from PIL import Image
                                img = Image.open(page_snapshot)
                                x = diagram_bbox.get('x', 0)
                                y = diagram_bbox.get('y', 0)
                                w = diagram_bbox.get('width', img.width)
                                h = diagram_bbox.get('height', img.height)
                                
                                # Add padding
                                padding = 50
                                x = max(0, x - padding)
                                y = max(0, y - padding)
                                w = min(img.width - x, w + 2*padding)
                                h = min(img.height - y, h + 2*padding)
                                
                                cropped = img.crop((x, y, x + w, y + h))
                                gemini_crop_name = f'page_{actual_page_num}_diagram_gemini.png'
                                gemini_crop_path = output_dir / gemini_crop_name
                                cropped.save(gemini_crop_path)
                                
                                diagrams.append({
                                    'local_path': f'output/{gemini_crop_name}',
                                    'filename': gemini_crop_name,
                                    'page_number': actual_page_num,
                                    'file_size': os.path.getsize(gemini_crop_path),
                                    'source': 'gemini_bbox'
                                })
                                print(f"      ✓ Created diagram from Gemini bbox: {w}x{h} at ({x},{y})")
                            except Exception as e:
                                print(f"      ⚠ Failed to crop using Gemini bbox: {e}")

                    # Fallback: if no diagram crops were detected but the question references a diagram,
                    # use Gemini to intelligently locate the diagram on the page
                    # (needs_diagram was already calculated above)
                    
                    if needs_diagram and not diagrams:
                        page_snapshot = output_dir / f'page_{actual_page_num}.png'
                        if page_snapshot.exists():
                            try:
                                from PIL import Image
                                import json
                                
                                # Ask Gemini to locate the diagram
                                print(f"      🤖 Using Gemini to locate diagram on page {actual_page_num}...")
                                page_img = Image.open(page_snapshot)
                                
                                # Construct prompt to get diagram location
                                question_context = question.get('question', '') or ''
                                parts_summary = ' '.join(part.get('question_text', '')[:100] for part in question.get('parts', [])[:2])
                                
                                locate_prompt = f"""This page contains a diagram for the following question:
"{question_context[:200]} {parts_summary[:200]}"

Please analyze this page and return ONLY a JSON object with the bounding box of the diagram/chart/graph/table that relates to this question.
Also provide a confidence score (0-100) indicating how sure you are that this is the correct diagram.

Return format:
{{"bbox": {{"x": <left>, "y": <top>, "width": <width>, "height": <height>}}, "type": "<diagram type>", "confidence": <0-100>}}

If you cannot find a relevant diagram, return: {{"bbox": null, "type": "none", "confidence": 0}}
"""
                                
                                import google.generativeai as genai
                                response = gemini_ocr.model.generate_content([locate_prompt, page_img])
                                result_text = response.text.strip()
                                
                                # Parse JSON from response
                                if result_text.startswith('```'):
                                    result_text = result_text.split('```')[1]
                                    if result_text.startswith('json'):
                                        result_text = result_text[4:]
                                    result_text = result_text.strip()
                                
                                diagram_location = json.loads(result_text)
                                
                                if diagram_location.get('bbox') and diagram_location['bbox']:
                                    bbox = diagram_location['bbox']
                                    x, y, w, h = bbox['x'], bbox['y'], bbox['width'], bbox['height']
                                    
                                    # Add padding
                                    padding = 50
                                    x = max(0, x - padding)
                                    y = max(0, y - padding)
                                    w = min(page_img.width - x, w + 2*padding)
                                    h = min(page_img.height - y, h + 2*padding)
                                    
                                    # Crop the diagram
                                    cropped = page_img.crop((x, y, x + w, y + h))
                                    fallback_name = f'page_{actual_page_num}_diagram_gemini_fallback.png'
                                    fallback_path = output_dir / fallback_name
                                    cropped.save(fallback_path)
                                    
                                    # Use Gemini's confidence score
                                    confidence_score = float(diagram_location.get('confidence', 60.0))
                                    
                                    diagrams.append({
                                        'local_path': f'output/{fallback_name}',
                                        'filename': fallback_name,
                                        'page_number': actual_page_num,
                                        'file_size': os.path.getsize(fallback_path),
                                        'source': 'gemini_intelligent_fallback',
                                        'confidence': confidence_score,
                                        'is_page_snapshot': False
                                    })
                                    print(f"      ✓ Gemini located diagram: {w}x{h} at ({x},{y}) - Type: {diagram_location.get('type', 'unknown')}")
                                else:
                                    # Gemini couldn't find diagram, use simple crop as last resort
                                    print(f"      ⚠ Gemini couldn't locate specific diagram, using conservative crop")
                                    crop_height = int(page_img.height * 0.5)
                                    crop_start = int(page_img.height * 0.25)
                                    tight = page_img.crop((0, crop_start, page_img.width, crop_start + crop_height))
                                    
                                    fallback_name = f'page_{actual_page_num}_diagram_fallback.png'
                                    fallback_path = output_dir / fallback_name
                                    tight.save(fallback_path)
                                    
                                    diagrams.append({
                                        'local_path': f'output/{fallback_name}',
                                        'filename': fallback_name,
                                        'page_number': actual_page_num,
                                        'file_size': os.path.getsize(fallback_path),
                                        'source': 'fallback_heuristic',
                                        'confidence': 70.0,
                                        'is_page_snapshot': True
                                    })
                                    
                            except Exception as e:
                                print(f"      ⚠ Gemini fallback failed: {e}, using basic crop")
                                import traceback
                                traceback.print_exc()
                                # Final fallback to simple crop
                                page_img = Image.open(page_snapshot)
                                crop_height = int(page_img.height * 0.5)
                                crop_start = int(page_img.height * 0.25)
                                tight = page_img.crop((0, crop_start, page_img.width, crop_start + crop_height))
                                
                                fallback_name = f'page_{actual_page_num}_diagram_fallback.png'
                                fallback_path = output_dir / fallback_name
                                tight.save(fallback_path)
                                
                                diagrams.append({
                                    'local_path': f'output/{fallback_name}',
                                    'filename': fallback_name,
                                    'page_number': actual_page_num,
                                    'file_size': os.path.getsize(fallback_path),
                                    'source': 'fallback_heuristic',
                                    'confidence': 70.0,
                                    'is_page_snapshot': True
                                })
                    
                    
                    enriched_question = {
                        'page_number': actual_page_num,
                        'question_num': question.get('number'),
                        'question_text': question.get('question'),
                        'parts': question.get('parts', []),
                        'diagrams': diagrams,  # Add local diagram references
                        
                        # Enrichment metadata
                        'topic': enrichment.get('topic'),
                        'chapter': enrichment.get('chapter'),
                        'subject': enrichment.get('subject'),
                        'school_level': enrichment.get('school_level') or enrichment.get('level') or 'Secondary 2',
                        'question_level': enrichment.get('question_level'),
                        'difficulty': enrichment.get('difficulty'),
                        'question_type': enrichment.get('question_type'),
                        'time_estimate_minutes': enrichment.get('time_estimate_minutes'),
                        'learning_outcomes': enrichment.get('learning_outcomes', []),
                        'keywords': enrichment.get('keywords', []),
                        'prerequisite_topics': enrichment.get('prerequisite_topics', []),
                        'common_mistakes': enrichment.get('common_mistakes', []),
                        
                        # Calculate total marks
                        'marks': sum(part.get('marks') or 0 for part in question.get('parts', [])),
                        
                        # Status
                        'status': 'draft',  # Needs admin verification
                        'is_verified': False,
                    }
                    
                    # Skip questions with no content (no question_text and no parts)
                    if not enriched_question['question_text'] and not enriched_question['parts']:
                        print(f"    ⚠ Skipping empty Q{question.get('number')} (no text or parts)")
                        continue
                    
                    enriched_questions.append(enriched_question)
                    
                    diagram_note = f" [{len(diagrams)} diagram(s)]" if diagrams else ""
                    school_level = enrichment.get('school_level') or enrichment.get('level') or 'Secondary 2'
                    print(f"    ✓ Q{question.get('number')}: {enrichment.get('topic')} "
                          f"({enrichment.get('difficulty')}, {school_level}){diagram_note}")
            else:
                print(f"  ⚠ No data for page {actual_page_num}")
    
    print(f"\n{'='*50}")
    print(f"ENRICHED PDF processing complete!")
    print(f"Processed {total_pages} pages")
    print(f"🎯 Total API calls used: {total_api_calls}")
    print(f"📚 Total enriched questions: {len(enriched_questions)}")
    print(f"{'='*50}\n")
    
    # Generate output in adaptive learning platform format
    output = {
        "document_info": {
            "filename": Path(pdf_path).name,
            "total_pages": total_pages,
            "api_calls_used": total_api_calls,
            "total_questions": len(enriched_questions),
            "processing_complete": True
        },
        "enriched_questions": enriched_questions
    }
    
    # Save results
    output_dir = Path('output/enriched')
    output_dir.mkdir(parents=True, exist_ok=True)
    output_file = output_dir / 'enriched_questions.json'
    
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    
    print("="*70)
    print("ENRICHED PROCESSING COMPLETE!")
    print("="*70)
    print(f"Results saved to: {output_file.absolute()}")

    # AUTOMATIC COPY TO FRONTEND
    # Try to find the frontend public folder and copy results + diagrams
    frontend_paths = [
        Path('../../bbc-main/public'),
        Path('../../frontend-quiz')
    ]
    
    for frontend_dir in frontend_paths:
        if frontend_dir.exists():
            print(f"\n🔄 Copying data to frontend: {frontend_dir}")
            
            # Copy JSON
            import shutil
            try:
                shutil.copy2(output_file, frontend_dir / 'enriched_questions.json')
                print(f"  ✓ Copied enriched_questions.json")
                
                # Copy diagrams
                diagrams_dir = frontend_dir / 'diagrams'
                diagrams_dir.mkdir(exist_ok=True)
                
                # Copy all PNGs from output to diagrams dir
                source_output = Path('output')
                count = 0
                for png_file in source_output.glob('*.png'):
                    shutil.copy2(png_file, diagrams_dir / png_file.name)
                    count += 1
                print(f"  ✓ Copied {count} diagram images to {diagrams_dir}")
                
            except Exception as e:
                print(f"  ⚠ Error copying to frontend: {e}")
    
    # Print summary by topic
    print("\n📊 Summary by Topic:")
    topics = {}
    for q in enriched_questions:
        topic = q.get('topic', 'Unknown')
        if topic not in topics:
            topics[topic] = {'easy': 0, 'medium': 0, 'hard': 0, 'total': 0}
        
        difficulty_raw = q.get('difficulty', 'medium')
        # Handle None and ensure it's normalized to lowercase
        difficulty = (difficulty_raw.lower() if difficulty_raw and isinstance(difficulty_raw, str) else 'medium')
        if difficulty not in topics[topic]:
            difficulty = 'medium'  # Default to medium if unknown
        topics[topic][difficulty] += 1
        topics[topic]['total'] += 1
    
    for topic, counts in sorted(topics.items()):
        print(f"  {topic}:")
        print(f"    Total: {counts['total']} questions")
        print(f"    Easy: {counts['easy']}, Medium: {counts['medium']}, Hard: {counts['hard']}")
    
    print("\n" + "="*70)
    print("✅ QUESTIONS READY FOR ADAPTIVE LEARNING PLATFORM!")
    print(f"💰 Efficiency: {((total_pages - total_api_calls) / total_pages * 100):.1f}% reduction in API calls")
    print("="*70)
    
    return output

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python test_enriched_batch_processor.py <pdf_file> [batch_size]")
        print("Example: python test_enriched_batch_processor.py exam.pdf 5")
        print("\nThis script outputs questions with automatic enrichment:")
        print("  - Topic detection")
        print("  - Difficulty assessment")
        print("  - Keywords and learning outcomes")
        print("  - Ready for adaptive learning platform")
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    batch_size = int(sys.argv[2]) if len(sys.argv) > 2 else 5
    
    enriched_batch_process_pdf(pdf_path, batch_size)

