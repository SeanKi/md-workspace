"""MDSyncNote 앱 아이콘을 그린다.

여태 아이콘에 원본이 없어서 고칠 때마다 픽셀을 되재야 했다. 이 파일이 원본이다.

    python make-icon.py            # icons/ 를 다시 만든다
    python make-icon.py --preview  # 크기별로 나란히 그린 비교판만 만든다

1024px 로 그려서 줄인다 — 작은 크기에서 가장자리가 곱게 나온다.
M 은 획을 이은 선이고(끝은 둥글게), s 는 글꼴 글리프다.
"""

import argparse
import sys
from PIL import Image, ImageDraw, ImageFont

S = 1024                      # 그리는 크기
BG = (37, 99, 235, 255)       # #2563eb — MD Editor 와 같은 파랑 (한 가족)
WHITE = (255, 255, 255, 255)
ORANGE = (249, 115, 22, 255)  # #f97316

RADIUS = 0.195                # 둥근 모서리 (짧은 변 대비)

# M 의 뼈대. 512px 로 그렸던 옛 아이콘에서 그대로 재어 왔다
M_PATH = [(87, 347.5), (87, 133.5), (197, 265.7), (307, 133.5), (307, 347.5)]
M_STROKE = 41

# s 의 자리. 오른쪽 아래에 붙인다
S_BOX = (359, 302, 440, 413)  # 옛 크기 (left, top, right, bottom)

FONTS = ["arialbd.ttf", "seguisb.ttf", "segoeuib.ttf", "calibrib.ttf"]


def load_font(px):
    for name in FONTS:
        try:
            return ImageFont.truetype(name, px)
        except OSError:
            continue
    raise SystemExit("굵은 산세리프 글꼴을 찾지 못했습니다: " + ", ".join(FONTS))


def round_stroke(draw, points, width, color):
    """끝과 이음매가 둥근 두꺼운 선. Pillow 에는 둥근 끝이 없어 원을 얹는다."""
    draw.line(points, fill=color, width=width, joint="curve")
    r = width / 2
    for x, y in points:
        draw.ellipse((x - r, y - r, x + r, y + r), fill=color)


def draw_s(img, box, color, grow):
    """s 를 상자에 맞춰 그린다. grow 는 배율 — 오른쪽 아래 모서리를 붙박아 키운다."""
    left, top, right, bottom = box
    h = (bottom - top) * grow
    w = (right - left) * grow

    # 글리프의 실제 잉크가 상자를 채우도록 크기를 맞춘다
    px = int(h * 1.45)
    font = load_font(px)
    ink = font.getbbox("s")
    iw, ih = ink[2] - ink[0], ink[3] - ink[1]
    if ih == 0:
        return
    px = int(px * min(h / ih, w / iw))
    font = load_font(px)
    ink = font.getbbox("s")

    # 오른쪽 아래를 옛 자리에 맞춘다 — 자라도 M 쪽으로만 번진다
    x = right - (ink[2] - ink[0]) - ink[0]
    y = bottom - (ink[3] - ink[1]) - ink[1]
    ImageDraw.Draw(img).text((x, y), "s", font=font, fill=color)


def render(m_color, s_color, s_grow, size=S):
    """1024 로 그리고 요청한 크기로 줄인다."""
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, S - 1, S - 1), radius=int(S * RADIUS), fill=BG)

    k = S / 512  # 옛 아이콘을 재던 좌표계에서 지금 크기로
    round_stroke(d, [(x * k, y * k) for x, y in M_PATH], int(M_STROKE * k), m_color)
    draw_s(img, tuple(v * k for v in S_BOX), s_color, s_grow)

    return img if size == S else img.resize((size, size), Image.LANCZOS)


# 만들 파일들 (Tauri 가 tauri.conf.json 의 icon 목록에서 찾는 이름)
PNGS = {"32x32.png": 32, "128x128.png": 128, "128x128@2x.png": 256,
        "512x512.png": 512, "icon.png": 512}
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]


def write_icons(here, **style):
    big = render(size=S, **style)
    for name, px in PNGS.items():
        big.resize((px, px), Image.LANCZOS).save(here / name)
    # .ico 에 여러 크기를 담는다. 탐색기와 작업 표시줄이 상황에 맞게 고른다
    big.resize((256, 256), Image.LANCZOS).save(
        here / "icon.ico", format="ICO", sizes=[(n, n) for n in ICO_SIZES])
    print("만들었습니다:", ", ".join(PNGS) + ", icon.ico")


def write_preview(path, style, label_sizes=(128, 64, 48, 32, 16)):
    """작업 표시줄 크기에서도 갈리는지 눈으로 보려면 나란히 놓는 수밖에 없다."""
    pad, gap = 12, 14
    w = pad * 2 + sum(label_sizes) + gap * (len(label_sizes) - 1)
    h = pad * 2 + max(label_sizes)
    sheet = Image.new("RGBA", (w, h), (245, 246, 248, 255))
    x = pad
    for px in label_sizes:
        sheet.alpha_composite(render(size=px, **style), (x, pad + max(label_sizes) - px))
        x += px + gap
    sheet.save(path)
    return sheet


STYLES = {
    "a": dict(m_color=WHITE, s_color=ORANGE, s_grow=1.25),
    "b": dict(m_color=ORANGE, s_color=ORANGE, s_grow=1.25),
    "c": dict(m_color=WHITE, s_color=ORANGE, s_grow=1.55),
}

if __name__ == "__main__":
    import pathlib

    ap = argparse.ArgumentParser()
    ap.add_argument("--style", default="a", choices=sorted(STYLES))
    ap.add_argument("--preview", action="store_true")
    ap.add_argument("--out", default=".")
    args = ap.parse_args()

    here = pathlib.Path(args.out)
    if args.preview:
        for key, style in STYLES.items():
            write_preview(here / f"preview-{key}.png", style)
        print("비교판을 만들었습니다:", ", ".join(f"preview-{k}.png" for k in STYLES))
        sys.exit(0)

    write_icons(here, **STYLES[args.style])
