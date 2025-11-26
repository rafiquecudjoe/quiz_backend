"""
PDF Processor Service
Handles PDF to image conversion and region detection
"""
import fitz  # PyMuPDF
from pdf2image import convert_from_path
import cv2
import numpy as np
from PIL import Image
from pathlib import Path
from typing import List, Dict, Tuple
import base64
from io import BytesIO
import pytesseract


class PDFProcessor:
    """Process PDF files and extract regions"""
    
    def __init__(self, output_dir: str = "./output", dpi: int = 300, gemini_ocr=None):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(exist_ok=True)
        self.dpi = dpi
        self.pdf_doc = None
        self.gemini_ocr = gemini_ocr  # Optional Gemini OCR instance
        
    def pdf_to_images(self, pdf_path: str) -> List[np.ndarray]:
        """
        Convert PDF pages to high-resolution images
        
        Args:
            pdf_path: Path to PDF file
            
        Returns:
            List of page images as numpy arrays
        """
        print(f"Converting PDF to images...")
        self.pdf_doc = fitz.open(pdf_path)  # Store for text extraction
        images = []
        
        for page_num in range(len(self.pdf_doc)):
            page = self.pdf_doc[page_num]
            # High resolution for better diagram quality
            mat = fitz.Matrix(self.dpi / 72, self.dpi / 72)
            pix = page.get_pixmap(matrix=mat)
            
            # Convert to numpy array
            img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(
                pix.height, pix.width, pix.n
            )
            
            # Convert RGBA to RGB if needed
            if img.shape[2] == 4:
                img = cv2.cvtColor(img, cv2.COLOR_RGBA2RGB)
            
            images.append(img)

            # Save full page image for fallback diagram usage
            try:
                page_image_path = self.output_dir / f"page_{page_num + 1}.png"
                Image.fromarray(img).save(page_image_path)
            except Exception as e:
                print(f"  ⚠ Warning: Unable to save page image {page_num + 1}: {e}")
            print(f"  Page {page_num + 1}: {img.shape[1]}x{img.shape[0]}")
        
        print(f"✓ Converted {len(images)} pages\n")
        return images
    
    def extract_text_from_page(self, page_num: int) -> str:
        """
        Extract text from a PDF page
        
        Args:
            page_num: Page number (1-indexed)
            
        Returns:
            Extracted text content
        """
        if not hasattr(self, 'pdf_doc') or self.pdf_doc is None:
            return ""
        
        try:
            page = self.pdf_doc[page_num - 1]
            text = page.get_text()
            return text.strip()
        except Exception as e:
            print(f"Error extracting text from page {page_num}: {e}")
            return ""
    
    def extract_text_with_ocr(self, page_image: np.ndarray) -> str:
        """
        Extract text from page image using OCR
        
        Args:
            page_image: Page image as numpy array (RGB)
            
        Returns:
            Extracted text content
        """
        try:
            # Convert numpy array to PIL Image
            pil_image = Image.fromarray(page_image)
            
            # Enhance image for better OCR
            # Convert to grayscale
            if pil_image.mode != 'L':
                pil_image = pil_image.convert('L')
            
            # Apply preprocessing for better OCR
            import numpy as np
            img_array = np.array(pil_image)
            
            # Increase contrast using histogram equalization
            from PIL import ImageEnhance
            pil_image = Image.fromarray(img_array)
            enhancer = ImageEnhance.Contrast(pil_image)
            pil_image = enhancer.enhance(1.5)
            
            # Perform OCR with custom config for better accuracy
            # --psm 6: Assume a single uniform block of text
            # --oem 3: Use both legacy and LSTM OCR engines
            custom_config = r'--oem 3 --psm 6'
            text = pytesseract.image_to_string(pil_image, lang='eng', config=custom_config)
            
            return text.strip()
        except Exception as e:
            print(f"  Warning: OCR failed - {e}")
            return ""
    
    def detect_regions(self, page_image: np.ndarray) -> Dict[str, List[Dict]]:
        """
        Detect text and diagram regions in a page image
        
        Args:
            page_image: Page image as numpy array
            
        Returns:
            Dictionary with text_blocks, diagram_blocks, and mixed_blocks
        """
        print("Detecting regions...")
        
        # Convert to grayscale
        gray = cv2.cvtColor(page_image, cv2.COLOR_RGB2GRAY)
        
        # Reduce noise while preserving edges
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        
        # Detect edges and close gaps to highlight thin diagram lines
        edges = cv2.Canny(blurred, 50, 150)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
        closed = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel, iterations=2)
        dilated = cv2.dilate(closed, kernel, iterations=1)
        
        # Find contours on the processed edge map
        contours, _ = cv2.findContours(
            dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )
        
        regions = {
            'text_blocks': [],
            'diagram_blocks': [],
            'mixed_blocks': []
        }
        
        # Analyze each contour
        for contour in contours:
            x, y, w, h = cv2.boundingRect(contour)
            area = w * h
            aspect_ratio = w / h if h > 0 else 0
            contour_area = cv2.contourArea(contour)
            edge_roi = edges[y:y+h, x:x+w]
            edge_pixels = cv2.countNonZero(edge_roi)
            edge_density = edge_pixels / float(w * h) if w * h > 0 else 0
            
            # Filter out very small regions (noise)
            if area < 2000:
                continue
            
            # Classify region based on heuristics
            region_info = {
                'bbox': {'x': int(x), 'y': int(y), 'width': int(w), 'height': int(h)},
                'area': int(area),
                'aspect_ratio': float(aspect_ratio)
            }
            
            # Heuristic classification
            # Diagrams tend to be larger with substantial edge density
            # OPTIMIZED: Lowered thresholds to catch smaller diagrams (like Q24-27)
            if (
                area > 10000  # Reduced from 20000 to catch smaller diagrams
                and 0.2 < aspect_ratio < 4.0  # Widened aspect ratio range
                and edge_density > 0.005  # Reduced edge density threshold
                and contour_area / area < 0.95  # Relaxed fill ratio
            ):
                regions['diagram_blocks'].append(region_info)
            # Text blocks tend to be wider
            elif aspect_ratio > 3.0:
                regions['text_blocks'].append(region_info)
            else:
                regions['mixed_blocks'].append(region_info)
        
        # If no diagram regions detected, attempt fallback using Hough lines
        if not regions['diagram_blocks']:
            lines = cv2.HoughLinesP(
                edges,
                rho=1,
                theta=np.pi / 180,
                threshold=80,  # Reduced from 150 to detect more lines
                minLineLength=80,  # Reduced from 150
                maxLineGap=30  # Increased from 20 for better connectivity
            )
            if lines is not None and len(lines) > 5:  # Need at least 5 lines for a diagram
                xs, ys = [], []
                for x1, y1, x2, y2 in lines[:, 0]:
                    xs.extend([x1, x2])
                    ys.extend([y1, y2])
                min_x, max_x = max(min(xs) - 40, 0), min(max(xs) + 40, page_image.shape[1])
                min_y, max_y = max(min(ys) - 40, 0), min(max(ys) + 40, page_image.shape[0])
                w = max_x - min_x
                h = max_y - min_y
                area = w * h
                # More lenient area check
                if area > 8000 and w > 100 and h > 100:
                    regions['diagram_blocks'].append({
                        'bbox': {'x': int(min_x), 'y': int(min_y), 'width': int(w), 'height': int(h)},
                        'area': int(area),
                        'aspect_ratio': float(w / h) if h > 0 else 0,
                        'detected_via': 'hough'
                    })
        
        print(f"  Found {len(regions['text_blocks'])} text blocks")
        print(f"  Found {len(regions['diagram_blocks'])} diagram blocks")
        print(f"  Found {len(regions['mixed_blocks'])} mixed blocks")
        
        return regions
    
    def crop_region(self, image: np.ndarray, bbox: Dict) -> np.ndarray:
        """
        Crop a region from an image
        
        Args:
            image: Source image
            bbox: Bounding box dictionary with x, y, width, height
            
        Returns:
            Cropped image
        """
        x, y, w, h = bbox['x'], bbox['y'], bbox['width'], bbox['height']
        return image[y:y+h, x:x+w]
    
    def image_to_base64(self, image: np.ndarray) -> str:
        """Convert numpy image to base64 string"""
        # Convert to PIL Image
        pil_img = Image.fromarray(cv2.cvtColor(image, cv2.COLOR_RGB2BGR))
        
        # Convert to base64
        buffered = BytesIO()
        pil_img.save(buffered, format="PNG")
        img_str = base64.b64encode(buffered.getvalue()).decode()
        
        return img_str
    
    def save_image(self, image: np.ndarray, filename: str) -> str:
        """
        Save image to output directory
        
        Args:
            image: Image as numpy array
            filename: Output filename
            
        Returns:
            Path to saved file
        """
        output_path = self.output_dir / filename
        cv2.imwrite(str(output_path), cv2.cvtColor(image, cv2.COLOR_RGB2BGR))
        return str(output_path)
    
    def process_page(self, page_image: np.ndarray, page_num: int) -> Dict:
        """
        Process a single page: detect regions and extract content
        
        Args:
            page_image: Page image
            page_num: Page number
            
        Returns:
            Dictionary with page data and regions
        """
        print(f"\nProcessing page {page_num}...")
        
        # Save full page image
        page_filename = f"page_{page_num}.png"
        page_path = self.save_image(page_image, page_filename)
        
        # Extract text from PDF (try direct extraction first)
        page_text = self.extract_text_from_page(page_num)
        
        # If minimal text found, use OCR on the image
        if len(page_text) < 100:  # Threshold for "minimal text"
            # Try Gemini OCR first (better for math), fallback to Tesseract
            if self.gemini_ocr:
                print(f"  Minimal text extracted ({len(page_text)} chars), running Gemini Vision OCR...")
                try:
                    gemini_text = self.gemini_ocr.extract_text_from_image(page_image)
                    if len(gemini_text) > len(page_text):
                        page_text = gemini_text
                        print(f"  ✓ Gemini OCR extracted {len(page_text)} characters")
                except Exception as e:
                    print(f"  ⚠ Gemini OCR failed, falling back to Tesseract: {e}")
                    ocr_text = self.extract_text_with_ocr(page_image)
                    if len(ocr_text) > len(page_text):
                        page_text = ocr_text
                        print(f"  ✓ Tesseract OCR extracted {len(page_text)} characters")
            else:
                print(f"  Minimal text extracted ({len(page_text)} chars), running Tesseract OCR...")
                ocr_text = self.extract_text_with_ocr(page_image)
                if len(ocr_text) > len(page_text):
                    page_text = ocr_text
                    print(f"  ✓ Tesseract OCR extracted {len(page_text)} characters")
        else:
            print(f"  ✓ Extracted {len(page_text)} characters from PDF")
        
        # Extract structured questions using Gemini if available (OPTIMIZED: Single API call)
        questions_text = ""
        quiz_data = ""
        if self.gemini_ocr:
            print(f"  🚀 OPTIMIZED: Single Gemini API call for OCR + Quiz...")
            try:
                gemini_text, quiz_data = self.gemini_ocr.extract_text_and_quiz(page_image)
                
                # Use Gemini text if better than direct PDF extraction
                if len(gemini_text) > len(page_text):
                    page_text = gemini_text
                    print(f"  ✓ Got {len(page_text)} chars text + {len(quiz_data)} chars quiz (1 API call)")
                else:
                    print(f"  ✓ Using PDF text + quiz data from single API call")
                    
            except Exception as e:
                print(f"  ⚠ Gemini extraction failed: {e}")
        
        # Detect regions
        regions = self.detect_regions(page_image)
        
        # Extract and save diagram crops
        diagram_crops = []
        for idx, diagram_region in enumerate(regions['diagram_blocks']):
            cropped = self.crop_region(page_image, diagram_region['bbox'])
            crop_filename = f"page_{page_num}_diagram_{idx}.png"
            crop_path = self.save_image(cropped, crop_filename)
            
            diagram_crops.append({
                'crop_path': crop_path,
                'bbox': diagram_region['bbox'],
                'base64': self.image_to_base64(cropped)
            })
        
        return {
            'page_number': page_num,
            'page_image_path': page_path,
            'page_text': page_text,
            'page_questions': questions_text,
            'quiz_data': quiz_data,
            'regions': regions,
            'diagram_crops': diagram_crops
        }
    
    def process_pdf(self, pdf_path: str) -> List[Dict]:
        """
        Complete PDF processing pipeline
        
        Args:
            pdf_path: Path to PDF file
            
        Returns:
            List of processed page data
        """
        print(f"\n{'='*50}")
        print(f"Starting PDF processing: {pdf_path}")
        print(f"{'='*50}\n")
        
        try:
            # Convert to images
            page_images = self.pdf_to_images(pdf_path)
            
            # Process each page
            results = []
            for idx, page_image in enumerate(page_images):
                page_data = self.process_page(page_image, idx + 1)
                results.append(page_data)
            
            print(f"\n{'='*50}")
            print(f"PDF processing complete!")
            print(f"Processed {len(results)} pages")
            print(f"{'='*50}\n")
            
            return results
        finally:
            # Close PDF document
            if hasattr(self, 'pdf_doc') and self.pdf_doc is not None:
                self.pdf_doc.close()
                self.pdf_doc = None
