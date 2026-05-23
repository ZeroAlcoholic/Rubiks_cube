// Test ReductionSolver Phase 1 (centers): 100 random scrambles, verify
// all 6 face centers end up correctly placed.
//
// This is the milestone test for #22 (Build N-aware _solveCenters with BFS).
// Must hit 100/100 for centers phase to be considered correct.

import { ReductionSolver } from '../../core/solver/reduction.js';
import { buildPerms, applyMove, applyMoves } from '../../core/geometry/perms-n.js';
import { centerIndices, FACE_ORDER, buildSolvedState } from '../../core/geometry/cube-geometry-n.js';
import { setSink } from '../../core/infra/logger.js';

// silence verbose logging during stress test
setSink(() => {});

const N = 4;
const SOLVED = buildSolvedState(N);
const perms = buildPerms(N);
const allMoves = Object.keys(perms);

// Random scramble of given length, avoiding immediate face reversal
function randomScramble(length) {
    const seq = [];
    let lastAxis = null;
    while (seq.length < length) {
        const move = allMoves[Math.floor(Math.random() * allMoves.length)];
        // axis derivation: R/L/Rw/Lw use x; U/D/Uw/Dw use y; F/B/Fw/Bw use z
        const face = move[0];  // R, L, U, D, F, B
        const axis = ('RL'.includes(face) ? 'x' : 'UD'.includes(face) ? 'y' : 'z');
        if (axis === lastAxis) continue;
        seq.push(move);
        lastAxis = axis;
    }
    return seq;
}

function checkCentersSolved(state, centerIdxByFace) {
    for (const face of FACE_ORDER) {
        for (const idx of centerIdxByFace[face]) {
            if (state[idx] !== face) {
                return { ok: false, reason: `${face}-face has ${state[idx]} at idx ${idx}` };
            }
        }
    }
    return { ok: true };
}

async function main() {
    console.log('=== ReductionSolver._solveCenters round-trip test (N=4, 100 scrambles) ===\n');
    const solver = new ReductionSolver({ N });
    const centerIdxByFace = centerIndices(N);
    let pass = 0, fail = 0;
    const failures = [];
    const moveStats = [];
    let totalElapsed = 0;

    for (let i = 0; i < 100; i++) {
        const scrambleLen = 15 + Math.floor(Math.random() * 15);  // 15-29 moves
        const scramble = randomScramble(scrambleLen);
        const scrambledState = applyMoves(perms, SOLVED, scramble);

        try {
            const t0 = Date.now();
            const result = await solver.solve(scrambledState);
            const elapsed = Date.now() - t0;
            totalElapsed += elapsed;

            // The full solver has stub phases for edges/parity/3x3 — we only
            // care about centers being correct after Phase 1.
            const centersPhase = result.phases.find(p => p.name === 'centers');
            if (!centersPhase) {
                fail++;
                failures.push({ i, reason: 'no centers phase' });
                continue;
            }

            const centersMoves = centersPhase.moves.map(m => m.notation);
            const afterCenters = applyMoves(perms, scrambledState, centersMoves);
            const check = checkCentersSolved(afterCenters, centerIdxByFace);

            if (check.ok) {
                pass++;
                moveStats.push(centersMoves.length);
                if (i < 5 || i === 99) {
                    console.log(`  #${i+1}: scramble=${scrambleLen}, centers=${centersMoves.length} moves, ${elapsed}ms ✓`);
                }
            } else {
                fail++;
                failures.push({ i, scramble: scramble.join(' '), reason: check.reason });
                console.log(`  #${i+1}: ✗ ${check.reason}`);
            }
        } catch (err) {
            fail++;
            failures.push({ i, scramble: scramble.join(' '), reason: err.message });
            console.log(`  #${i+1}: ✗ THREW: ${err.message}`);
        }
    }

    console.log('\n────────────────────────────');
    console.log(`  ${pass}/100 passed`);
    if (moveStats.length > 0) {
        const avg = moveStats.reduce((a,b)=>a+b, 0) / moveStats.length;
        const max = Math.max(...moveStats);
        const min = Math.min(...moveStats);
        console.log(`  centers move count: avg=${avg.toFixed(1)}, min=${min}, max=${max}`);
        console.log(`  total time: ${totalElapsed}ms (avg ${(totalElapsed/100).toFixed(1)}ms/solve)`);
    }
    if (fail > 0) {
        console.log(`\n  failures (first 5):`);
        failures.slice(0, 5).forEach(f => console.log(`    #${f.i+1}: ${f.reason}`));
        process.exit(1);
    } else {
        console.log('  ✓ 100/100 — centers solver guaranteed convergence');
        process.exit(0);
    }
}

main().catch(err => {
    console.error('[FATAL]', err);
    process.exit(2);
});
