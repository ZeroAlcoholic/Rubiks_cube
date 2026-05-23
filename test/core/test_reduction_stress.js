// Larger stress test: 100 random scrambles through ReductionSolver.
// Focused on confirming the pre-move fallback handles the symmetry bug robustly.
//
// Usage: node test/core/test_reduction_stress.js

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { buildPerms, applyMove, applyMoves } from '../../core/geometry/perms-n.js';
import { buildSolvedState } from '../../core/geometry/cube-geometry-n.js';
import { ReductionSolver } from '../../core/solver/reduction.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const root  = join(__dir, '../..');

const ctx = vm.createContext({
    Math, Date, console: { log: () => {}, error: console.error }, setTimeout, clearTimeout, clearInterval, setInterval,
    $: { now: () => Date.now(), isArray: (a) => Array.isArray(a) }, DEBUG: false,
    isaac: { seed: () => {}, random: () => Math.random() },
    scrMgr: { reg: function c() { return c; }, fixCase: (_t, s) => s },
    image: { llImage: { drawImage: () => {} } },
    process,
});
vm.runInContext(readFileSync(join(root, 'vendor/cubejs-1.3.2.js'), 'utf8'), ctx);
vm.runInContext(readFileSync(join(root, 'vendor/cstimer-444.js'), 'utf8'), ctx);
globalThis.scramble_444 = ctx.scramble_444;
globalThis.Cube = ctx.Cube;
ctx.scramble_444.init();

const N = 4;
const perms = buildPerms(N);
const SOLVED = buildSolvedState(N);
const allMoves = Object.keys(perms);

function doScramble(depth) {
    let state = SOLVED, last = '';
    for (let i = 0; i < depth; i++) {
        let m; do { m = allMoves[Math.floor(Math.random() * allMoves.length)]; } while (m[0] === last[0]);
        state = applyMove(perms, state, m); last = m;
    }
    return state;
}

const solver = new ReductionSolver({ N: 4 });

console.log('=== Stress test: 100 random scrambles ===');

let passed = 0, failed = 0;
const failures = [];
const t0 = Date.now();

for (let i = 0; i < 100; i++) {
    const scrambled = doScramble(25);
    try {
        const result = await solver.solve(scrambled);
        const moves = result.phases.flatMap(p => p.moves.map(m => m.notation));
        const final = applyMoves(perms, scrambled, moves);
        if (final === SOLVED) passed++;
        else { failed++; failures.push({ i, scrambled, moveCount: moves.length }); }
    } catch (err) {
        failed++;
        failures.push({ i, scrambled, err: err.message });
    }
    if ((i + 1) % 10 === 0) console.log(`  progress: ${i + 1}/100 (${passed} pass, ${failed} fail)`);
}

const elapsed = Date.now() - t0;
console.log('\n────────────────────────────');
console.log(`  ${passed}/100 passed  (${elapsed}ms total, avg ${~~(elapsed/100)}ms/solve)`);
if (failures.length > 0) {
    console.log(`  FAILURES:`);
    for (const f of failures.slice(0, 5)) {
        console.log(`    #${f.i}: ${f.err || `applied ${f.moveCount} moves, final ≠ SOLVED`}`);
        if (!f.err) console.log(`         scrambled=${f.scrambled.slice(0,40)}…`);
    }
    process.exit(1);
}
