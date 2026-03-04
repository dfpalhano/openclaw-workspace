from PIL import Image, ImageDraw
import os

WS = os.path.dirname(os.path.abspath(__file__))

def make_board(meridian_file, output_file):
    W, H = 3840, 2160
    bg = Image.new('RGB', (W, H), '#080C14')
    mer = Image.open(os.path.join(WS, meridian_file)).convert('RGBA')
    mw = int(W * 0.55)
    mh = int(mer.height * (mw / mer.width))
    mer = mer.resize((mw, mh), Image.LANCZOS)
    bg.paste(mer, ((W - mw) // 2, 80), mer)
    brands = ['font-nestd-dark.png', 'font-crestd-dark.png', 'font-stackd-dark.png']
    brand_imgs = [Image.open(os.path.join(WS, b)).convert('RGBA') for b in brands]
    brand_imgs = [img.resize((int(W*0.28), int(img.height*(int(W*0.28)/img.width))), Image.LANCZOS) for img in brand_imgs]
    row_y = 80 + mh + 60
    total_w = sum(b.width for b in brand_imgs) + 80 * (len(brand_imgs)-1)
    cx = (W - total_w) // 2
    draw = ImageDraw.Draw(bg)
    for i, b in enumerate(brand_imgs):
        bg.paste(b, (cx, row_y), b)
        if i < len(brand_imgs)-1:
            lx = cx + b.width + 40
            draw.line([(lx, row_y+40),(lx, row_y+b.height-40)], fill='#2a2a3a', width=2)
        cx += b.width + 80
    bg.save(output_file, 'PNG')
    print(f'Saved: {output_file}')

make_board('brand-meridian-logo-standalone.png', os.path.join(WS, 'meridian-board-rays.png'))
make_board('brand-meridian-ring-only.png', os.path.join(WS, 'meridian-board-no-rays.png'))
