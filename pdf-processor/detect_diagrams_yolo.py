#!/usr/bin/env python3
"""
Advanced layout-based diagram detection (lightweight, no ML models needed)
Uses enhanced computer vision techniques without heavy dependencies
"""

import cv2
import numpy as np
from pathlib import Path
from PIL import Image

class AdvancedLayoutDetector:
    """Advanced diagram detection using pure OpenCV (no ML models)"""
    
    def __init__(self):
        """Initialize detector"""
        print("✓ Advanced layout detector initialized")
    
    def detect_diagrams(self, image_path, confidence_threshold=0.25):
        """
        Detect diagrams using advanced layout analysis
        
        Args:
            image_path: Path to page image
            confidence_threshold: Minimum confidence (0-1)
            
        Returns:
            List of diagram detections with bounding boxes
        """
        try:
            # Read image
            img = cv2.imread(str(image_path))
            if img is None:
                return []
                
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            height, width = gray.shape
            
            diagrams = []
            
            # Strategy 1: Morphological operations to find diagram regions
            # Apply morphological closing to connect diagram elements
            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 15))
            closed = cv2.morphologyEx(gray, cv2.MORPH_CLOSE, kernel)
            
            # Threshold
            _, thresh = cv2.threshold(closed, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
            
            # Find contours
            contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            
            for contour in contours:
                x, y, w, h = cv2.boundingRect(contour)
                area = w * h
                
                # Filter criteria for diagrams
                min_area = 15000
                max_area = width * height * 0.4
                
                if (min_area < area < max_area and 
                    0.2 < w/h < 5.0 and  # Aspect ratio
                    w < width * 0.7 and h < height * 0.7):  # Not too large
                    
                    # Calculate confidence based on features
                    contour_area = cv2.contourArea(contour)
                    bbox_area = w * h
                    fill_ratio = contour_area / bbox_area if bbox_area > 0 else 0
                    
                    # Diagrams usually have medium fill ratio (not too sparse, not solid)
                    confidence = 50 + (fill_ratio * 30) + (min(area/50000, 1.0) * 20)
                    
                    diagrams.append({
                        'bbox': (x, y, x + w, y + h),
                        'area': area,
                        'confidence': round(min(confidence, 95), 1),
                        'source': 'morphological_analysis'
                    })
            
            # Strategy 2: Blob detection for circular/structured diagrams
            params = cv2.SimpleBlobDetector_Params()
            params.filterByArea = True
            params.minArea = 1000
            params.filterByCircularity = False
            params.filterByConvexity = False
            params.filterByInertia = False
            
            detector = cv2.SimpleBlobDetector_create(params)
            keypoints = detector.detect(gray)
            
            if len(keypoints) > 5:  # Multiple blobs might indicate a diagram
                # Find bounding box of all keypoints
                if keypoints:
                    xs = [kp.pt[0] for kp in keypoints]
                    ys = [kp.pt[1] for kp in keypoints]
                    x1, x2 = int(min(xs)), int(max(xs))
                    y1, y2 = int(min(ys)), int(max(ys))
                    w, h = x2 - x1, y2 - y1
                    area = w * h
                    
                    if area > 20000:
                        diagrams.append({
                            'bbox': (x1, y1, x2, y2),
                            'area': area,
                            'confidence': 75.0,
                            'source': 'blob_detection'
                        })
            
            # Remove duplicates (overlapping detections)
            filtered_diagrams = []
            diagrams = sorted(diagrams, key=lambda x: x['confidence'], reverse=True)
            
            for diag in diagrams:
                x1, y1, x2, y2 = diag['bbox']
                is_overlap = False
                
                for existing in filtered_diagrams:
                    ex1, ey1, ex2, ey2 = existing['bbox']
                    overlap_x = max(0, min(x2, ex2) - max(x1, ex1))
                    overlap_y = max(0, min(y2, ey2) - max(y1, ey1))
                    overlap_area = overlap_x * overlap_y
                    
                    if overlap_area > diag['area'] * 0.5:
                        is_overlap = True
                        break
                
                if not is_overlap:
                    filtered_diagrams.append(diag)
            
            print(f"  ✓ Advanced layout detected {len(filtered_diagrams)} potential diagrams")
            for i, d in enumerate(filtered_diagrams[:3]):
                bbox = d['bbox']
                w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
                print(f"    #{i+1}: {w}x{h}px, conf={d['confidence']}%")
            
            return filtered_diagrams
            
        except Exception as e:
            print(f"  ⚠ Advanced layout detection failed: {e}")
            return []
    
    def detect_with_layout_analysis(self, image_path):
        """
        Alternative: Use layout analysis approach
        Detects large connected components that might be diagrams
        """
        try:
            # Read image
            img = cv2.imread(str(image_path))
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            
            # Adaptive thresholding
            thresh = cv2.adaptiveThreshold(
                gray, 255,
                cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                cv2.THRESH_BINARY_INV, 11, 2
            )
            
            # Find contours
            contours, _ = cv2.findContours(
                thresh,
                cv2.RETR_EXTERNAL,
                cv2.CHAIN_APPROX_SIMPLE
            )
            
            diagrams = []
            
            for contour in contours:
                x, y, w, h = cv2.boundingRect(contour)
                area = w * h
                
                # Filter for diagram-like regions
                if (area > 15000 and area < 400000 and 
                    0.2 < w/h < 5.0):  # Reasonable aspect ratio
                    
                    # Calculate confidence based on features
                    perimeter = cv2.arcLength(contour, True)
                    circularity = 4 * np.pi * area / (perimeter * perimeter) if perimeter > 0 else 0
                    confidence = min(50 + circularity * 50, 85)
                    
                    diagrams.append({
                        'bbox': (x, y, x + w, y + h),
                        'area': area,
                        'confidence': round(confidence, 1),
                        'source': 'layout_analysis'
                    })
            
            # Sort by area (larger diagrams first)
            diagrams = sorted(diagrams, key=lambda x: x['area'], reverse=True)
            
            return diagrams[:5]  # Top 5
            
        except Exception as e:
            print(f"  ⚠ Layout analysis failed: {e}")
            return []


def detect_diagrams_yolo(image_path, output_dir='output'):
    """
    Main function: Advanced layout detection (lightweight, no ML needed)
    """
    print(f"Using advanced layout detector for {Path(image_path).name}...")
    
    detector = AdvancedLayoutDetector()
    
    # Try advanced detection first
    diagrams = detector.detect_diagrams(image_path)
    
    # Fallback to simpler layout analysis if nothing found
    if not diagrams:
        print("  → Falling back to simpler layout analysis")
        diagrams = detector.detect_with_layout_analysis(image_path)
    
    return diagrams


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python detect_diagrams_yolo.py <image_path>")
        sys.exit(1)
    
    image_path = sys.argv[1]
    diagrams = detect_diagrams_yolo(image_path)
    
    if diagrams:
        image = Image.open(image_path)
        output_dir = Path('output')
        output_dir.mkdir(exist_ok=True)
        
        for idx, diag in enumerate(diagrams[:3]):
            x1, y1, x2, y2 = diag['bbox']
            
            # Add padding
            padding = 20
            x1 = max(0, x1 - padding)
            y1 = max(0, y1 - padding)
            x2 = min(image.width, x2 + padding)
            y2 = min(image.height, y2 + padding)
            
            crop = image.crop((x1, y1, x2, y2))
            
            filename = f"{Path(image_path).stem}_yolo_diagram_{idx+1}.png"
            save_path = output_dir / filename
            crop.save(save_path, optimize=True)
            
            print(f"  ✓ Saved: {filename}")
    else:
        print("  ⚠ No diagrams detected")
