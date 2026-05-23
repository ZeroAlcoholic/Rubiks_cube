// Full 4×4 pipeline test: Centers → Edges → Parity → Kociemba
//
// Loads vendor/cstimer-444.js + vendor/cubejs-1.3.2.js via vm,
// runs ReductionSolver.solve() on 20 random scrambles, and verifies
// that the applied move sequence produces the solved state.
//
// Usage: node test/core/test_reduction_full.js

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { buildPerms, applyMoves } from '../../core/geometry/perms-n.js';
import { buildSolvedState } from '../../core/geometry/cube-geometry-n.js';
import { ReductionSolver } from '../../core/solver/reduction.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const root  = join(__dir, '../..');

// ─── Load vendor files into a shared vm context ───────────────────────────────
// cstimer-444.js expects certain globals; we set them up here.
const ctx = vm.createContext({
    Math, Date, console, setTimeout, clearTimeout, clearInterval, setInterval,
    $:       { now: () => Date.now(), isArray: (a) => Array.isArray(a) },
    DEBUG:   false,
    isaac:   { seed: () => {}, random: () => Math.random() },
    scrMgr:  { reg: function c() { return c; }, fixCase: (_t, s) => s },
    image:   { llImage: { drawImage: () => {} } },
    process, // needed by cubejs in some code paths
});

// cubejs must be loaded first (cstimer-444.js shims scramble_333 → Cube)
vm.runInContext(readFileSync(join(root, 'vendor/cubejs-1.3.2.js'), 'utf8'), ctx);
vm.runInContext(readFileSync(join(root, 'vendor/cstimer-444.js'),  'utf8'), ctx);

// Expose to Node's globalThis so ReductionSolver can find it via globalThis.scramble_444
globalThis.scramble_444 = ctx.scramble_444;
// Also expose Cube for the shim inside cstimer-444.js (already in ctx; need in globalThis too)
globalThis.Cube = ctx.Cube;

// ─── Test helpers ─────────────────────────────────────────────────────────────
const N      = 4;
const perms  = buildPerms(N);
const SOLVED = buildSolvedState(N);
const allMoves = Object.keys(perms);

function scramble(depth) {
    let state = SOLVED;
    const moves = [];
    let last = '';
    for (let i = 0; i < depth; i++) {
        let m;
        do { m = allMoves[Math.floor(Math.random() * allMoves.length)]; } while (m[0] === last[0]);
        state = perms[m].reduce ? applyOnePerm(perms[m], state) : applyOneMove(m, state);
        moves.push(m);
        last = m;
    }
    return { state, moves };
}

function applyOneMove(move, state) {
    const perm = perms[move];
    const arr  = state.split('');
    const res  = new Array(arr.length);
    for (let i = 0; i < arr.length; i++) res[perm[i]] = arr[i];
    return res.join('');
}

function doScramble(depth) {
    let state = SOLVED;
    let last  = '';
    for (let i = 0; i < depth; i++) {
        let m;
        do { m = allMoves[Math.floor(Math.random() * allMoves.length)]; } while (m[0] === last[0]);
        state = applyOneMove(m, state);
        last = m;
    }
    return state;
}

// ─── Run tests ────────────────────────────────────────────────────────────────
console.log('=== ReductionSolver full pipeline test (N=4, 20 scrambles) ===\n');
console.log('Initialising cstimer (first call triggers preload — may take 10-30s)…');

const solver = new ReductionSolver({ N: 4 });

// Warm up: call genFacelet on the solved state to trigger cstimer init()
const warmStart = Date.now();
ctx.scramble_444.init();          // sync, sets itself to no-op afterward
console.log(`cstimer init: ${Date.now() - warmStart}ms\n`);

let passed = 0, failed = 0;
const RUNS = 20;
const DEPTH = 20;

const t0 = Date.now();

for (let i = 0; i < RUNS; i++) {
    const scrambled = doScramble(DEPTH);
    try {
        const result = await solver.solve(scrambled);
        const allNotations = result.phases.flatMap(p => p.moves.map(m => m.notation));
        const finalState   = applyMoves(perms, scrambled, allNotations);

        const ok = finalState === SOLVED;
        const summary = result.phases.map(p => `${p.name}=${p.moves.length}m`).join(' | ');
        console.log(`  #${String(i+1).padStart(2)}: ${ok ? '✓' : '✗ FAIL'}  ${summary}`);
        if (ok) passed++; else {
            failed++;
            console.log(`       finalState: ${finalState.slice(0,20)}…`);
        }
    } catch (err) {
        failed++;
        console.log(`  #${String(i+1).padStart(2)}: ERROR — ${err.message}`);
    }
}

const elapsed = Date.now() - t0;
console.log('\n────────────────────────────');
console.log(`  ${passed}/${RUNS} passed  (${elapsed}ms total, avg ${~~(elapsed/RUNS)}ms/solve)`);
if (failed === 0) {
    console.log('  ✓ Full pipeline verified');
} else {
    console.log(`  ✗ ${failed} failures`);
    process.exit(1);
}
