// 4×4 面內旋轉自動修正（_tryFaceRotationFix）契約測試
// 跑法：node test_orient_4x4.cjs
//
// 從 cube4x4.html 抽出以下純邏輯，在 Node vm 中執行，驗證：
//   - _faceRotationMaps(N) 旋轉表正確（精確值、為排列、4×=身份、中心保持）
//   - _tryFaceRotationFix() 能把「某些面被旋轉錯位」的狀態還原成通過 StateValidator4 的合法狀態
//
// 為了產生真實（非全同色）的合法 4×4 scramble，連同 buildPerms4 + FACE_COORDS 一起抽出，
// 重建 PERMS_4 後套用 move list（與 HTML 的 RubiksGame._applyMoveList 同邏輯）。

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const STATE_FACE_ORDER = ['U', 'R', 'F', 'D', 'L', 'B'];
const STICKERS_PER_FACE = 16;

const html = fs.readFileSync(path.join(__dirname, 'cube4x4.html'), 'utf8');

// ── HTML 抽取小工具（與 test_html_4x4.cjs 同邏輯，各自保留一份；test_html_4x4.cjs 於 top-level
//    呼叫 process.exit，沒有 require.main 守衛，require 它會直接終止本程序，故不共用）──
function extractBlock(src, marker, endMarker) {
    const start = src.indexOf(marker);
    if (start < 0) throw new Error('Marker not found: ' + marker);
    const end = src.indexOf(endMarker, start);
    if (end < 0) throw new Error('End marker not found: ' + endMarker);
    return src.slice(start, end);
}

function extractMethodBody(src, methodName) {
    const re = new RegExp(`(static\\s+)?${methodName}\\s*\\([^)]*\\)\\s*\\{`);
    const m = re.exec(src);
    if (!m) throw new Error('method not found: ' + methodName);
    let i = m.index + m[0].length;
    let depth = 1, inString = null, inRegex = false, inLineComment = false, inBlockComment = false, prev = '';
    while (i < src.length && depth > 0) {
        const c = src[i], next = src[i + 1];
        if (inLineComment) { if (c === '\n') inLineComment = false; }
        else if (inBlockComment) { if (c === '*' && next === '/') { inBlockComment = false; i++; } }
        else if (inString) { if (c === '\\') { i += 2; prev = ''; continue; } if (c === inString) inString = null; }
        else if (inRegex) { if (c === '\\') { i += 2; prev = ''; continue; } if (c === '/') inRegex = false; }
        else {
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
    return src.slice(m.index + m[0].length, i - 1);
}

const cornersBlock   = extractBlock(html, '// 4×4 八個角塊', 'class StateValidator4');
const validatorBlock = extractBlock(html, 'class StateValidator4 {', '\n        class HSVClassifier');
const faceCoordsBlock = extractBlock(html, 'const FACE_COORDS = {', 'const TWO_SHOT_SCANS');
const buildPermsBody  = extractMethodBody(html, 'buildPerms4');
const faceRotMapsBody = extractMethodBody(html, '_faceRotationMaps');
const faceRotFixBody  = extractMethodBody(html, '_tryFaceRotationFix');

const context = {
    STATE_FACE_ORDER, STICKERS_PER_FACE,
    Math, Array, Object, Number, JSON, Set, Infinity, console,
};
vm.createContext(context);
vm.runInContext(`
    ${cornersBlock}
    ${faceCoordsBlock}
    ${validatorBlock}
    function buildPerms4() { ${buildPermsBody} }
    const PERMS_4 = buildPerms4();
    function _applyMoveList(state, moves) {
        let s = state;
        for (const n of moves) {
            const perm = PERMS_4[n];
            if (!perm) continue;
            const arr = s.split('');
            const res = new Array(96);
            for (let i = 0; i < 96; i++) res[perm[i]] = arr[i];
            s = res.join('');
        }
        return s;
    }
    const RubiksGame = {};
    RubiksGame._faceRotationMaps = function(N) { ${faceRotMapsBody} };
    function tryFaceRotationFix() { ${faceRotFixBody} }

    this.StateValidator4 = StateValidator4;
    this.PERMS_4 = PERMS_4;
    this._applyMoveList = _applyMoveList;
    this.faceRotationMaps = RubiksGame._faceRotationMaps;
    // 綁定一個包裝：以提供的 mock this 執行 _tryFaceRotationFix（其內部讀 RubiksGame/StateValidator4/常數皆在本 context）
    this.runFix = function(mockThis) { return tryFaceRotationFix.call(mockThis); };
`, context);

const { StateValidator4, _applyMoveList, faceRotationMaps, runFix } = context;
// solved 4×4：每面 16 個同字母。HTML×ref 驗證器一致性已由 test_html_4x4.cjs 覆蓋，
// 此處不 require test_logic_4x4.cjs（避免其測試輸出與本檔交錯）。
const SOLVED = STATE_FACE_ORDER.map(f => f.repeat(STICKERS_PER_FACE)).join('');

let pass = 0, fail = 0;
const failures = [];
function check(cond, name, extra) {
    if (cond) pass++;
    else { fail++; failures.push({ name, extra }); console.log('  ✗', name, extra ? '| ' + extra : ''); }
}

const toFaces = s => {
    const o = {};
    STATE_FACE_ORDER.forEach((f, i) => { o[f] = s.slice(i * 16, i * 16 + 16).split(''); });
    return o;
};
const fixFromFaces = faces => runFix({ N: 4, scanConfirmedFaces: faces });

console.log('=== T-orient-1: PERMS_4 / scramble sanity ===');
const SCRAMBLE = ['R', 'U2', "F'", 'Rw', 'L', "D'", 'B2', 'Uw'];
check(typeof context.PERMS_4.R !== 'undefined' && typeof context.PERMS_4.Rw !== 'undefined',
    'PERMS_4 應含基本面與寬移動 key');
const scr = _applyMoveList(SOLVED, SCRAMBLE);
check(scr !== SOLVED, 'scramble 應改變狀態');
check(StateValidator4.validate(scr).ok, '基準 scramble 應通過 StateValidator4',
    StateValidator4.validate(scr).errors && StateValidator4.validate(scr).errors.join(','));

console.log('\n=== T-orient-2: _faceRotationMaps(4) 正確性 ===');
const [id4, r90, r180, r270] = faceRotationMaps(4);
const idStr = Array.from({ length: 16 }, (_, i) => i).join(',');
check(r90.join(',') === [12, 8, 4, 0, 13, 9, 5, 1, 14, 10, 6, 2, 15, 11, 7, 3].join(','),
    'r90 精確值正確（90°CW，非鏡射/轉置）', r90.join(','));
[id4, r90, r180, r270].forEach((m, k) => {
    check(m.length === 16 && [...m].sort((a, b) => a - b).join(',') === idStr, `map[${k}] 為 0..15 排列`);
});
const apply = (m, arr) => m.map(i => arr[i]);
let acc = id4.slice();
for (let k = 0; k < 4; k++) acc = apply(r90, acc);
check(acc.join(',') === id4.join(','), 'r90 連套 4 次 = 身份');
check(apply(r90, apply(r90, id4)).join(',') === r180.join(','), 'r90² = r180');
const C = new Set([5, 6, 9, 10]);
check([r90, r180, r270].every(m => [5, 6, 9, 10].every(ci => C.has(m[ci]))), '中心 2×2 旋轉後仍在中心集合');
// 3×3 版本中心固定
check(faceRotationMaps(3).every(m => m.length === 9 && m[4] === 4), '3×3 旋轉表中心固定於 4');

console.log('\n=== T-orient-3: 單面旋轉錯位 → 還原合法 ===');
for (let fi = 0; fi < 6; fi++) {
    for (let r = 1; r < 4; r++) {
        const f = STATE_FACE_ORDER[fi];
        const maps = faceRotationMaps(4);
        const faces = toFaces(scr);
        faces[f] = maps[r].map(i => faces[f][i]); // 故意旋轉 f 面
        const fixed = fixFromFaces(faces);
        check(fixed !== null, `${f} 面旋轉 ${r * 90}° 應找回解`);
        check(fixed !== null && StateValidator4.validate(fixed).ok,
            `${f} 面旋轉 ${r * 90}° 修正後通過 StateValidator4`);
    }
}

console.log('\n=== T-orient-4: 兩面旋轉錯位 → 還原合法 ===');
const scr2 = _applyMoveList(SOLVED, ['F', 'R', "U'", 'Rw2', 'Dw', "B'", 'L2']);
const cases = [['U', 1, 'R', 2], ['F', 3, 'D', 1], ['L', 2, 'B', 3], ['U', 2, 'F', 1]];
for (const [fa, ra, fb, rb] of cases) {
    const maps = faceRotationMaps(4);
    const faces = toFaces(scr2);
    faces[fa] = maps[ra].map(i => faces[fa][i]);
    faces[fb] = maps[rb].map(i => faces[fb][i]);
    const fixed = fixFromFaces(faces);
    check(fixed !== null && StateValidator4.validate(fixed).ok,
        `兩面旋轉(${fa}${ra * 90}°,${fb}${rb * 90}°) 修正後通過 StateValidator4`);
}

console.log('\n=== T-orient-5: 已合法時為 no-op（cost 0） ===');
{
    const fixed = fixFromFaces(toFaces(scr));
    check(fixed === scr, '已合法輸入應原樣回傳（零旋轉）', fixed === scr ? '' : 'changed');
}

console.log('────────────────────────────');
console.log(`  ${pass} passed, ${fail} failed (total ${pass + fail})`);
if (fail > 0) {
    console.log('\n失敗：');
    failures.forEach(f => console.log('  •', f.name, '|', f.extra || ''));
    process.exit(1);
} else {
    console.log('  ✓ 面內旋轉修正契約通過');
    process.exit(0);
}
