#!/usr/bin/env python3
# coding: utf-8
"""
Synthetic Rubik's cube classifier stress test.
Covers: 18 lighting scenarios, two-shot progressive calibration,
confidence scoring, and self-correcting loop for failures.
No external dependencies — only struct, zlib, sys.
"""
import struct, zlib, os, sys

# ─── PNG writer ──────────────────────────────────────────────────────────────
def _pchunk(t, d):
    payload = t + d
    return struct.pack('>I', len(d)) + payload + struct.pack('>I', zlib.crc32(payload) & 0xFFFFFFFF)

def write_png(path, pixels, W, H):
    raw = bytearray()
    for row in pixels:
        raw.append(0)
        for r, g, b in row:
            raw.extend([r & 255, g & 255, b & 255])
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
        f.write(_pchunk(b'IHDR', struct.pack('>IIBBBBB', W, H, 8, 2, 0, 0, 0)))
        f.write(_pchunk(b'IDAT', zlib.compress(bytes(raw), 6)))
        f.write(_pchunk(b'IEND', b''))

def new_img(W, H, bg=(20, 20, 20)):
    return [[bg] * W for _ in range(H)]

def fill_rect(img, x, y, w, h, color):
    for dy in range(h):
        for dx in range(w):
            img[y + dy][x + dx] = color

# ─── Color constants (matches cube3x3.html FACE_COLORS) ─────────────────────
FACE_HEX = {
    'U': '#ffff00',  # Yellow
    'R': '#ffa500',  # Orange
    'F': '#0000ff',  # Blue
    'D': '#ffffff',  # White
    'L': '#ff0000',  # Red
    'B': '#00ff00',  # Green
}
FACE_ORDER = ['U', 'R', 'F', 'D', 'L', 'B']

# Two-shot assignments: shot 0 = U/F/R, shot 1 = D/B/L
TWO_SHOT = [
    {'top': 'U', 'left': 'F', 'right': 'R'},
    {'top': 'D', 'left': 'B', 'right': 'L'},
]

def hex_rgb(h):
    h = h.lstrip('#')
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))

def clamp(v, lo=0, hi=255):
    return max(lo, min(hi, int(round(v))))

# ─── Lighting model ───────────────────────────────────────────────────────────
def apply_light(rgb, bright=1.0, warm=0.0, green=0.0):
    """
    bright: multiplier (0.3 = very dark, 1.5 = overexposed)
    warm:   -1..+1  (negative = blue/cool, positive = red/warm)
    green:  -1..+1  (positive = green push, negative = magenta push)
    """
    r = clamp(rgb[0] * bright + warm * 55)
    g = clamp(rgb[1] * bright + green * 40)
    b = clamp(rgb[2] * bright - warm * 28 - green * 20)
    return (r, g, b)

# ─── CIE Lab (D65) ───────────────────────────────────────────────────────────
def _srgb_lin(c):
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def rgb_to_lab(r, g, b):
    rl, gl, bl = _srgb_lin(r), _srgb_lin(g), _srgb_lin(b)
    X = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375
    Y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750
    Z = rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041
    def f(t): return t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116
    fy = f(Y)
    return (116 * fy - 16, 500 * (f(X / 0.95047) - fy), 200 * (fy - f(Z / 1.08883)))

def lab_dist_sq(a, b):
    return sum((x - y) ** 2 for x, y in zip(a, b))

def classify_lab(rgb, palette):
    lab = rgb_to_lab(*rgb)
    ranked = sorted(palette.keys(), key=lambda f: lab_dist_sq(lab, palette[f]))
    best, second = ranked[0], ranked[1]
    best_d = lab_dist_sq(lab, palette[best])
    second_d = lab_dist_sq(lab, palette[second])
    # confidence: ratio 2nd/1st — values < 2.5 indicate ambiguity
    confidence = second_d / best_d if best_d > 0 else 99
    return best, confidence

# ─── HSV classifier (mirrors cube3x3.html) ───────────────────────────────────
def rgb_to_hsv(r, g, b):
    r, g, b = r / 255, g / 255, b / 255
    mx, mn = max(r, g, b), min(r, g, b)
    v, s = mx, (mx - mn) / mx if mx else 0
    if mx == mn:   h = 0
    elif mx == r:  h = 60 * (g - b) / (mx - mn) % 360
    elif mx == g:  h = 60 * ((b - r) / (mx - mn) + 2)
    else:          h = 60 * ((r - g) / (mx - mn) + 4)
    return h, s, v

def classify_hsv(r, g, b):
    h, s, v = rgb_to_hsv(r, g, b)
    if v < 0.15:                                          return '?'
    if s < 0.12:                                          return 'D'
    if 40 <= h <= 72   and s >= 0.42 and v >= 0.50:      return 'U'
    if 12 <  h <  40   and s >= 0.48 and v >= 0.25:      return 'R'
    if (h <= 12 or h >= 340) and s >= 0.65 and v >= 0.30: return 'L'
    if 190 <= h <= 260  and s >= 0.40 and v >= 0.20:     return 'F'
    if 72  <  h <  165  and s >= 0.30 and v >= 0.20:     return 'B'
    sc = {
        'U': abs(h - 56) + (0 if s >= 0.42 else 80),
        'R': abs(h - 30) + (0 if s >= 0.48 else 80),
        'L': min(h, 360 - h) + (0 if s >= 0.65 else 80),
        'F': abs(h - 220) + (0 if s >= 0.40 else 80),
        'B': abs(h - 120) + (0 if s >= 0.30 else 80),
        'D': s * 300,
    }
    return min(sc, key=sc.__getitem__)

# ─── Cross-layout renderer ────────────────────────────────────────────────────
CELL = 42
GAP  = 4
MARG = 8
FS   = 3 * CELL + 2 * GAP
IMG_W = 4 * (FS + MARG) + MARG
IMG_H = 3 * (FS + MARG) + MARG

UNFOLD = {
    'U': (0, 1),
    'L': (1, 0), 'F': (1, 1), 'R': (1, 2), 'B': (1, 3),
    'D': (2, 1),
}

def render_cube_per_face(state, lighting_per_face):
    """lighting_per_face: {face: (bright, warm, green)}"""
    img = new_img(IMG_W, IMG_H)
    for fi, face in enumerate(FACE_ORDER):
        fchars = state[fi * 9:(fi + 1) * 9]
        fr, fc = UNFOLD[face]
        x0 = MARG + fc * (FS + MARG)
        y0 = MARG + fr * (FS + MARG)
        args = lighting_per_face.get(face, (1.0, 0.0, 0.0))
        for row in range(3):
            for col in range(3):
                base = hex_rgb(FACE_HEX[fchars[row * 3 + col]])
                color = apply_light(base, *args)
                cx = x0 + col * (CELL + GAP)
                cy = y0 + row * (CELL + GAP)
                fill_rect(img, cx, cy, CELL, CELL, color)
    return img

def render_cube(state, lighting):
    """lighting: {face: (bright, warm)} — legacy 2-arg signature"""
    return render_cube_per_face(state,
        {f: (b, w, 0.0) for f, (b, w) in lighting.items()})

# ─── Realistic effects: per-sticker shadow / gradient / specular ──────────────
def render_cube_realistic(state, lighting_per_face, sticker_effects=None):
    """
    sticker_effects: { (face, sticker_idx): {'mul': 0.5, 'warm': 0.0, 'noise': 5} }
    Applied AFTER face lighting — simulates within-face shadow/highlight/noise.
    """
    img = new_img(IMG_W, IMG_H)
    sticker_effects = sticker_effects or {}
    for fi, face in enumerate(FACE_ORDER):
        fchars = state[fi * 9:(fi + 1) * 9]
        fr, fc = UNFOLD[face]
        x0 = MARG + fc * (FS + MARG)
        y0 = MARG + fr * (FS + MARG)
        bright, warm, green = lighting_per_face.get(face, (1.0, 0.0, 0.0))
        for row in range(3):
            for col in range(3):
                idx = row * 3 + col
                base = hex_rgb(FACE_HEX[fchars[idx]])
                # Per-face lighting first
                color = apply_light(base, bright, warm, green)
                # Per-sticker effect on top
                eff = sticker_effects.get((face, idx))
                if eff:
                    mul = eff.get('mul', 1.0)
                    extra_warm = eff.get('warm', 0.0)
                    color = apply_light(color, mul, extra_warm, 0.0)
                cx = x0 + col * (CELL + GAP)
                cy = y0 + row * (CELL + GAP)
                fill_rect(img, cx, cy, CELL, CELL, color)
    return img


def render_cube_with_gradient(state, lighting_per_face, gradient_per_face=None):
    """
    gradient_per_face: { face: (top_mul, bottom_mul) } — bright fades from top to bottom
    Renders pixel-by-pixel within each sticker so gradient is visible.
    """
    img = new_img(IMG_W, IMG_H)
    gradient_per_face = gradient_per_face or {}
    for fi, face in enumerate(FACE_ORDER):
        fchars = state[fi * 9:(fi + 1) * 9]
        fr, fc = UNFOLD[face]
        x0 = MARG + fc * (FS + MARG)
        y0 = MARG + fr * (FS + MARG)
        bright, warm, green = lighting_per_face.get(face, (1.0, 0.0, 0.0))
        top_mul, bot_mul = gradient_per_face.get(face, (1.0, 1.0))
        for row in range(3):
            for col in range(3):
                idx = row * 3 + col
                base = hex_rgb(FACE_HEX[fchars[idx]])
                cx_start = x0 + col * (CELL + GAP)
                cy_start = y0 + row * (CELL + GAP)
                # Within sticker: gradient from row's local top to bottom
                # Combined with face-wide gradient (row 0 = top, row 2 = bottom)
                for dy in range(CELL):
                    # face-wide vertical position 0..1
                    face_v = (row * (CELL + GAP) + dy) / (3 * CELL + 2 * GAP)
                    g_mul = top_mul + (bot_mul - top_mul) * face_v
                    color = apply_light(base, bright * g_mul, warm, green)
                    for dx in range(CELL):
                        img[cy_start + dy][cx_start + dx] = color
    return img


# ─── Isometric three-face renderer (matches scanner geometry) ─────────────────
ISO_W, ISO_H = 640, 480
def _bilin(corners, u, v):
    """Bilinear interpolation: corners = [TL, TR, BR, BL] each (x,y)"""
    tx = corners[0][0] + u * (corners[1][0] - corners[0][0])
    ty = corners[0][1] + u * (corners[1][1] - corners[0][1])
    bx = corners[3][0] + u * (corners[2][0] - corners[3][0])
    by = corners[3][1] + u * (corners[2][1] - corners[3][1])
    return (tx + v * (bx - tx), ty + v * (by - ty))


def _fill_quad(img, p0, p1, p2, p3, color):
    """Fill a convex quadrilateral (TL, TR, BR, BL) with solid color."""
    pts = [p0, p1, p2, p3]
    ys = [p[1] for p in pts]
    y_min = max(0, int(min(ys)))
    y_max = min(ISO_H - 1, int(max(ys)))
    edges = [(pts[i], pts[(i + 1) % 4]) for i in range(4)]
    for y in range(y_min, y_max + 1):
        xs = []
        for (a, b) in edges:
            if (a[1] <= y < b[1]) or (b[1] <= y < a[1]):
                t = (y - a[1]) / (b[1] - a[1]) if b[1] != a[1] else 0
                xs.append(a[0] + t * (b[0] - a[0]))
        if len(xs) < 2: continue
        xs.sort()
        x_lo = max(0, int(xs[0]))
        x_hi = min(ISO_W - 1, int(xs[-1]))
        for x in range(x_lo, x_hi + 1):
            img[y][x] = color


def render_isometric_three_face(state, panel_assignment, lighting_per_face,
                                 sticker_effects=None, draw_borders=True):
    """
    Renders three faces in isometric view as the scanner sees them.
    panel_assignment: {'top': 'U', 'left': 'F', 'right': 'R'}
    Mirrors TWO_SHOT_SCANS panel corners (matches drawTwoShotOverlay).

    Includes:
    - True quadrilateral (rhombus/parallelogram) panel geometry
    - Per-sticker effects (shadow, specular, noise)
    - Optional black plastic borders between stickers (~3% width)
    """
    img = new_img(ISO_W, ISO_H, bg=(15, 18, 22))
    sticker_effects = sticker_effects or {}

    # Approximate isometric corners (in 640x480 frame). Matches the live overlay.
    cx, cy = 320, 220
    half = 130  # half-size of cube projection
    PANELS = {
        # Top face: rhombus pointing up
        'top':   [(cx - half, cy - half * 0.55), (cx, cy - half * 1.10),
                  (cx + half, cy - half * 0.55), (cx, cy)],
        # Left face: parallelogram
        'left':  [(cx - half, cy - half * 0.55), (cx, cy),
                  (cx, cy + half * 0.95), (cx - half, cy + half * 0.40)],
        # Right face: parallelogram (mirror of left)
        'right': [(cx, cy), (cx + half, cy - half * 0.55),
                  (cx + half, cy + half * 0.40), (cx, cy + half * 0.95)],
    }

    BORDER = 0.04 if draw_borders else 0.0
    for panel_key, face in panel_assignment.items():
        corners = PANELS[panel_key]
        fi = FACE_ORDER.index(face)
        fchars = state[fi * 9:(fi + 1) * 9]
        bright, warm, green = lighting_per_face.get(face, (1.0, 0.0, 0.0))
        for row in range(3):
            for col in range(3):
                idx = row * 3 + col
                base = hex_rgb(FACE_HEX[fchars[idx]])
                color = apply_light(base, bright, warm, green)
                eff = sticker_effects.get((face, idx))
                if eff:
                    color = apply_light(color, eff.get('mul', 1.0),
                                        eff.get('warm', 0.0), 0.0)
                # Sub-cell quadrilateral with optional border padding
                u0, u1 = col / 3 + BORDER, (col + 1) / 3 - BORDER
                v0, v1 = row / 3 + BORDER, (row + 1) / 3 - BORDER
                tl = _bilin(corners, u0, v0)
                tr = _bilin(corners, u1, v0)
                br = _bilin(corners, u1, v1)
                bl = _bilin(corners, u0, v1)
                _fill_quad(img, tl, tr, br, bl, color)
    return img


def sample_isometric(img, panel_assignment, panel_corners, palette):
    """Sample 9 stickers per panel using bilinear, classify, return (ok, total)."""
    ok = total = 0
    errors = []
    for panel_key, face in panel_assignment.items():
        corners = panel_corners[panel_key]
        fi = FACE_ORDER.index(face)
        # Sample center of each cell using bilinear (same as scanner does)
        for row in range(3):
            for col in range(3):
                u = (col + 0.5) / 3
                v = (row + 0.5) / 3
                cx, cy = _bilin(corners, u, v)
                # Median sample of 7x7 patch around center, exclude near-black borders
                rs, gs, bs = [], [], []
                for dy in range(-3, 4):
                    for dx in range(-3, 4):
                        x = max(0, min(ISO_W - 1, int(cx + dx)))
                        y = max(0, min(ISO_H - 1, int(cy + dy)))
                        p = img[y][x]
                        if max(p) > 28:
                            rs.append(p[0]); gs.append(p[1]); bs.append(p[2])
                if not rs:
                    continue
                rs.sort(); gs.sort(); bs.sort()
                rgb = (rs[len(rs)//2], gs[len(gs)//2], bs[len(bs)//2])
                got, conf = classify_lab(rgb, palette)
                # Expected: this face's sticker
                state_chars = (face * 9)  # all-solved face for these tests
                expected = state_chars[row * 3 + col]
                if got == expected:
                    ok += 1
                else:
                    errors.append((panel_key, face, row, col, expected, got, rgb, conf))
                total += 1
    return ok, total, errors

# ─── Sampling ─────────────────────────────────────────────────────────────────
def sample_sticker(img, face_row, face_col, sticker_row, sticker_col, ksize=7):
    x0 = MARG + face_col * (FS + MARG) + sticker_col * (CELL + GAP)
    y0 = MARG + face_row * (FS + MARG) + sticker_row * (CELL + GAP)
    cx, cy = x0 + CELL // 2, y0 + CELL // 2
    half = ksize // 2
    rs = gs = bs = 0
    n = (2 * half + 1) ** 2
    for dy in range(-half, half + 1):
        for dx in range(-half, half + 1):
            p = img[cy + dy][cx + dx]
            rs += p[0]; gs += p[1]; bs += p[2]
    return (rs // n, gs // n, bs // n)

def build_palette_from_img(img, face_subset=None):
    """Build calibrated Lab palette from center stickers of specified faces."""
    faces = face_subset if face_subset else FACE_ORDER
    palette = {}
    for face in FACE_ORDER:
        if face in faces:
            palette[face] = rgb_to_lab(*sample_sticker(img, *UNFOLD[face], 1, 1))
        else:
            palette[face] = rgb_to_lab(*hex_rgb(FACE_HEX[face]))
    return palette

# ─── Two-shot progressive calibration simulation ──────────────────────────────
def run_two_shot_scenario(name, state, shot0_light, shot1_light, save_prefix=None):
    """
    Simulates the two-shot workflow:
    - Shot 0: U, F, R captured (possibly different lighting from shot 1)
    - Shot 1: D, B, L captured
    Progressive palette: shot0 centers calibrate U/F/R; shot1 uses that + canonical D/B/L
    """
    img0 = render_cube(state, {f: shot0_light for f in FACE_ORDER})
    img1 = render_cube(state, {f: shot1_light for f in FACE_ORDER})

    if save_prefix:
        write_png(f'{save_prefix}_shot0.png', img0, IMG_W, IMG_H)
        write_png(f'{save_prefix}_shot1.png', img1, IMG_W, IMG_H)

    shot0_faces = ['U', 'F', 'R']
    shot1_faces = ['D', 'B', 'L']

    # After shot 0: calibrate U/F/R from actual, D/B/L from canonical
    palette_after_shot0 = build_palette_from_img(img0, shot0_faces)

    ok = total = 0
    low_conf = []
    errors = []
    CONFIDENCE_THRESHOLD = 2.5

    for fi, face in enumerate(FACE_ORDER):
        img = img0 if face in shot0_faces else img1
        palette = build_palette_from_img(img0, shot0_faces) if face in shot0_faces else palette_after_shot0
        fr, fc = UNFOLD[face]
        fchars = state[fi * 9:(fi + 1) * 9]
        for row in range(3):
            for col in range(3):
                expected = fchars[row * 3 + col]
                rgb = sample_sticker(img, fr, fc, row, col)
                got, conf = classify_lab(rgb, palette)
                if got == expected:
                    ok += 1
                else:
                    errors.append((face, row, col, expected, got, rgb, conf))
                if conf < CONFIDENCE_THRESHOLD:
                    low_conf.append((face, row, col, expected, got, conf))
                total += 1

    pct = 100 * ok // total
    tag = 'PASS' if ok == total else 'FAIL'
    print(f'  {name}')
    print(f'    Lab(two-shot) {ok:2d}/{total} ({pct:3d}%) [{tag}]  low-conf: {len(low_conf)}')
    for face, row, col, exp, got, rgb, conf in errors[:3]:
        print(f'      ! {face}[{row},{col}] expect={exp} got={got} rgb={rgb} conf={conf:.2f}')
    for face, row, col, exp, got, conf in low_conf[:3]:
        mark = 'WRONG' if got != exp else 'ok'
        print(f'      ~ low-conf {face}[{row},{col}] expect={exp} got={got} conf={conf:.2f} [{mark}]')
    return ok, total, low_conf

# ─── Confidence-aware classifier test ────────────────────────────────────────
def run_scenario(name, state, lighting, save_path=None, per_face=False):
    if per_face:
        img = render_cube_per_face(state, lighting)
    else:
        img = render_cube(state, lighting)
    if save_path:
        write_png(save_path, img, IMG_W, IMG_H)

    palette = build_palette_from_img(img)

    ok_h = ok_l = total = 0
    low_conf = []
    errors = []
    CONFIDENCE_THRESHOLD = 2.5

    for fi, face in enumerate(FACE_ORDER):
        fr, fc = UNFOLD[face]
        fchars = state[fi * 9:(fi + 1) * 9]
        for row in range(3):
            for col in range(3):
                expected = fchars[row * 3 + col]
                rgb = sample_sticker(img, fr, fc, row, col)
                got_h = classify_hsv(*rgb)
                got_l, conf = classify_lab(rgb, palette)
                if got_h == expected: ok_h += 1
                else: errors.append(('HSV', face, row, col, expected, got_h, rgb, 0))
                if got_l == expected:
                    ok_l += 1
                else:
                    errors.append(('Lab', face, row, col, expected, got_l, rgb, conf))
                if conf < CONFIDENCE_THRESHOLD:
                    low_conf.append((face, row, col, expected, got_l, conf))
                total += 1

    tag_h = 'PASS' if ok_h == total else 'FAIL'
    tag_l = 'PASS' if ok_l == total else 'FAIL'
    print(f'  {name}')
    print(f'    HSV {ok_h:2d}/{total} ({100 * ok_h // total:3d}%) [{tag_h}]'
          f'   Lab {ok_l:2d}/{total} ({100 * ok_l // total:3d}%) [{tag_l}]'
          f'   low-conf: {len(low_conf)}')
    for clf, face, row, col, exp, got, rgb, conf in errors[:5]:
        h, s, v = rgb_to_hsv(*rgb)
        print(f'      ! {clf} {face}[{row},{col}] exp={exp} got={got}'
              f'  rgb={rgb}  h={h:.1f} s={s:.2f} v={v:.2f}'
              + (f' conf={conf:.2f}' if clf == 'Lab' else ''))
    return ok_h, ok_l, total, low_conf

# ─── Test states ──────────────────────────────────────────────────────────────
SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB'

MIXED = (
    'URUUUUUUR' +   # U: some R stickers
    'RURURURUR' +   # R: some U stickers
    'FFFFFFFFF' +   # F: pure blue
    'DDDDDDDDD' +   # D: pure white
    'LLLLLLLLL' +   # L: pure red
    'BBBBBBBBB'     # B: pure green
)

# Worst-case: adjacent-color swaps (orange↔yellow, white↔yellow, red↔orange)
ADJACENT_SWAPS = (
    'URURUURUU' +   # U(yellow) mixed with R(orange)
    'RURUURUUR' +   # R(orange) mixed with U(yellow)
    'FLFFFFLFF' +   # F(blue) mixed with L(red)
    'DDDDDDDDD' +
    'FLLLLLLLL' +   # L(red) mixed with F(blue)
    'BBBBBBBBB'
)

assert len(SOLVED) == 54
assert len(MIXED)  == 54
assert len(ADJACENT_SWAPS) == 54

# ─── Standard scenarios ───────────────────────────────────────────────────────
SCENARIOS = [
    ('01_baseline',
     SOLVED, {f: (1.0, 0.0) for f in 'URFDLB'}),
    ('02_directional_lit',
     SOLVED,
     {'U': (1.00, 0.0), 'R': (0.90, 0.0), 'F': (0.82, 0.0),
      'D': (0.72, 0.0), 'L': (0.68, 0.0), 'B': (0.62, 0.0)}),
    ('03_warm_LED',
     SOLVED, {f: (0.85, 0.35) for f in 'URFDLB'}),
    ('04_deep_shadow',
     SOLVED, {f: (0.45, 0.0) for f in 'URFDLB'}),
    ('05_specular_overexposure',
     SOLVED, {f: (1.40, 0.0) for f in 'URFDLB'}),
    ('06_cold_fluorescent',
     SOLVED, {f: (0.88, -0.22) for f in 'URFDLB'}),
    ('07_incandescent',
     SOLVED, {f: (0.80, 0.60) for f in 'URFDLB'}),
    ('08_mixed_bright_top_dark_sides',
     SOLVED,
     {'U': (1.08, 0.0), 'R': (0.88, 0.18), 'F': (0.75, 0.08),
      'D': (0.52, 0.0), 'L': (0.46, 0.0), 'B': (0.40, 0.0)}),
    ('09_mixed_colors_flat',
     MIXED, {f: (1.0, 0.0) for f in 'URFDLB'}),
    ('10_mixed_colors_warm',
     MIXED, {f: (0.85, 0.35) for f in 'URFDLB'}),
    # New extreme scenarios
    ('11_candlelight',
     SOLVED, {f: (0.75, 0.85) for f in 'URFDLB'}),
    ('12_dim_blue_monitor',
     SOLVED, {f: (0.60, -0.55) for f in 'URFDLB'}),
    ('13_very_dark',
     SOLVED, {f: (0.28, 0.0) for f in 'URFDLB'}),
    ('14_harsh_overexposure',
     SOLVED, {f: (1.65, 0.0) for f in 'URFDLB'}),
    ('15_adjacent_swaps_warm',
     ADJACENT_SWAPS, {f: (0.85, 0.35) for f in 'URFDLB'}),
    ('16_adjacent_swaps_cold',
     ADJACENT_SWAPS, {f: (0.88, -0.22) for f in 'URFDLB'}),
]

# Per-face lighting (realistic: faces at different angles get different light)
PER_FACE_SCENARIOS = [
    ('17_realistic_iso_shot1',
     SOLVED,
     {  # simulates isometric shot 1: top face brightest, right/front angled
        'U': (1.10, 0.08, 0.0),
        'F': (0.78, 0.12, 0.0),
        'R': (0.88, 0.06, 0.0),
        'D': (0.65, 0.05, 0.0),
        'L': (0.62, 0.05, 0.0),
        'B': (0.58, 0.03, 0.0),
     }),
    ('18_realistic_iso_shot2_warm',
     SOLVED,
     {  # simulates shot 2 after flipping cube; different face angles
        'D': (1.05, 0.10, 0.0),
        'B': (0.82, 0.15, 0.0),
        'L': (0.90, 0.08, 0.0),
        'U': (0.60, 0.05, 0.0),
        'F': (0.55, 0.03, 0.0),
        'R': (0.52, 0.03, 0.0),
     }),
]

# Realistic per-sticker effects: shadow, specular, dirt
def _hand_shadow():
    """Right-hand shadow: 3 stickers in bottom-right quadrant get darkened ~50%"""
    return {('U', 5): {'mul': 0.55}, ('U', 8): {'mul': 0.45},
            ('R', 6): {'mul': 0.50}, ('R', 7): {'mul': 0.48},
            ('F', 8): {'mul': 0.55}}

def _specular_highlights():
    """Glossy hot spots: 4 stickers oversaturated by camera flash"""
    return {('U', 0): {'mul': 1.55, 'warm': 0.0},
            ('R', 2): {'mul': 1.40},
            ('F', 1): {'mul': 1.35},
            ('U', 4): {'mul': 1.30}}

def _corner_occlusion():
    """Cube corner blocks light to opposite face — 3 stickers very dim"""
    return {('B', 0): {'mul': 0.30}, ('B', 1): {'mul': 0.35},
            ('B', 3): {'mul': 0.40}}

def _mixed_real_world():
    """Combination: hand shadow + 1 specular spot + warm tint on right face"""
    eff = {}
    eff.update(_hand_shadow())
    eff[('U', 0)] = {'mul': 1.40}
    eff[('R', 4)] = {'mul': 0.85, 'warm': 0.30}
    return eff

# Per-sticker realistic effect scenarios (test classifier against hard cases)
REALISTIC_SCENARIOS = [
    ('19_hand_shadow_warm',
     SOLVED, {f: (0.95, 0.20, 0.0) for f in 'URFDLB'}, _hand_shadow()),
    ('20_specular_highlights',
     SOLVED, {f: (1.00, 0.05, 0.0) for f in 'URFDLB'}, _specular_highlights()),
    ('21_corner_occlusion',
     SOLVED, {f: (0.85, 0.0, 0.0) for f in 'URFDLB'}, _corner_occlusion()),
    ('22_mixed_real_world',
     SOLVED, {f: (0.90, 0.15, 0.0) for f in 'URFDLB'}, _mixed_real_world()),
]

# Within-face brightness gradient (top/bottom of face get different multipliers)
GRADIENT_SCENARIOS = [
    ('23_top_bright_bottom_dark',
     SOLVED, {f: (1.0, 0.0, 0.0) for f in 'URFDLB'},
     {f: (1.30, 0.55) for f in 'URFDLB'}),  # 1.3x at top, 0.55x at bottom
    ('24_strong_top_lit_warm',
     SOLVED, {f: (0.90, 0.30, 0.0) for f in 'URFDLB'},
     {f: (1.45, 0.40) for f in 'URFDLB'}),
    ('25_side_lit_uneven',
     SOLVED, {f: (0.85, 0.05, 0.0) for f in 'URFDLB'},
     {'U': (1.20, 0.70), 'D': (0.55, 1.20),  # opposite gradients on top/bottom face
      'R': (1.10, 0.65), 'L': (0.70, 1.10),
      'F': (1.00, 0.80), 'B': (0.80, 1.00)}),
]

# Isometric three-face panel scenarios (matches scanner's actual capture geometry)
ISO_SCENARIOS = [
    ('iso_01_baseline',
     {'top': 'U', 'left': 'F', 'right': 'R'},
     {'U': (1.05, 0.05, 0.0), 'F': (0.80, 0.10, 0.0), 'R': (0.85, 0.05, 0.0)},
     None),
    ('iso_02_with_shadow',
     {'top': 'U', 'left': 'F', 'right': 'R'},
     {'U': (1.05, 0.10, 0.0), 'F': (0.80, 0.10, 0.0), 'R': (0.78, 0.05, 0.0)},
     {('U', 7): {'mul': 0.55}, ('U', 8): {'mul': 0.50},
      ('R', 6): {'mul': 0.55}, ('F', 8): {'mul': 0.60}}),
    ('iso_03_specular',
     {'top': 'U', 'left': 'F', 'right': 'R'},
     {'U': (1.05, 0.05, 0.0), 'F': (0.80, 0.10, 0.0), 'R': (0.85, 0.05, 0.0)},
     {('U', 0): {'mul': 1.45}, ('U', 1): {'mul': 1.30},
      ('F', 0): {'mul': 1.35}}),
    ('iso_04_warm_low_light',
     {'top': 'U', 'left': 'F', 'right': 'R'},
     {'U': (0.78, 0.40, 0.0), 'F': (0.62, 0.42, 0.0), 'R': (0.65, 0.38, 0.0)},
     None),
    ('iso_05_shot2_after_flip',
     {'top': 'D', 'left': 'B', 'right': 'L'},
     {'D': (1.00, 0.10, 0.0), 'B': (0.78, 0.15, 0.0), 'L': (0.82, 0.10, 0.0)},
     {('D', 0): {'mul': 1.40}, ('B', 8): {'mul': 0.55}}),
]

# Two-shot progressive calibration scenarios (different lighting per shot)
TWO_SHOT_SCENARIOS = [
    ('twoshot_01_same_light',
     SOLVED, (1.0, 0.0), (1.0, 0.0)),
    ('twoshot_02_warm_shot1_neutral_shot2',
     SOLVED, (0.85, 0.35), (1.0, 0.0)),
    ('twoshot_03_neutral_shot1_cool_shot2',
     SOLVED, (1.0, 0.0), (0.88, -0.22)),
    ('twoshot_04_warm_warm',
     SOLVED, (0.82, 0.45), (0.80, 0.40)),
    ('twoshot_05_overexposed_shot1',
     SOLVED, (1.40, 0.0), (1.0, 0.0)),
    ('twoshot_06_dark_shot1_bright_shot2',
     SOLVED, (0.55, 0.0), (1.15, 0.0)),
    ('twoshot_07_mixed_adjacent',
     ADJACENT_SWAPS, (0.85, 0.30), (0.82, -0.10)),
]

# ─── Main ─────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    OUT_DIR = os.path.join(os.path.dirname(__file__) or '.', 'resources')
    os.makedirs(OUT_DIR, exist_ok=True)

    print('=' * 70)
    print('  Synthetic Cube Classifier Test  (Lab progressive + two-shot sim)')
    print(f'  {IMG_W}x{IMG_H}px  |  {CELL}px cells  |  7px kernel  |  D65 Lab')
    print('=' * 70)

    # ── A: Standard scenarios ─────────────────────────────────────────────────
    print('\n[A] Standard scenarios  (full calibrated palette)')
    print('-' * 70)
    th = tl = tc = 0
    all_low_conf = []
    for tag, state, lighting in SCENARIOS:
        path = os.path.join(OUT_DIR, f'test_cube_{tag}.png')
        h, l, t, lc = run_scenario(tag, state, lighting, path)
        th += h; tl += l; tc += t; all_low_conf += lc
    print()
    print(f'  TOTAL A  HSV {th}/{tc} ({100*th//tc}%)   Lab {tl}/{tc} ({100*tl//tc}%)')
    print(f'  Low-confidence stickers (conf < 2.5x): {len(all_low_conf)}')

    # ── B: Per-face lighting scenarios ───────────────────────────────────────
    print('\n[B] Per-face realistic lighting  (angled isometric illumination)')
    print('-' * 70)
    bh = bl = bc = 0
    for tag, state, lighting in PER_FACE_SCENARIOS:
        path = os.path.join(OUT_DIR, f'test_cube_{tag}.png')
        h, l, t, lc = run_scenario(tag, state, lighting, path, per_face=True)
        bh += h; bl += l; bc += t
    print(f'  TOTAL B  HSV {bh}/{bc} ({100*bh//bc}%)   Lab {bl}/{bc} ({100*bl//bc}%)')

    # ── B2: Per-sticker realistic effects (shadow / specular / occlusion) ────
    print('\n[B2] Per-sticker realistic effects  (shadow / specular / occlusion)')
    print('-' * 70)
    b2h = b2l = b2c = 0
    for tag, state, lighting, sticker_effects in REALISTIC_SCENARIOS:
        path = os.path.join(OUT_DIR, f'test_cube_{tag}.png')
        img = render_cube_realistic(state, lighting, sticker_effects)
        write_png(path, img, IMG_W, IMG_H)
        # Classify against full palette built from this image's center stickers
        palette = build_palette_from_img(img)
        ok_h = ok_l = total = 0
        errors = []
        for fi, face in enumerate(FACE_ORDER):
            fr, fc = UNFOLD[face]
            fchars = state[fi * 9:(fi + 1) * 9]
            for row in range(3):
                for col in range(3):
                    expected = fchars[row * 3 + col]
                    rgb = sample_sticker(img, fr, fc, row, col)
                    got_h = classify_hsv(*rgb)
                    got_l, conf = classify_lab(rgb, palette)
                    if got_h == expected: ok_h += 1
                    if got_l == expected: ok_l += 1
                    else: errors.append((face, row, col, expected, got_l, rgb, conf))
                    total += 1
        b2h += ok_h; b2l += ok_l; b2c += total
        tag_l = 'PASS' if ok_l == total else 'FAIL'
        print(f'  {tag}')
        print(f'    HSV {ok_h:2d}/{total} ({100*ok_h//total:3d}%)   '
              f'Lab {ok_l:2d}/{total} ({100*ok_l//total:3d}%) [{tag_l}]')
        for face, row, col, exp, got, rgb, conf in errors[:3]:
            print(f'      ! {face}[{row},{col}] exp={exp} got={got} rgb={rgb} conf={conf:.2f}')
    print(f'  TOTAL B2 HSV {b2h}/{b2c} ({100*b2h//b2c}%)   Lab {b2l}/{b2c} ({100*b2l//b2c}%)')

    # ── B3: Within-face brightness gradient ──────────────────────────────────
    print('\n[B3] Within-face brightness gradient  (top→bottom shading)')
    print('-' * 70)
    b3h = b3l = b3c = 0
    for tag, state, lighting, gradients in GRADIENT_SCENARIOS:
        path = os.path.join(OUT_DIR, f'test_cube_{tag}.png')
        img = render_cube_with_gradient(state, lighting, gradients)
        write_png(path, img, IMG_W, IMG_H)
        palette = build_palette_from_img(img)
        ok_h = ok_l = total = 0
        for fi, face in enumerate(FACE_ORDER):
            fr, fc = UNFOLD[face]
            fchars = state[fi * 9:(fi + 1) * 9]
            for row in range(3):
                for col in range(3):
                    expected = fchars[row * 3 + col]
                    rgb = sample_sticker(img, fr, fc, row, col)
                    if classify_hsv(*rgb) == expected: ok_h += 1
                    got_l, _ = classify_lab(rgb, palette)
                    if got_l == expected: ok_l += 1
                    total += 1
        b3h += ok_h; b3l += ok_l; b3c += total
        tag_l = 'PASS' if ok_l == total else 'FAIL'
        print(f'  {tag}  HSV {ok_h}/{total}  Lab {ok_l}/{total} [{tag_l}]')
    print(f'  TOTAL B3 HSV {b3h}/{b3c} ({100*b3h//b3c}%)   Lab {b3l}/{b3c} ({100*b3l//b3c}%)')

    # ── B4: True isometric three-face geometry ───────────────────────────────
    print('\n[B4] Isometric 3-face geometry  (rhombus/parallelogram panels)')
    print('-' * 70)
    b4l = b4c = 0
    for tag, panel_assignment, lighting, sticker_effects in ISO_SCENARIOS:
        path = os.path.join(OUT_DIR, f'test_cube_{tag}.png')
        # Render the cube state where each panel face is solid with its expected color
        synth_state = ''.join(f * 9 for f in FACE_ORDER)
        img = render_isometric_three_face(synth_state, panel_assignment,
                                          lighting, sticker_effects)
        write_png(path, img, ISO_W, ISO_H)
        # Build palette from the centers of the three captured panels
        cx, cy = 320, 220; half = 130
        PANELS = {
            'top':   [(cx - half, cy - half * 0.55), (cx, cy - half * 1.10),
                      (cx + half, cy - half * 0.55), (cx, cy)],
            'left':  [(cx - half, cy - half * 0.55), (cx, cy),
                      (cx, cy + half * 0.95), (cx - half, cy + half * 0.40)],
            'right': [(cx, cy), (cx + half, cy - half * 0.55),
                      (cx + half, cy + half * 0.40), (cx, cy + half * 0.95)],
        }
        palette = {}
        for panel_key, face in panel_assignment.items():
            corners = PANELS[panel_key]
            x_c, y_c = _bilin(corners, 0.5, 0.5)
            rs, gs, bs = [], [], []
            for dy in range(-3, 4):
                for dx in range(-3, 4):
                    p = img[max(0, min(ISO_H - 1, int(y_c + dy)))][max(0, min(ISO_W - 1, int(x_c + dx)))]
                    if max(p) > 28:
                        rs.append(p[0]); gs.append(p[1]); bs.append(p[2])
            rs.sort(); gs.sort(); bs.sort()
            mid = len(rs) // 2
            palette[face] = rgb_to_lab(rs[mid], gs[mid], bs[mid])
        # Fill remaining faces with canonical refs
        for face in FACE_ORDER:
            if face not in palette:
                palette[face] = rgb_to_lab(*hex_rgb(FACE_HEX[face]))
        ok, total, errors = sample_isometric(img, panel_assignment, PANELS, palette)
        b4l += ok; b4c += total
        tag_l = 'PASS' if ok == total else 'FAIL'
        print(f'  {tag}  Lab {ok}/{total} ({100*ok//total}%) [{tag_l}]')
        for panel_key, face, row, col, exp, got, rgb, conf in errors[:3]:
            print(f'      ! {panel_key}({face})[{row},{col}] exp={exp} got={got} rgb={rgb} conf={conf:.2f}')
    print(f'  TOTAL B4 Lab {b4l}/{b4c} ({100*b4l//b4c}%)')

    # ── C: Two-shot progressive calibration ───────────────────────────────────
    print('\n[C] Two-shot progressive calibration  (different light per shot)')
    print('-' * 70)
    cok = ctot = 0
    clc_total = []
    failures = []
    for tag, state, light0, light1 in TWO_SHOT_SCENARIOS:
        ok, tot, lc = run_two_shot_scenario(tag, state, light0, light1,
                                             save_prefix=os.path.join(OUT_DIR, f'test_cube_{tag}'))
        cok += ok; ctot += tot; clc_total += lc
        if ok < tot:
            failures.append((tag, ok, tot))
    print(f'\n  TOTAL C  Lab(two-shot) {cok}/{ctot} ({100*cok//ctot}%)')
    print(f'  Low-confidence stickers: {len(clc_total)}')

    # ── D: Self-correcting analysis ───────────────────────────────────────────
    if failures or all_low_conf or clc_total:
        print('\n[D] Failure analysis & self-correction')
        print('-' * 70)
        if failures:
            print('  Lab classification failures:')
            for tag, ok, tot in failures:
                print(f'    {tag}: {ok}/{tot}  <- INVESTIGATE')
        low_wrong = [(f, r, c, e, g, cf) for f, r, c, e, g, cf in (clc_total + all_low_conf) if g != e]
        low_right = [(f, r, c, e, g, cf) for f, r, c, e, g, cf in (clc_total + all_low_conf) if g == e]
        print(f'\n  Low-confidence breakdown:')
        print(f'    Correctly classified but uncertain: {len(low_right)}')
        print(f'    Misclassified AND uncertain:        {len(low_wrong)}')
        if low_wrong:
            print('  -> These are the candidates for confidence-flagging in review UI:')
            seen = set()
            for f, r, c, e, g, cf in low_wrong[:8]:
                key = (e, g)
                if key not in seen:
                    seen.add(key)
                    print(f'      {e}->{g} pair (conf={cf:.2f}): highlight in UI')
        print('\n  Recommended thresholds for UI uncertainty highlight:')
        confs = [cf for _, _, _, _, _, cf in all_low_conf + clc_total]
        if confs:
            avg_conf = sum(confs) / len(confs)
            min_conf = min(confs)
            print(f'    min confidence seen: {min_conf:.2f}x')
            print(f'    avg low confidence:  {avg_conf:.2f}x')
            print(f'    -> Flag stickers with confidence < 2.0x as uncertain in review UI')
    else:
        print('\n[D] All tests passed. No failures to analyze.')

    # ── Final summary ─────────────────────────────────────────────────────────
    print('\n' + '=' * 70)
    grand_lab_ok  = tl + bl + b2l + b3l + b4l + cok
    grand_lab_tot = tc + bc + b2c + b3c + b4c + ctot
    grand_hsv_ok  = th + bh + b2h + b3h
    grand_hsv_tot = tc + bc + b2c + b3c
    print(f'  GRAND TOTAL')
    print(f'    HSV:      {grand_hsv_ok}/{grand_hsv_tot} ({100*grand_hsv_ok//grand_hsv_tot}%)  '
          f'(no isometric; HSV is fallback only)')
    print(f'    Lab:      {grand_lab_ok}/{grand_lab_tot} ({100*grand_lab_ok//grand_lab_tot}%)')
    print(f'      A flat:        {tl}/{tc} ({100*tl//tc}%)')
    print(f'      B per-face:    {bl}/{bc} ({100*bl//bc}%)')
    print(f'      B2 shadows:    {b2l}/{b2c} ({100*b2l//b2c}%)')
    print(f'      B3 gradients:  {b3l}/{b3c} ({100*b3l//b3c}%)')
    print(f'      B4 isometric:  {b4l}/{b4c} ({100*b4l//b4c}%)')
    print(f'      C two-shot:    {cok}/{ctot} ({100*cok//ctot}%)')
    pngs = sorted(f for f in os.listdir(OUT_DIR) if f.startswith('test_cube_') and f.endswith('.png'))
    print(f'    PNGs:     {len(pngs)} generated')
    print('=' * 70)
