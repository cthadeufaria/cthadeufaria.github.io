import fitz  # PyMuPDF

# Input and output file paths
input_path = "invoice-FB57197.pdf"
output_path = "invoice-FB57197_EUR_final.pdf"

# Define the mapping of old to new numeric values
mapping = {
    "110.38": "137.96",
    "239.95": "299.90", 
    "479.90": "599.80",
    "113.82": "142.26",
    "608.67": "757.01",
    "14.95": "14.95"
}

# Open PDF
doc = fitz.open(input_path)
replacements = []

print("🔍 Scanning PDF for text to replace...")

for page_num in range(len(doc)):
    page = doc[page_num]
    print(f"\n📄 Processing page {page_num + 1}")
    
    # Get all text blocks with detailed information
    blocks = page.get_text("dict")["blocks"]
    
    for block_num, block in enumerate(blocks):
        if "lines" not in block:
            continue
            
        for line_num, line in enumerate(block["lines"]):
            for span_num, span in enumerate(line["spans"]):
                text = span["text"]
                
                # Check if any of our target numbers are in this span
                for old_val, new_val in mapping.items():
                    if old_val in text:
                        print(f"  🎯 Found '{old_val}' in text: '{text}'")
                        
                        # Get span properties
                        bbox = fitz.Rect(span["bbox"])
                        font_size = span["size"]
                        font_name = span.get("font", "")
                        color = span.get("color", 0)
                        
                        # Convert color to RGB
                        if isinstance(color, int):
                            r = ((color >> 16) & 255) / 255
                            g = ((color >> 8) & 255) / 255
                            b = (color & 255) / 255
                            rgb_color = (r, g, b)
                        else:
                            rgb_color = (0, 0, 0)  # Default black
                        
                        print(f"    📦 BBox: {bbox}, Font: {font_name}, Size: {font_size}")
                        
                        # Create a slightly larger rectangle to cover the text
                        cover_rect = fitz.Rect(
                            bbox.x0 - 1, bbox.y0 - 1, 
                            bbox.x1 + 10, bbox.y1 + 1
                        )
                        
                        # Cover with white rectangle
                        page.draw_rect(cover_rect, color=(1,1,1), fill=(1,1,1))
                        
                        # Use EUR instead of Euro symbol - much more reliable
                        success = False
                        
                        # Simple approach: Insert "EUR" + number using reliable fonts
                        try:
                            # Single insertion point for the complete text
                            insertion_point = fitz.Point(bbox.x0, bbox.y1 - 2)
                            full_text = f"EUR {new_val}"
                            
                            # Try with Helvetica first (most reliable)
                            result = page.insert_text(
                                insertion_point,
                                full_text,
                                fontname="helv",
                                fontsize=font_size,
                                color=rgb_color
                            )
                            success = True
                            print(f"    ✅ EUR insertion successful: {result}")
                            
                        except Exception as e:
                            print(f"    ❌ EUR insertion failed: {e}")
                            
                            # Fallback: Use textbox method
                            try:
                                full_text = f"EUR {new_val}"
                                result = page.insert_textbox(
                                    cover_rect,
                                    full_text,
                                    fontname="helv",
                                    fontsize=font_size,
                                    color=rgb_color,
                                    align=0  # left aligned
                                )
                                success = True
                                print(f"    ✅ EUR textbox successful: {result}")
                            except Exception as e2:
                                print(f"    ❌ All EUR methods failed: {e2}")
                        
                        if success:
                            replacements.append({
                                'old': old_val,
                                'new': new_val, 
                                'page': page_num + 1,
                                'bbox': bbox,
                                'font': font_name,
                                'size': font_size
                            })

# Save the modified PDF
print(f"\n💾 Saving to: {output_path}")
doc.save(output_path)
doc.close()

print(f"\n✅ Processing complete!")
print(f"📊 Replacements made: {len(replacements)}")

for r in replacements:
    print(f"  • {r['old']} → {r['new']} (Page {r['page']}, Font: {r['font']}, Size: {r['size']:.1f})")