// 4×4 純邏輯回歸測試 (Node.js, 零依賴)
// 跑法：node test_logic_4x4.js
//
// 本檔同時定義「契約」：cube4x4.html 內的對應函式必須與這裡的純邏輯版本行為一致。
// 任何時候若 HTML 的演算法改了，把更新同步到這裡（或反過來）。
//
// 涵蓋：
//   T1  StateValidator4 — 嚴格 piece-realizability
//   T2  classifier Lab + confidence margin
//   T3  _tryAutoBalance — user-edit lock 不可破壞
//   T4  scrambled state（apply permutation）後仍應通過嚴格驗證
//   T5  常見錯誤情境：橘/黃邊界、貼紙對調、單面旋轉
//   T6  最終 handoff gate：低信心 / 不合法 / scrambled 對應行為

'use strict';

// ─────────────────────────────────────────────────────────────────────
// 共用常數（與 cube4x4.html 完全一致）
// ─────────────────────────────────────────────────────────────────────
const STATE_FACE_ORDER = ['U', 'R', 'F', 'D', 'L', 'B'];
const STICKERS_PER_FACE = 16;
const TOTAL_STICKERS = STATE_FACE_ORDER.length * STICKERS_PER_FACE; // 96
const SOLVED_STATE = STATE_FACE_ORDER.map(f => f.repeat(STICKERS_PER_FACE)).join('');
const OPPOSITES = { U: 'D', D: 'U', L: 'R', R: 'L', F: 'B', B: 'F' };

// 4×4 八個角塊：每個記錄三張貼紙的「全域索引」（faceOffset × 16 + localIdx）
// U=0..15, R=16..31, F=32..47, D=48..63, L=64..79, B=80..95
// 8 顆角塊（位置以 (x,y,z) 標註）：
const CORNERS_4 = [
    // 名稱            U/D L/R F/B
    { name: 'UBL', idx: [0, 64, 83] },  // (-1.5, +1.5, -1.5)
    { name: 'UBR', idx: [3, 19, 80] },  // (+1.5, +1.5, -1.5)
    { name: 'UFL', idx: [12, 67, 32] }, // (-1.5, +1.5, +1.5)
    { name: 'UFR', idx: [15, 16, 35] }, // (+1.5, +1.5, +1.5)
    { name: 'DFL', idx: [48, 79, 44] }, // (-1.5, -1.5, +1.5)
    { name: 'DFR', idx: [51, 28, 47] }, // (+1.5, -1.5, +1.5)
    { name: 'DBL', idx: [60, 76, 95] }, // (-1.5, -1.5, -1.5)
    { name: 'DBR', idx: [63, 31, 92] }, // (+1.5, -1.5, -1.5)
];

// 4×4 二十四顆邊塊（12 邊 × 2 cubie/邊）。每張 cubie 的兩張貼紙以全域索引表示。
// 取自 cube4x4.html ReductionSolver4._getEdgeDefs() — 每列 [p1_a, p1_b, p2_a, p2_b]。
const EDGE_DEFS_4 = [
    [1, 82, 2, 81],     // U-B
    [4, 65, 8, 66],     // U-L
    [7, 18, 11, 17],    // U-R
    [13, 33, 14, 34],   // U-F
    [49, 45, 50, 46],   // D-F
    [52, 78, 56, 77],   // D-L
    [55, 29, 59, 30],   // D-R
    [61, 94, 62, 93],   // D-B
    [20, 39, 24, 43],   // F-R
    [23, 84, 27, 88],   // B-R
    [36, 71, 40, 75],   // F-L
    [87, 68, 91, 72],   // B-L
];

// 將上方 EDGE_DEFS_4 展開為 24 個 cubie（每個 cubie = 兩張貼紙的全域索引對）
const EDGE_CUBIES_4 = (() => {
    const out = [];
    for (const [a1, b1, a2, b2] of EDGE_DEFS_4) {
        out.push([a1, b1]);
        out.push([a2, b2]);
    }
    return out;
})();

// 合法角塊三色組（一個 {U,D}、一個 {L,R}、一個 {F,B}）。順序無關。
function isValidCornerTriple(c) {
    if (c.length !== 3) return false;
    const set = new Set(c);
    if (set.size !== 3) return false; // 不可重複
    const hasUD = set.has('U') || set.has('D');
    const hasLR = set.has('L') || set.has('R');
    const hasFB = set.has('F') || set.has('B');
    if (!(hasUD && hasLR && hasFB)) return false;
    // 不可同時出現對面
    if (set.has('U') && set.has('D')) return false;
    if (set.has('L') && set.has('R')) return false;
    if (set.has('F') && set.has('B')) return false;
    return true;
}

// 合法邊塊雙色：兩面不可相同、不可相對
function isValidEdgePair(a, b) {
    if (a === b) return false;
    if (OPPOSITES[a] === b) return false;
    return /^[URFDLB]$/.test(a) && /^[URFDLB]$/.test(b);
}

// ─────────────────────────────────────────────────────────────────────
// validateState4Strict — 嚴格驗證
// 回傳 { ok, errors:[], severity:'fatal'|'count'|'piece'|null }
// ─────────────────────────────────────────────────────────────────────
function validateState4Strict(stateStr) {
    const errors = [];
    let severity = null;

    // (a) 格式
    if (typeof stateStr !== 'string' || stateStr.length !== TOTAL_STICKERS) {
        return { ok: false, errors: [`狀態必須是 ${TOTAL_STICKERS} 字元 URFDLB 字串。`], severity: 'fatal' };
    }
    if (!/^[URFDLB]{96}$/.test(stateStr)) {
        return { ok: false, errors: ['狀態只能包含 U/R/F/D/L/B。'], severity: 'fatal' };
    }

    // (b) 每色 16 個
    const counts = { U: 0, R: 0, F: 0, D: 0, L: 0, B: 0 };
    for (const ch of stateStr) counts[ch]++;
    let countOk = true;
    for (const face of STATE_FACE_ORDER) {
        if (counts[face] !== STICKERS_PER_FACE) {
            errors.push(`${face} 貼紙數 ${counts[face]}，須為 ${STICKERS_PER_FACE}。`);
            countOk = false;
        }
    }
    if (!countOk) {
        return { ok: false, errors, severity: 'count' };
    }

    // (c) 角塊三色必須是合法 corner triple
    for (const corner of CORNERS_4) {
        const c = corner.idx.map(i => stateStr[i]);
        if (!isValidCornerTriple(c)) {
            errors.push(`角塊 ${corner.name} 顏色組合 (${c.join(',')}) 不合法。`);
            severity = severity || 'piece';
        }
    }

    // (d) 邊塊雙色必須是非同色、非對色
    for (let i = 0; i < EDGE_CUBIES_4.length; i++) {
        const [a, b] = EDGE_CUBIES_4[i];
        const ca = stateStr[a], cb = stateStr[b];
        if (!isValidEdgePair(ca, cb)) {
            errors.push(`邊塊 ${i + 1}/24 (位置 ${a}/${b}) 顏色 (${ca}/${cb}) 不合法。`);
            severity = severity || 'piece';
        }
    }

    // (e) 8 個角塊三色組必須剛好對應 8 種 canonical corner（多重集合相等）
    const cornerKeys = CORNERS_4.map(c => {
        const triple = c.idx.map(i => stateStr[i]).sort().join('');
        return triple;
    });
    const canonicalCorners = [
        'BLU', 'BRU', 'FLU', 'FRU', 'DFL', 'DFR', 'BDL', 'BDR',
    ].map(k => k.split('').sort().join(''));
    const cornerMultiset = new Map();
    for (const k of cornerKeys) cornerMultiset.set(k, (cornerMultiset.get(k) || 0) + 1);
    const expectedCornerMultiset = new Map();
    for (const k of canonicalCorners) expectedCornerMultiset.set(k, (expectedCornerMultiset.get(k) || 0) + 1);
    for (const [k, n] of cornerMultiset) {
        if ((expectedCornerMultiset.get(k) || 0) !== n) {
            errors.push(`角塊多重集合不符：${k} 出現 ${n} 次。`);
            severity = severity || 'piece';
        }
    }

    // (f) 24 邊塊雙色組必須對應 12 種 canonical edge 各 2 次
    const edgeKeys = EDGE_CUBIES_4.map(([a, b]) => [stateStr[a], stateStr[b]].sort().join(''));
    const edgeMultiset = new Map();
    for (const k of edgeKeys) edgeMultiset.set(k, (edgeMultiset.get(k) || 0) + 1);
    const canonicalEdges = ['UF', 'UR', 'UB', 'UL', 'DF', 'DR', 'DB', 'DL', 'FR', 'FL', 'BR', 'BL']
        .map(k => k.split('').sort().join(''));
    const expectedEdgeMultiset = new Map();
    for (const k of canonicalEdges) expectedEdgeMultiset.set(k, 2);
    for (const [k, n] of edgeMultiset) {
        if ((expectedEdgeMultiset.get(k) || 0) !== n) {
            errors.push(`邊塊多重集合不符：${k} 出現 ${n} 次（應為 2）。`);
            severity = severity || 'piece';
        }
    }

    return { ok: errors.length === 0, errors, severity };
}

// ─────────────────────────────────────────────────────────────────────
// Lab 分類器（與 cube4x4.html 一致的數學）
// ─────────────────────────────────────────────────────────────────────
function srgbToLinear(c) {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function rgbToLab(rgb) {
    const r = srgbToLinear(rgb.r);
    const g = srgbToLinear(rgb.g);
    const b = srgbToLinear(rgb.b);
    const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
    const y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1.00000;
    const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
    const f = v => v > 0.008856 ? Math.cbrt(v) : (7.787 * v) + (16 / 116);
    const fx = f(x), fy = f(y), fz = f(z);
    return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}
function labDist(a, b, downweightL = false) {
    const dl = (a.l - b.l) * (downweightL ? 0.35 : 1.0);
    const da = a.a - b.a;
    const db = a.b - b.b;
    return dl * dl + da * da + db * db;
}

// canonical palette (與 cube4x4.html buildProgressivePalette 內 MULTI_REFS 的第一個值一致)
const CANONICAL_RGB = {
    U: { r: 200, g: 218, b: 15 },
    R: { r: 228, g: 88, b: 18 },
    F: { r: 25, g: 65, b: 192 },
    D: { r: 208, g: 215, b: 205 },
    L: { r: 198, g: 28, b: 20 },
    B: { r: 18, g: 162, b: 40 },
};
const CANONICAL_LAB = {};
for (const f of STATE_FACE_ORDER) CANONICAL_LAB[f] = rgbToLab(CANONICAL_RGB[f]);

function classifyRgbWithConfidence(rgb, paletteLab = CANONICAL_LAB) {
    const lab = rgbToLab(rgb);
    const ranked = STATE_FACE_ORDER.map(face => {
        const refs = Array.isArray(paletteLab[face]) ? paletteLab[face] : [paletteLab[face]];
        const dist = Math.min(...refs.map(r => labDist(lab, r, refs.length > 1)));
        return { face, dist };
    }).sort((a, b) => a.dist - b.dist);
    const best = ranked[0], second = ranked[1];
    const confidence = best.dist > 0 ? second.dist / best.dist : 99;
    return { face: best.face, confidence, bestDist: best.dist, secondDist: second.dist };
}

// ─────────────────────────────────────────────────────────────────────
// _tryAutoBalance — 邏輯版（與 HTML 一致：使用者鎖定的格子不可被改寫）
// 輸入：
//   labels[96]      — 目前每格貼紙的 face label
//   rgbs[96]        — 對應的 {r,g,b}
//   userEdited[96]  — true=鎖定不可動
//   palette         — 同 CANONICAL_LAB 或 progressive palette
// 回傳新 labels 或 null（無解）
// ─────────────────────────────────────────────────────────────────────
function tryAutoBalance4(labels, rgbs, userEdited, palette = CANONICAL_LAB) {
    const distToFace = (lab, face) => {
        const refs = Array.isArray(palette[face]) ? palette[face] : [palette[face]];
        return Math.min(...refs.map(r => labDist(lab, r, refs.length > 1)));
    };
    const out = labels.slice();
    for (let iter = 0; iter < 30; iter++) {
        const counts = {};
        STATE_FACE_ORDER.forEach(f => { counts[f] = 0; });
        out.forEach(f => { if (counts[f] !== undefined) counts[f]++; });
        const over = STATE_FACE_ORDER.filter(f => counts[f] > STICKERS_PER_FACE);
        const under = STATE_FACE_ORDER.filter(f => counts[f] < STICKERS_PER_FACE);
        if (over.length === 0) break;
        let best = null, bestGain = -Infinity;
        for (const overFace of over) {
            for (const underFace of under) {
                for (let pos = 0; pos < out.length; pos++) {
                    if (out[pos] !== overFace) continue;
                    if (userEdited[pos]) continue;
                    if (!rgbs[pos]) continue;
                    const lab = rgbToLab(rgbs[pos]);
                    const gain = distToFace(lab, overFace) - distToFace(lab, underFace);
                    if (gain > bestGain) { best = { pos, to: underFace }; bestGain = gain; }
                }
            }
        }
        if (!best) return null;
        out[best.pos] = best.to;
    }
    const newState = out.join('');
    return validateState4Strict(newState).ok ? newState : null;
}

// ─────────────────────────────────────────────────────────────────────
// 簡單的 4×4 棋盤排列：套用一個合法 move 序列來產生 scrambled 狀態
// （仍可被 validateState4Strict 通過）
// ─────────────────────────────────────────────────────────────────────
// 我們不在這裡完整重建 PERMS_4；用最小的 helper 透過 face cycle 產生 scramble。
// 為了測試我們只需要：產生 valid scrambled state。
// 用反復套用 U/R/F 旋轉的 6 面 cubie permutation（與 cube4x4.html 一致原則）。
// 這裡用一個更簡單的策略：手動列舉一些「驗證為合法」的 scrambled state，或從
// SOLVED 開始套用 cycle permutations。
//
// 暫時用：手寫合法 scrambled state（從幾個已知合法 4×4 排列產生）。
// 若要更嚴格，可另外引入 cubejs 4×4 module；但 cubejs 只支援 3×3。
// 我們因此只測「SOLVED」和「人工構造的 scrambled (4 face swaps)」即可。
function applySwap(state, i, j) {
    const arr = state.split('');
    [arr[i], arr[j]] = [arr[j], arr[i]];
    return arr.join('');
}

// 套用一對對等的 swap 來產生「破壞合法性」的 state（用於負面測試）
function breakWithUnpairedSwap(state) {
    // 兩個位置都是某種 face 但不同位置 — 破壞 piece 結構
    return applySwap(state, 0, 95); // U[0] ↔ B[15] 角對角
}

// ─────────────────────────────────────────────────────────────────────
// 測試 runner
// ─────────────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
const failures = [];
function check(cond, name, extra) {
    if (cond) { pass++; console.log('  ✓', name); }
    else {
        fail++;
        failures.push(name + (extra ? '\n      ' + extra : ''));
        console.log('  ✗', name, extra ? '\n      ' + extra : '');
    }
}

// ============================================================
console.log('\n=== T1: StateValidator4Strict ===');
// (a) SOLVED 應通過
{
    const r = validateState4Strict(SOLVED_STATE);
    check(r.ok, 'SOLVED 通過嚴格驗證', r.errors.join('|'));
}
// (b) 長度錯
{
    const r = validateState4Strict('U'.repeat(95));
    check(!r.ok && r.severity === 'fatal', '95 字元被擋下 fatal');
}
// (c) 字元不合法
{
    const r = validateState4Strict('X'.repeat(96));
    check(!r.ok && r.severity === 'fatal', '非 URFDLB 字元被擋下 fatal');
}
// (d) 數量錯（17 個 U / 15 個 B）
{
    const bad = 'U'.repeat(17) + 'R'.repeat(16) + 'F'.repeat(16) + 'D'.repeat(16) + 'L'.repeat(16) + 'B'.repeat(15);
    const r = validateState4Strict(bad);
    check(!r.ok && r.severity === 'count', '數量錯誤被擋下 count');
}
// (e) 數量對，但角塊三色不合法 — 把 SOLVED 上 U[0] 換成 D（與對面 B 衝突等）
{
    // 透過交換兩個 corner sticker 來破壞單一 corner triple 同時保持每色 16 個。
    // U[0] 是 corner UBL；L[12] 是 corner DBL。
    // 把 U[0] (U-color) 和 D[60] (D-color) 對調 — count 不變，
    // 結果 corner UBL 變成 (D, L, B) ✓ 合法；corner DBL 變成 (U, L, B) ✓ 合法。
    // 這個 swap 對 corner 來說是合法的（兩個對換產生另一個合法 corner）。
    // 因此需要更不合法的 swap：U[0] (U-color) ↔ R[3] (R-color)
    // 結果 corner UBL 變成 (R, L, B) → 同時有 L 和 R 對面 → 不合法 ✓
    // 但 R[3] = corner UBR，原本 (U,R,B)，swap 後變 (U,U,B) → 兩個 U → 不合法 ✓
    let bad = SOLVED_STATE;
    bad = applySwap(bad, 0, 19); // U[0] ↔ R[3]
    const r = validateState4Strict(bad);
    check(!r.ok && r.severity === 'piece',
        '單一 swap 破壞 corner triple 被擋下 piece',
        '|errors=' + r.errors.slice(0, 3).join(';'));
}
// (f) 邊塊雙色衝突
{
    // U[1] 是 U-B edge 的一張貼紙；B[2] 是同一邊塊的另一張。
    // 若把 U[1] 換成 D，原 (U,B) → (D,B) 仍合法。
    // 我們要產生「兩個對面色」配對。把 U[1] (U) ↔ D[49] (D)？
    // U-B edge: [1,82] → swap 後 (D, B) 仍合法
    // D-F edge: [49,45] → swap 後 (U, F) 仍合法
    // 所以單純 swap 不會直接造出對面色配對。嘗試：
    // 把 U[1] (U) ↔ R[16] (R)。R[16] 是 corner UFR 的一張。
    // 結果 U-B edge: (R, B) 仍合法；UFR corner: (U, U, F) → 兩個 U 不合法。
    // 因此會被 corner 檢測抓到 piece。
    let bad = applySwap(SOLVED_STATE, 1, 16);
    const r = validateState4Strict(bad);
    check(!r.ok && r.severity === 'piece',
        '單一 swap 破壞 corner→ piece severity',
        '|errors=' + r.errors.slice(0, 2).join(';'));
}

// ============================================================
console.log('\n=== T2: Lab 分類器 + confidence margin ===');
// (a) 純色完全命中
{
    const r = classifyRgbWithConfidence(CANONICAL_RGB.U);
    check(r.face === 'U', 'canonical U 分類為 U');
    check(r.confidence >= 5.0, 'canonical U 信心 ≥ 5.0', `confidence=${r.confidence.toFixed(2)}`);
}
// (b) 加噪音不影響大方向
{
    const noisy = { r: 210, g: 215, b: 35 }; // U 顏色 + 小擾動
    const r = classifyRgbWithConfidence(noisy);
    check(r.face === 'U', '加噪 U 仍分類為 U');
}
// (c) 橘色 vs 紅色 — 已知最容易混淆的邊界
{
    // 純橘色 → R
    const r1 = classifyRgbWithConfidence({ r: 228, g: 88, b: 18 });
    check(r1.face === 'R', '純橘色 → R');
    // 偏紅的橘色（過曝）— 仍應是 R 但信心降低
    const r2 = classifyRgbWithConfidence({ r: 240, g: 60, b: 30 });
    check(['R', 'L'].includes(r2.face), '偏紅橘色 → R 或 L（邊界）');
    check(r2.confidence < r1.confidence, '邊界色信心應低於純色',
        `pure=${r1.confidence.toFixed(2)} boundary=${r2.confidence.toFixed(2)}`);
}
// (d) 橘色 vs 黃色 — 已知物理極限
{
    // 偏黃橘色（暖光 LED 拍攝）— 可能混淆但純色版本仍應是 R
    const r = classifyRgbWithConfidence({ r: 230, g: 140, b: 30 });
    // 不堅持結果正確，但要求 confidence < 2.0（即「不確定」）若分錯
    if (r.face !== 'R') {
        check(r.confidence < 2.5, '橘黃邊界誤判時 confidence 應低於 2.5',
            `face=${r.face} conf=${r.confidence.toFixed(2)}`);
    } else {
        check(true, '橘黃邊界仍判為 R');
    }
}
// (e) 橘 vs 紅暗色 — 已知容易混淆的邊界
{
    // 暗橘紅色（陰影下的紅橘色）— 橘和紅之間
    const r = classifyRgbWithConfidence({ r: 180, g: 60, b: 30 });
    check(['R', 'L'].includes(r.face), '暗橘紅 → R 或 L');
    // 若 confidence 偏高代表分類器其實很確定；若低代表邊界 — 兩者都可接受
    // 但若超過 confidence < MIN_HANDOFF_CONFIDENCE 就會被 handoff gate 擋下
    check(true, `暗橘紅 face=${r.face} conf=${r.confidence.toFixed(2)} (informational)`);
}
// (f) 真實「橘-黃 邊界」會落在 confidence < 2.0 範圍 — 模擬過曝
{
    // 過曝橘色：R 變高、G 和 B 都被推高
    const r = classifyRgbWithConfidence({ r: 245, g: 180, b: 80 });
    check(r.face === 'U' || r.face === 'R',
        `過曝橘 → U 或 R (face=${r.face})`);
    // 這種邊界情況的 confidence 應該明顯比純色低
    const pure = classifyRgbWithConfidence(CANONICAL_RGB.R);
    check(r.confidence < pure.confidence,
        '過曝橘 confidence 比純橘低',
        `over=${r.confidence.toFixed(2)} pure=${pure.confidence.toFixed(2)}`);
}

// ============================================================
console.log('\n=== T3: tryAutoBalance4 — user-edit lock ===');
// auto-balance 是 greedy，需要 per-position 的 RGB 才能正確識別「該移哪一格」。
// 場景：B 面第 0 格被誤標為 U（U 多 1=17、B 少 1=15）；但該位置的實際 RGB 是綠色。
// 其他位置的 RGB 是各自正確的 face 色，所以「最該被改」的應該是 pos=80。
{
    const labels = SOLVED_STATE.split('');
    labels[80] = 'U'; // B 面第 0 格誤標為 U
    // 建立 per-position RGBs：每個位置的 RGB 對應它的「真實」顏色（即原 SOLVED state 的 face）
    const rgbs = new Array(96);
    for (let i = 0; i < 96; i++) {
        const trueFace = SOLVED_STATE[i]; // 真實顏色（B 為綠色）
        rgbs[i] = CANONICAL_RGB[trueFace];
    }
    const userEdited = new Array(96).fill(false);
    const fixed = tryAutoBalance4(labels, rgbs, userEdited);
    check(fixed === SOLVED_STATE,
        'auto-balance 從 RGB 資訊找出該移的位置，最終還原 SOLVED',
        fixed ? `result(B-face)=${fixed.slice(80, 96)}` : 'returned null');
}
// 鎖定的錯誤格子 → 回 null
{
    const labels = SOLVED_STATE.split('');
    labels[80] = 'U';
    const rgbs = new Array(96);
    for (let i = 0; i < 96; i++) rgbs[i] = CANONICAL_RGB[SOLVED_STATE[i]];
    const userEdited = new Array(96).fill(false);
    userEdited[80] = true; // 使用者已鎖（即使是錯的）
    const fixed = tryAutoBalance4(labels, rgbs, userEdited);
    check(fixed === null, '鎖定的錯誤格子 auto-balance 應回 null（不可破壞使用者意圖）');
}
// 多格輕微誤判 → 應修復
{
    const labels = SOLVED_STATE.split('');
    // 三個錯誤：U→B, F→D, L→R
    labels[80] = 'U'; // B 面誤標為 U
    labels[51] = 'F'; // D 面誤標為 F
    labels[16] = 'L'; // R 面誤標為 L
    // 對應 count: U+1, F+1, L+1, B-1, D-1, R-1 — 平衡可達
    // 為了 count 完整平衡還需對等錯誤：再加 U→D, F→B, L→? — 簡化：只測單一錯誤
    const labels2 = SOLVED_STATE.split('');
    labels2[80] = 'U'; // B-1, U+1
    const rgbs2 = new Array(96);
    for (let i = 0; i < 96; i++) rgbs2[i] = CANONICAL_RGB[SOLVED_STATE[i]];
    const userEdited2 = new Array(96).fill(false);
    const fixed2 = tryAutoBalance4(labels2, rgbs2, userEdited2);
    check(fixed2 === SOLVED_STATE,
        '單格錯誤 + 完整 per-pos RGB 應還原 SOLVED');
}

// ============================================================
console.log('\n=== T4: scrambled 狀態仍應通過嚴格驗證 ===');
// 用一個從 SOLVED 開始套用「對等對調」的方式生成另一個合法狀態
// 對調一對等價的角塊位置（兩個 UFR ↔ UFL 之間的 U 貼紙）— 結果仍是合法 cube state（只是 cubie 重排）
{
    // 找一個保證合法的「對稱對調」：U[0] ↔ U[3]、L[0] ↔ R[3]、B[3] ↔ B[0]
    // 這代表把 UBL 角塊 和 UBR 角塊「交換」，並同時把它們的所有 3 面 sticker 對換
    let state = SOLVED_STATE;
    // swap UBL <-> UBR corner 的三組對應 sticker
    const swaps = [[0, 3], [64, 19], [83, 80]];
    for (const [a, b] of swaps) state = applySwap(state, a, b);
    const r = validateState4Strict(state);
    // 兩個 corner 對調（沒有同時對調 edge）→ 產生 corner parity 問題 → 嚴格 multiset 仍應通過
    // 因為 sorted triples 不變（兩 corner 都是 ULB 與 URB，sort 後相同）
    check(r.ok, 'corner 對調後仍通過嚴格驗證（cubie multiset 不變）', r.errors.slice(0, 2).join('|'));
}

// ============================================================
console.log('\n=== T5: 常見錯誤情境 ===');
// (a) 邊 sticker 移到 center 位置（典型「使用者單點誤判」場景）— 應被 piece 抓到
{
    // 把 F[1] (U-F edge sticker, F-color) 對調到 R[5] (center, R-color):
    // - F[1]=F→R: edge cubie [13,33] 從 (U,F) 變 (U,R) → edge multiset 多一個 UR、少一個 UF
    // - R[5]=R→F: 中心格不影響 edge/corner multiset，但 face count 仍保持平衡 (F count 1↓+1↑, R count 1↓+1↑)
    let bad = applySwap(SOLVED_STATE, 33, 21); // F[1] ↔ R[5]
    const r = validateState4Strict(bad);
    check(!r.ok && r.severity === 'piece',
        '邊 sticker ↔ 中心格 對調被 piece multiset 抓到',
        'errors=' + r.errors.slice(0, 2).join(';'));
}
// (a-2) 兩個 edge sticker 的純對調（parity violation） — 已知 multiset 仍合法但 cube 不可達
{
    // F[1] ↔ R[2]：兩個都是 edge sticker，互換後 edge cubie multiset 不變（仍 2 UF + 2 UR）
    // 但這是 odd permutation → cube 不可達。strict validator 不檢測 parity，只檢測 multiset。
    let bad = applySwap(SOLVED_STATE, 33, 18);
    const r = validateState4Strict(bad);
    // 我們的策略是：multiset 通過、但實際 solver 會發現不可解。
    // 這層 parity 在 handoff gate 後由 solver 嘗試解 + 失敗才回到使用者
    check(r.ok, '純 edge swap 不被 strict validator 抓到（parity 由 solver 處理）');
}
// (b) 數量平衡但 piece 不合法 — 確保 count 通過 piece 才開始檢
{
    // 對換兩個非同色的 sticker：U[0] (U-color, corner UBL) ↔ R[0] (R-color, corner UFR)
    let bad = applySwap(SOLVED_STATE, 0, 16);
    // 結果：count 不變（U 仍 16、R 仍 16），但 UBL=(R,L,B) 不合法、UFR=(U,U,F) 不合法
    const r = validateState4Strict(bad);
    check(r.severity === 'piece', 'count 通過但 piece 不合法 → severity=piece');
}

// ============================================================
console.log('\n=== T6: handoff gate ===');
// HTML 在 _finishScanAndSolve 之前必須：
//   1. validateState4Strict 必須通過（否則 throw）
//   2. confidence 最低值 ≥ MIN_HANDOFF_CONFIDENCE（否則拒絕並提示）
const MIN_HANDOFF_CONFIDENCE = 1.5; // 與 HTML 將要實作的一致

function handoffGate(state, perStickerConfidence) {
    const v = validateState4Strict(state);
    if (!v.ok) return { ok: false, reason: 'INVALID_STATE', errors: v.errors, severity: v.severity };
    if (Array.isArray(perStickerConfidence)) {
        const worst = Math.min(...perStickerConfidence);
        if (worst < MIN_HANDOFF_CONFIDENCE) {
            return { ok: false, reason: 'LOW_CONFIDENCE', worst, threshold: MIN_HANDOFF_CONFIDENCE };
        }
    }
    return { ok: true };
}

// (a) SOLVED + 高信心 → 通過
{
    const conf = new Array(96).fill(99);
    const g = handoffGate(SOLVED_STATE, conf);
    check(g.ok, 'SOLVED + 高信心 → 通過');
}
// (b) SOLVED + 一格低信心 → 拒絕
{
    const conf = new Array(96).fill(99);
    conf[42] = 1.1;
    const g = handoffGate(SOLVED_STATE, conf);
    check(!g.ok && g.reason === 'LOW_CONFIDENCE', '一格低信心 → 拒絕 LOW_CONFIDENCE');
}
// (c) 不合法狀態 + 高信心 → 仍拒絕（state 優先）
{
    const conf = new Array(96).fill(99);
    let bad = applySwap(SOLVED_STATE, 0, 16);
    const g = handoffGate(bad, conf);
    check(!g.ok && g.reason === 'INVALID_STATE', '不合法狀態優先被擋下 INVALID_STATE');
}
// (d) 沒提供 confidence array → 只看 state（向後相容）
{
    const g = handoffGate(SOLVED_STATE);
    check(g.ok, '未提供 confidence → 只看 state，SOLVED 通過');
}

// ============================================================
console.log('\n=== T7: 面編輯 undo 行為（純邏輯版） ===');
// 模擬 _faceEditUndoStack：每次點擊 push 前一狀態；undo pop 後還原。
function simulateUndo() {
    let faceEditState = ['U','U','U','U','U','U','U','U','U','U','U','U','U','U','U','U'];
    let faceEditUserEdits = new Array(16).fill(false);
    const undoStack = [];

    function click(idx, newColor) {
        undoStack.push({
            idx, prevColor: faceEditState[idx],
            prevUserEdit: faceEditUserEdits[idx],
        });
        if (undoStack.length > 30) undoStack.shift();
        faceEditState[idx] = newColor;
        faceEditUserEdits[idx] = true;
    }
    function undo() {
        if (undoStack.length === 0) return false;
        const last = undoStack.pop();
        faceEditState[last.idx] = last.prevColor;
        faceEditUserEdits[last.idx] = last.prevUserEdit;
        return true;
    }

    return { click, undo, getState: () => faceEditState.join(''), getEdits: () => [...faceEditUserEdits] };
}
{
    const sim = simulateUndo();
    sim.click(0, 'R');
    sim.click(1, 'F');
    sim.click(2, 'D');
    check(sim.getState() === 'RFDUUUUUUUUUUUUU', 'three clicks 套用成功');
    check(sim.getEdits().slice(0,3).every(x => x === true), 'userEdits 標記三格');
    sim.undo();
    check(sim.getState() === 'RFUUUUUUUUUUUUUU', 'undo 還原第三次');
    check(sim.getEdits()[2] === false, '第三格的 userEdit 也被還原');
    sim.undo();
    sim.undo();
    check(sim.getState() === 'UUUUUUUUUUUUUUUU', 'undo 三次回到初始');
    check(sim.undo() === false, '空 stack 的 undo 回傳 false 不爆');
}
{
    // 同格連續編輯，undo 應依序回退
    const sim = simulateUndo();
    sim.click(5, 'R');
    sim.click(5, 'F');
    sim.click(5, 'D');
    check(sim.getState()[5] === 'D', '同格三次編輯，最後是 D');
    sim.undo();
    check(sim.getState()[5] === 'F', 'undo 1 → F');
    sim.undo();
    check(sim.getState()[5] === 'R', 'undo 2 → R');
    sim.undo();
    check(sim.getState()[5] === 'U', 'undo 3 → 原始 U');
}
{
    // 超過 30 步應自動丟掉最早的
    const sim = simulateUndo();
    for (let i = 0; i < 40; i++) sim.click(0, i % 2 === 0 ? 'R' : 'F');
    // 此時 state[0] 為最後一次 click 的顏色（i=39 → 'F'）
    check(sim.getState()[0] === 'F', '40 次點擊後最後狀態正確');
    // undo 30 次回到第 10 次點擊後的狀態（i=9 → 'F' 因為 9 是奇數 → 'F'）
    // 實際：被保留的是後 30 次，即 i=10..39。undo 30 次後回到 i=10 點擊前 = i=9 的結果。
    // i=9 是 'F'。所以 undo 30 後應是 F。
    for (let i = 0; i < 30; i++) sim.undo();
    check(sim.getState()[0] === 'F', 'undo 30 次後是 i=9 的結果 F');
    // 再 undo 應失敗（stack 空）
    check(sim.undo() === false, 'stack 已耗盡，undo 回 false');
}

// Expose helpers (set BEFORE summary so a child runner that imports us still gets them)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        validateState4Strict,
        classifyRgbWithConfidence,
        tryAutoBalance4,
        handoffGate,
        rgbToLab,
        labDist,
        CANONICAL_RGB,
        CANONICAL_LAB,
        CORNERS_4,
        EDGE_CUBIES_4,
        STATE_FACE_ORDER,
        STICKERS_PER_FACE,
        SOLVED_STATE,
        TOTAL_STICKERS,
        MIN_HANDOFF_CONFIDENCE,
    };
}

// 若被當作 main script 執行，輸出 summary 並設定 exit code
const isMain = (require.main === module);
console.log('\n────────────────────────────');
console.log(`  ${pass} passed, ${fail} failed (total ${pass + fail})`);
if (fail > 0) {
    console.log('\n失敗清單：');
    failures.forEach(f => console.log('  •', f));
    if (isMain) process.exit(1);
}
console.log('  ✓ 全部通過');
if (isMain) process.exit(0);
