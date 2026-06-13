#!/usr/bin/env python3
"""
plate-swap.py — Vervangt kentekenplaat in foto door Transfer4Cars branded plate.
Input: originele foto path + plate bounding box (x,y,w,h) + output path
Output: foto met T4C plate overlay op de juiste plek

Usage: python3 plate-swap.py <input> <output> <x> <y> <w> <h>
"""
import sys, os
from PIL import Image, ImageDraw, ImageFont

def create_t4c_plate(width, height):
    """Maakt een Transfer4Cars branded NL-stijl kentekenplaat."""
    plate = Image.new('RGBA', (width, height), (0,0,0,0))
    draw = ImageDraw.Draw(plate)
    
    # Gele achtergrond met afgeronde hoeken
    radius = max(3, int(height * 0.15))
    draw.rounded_rectangle([0, 0, width-1, height-1], radius=radius, fill=(245, 197, 24, 255))
    
    # Blauwe NL strip links
    nl_w = max(int(width * 0.14), 16)
    draw.rounded_rectangle([0, 0, nl_w, height-1], radius=radius, fill=(0, 48, 135, 255))
    # Fix: rechthoek over rechterhelft van NL strip (geen afronding rechts)
    draw.rectangle([radius, 0, nl_w, height-1], fill=(0, 48, 135, 255))
    
    # NL tekst
    nl_font_size = max(int(height * 0.3), 8)
    try:
        nl_font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', nl_font_size)
    except:
        nl_font = ImageFont.load_default()
    
    # Sterren
    star_size = max(int(height * 0.15), 6)
    try:
        star_font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', star_size)
    except:
        star_font = nl_font
    
    stars_bbox = draw.textbbox((0,0), '★★★', font=star_font)
    stars_w = stars_bbox[2] - stars_bbox[0]
    draw.text((nl_w//2 - stars_w//2, int(height*0.08)), '★★★', fill=(255, 215, 0, 255), font=star_font)
    
    nl_bbox = draw.textbbox((0,0), 'NL', font=nl_font)
    nl_tw = nl_bbox[2] - nl_bbox[0]
    draw.text((nl_w//2 - nl_tw//2, int(height*0.38)), 'NL', fill=(255, 255, 255, 255), font=nl_font)
    
    # T4C tekst op gele achtergrond
    text = 'T4C'
    text_area_w = width - nl_w
    text_font_size = max(int(height * 0.55), 10)
    try:
        text_font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', text_font_size)
    except:
        text_font = ImageFont.load_default()
    
    text_bbox = draw.textbbox((0,0), text, font=text_font)
    text_w = text_bbox[2] - text_bbox[0]
    text_h = text_bbox[3] - text_bbox[1]
    text_x = nl_w + (text_area_w - text_w) // 2
    text_y = (height - text_h) // 2 - int(height * 0.05)
    draw.text((text_x, text_y), text, fill=(10, 10, 10, 255), font=text_font)
    
    # Rand
    draw.rounded_rectangle([0, 0, width-1, height-1], radius=radius, outline=(10, 10, 10, 180), width=max(1, int(height*0.04)))
    
    return plate


def swap_plate(input_path, output_path, x, y, w, h):
    """Vervangt kentekenplaat op (x,y,w,h) met T4C plate."""
    img = Image.open(input_path).convert('RGBA')
    
    # Maak T4C plate op de juiste grootte
    plate = create_t4c_plate(int(w), int(h))
    
    # Paste op de juiste plek
    img.paste(plate, (int(x), int(y)), plate)
    
    # Save als JPEG (voor web)
    rgb = img.convert('RGB')
    rgb.save(output_path, 'JPEG', quality=88, optimize=True)
    print(f'OK {output_path}')


if __name__ == '__main__':
    if len(sys.argv) < 7:
        print('Usage: plate-swap.py <input> <output> <x> <y> <w> <h>')
        sys.exit(1)
    
    swap_plate(sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5]), float(sys.argv[6]))
