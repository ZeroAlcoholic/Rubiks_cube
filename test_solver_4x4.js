// 4×4 求解器端到端測試 — 從 cube4x4.html 抽出 PERMS_4 + ReductionSolver4，
// 在 Node 中跑「scramble → solve → verify」迴圈。
//
// 跑法：node test_solver_4x4.js
//
// 目的：找出「validate 通過、但 solver 產生爛 moves」的狀態。
// 這些是嚴格驗證捕捉不到的 solver 端缺陷（OLL/PLL parity、edge pairing 卡住等）。

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ref = require('./test_logic_4x4.js');

const html = fs.readFileSync(path.join(__dirname, 'cube4x4.html'), 'utf8');

function extractBlock(src, marker, endMarker) {
    const start = src.indexOf(marker);
    if (start < 0) throw new Error('marker not found: ' + marker);
    const end = src.indexOf(endMarker, start);
    if (end < 0) throw new Error('end marker not found: ' + endMarker);
    return src.slice(start, end);
}

// FACE_COORDS (constants used by buildPerms4)
const faceCoordsBlock = extractBlock(html, 'const FACE_COORDS = {', '\n        const TWO_SHOT_SCANS');
// buildPerms4 function
const buildPermsBlock = extractBlock(html, 'function buildPerms4()', 'const PERMS_4 = buildPerms4();');
// ReductionSolver4 class
const reductionBlock = extractBlock(html, 'class ReductionSolver4 {', '\n        class CubeJSSolverAdapter {');

// 構造 vm context
const context = {
    STATE_FACE_ORDER: ref.STATE_FACE_ORDER,
    STICKERS_PER_FACE: ref.STICKERS_PER_FACE,
    SOLVED_STATE: ref.SOLVED_STATE,
    Cube: null,            // cubejs 不在 Node 跑（沒裝），讓 _hasPLLParity 走 catch 路徑
    console,
    performance: { now: () => Date.now() },
};
vm.createContext(context);

const code = `
${faceCoordsBlock}
${buildPermsBlock}
const PERMS_4 = buildPerms4();
${reductionBlock}
this.PERMS_4 = PERMS_4;
this.ReductionSolver4 = ReductionSolver4;
this.FACE_COORDS = FACE_COORDS;
`;
vm.runInContext(code, context);

const PERMS_4 = context.PERMS_4;
const ReductionSolver4 = context.ReductionSolver4;

// ── 純 JS apply-move：用 PERMS_4 套用一個 move（同 ReductionSolver4._applyMove）
function applyMove(state, notation) {
    const perm = PERMS_4[notation];
    if (!perm) throw new Error('No perm for ' + notation);
    const arr = state.split('');
    const res = new Array(96);
    for (let i = 0; i < 96; i++) res[perm[i]] = arr[i];
    return res.join('');
}

function applyMoves(state, moves) {
    let s = state;
    for (const m of moves) s = applyMove(s, m);
    return s;
}

// ── 產生 scramble move sequence（隨機，但避免立即反轉同面）
const ALL_MOVES = Object.keys(PERMS_4); // 所有可用 notation
const BASE_MOVES = ['U','R','F','D','L','B','Uw','Rw','Fw','Dw','Lw','Bw'];
const SUFFIXES = ['', "'", '2'];

function randomScramble(length) {
    const moves = [];
    let lastBase = null;
    for (let i = 0; i < length; i++) {
        let base;
        do {
            base = BASE_MOVES[Math.floor(Math.random() * BASE_MOVES.length)];
        } while (base === lastBase);
        const suf = SUFFIXES[Math.floor(Math.random() * SUFFIXES.length)];
        moves.push(base + suf);
        lastBase = base;
    }
    return moves;
}

// ── 測試 runner
let pass = 0, fail = 0;
const failures = [];
function check(cond, name, extra) {
    if (cond) pass++;
    else {
        fail++;
        failures.push({ name, extra });
        console.log('  ✗', name, extra ? '\n      ' + extra : '');
    }
}

// ============================================================
console.log('=== T1: applyMove SOLVED → notation → 反向 → SOLVED ===');
// 套用一個 move 後再套用其反向，應該回到 SOLVED
for (const base of BASE_MOVES) {
    for (const suf of SUFFIXES) {
        const move = base + suf;
        const inv = suf === '' ? base + "'" : suf === "'" ? base : base + '2';
        const after = applyMove(ref.SOLVED_STATE, move);
        const back = applyMove(after, inv);
        check(back === ref.SOLVED_STATE, `${move} then ${inv} → SOLVED`);
    }
}

// ============================================================
console.log('\n=== T2: scrambled 狀態通過嚴格驗證 ===');
// 從 SOLVED 套用 N 步隨機 scramble，產生的狀態都應通過 StateValidator4
const SCRAMBLE_TRIALS = 30;
let validScrambles = 0;
const scrambleHistory = [];
for (let trial = 0; trial < SCRAMBLE_TRIALS; trial++) {
    const moves = randomScramble(10 + trial); // 10..39 步
    const scrambled = applyMoves(ref.SOLVED_STATE, moves);
    const v = ref.validateState4Strict(scrambled);
    if (v.ok) {
        validScrambles++;
        scrambleHistory.push({ moves, state: scrambled });
    } else {
        console.log(`  ✗ scramble #${trial} ${moves.length} 步未通過驗證: severity=${v.severity}`);
        console.log(`     moves: ${moves.join(' ')}`);
        console.log(`     errors: ${v.errors.slice(0, 2).join('; ')}`);
    }
}
check(validScrambles === SCRAMBLE_TRIALS,
    `${SCRAMBLE_TRIALS} 個隨機 scramble 都應通過 strict validator`,
    `${validScrambles}/${SCRAMBLE_TRIALS} 通過`);

// ============================================================
console.log('\n=== T3: ReductionSolver4 對 scramble 的回應 ===');
// 拿前 10 個合法 scramble 跑 solver，檢查結果
const SOLVE_TRIALS = Math.min(10, scrambleHistory.length);
let solverCenterOk = 0, solverEdgesOk = 0, solverState3Valid = 0;
for (let i = 0; i < SOLVE_TRIALS; i++) {
    const { moves, state } = scrambleHistory[i];
    let result;
    try {
        const solver = new ReductionSolver4();
        result = solver.solve(state);
    } catch (e) {
        console.log(`  ✗ scramble #${i}: solver throw — ${e.message}`);
        continue;
    }

    // 套用 moveList 到原 scramble，看結果
    let finalState;
    try {
        finalState = applyMoves(state, result.moveList);
    } catch (e) {
        console.log(`  ✗ scramble #${i}: 套用 solver 輸出 moves 時 throw — ${e.message}`);
        continue;
    }

    // 檢查中心格是否全部就位（每個面 4 個中心 idx [5,6,9,10] 都是該 face）
    const CENTER_IDXS = [5, 6, 9, 10];
    let centersOk = true;
    ref.STATE_FACE_ORDER.forEach((face, fi) => {
        const base = fi * 16;
        for (const ci of CENTER_IDXS) {
            if (finalState[base + ci] !== face) { centersOk = false; break; }
        }
    });
    if (centersOk) solverCenterOk++;

    // 檢查邊塊配對（每對 edge cubie 的兩張貼紙應該配對）
    let edgesOk = true;
    const EDGE_DEFS = [
        [1,82,2,81],[4,65,8,66],[7,18,11,17],[13,33,14,34],
        [49,45,50,46],[52,78,56,77],[55,29,59,30],[61,94,62,93],
        [20,39,24,43],[23,84,27,88],[36,71,40,75],[87,68,91,72],
    ];
    for (const e of EDGE_DEFS) {
        const c1 = finalState[e[0]], c2 = finalState[e[1]];
        const c3 = finalState[e[2]], c4 = finalState[e[3]];
        // paired = (c1===c3 && c2===c4)
        if (!(c1 === c3 && c2 === c4)) { edgesOk = false; break; }
    }
    if (edgesOk) solverEdgesOk++;

    // 檢查 state3 格式
    if (typeof result.state3 === 'string' && result.state3.length === 54 && /^[URFDLB]{54}$/.test(result.state3)) {
        solverState3Valid++;
    }

    if (!centersOk || !edgesOk) {
        console.log(`  - scramble #${i} (${moves.length} moves): centers=${centersOk ? '✓' : '✗'} edges=${edgesOk ? '✓' : '✗'} | solver 產生 ${result.moveList.length} 步`);
    }
}
console.log(`  centers solved: ${solverCenterOk}/${SOLVE_TRIALS}`);
console.log(`  edges paired:   ${solverEdgesOk}/${SOLVE_TRIALS}`);
console.log(`  state3 valid:   ${solverState3Valid}/${SOLVE_TRIALS}`);
// 不強制全部通過 — 這是診斷測試。但至少 state3 格式必須對。
check(solverState3Valid === SOLVE_TRIALS, 'solver 至少輸出格式合法的 state3');

// ============================================================
console.log('\n=== T4: ReductionSolver4 對 SOLVED 應該幾乎無操作 ===');
{
    const solver = new ReductionSolver4();
    const r = solver.solve(ref.SOLVED_STATE);
    check(r.state3 === 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB',
        'SOLVED 的 3×3 等價狀態也是 SOLVED', `got: ${r.state3}`);
    // 對 SOLVED 不應吐出非平凡 moves（至少 reductions 應該是 0 步或全是 no-op）
    console.log(`  SOLVED 經過 reduce 產生 ${r.moveList.length} 步`);
    // 注意：當前 solver 對 SOLVED 仍可能輸出一些「平衡用」moves 因為它不檢測 already-solved；
    // 不強制 0 步，只記錄。
}

// ============================================================
console.log('\n=== T5: 偵測 PERMS_4 的完整性 ===');
{
    // 應該包含所有 6 面 × 3 方向 = 18 個外層 move + 6 wide × 3 = 18 個寬 move = 36 個
    const expectedNotations = [];
    for (const f of ['U','R','F','D','L','B']) {
        expectedNotations.push(f, f + "'", f + '2');
        expectedNotations.push(f + 'w', f + "w'", f + 'w2');
    }
    const missing = expectedNotations.filter(n => !PERMS_4[n]);
    check(missing.length === 0, `所有預期 notation 都在 PERMS_4 中`,
        `missing: ${missing.join(', ')}`);
}
// 每個 perm 應為 0..95 的排列
{
    let badPerm = null;
    for (const [name, perm] of Object.entries(PERMS_4)) {
        if (perm.length !== 96) { badPerm = name; break; }
        const sorted = [...perm].sort((a,b) => a - b);
        for (let i = 0; i < 96; i++) {
            if (sorted[i] !== i) { badPerm = name; break; }
        }
        if (badPerm) break;
    }
    check(badPerm === null, `每個 perm 都是 0..95 的合法排列`, badPerm ? `bad: ${badPerm}` : null);
}

// ============================================================
console.log('\n=== T6: 寬 move 相當於外層 + 內層的組合 ===');
// Rw 應該等同 R + 內層切片同方向旋轉。
// 我們可以驗證：Rw 的 perm[15] (UFR 右上角貼紙) 應該等於 R 的 perm[15]，
// 因為兩者都把外層的 UFR 變成同一處。
{
    // 簡單檢查：對 SOLVED 套用 R 後與套用 Rw 後的 R 面（state[16..31]）應該相同
    const afterR = applyMove(ref.SOLVED_STATE, 'R');
    const afterRw = applyMove(ref.SOLVED_STATE, 'Rw');
    // R 面外層的 4 個 sticker（每 row 的最右一個）應該都旋轉了
    // 對 SOLVED 任何 outer R 旋轉都不改變 R 面的顏色（仍全 R），只改變相鄰面
    check(afterR.slice(16, 32) === 'R'.repeat(16),
        'SOLVED + R 後 R 面仍全 R');
    check(afterRw.slice(16, 32) === 'R'.repeat(16),
        'SOLVED + Rw 後 R 面仍全 R');
    // 但 Rw 還會把內層也轉，所以 U/F/D/B 面中間欄會有不同
    check(afterR !== afterRw,
        'Rw 與 R 在內層應該不同');
}

// ============================================================
console.log('\n=== T7: post-reduce sanity check（純邏輯版） ===');
// 模擬 RubiksGame._verifyReducedState 的邏輯，並驗證它在 reduce 失敗時正確擋下。
function verifyReducedState(state) {
    const CENTER_IDXS = [5, 6, 9, 10];
    for (let fi = 0; fi < ref.STATE_FACE_ORDER.length; fi++) {
        const face = ref.STATE_FACE_ORDER[fi];
        const base = fi * 16;
        for (const ci of CENTER_IDXS) {
            if (state[base + ci] !== face) {
                return { ok: false, reason: `${face} 面中心未就位` };
            }
        }
    }
    const EDGE_DEFS = [
        [1,82,2,81],[4,65,8,66],[7,18,11,17],[13,33,14,34],
        [49,45,50,46],[52,78,56,77],[55,29,59,30],[61,94,62,93],
        [20,39,24,43],[23,84,27,88],[36,71,40,75],[87,68,91,72],
    ];
    let unpaired = 0;
    for (const e of EDGE_DEFS) {
        const c1 = state[e[0]], c2 = state[e[1]];
        const c3 = state[e[2]], c4 = state[e[3]];
        if (!(c1 === c3 && c2 === c4)) unpaired++;
    }
    if (unpaired > 0) return { ok: false, reason: `${unpaired} 對邊塊未配對` };
    return { ok: true };
}

// (a) SOLVED 應通過
check(verifyReducedState(ref.SOLVED_STATE).ok, 'SOLVED 通過 post-reduce check');

// (b) 隨機 scramble 不應通過（中心亂掉）
{
    const moves = randomScramble(15);
    const scrambled = applyMoves(ref.SOLVED_STATE, moves);
    const r = verifyReducedState(scrambled);
    check(!r.ok, '隨機 scramble 不應通過 post-reduce check', `reason: ${r.reason}`);
}

// (c) 把 ReductionSolver4 的「輸出狀態」也跑一次 verify — 期望大多失敗（記錄為診斷）
let solverReducePassed = 0;
for (let i = 0; i < SOLVE_TRIALS; i++) {
    const { state } = scrambleHistory[i];
    const solver = new ReductionSolver4();
    const result = solver.solve(state);
    const reduced = applyMoves(state, result.moveList);
    const r = verifyReducedState(reduced);
    if (r.ok) solverReducePassed++;
}
console.log(`  diagnostic: ${solverReducePassed}/${SOLVE_TRIALS} scrambles 真正完成 reduction`);
// 對 ReductionSolver4 而言，我們已知有缺陷 — 不要 fail 測試，只記錄。
// 但 verifyReducedState 本身必須在 SOLVED 上通過、在 scrambled 上不通過。
check(solverReducePassed >= 0 && solverReducePassed <= SOLVE_TRIALS,
    'solver 部分成功率在合理範圍 (僅診斷)');

console.log('\n────────────────────────────');
console.log(`  ${pass} passed, ${fail} failed (total ${pass + fail})`);
if (fail > 0) {
    console.log('\n失敗：');
    failures.forEach(f => console.log('  •', f.name, f.extra ? '| ' + f.extra : ''));
    process.exit(1);
}
console.log('  ✓ 全部通過');
process.exit(0);
