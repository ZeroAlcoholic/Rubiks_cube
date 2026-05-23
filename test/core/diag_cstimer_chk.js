// Diagnostic: capture cstimer's internal $fromFacelet chk codes for failing states.
// Usage: node test/core/diag_cstimer_chk.js

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { buildPerms, applyMove, applyMoves, inverseNotation } from '../../core/geometry/perms-n.js';
import { buildSolvedState } from '../../core/geometry/cube-geometry-n.js';
import { ReductionSolver } from '../../core/solver/reduction.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const root  = join(__dir, '../..');

// Capture cstimer's State Check Error logs.
const chkErrors = [];
const origLog = console.log;
const patchedLog = function(...args) {
    if (typeof args[0] === 'string' && args[0].includes('State Check Error')) {
        chkErrors.push({ chk: args[1], facelet: args[2] });
    }
    // Suppress the noisy log
};

const ctx = vm.createContext({
    Math, Date, console: { log: patchedLog, error: origLog }, setTimeout, clearTimeout, clearInterval, setInterval,
    $: { now: () => Date.now() }, DEBUG: false,
    isaac: { seed: () => {}, random: () => Math.random() },
    scrMgr: { reg: function c() { return c; }, fixCase: (_t, s) => s },
    image: { llImage: { drawImage: () => {} } },
    process,
});
vm.runInContext(readFileSync(join(root, 'vendor/cubejs-1.3.2.js'), 'utf8'), ctx);
vm.runInContext(readFileSync(join(root, 'vendor/cstimer-444.js'), 'utf8'), ctx);
globalThis.scramble_444 = ctx.scramble_444;
globalThis.Cube = ctx.Cube;

const cst = ctx.scramble_444;
cst.init();

const N = 4;
const perms = buildPerms(N);
const SOLVED = buildSolvedState(N);
const allMoves = Object.keys(perms);

function inv(moves) { return moves.slice().reverse().map(inverseNotation); }

const COORD_ROTS_24 = [
    { physMoves: [], relabel: {} },
    { physMoves: ["Uw'","Dw"],   relabel: {"F":"R","L":"F","B":"L","R":"B"} },
    { physMoves: ["Uw2","Dw2"],  relabel: {"L":"R","B":"F","R":"L","F":"B"} },
    { physMoves: ["Uw","Dw'"],   relabel: {"B":"R","R":"F","F":"L","L":"B"} },
    { physMoves: ["Rw'","Lw"],   relabel: {"B":"U","U":"F","F":"D","D":"B"} },
    { physMoves: ["Rw'","Lw","Uw'","Dw"],  relabel: {"B":"U","U":"R","L":"F","F":"D","D":"L","R":"B"} },
    { physMoves: ["Rw'","Lw","Uw2","Dw2"], relabel: {"B":"U","L":"R","D":"F","F":"D","R":"L","U":"B"} },
    { physMoves: ["Rw'","Lw","Uw","Dw'"],  relabel: {"B":"U","D":"R","R":"F","F":"D","U":"L","L":"B"} },
    { physMoves: ["Rw","Lw'"],   relabel: {"F":"U","D":"F","B":"D","U":"B"} },
    { physMoves: ["Rw","Lw'","Uw'","Dw"],  relabel: {"F":"U","D":"R","L":"F","B":"D","U":"L","R":"B"} },
    { physMoves: ["Rw","Lw'","Uw2","Dw2"], relabel: {"F":"U","L":"R","U":"F","B":"D","R":"L","D":"B"} },
    { physMoves: ["Rw","Lw'","Uw","Dw'"],  relabel: {"F":"U","U":"R","R":"F","B":"D","D":"L","L":"B"} },
    { physMoves: ["Rw2","Lw2"],  relabel: {"D":"U","B":"F","U":"D","F":"B"} },
    { physMoves: ["Rw2","Lw2","Uw'","Dw"],  relabel: {"D":"U","B":"R","L":"F","U":"D","F":"L","R":"B"} },
    { physMoves: ["Rw2","Lw2","Uw2","Dw2"], relabel: {"D":"U","L":"R","U":"D","R":"L"} },
    { physMoves: ["Rw2","Lw2","Uw","Dw'"],  relabel: {"D":"U","F":"R","R":"F","U":"D","B":"L","L":"B"} },
    { physMoves: ["Fw","Bw'"],   relabel: {"L":"U","U":"R","R":"D","D":"L"} },
    { physMoves: ["Fw'","Bw"],   relabel: {"R":"U","D":"R","L":"D","U":"L"} },
    { physMoves: ["Fw","Bw'","Uw'","Dw"],  relabel: {"L":"U","F":"R","D":"F","R":"D","B":"L","U":"B"} },
    { physMoves: ["Fw'","Bw","Uw'","Dw"],  relabel: {"R":"U","F":"R","U":"F","L":"D","B":"L","D":"B"} },
    { physMoves: ["Fw","Bw'","Uw2","Dw2"], relabel: {"L":"U","D":"R","B":"F","R":"D","U":"L","F":"B"} },
    { physMoves: ["Fw'","Bw","Uw2","Dw2"], relabel: {"R":"U","U":"R","B":"F","L":"D","D":"L","F":"B"} },
    { physMoves: ["Fw","Bw'","Uw","Dw'"],  relabel: {"L":"U","B":"R","U":"F","R":"D","F":"L","D":"B"} },
    { physMoves: ["Fw'","Bw","Uw","Dw'"],  relabel: {"R":"U","B":"R","D":"F","L":"D","F":"L","U":"B"} },
];

function coordRotate(state, physMoves, relabelMap) {
    const phys = physMoves.length ? applyMoves(perms, state, physMoves) : state;
    if (!Object.keys(relabelMap).length) return phys;
    return phys.split('').map(c => relabelMap[c] || c).join('');
}

function conjMove(move, conjMap) {
    if (!Object.keys(conjMap).length) return move;
    let suffix = '';
    let base = move;
    if (base.endsWith("'")) { suffix = "'"; base = base.slice(0, -1); }
    else if (base.endsWith('2')) { suffix = '2'; base = base.slice(0, -1); }
    return (conjMap[base] || base) + suffix;
}

function buildConj(relabel) {
    const conj = {};
    for (const [from, to] of Object.entries(relabel)) {
        conj[from] = to;
        conj[from + 'w'] = to + 'w';
    }
    return conj;
}

const solver = new ReductionSolver({ N: 4 });
await solver.preload();

const RUNS = 50;
const failures = [];

origLog(`Running ${RUNS} all-move scrambles, capturing cstimer chk codes for failures...`);

for (let t = 0; t < RUNS; t++) {
    let S = SOLVED, last = '';
    for (let i = 0; i < 25; i++) {
        let m; do { m = allMoves[Math.floor(Math.random() * allMoves.length)]; } while (m[0] === last[0]);
        S = applyMove(perms, S, m); last = m;
    }

    const centersPhase = solver._solveCenters(S);
    const CS = applyMoves(perms, S, centersPhase.moves.map(m => m.notation));

    // Try all 24 rotations, record chk codes from failures
    let solved = false;
    const perRot = [];
    for (let i = 0; i < COORD_ROTS_24.length; i++) {
        const { physMoves, relabel } = COORD_ROTS_24[i];
        const conj = buildConj(relabel);
        const rot = coordRotate(CS, physMoves, relabel);

        // Clear chkErrors before this call
        chkErrors.length = 0;
        const raw = cst.genFacelet(rot) || '';
        const tok = raw.trim().split(/\s+/).filter(Boolean);
        const sol = inv(tok).map(m => conjMove(m, conj));
        const works = (sol.length > 0 || CS === SOLVED) && applyMoves(perms, CS, sol) === SOLVED;
        perRot.push({
            rotIdx: i,
            chk: chkErrors[0]?.chk ?? 0,
            tokensLen: tok.length,
            works,
        });
        if (works) { solved = true; break; }
    }

    if (!solved) {
        failures.push({ t, CS, perRot });
    }
}

origLog(`\n=== ${failures.length}/${RUNS} failed all 24 rotations ===\n`);
for (const f of failures.slice(0, 3)) {
    origLog(`\nFailure #${f.t}:`);
    origLog(`  CS=${f.CS}`);
    origLog(`  Per-rotation chk codes (24 entries):`);
    // chk decoding: bit 1 = cpMask!=0xff, bit 2 = coSum%3!=0, bit 4 = ctMask!=0x444444, bit 8 = edMask!=0xffffff
    const chkDecode = (chk) => {
        const parts = [];
        if (chk & 1) parts.push('cp');
        if (chk & 2) parts.push('co');
        if (chk & 4) parts.push('ct');
        if (chk & 8) parts.push('ed');
        return parts.length === 0 ? 'OK' : parts.join('+');
    };
    for (const r of f.perRot) {
        origLog(`    rot ${String(r.rotIdx).padStart(2)}: chk=${String(r.chk).padStart(2)} (${chkDecode(r.chk)}), tokens=${r.tokensLen}, works=${r.works}`);
    }
}
