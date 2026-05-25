// One-shot Node tool to bake the 4×4 Centers BFS lookup tables into static
// binary files shipped at vendor/bfs-tables/*.bin.
//
// Why: workers/solver-worker.js currently builds these tables in JS on first
// visit, taking 3-10 s of mobile CPU time before solving is possible. After
// baking, the worker fetches the .bin files (1-2 s on 4G, then permanent SW
// cache) and deserializes in ~100 ms — first-visit cold start drops from
// ~10 s to ~1.5 s.
//
// Run: node tools/bake-bfs-tables.js
// Output:
//   vendor/bfs-tables/udPair.bin
//   vendor/bfs-tables/fbPair.bin
//   vendor/bfs-tables/sortJoint.bin
//
// Binary format (little-endian):
//   [u32 magic = 0x52424653 "RBFS"]
//   [u32 version]
//   [u32 numEntries]
//   [u32 numMoves]
//   [numMoves × 4-byte null-padded ASCII strings]   ← move dictionary
//   [Uint32Array(numEntries)]                       ← keys
//   [Uint32Array(numEntries)]                       ← pks (0xFFFFFFFF = root)
//   [Uint8Array(numEntries)]                        ← move indices (0xFF = none)
//
// The worker mirrors this layout on the read side. Bump TABLE_VERSION on
// both sides simultaneously when the layout changes.

import { ReductionSolver } from '../core/solver/reduction.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'vendor', 'bfs-tables');
mkdirSync(OUT_DIR, { recursive: true });

const MAGIC = 0x52424653; // "RBFS"
const VERSION = 1;

/**
 * Pack one Map<u32, {pk: u32|null, move: string|null}> into an ArrayBuffer
 * using the layout documented above.
 */
function packTable(map) {
    // Build move dictionary (deduplicated, sorted for determinism).
    const moveSet = new Set();
    for (const v of map.values()) {
        if (v.move != null) moveSet.add(v.move);
    }
    const moves = [...moveSet].sort();
    if (moves.length > 254) {
        // 0xFF is reserved for "no move" (root). Anything ≤ 254 fits a u8.
        throw new Error(`too many moves (${moves.length}) — need to widen moveIdx to u16`);
    }
    for (const m of moves) {
        if (m.length > 4) {
            throw new Error(`move string too long: "${m}" — need to widen dict slot`);
        }
    }
    const moveToIdx = new Map(moves.map((m, i) => [m, i]));

    const numEntries = map.size;
    const headerBytes = 16;                              // magic+version+numEntries+numMoves
    const dictBytes = moves.length * 4;                  // 4-byte slots
    const keyBytes = numEntries * 4;
    const pkBytes = numEntries * 4;
    const moveIdxBytes = numEntries * 1;
    const totalBytes = headerBytes + dictBytes + keyBytes + pkBytes + moveIdxBytes;

    const buf = new ArrayBuffer(totalBytes);
    const view = new DataView(buf);
    view.setUint32(0, MAGIC, true);
    view.setUint32(4, VERSION, true);
    view.setUint32(8, numEntries, true);
    view.setUint32(12, moves.length, true);

    // Move dictionary
    const dictArr = new Uint8Array(buf, headerBytes, dictBytes);
    const enc = new TextEncoder();
    for (let i = 0; i < moves.length; i++) {
        const slot = enc.encode(moves[i]);
        dictArr.set(slot, i * 4);
        // remaining bytes already zero-initialized
    }

    // Entries — write directly into the buffer via typed-array views.
    const keys     = new Uint32Array(buf, headerBytes + dictBytes,                  numEntries);
    const pks      = new Uint32Array(buf, headerBytes + dictBytes + keyBytes,       numEntries);
    const moveIdxs = new Uint8Array (buf, headerBytes + dictBytes + keyBytes + pkBytes, numEntries);

    let i = 0;
    for (const [k, v] of map) {
        keys[i] = k;
        pks[i] = v.pk == null ? 0xFFFFFFFF : v.pk;
        moveIdxs[i] = v.move == null ? 0xFF : moveToIdx.get(v.move);
        i++;
    }
    return buf;
}

function fmtBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

async function main() {
    console.log('Baking 4×4 Centers BFS tables...');
    const t0 = Date.now();
    const solver = new ReductionSolver({ N: 4 });
    await solver.preload();
    const t1 = Date.now();
    console.log(`  BFS build complete in ${t1 - t0} ms`);
    console.log(`  udPair:    ${solver._tables.udPair.size.toLocaleString()} states`);
    console.log(`  fbPair:    ${solver._tables.fbPair.size.toLocaleString()} states`);
    console.log(`  sortJoint: ${solver._tables.sortJoint.size.toLocaleString()} states`);
    console.log('');
    console.log('Packing to binary...');

    // GitHub Pages doesn't compress .bin (application/octet-stream) on the wire,
    // so we pre-gzip and decompress in the worker via DecompressionStream. ~57%
    // smaller transfer on mobile 4G. Raw .bin is NOT shipped — gzip-only path.
    for (const name of ['udPair', 'fbPair', 'sortJoint']) {
        const buf = packTable(solver._tables[name]);
        const gz = gzipSync(Buffer.from(buf), { level: 9 });
        const out = resolve(OUT_DIR, `${name}.bin.gz`);
        writeFileSync(out, gz);
        console.log(`  ${out}  ${fmtBytes(buf.byteLength)} raw → ${fmtBytes(gz.byteLength)} gzip (-${Math.round((1 - gz.byteLength / buf.byteLength) * 100)}%)`);
    }
    console.log('');
    console.log(`Done in ${Date.now() - t0} ms.`);
}

main().catch(e => {
    console.error('bake-bfs-tables failed:', e);
    process.exit(1);
});
