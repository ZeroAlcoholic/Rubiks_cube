// 4×4 求解器端到端測試 — 使用 core/solver/reduction.js (ESM) + 預烤 BFS 表
//
// 跑法：node test_solver_4x4.cjs
//
// 目的：
//   - 幾何正確性（applyMove、PERMS_4 完整性、寬 move）
//   - 驗證 scramble 狀態通過 StateValidator4
//   - ReductionSolver.solve() 在 Node 環境（無 cstimer）回傳 centers phase 正確
//   - post-reduce sanity check 邏輯驗證

'use strict';

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const ref = require('./test_logic_4x4.cjs');

// ── 重用 baked table 解析（同 workers/solver-worker.js）
const BAKED_MAGIC = 0x52424653;
function parseBakedTable(arrayBuffer, tableName) {
    const view = new DataView(arrayBuffer);
    if (view.getUint32(0, true) !== BAKED_MAGIC) throw new Error(`${tableName}: bad magic`);
    if (view.getUint32(4, true) !== 1)           throw new Error(`${tableName}: unsupported version`);
    const numEntries = view.getUint32(8,  true);
    const numMoves   = view.getUint32(12, true);
    const dec = new TextDecoder();
    const moves = new Array(numMoves);
    for (let i = 0; i < numMoves; i++) {
        const slot = new Uint8Array(arrayBuffer, 16 + i * 4, 4);
        let end = 4;
        while (end > 0 && slot[end - 1] === 0) end--;
        moves[i] = dec.decode(slot.subarray(0, end));
    }
    const dictBytes = numMoves * 4;
    const keys     = new Uint32Array(arrayBuffer, 16 + dictBytes,                  numEntries);
    const pks      = new Uint32Array(arrayBuffer, 16 + dictBytes + numEntries * 4, numEntries);
    const moveIdxs = new Uint8Array (arrayBuffer, 16 + dictBytes + numEntries * 8, numEntries);
    const map = new Map();
    for (let i = 0; i < numEntries; i++) {
        const pk   = pks[i]      === 0xFFFFFFFF ? null : pks[i];
        const move = moveIdxs[i] === 0xFF       ? null : moves[moveIdxs[i]];
        map.set(keys[i], { pk, move });
    }
    return map;
}

function loadBakedTables() {
    const dir = path.join(__dirname, 'vendor', 'bfs-tables');
    const tables = {};
    for (const name of ['udPair', 'fbPair', 'sortJoint']) {
        const p = path.join(dir, `${name}.bin.gz`);
        if (!fs.existsSync(p)) return null;
        const gz  = fs.readFileSync(p);
        const raw = zlib.gunzipSync(gz);
        const buf = new ArrayBuffer(raw.byteLength);
        new Uint8Array(buf).set(raw);
        tables[name] = parseBakedTable(buf, name);
    }
    return tables;
}

// ── 測試 runner
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

// ── 隨機 scramble 產生器
const BASE_MOVES = ['U','R','F','D','L','B','Uw','Rw','Fw','Dw','Lw','Bw'];
const SUFFIXES   = ['', "'", '2'];
function randomScramble(length) {
    const moves = [];
    let lastBase = null;
    for (let i = 0; i < length; i++) {
        let base;
        do { base = BASE_MOVES[Math.floor(Math.random() * BASE_MOVES.length)]; }
        while (base === lastBase);
        moves.push(base + SUFFIXES[Math.floor(Math.random() * SUFFIXES.length)]);
        lastBase = base;
    }
    return moves;
}

// ── post-reduce sanity check（純邏輯版）
const CENTER_IDXS = [5, 6, 9, 10];
const EDGE_DEFS = [
    [1,82,2,81],[4,65,8,66],[7,18,11,17],[13,33,14,34],
    [49,45,50,46],[52,78,56,77],[55,29,59,30],[61,94,62,93],
    [20,39,24,43],[23,84,27,88],[36,71,40,75],[87,68,91,72],
];
function verifyReducedState(state) {
    for (let fi = 0; fi < ref.STATE_FACE_ORDER.length; fi++) {
        const face = ref.STATE_FACE_ORDER[fi];
        const base = fi * 16;
        for (const ci of CENTER_IDXS) {
            if (state[base + ci] !== face) return { ok: false, reason: `${face} 面中心未就位` };
        }
    }
    let unpaired = 0;
    for (const e of EDGE_DEFS) {
        if (!(state[e[0]] === state[e[2]] && state[e[1]] === state[e[3]])) unpaired++;
    }
    if (unpaired > 0) return { ok: false, reason: `${unpaired} 對邊塊未配對` };
    return { ok: true };
}

// ────────────────────────────────────────────────────────────────────────────
(async () => {
    // Load ESM modules via dynamic import
    const { buildPerms, applyMove: _applyMove, applyMoves: _applyMoves, inverseNotation, inverseMoves }
        = await import('./core/geometry/perms-n.js');
    const { ReductionSolver } = await import('./core/solver/reduction.js');

    const PERMS_4 = buildPerms(4);

    // Thin wrappers that match the old string-based test API
    function applyMove(state, notation) {
        return _applyMove(PERMS_4, state, notation);
    }
    function applyMoves(state, moves) {
        return _applyMoves(PERMS_4, state, moves);
    }

    // ============================================================
    console.log('=== T1: applyMove SOLVED → notation → 反向 → SOLVED ===');
    for (const base of BASE_MOVES) {
        for (const suf of SUFFIXES) {
            const move = base + suf;
            const inv = inverseNotation(move);
            const after = applyMove(ref.SOLVED_STATE, move);
            const back  = applyMove(after, inv);
            check(back === ref.SOLVED_STATE, `${move} then ${inv} → SOLVED`);
        }
    }

    // ============================================================
    console.log('\n=== T2: scrambled 狀態通過嚴格驗證 ===');
    const SCRAMBLE_TRIALS = 30;
    let validScrambles = 0;
    const scrambleHistory = [];
    for (let trial = 0; trial < SCRAMBLE_TRIALS; trial++) {
        const moves     = randomScramble(10 + trial);
        const scrambled = applyMoves(ref.SOLVED_STATE, moves);
        const v = ref.validateState4Strict(scrambled);
        if (v.ok) {
            validScrambles++;
            scrambleHistory.push({ moves, state: scrambled });
        } else {
            console.log(`  ✗ scramble #${trial} ${moves.length} 步未通過驗證: ${v.errors?.[0]}`);
        }
    }
    check(validScrambles === SCRAMBLE_TRIALS,
        `${SCRAMBLE_TRIALS} 個隨機 scramble 都應通過 strict validator`,
        `${validScrambles}/${SCRAMBLE_TRIALS} 通過`);

    // ============================================================
    console.log('\n=== T3: ReductionSolver centers phase（Node 環境，無 cstimer）===');
    const tables = loadBakedTables();
    check(tables !== null, 'baked tables 可載入');

    const SOLVE_TRIALS = Math.min(10, scrambleHistory.length);
    let centerOk = 0, resultShapeOk = 0;
    if (tables) {
        const solver = new ReductionSolver({ N: 4 });
        await solver.preload({ cachedTables: tables });
        for (let i = 0; i < SOLVE_TRIALS; i++) {
            const { state } = scrambleHistory[i];
            let result;
            try {
                result = await solver.solve(state);
            } catch (e) {
                console.log(`  ✗ scramble #${i}: solver throw — ${e.message}`);
                continue;
            }
            // 回傳格式 { phases, totalMoves, solverName }
            if (result && Array.isArray(result.phases) && typeof result.totalMoves === 'number') {
                resultShapeOk++;
            }
            // centers phase（第 0 個）應讓所有面中心就位
            const centersPhase = result?.phases?.[0];
            if (centersPhase) {
                const afterCenters = applyMoves(state, centersPhase.moves.map(m => m.notation));
                let ok = true;
                for (let fi = 0; fi < ref.STATE_FACE_ORDER.length; fi++) {
                    const face = ref.STATE_FACE_ORDER[fi];
                    const base = fi * 16;
                    for (const ci of CENTER_IDXS) {
                        if (afterCenters[base + ci] !== face) { ok = false; break; }
                    }
                    if (!ok) break;
                }
                if (ok) centerOk++;
            }
        }
    }
    console.log(`  centers solved: ${centerOk}/${SOLVE_TRIALS}`);
    console.log(`  result shape ok: ${resultShapeOk}/${SOLVE_TRIALS}`);
    check(resultShapeOk === SOLVE_TRIALS, 'solver 輸出格式符合 { phases, totalMoves }');
    check(centerOk === SOLVE_TRIALS, `所有 ${SOLVE_TRIALS} 個 scramble 的 centers phase 正確歸位`);

    // ============================================================
    console.log('\n=== T4: ReductionSolver 對 SOLVED 應回傳 trivial（0 步）===');
    {
        const solver = new ReductionSolver({ N: 4 });
        await solver.preload({ cachedTables: tables });
        const r = await solver.solve(ref.SOLVED_STATE);
        check(r.totalMoves === 0, 'SOLVED → totalMoves === 0', `got: ${r.totalMoves}`);
        check(Array.isArray(r.phases) && r.phases.length > 0, 'SOLVED → phases 陣列非空');
    }

    // ============================================================
    console.log('\n=== T5: PERMS_4 完整性 ===');
    {
        const expected = [];
        for (const f of ['U','R','F','D','L','B']) {
            expected.push(f, f+"'", f+'2', f+'w', f+"w'", f+'w2');
        }
        const missing = expected.filter(n => !PERMS_4[n]);
        check(missing.length === 0, '所有預期 notation 都在 PERMS_4 中',
            missing.length ? `missing: ${missing.join(', ')}` : null);
    }
    {
        let badPerm = null;
        for (const [name, perm] of Object.entries(PERMS_4)) {
            if (perm.length !== 96) { badPerm = name; break; }
            const sorted = [...perm].sort((a, b) => a - b);
            for (let i = 0; i < 96; i++) {
                if (sorted[i] !== i) { badPerm = name; break; }
            }
            if (badPerm) break;
        }
        check(badPerm === null, '每個 perm 都是 0..95 的合法排列',
            badPerm ? `bad: ${badPerm}` : null);
    }

    // ============================================================
    console.log('\n=== T6: 寬 move 與外層 move 的關係 ===');
    {
        const afterR  = applyMove(ref.SOLVED_STATE, 'R');
        const afterRw = applyMove(ref.SOLVED_STATE, 'Rw');
        check(afterR.slice(16, 32)  === 'R'.repeat(16), 'SOLVED + R  後 R 面仍全 R');
        check(afterRw.slice(16, 32) === 'R'.repeat(16), 'SOLVED + Rw 後 R 面仍全 R');
        check(afterR !== afterRw, 'Rw 與 R 在內層應該不同');
    }

    // ============================================================
    console.log('\n=== T7: post-reduce sanity check（純邏輯版）===');
    check(verifyReducedState(ref.SOLVED_STATE).ok, 'SOLVED 通過 post-reduce check');
    {
        const moves     = randomScramble(15);
        const scrambled = applyMoves(ref.SOLVED_STATE, moves);
        const r = verifyReducedState(scrambled);
        check(!r.ok, '隨機 scramble 不應通過 post-reduce check', `reason: ${r.reason}`);
    }

    // ============================================================
    console.log('\n────────────────────────────');
    console.log(`  ${pass} passed, ${fail} failed (total ${pass + fail})`);
    if (fail > 0) {
        console.log('\n失敗：');
        failures.forEach(f => console.log('  •', f.name, f.extra ? '| ' + f.extra : ''));
        process.exit(1);
    }
    console.log('  ✓ 全部通過');
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
