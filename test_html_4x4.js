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
