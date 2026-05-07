"""
魔術方塊顏色分類器壓力測試
驗證：HSV 舊分類 vs Lab 漸進式調色板新分類
在多種模擬光影條件下的精準度

生成策略：
  1. 取各面標準顏色
  2. 套用模擬光影轉換（暖光 LED、陰影、高光、斜角色偏）
  3. 以兩種分類器判斷，對比正確率
  4. 同時測試「漸進式調色板」：假設第一面已拍，校準後分類其餘面
"""

import math
import colorsys
import itertools

# ── 常數（與 cube3x3.html 一致）──────────────────────────────────────────────
FACE_COLORS_HEX = {
    'U': '#ffff00',  # 黃
    'R': '#ffa500',  # 橘
    'F': '#0000ff',  # 藍
    'D': '#ffffff',  # 白
    'L': '#ff0000',  # 紅
    'B': '#00ff00',  # 綠
}
FACE_NAMES = {
    'U': '黃(U)', 'R': '橘(R)', 'F': '藍(F)',
    'D': '白(D)', 'L': '紅(L)', 'B': '綠(B)',
}

# ── 色彩工具函式（與 JS 版本完全相同的數學）─────────────────────────────────

def hex_to_rgb(hex_str):
    v = int(hex_str.lstrip('#'), 16)
    return {'r': (v >> 16) & 255, 'g': (v >> 8) & 255, 'b': v & 255}

def srgb_to_linear(value):
    v = value / 255
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4

def rgb_to_lab(rgb):
    r = srgb_to_linear(rgb['r'])
    g = srgb_to_linear(rgb['g'])
    b = srgb_to_linear(rgb['b'])
    x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047
    y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1.00000
    z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883
    def f(t):
        return t ** (1/3) if t > 0.008856 else 7.787 * t + 16/116
    fx, fy, fz = f(x), f(y), f(z)
    return {'l': 116 * fy - 16, 'a': 500 * (fx - fy), 'b': 200 * (fy - fz)}

def lab_dist_sq(a, b):
    return (a['l']-b['l'])**2 + (a['a']-b['a'])**2 + (a['b']-b['b'])**2

def classify_lab(rgb, palette_lab):
    lab = rgb_to_lab(rgb)
    return min(palette_lab, key=lambda f: lab_dist_sq(lab, palette_lab[f]))

def rgb_to_hsv(rgb):
    r, g, b = rgb['r']/255, rgb['g']/255, rgb['b']/255
    mx, mn = max(r, g, b), min(r, g, b)
    delta = mx - mn
    v = mx
    s = (delta / mx) if mx else 0
    if delta == 0:
        h = 0
    elif mx == r:
        h = 60 * (((g - b) / delta) % 6)
    elif mx == g:
        h = 60 * ((b - r) / delta + 2)
    else:
        h = 60 * ((r - g) / delta + 4)
    return h, s, v

def classify_hsv(rgb):
    h, s, v = rgb_to_hsv(rgb)
    if s < 0.20 and v > 0.65: return 'D'
    if 38 <= h <= 72 and s >= 0.42 and v >= 0.50: return 'U'
    if (h <= 12 or h >= 348) and s >= 0.48 and v >= 0.25: return 'L'
    if 12 < h < 38 and s >= 0.48 and v >= 0.25: return 'R'
    if 85 <= h <= 165 and s >= 0.30 and v >= 0.20: return 'B'
    if 175 <= h <= 270 and s >= 0.30 and v >= 0.20: return 'F'
    distances = {
        'U': abs(h - 55) + (80 if s < 0.42 else 0),
        'R': abs(h - 24) + (80 if s < 0.48 else 0),
        'L': min(abs(h), abs(360 - h)) + (80 if s < 0.48 else 0),
        'B': abs(h - 125) + (80 if s < 0.30 else 0),
        'F': abs(h - 222) + (80 if s < 0.30 else 0),
        'D': s * 300 + (1 - v) * 180,
    }
    return min(distances, key=distances.get)

# ── 光影模擬轉換 ──────────────────────────────────────────────────────────────

def clamp(v, lo=0, hi=255):
    return max(lo, min(hi, v))

def apply_warm_led(rgb, strength=1.0):
    """暖光 LED 色偏：紅偏高、藍偏低，模擬室內黃光"""
    return {
        'r': clamp(rgb['r'] * (1.0 + 0.14 * strength)),
        'g': clamp(rgb['g'] * (1.0 - 0.05 * strength)),
        'b': clamp(rgb['b'] * (1.0 - 0.15 * strength)),
    }

def apply_shadow(rgb, factor):
    """陰影：整體暗化"""
    return {k: clamp(v * factor) for k, v in rgb.items()}

def apply_specular(rgb, strength):
    """鏡面高光：往白色趨近"""
    return {
        'r': clamp(rgb['r'] + 255 * strength),
        'g': clamp(rgb['g'] + 255 * strength),
        'b': clamp(rgb['b'] + 255 * strength),
    }

def apply_teal_shift(rgb):
    """模擬斜角下綠色往青色（teal）偏移"""
    return {
        'r': clamp(rgb['r'] * 0.85),
        'g': clamp(rgb['g'] * 0.97),
        'b': clamp(rgb['b'] * 1.0 + 40),
    }

def apply_lime_shift(rgb):
    """模擬黃色貼紙的石灰黃（lime-chartreuse）色偏——實際拍攝觀察"""
    return {
        'r': clamp(rgb['r'] * 0.88),
        'g': clamp(rgb['g'] * 1.0),
        'b': clamp(rgb['b'] * 0.1 + 12),
    }

def apply_orange_shadow(rgb, face):
    """橘色/紅色在斜角深陰影下的色偏"""
    if face in ('R', 'L'):
        return {
            'r': clamp(rgb['r'] * 0.72),
            'g': clamp(rgb['g'] * 0.60),
            'b': clamp(rgb['b'] * 0.55),
        }
    return rgb

def apply_white_warm(rgb):
    """白色在暖光下微泛黃或薄荷"""
    return {
        'r': clamp(rgb['r'] * 1.05),
        'g': clamp(rgb['g'] * 1.02),
        'b': clamp(rgb['b'] * 0.88),
    }

# ── 標準 Lab 調色板（不校準） ──────────────────────────────────────────────
CANONICAL_PALETTE = {
    face: rgb_to_lab(hex_to_rgb(hex_str))
    for face, hex_str in FACE_COLORS_HEX.items()
}

# ── 測試情境定義 ──────────────────────────────────────────────────────────────
# 每個情境 = (名稱, 針對哪些面套用特殊變換, 全域光影函式)

def make_scene(name, global_fn=None, per_face_fn=None):
    return {'name': name, 'global': global_fn or (lambda rgb, face: rgb),
            'per_face': per_face_fn or (lambda rgb, face: rgb)}

def scene_transform(scene, rgb, face):
    rgb = scene['per_face'](rgb, face)
    rgb = scene['global'](rgb, face)
    return rgb

SCENES = [
    make_scene('① 正常標準色（無光影）'),
    make_scene('② 暖光 LED（中強度）',
               global_fn=lambda rgb, f: apply_warm_led(rgb, 0.8)),
    make_scene('③ 暖光 LED（強）',
               global_fn=lambda rgb, f: apply_warm_led(rgb, 1.3)),
    make_scene('④ 深陰影（factor=0.60）',
               global_fn=lambda rgb, f: apply_shadow(rgb, 0.60)),
    make_scene('⑤ 暖光 + 中陰影',
               global_fn=lambda rgb, f: apply_shadow(apply_warm_led(rgb, 1.0), 0.72)),
    make_scene('⑥ 暖光 + 深陰影（最差情境）',
               global_fn=lambda rgb, f: apply_shadow(apply_warm_led(rgb, 1.3), 0.58)),
    make_scene('⑦ 鏡面高光（v≈0.95）',
               global_fn=lambda rgb, f: apply_specular(rgb, 0.22)),
    make_scene('⑧ 實際黃色＝石灰黃（lime）',
               per_face_fn=lambda rgb, f: apply_lime_shift(rgb) if f == 'U' else rgb,
               global_fn=lambda rgb, f: apply_warm_led(rgb, 0.7)),
    make_scene('⑨ 綠色→青色偏移（teal）',
               per_face_fn=lambda rgb, f: apply_teal_shift(rgb) if f == 'B' else rgb,
               global_fn=lambda rgb, f: apply_warm_led(rgb, 0.6)),
    make_scene('⑩ 白色泛黃（暖光白）',
               per_face_fn=lambda rgb, f: apply_white_warm(rgb) if f == 'D' else rgb,
               global_fn=lambda rgb, f: apply_warm_led(rgb, 0.5)),
    make_scene('⑪ 橘/紅深陰影混淆',
               per_face_fn=lambda rgb, f: apply_orange_shadow(rgb, f),
               global_fn=lambda rgb, f: apply_shadow(apply_warm_led(rgb, 0.9), 0.65)),
    make_scene('⑫ 全套：暖光+陰影+黃色偏移（模擬實拍最惡劣）',
               per_face_fn=lambda rgb, f:
                   apply_lime_shift(rgb) if f == 'U' else
                   apply_teal_shift(rgb) if f == 'B' else
                   apply_white_warm(rgb) if f == 'D' else rgb,
               global_fn=lambda rgb, f: apply_shadow(apply_warm_led(rgb, 1.1), 0.68)),
]

# ── 執行測試 ──────────────────────────────────────────────────────────────────

def run_scene(scene):
    """
    對每個面計算轉換後的顏色，然後：
    A. HSV 分類（無校準）
    B. Lab 分類（正典調色板，無校準）
    C. Lab 分類（漸進式校準調色板）：
       假設掃描到第一面時取得其轉換後的中心格 RGB，
       更新該面的 Lab 參考值，其餘保持正典。
    """
    results = []
    # 計算各面轉換後 RGB（模擬相機拍攝的實際顏色）
    transformed = {}
    for face, hex_str in FACE_COLORS_HEX.items():
        base_rgb = hex_to_rgb(hex_str)
        t_rgb = scene_transform(scene, base_rgb, face)
        transformed[face] = {k: int(round(v)) for k, v in t_rgb.items()}

    # C: 漸進式校準調色板（模擬已拍完所有面後的調色板）
    # 實際上，在六面拍攝中，每拍完一面就用實測中心格更新該面的參考
    # 這裡模擬「全部面都已拍並更新」的最佳情況
    progressive_palette = {
        face: rgb_to_lab(transformed[face])
        for face in FACE_COLORS_HEX
    }

    # D: 單面校準（只已拍第一面 U，其餘用正典）
    one_face_palette = dict(CANONICAL_PALETTE)
    one_face_palette['U'] = rgb_to_lab(transformed['U'])

    hsv_correct = 0
    lab_canonical_correct = 0
    lab_progressive_correct = 0
    lab_one_face_correct = 0
    face_results = []

    for face in FACE_COLORS_HEX:
        t = transformed[face]
        h_result = classify_hsv(t)
        l_canon = classify_lab(t, CANONICAL_PALETTE)
        l_prog = classify_lab(t, progressive_palette)
        l_one = classify_lab(t, one_face_palette)

        h_ok = h_result == face
        lc_ok = l_canon == face
        lp_ok = l_prog == face
        lo_ok = l_one == face

        hsv_correct += h_ok
        lab_canonical_correct += lc_ok
        lab_progressive_correct += lp_ok
        lab_one_face_correct += lo_ok

        face_results.append({
            'face': face,
            'rgb': t,
            'hsv': (h_result, h_ok),
            'lab_canon': (l_canon, lc_ok),
            'lab_prog': (l_prog, lp_ok),
            'lab_one': (l_one, lo_ok),
        })

    n = len(FACE_COLORS_HEX)
    return {
        'scene': scene['name'],
        'faces': face_results,
        'hsv_acc': hsv_correct / n,
        'lab_canon_acc': lab_canonical_correct / n,
        'lab_prog_acc': lab_progressive_correct / n,
        'lab_one_acc': lab_one_face_correct / n,
    }

# ── 報告輸出 ──────────────────────────────────────────────────────────────────
PASS = '✓'
FAIL = '✗'

print('=' * 80)
print('  魔術方塊顏色分類器壓力測試報告')
print('  HSV（舊）vs Lab 正典 vs Lab 漸進調色板（新）')
print('=' * 80)
print()

summary_rows = []
all_results = [run_scene(s) for s in SCENES]

for res in all_results:
    s = res['scene']
    h = res['hsv_acc']
    lc = res['lab_canon_acc']
    lp = res['lab_prog_acc']
    lo = res['lab_one_acc']
    print(f"{s}")
    print(f"  {'面':4s}  {'RGB':20s}  {'HSV':8s}  {'Lab正典':10s}  {'Lab漸進(全)':12s}  {'Lab漸進(U只)':12s}")

    for fr in res['faces']:
        face = fr['face']
        rgb = fr['rgb']
        rgb_str = f"({rgb['r']:3d},{rgb['g']:3d},{rgb['b']:3d})"
        h_r, h_ok = fr['hsv']
        lc_r, lc_ok = fr['lab_canon']
        lp_r, lp_ok = fr['lab_prog']
        lo_r, lo_ok = fr['lab_one']

        hsv_str = f"{PASS if h_ok else FAIL}{h_r}"
        lc_str = f"{PASS if lc_ok else FAIL}{lc_r}"
        lp_str = f"{PASS if lp_ok else FAIL}{lp_r}"
        lo_str = f"{PASS if lo_ok else FAIL}{lo_r}"

        name = FACE_NAMES[face]
        print(f"  {name:6s}  {rgb_str:20s}  {hsv_str:8s}  {lc_str:10s}  {lp_str:12s}  {lo_str:12s}")

    h_pct = int(h * 100)
    lc_pct = int(lc * 100)
    lp_pct = int(lp * 100)
    lo_pct = int(lo * 100)
    summary_rows.append((s, h_pct, lc_pct, lp_pct, lo_pct))
    print(f"  準確率：HSV={h_pct}%  Lab正典={lc_pct}%  Lab漸進(全)={lp_pct}%  Lab漸進(U)={lo_pct}%")
    print()

print('=' * 80)
print('  總結表')
print(f"  {'情境':<36s}  {'HSV':>6s}  {'Lab正':>6s}  {'Lab全':>6s}  {'LabU':>6s}")
print('-' * 80)
for name, h, lc, lp, lo in summary_rows:
    bar_h  = '█' * (h  // 10)
    bar_lp = '█' * (lp // 10)
    print(f"  {name:<36s}  {h:>5}%  {lc:>5}%  {lp:>5}%  {lo:>5}%")

total_h  = sum(r[1] for r in summary_rows) / len(summary_rows)
total_lc = sum(r[2] for r in summary_rows) / len(summary_rows)
total_lp = sum(r[3] for r in summary_rows) / len(summary_rows)
total_lo = sum(r[4] for r in summary_rows) / len(summary_rows)
print('-' * 80)
print(f"  {'平均':<36s}  {total_h:>5.1f}%  {total_lc:>5.1f}%  {total_lp:>5.1f}%  {total_lo:>5.1f}%")
print()
print('  欄位說明：')
print('  HSV    = 現有 HSVClassifier（未校準）')
print('  Lab正  = Lab 距離 + 正典顏色（未校準）')
print('  Lab全  = Lab 距離 + 全部六面中心格校準（最佳情境）')
print('  LabU   = Lab 距離 + 只有黃色面（U）已校準（漸進初期）')
print()
