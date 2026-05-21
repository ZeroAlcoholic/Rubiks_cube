// 純邏輯回歸測試（Node.js）
// 不依賴 DOM、不依賴 cubejs；驗證 cube3x3.html 內的核心演算法
// 跑法：node test_logic.js

const STATE_FACE_ORDER = ['U', 'R', 'F', 'D', 'L', 'B'];
const SOLVED = STATE_FACE_ORDER.map(f => f.repeat(9)).join('');

// 與 cube3x3.html _tryAutoOrientFaces 一致的旋轉矩陣
const ROT = [
    [0,1,2,3,4,5,6,7,8],  // 0°
    [6,3,0,7,4,1,8,5,2],  // 90° CW
    [8,7,6,5,4,3,2,1,0],  // 180°
    [2,5,8,1,4,7,0,3,6],  // 270° CW (= 90° CCW)
];

let pass = 0, fail = 0;
const failures = [];
function check(cond, name) {
    if (cond) { pass++; console.log('  ✓', name); }
    else { fail++; failures.push(name); console.log('  ✗', name); }
}

// ============================================================
console.log('\n=== T1: ROT 矩陣正確性 ===');
// (a) 旋轉後再反向旋轉，必須還原
function rotFace(face9, r) {
    return ROT[r].map(i => face9[i]).join('');
}
const inv = [0, 3, 2, 1]; // 0→0, 90→270, 180→180, 270→90
const sample = 'ABCDEFGHI';
for (let r = 0; r < 4; r++) {
    const rotated = rotFace(sample, r);
    const back = rotFace(rotated, inv[r]);
    check(back === sample, `rot(${r*90}°) → rot(${inv[r]*90}°) 還原`);
}
// (b) 中心格 (index 4) 永遠不動
for (let r = 0; r < 4; r++) {
    check(ROT[r][4] === 4, `ROT[${r}][4]=4 (中心保持不動)`);
}
// (c) 每個矩陣是 0..8 的排列
for (let r = 0; r < 4; r++) {
    const sorted = [...ROT[r]].sort((a,b)=>a-b);
    check(sorted.join(',') === '0,1,2,3,4,5,6,7,8', `ROT[${r}] 是 0..8 的排列`);
}

// ============================================================
console.log('\n=== T2: _tryAutoOrientFaces 邏輯（不需 cubejs）===');
// 模擬：給定合法 SOLVED 狀態，每面隨機旋轉，搜尋必能還原

function buildScanConfirmedFaces(stateStr) {
    const obj = {};
    STATE_FACE_ORDER.forEach((f, fi) => {
        obj[f] = stateStr.slice(fi * 9, fi * 9 + 9).split('');
    });
    return obj;
}

function applyMaskRotations(scanConfirmedFaces, mask) {
    const result = {};
    STATE_FACE_ORDER.forEach((f, fi) => {
        const r = (mask >> (fi * 2)) & 3;
        const orig = scanConfirmedFaces[f];
        result[f] = (r === 0 ? orig : ROT[r].map(i => orig[i]));
    });
    return result;
}

function statesEqual(a, b) {
    return STATE_FACE_ORDER.every(f => a[f].join('') === b[f].join(''));
}

// 正向：單面旋轉 90°，搜尋一定能找到「能還原成原狀態」的 mask
function searchInverseMask(original, scrambled) {
    for (let mask = 0; mask < 4096; mask++) {
        const candidate = applyMaskRotations(scrambled, mask);
        if (statesEqual(candidate, original)) return mask;
    }
    return -1;
}

const orig = buildScanConfirmedFaces(SOLVED);

// (a) 單面旋轉 90°，必能還原
for (let fi = 0; fi < 6; fi++) {
    for (let rotation = 1; rotation < 4; rotation++) {
        const scrambled = JSON.parse(JSON.stringify(orig));
        scrambled[STATE_FACE_ORDER[fi]] = ROT[rotation].map(i => orig[STATE_FACE_ORDER[fi]][i]);
        const fixMask = searchInverseMask(orig, scrambled);
        check(fixMask >= 0, `${STATE_FACE_ORDER[fi]}面旋轉${rotation*90}° 可被搜尋還原`);
    }
}

// (b) 兩面同時旋轉，必能還原
for (let trial = 0; trial < 5; trial++) {
    const scrambled = JSON.parse(JSON.stringify(orig));
    const f1 = Math.floor(Math.random() * 6);
    let f2; do { f2 = Math.floor(Math.random() * 6); } while (f2 === f1);
    const r1 = 1 + Math.floor(Math.random() * 3);
    const r2 = 1 + Math.floor(Math.random() * 3);
    scrambled[STATE_FACE_ORDER[f1]] = ROT[r1].map(i => orig[STATE_FACE_ORDER[f1]][i]);
    scrambled[STATE_FACE_ORDER[f2]] = ROT[r2].map(i => orig[STATE_FACE_ORDER[f2]][i]);
    const fixMask = searchInverseMask(orig, scrambled);
    check(fixMask >= 0, `兩面隨機旋轉(${STATE_FACE_ORDER[f1]}${r1*90}°,${STATE_FACE_ORDER[f2]}${r2*90}°) 可還原`);
}

// (c) 4096 mask 確實覆蓋全部 4^6 組合
const seen = new Set();
for (let mask = 0; mask < 4096; mask++) {
    seen.add([0,1,2,3,4,5].map(fi => (mask >> (fi*2)) & 3).join(','));
}
check(seen.size === 4096, '4096 mask 覆蓋全部 4^6 組合');

// ============================================================
console.log('\n=== T3: getTwoShotPanels 幾何（多種螢幕尺寸）===');

function getTwoShotPanels(width, height) {
    const size = Math.min(width, height) * 0.44;
    const cx = width / 2;
    const cy = height * 0.46;
    const halfWidth = size * 0.79;
    const top         = { x: cx,             y: cy - size * 0.86 };
    const right       = { x: cx + halfWidth, y: cy - size * 0.43 };
    const center      = { x: cx,             y: cy + size * 0.02 };
    const left        = { x: cx - halfWidth, y: cy - size * 0.43 };
    const bottomRight = { x: cx + halfWidth, y: cy + size * 0.68 };
    const bottom      = { x: cx,             y: cy + size * 1.10 };
    const bottomLeft  = { x: cx - halfWidth, y: cy + size * 0.68 };
    return { top, right, center, left, bottomRight, bottom, bottomLeft };
}

const SCREENS = [
    ['Pixel 7',         412, 637],
    ['Pixel 8a',        411, 599],
    ['iPhone 13',       390, 664],
    ['iPhone 14 Pro',   393, 700],
    ['Android S21',     360, 680],
    ['iPad portrait',   768, 1024],
    ['Desktop 4:3',     760, 570],
];

SCREENS.forEach(([name, W, H]) => {
    const p = getTwoShotPanels(W, H);
    const allPts = Object.values(p);
    const inBounds = allPts.every(pt => pt.x >= 0 && pt.x <= W && pt.y >= 0 && pt.y <= H);
    check(inBounds, `${name} (${W}×${H}) 所有點在界內`);
});

// 比例對齊照片（針對手機豎拍：top 22-25%, bottom 72-78%, span 66-70%）
const PHONE = [['Pixel 7', 412, 637], ['iPhone 13', 390, 664], ['iPhone 14 Pro', 393, 700]];
PHONE.forEach(([name, W, H]) => {
    const p = getTwoShotPanels(W, H);
    const topPct = p.top.y / H * 100;
    const botPct = p.bottom.y / H * 100;
    const spanPct = (p.right.x - p.left.x) / W * 100;
    check(topPct >= 20 && topPct <= 27, `${name} top y=${topPct.toFixed(1)}% 在 20-27%`);
    check(botPct >= 70 && botPct <= 80, `${name} bottom y=${botPct.toFixed(1)}% 在 70-80%`);
    check(spanPct >= 65 && spanPct <= 71, `${name} 水平 span=${spanPct.toFixed(1)}% 在 65-71%`);
});

// ============================================================
console.log('\n=== T4: StateValidator3 計數邏輯（不需 cubejs）===');
// 簡化版：模擬 validate 的計數部分
function validateCounts(stateStr) {
    const errors = [];
    if (typeof stateStr !== 'string' || stateStr.length !== 54) {
        return { ok: false, errors: ['長度不是 54'] };
    }
    if (!/^[URFDLB]{54}$/.test(stateStr)) {
        return { ok: false, errors: ['含非法字元'] };
    }
    const counts = {};
    STATE_FACE_ORDER.forEach(f => counts[f] = 0);
    for (const ch of stateStr) counts[ch]++;
    STATE_FACE_ORDER.forEach(f => {
        if (counts[f] !== 9) errors.push(`${f}=${counts[f]}`);
    });
    const centers = STATE_FACE_ORDER.map((_, i) => stateStr[i * 9 + 4]);
    if (new Set(centers).size !== 6) errors.push('中心格重複');
    return { ok: errors.length === 0, errors };
}

check(validateCounts(SOLVED).ok, 'SOLVED 通過計數驗證');
check(!validateCounts('U'.repeat(54)).ok, '全 U 應失敗');
check(!validateCounts(SOLVED.slice(0, 53)).ok, '53 字元應失敗');
check(!validateCounts('X' + SOLVED.slice(1)).ok, '含非法字元應失敗');

// 中心格重複檢測
const dupCenter = STATE_FACE_ORDER.map(f => f === 'B' ? 'U'.repeat(4) + 'U' + 'U'.repeat(4) : f.repeat(9)).join('');
// 上面 B 中心改為 U → 但每色 9 個的條件會壞掉。改為：U 中心改為 R
const dup2 = SOLVED.slice(0,4) + 'R' + SOLVED.slice(5);  // U 中心改 R
check(!validateCounts(dup2).ok || validateCounts(dup2).errors.some(e => e.includes('中心格') || e.includes('=8') || e.includes('=10')), '中心格重複或數量錯誤被偵測');

// ============================================================
console.log('\n=== T5: _labDist 與 rgbToLab 數學一致性 ===');
// 與 cube3x3.html 內的 rgbToLab 一致
function rgbToLab(rgb) {
    let { r, g, b } = rgb;
    r /= 255; g /= 255; b /= 255;
    const linearize = c => c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92;
    r = linearize(r); g = linearize(g); b = linearize(b);
    const X = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
    const Y =  r * 0.2126729 + g * 0.7151522 + b * 0.0721750;
    const Z = (r * 0.0193339 + g * 0.1191920 + b * 0.9503041) / 1.08883;
    const f = t => t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16/116);
    const fx = f(X), fy = f(Y), fz = f(Z);
    return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}
function labDist(a, b) {
    const dL = a.L - b.L, da = a.a - b.a, db = a.b - b.b;
    return dL*dL + da*da + db*db;
}

// (a) RGB→Lab 已知值（白色 = L≈100, a≈0, b≈0）
const white = rgbToLab({r:255, g:255, b:255});
check(Math.abs(white.L - 100) < 0.5, `純白 L≈100 (got ${white.L.toFixed(2)})`);
check(Math.abs(white.a) < 0.5, `純白 a≈0 (got ${white.a.toFixed(2)})`);
check(Math.abs(white.b) < 0.5, `純白 b≈0 (got ${white.b.toFixed(2)})`);

// (b) 純黑 = L=0
const black = rgbToLab({r:0, g:0, b:0});
check(Math.abs(black.L) < 0.5, `純黑 L≈0 (got ${black.L.toFixed(2)})`);

// (c) 同色 distance = 0
check(labDist(white, white) === 0, '同色 Lab 距離為 0');

// (d) 黑白距離 = 100^2 = 10000
check(Math.abs(labDist(white, black) - 10000) < 1, `黑白 Lab 距離 ≈ 10000 (got ${labDist(white,black).toFixed(0)})`);

// ============================================================
console.log('\n=== 結果 ===');
console.log(`通過: ${pass}/${pass+fail}`);
if (fail > 0) {
    console.log('失敗項目:');
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
}
console.log('全部通過 ✓');
