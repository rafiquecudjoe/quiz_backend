#!/usr/bin/env python3
"""
Advanced diagram detection combining multiple computer vision techniques
"""

from PIL import Image
from pathlib import Path
import cv2
import numpy as np

def detect_diagrams_hybrid(image_path, output_dir='output'):
    """
    Hybrid approach: Edge detection + Contour analysis + Density mapping + Grid detection
    """
    
    print(f"Detecting diagrams in {Path(image_path).name}...")
    
    # Load image
    image = cv2.imread(str(image_path))
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    height, width = gray.shape
    
    # Strategy 1: Edge-based detection
    edges = cv2.Canny(gray, 30, 100)
    
    # Dilate edges to connect nearby elements
    kernel = np.ones((5, 5), np.uint8)
    dilated_edges = cv2.dilate(edges, kernel, iterations=3)
    
    # Find contours on dilated edges
    contours, _ = cv2.findContours(dilated_edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    # Strategy 2: Density-based detection
    # Create a grid and measure edge density in each cell
    grid_size = 100
    density_map = np.zeros((height // grid_size + 1, width // grid_size + 1))
    
    for i in range(0, height, grid_size):
        for j in range(0, width, grid_size):
            cell = edges[i:i+grid_size, j:j+grid_size]
            density_map[i // grid_size, j // grid_size] = np.sum(cell) / (grid_size * grid_size)
    
    # Find regions with high edge density (likely diagrams)
    threshold = np.percentile(density_map, 90)  # Top 10% density
    high_density_regions = density_map > threshold
    
    # Strategy 3: Grid detection for coordinate geometry
    grid_diagrams = detect_coordinate_grids(gray, edges, width, height)
    
    diagrams = []
    
    # Process contours
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        area = w * h
        
        # Check if this region overlaps with high-density areas
        center_x, center_y = x + w // 2, y + h // 2
        grid_x, grid_y = center_y // grid_size, center_x // grid_size
        
        if grid_x < density_map.shape[0] and grid_y < density_map.shape[1]:
            region_density = density_map[grid_x, grid_y]
        else:
            region_density = 0
        
        # Filters - balanced to catch valid diagrams without false positives
        is_large_enough = area > 10000  # 10k pixels minimum (was 15k - too strict)
        max_area = width * height * 0.35  # Max 35% of page area (was 15% - too strict)
        is_not_too_large = area < max_area
        is_not_full_width = w < width * 0.65  # Max 65% of page width (was 40% - too strict)
        is_not_full_height = h < height * 0.60  # Max 60% of page height (was 40% - too strict)
        aspect_ratio = w / h if h > 0 else 0
        is_reasonable = 0.3 < aspect_ratio < 4.0  # More flexible aspect ratio (was 0.4-2.5)
        has_content = region_density > threshold * 0.65  # High density requirement (was 0.8 - too strict)
        
        # Debug print for ALL significant regions to help troubleshooting
        if area > 50000:  # Print for regions > 50k pixels
            print(f"    Contour: {w}x{h}px ({area}px), max={max_area:.0f}, large_ok={is_large_enough}, size_ok={is_not_too_large}, width_ok={is_not_full_width}, height_ok={is_not_full_height}, aspect_ok={is_reasonable}, density_ok={has_content}")
        
        # Require: reasonable size, not full page, good aspect ratio, high density
        if (is_large_enough and is_not_too_large and is_not_full_width and 
            is_not_full_height and is_reasonable and has_content):
            
            # Calculate confidence score (0-100)
            # Factors: density, size, aspect ratio, edge content
            density_score = min(region_density / threshold, 1.0) * 40  # Max 40 points
            size_score = min(area / 100000, 1.0) * 30  # Max 30 points (100k pixels = full score)
            aspect_score = 20 if 0.3 < aspect_ratio < 3.0 else 10  # 20 points for good aspect ratio
            edge_score = min(np.sum(edges[y:y+h, x:x+w]) / area * 100, 10)  # Max 10 points
            
            confidence = density_score + size_score + aspect_score + edge_score
            
            diagrams.append({
                'bbox': (x, y, x + w, y + h),
                'area': area,
                'density': region_density,
                'confidence': round(min(confidence, 100), 1),
                'source': 'contour_density'
            })
    
    # Add grid diagrams
    diagrams.extend(grid_diagrams)
    
    # Sort by area
    diagrams = sorted(diagrams, key=lambda x: x['area'], reverse=True)
    
    # Remove overlapping detections (keep larger ones)
    filtered_diagrams = []
    for diag in diagrams:
        x1, y1, x2, y2 = diag['bbox']
        is_overlapping = False
        
        for existing in filtered_diagrams:
            ex1, ey1, ex2, ey2 = existing['bbox']
            # Check for significant overlap
            overlap_x = max(0, min(x2, ex2) - max(x1, ex1))
            overlap_y = max(0, min(y2, ey2) - max(y1, ey1))
            overlap_area = overlap_x * overlap_y
            
            if overlap_area > diag['area'] * 0.5:  # More than 50% overlap
                is_overlapping = True
                break
        
        if not is_overlapping:
            filtered_diagrams.append(diag)
    
    print(f"  ✓ Found {len(filtered_diagrams)} diagrams")
    for i, d in enumerate(filtered_diagrams[:3]):
        bbox = d['bbox']
        w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
        source = d.get('source', 'unknown')
        print(f"    #{i+1}: {w}x{h}px, density={d['density']:.2f}, conf={d['confidence']:.1f}%, source={source}")
    
    return filtered_diagrams


def detect_coordinate_grids(gray, edges, width, height):
    """
    Detect coordinate grids by finding regular intersection patterns
    """
    grid_diagrams = []
    output_dir = Path('output/debug')
    output_dir.mkdir(exist_ok=True)
    
    # Pre-processing to reduce noise
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    
    # Method 1: Look for regions with regular grid patterns using morphological operations
    # Create horizontal and vertical line detectors - larger kernels to be less sensitive
    horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (40, 1))
    vertical_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 40))
    
    # Apply morphological operations on blurred image edges
    edges_blurred = cv2.Canny(blurred, 50, 150)
    horizontal_lines = cv2.morphologyEx(edges_blurred, cv2.MORPH_OPEN, horizontal_kernel)
    vertical_lines = cv2.morphologyEx(edges_blurred, cv2.MORPH_OPEN, vertical_kernel)
    
    # Save debug images
    cv2.imwrite(str(output_dir / 'grid_horizontal_lines.png'), horizontal_lines)
    cv2.imwrite(str(output_dir / 'grid_vertical_lines.png'), vertical_lines)
    
    # Find intersections (grid points)
    intersections = cv2.bitwise_and(horizontal_lines, vertical_lines)
    cv2.imwrite(str(output_dir / 'grid_intersections.png'), intersections)

    # Find contours of intersection regions
    contours, _ = cv2.findContours(intersections, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    print(f"    [Grid Debug] Method 1 (Intersections): Found {len(contours)} intersection contours.")

    for i, contour in enumerate(contours):
        x, y, w, h = cv2.boundingRect(contour)
        area = w * h
        
        if area > 1000:  # Minimum intersection area
            print(f"    [Grid Debug] Contour #{i}: Area={area}px")
            # Check if this region has regular grid spacing
            region = intersections[y:y+h, x:x+w]
            
            # Find all intersection points in this region
            points = np.column_stack(np.where(region > 0))
            print(f"    [Grid Debug] Contour #{i}: Found {len(points)} intersection points.")

            if len(points) >= 9:  # Need at least 3x3 grid points
                # Analyze spacing
                y_coords = np.unique(points[:, 0])  # Row coordinates
                x_coords = np.unique(points[:, 1])  # Column coordinates
                
                if len(y_coords) >= 3 and len(x_coords) >= 3:
                    y_spacing = np.diff(y_coords)
                    x_spacing = np.diff(x_coords)
                    
                    y_spacing_std = np.std(y_spacing) if len(y_spacing) > 0 else 0
                    x_spacing_std = np.std(x_spacing) if len(x_spacing) > 0 else 0
                    
                    y_mean_spacing = np.mean(y_spacing) if len(y_spacing) > 0 else 0
                    x_mean_spacing = np.mean(x_spacing) if len(x_spacing) > 0 else 0
                    
                    # Check regularity
                    y_cv = y_spacing_std / y_mean_spacing if y_mean_spacing > 0 else 0
                    x_cv = x_spacing_std / x_mean_spacing if x_mean_spacing > 0 else 0
                    
                    print(f"    [Grid Debug] Contour #{i}: Y-spacing CV={y_cv:.2f}, X-spacing CV={x_cv:.2f}")

                    # Relaxed CV thresholds - real grids can have some variation
                    if y_cv < 2.0 and x_cv < 2.0 and y_mean_spacing > 5 and x_mean_spacing > 5:
                        # This looks like a regular grid
                        grid_area = w * h
                        
                        if grid_area > 10000:  # Minimum grid area
                            confidence = min(len(y_coords) * len(x_coords) * 2 + (1.0 - y_cv - x_cv) * 40, 100)
                            
                            grid_diagrams.append({
                                'bbox': (x, y, x + w, y + h),
                                'area': grid_area,
                                'density': len(points),
                                'confidence': round(confidence, 1),
                                'source': 'grid_intersection'
                            })
                            print(f"    ✓ Detected grid by intersections: {w}x{h}px, {len(x_coords)}x{len(y_coords)} grid, conf={confidence:.1f}%")
    
    # Method 2: Fallback to line-based detection if no intersections found
    if not grid_diagrams:
        print("    [Grid Debug] Method 1 failed, trying Method 2 (Hough Lines).")
        # Use adaptive thresholding for better line detection
        thresh = cv2.adaptiveThreshold(blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 15, 4)
        cv2.imwrite(str(output_dir / 'grid_adaptive_thresh.png'), thresh)
        
        # Hough line detection - tuned parameters
        lines = cv2.HoughLinesP(thresh, 1, np.pi / 180, threshold=50, minLineLength=50, maxLineGap=10)
        
        print(f"    [Grid Debug] Method 2: Found {len(lines) if lines is not None else 0} lines.")

        if lines is not None and len(lines) > 6:
            horizontal_lines = []
            vertical_lines = []
            
            for line in lines:
                x1, y1, x2, y2 = line[0]
                dx, dy = abs(x2 - x1), abs(y2 - y1)
                
                if dx > dy * 2:  # Horizontal
                    horizontal_lines.append((x1, y1, x2, y2))
                elif dy > dx * 2:  # Vertical
                    vertical_lines.append((x1, y1, x2, y2))
            
            print(f"    [Grid Debug] Method 2: Found {len(horizontal_lines)} horizontal lines and {len(vertical_lines)} vertical lines.")

            if len(horizontal_lines) >= 3 and len(vertical_lines) >= 3:
                # Group lines by position and check spacing
                h_positions = sorted(list(set((line[1] + line[3]) // 2 for line in horizontal_lines)))
                v_positions = sorted(list(set((line[0] + line[2]) // 2 for line in vertical_lines)))
                
                if len(h_positions) >= 3 and len(v_positions) >= 3:
                    h_spacing = np.diff(h_positions)
                    v_spacing = np.diff(v_positions)
                    
                    h_std = np.std(h_spacing) if len(h_spacing) > 0 else 0
                    v_std = np.std(v_spacing) if len(v_spacing) > 0 else 0
                    
                    h_mean = np.mean(h_spacing) if len(h_spacing) > 0 else 0
                    v_mean = np.mean(v_spacing) if len(v_spacing) > 0 else 0
                    
                    h_cv = h_std / h_mean if h_mean > 0 else 0
                    v_cv = v_std / v_mean if v_mean > 0 else 0

                    print(f"    [Grid Debug] Method 2: Y-spacing CV={h_cv:.2f}, X-spacing CV={v_cv:.2f}")
                    
                    # Relaxed CV thresholds for line-based grid detection
                    if h_cv < 2.0 and v_cv < 2.0 and h_mean > 15 and v_mean > 15:
                        x1, x2 = min(v_positions), max(v_positions)
                        y1, y2 = min(h_positions), max(h_positions)
                        w, h = x2 - x1, y2 - y1
                        area = w * h
                        
                        if area > 8000:
                            confidence = min(len(h_positions) * len(v_positions) + (1.0 - h_cv - v_cv) * 50, 100)
                            
                            grid_diagrams.append({
                                'bbox': (x1, y1, x2, y2),
                                'area': area,
                                'density': len(horizontal_lines) + len(vertical_lines),
                                'confidence': round(confidence, 1),
                                'source': 'grid_lines'
                            })
                            print(f"    ✓ Detected grid by lines: {w}x{h}px, {len(h_positions)}x{len(v_positions)} grid, conf={confidence:.1f}%")
    
    return grid_diagrams

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python detect_diagrams_hybrid.py <image_path>")
        print("Example: python detect_diagrams_hybrid.py output/page_10.png")
        sys.exit(1)
    
    image_path = sys.argv[1]
    diagrams = detect_diagrams_hybrid(image_path)
    
    if diagrams:
        image = Image.open(image_path)
        output_dir = Path('output')
        
        for idx, diag in enumerate(diagrams):
            x1, y1, x2, y2 = diag['bbox']
            
            # Add padding
            padding = 40
            x1 = max(0, x1 - padding)
            y1 = max(0, y1 - padding)
            x2 = min(image.width, x2 + padding)
            y2 = min(image.height, y2 + padding)
            
            crop = image.crop((x1, y1, x2, y2))
            
            filename = f"{Path(image_path).stem}_hybrid_diagram_{idx+1}.png"
            save_path = output_dir / filename
            crop.save(save_path, optimize=True)
            
            print(f"  ✓ Saved: {filename} ({save_path.stat().st_size // 1024}KB)")
    else:
        print("  ⚠ No diagrams detected - falling back to smart crop")
        # Fallback: crop middle-to-bottom region
        image = Image.open(image_path)
        w, h = image.size
        crop_top = int(h * 0.4)
        fallback_crop = image.crop((0, crop_top, w, h))
        
        output_dir = Path('output')
        filename = f"{Path(image_path).stem}_hybrid_fallback.png"
        save_path = output_dir / filename
        fallback_crop.save(save_path, optimize=True)
        print(f"  ✓ Saved fallback crop: {filename} ({save_path.stat().st_size // 1024}KB)")
    
    print(f"\n✅ Processing complete!")
