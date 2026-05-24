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
const MODULE_VERSION = 3;
const { ReductionSolver } = await import(`../core/solver/reduction.js?v=${MODULE_VERSION}`);
const { TEACHING_4X4 }    = await import(`../content/teaching-4x4.js?v=${MODULE_VERSION}`);

// ── 4. Construct the solver. preload() runs on first init message. ──
const solver = new ReductionSolver({ N: 4, teaching: TEACHING_4X4 });

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
            if (!initialized) {
                // 1. Try to skip BFS build by loading cached tables.
                self.postMessage({ type: 'init-progress', step: 'cache-check', percent: 5 });
                const cached = await loadCachedTables();
                if (cached) {
                    self.postMessage({ type: 'init-progress', step: 'cache-hit', percent: 60 });
                    await solver.preload({ cachedTables: cached });
                } else {
                    // First run (or cache miss). Build BFS tables, then write to IDB.
                    self.postMessage({ type: 'init-progress', step: 'centers', percent: 10 });
                    await solver.preload();
                    // Fire-and-forget save — never block init on IDB write.
                    saveCachedTables(solver._tables);
                }
                self.postMessage({ type: 'init-progress', step: 'done', percent: 100 });
                initialized = true;
            }
            self.postMessage({ id, type: 'init-done' });
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
