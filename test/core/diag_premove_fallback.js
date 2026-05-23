// Test: when all 24 rotations fail, apply a "pre-move" to shift the state to a
// different symmetry class, then retry. Pre-moves are outer-face moves only
// (preserve centers), keeping Phase 1 valid.
//
// Usage: node test/core/diag_premove_fallback.js

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { buildPerms, applyMove, applyMoves, inverseNotation } from '../../core/geometry/perms-n.js';
import { buildSolvedState } from '../../core/geometry/cube-geometry-n.js';
import { ReductionSolver } from '../../core/solver/reduction.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const root  = join(__dir, '../..');

const ctx = vm.createContext({
    Math, Date, console: { log: () => {} }, setTimeout, clearTimeout, clearInterval, setInterval,
    $: { now: () => Date.now() }, DEBUG: false,
    isaac: { seed: () => {}, random: () => Math.random() },
    scrMgr: { reg: function c() { return c; }, fixCase: (_t, s) => s },
    image: { llImage: { drawImage: () => {} } },
    process,
});
vm.runInContext(readFileSync(join(root, 'vendor/cubejs-1.3.2.js'), 'utf8'), ctx);
vm.runInContext(readFileSync(join(root, 'vendor/cstimer-444.js'), 'utf8'), ctx);
const cst = ctx.scramble_444;
cst.init();

const N = 4;
const perms = buildPerms(N);
const SOLVED = buildSolvedState(N);
const allMoves = Object.keys(perms);

function inv(moves) { return moves.slice().reverse().map(inverseNotation); }

const COORD_ROTS_24 = [
    { physMoves: [], relabel: {} },
    { physMoves: ["Uw'","Dw"],   relabel: {"F":"R","L":"F","B":"L","R":"B"} },
    { physMoves: ["Uw2","Dw2"],  relabel: {"L":"R","B":"F","R":"L","F":"B"} },
    { physMoves: ["Uw","Dw'"],   relabel: {"B":"R","R":"F","F":"L","L":"B"} },
    { physMoves: ["Rw'","Lw"],   relabel: {"B":"U","U":"F","F":"D","D":"B"} },
    { physMoves: ["Rw'","Lw","Uw'","Dw"],  relabel: {"B":"U","U":"R","L":"F","F":"D","D":"L","R":"B"} },
    { physMoves: ["Rw'","Lw","Uw2","Dw2"], relabel: {"B":"U","L":"R","D":"F","F":"D","R":"L","U":"B"} },
    { physMoves: ["Rw'","Lw","Uw","Dw'"],  relabel: {"B":"U","D":"R","R":"F","F":"D","U":"L","L":"B"} },
    { physMoves: ["Rw","Lw'"],   relabel: {"F":"U","D":"F","B":"D","U":"B"} },
    { physMoves: ["Rw","Lw'","Uw'","Dw"],  relabel: {"F":"U","D":"R","L":"F","B":"D","U":"L","R":"B"} },
    { physMoves: ["Rw","Lw'","Uw2","Dw2"], relabel: {"F":"U","L":"R","U":"F","B":"D","R":"L","D":"B"} },
    { physMoves: ["Rw","Lw'","Uw","Dw'"],  relabel: {"F":"U","U":"R","R":"F","B":"D","D":"L","L":"B"} },
    { physMoves: ["Rw2","Lw2"],  relabel: {"D":"U","B":"F","U":"D","F":"B"} },
    { physMoves: ["Rw2","Lw2","Uw'","Dw"],  relabel: {"D":"U","B":"R","L":"F","U":"D","F":"L","R":"B"} },
    { physMoves: ["Rw2","Lw2","Uw2","Dw2"], relabel: {"D":"U","L":"R","U":"D","R":"L"} },
    { physMoves: ["Rw2","Lw2","Uw","Dw'"],  relabel: {"D":"U","F":"R","R":"F","U":"D","B":"L","L":"B"} },
    { physMoves: ["Fw","Bw'"],   relabel: {"L":"U","U":"R","R":"D","D":"L"} },
    { physMoves: ["Fw'","Bw"],   relabel: {"R":"U","D":"R","L":"D","U":"L"} },
    { physMoves: ["Fw","Bw'","Uw'","Dw"],  relabel: {"L":"U","F":"R","D":"F","R":"D","B":"L","U":"B"} },
    { physMoves: ["Fw'","Bw","Uw'","Dw"],  relabel: {"R":"U","F":"R","U":"F","L":"D","B":"L","D":"B"} },
    { physMoves: ["Fw","Bw'","Uw2","Dw2"], relabel: {"L":"U","D":"R","B":"F","R":"D","U":"L","F":"B"} },
    { physMoves: ["Fw'","Bw","Uw2","Dw2"], relabel: {"R":"U","U":"R","B":"F","L":"D","D":"L","F":"B"} },
    { physMoves: ["Fw","Bw'","Uw","Dw'"],  relabel: {"L":"U","B":"R","U":"F","R":"D","F":"L","D":"B"} },
    { physMoves: ["Fw'","Bw","Uw","Dw'"],  relabel: {"R":"U","B":"R","D":"F","L":"D","F":"L","U":"B"} },
];

function buildConj(relabel) {
    const conj = {};
    for (const [from, to] of Object.entries(relabel)) {
        conj[from] = to;
        conj[from + 'w'] = to + 'w';
    }
    return conj;
}

function coordRotate(state, physMoves, relabelMap) {
    const phys = physMoves.length ? applyMoves(perms, state, physMoves) : state;
    if (!Object.keys(relabelMap).length) return phys;
    return phys.split('').map(c => relabelMap[c] || c).join('');
}

function conjMove(move, conjMap) {
    if (!Object.keys(conjMap).length) return move;
    let suffix = '';
    let base = move;
    if (base.endsWith("'")) { suffix = "'"; base = base.slice(0, -1); }
    else if (base.endsWith('2')) { suffix = '2'; base = base.slice(0, -1); }
    return (conjMap[base] || base) + suffix;
}

// Try all 24 rotations on state. Returns solution moves or null.
function tryAll24(state) {
    for (let i = 0; i < COORD_ROTS_24.length; i++) {
        const { physMoves, relabel } = COORD_ROTS_24[i];
        const conj = buildConj(relabel);
        const rotated = coordRotate(state, physMoves, relabel);
        const raw = cst.genFacelet(rotated) || '';
        const tokens = raw.trim().split(/\s+/).filter(Boolean);
        const sol = inv(tokens).map(m => conjMove(m, conj));
        if ((sol.length > 0 || state === SOLVED) && applyMoves(perms, state, sol) === SOLVED) {
            return { moves: sol, rotIdx: i };
        }
    }
    return null;
}

// Outer moves only (preserve centers on 4x4).
const PRE_MOVES = [
    [],
    ["U"], ["R"], ["F"], ["D"], ["L"], ["B"],
    ["U2"], ["R2"], ["F2"],
    ["U", "R"], ["R", "U"], ["F", "U"],
];

const solver = new ReductionSolver({ N: 4 });
await solver.preload();

const RUNS = 100;
const stats = { failed: 0, byPreMove: {} };

console.log(`Running ${RUNS} all-move scrambles with pre-move fallback...`);

for (let t = 0; t < RUNS; t++) {
    let S = SOLVED, last = '';
    for (let i = 0; i < 25; i++) {
        let m; do { m = allMoves[Math.floor(Math.random() * allMoves.length)]; } while (m[0] === last[0]);
        S = applyMove(perms, S, m); last = m;
    }
    const centersPhase = solver._solveCenters(S);
    const CS = applyMoves(perms, S, centersPhase.moves.map(m => m.notation));

    let solved = false;
    for (const pre of PRE_MOVES) {
        const baseState = pre.length ? applyMoves(perms, CS, pre) : CS;
        const result = tryAll24(baseState);
        if (result) {
            const preKey = pre.join('+') || 'none';
            stats.byPreMove[preKey] = (stats.byPreMove[preKey] || 0) + 1;
            // Verify full solution
            const fullSol = [...pre, ...result.moves];
            if (applyMoves(perms, CS, fullSol) !== SOLVED) {
                console.log(`  ERROR: test #${t} pre=${preKey} reported success but verification failed`);
            }
            solved = true;
            break;
        }
    }
    if (!solved) {
        stats.failed++;
        console.log(`  test #${t} ALL pre-moves failed`);
    }
}

console.log('\n=== Results ===');
console.log(`  passed: ${RUNS - stats.failed}/${RUNS}`);
console.log(`  failed (all pre-moves): ${stats.failed}`);
console.log(`  by pre-move (which one was the first to succeed):`);
const sorted = Object.entries(stats.byPreMove).sort((a, b) => b[1] - a[1]);
for (const [pre, count] of sorted) {
    console.log(`    ${pre.padEnd(12)}: ${count}`);
}
