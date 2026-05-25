// Cross-variant solver smoke test.
//
// For each solver variant in the registry that is invokable in Node (i.e.
// doesn't need cstimer/cubejs browser globals), verify:
//   - factory + preload succeed
//   - registry metadata is well-formed
//   - centers-only phase on a known scramble produces a working sequence
//
// We DON'T attempt full solve() in Node because cstimer's edge-pairing IDA*
// expects browser-side vendor globals (self.scramble_444). The full pipeline
// is verified by manual browser testing. What we CAN verify here:
//   - solver registry shape
//   - Yau wrapper's phase re-organization logic (centers split into 3
//     substages whose moves concatenate to the original centers move list)
//   - cubejs finisher option doesn't crash when picked
//
// Run: node tools/test-solvers.js

import { SOLVER_VARIANTS, createSolver, getVariantMetadata } from '../core/solver/solver-registry.js';
import { ReductionSolver } from '../core/solver/reduction.js';
import { YauSolver }       from '../core/solver/yau-solver.js';
import { buildPerms, applyMoves, applyMove } from '../core/geometry/perms-n.js';
import { buildSolvedState } from '../core/geometry/cube-geometry-n.js';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TABLES_DIR = resolve(__dirname, '..', 'vendor', 'bfs-tables');

// ─── Reuse the worker's parse logic for baked tables ────────────────────────
const BAKED_MAGIC = 0x52424653;
function parseBakedTable(arrayBuffer, tableName) {
    const view = new DataView(arrayBuffer);
    if (view.getUint32(0, true) !== BAKED_MAGIC) throw new Error(`${tableName}: bad magic`);
    if (view.getUint32(4, true) !== 1) throw new Error(`${tableName}: unsupported version`);
    const numEntries = view.getUint32(8, true);
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
        const pk = pks[i] === 0xFFFFFFFF ? null : pks[i];
        const move = moveIdxs[i] === 0xFF ? null : moves[moveIdxs[i]];
        map.set(keys[i], { pk, move });
    }
    return map;
}

function loadCachedTables() {
    const tables = {};
    for (const name of ['udPair', 'fbPair', 'sortJoint']) {
        const path = resolve(TABLES_DIR, `${name}.bin.gz`);
        if (!existsSync(path)) return null;
        const gz = readFileSync(path);
        const raw = gunzipSync(gz);
        const aligned = new ArrayBuffer(raw.byteLength);
        new Uint8Array(aligned).set(raw);
        tables[name] = parseBakedTable(aligned, name);
    }
    return tables;
}

// ─── Test harness ───────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function check(cond, msg, extra) {
    if (cond) { pass++; console.log(`  ✓ ${msg}`); }
    else      { fail++; console.log(`  ✗ ${msg}` + (extra ? ` — ${extra}` : '')); }
}

async function main() {
    console.log('=== Solver Registry shape ===');
    check(typeof SOLVER_VARIANTS === 'object', 'SOLVER_VARIANTS exists');
    check(SOLVER_VARIANTS.fast && SOLVER_VARIANTS['fast-kociemba'] && SOLVER_VARIANTS['yau-teach'],
        'three variants registered (fast / fast-kociemba / yau-teach)');
    const meta = getVariantMetadata();
    check(Array.isArray(meta) && meta.length === 3, `getVariantMetadata returns ${meta.length} entries (expected 3)`);
    for (const v of meta) {
        check(typeof v.displayName === 'string' && v.displayName.length > 0,
            `variant ${v.name} has non-empty displayName`);
        check(Array.isArray(v.estimatedMoves) && v.estimatedMoves.length === 2,
            `variant ${v.name} has [min,max] estimatedMoves`);
    }

    console.log('');
    console.log('=== createSolver() instantiation ===');
    const sFast = await createSolver('fast');
    check(sFast instanceof ReductionSolver, 'fast → ReductionSolver instance');
    check(sFast.finisher === 'cstimer', 'fast finisher = cstimer');

    const sCubejs = await createSolver('fast-kociemba');
    check(sCubejs instanceof ReductionSolver, 'fast-kociemba → ReductionSolver instance');
    check(sCubejs.finisher === 'cubejs', 'fast-kociemba finisher = cubejs');

    const sYau = await createSolver('yau-teach');
    check(sYau instanceof YauSolver, 'yau-teach → YauSolver instance');
    check(sYau.name === 'yau-teach', 'yau-teach has correct .name');

    // Unknown name falls back to 'fast'
    const sUnknown = await createSolver('nonsense-variant-name');
    check(sUnknown instanceof ReductionSolver, 'unknown variant falls back to fast');

    console.log('');
    console.log('=== Yau phase re-organization (without browser deps) ===');
    // Build a scrambled centers state and run JUST the centers phase through
    // both Reduction and Yau, then verify Yau's substage moves concatenate
    // back to Reduction's bundled centers moves (proves no algorithm drift).
    const tables = loadCachedTables();
    check(tables !== null, 'baked tables loaded for test');
    if (!tables) { console.log('  (skipping rest — bake tables first)'); return; }

    const perms = buildPerms(4);
    const SOLVED = buildSolvedState(4);
    const SCRAMBLE = ['Rw', "U2", "F'", 'Lw', "B'", 'R2', "Uw'", 'D', 'L', "Fw"];
    const scrambled = applyMoves(perms, SOLVED, SCRAMBLE);
    check(scrambled !== SOLVED, 'scramble produced non-solved state');

    const red = new ReductionSolver({ N: 4 });
    await red.preload({ cachedTables: tables });
    const centersRed = red._solveCenters(scrambled);
    const moveListRed = centersRed.moves.map(m => m.notation);
    check(moveListRed.length > 0, `Reduction centers produced ${moveListRed.length} moves`);
    const postCentersRed = applyMoves(perms, scrambled, moveListRed);

    const yau = new YauSolver({ N: 4 });
    await yau.preload({ cachedTables: tables });
    // Build a synthetic 'result' that looks like Reduction.solve() output but
    // contains ONLY the centers phase — so _reorganizeForYau exercises the
    // substage split without needing cstimer to fill in later phases.
    const yauReorg = yau._reorganizeForYau(scrambled, {
        phases: [centersRed],
        totalMoves: moveListRed.length,
        solverName: 'reduction-4x4',
        telemetry: null,
    });

    // Concatenate Yau's split-out substage moves and compare to Reduction's.
    const yauCenterPhases = yauReorg.phases.filter(p => p.name.startsWith('yau-pair') || p.name === 'yau-sort');
    check(yauCenterPhases.length >= 1 && yauCenterPhases.length <= 3,
        `Yau split centers into ${yauCenterPhases.length} substages (1-3 expected)`);
    const yauAllMoves = yauCenterPhases.flatMap(p => p.moves.map(m => m.notation));
    check(yauAllMoves.length === moveListRed.length,
        `Yau substages total ${yauAllMoves.length} moves, expected ${moveListRed.length}`);
    let movesMatch = true;
    for (let i = 0; i < moveListRed.length; i++) {
        if (yauAllMoves[i] !== moveListRed[i]) { movesMatch = false; break; }
    }
    check(movesMatch, 'Yau substage moves are identical to Reduction centers moves (no algorithm drift)');

    // Verify post-Yau-substages state matches post-Reduction-centers state
    const postYau = applyMoves(perms, scrambled, yauAllMoves);
    check(postYau === postCentersRed, 'post-Yau-centers state === post-Reduction-centers state');

    // Each substage's moves should have a templateKey for per-step teaching
    let allMovesHaveTemplateKey = true;
    for (const p of yauCenterPhases) {
        for (const m of p.moves) {
            if (!m.templateKey) { allMovesHaveTemplateKey = false; break; }
        }
    }
    check(allMovesHaveTemplateKey, 'every Yau move has a templateKey for teaching UI');

    console.log('');
    console.log('─────────────────────────────');
    console.log(`  ${pass} passed, ${fail} failed`);
    if (fail > 0) process.exit(1);
    console.log('  ✓ solver registry + Yau wrapper round-trip correctly');
}

main().catch(e => { console.error(e); process.exit(1); });
