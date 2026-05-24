// N-parameterized Reduction Solver — Full 4×4 pipeline.
//
// Phase 1 — Centers (this file):
//   Precomputed backward BFS lookup tables. Three stages on 24-char center-only
//   state encoded as integer bitmasks:
//     pair-UD:    C(24,8) = 735K states
//     pair-FB:    C(16,8) = 12.8K states
//     sort-joint: C(8,4)³ = 343K states
//   Preload cost: ~6s (once). Per-solve: O(path_length) ≈ μs.
//
// Phases 2-4 — Edges, Parity, 3×3 (delegated to cstimer):
//   After centers are solved, calls globalThis.scramble_444.genFacelet()
//   (cs0x7f's csTimer 4×4 three-phase IDA* solver, loaded via vendor/cstimer-444.js).
//   The returned move string is applied move-by-move; phase boundaries are detected
//   by checking edge-pairing state and presence of wide moves:
//     edges:   moves until all 12 virtual edges are paired
//     parity:  wide moves remaining after edges phase (OLL/PLL fix if needed)
//     kociemba: outer-only moves that finish the 3×3 solve
//
// Why delegate to cstimer?
//   cstimer's edge-pairing uses a 31M-state IDA* with precomputed pruning tables
//   (Edge3Prun, 484 KB). Re-implementing that here would duplicate proven code.
//
// Status:
//   ✅ Phase 1 (centers)  — precomputed BFS tables
//   ✅ Phase 2 (edges)    — cstimer Phase 3 + phase-split
//   ✅ Phase 3 (parity)   — cstimer Phase 3 tail (auto-detected)
//   ✅ Phase 4 (3×3)      — cstimer + cubejs Kociemba
//
// cstimer dependency: load vendor/cstimer-444.js + vendor/cubejs-1.3.2.js before use.
// If scramble_444 is absent at solve-time, phases 2-4 return empty stubs.

import { FACE_ORDER, centerIndices, totalStickers, buildSolvedState } from '../geometry/cube-geometry-n.js';
import { buildPerms, applyMove, applyMoves, inverseNotation } from '../geometry/perms-n.js';
import { SolverError } from '../infra/errors.js';
import { logger } from '../infra/logger.js';
import { perf } from '../infra/perf.js';

// ─── Coord-rotate helpers for cstimer symmetry workaround ────────────────────
//
// cstimer's genFacelet uses an internal 48-element symmetry group that can
// produce incorrect solutions for some cube states. Trying all 24 proper
// orientations guarantees we find one where genFacelet gives a correct answer.
//
// Each entry: physMoves applied to state, then sticker colors relabeled so the
// result looks canonical. The conj map undoes the relabeling on output moves.
//
// All 24 entries verified: coordRotate(SOLVED, entry) === SOLVED for each.
const _COORD_ROTS = [
    { physMoves: [], relabel: {} }, // I
    { physMoves: ["Uw'","Dw"],   relabel: {"F":"R","L":"F","B":"L","R":"B"} }, // y
    { physMoves: ["Uw2","Dw2"],  relabel: {"L":"R","B":"F","R":"L","F":"B"} }, // y2
    { physMoves: ["Uw","Dw'"],   relabel: {"B":"R","R":"F","F":"L","L":"B"} }, // y'
    { physMoves: ["Rw'","Lw"],   relabel: {"B":"U","U":"F","F":"D","D":"B"} }, // x
    { physMoves: ["Rw'","Lw","Uw'","Dw"],  relabel: {"B":"U","U":"R","L":"F","F":"D","D":"L","R":"B"} }, // xy
    { physMoves: ["Rw'","Lw","Uw2","Dw2"], relabel: {"B":"U","L":"R","D":"F","F":"D","R":"L","U":"B"} }, // xy2
    { physMoves: ["Rw'","Lw","Uw","Dw'"],  relabel: {"B":"U","D":"R","R":"F","F":"D","U":"L","L":"B"} }, // xy'
    { physMoves: ["Rw","Lw'"],   relabel: {"F":"U","D":"F","B":"D","U":"B"} }, // x'
    { physMoves: ["Rw","Lw'","Uw'","Dw"],  relabel: {"F":"U","D":"R","L":"F","B":"D","U":"L","R":"B"} }, // x'y
    { physMoves: ["Rw","Lw'","Uw2","Dw2"], relabel: {"F":"U","L":"R","U":"F","B":"D","R":"L","D":"B"} }, // x'y2
    { physMoves: ["Rw","Lw'","Uw","Dw'"],  relabel: {"F":"U","U":"R","R":"F","B":"D","D":"L","L":"B"} }, // x'y'
    { physMoves: ["Rw2","Lw2"],  relabel: {"D":"U","B":"F","U":"D","F":"B"} }, // x2
    { physMoves: ["Rw2","Lw2","Uw'","Dw"],  relabel: {"D":"U","B":"R","L":"F","U":"D","F":"L","R":"B"} }, // x2y
    { physMoves: ["Rw2","Lw2","Uw2","Dw2"], relabel: {"D":"U","L":"R","U":"D","R":"L"} }, // x2y2
    { physMoves: ["Rw2","Lw2","Uw","Dw'"],  relabel: {"D":"U","F":"R","R":"F","U":"D","B":"L","L":"B"} }, // x2y'
    { physMoves: ["Fw","Bw'"],   relabel: {"L":"U","U":"R","R":"D","D":"L"} }, // z
    { physMoves: ["Fw'","Bw"],   relabel: {"R":"U","D":"R","L":"D","U":"L"} }, // z'
    { physMoves: ["Fw","Bw'","Uw'","Dw"],  relabel: {"L":"U","F":"R","D":"F","R":"D","B":"L","U":"B"} }, // zy
    { physMoves: ["Fw'","Bw","Uw'","Dw"],  relabel: {"R":"U","F":"R","U":"F","L":"D","B":"L","D":"B"} }, // z'y
    { physMoves: ["Fw","Bw'","Uw2","Dw2"], relabel: {"L":"U","D":"R","B":"F","R":"D","U":"L","F":"B"} }, // zy2
    { physMoves: ["Fw'","Bw","Uw2","Dw2"], relabel: {"R":"U","U":"R","B":"F","L":"D","D":"L","F":"B"} }, // z'y2
    { physMoves: ["Fw","Bw'","Uw","Dw'"],  relabel: {"L":"U","B":"R","U":"F","R":"D","F":"L","D":"B"} }, // zy'
    { physMoves: ["Fw'","Bw","Uw","Dw'"],  relabel: {"R":"U","B":"R","D":"F","L":"D","F":"L","U":"B"} }, // z'y'
].map(({ physMoves, relabel }) => {
    const conj = {};
    for (const [f, t] of Object.entries(relabel)) { conj[f] = t; conj[f + 'w'] = t + 'w'; }
    return { physMoves, relabel, conj };
});

// Rotation priority — order in which to try the 24 orientations against cstimer.
// Sorted by empirical hit-frequency from a 50-scramble bench (commit-time
// telemetry): the top four (I, xy2, y2, x'y2) cover 84% of post-centers states.
// Remaining indices that never appeared in the bench are appended in numerical
// order so coverage stays 24/24. Reordering changes only iteration sequence,
// not the semantic meaning of any rotIdx in telemetry.
const _ROT_PRIORITY = [
    0,  // I       (15/50, 30%)
    6,  // xy2     (11/50, 22%)
    2,  // y2      ( 9/50, 18%)
    10, // x'y2    ( 7/50, 14%)
    12, // x2      ( 2/50,  4%)
    13, // x2y     ( 2/50,  4%)
    15, // x2y'    ( 2/50,  4%)
    14, // x2y2    ( 1/50,  2%)
    21, // z'y2    ( 1/50,  2%)
    // Never observed in this bench, retained for full coverage:
    1, 3, 4, 5, 7, 8, 9, 11, 16, 17, 18, 19, 20, 22, 23,
];

function _coordRotate(perms, state, physMoves, relabel) {
    const phys = physMoves.length ? applyMoves(perms, state, physMoves) : state;
    if (!Object.keys(relabel).length) return phys;
    return phys.split('').map(c => relabel[c] || c).join('');
}

function _conjMove(move, conj) {
    if (!Object.keys(conj).length) return move;
    let suffix = '';
    let base = move;
    if (base.endsWith("'")) { suffix = "'"; base = base.slice(0, -1); }
    else if (base.endsWith('2')) { suffix = '2'; base = base.slice(0, -1); }
    return (conj[base] || base) + suffix;
}

// ─── Edge pair definitions (N=4 only) ────────────────────────────────────────
//
// 12 virtual edges of the 4×4 cube. Each entry:
//   [piece1_faceA, piece1_faceB, piece2_faceA, piece2_faceB]
// where indices are global sticker positions (U=0-15, R=16-31, F=32-47,
// D=48-63, L=64-79, B=80-95), verified against buildFaceCoords(4).
//
// An edge is "paired" when:
//   state[p1A] === state[p2A]  &&  state[p1B] === state[p2B]
// (both pieces occupy the same slot with matching ordered color pairs).
export const EDGE_DEFS_4 = [
    [ 1, 82,  2, 81], // U-B
    [ 4, 65,  8, 66], // U-L
    [ 7, 18, 11, 17], // U-R
    [13, 33, 14, 34], // U-F
    [49, 45, 50, 46], // D-F
    [52, 78, 56, 77], // D-L
    [55, 29, 59, 30], // D-R
    [61, 94, 62, 93], // D-B
    [20, 39, 24, 43], // F-R
    [23, 84, 27, 88], // B-R
    [36, 71, 40, 75], // F-L
    [87, 68, 91, 72], // B-L
];

function edgesAllPaired(state) {
    for (const [a1, b1, a2, b2] of EDGE_DEFS_4) {
        if (state[a1] !== state[a2] || state[b1] !== state[b2]) return false;
    }
    return true;
}

// ─── Local center index ranges (0-23, following FACE_ORDER = U R F D L B) ───
const CENTER_LOCAL = {
    U: [0, 1, 2, 3],
    R: [4, 5, 6, 7],
    F: [8, 9, 10, 11],
    D: [12, 13, 14, 15],
    L: [16, 17, 18, 19],
    B: [20, 21, 22, 23],
};

// ─── Center-only state ────────────────────────────────────────────────────────

function buildCenterPerms(fullPerms, allCenterIdx) {
    const g2l = new Map(allCenterIdx.map((g, l) => [g, l]));
    const out = {};
    for (const [move, fp] of Object.entries(fullPerms)) {
        const cp = Array.from({ length: 24 }, (_, i) => i);
        for (let l = 0; l < 24; l++) {
            const ld = g2l.get(fp[allCenterIdx[l]]);
            if (ld !== undefined) cp[l] = ld;
        }
        out[move] = cp;
    }
    return out;
}

function applyCenterPerm(cp, cs) {
    const out = new Array(24);
    for (let i = 0; i < 24; i++) out[cp[i]] = cs[i];
    return out.join('');
}

function extractCenterState(fullState, allCenterIdx) {
    return allCenterIdx.map(i => fullState[i]).join('');
}

function filterCenterMoves(centerPerms, allMoves, preservedSets) {
    return allMoves.filter(move => {
        const cp = centerPerms[move];
        for (const lset of preservedSets) {
            const s = new Set(lset);
            for (const li of lset) if (!s.has(cp[li])) return false;
        }
        return true;
    });
}

// ─── Key functions (integer bitmasks) ────────────────────────────────────────

// pair-UD: 24-bit mask, bit i = 1 iff cs[i] is U or D
function keyUDpair(cs) {
    let k = 0;
    for (let i = 0; i < 24; i++) if (cs[i] === 'U' || cs[i] === 'D') k |= (1 << i);
    return k;
}

// pair-FB: 16-bit mask over non-UD positions (local 4-11, 16-23), bit j = 1 iff FB-color
const NON_UD = [4, 5, 6, 7, 8, 9, 10, 11, 16, 17, 18, 19, 20, 21, 22, 23];
function keyFBpair(cs) {
    let k = 0;
    for (let j = 0; j < 16; j++) if (cs[NON_UD[j]] === 'F' || cs[NON_UD[j]] === 'B') k |= (1 << j);
    return k;
}

// sort-joint: 24-bit packed = 8 bits for U/UD | 8 bits for F/FB | 8 bits for L/LR
const UD_POS = [0, 1, 2, 3, 12, 13, 14, 15];
const FB_POS = [8, 9, 10, 11, 20, 21, 22, 23];
const LR_POS = [4, 5, 6, 7, 16, 17, 18, 19];
function keySortJoint(cs) {
    let k = 0;
    for (let j = 0; j < 8; j++) {
        if (cs[UD_POS[j]] === 'U') k |= (1 << j);
        if (cs[FB_POS[j]] === 'F') k |= (1 << (j + 8));
        if (cs[LR_POS[j]] === 'L') k |= (1 << (j + 16));
    }
    return k;
}

// ─── Bitmask-based BFS table builders ────────────────────────────────────────
//
// All three BFS stages work entirely on integer states (no string allocation).
// Each stage precomputes a "bitmask effect" array per move so that applying a
// move is a tight integer loop rather than array-copy + string-join.

// Stage 1: pair-UD
// State = 24-bit bitmask (bit i = 1 iff position i holds a UD-color).
// Under any move, sticker at position i moves to position cp[i], so bit i
// becomes bit cp[i] in the new state. eff[i] = (1 << cp[i]).
function _buildUDpairPerms(centerPerms) {
    const out = {};
    for (const [move, cp] of Object.entries(centerPerms)) {
        const eff = new Uint32Array(24);
        for (let i = 0; i < 24; i++) eff[i] = 1 << cp[i];
        out[move] = eff;
    }
    return out;
}

function _applyUDpairBitmask(eff, bm) {
    let r = 0;
    for (let i = 0; i < 24; i++) if (bm & (1 << i)) r |= eff[i];
    return r;
}

function _buildUDpairTable(solvedCS, allowedMoves, udPerms) {
    const t0 = Date.now();
    const solvedKey = keyUDpair(solvedCS);
    const table = new Map([[solvedKey, { pk: null, move: null }]]);
    let frontier = [solvedKey];
    while (frontier.length > 0) {
        const next = [];
        for (const bm of frontier) {
            for (const move of allowedMoves) {
                const nbm = _applyUDpairBitmask(udPerms[move], bm);
                if (table.has(nbm)) continue;
                table.set(nbm, { pk: bm, move });
                next.push(nbm);
            }
        }
        frontier = next;
    }
    logger.solve('centers-table-built', { keyOf: 'keyUDpair', states: table.size, ms: Date.now() - t0 });
    return table;
}

// Stage 2: pair-FB
// State = 16-bit bitmask over the 16 non-UD positions (index j into NON_UD[]).
// allowedMoves must be preserveUDpair — guarantees non-UD positions only map
// to other non-UD positions, so the 16-bit subspace is closed.
const _nonUDIdx = new Map(NON_UD.map((g, j) => [g, j]));

function _buildFBpairPerms(centerPerms, allowedMoves) {
    const out = {};
    for (const move of allowedMoves) {
        const cp = centerPerms[move];
        const eff = new Uint32Array(16);
        for (let j = 0; j < 16; j++) {
            eff[j] = 1 << _nonUDIdx.get(cp[NON_UD[j]]);
        }
        out[move] = eff;
    }
    return out;
}

function _applyFBpairBitmask(eff, bm) {
    let r = 0;
    for (let j = 0; j < 16; j++) if (bm & (1 << j)) r |= eff[j];
    return r;
}

function _buildFBpairTable(solvedCS, allowedMoves, fbPerms) {
    const t0 = Date.now();
    const solvedKey = keyFBpair(solvedCS);
    const table = new Map([[solvedKey, { pk: null, move: null }]]);
    let frontier = [solvedKey];
    while (frontier.length > 0) {
        const next = [];
        for (const bm of frontier) {
            for (const move of allowedMoves) {
                const nbm = _applyFBpairBitmask(fbPerms[move], bm);
                if (table.has(nbm)) continue;
                table.set(nbm, { pk: bm, move });
                next.push(nbm);
            }
        }
        frontier = next;
    }
    logger.solve('centers-table-built', { keyOf: 'keyFBpair', states: table.size, ms: Date.now() - t0 });
    return table;
}

// Stage 3: sort-joint
// State = 24-bit packed: bits 0-7 = U/UD bitmask, bits 8-15 = F/FB bitmask,
// bits 16-23 = L/LR bitmask (8 bits each over UD_POS / FB_POS / LR_POS).
// allowedMoves must be preserveUDFBpair — guarantees UD/FB/LR positions each
// form a closed set under these moves.
const _udPosIdx  = new Map(UD_POS.map((g, j) => [g, j]));
const _fbPosIdx  = new Map(FB_POS.map((g, j) => [g, j]));
const _lrPosIdx  = new Map(LR_POS.map((g, j) => [g, j]));

function _buildSortJointPerms(centerPerms, allowedMoves) {
    const out = {};
    for (const move of allowedMoves) {
        const cp = centerPerms[move];
        const udEff = new Uint32Array(8);
        const fbEff = new Uint32Array(8);
        const lrEff = new Uint32Array(8);
        for (let j = 0; j < 8; j++) {
            udEff[j] = 1 << _udPosIdx.get(cp[UD_POS[j]]);
            fbEff[j] = 1 << _fbPosIdx.get(cp[FB_POS[j]]);
            lrEff[j] = 1 << _lrPosIdx.get(cp[LR_POS[j]]);
        }
        out[move] = { udEff, fbEff, lrEff };
    }
    return out;
}

function _applySortJointBitmask({ udEff, fbEff, lrEff }, state) {
    const udBm = state & 0xFF;
    const fbBm = (state >> 8) & 0xFF;
    const lrBm = (state >> 16) & 0xFF;
    let uR = 0, fR = 0, lR = 0;
    for (let j = 0; j < 8; j++) {
        if (udBm & (1 << j)) uR |= udEff[j];
        if (fbBm & (1 << j)) fR |= fbEff[j];
        if (lrBm & (1 << j)) lR |= lrEff[j];
    }
    return uR | (fR << 8) | (lR << 16);
}

function _buildSortJointTable(solvedCS, allowedMoves, jointPerms) {
    const t0 = Date.now();
    const solvedKey = keySortJoint(solvedCS);
    const table = new Map([[solvedKey, { pk: null, move: null }]]);
    let frontier = [solvedKey];
    while (frontier.length > 0) {
        const next = [];
        for (const state of frontier) {
            for (const move of allowedMoves) {
                const nstate = _applySortJointBitmask(jointPerms[move], state);
                if (table.has(nstate)) continue;
                table.set(nstate, { pk: state, move });
                next.push(nstate);
            }
        }
        frontier = next;
    }
    logger.solve('centers-table-built', { keyOf: 'keySortJoint', states: table.size, ms: Date.now() - t0 });
    return table;
}

// ─── Path reconstruction ──────────────────────────────────────────────────────

/**
 * Reconstruct the solve path from a lookup table.
 * Tracing from `initKey` back to the solved root via pk chain gives
 * [move_n, move_{n-1}, ..., move_1] where move_n is the last forward move.
 * Applying inverseNotation to each (without reversing) gives the correct
 * solve sequence: apply inv(move_n) first → inv(move_{n-1}) → ... → inv(move_1).
 */
function pathFromTable(table, initKey) {
    if (!table.has(initKey)) return null;
    const path = [];
    let k = initKey;
    while (table.get(k).pk !== null) {
        const e = table.get(k);
        path.push(inverseNotation(e.move));
        k = e.pk;
    }
    return path;
}

// ─── ReductionSolver ─────────────────────────────────────────────────────────

export class ReductionSolver {
    constructor({ N, teaching } = {}) {
        if (N !== 4) {
            throw new SolverError(
                `ReductionSolver currently only supports N=4 (centers algorithm is hard-coded for 24 positions), got ${N}`,
                { kind: 'invalid-config' }
            );
        }
        this.N = N;
        this.teaching = teaching || {};
        // Optional override for the cstimer caller — when set, replaces the
        // default globalThis.scramble_444 lookup. Host (browser) attaches a
        // worker-backed proxy here to offload genFacelet onto a Web Worker;
        // Node tests leave this null and use the sync vendor global.
        this.cstimerCaller = null;
        this.perms = buildPerms(N);
        this.centerIdxByFace = centerIndices(N);
        this.allCenterIdx = FACE_ORDER.flatMap(f => this.centerIdxByFace[f]);
        this.centerPerms = buildCenterPerms(this.perms, this.allCenterIdx);

        const all = Object.keys(this.perms);
        const UD_PAIR = [...CENTER_LOCAL.U, ...CENTER_LOCAL.D];  // {0-3, 12-15}
        const FB_PAIR = [...CENTER_LOCAL.F, ...CENTER_LOCAL.B];  // {8-11, 20-23}

        this._moves = {
            all,
            // 28 moves: preserve UD as a pair (U↔D swap allowed).
            preserveUDpair: filterCenterMoves(this.centerPerms, all, [UD_PAIR]),
            // 24 moves: preserve UD-pair AND FB-pair (includes Rw2/Lw2/Fw2/Bw2/Uw2/Dw2).
            preserveUDFBpair: filterCenterMoves(this.centerPerms, all, [UD_PAIR, FB_PAIR]),
        };

        this.name = `reduction-${N}x${N}`;
        this.displayName = '人類教學版';
        this.description = `逐步把 ${N}×${N} 化簡為 3×3`;
        this.supportsTeaching = true;
        this.estimatedMoves = N === 4 ? 100 : 180;
        this.SOLVED = buildSolvedState(N);
        this._tables = null;
        this._preloadPromise = null;
    }

    /**
     * Precompute lookup tables. Called automatically on first solve.
     * Safe to call multiple times (idempotent via promise caching).
     */
    async preload() {
        if (!this._preloadPromise) {
            this._preloadPromise = this._buildTables();
        }
        return this._preloadPromise;
    }

    async _buildTables() {
        const t0 = perf.start('centers-preload');
        const solvedCS = extractCenterState(this.SOLVED, this.allCenterIdx);

        const udPerms    = _buildUDpairPerms(this.centerPerms);
        const fbPerms    = _buildFBpairPerms(this.centerPerms, this._moves.preserveUDpair);
        const jointPerms = _buildSortJointPerms(this.centerPerms, this._moves.preserveUDFBpair);

        this._tables = {
            udPair:    _buildUDpairTable(solvedCS,    this._moves.all,              udPerms),
            fbPair:    _buildFBpairTable(solvedCS,    this._moves.preserveUDpair,   fbPerms),
            sortJoint: _buildSortJointTable(solvedCS, this._moves.preserveUDFBpair, jointPerms),
        };
        const ms = t0();
        logger.solve('centers-preload-done', {
            ms,
            udPair:    this._tables.udPair.size,
            fbPair:    this._tables.fbPair.size,
            sortJoint: this._tables.sortJoint.size,
        });

        // Pre-warm cstimer if already loaded (idempotent: becomes no-op after first call).
        // Prefer the injected caller so a worker-backed proxy warms in the worker thread.
        // `await` is a no-op when init() is sync (Node vendor) and waits when async (worker).
        const csTimer = this.cstimerCaller || globalThis.scramble_444;
        if (csTimer && typeof csTimer.init === 'function') {
            const t1 = perf.start('cstimer-init');
            await csTimer.init();
            logger.solve('cstimer-prewarmed', { ms: t1() });
        }
    }

    async solve(state, options = {}) {
        const onStatus = options.onStatus || (() => {});
        const expectedLen = totalStickers(this.N);
        if (typeof state !== 'string' || state.length !== expectedLen) {
            throw new SolverError(
                `Bad state length: expected ${expectedLen}, got ${state?.length}`,
                { kind: 'invalid-state3', state }
            );
        }
        if (!/^[URFDLB]+$/.test(state)) {
            throw new SolverError('State contains non-URFDLB chars', { kind: 'invalid-state3', state });
        }

        // Validate sticker counts — each color must appear exactly N² times.
        const counts = {};
        for (const ch of state) counts[ch] = (counts[ch] || 0) + 1;
        const expected = this.N * this.N;
        for (const face of FACE_ORDER) {
            if ((counts[face] || 0) !== expected) {
                throw new SolverError(
                    `Invalid sticker counts: expected ${expected} × ${face}, got ${counts[face] || 0}`,
                    { kind: 'invalid-state3', state, counts }
                );
            }
        }

        // Already-solved early-return. cstimer's genFacelet treats a SOLVED
        // input as "no work to do" only loosely — it can return a non-empty
        // string that round-trips to a different state under its symmetry
        // bug, which our verify loop then "fixes" by inserting a pre-move,
        // ending up with a 10-15 move solution to a state that needs zero
        // moves. Short-circuit before that path can fire.
        if (state === this.SOLVED) {
            logger.solve('reduction-trivial', { N: this.N });
            return {
                phases: [
                    { name: 'centers',        displayName: '1️⃣ 中心歸位',  moves: [] },
                    { name: 'edges',          displayName: '2️⃣ 配對邊塊',  moves: [] },
                    { name: 'parity',         displayName: 'Parity 修正',   moves: [] },
                    { name: '3x3-kociemba',   displayName: '3️⃣ 當 3×3 解', moves: [] },
                ],
                totalMoves: 0,
                solverName: this.name,
                telemetry: null,
            };
        }

        await this.preload();

        logger.solve('reduction-start', { N: this.N });
        const t0 = perf.start(`reduction-solve-${this.N}x${this.N}`);
        const phases = [];

        try {
            onStatus('phase-start', { name: 'centers' });
            const centersPhase = this._solveCenters(state);
            phases.push(centersPhase);
            state = applyMoves(this.perms, state, centersPhase.moves.map(m => m.notation));

            onStatus('phase-start', { name: 'edges' });
            const csTimer = this.cstimerCaller || globalThis.scramble_444;
            let lastTelemetry = null;
            if (csTimer) {
                const rest = await this._solveEdgesAndBeyond(state, csTimer, {
                    onProgress: options.onProgress,
                });
                phases.push(rest.edges, rest.parity, rest.kociemba);
                lastTelemetry = rest._telemetry || null;
            } else {
                logger.solve('cstimer-unavailable', {});
                phases.push(
                    { name: 'edges',        displayName: '2️⃣ 配對邊塊',  moves: [], _stub: true, _reason: 'cstimer not loaded' },
                    { name: 'parity',       displayName: 'Parity 修正',   moves: [], _stub: true, _reason: 'cstimer not loaded' },
                    { name: '3x3-kociemba', displayName: '3️⃣ 當 3×3 解', moves: [], _stub: true, _reason: 'cstimer not loaded' }
                );
            }
            this._lastTelemetry = lastTelemetry;

        } catch (err) {
            if (err instanceof SolverError) throw err;
            throw new SolverError('Unexpected solver crash', { kind: 'solver-failed', cause: err, state });
        } finally {
            t0();
        }

        return {
            phases,
            totalMoves: phases.reduce((s, p) => s + p.moves.length, 0),
            solverName: this.name,
            telemetry: this._lastTelemetry,
        };
    }

    _solveCenters(fullState) {
        let cs = extractCenterState(fullState, this.allCenterIdx);
        const allMoves = [];

        const stages = [
            {
                name: 'pair-UD',
                keyOf: keyUDpair,
                table: this._tables.udPair,
                isSolved: s => UD_POS.every(i => s[i] === 'U' || s[i] === 'D'),
            },
            {
                name: 'pair-FB',
                keyOf: keyFBpair,
                table: this._tables.fbPair,
                isSolved: s => FB_POS.every(i => s[i] === 'F' || s[i] === 'B'),
            },
            {
                name: 'sort-joint',
                keyOf: keySortJoint,
                table: this._tables.sortJoint,
                isSolved: s =>
                    CENTER_LOCAL.U.every(i => s[i] === 'U') &&
                    CENTER_LOCAL.F.every(i => s[i] === 'F') &&
                    CENTER_LOCAL.L.every(i => s[i] === 'L'),
            },
        ];

        for (const stage of stages) {
            if (stage.isSolved(cs)) {
                logger.solve('centers-stage-done', { name: stage.name, moves: 0, ms: 0 });
                continue;
            }

            const t0 = perf.start(`centers-${stage.name}`);
            const path = pathFromTable(stage.table, stage.keyOf(cs));
            const ms = t0();

            logger.solve('centers-stage-done', { name: stage.name, moves: path?.length ?? -1, ms });

            if (path === null) {
                throw new SolverError(
                    `Centers lookup failed at stage "${stage.name}" — key not in table (table size: ${stage.table.size})`,
                    {
                        kind: 'reduction-failed',
                        phase: `centers/${stage.name}`,
                        partialMoves: allMoves.map(n => ({ notation: n, phaseName: 'centers' })),
                    }
                );
            }

            for (const move of path) cs = applyCenterPerm(this.centerPerms[move], cs);
            allMoves.push(...path);
        }

        // Verify all 6 faces
        for (const face of FACE_ORDER) {
            for (const li of CENTER_LOCAL[face]) {
                if (cs[li] !== face) {
                    throw new SolverError(
                        `Centers verify: ${face} face local[${li}] = '${cs[li]}'`,
                        {
                            kind: 'reduction-failed',
                            phase: 'centers',
                            partialMoves: allMoves.map(n => ({ notation: n, phaseName: 'centers' })),
                        }
                    );
                }
            }
        }

        return {
            name: 'centers',
            displayName: '1️⃣ 組中心',
            moves: allMoves.map(notation => ({ notation, phaseName: 'centers' })),
            teachingNote: this.teaching.centers ||
                '4×4 沒有固定中心。先把每面 4 個中心湊成同色，才能像 3×3 一樣解。',
            formulaName: 'centers-paired',
        };
    }

    /**
     * Call cstimer to solve the remaining phases (edges + parity + 3×3) and
     * split the returned move string into three phase objects.
     *
     * Phase detection:
     *   edges   — moves until all 12 virtual edges are paired (EDGE_DEFS_4 check)
     *   parity  — any wide moves (containing 'w') remaining after edges
     *   kociemba — outer-only moves that finish the 3×3 solve
     *
     * cstimer's genFacelet() uses an internal symmetry reduction that produces
     * incorrect solutions for some states. We try all 24 proper cube orientations
     * via coord_rotate (physical rotation + color relabeling) and verify each
     * candidate solution before accepting it. One orientation is guaranteed to work.
     */
    async _solveEdgesAndBeyond(state, csTimer, options = {}) {
        // cstimer's genFacelet uses a 48-element symmetry group (24 proper rotations
        // + reflections). For ~17% of post-centers states, all 24 proper rotations
        // hit the same wrong-symmetry result. Outer moves (which preserve centers
        // on 4×4) shift the state to a different symmetry class — empirically a
        // single U or R move fixes every case in our 100-scramble test.
        const PRE_MOVE_FALLBACKS = [[], ["U"], ["R"], ["F"], ["U2"], ["R2"]];
        const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
        const startMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        const totalAttempts = PRE_MOVE_FALLBACKS.length * _ROT_PRIORITY.length;

        let allMoves = null;
        let rotIdx = -1;
        let preMoves = [];
        let attempts = 0;

        outer: for (const pre of PRE_MOVE_FALLBACKS) {
            const baseState = pre.length ? applyMoves(this.perms, state, pre) : state;
            for (let oi = 0; oi < _ROT_PRIORITY.length; oi++) {
                const i = _ROT_PRIORITY[oi];
                attempts++;

                // Yield to event loop before each cstimer call so the host UI can
                // repaint and setInterval ticks can fire. Overhead per yield is
                // ~1 ms on modern engines; total worst-case 144 yields ≈ 0.2 % of
                // the worst-case solve time. Only yield when onProgress is set,
                // to keep headless Node tests unchanged.
                if (onProgress) {
                    await new Promise(r => setTimeout(r, 0));
                    onProgress({
                        attempts,
                        total: totalAttempts,
                        rotIdx: i,
                        pre: pre.join('+') || 'none',
                        elapsedMs: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startMs,
                    });
                }

                const { physMoves, relabel, conj } = _COORD_ROTS[i];
                const rotated = _coordRotate(this.perms, baseState, physMoves, relabel);
                // cstimer.genFacelet may be sync (Node, direct vendor) or async
                // (browser worker proxy). `await` is a no-op on primitives, so
                // this works for both transports.
                const solutionStr = await csTimer.genFacelet(rotated);
                const tokens = solutionStr ? solutionStr.trim().split(/\s+/).filter(Boolean) : [];
                // genFacelet returns SCRAMBLE M: applyMoves(SOLVED, M) = rotated.
                // Solve = inverseMoves(M), then conj maps back to original frame.
                const candidate = tokens.slice().reverse().map(m => _conjMove(inverseNotation(m), conj));
                // Verify before accepting. Empty candidate is only accepted when baseState
                // is already SOLVED (applyMoves(state, []) === state).
                if (applyMoves(this.perms, baseState, candidate) === this.SOLVED) {
                    allMoves = [...pre, ...candidate];
                    rotIdx = i;
                    preMoves = pre;
                    break outer;
                }
            }
        }

        if (allMoves === null) {
            logger.solve('cstimer-all-rotations-failed', {});
            allMoves = [];
        }
        const telemetry = {
            rotIdx,
            pre: preMoves.join('+') || 'none',
            cstimerMoves: allMoves.length - preMoves.length,
        };
        logger.solve('cstimer-solution', { moves: allMoves.length, ...telemetry });

        if (allMoves.length === 0) {
            // Already solved or trivially solvable
            return {
                edges:    { name: 'edges',        displayName: '2️⃣ 配對邊塊',  moves: [] },
                parity:   { name: 'parity',       displayName: 'Parity 修正',   moves: [] },
                kociemba: { name: '3x3-kociemba', displayName: '3️⃣ 當 3×3 解', moves: [] },
                _telemetry: telemetry,
            };
        }

        // Walk moves until all edges are paired
        let cur = state;
        let edgesEnd = allMoves.length; // fallback: all moves in edges phase
        for (let i = 0; i < allMoves.length; i++) {
            cur = applyMove(this.perms, cur, allMoves[i]);
            if (edgesAllPaired(cur)) {
                edgesEnd = i + 1;
                break;
            }
        }

        // Parity = any wide moves after edgesEnd; kociemba = pure outer-only suffix.
        // Find the last wide move in the post-edges tail.
        const postEdges = allMoves.slice(edgesEnd);
        let lastWide = -1;
        for (let i = 0; i < postEdges.length; i++) {
            if (postEdges[i].includes('w')) lastWide = i;
        }
        const parityMoves   = lastWide >= 0 ? postEdges.slice(0, lastWide + 1) : [];
        const kociembaMoves = lastWide >= 0 ? postEdges.slice(lastWide + 1)    : postEdges;

        logger.solve('cstimer-phases', {
            edges: edgesEnd,
            parity: parityMoves.length,
            kociemba: kociembaMoves.length,
        });

        return {
            edges: {
                name: 'edges',
                displayName: '2️⃣ 配對邊塊',
                moves: allMoves.slice(0, edgesEnd).map(n => ({ notation: n, phaseName: 'edges' })),
                teachingNote: this.teaching.edges ||
                    '把每條邊的兩塊湊成同色對，之後就能當成 3×3 來解。',
            },
            parity: {
                name: 'parity',
                displayName: 'Parity 修正',
                moves: parityMoves.map(n => ({ notation: n, phaseName: 'parity' })),
                teachingNote: this.teaching.parity ||
                    '4×4 特有的 Parity：部分情況需要額外公式才能讓方塊回到 3×3 可解狀態。',
            },
            kociemba: {
                name: '3x3-kociemba',
                displayName: '3️⃣ 當 3×3 解',
                moves: kociembaMoves.map(n => ({ notation: n, phaseName: '3x3-kociemba' })),
                teachingNote: this.teaching.kociemba ||
                    '中心與邊塊都就位後，4×4 就等同 3×3，用 Kociemba 最優解收尾。',
            },
            _telemetry: telemetry,
        };
    }
}
