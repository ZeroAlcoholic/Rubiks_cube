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
const { ReductionSolver } = await import('../core/solver/reduction.js');
const { TEACHING_4X4 }    = await import('../content/teaching-4x4.js');

// ── 4. Construct the solver. preload() runs on first init message. ──
const solver = new ReductionSolver({ N: 4, teaching: TEACHING_4X4 });

// ── 5. Message dispatch ─────────────────────────────────────────────
let initialized = false;

self.onmessage = async (e) => {
    const msg = e.data || {};
    const { id, type } = msg;
    try {
        if (type === 'init') {
            if (!initialized) {
                self.postMessage({ type: 'init-progress', step: 'centers', percent: 10 });
                // Building the BFS tables takes ~3s desktop / ~10s mobile.
                // It happens here in the worker, so the main thread is free
                // to render the 3D cube and accept user input the whole time.
                await solver.preload();
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
