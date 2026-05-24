// cstimer 4×4 Worker — classic Web Worker that owns one cstimer instance
// and answers genFacelet requests by postMessage. The main thread stays
// responsive during cstimer's synchronous IDA* search (30 ms – 3 s per call)
// because that work happens on a separate event loop here.
//
// Communication protocol (string-only payloads, no Transferable needed):
//   inbound  { id: string, type: 'init' }
//            { id: string, type: 'genFacelet', state: string(96) }
//   outbound { id: string, type: 'init-done' }
//            { id: string, type: 'result',     result: string }   // raw move list, may be ''
//            { id: string, type: 'error',      error:  string }
//
// Why classic Worker + importScripts:
//   The vendor bundles (cstimer-444.js, cubejs-1.3.2.js) are pre-modular IIFE
//   globals (`var scramble_444`, `var Cube`). importScripts gives them the
//   `self` global they expect; a module worker can't `import` them because
//   they have no `export`. The trade-off is no `import.meta.url`, so paths
//   are resolved relative to the worker file's own URL.

'use strict';

// csTimer's source expects various host globals; stub the ones it touches.
// `$.isArray` is used during pruning-table construction in some code paths even
// though our happy-path solves don't hit it; we add it defensively so a future
// cstimer update or a different state shape doesn't surprise us.
self.$       = { now: () => Date.now(), isArray: (a) => Array.isArray(a) };
self.DEBUG   = false;
self.scrMgr  = { reg: function c() { return c; }, fixCase: (_t, s) => s };
self.image   = { llImage: { drawImage: () => {} } };
self.isaac   = { seed: () => {}, random: () => Math.random() };

// Load Cube (3×3 Kociemba) first — cstimer-444 shims into it for the 3×3 tail.
importScripts(
    '../vendor/cubejs-1.3.2.js',
    '../vendor/cstimer-444.js',
);

let initialized = false;

self.onmessage = (e) => {
    const msg = e.data || {};
    const { id, type } = msg;
    try {
        if (type === 'init') {
            if (!initialized) {
                // Both inits are synchronous in the worker thread — we can only
                // emit phase markers (start/done), not fine-grained %. The host
                // uses these to update the loading overlay text.
                self.postMessage({ type: 'init-progress', step: 'cubejs', percent: 30 });
                if (typeof Cube !== 'undefined' && typeof Cube.initSolver === 'function') {
                    Cube.initSolver();  // cubejs ~12M Kociemba pruning tables
                }
                self.postMessage({ type: 'init-progress', step: 'cstimer', percent: 70 });
                if (typeof scramble_444 !== 'undefined' && typeof scramble_444.init === 'function') {
                    scramble_444.init();  // cstimer 4×4 internal pruning tables
                }
                self.postMessage({ type: 'init-progress', step: 'done', percent: 100 });
                initialized = true;
            }
            self.postMessage({ id, type: 'init-done' });
            return;
        }

        if (type === 'genFacelet') {
            if (!initialized) {
                throw new Error('cstimer-worker: init must be called before genFacelet');
            }
            const result = scramble_444.genFacelet(msg.state) || '';
            self.postMessage({ id, type: 'result', result });
            return;
        }

        throw new Error(`cstimer-worker: unknown message type "${type}"`);
    } catch (err) {
        self.postMessage({ id, type: 'error', error: err && err.message || String(err) });
    }
};
