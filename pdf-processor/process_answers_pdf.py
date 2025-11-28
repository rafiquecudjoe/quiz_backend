#!/usr/bin/env python3
"""
Process Answers PDF - Extract step-by-step answers from answer PDF
Output: JSON file with structured answers linked by question number
"""

import warnings
warnings.filterwarnings('ignore', category=FutureWarning, module='google.api_core')

import sys
import os
from pathlib import Path
from app.services.pdf_processor import PDFProcessor
from app.services.gemini_answer_parser import GeminiAnswerParser
import json
from dotenv import load_dotenv


def process_answers_pdf(pdf_path: str, batch_size: int = 5):
    """
    Process answers PDF and extract step-by-step solutions
    
    Args:
        pdf_path: Path to answers PDF file
        batch_size: Number of pages to process per API call (default: 5)
    """
    print("="*70)
    print("ANSWERS PDF PROCESSOR")
    print(f"Batch size: {batch_size} pages per API call")
    print("Output: Structured step-by-step answers")
    print("="*70)
    
    # Initialize processors
    print("\nInitializing processors...")
    
    # Load API key
    load_dotenv()
    gemini_api_key = os.getenv('GEMINI_API_KEY')
    
    if not gemini_api_key:
        print("⚠ Error: GEMINI_API_KEY not found in .env file")
        sys.exit(1)
    
    answer_parser = GeminiAnswerParser(api_key=gemini_api_key)
    pdf_processor = PDFProcessor(gemini_ocr=None)
    
    print("✓ Gemini Answer Parser enabled")
    print(f"\nProcessing Answers PDF: {pdf_path}\n")
    
    # Convert PDF to images
    print("="*50)
    print("Converting PDF to images...")
    print("="*50)
    
    page_images = pdf_processor.pdf_to_images(pdf_path)
    total_pages = len(page_images)
    print(f"✓ Converted {total_pages} pages\n")
    
    # Process pages in batches
    all_answers = []
    all_pages_data = []  # Track page data with sections
    total_api_calls = 0
    current_paper_section = "Unknown"
    
    for batch_start in range(0, total_pages, batch_size):
        batch_end = min(batch_start + batch_size, total_pages)
        batch_page_images = page_images[batch_start:batch_end]
        batch_range = f"{batch_start + 1}-{batch_end}"
        
        print(f"\n{'='*50}")
        print(f"ANSWER BATCH: Pages {batch_range} ({len(batch_page_images)} pages)")
        print(f"{'='*50}")
        
        # Process each page
        for idx, page_image in enumerate(batch_page_images):
            actual_page_num = batch_start + idx + 1
            print(f"\nProcessing answers page {actual_page_num}...")
            
            total_api_calls += 1
            
            batch_results = answer_parser.extract_answers_from_batch([(actual_page_num, page_image)])
            
            # Get answers for this page
            if actual_page_num in batch_results:
                page_data = batch_results[actual_page_num]
                page_answers = page_data.get('answers', [])
                paper_section = page_data.get('paper_section', current_paper_section)
                
                # Update current section
                if paper_section and paper_section != "Unknown":
                    current_paper_section = paper_section
                
                print(f"  📄 Paper Section: {current_paper_section}")
                print(f"  ✓ Extracted {len(page_answers)} question answers")
                
                # Add paper section to each answer
                for answer in page_answers:
                    answer['paper_section'] = current_paper_section
                    all_answers.append(answer)
                    q_num = answer.get('question_num')
                    parts_count = len(answer.get('parts', []))
                    print(f"    ✓ Q{q_num}: {parts_count} part(s)")
                
                # Track page data
                all_pages_data.append({
                    'page_number': actual_page_num,
                    'paper_section': current_paper_section,
                    'answers_count': len(page_answers)
                })
            else:
                print(f"  ⚠ No answers found on page {actual_page_num}")
    
    print(f"\n{'='*50}")
    print(f"ANSWERS PDF processing complete!")
    print(f"Processed {total_pages} pages")
    print(f"🎯 Total API calls used: {total_api_calls}")
    print(f"📚 Total question answers extracted: {len(all_answers)}")
    print(f"{'='*50}\n")
    
    # Group answers by paper section
    answers_by_paper = {}
    for answer in all_answers:
        paper = answer.get('paper_section', 'Unknown')
        if paper not in answers_by_paper:
            answers_by_paper[paper] = []
        answers_by_paper[paper].append(answer)
    
    print(f"📑 Found answers for {len(answers_by_paper)} paper(s):")
    for paper, answers in answers_by_paper.items():
        print(f"   {paper}: {len(answers)} questions")
    print()
    
    # Generate combined output
    output = {
        "document_info": {
            "filename": Path(pdf_path).name,
            "total_pages": total_pages,
            "api_calls_used": total_api_calls,
            "total_answers": len(all_answers),
            "papers": list(answers_by_paper.keys()),
            "processing_complete": True
        },
        "answers": all_answers,
        "answers_by_paper": answers_by_paper
    }
    
    # Save combined results
    output_dir = Path('output/answers')
    output_dir.mkdir(parents=True, exist_ok=True)
    output_file = output_dir / 'parsed_answers.json'
    
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    
    # Save separate files for each paper
    for paper, answers in answers_by_paper.items():
        paper_filename = paper.lower().replace(' ', '_') + '_answers.json'
        paper_file = output_dir / paper_filename
        
        paper_output = {
            "document_info": {
                "filename": Path(pdf_path).name,
                "paper_section": paper,
                "total_answers": len(answers),
                "processing_complete": True
            },
            "answers": answers
        }
        
        with open(paper_file, 'w', encoding='utf-8') as f:
            json.dump(paper_output, f, indent=2, ensure_ascii=False)
        
        print(f"✓ Saved {paper} answers to: {paper_file}")
    
    print("\n" + "="*70)
    print("ANSWER PROCESSING COMPLETE!")
    print("="*70)
    print(f"Combined results saved to: {output_file.absolute()}")
    
    # Print summary
    print("\n📊 Summary by Paper and Question:")
    for paper, answers in answers_by_paper.items():
        print(f"\n  {paper}:")
        for answer in answers:
            q_num = answer.get('question_num')
            parts = answer.get('parts', [])
            print(f"    Question {q_num}: {len(parts)} part(s)")
            for part in parts[:2]:  # Show first 2 parts only
                part_label = part.get('part', '(main)')
                steps_count = len(part.get('steps', []))
                final_ans = part.get('final_answer', 'N/A')
                print(f"      {part_label}: {steps_count} steps → {final_ans}")
    
    print("\n" + "="*70)
    print("✅ ANSWERS READY TO LINK TO QUESTIONS!")
    print("💡 TIP: Use the paper-specific JSON files to link answers to the correct question paper")
    print("="*70)
    
    return output


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python process_answers_pdf.py <answers_pdf_file> [batch_size]")
        print("Example: python process_answers_pdf.py Springfield_Ans.pdf 5")
        print("\nThis script extracts step-by-step answers from answer PDF")
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    batch_size = int(sys.argv[2]) if len(sys.argv) > 2 else 5
    
    process_answers_pdf(pdf_path, batch_size)
