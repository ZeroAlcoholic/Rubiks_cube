// 4×4 solver worker — owns the ENTIRE solve pipeline (Centers BFS +
// cstimer edges/parity + cubejs Kociemba 3×3). Main thread becomes a thin
// proxy, never touching the heavy lookup tables or running blocking work.
//
// Module worker (`type: 'module'`) so we can `import` reduction.js and the
// teaching content directly. Vendor JS (cubejs, cstimer) ships as classic
// scripts, so we use a tiny indirect-eval trick to populate them onto the
// worker's global self.
//
// Communication protocol:
//   inbound  { id, type: 'init' }
//            { id, type: 'solve', state: string(96) }
//   outbound { id, type: 'init-done' }
//            { id, type: 'init-progress', step: string, percent: number }   // broadcast (no id)
//            { id, type: 'solve-progress', phase: string, ... }             // broadcast (no id)
//            { id, type: 'result', phases, totalMoves, telemetry }
//            { id, type: 'error',  error: string }

// ── 1. csTimer host-global stubs (must exist before vendor evaluation) ──
self.$       = { now: () => Date.now(), isArray: (a) => Array.isArray(a) };
self.DEBUG   = false;
self.scrMgr  = { reg: function c() { return c; }, fixCase: (_t, s) => s };
self.image   = { llImage: { drawImage: () => {} } };
self.isaac   = { seed: () => {}, random: () => Math.random() };

// ── 2. Load classic-script vendor into the worker's global scope ────
// Module workers don't support importScripts(), and these vendor bundles
// are pre-modular IIFE classics that publish `var scramble_444 = ...`
// at top level. In a module worker, both indirect eval and dynamic Function
// run in their own scope (strict mode), so `var foo` doesn't auto-attach
// to self. We append explicit `self.foo = foo` lines to bridge.
async function loadClassic(url, exportNames) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`failed to fetch ${url}: ${res.status}`);
    const src = await res.text();
    const bridge = exportNames.map(n =>
        `if (typeof ${n} !== 'undefined') self.${n} = ${n};`
    ).join('\n');
    new Function(src + ';\n' + bridge).call(self);
}
await loadClassic('../vendor/cubejs-1.3.2.js', ['Cube']);
await loadClassic('../vendor/cstimer-444.js', ['scramble_444', 'mathlib']);

// ── 3. Import the modular solver and teaching content ──────────────
// Bump the version query when reduction.js / teaching-4x4.js change so the
// browser module cache (which workers share across page loads) re-fetches.
// Without this, an old in-memory module can keep running even after the
// underlying file changes — a classic dev-time gotcha but also relevant in
// production immediately after a deploy.
const MODULE_VERSION = 4;
const { createSolver, SOLVER_VARIANTS } = await import(`../core/solver/solver-registry.js?v=${MODULE_VERSION}`);
const { TEACHING_4X4 }                  = await import(`../content/teaching-4x4.js?v=${MODULE_VERSION}`);

// ── 4. Solver lifecycle —— may swap variants on subsequent init messages.
//
// Strategy: keep the current solver instance + its preload promise on
// module-scope. When the host sends init({variant}) for a NEW variant, we
// build a fresh instance but PASS THROUGH the existing baked tables so we
// don't re-fetch or re-build BFS data — only the post-centers strategy
// (cstimer vs cubejs vs Yau wrapper) changes.
let solver = await createSolver('fast', { teaching: TEACHING_4X4 });
let currentVariant = 'fast';
// Shared cache of BFS tables. After first init, every variant reuses these
// instead of touching IDB / network / BFS again.
let sharedCachedTables = null;

// ── 5. IndexedDB cache for BFS lookup tables ────────────────────────
// The Centers BFS build is deterministic for a fixed reduction.js code
// path, so we persist the resulting tables to IndexedDB on first run and
// re-use them on subsequent visits. Bump TABLE_VERSION when reduction.js
// changes the key encoding or table contents in a way that invalidates
// previously cached data.
const IDB_NAME = 'rubiks-bfs-cache';
const IDB_VERSION = 1;
const TABLE_VERSION = 1;
const TABLE_NAMES = ['udPair', 'fbPair', 'sortJoint'];

function openCacheDB() {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('indexedDB unavailable in this worker context'));
            return;
        }
        const req = indexedDB.open(IDB_NAME, IDB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('tables')) {
                db.createObjectStore('tables', { keyPath: 'name' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
    });
}

// Serialize each Map<bitmask, {pk, move}> into three parallel typed arrays
// for compact storage and fast structured-clone copy through IDB.
function serializeTable(map) {
    const size = map.size;
    const keys  = new Uint32Array(size);
    const pks   = new Uint32Array(size);
    const moves = new Array(size);
    let i = 0;
    for (const [k, v] of map) {
        keys[i]  = k;
        // pk === null marks the BFS root; use 0xFFFFFFFF as sentinel
        pks[i]   = v.pk == null ? 0xFFFFFFFF : v.pk;
        moves[i] = v.move == null ? '' : v.move;
        i++;
    }
    return { keys, pks, moves };
}

function deserializeTable({ keys, pks, moves }) {
    const map = new Map();
    for (let i = 0; i < keys.length; i++) {
        const pk = pks[i] === 0xFFFFFFFF ? null : pks[i];
        const move = moves[i] === '' ? null : moves[i];
        map.set(keys[i], { pk, move });
    }
    return map;
}

async function loadCachedTables() {
    let db;
    try { db = await openCacheDB(); }
    catch (e) { console.log('[solver-worker] IDB open failed:', e?.message); return null; }
    try {
        const rows = await new Promise((resolve, reject) => {
            const tx = db.transaction('tables', 'readonly');
            const req = tx.objectStore('tables').getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror   = () => reject(req.error);
        });
        console.log('[solver-worker] IDB rows found:', rows.length, rows.map(r => `${r.name}@v${r.version}(${r.keys?.length})`));
        const byName = new Map(rows.map(r => [r.name, r]));
        for (const name of TABLE_NAMES) {
            const row = byName.get(name);
            if (!row) { console.log('[solver-worker] cache miss: no row for', name); return null; }
            if (row.version !== TABLE_VERSION) { console.log('[solver-worker] cache miss: version mismatch', name, row.version); return null; }
        }
        const tables = {};
        for (const name of TABLE_NAMES) {
            tables[name] = deserializeTable(byName.get(name));
        }
        console.log('[solver-worker] cache HIT — all 3 tables loaded');
        return tables;
    } catch (e) {
        console.warn('[solver-worker] IDB read failed:', e);
        return null;
    } finally {
        db.close();
    }
}

// ── 5b. Fetch pre-baked BFS tables from static .bin.gz files ────────
//
// Format: see tools/bake-bfs-tables.js — packed Uint32Array(keys) + Uint32Array(pks)
// + Uint8Array(moveIdxs) with a move-string dictionary header. Gzipped so the
// transfer is ~4 MB instead of ~9 MB on GitHub Pages (which doesn't compress
// .bin on the wire). DecompressionStream decompresses streaming with no extra
// JS dependency.
//
// Sentinels match the IDB serialization above: pk === 0xFFFFFFFF means root,
// moveIdx === 0xFF means "no move attached" (only true for the root).
//
// All three fetches happen in parallel — total wall time is bounded by the
// largest table (~3 MB gzipped) and the slowest deserialize loop (~100 ms).
const BAKED_MAGIC = 0x52424653; // "RBFS"
const BAKED_FORMAT_VERSION = 1;
const BAKED_URL = (name) => `../vendor/bfs-tables/${name}.bin.gz`;

function parseBakedTable(buffer, tableName) {
    const view = new DataView(buffer);
    const magic = view.getUint32(0, true);
    if (magic !== BAKED_MAGIC) {
        throw new Error(`${tableName}: bad magic 0x${magic.toString(16)} (expected 0x${BAKED_MAGIC.toString(16)})`);
    }
    const version = view.getUint32(4, true);
    if (version !== BAKED_FORMAT_VERSION) {
        throw new Error(`${tableName}: unsupported format version ${version}`);
    }
    const numEntries = view.getUint32(8, true);
    const numMoves   = view.getUint32(12, true);

    // Move dictionary — 4-byte null-padded ASCII slots.
    const dec = new TextDecoder();
    const moves = new Array(numMoves);
    for (let i = 0; i < numMoves; i++) {
        const slot = new Uint8Array(buffer, 16 + i * 4, 4);
        let end = 4;
        while (end > 0 && slot[end - 1] === 0) end--;
        moves[i] = dec.decode(slot.subarray(0, end));
    }

    // Typed-array views over the rest of the buffer.
    const dictBytes = numMoves * 4;
    const keys     = new Uint32Array(buffer, 16 + dictBytes,                          numEntries);
    const pks      = new Uint32Array(buffer, 16 + dictBytes + numEntries * 4,         numEntries);
    const moveIdxs = new Uint8Array (buffer, 16 + dictBytes + numEntries * 8,         numEntries);

    const map = new Map();
    for (let i = 0; i < numEntries; i++) {
        const pk = pks[i] === 0xFFFFFFFF ? null : pks[i];
        const moveIdx = moveIdxs[i];
        const move = moveIdx === 0xFF ? null : moves[moveIdx];
        map.set(keys[i], { pk, move });
    }
    return map;
}

async function fetchAndDecompress(url) {
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) throw new Error(`fetch ${url}: HTTP ${res.status}`);
    // DecompressionStream is Chrome 80+ / Safari 16.4+ / Firefox 113+. If the
    // browser is older, caller catches the ReferenceError / TypeError and
    // falls back to the BFS build path.
    const ds = new DecompressionStream('gzip');
    const stream = res.body.pipeThrough(ds);
    return await new Response(stream).arrayBuffer();
}

async function loadBakedTables() {
    if (typeof DecompressionStream === 'undefined') {
        console.log('[solver-worker] DecompressionStream unsupported — skipping baked fetch');
        return null;
    }
    try {
        const t0 = Date.now();
        const buffers = await Promise.all(TABLE_NAMES.map(n => fetchAndDecompress(BAKED_URL(n))));
        const fetchMs = Date.now() - t0;
        const tables = {};
        for (let i = 0; i < TABLE_NAMES.length; i++) {
            tables[TABLE_NAMES[i]] = parseBakedTable(buffers[i], TABLE_NAMES[i]);
        }
        console.log(`[solver-worker] baked tables loaded in ${fetchMs} ms — udPair:${tables.udPair.size} fbPair:${tables.fbPair.size} sortJoint:${tables.sortJoint.size}`);
        return tables;
    } catch (e) {
        console.log('[solver-worker] baked fetch failed, will build fresh:', e?.message || e);
        return null;
    }
}

async function saveCachedTables(tables) {
    let db;
    try { db = await openCacheDB(); }
    catch (e) { return; /* silently no-cache */ }
    try {
        await new Promise((resolve, reject) => {
            const tx = db.transaction('tables', 'readwrite');
            for (const name of TABLE_NAMES) {
                const ser = serializeTable(tables[name]);
                tx.objectStore('tables').put({ name, version: TABLE_VERSION, ...ser });
            }
            tx.oncomplete = () => resolve();
            tx.onerror    = () => reject(tx.error);
        });
    } catch (e) {
        console.warn('[solver-worker] IDB write failed (quota? private mode?):', e);
    } finally {
        db.close();
    }
}

// ── 6. Message dispatch ─────────────────────────────────────────────
let initialized = false;

self.onmessage = async (e) => {
    const msg = e.data || {};
    const { id, type } = msg;
    try {
        if (type === 'init') {
            // The host may send init({variant}) to switch to a different solver
            // (e.g. 'fast-kociemba', 'yau-teach'). If the variant differs from
            // the current one, rebuild the solver instance — but pass through
            // the shared BFS tables so we never re-do the expensive table load.
            const requestedVariant = (msg.variant && SOLVER_VARIANTS[msg.variant])
                ? msg.variant : 'fast';

            if (!initialized) {
                // First-time init: three-tier table loading.
                //   1. IDB cache hit       — returning user, ~50-300 ms
                //   2. Baked tables fetch  — new user (SW cache hit ~100 ms;
                //                             cold network ~3-6 s on 4G)
                //   3. Fresh BFS build     — fallback for older browsers
                //                             (no DecompressionStream) or any
                //                             fetch/parse failure; 3-10 s CPU
                self.postMessage({ type: 'init-progress', step: 'cache-check', percent: 5 });
                let cached = await loadCachedTables();
                let source = cached ? 'idb' : null;

                if (!cached) {
                    self.postMessage({ type: 'init-progress', step: 'baked-fetch', percent: 15 });
                    cached = await loadBakedTables();
                    if (cached) source = 'baked';
                }

                if (cached) {
                    self.postMessage({ type: 'init-progress', step: source === 'idb' ? 'cache-hit' : 'baked-hit', percent: 70 });
                    sharedCachedTables = cached;
                    await solver.preload({ cachedTables: cached });
                    if (source === 'baked') saveCachedTables(cached);
                } else {
                    self.postMessage({ type: 'init-progress', step: 'centers', percent: 20 });
                    await solver.preload();
                    sharedCachedTables = solver._tables;
                    saveCachedTables(sharedCachedTables);
                }
                self.postMessage({ type: 'init-progress', step: 'done', percent: 100 });
                initialized = true;
            }

            // Variant switch (may happen on first init OR later). If the
            // requested variant differs from what we currently have, rebuild.
            // The new instance reuses sharedCachedTables so this is ~10 ms,
            // not a re-init of the heavy lookup tables.
            if (requestedVariant !== currentVariant) {
                self.postMessage({ type: 'init-progress', step: 'variant-swap', percent: 100, variant: requestedVariant });
                solver = await createSolver(requestedVariant, { teaching: TEACHING_4X4 });
                currentVariant = requestedVariant;
                if (sharedCachedTables) await solver.preload({ cachedTables: sharedCachedTables });
            }

            self.postMessage({ id, type: 'init-done', variant: currentVariant });
            return;
        }
        if (type === 'solve') {
            if (!initialized) throw new Error('solver-worker: solve called before init');
            const result = await solver.solve(msg.state, {
                onStatus: (event, data) => {
                    if (event === 'phase-start') {
                        self.postMessage({ type: 'solve-progress', phase: 'phase-start', name: data.name });
                    }
                },
                onProgress: (info) => {
                    self.postMessage({ type: 'solve-progress', phase: 'rotation', ...info });
                },
            });
            // Plain-cloneable subset — drop teachingNote, displayName, and
            // anything else the host might tack on; main thread can repopulate
            // from content/teaching-4x4.js if it ever needs them.
            const phases = result.phases.map(p => ({
                name: p.name,
                displayName: p.displayName,
                moves: p.moves.map(m => ({ notation: m.notation, phaseName: m.phaseName || p.name })),
                teachingNote: p.teachingNote || null,
            }));
            self.postMessage({
                id, type: 'result',
                phases,
                totalMoves: result.totalMoves,
                telemetry: result.telemetry || null,
            });
            return;
        }
        throw new Error(`solver-worker: unknown message type "${type}"`);
    } catch (err) {
        self.postMessage({ id, type: 'error', error: err?.message || String(err) });
    }
};

// Signal that the worker is fully bootstrapped (vendor loaded, solver created).
// Main thread uses this to know when it's safe to send 'init'.
self.postMessage({ type: 'boot-ready' });
