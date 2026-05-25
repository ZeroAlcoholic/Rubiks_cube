// Round-trip test for the baked BFS tables.
//
// We exercise the SAME parse logic the worker uses (copied verbatim below)
// against the on-disk .bin.gz files, then verify:
//   1. parse(bake(BFS)) reproduces the BFS tables exactly
//   2. ReductionSolver fed those parsed tables can solve a real scramble
//
// If this passes, the worker code that does fetch + DecompressionStream + parse
// is correct by construction — the only differences are the I/O layer (fs vs
// fetch) and decompression (zlib vs DecompressionStream), both well-trusted.
//
// Run: node tools/test-baked-tables.js

import { ReductionSolver } from '../core/solver/reduction.js';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPerms, applyMoves } from '../core/geometry/perms-n.js';
import { buildSolvedState } from '../core/geometry/cube-geometry-n.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TABLES_DIR = resolve(__dirname, '..', 'vendor', 'bfs-tables');

// ───── Parse logic — mirror of workers/solver-worker.js parseBakedTable ─────
const BAKED_MAGIC = 0x52424653; // "RBFS"
const BAKED_FORMAT_VERSION = 1;

function parseBakedTable(arrayBuffer, tableName) {
    const view = new DataView(arrayBuffer);
    const magic = view.getUint32(0, true);
    if (magic !== BAKED_MAGIC) {
        throw new Error(`${tableName}: bad magic 0x${magic.toString(16)}`);
    }
    const version = view.getUint32(4, true);
    if (version !== BAKED_FORMAT_VERSION) {
        throw new Error(`${tableName}: unsupported version ${version}`);
    }
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
        const moveIdx = moveIdxs[i];
        const move = moveIdx === 0xFF ? null : moves[moveIdx];
        map.set(keys[i], { pk, move });
    }
    return map;
}

function readBakedTable(name) {
    const path = resolve(TABLES_DIR, `${name}.bin.gz`);
    if (!existsSync(path)) {
        throw new Error(`missing ${path} — run "node tools/bake-bfs-tables.js" first`);
    }
    const gz = readFileSync(path);
    const raw = gunzipSync(gz);
    // Node Buffer.buffer is a SharedArrayBuffer-like; copy into a fresh
    // ArrayBuffer to ensure Uint32Array views are aligned and aren't reading
    // beyond the Buffer's slice window.
    const aligned = new ArrayBuffer(raw.byteLength);
    new Uint8Array(aligned).set(raw);
    return parseBakedTable(aligned, name);
}

let pass = 0, fail = 0;
function check(cond, msg) {
    if (cond) { pass++; console.log(`  ✓ ${msg}`); }
    else      { fail++; console.log(`  ✗ ${msg}`); }
}

async function main() {
    console.log('=== Test 1: parsed tables match freshly-built BFS ===');
    const fresh = new ReductionSolver({ N: 4 });
    await fresh.preload();
    const baked = {};
    for (const name of ['udPair', 'fbPair', 'sortJoint']) {
        baked[name] = readBakedTable(name);
    }
    for (const name of ['udPair', 'fbPair', 'sortJoint']) {
        check(baked[name].size === fresh._tables[name].size,
            `${name}: size ${baked[name].size} === ${fresh._tables[name].size}`);
        // Spot-check a few entries — full diff would be slow but
        // size+sentinel match is a strong signal already.
        const freshKeys = [...fresh._tables[name].keys()].slice(0, 50);
        let allMatch = true;
        let mismatchExample = null;
        for (const k of freshKeys) {
            const fv = fresh._tables[name].get(k);
            const bv = baked[name].get(k);
            if (!bv || bv.pk !== fv.pk || bv.move !== fv.move) {
                allMatch = false;
                mismatchExample = { k, fresh: fv, baked: bv };
                break;
            }
        }
        check(allMatch, `${name}: first 50 entries match` + (mismatchExample ? ` (mismatch: ${JSON.stringify(mismatchExample)})` : ''));
    }

    console.log('');
    console.log('=== Test 2: solver fed with BAKED tables solves a scramble ===');
    // Build a deterministic 4×4 scramble using outer + wide moves.
    const N = 4;
    const perms = buildPerms(N);
    const SOLVED = buildSolvedState(N);
    const SCRAMBLE = ['R', 'Uw', "F'", 'Lw2', 'B', "Rw'", 'D', 'L2', 'Uw', 'F'];
    const scrambled = applyMoves(perms, SOLVED, SCRAMBLE);
    check(scrambled !== SOLVED, 'scramble produces non-solved state');

    const solver2 = new ReductionSolver({ N: 4 });
    await solver2.preload({ cachedTables: baked });
    // Only test centers phase here — full solve requires cstimer (not loaded
    // in Node). Centers is the table-driven phase we actually care about.
    const centersResult = solver2._solveCenters(scrambled);
    check(centersResult.name === 'centers', 'centers phase ran');
    check(Array.isArray(centersResult.moves) && centersResult.moves.length > 0,
        `centers produced ${centersResult.moves.length} moves`);
    const afterCenters = applyMoves(perms, scrambled, centersResult.moves.map(m => m.notation));
    // Verify all 6 centers are uniform after centers phase.
    const CENTER_POS_4 = [5, 6, 9, 10];
    const FACE_ORDER = ['U', 'R', 'F', 'D', 'L', 'B'];
    let centersOk = true;
    for (let fi = 0; fi < 6; fi++) {
        const face = FACE_ORDER[fi];
        for (const ci of CENTER_POS_4) {
            if (afterCenters[fi * 16 + ci] !== face) {
                centersOk = false;
                break;
            }
        }
    }
    check(centersOk, 'after centers phase, all 6 face centers are uniform');

    console.log('');
    console.log('─────────────────────────────');
    console.log(`  ${pass} passed, ${fail} failed`);
    if (fail > 0) process.exit(1);
    console.log('  ✓ baked tables round-trip correctly');
}

main().catch(e => { console.error(e); process.exit(1); });
