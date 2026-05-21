// N-parameterized permutation table builder.
//
// Given a cube size N, returns a `perms` map keyed by move notation,
// where each value is an N²·6-length permutation array satisfying:
//   newState[perm[i]] = oldState[i]
// (i.e., perm[srcIndex] = destIndex)
//
// The algorithm matches the inline buildPerms4() in cube4x4.html (line 2236)
// exactly, just parameterized by N.
//
// For each N, includes:
//   - Outer face moves: R, R', R2, L, L', L2, U, U', U2, D, D', D2, F, F', F2, B, B', B2
//   - Wide moves (N ≥ 4 only): Rw, Rw', Rw2, Lw, ..., Bw'
//   - Future for N ≥ 5: 3Rw, 3Rw', 3Rw2 ... (inner-3 wide moves)

import { FACE_ORDER, FACE_NORMALS, buildFaceCoords, halfExtent, totalStickers, stickersPerFace } from './cube-geometry-n.js';

function rotVec(v, axis, angle) {
    const [x, y, z] = v;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    if (axis === 'x') return [x, c * y - s * z, s * y + c * z];
    if (axis === 'y') return [c * x + s * z, y, -s * x + c * z];
    return [c * x - s * y, s * x + c * y, z];
}

/** Snap to half-unit precision to match coordinate grid for N up to 7. */
function snap2(v) {
    return Math.round(v * 2) / 2;
}

/**
 * Build a permutation array for one rotation.
 *
 * @param {number} N         Cube size
 * @param {object} faceCoords  Output of buildFaceCoords(N)
 * @param {object} posToIdx   Reverse lookup: "face:x,y,z" → global state index
 * @param {string} axis       'x' | 'y' | 'z'
 * @param {function} sliceTest  (coord) → true if affected by this rotation
 * @param {number} angle      Radians of rotation (±π/2 or π)
 * @returns {number[]}        Length-(6·N²) permutation array
 */
function buildOnePerm(N, faceCoords, posToIdx, axis, sliceTest, angle) {
    const axisIdx = { x: 0, y: 1, z: 2 }[axis];
    const total = totalStickers(N);
    const pf = stickersPerFace(N);
    const perm = Array.from({ length: total }, (_, i) => i);

    FACE_ORDER.forEach((face, fi) => {
        const norm = FACE_NORMALS[face];
        faceCoords[face].forEach((pos, si) => {
            if (!sliceTest(pos[axisIdx])) return;
            // Rotate position
            const rp = rotVec(pos, axis, angle).map(snap2);
            // Rotate face normal to find new face
            const rn = rotVec(norm, axis, angle).map(Math.round);
            const newFace = FACE_ORDER.find(f => {
                const n = FACE_NORMALS[f];
                return n[0] === rn[0] && n[1] === rn[1] && n[2] === rn[2];
            });
            if (!newFace) return;
            const key = `${newFace}:${rp[0]},${rp[1]},${rp[2]}`;
            const dst = posToIdx[key];
            if (dst !== undefined) perm[fi * pf + si] = dst;
        });
    });

    return perm;
}

function compose(p1, p2, total) {
    const r = new Array(total);
    for (let i = 0; i < total; i++) r[i] = p2[p1[i]];
    return r;
}

function invert(p, total) {
    const r = new Array(total);
    for (let i = 0; i < total; i++) r[p[i]] = i;
    return r;
}

/**
 * Build the permutation table for cube size N.
 *
 * Returns: { 'R': [...], "R'": [...], 'R2': [...], 'L': [...], ...,
 *            (if N≥4) 'Rw': [...], ..., 'Bw2': [...] }
 *
 * For N=3: 18 entries (6 faces × 3 powers).
 * For N=4: 36 entries (6 faces × 3 powers × {outer, wide}).
 * For N=5: 36 entries (same — wide is still "2 outer layers"; no inner-3 yet).
 */
export function buildPerms(N) {
    if (N < 3) throw new Error(`buildPerms: N must be ≥ 3 (got ${N})`);

    const h = halfExtent(N);
    const faceCoords = buildFaceCoords(N);
    const total = totalStickers(N);
    const pf = stickersPerFace(N);

    // Build position → state-index lookup
    const posToIdx = {};
    FACE_ORDER.forEach((face, fi) => {
        faceCoords[face].forEach((pos, si) => {
            const key = `${face}:${pos[0]},${pos[1]},${pos[2]}`;
            posToIdx[key] = fi * pf + si;
        });
    });

    const perms = {};

    // BASE outer moves: 1 layer at the outermost slice for each face.
    // DIR follows the WCA / cube-conventional CW direction looking from face outward.
    const BASE = {
        R: { axis: 'x', val: +h, dir: -1 },
        L: { axis: 'x', val: -h, dir: +1 },
        U: { axis: 'y', val: +h, dir: -1 },
        D: { axis: 'y', val: -h, dir: +1 },
        F: { axis: 'z', val: +h, dir: -1 },
        B: { axis: 'z', val: -h, dir: +1 },
    };

    Object.entries(BASE).forEach(([face, { axis, val, dir }]) => {
        const baseAngle = dir * Math.PI / 2;
        const test = v => Math.abs(v - val) < 0.1;
        const cw = buildOnePerm(N, faceCoords, posToIdx, axis, test, baseAngle);
        const ccw = invert(cw, total);
        const dbl = compose(cw, cw, total);
        perms[face] = cw;
        perms[face + "'"] = ccw;
        perms[face + '2'] = dbl;
    });

    // WIDE moves (only for N ≥ 4): 2 outermost layers per face.
    if (N >= 4) {
        const WIDE = {
            Rw: { axis: 'x', vals: [+h, +h - 1], dir: -1 },
            Lw: { axis: 'x', vals: [-h, -h + 1], dir: +1 },
            Uw: { axis: 'y', vals: [+h, +h - 1], dir: -1 },
            Dw: { axis: 'y', vals: [-h, -h + 1], dir: +1 },
            Fw: { axis: 'z', vals: [+h, +h - 1], dir: -1 },
            Bw: { axis: 'z', vals: [-h, -h + 1], dir: +1 },
        };

        Object.entries(WIDE).forEach(([name, { axis, vals, dir }]) => {
            const baseAngle = dir * Math.PI / 2;
            const test = v => vals.some(w => Math.abs(v - w) < 0.1);
            const cw = buildOnePerm(N, faceCoords, posToIdx, axis, test, baseAngle);
            const ccw = invert(cw, total);
            const dbl = compose(cw, cw, total);
            perms[name] = cw;
            perms[name + "'"] = ccw;
            perms[name + '2'] = dbl;
        });
    }

    return perms;
}

/**
 * Apply a single notation move to a state string (length = 6·N²).
 *  - perms: output of buildPerms(N) for the appropriate N
 *  - state: state string ('U'/'R'/'F'/'D'/'L'/'B' chars)
 *  - notation: a key in perms
 *
 * @returns {string} new state string
 */
export function applyMove(perms, state, notation) {
    const perm = perms[notation];
    if (!perm) throw new Error(`Unknown move notation: ${notation}`);
    const total = state.length;
    if (perm.length !== total) {
        throw new Error(`Move ${notation} expects state length ${perm.length}, got ${total}`);
    }
    const arr = state.split('');
    const res = new Array(total);
    for (let i = 0; i < total; i++) res[perm[i]] = arr[i];
    return res.join('');
}

/** Apply a sequence of moves to a state string. */
export function applyMoves(perms, state, moves) {
    let s = state;
    for (const m of moves) s = applyMove(perms, s, m);
    return s;
}

/** Invert a single move notation (Rw → Rw', Rw' → Rw, Rw2 → Rw2). */
export function inverseNotation(n) {
    if (n.endsWith('2')) return n;
    if (n.endsWith("'")) return n.slice(0, -1);
    return n + "'";
}

/** Invert a move sequence (reverse + invert each). */
export function inverseMoves(moves) {
    return moves.slice().reverse().map(inverseNotation);
}
