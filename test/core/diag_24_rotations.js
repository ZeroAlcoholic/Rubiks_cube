// Diagnostic: test genFacelet with all 24 proper cube orientations on center-solved states.
// Usage: node test/core/diag_24_rotations.js

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
    Math, Date, console, setTimeout, clearTimeout, clearInterval, setInterval,
    $: { now: () => Date.now() }, DEBUG: false,
    isaac: { seed: () => {}, random: () => Math.random() },
    scrMgr: { reg: function c() { return c; }, fixCase: (_t, s) => s },
    image: { llImage: { drawImage: () => {} } },
    process,
});
vm.runInContext(readFileSync(join(root, 'vendor/cubejs-1.3.2.js'), 'utf8'), ctx);
vm.runInContext(readFileSync(join(root, 'vendor/cstimer-444.js'), 'utf8'), ctx);
globalThis.scramble_444 = ctx.scramble_444;
globalThis.Cube = ctx.Cube;

const cst = ctx.scramble_444;
cst.init();

const N = 4;
const perms = buildPerms(N);
const SOLVED = buildSolvedState(N);
const allMoves = Object.keys(perms);

function inv(moves) { return moves.slice().reverse().map(inverseNotation); }

function buildConj(relabel) {
    const conj = {};
    for (const [from, to] of Object.entries(relabel)) {
        conj[from] = to;
        conj[from + 'w'] = to + 'w';
    }
    return conj;
}

// All 24 proper cube orientations (auto-computed relabels)
const COORD_ROTS_24 = [
    { physMoves: [], relabel: {} }, // I
    { physMoves: ["Uw'","Dw"],   relabel: {"F":"R","L":"F","B":"L","R":"B"} }, // y
    { physMoves: ["Uw2","Dw2"],  relabel: {"L":"R","B":"F","R":"L","F":"B"} }, // y2
    { physMoves: ["Uw","Dw'"],   relabel: {"B":"R","R":"F","F":"L","L":"B"} }, // y'
    { physMoves: ["Rw'","Lw"],   relabel: {"B":"U","U":"F","F":"D","D":"B"} }, // x
    { physMoves: ["Rw'","Lw","Uw'","Dw"],  relabel: {"B":"U","U":"R","L":"F","F":"D","D":"L","R":"B"} }, // xy
    { physMoves: ["Rw'","Lw","Uw2","Dw2"], relabel: {"B":"U","L":"R","D":"F","F":"D","R":"L","U":"B"} }, // xy2
    { physMoves: ["Rw'","Lw","Uw","Dw'"],  relabel: {"B":"U","D":"R","R":"F","F":"D","U":"L","L":"B"} }, // xy'
    { physMoves: ["Rw","Lw'"],   relabel: {"F":"U","D":"F","B":"D","U":"B"} }, // x'
    { physMoves: ["Rw","Lw'","Uw'","Dw"],  relabel: {"F":"U","D":"R","L":"F","B":"D","U":"L","R":"B"} }, // x'y
    { physMoves: ["Rw","Lw'","Uw2","Dw2"], relabel: {"F":"U","L":"R","U":"F","B":"D","R":"L","D":"B"} }, // x'y2
    { physMoves: ["Rw","Lw'","Uw","Dw'"],  relabel: {"F":"U","U":"R","R":"F","B":"D","D":"L","L":"B"} }, // x'y'
    { physMoves: ["Rw2","Lw2"],  relabel: {"D":"U","B":"F","U":"D","F":"B"} }, // x2
    { physMoves: ["Rw2","Lw2","Uw'","Dw"],  relabel: {"D":"U","B":"R","L":"F","U":"D","F":"L","R":"B"} }, // x2y
    { physMoves: ["Rw2","Lw2","Uw2","Dw2"], relabel: {"D":"U","L":"R","U":"D","R":"L"} }, // x2y2
    { physMoves: ["Rw2","Lw2","Uw","Dw'"],  relabel: {"D":"U","F":"R","R":"F","U":"D","B":"L","L":"B"} }, // x2y'
    { physMoves: ["Fw","Bw'"],   relabel: {"L":"U","U":"R","R":"D","D":"L"} }, // z (L up)
    { physMoves: ["Fw'","Bw"],   relabel: {"R":"U","D":"R","L":"D","U":"L"} }, // z' (R up)
    { physMoves: ["Fw","Bw'","Uw'","Dw"],  relabel: {"L":"U","F":"R","D":"F","R":"D","B":"L","U":"B"} }, // zy
    { physMoves: ["Fw'","Bw","Uw'","Dw"],  relabel: {"R":"U","F":"R","U":"F","L":"D","B":"L","D":"B"} }, // z'y
    { physMoves: ["Fw","Bw'","Uw2","Dw2"], relabel: {"L":"U","D":"R","B":"F","R":"D","U":"L","F":"B"} }, // zy2
    { physMoves: ["Fw'","Bw","Uw2","Dw2"], relabel: {"R":"U","U":"R","B":"F","L":"D","D":"L","F":"B"} }, // z'y2
    { physMoves: ["Fw","Bw'","Uw","Dw'"],  relabel: {"L":"U","B":"R","U":"F","R":"D","F":"L","D":"B"} }, // zy'
    { physMoves: ["Fw'","Bw","Uw","Dw'"],  relabel: {"R":"U","B":"R","D":"F","L":"D","F":"L","U":"B"} }, // z'y'
].map(({ physMoves, relabel }) => ({ physMoves, relabel, conj: buildConj(relabel) }));

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

function tryAll24(S) {
    for (let i = 0; i < COORD_ROTS_24.length; i++) {
        const { physMoves, relabel, conj } = COORD_ROTS_24[i];
        const rotated = coordRotate(S, physMoves, relabel);
        const raw = cst.genFacelet(rotated) || '';
        const tokens = raw.trim().split(/\s+/).filter(Boolean);
        const solution = inv(tokens).map(m => conjMove(m, conj));
        if (applyMoves(perms, S, solution) === SOLVED) return { ok: true, rotIdx: i };
    }
    return { ok: false };
}

// Verify all 24 rotations are distinct
console.log('=== Verifying 24 rotations ===');
const results = new Set();
for (const { physMoves, relabel } of COORD_ROTS_24) {
    const rotated = coordRotate(SOLVED, physMoves, relabel);
    if (rotated !== SOLVED) console.log('  FAIL: rotation does not restore SOLVED');
    const phys = physMoves.length ? applyMoves(perms, SOLVED, physMoves) : SOLVED;
    results.add(phys);  // pre-relabeled states should be distinct
}
console.log(`  Distinct pre-relabeled orientations: ${results.size}/24 (expect 24)`);
console.log(`  All produce SOLVED after relabeling: ${[...results].every(() => true) ? 'checking...' : 'no'}`);

const solver = new ReductionSolver({ N: 4 });
await solver.preload();

const RUNS = 50;
let simple = 0, rot4 = 0, rot24 = 0;
const failedAt = [];

console.log(`\nRunning ${RUNS} all-move scrambles (with Phase 1 center solving)...`);

// The previous 4 rotations (I, x2, y2, z2=x2y2) are indices 0, 12, 2, 14
const ROT4_IDX = [0, 12, 2, 14];

for (let t = 0; t < RUNS; t++) {
    let S = SOLVED, last = '';
    for (let i = 0; i < 20; i++) {
        let m; do { m = allMoves[Math.floor(Math.random() * allMoves.length)]; } while (m[0] === last[0]);
        S = applyMove(perms, S, m); last = m;
    }

    const centersPhase = solver._solveCenters(S);
    const CS = applyMoves(perms, S, centersPhase.moves.map(m => m.notation));

    // Simple inv
    const raw0 = cst.genFacelet(CS) || '';
    const tok0 = raw0.trim().split(/\s+/).filter(Boolean);
    if (applyMoves(perms, CS, inv(tok0)) === SOLVED) simple++;

    // 4-rotation
    let ok4 = false;
    for (const i of ROT4_IDX) {
        const { physMoves, relabel, conj } = COORD_ROTS_24[i];
        const rot = coordRotate(CS, physMoves, relabel);
        const raw = cst.genFacelet(rot) || '';
        const sol = inv(raw.trim().split(/\s+/).filter(Boolean)).map(m => conjMove(m, conj));
        if (applyMoves(perms, CS, sol) === SOLVED) { ok4 = true; break; }
    }
    if (ok4) rot4++;

    const r24 = tryAll24(CS);
    if (r24.ok) rot24++;
    else failedAt.push(t);
}

console.log('\n=== Results (on center-solved states) ===');
console.log(`  simple inv:   ${simple}/${RUNS}`);
console.log(`  4-rotation:   ${rot4}/${RUNS}`);
console.log(`  24-rotation:  ${rot24}/${RUNS}`);
if (failedAt.length > 0) {
    console.log(`  Still failing: tests #${failedAt.join(', ')}`);
} else {
    console.log('  Perfect: 24 rotations cover all cases!');
}
