// HTML 內 StateValidator4 vs test_logic_4x4.js 契約一致性測試
// 跑法：node test_html_4x4.js
//
// 從 cube4x4.html 抓出 CORNERS_4 + EDGE_CUBIES_4 + FACE_OPPOSITES + StateValidator4
// 在 Node 環境中執行，逐一比對與 test_logic_4x4.js 的純邏輯版本回應是否一致。

'use strict';

const fs = require('fs');
const path = require('path');

const STATE_FACE_ORDER = ['U', 'R', 'F', 'D', 'L', 'B'];
const STICKERS_PER_FACE = 16;
const TOTAL_STICKERS_4 = 96;

const html = fs.readFileSync(path.join(__dirname, 'cube4x4.html'), 'utf8');

function extractBlock(src, marker, endMarker) {
    const start = src.indexOf(marker);
    if (start < 0) throw new Error('Marker not found: ' + marker);
    const end = src.indexOf(endMarker, start);
    if (end < 0) throw new Error('End marker not found: ' + endMarker);
    return src.slice(start, end);
}

// 抓 CORNERS_4 / EDGE_CUBIES_4 / FACE_OPPOSITES + StateValidator4
const cornersBlock = extractBlock(html, '// 4×4 八個角塊', 'class StateValidator4');
const validatorBlock = extractBlock(html, 'class StateValidator4 {', '\n        class HSVClassifier');

// 在 vm context 中跑，把 class 抓出來
const vm = require('vm');
const context = {
    STATE_FACE_ORDER,
    STICKERS_PER_FACE,
    TOTAL_STICKERS_4,
    console,
};
vm.createContext(context);
vm.runInContext(cornersBlock + '\n' + validatorBlock + '\nthis.StateValidator4 = StateValidator4;', context);
const StateValidator4 = context.StateValidator4;

const ref = require('./test_logic_4x4.js');

let pass = 0, fail = 0;
const failures = [];

function check(cond, name, extra) {
    if (cond) { pass++; }
    else {
        fail++;
        failures.push({ name, extra });
        console.log('  ✗', name, extra ? '\n      ' + extra : '');
    }
}

function compare(state, label) {
    const a = StateValidator4.validate(state);
    const b = ref.validateState4Strict(state);
    check(a.ok === b.ok, `[${label}] ok 一致`, `HTML=${a.ok} ref=${b.ok}`);
    if (!a.ok || !b.ok) {
        // severity 應該也對齊（HTML 與 ref 的 severity 邏輯一致）
        check(a.severity === b.severity, `[${label}] severity 一致`,
            `HTML=${a.severity} ref=${b.severity}`);
    }
}

console.log('=== HTML × ref 契約一致性 ===');

// (1) SOLVED
compare(ref.SOLVED_STATE, 'SOLVED');

// (2) 不同種類錯誤
compare('U'.repeat(95), 'TOO_SHORT');
compare('X'.repeat(96), 'BAD_CHAR');
compare('U'.repeat(17) + 'R'.repeat(16) + 'F'.repeat(16) + 'D'.repeat(16) + 'L'.repeat(16) + 'B'.repeat(15), 'COUNT_MISMATCH');

// (3) corner swap
{
    const arr = ref.SOLVED_STATE.split('');
    [arr[0], arr[19]] = [arr[19], arr[0]];
    compare(arr.join(''), 'CORNER_SWAP_UR');
}

// (4) edge ↔ center swap
{
    const arr = ref.SOLVED_STATE.split('');
    [arr[33], arr[21]] = [arr[21], arr[33]];
    compare(arr.join(''), 'EDGE_CENTER_SWAP');
}

// (5) 純 edge↔edge swap (parity violation — strict 不抓)
{
    const arr = ref.SOLVED_STATE.split('');
    [arr[33], arr[18]] = [arr[18], arr[33]];
    compare(arr.join(''), 'EDGE_PARITY_SWAP');
}

// (6) 隨機十次「對等對換」（保證 count 對） — 大多應 piece 失敗
for (let trial = 0; trial < 10; trial++) {
    const arr = ref.SOLVED_STATE.split('');
    const i = Math.floor(Math.random() * 96);
    let j = Math.floor(Math.random() * 96);
    if (i === j) j = (j + 1) % 96;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    compare(arr.join(''), `RANDOM_SWAP_${i}_${j}`);
}

// (7) 反覆套用 multiple swaps，產生「count 對但 piece 多重錯」的 state
for (let trial = 0; trial < 5; trial++) {
    const arr = ref.SOLVED_STATE.split('');
    for (let k = 0; k < 4; k++) {
        const i = Math.floor(Math.random() * 96);
        let j = Math.floor(Math.random() * 96);
        if (i === j) j = (j + 1) % 96;
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    compare(arr.join(''), `RANDOM_4SWAPS_${trial}`);
}

// ─── HTML _verifyReducedState / _isValidState3 contract ───────────────────
// 用 brace-counting 抽出單一函式的整個 body（避免 regex 中的 { } 干擾）
function extractMethodBody(src, methodName) {
    const re = new RegExp(`(static\\s+)?${methodName}\\s*\\([^)]*\\)\\s*\\{`);
    const m = re.exec(src);
    if (!m) throw new Error('method not found: ' + methodName);
    let i = m.index + m[0].length; // 此時 i 指向 method body 的第一個 char（{ 之後）
    let depth = 1;
    let inString = null;
    let inRegex = false;
    let inLineComment = false;
    let inBlockComment = false;
    let prev = '';
    while (i < src.length && depth > 0) {
        const c = src[i];
        const next = src[i + 1];
        if (inLineComment) {
            if (c === '\n') inLineComment = false;
        } else if (inBlockComment) {
            if (c === '*' && next === '/') { inBlockComment = false; i++; }
        } else if (inString) {
            if (c === '\\') { i += 2; prev = ''; continue; }
            if (c === inString) inString = null;
        } else if (inRegex) {
            if (c === '\\') { i += 2; prev = ''; continue; }
            if (c === '/') inRegex = false;
        } else {
            if (c === '/' && next === '/') { inLineComment = true; i += 2; continue; }
            if (c === '/' && next === '*') { inBlockComment = true; i += 2; continue; }
            if (c === '"' || c === "'" || c === '`') inString = c;
            else if (c === '/' && /[=(,;:?{}!&|+\-]/.test(prev)) inRegex = true;
            else if (c === '{') depth++;
            else if (c === '}') depth--;
        }
        if (!/\s/.test(c)) prev = c;
        i++;
    }
    // body 為 m.index + m[0].length .. i-1（不含最外層的 }）
    const bodyStart = m.index + m[0].length;
    return src.slice(bodyStart, i - 1);
}

const verifyBody = extractMethodBody(html, '_verifyReducedState');
const isValidState3Body = extractMethodBody(html, '_isValidState3');

const ctx2 = { STATE_FACE_ORDER, STICKERS_PER_FACE, console };
vm.createContext(ctx2);
vm.runInContext(`
function _verifyReducedState(state) { ${verifyBody} }
function _isValidState3(state3) { ${isValidState3Body} }
this._verifyReducedState = _verifyReducedState;
this._isValidState3 = _isValidState3;
`, ctx2);

console.log('\n=== HTML _verifyReducedState contract ===');
{
    // SOLVED 應通過
    const r = ctx2._verifyReducedState(ref.SOLVED_STATE);
    check(r.ok === true, 'SOLVED 通過 _verifyReducedState');
}
{
    // 隨機破壞中心
    const arr = ref.SOLVED_STATE.split('');
    arr[5] = 'R'; // U 面 idx 5 = U-color, 改為 R
    const r = ctx2._verifyReducedState(arr.join(''));
    check(r.ok === false, '中心格錯誤應被擋下');
    check(typeof r.reason === 'string' && r.reason.includes('中心'),
        '錯誤原因應包含「中心」', `reason=${r.reason}`);
}
{
    // 邊塊未配對：U[1] (U-color, paired with B[2] = B-color) 改為 F
    const arr = ref.SOLVED_STATE.split('');
    arr[1] = 'F';
    const r = ctx2._verifyReducedState(arr.join(''));
    check(r.ok === false, '邊塊未配對應被擋下');
    check(typeof r.reason === 'string' && r.reason.includes('邊塊'),
        '錯誤原因應包含「邊塊」', `reason=${r.reason}`);
}

console.log('\n=== HTML _assessCaptureQuality contract ===');
{
    const qualityBody = extractMethodBody(html, '_assessCaptureQuality');
    const ctx3 = { console };
    vm.createContext(ctx3);
    vm.runInContext(`
        function _assessCaptureQuality(stickers) { ${qualityBody} }
        this._assessCaptureQuality = _assessCaptureQuality;
    `, ctx3);
    const normal = Array.from({ length: 16 }, () => ({ r: 120, g: 120, b: 120 }));
    const overexp = Array.from({ length: 16 }, () => ({ r: 250, g: 250, b: 250 }));
    const dark = Array.from({ length: 16 }, () => ({ r: 30, g: 30, b: 30 }));
    check(ctx3._assessCaptureQuality(normal).saturated === 0, 'HTML normal → 0 saturated');
    check(ctx3._assessCaptureQuality(overexp).saturated === 16, 'HTML overexposed → 16 saturated');
    check(ctx3._assessCaptureQuality(dark).shadow === 16, 'HTML dark → 16 shadow');
}

console.log('\n=== HTML _isValidState3 contract ===');
{
    // SOLVED 3×3 應通過
    const solved3 = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
    check(ctx2._isValidState3(solved3) === true, 'SOLVED 3×3 應合法');
}
{
    // 長度錯誤
    check(ctx2._isValidState3('U'.repeat(53)) === false, '53 字元 3×3 應不合法');
}
{
    // 中心非 6 種 color
    const bad = 'UUUUUUUUUUUUUUUUUUFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
    // bad[13] = 'U' (R 面中心) 與 bad[4] 重複 → centers Set 不是 6
    check(ctx2._isValidState3(bad) === false, '中心格重複應不合法');
}

console.log('────────────────────────────');
console.log(`  ${pass} passed, ${fail} failed (total ${pass + fail})`);
if (fail > 0) {
    console.log('\n失敗：');
    failures.forEach(f => console.log('  •', f.name, '|', f.extra));
    process.exit(1);
} else {
    console.log('  ✓ 契約一致');
    process.exit(0);
}
