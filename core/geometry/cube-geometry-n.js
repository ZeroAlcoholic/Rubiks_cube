// N-parameterized cube geometry.
//
// Generates FACE_COORDS for any cube size N (3, 4, 5, ...). The
// coordinate system matches what cube{3,4,5}x{3,4,5}.html uses inline,
// so PERMS built here are interchangeable with PERMS built inline.
//
// Sticker indexing convention (must match cube*.html exactly):
//   - Face order: U, R, F, D, L, B (URFDLB)
//   - Per-face sticker order: row-major from "viewer's perspective":
//       U face: viewed from above, top row = back of cube, bottom row = front
//       R face: viewed from right, top row = U side, bottom row = D
//       F face: viewed from front, top row = U side, bottom row = D
//       D face: viewed from below, top row = front, bottom row = back
//       L face: viewed from left, top row = U side, bottom row = D
//       B face: viewed from back, top row = U side, bottom row = D
//   - Within a row, left-to-right relative to the viewer.
//
// For N=3: 9 stickers/face, coordinates ∈ {-1, 0, 1}
// For N=4: 16 stickers/face, coordinates ∈ {-1.5, -0.5, 0.5, 1.5}
// For N=5: 25 stickers/face, coordinates ∈ {-2, -1, 0, 1, 2}

export const FACE_ORDER = ['U', 'R', 'F', 'D', 'L', 'B'];

/** Outward-facing normal vector for each face (in [x, y, z]). */
export const FACE_NORMALS = {
    U: [0, 1, 0],
    D: [0, -1, 0],
    R: [1, 0, 0],
    L: [-1, 0, 0],
    F: [0, 0, 1],
    B: [0, 0, -1],
};

/** Return the half-extent of the cube on one axis for a given N. */
export function halfExtent(N) {
    return (N - 1) / 2;  // N=3→1, N=4→1.5, N=5→2
}

/** Return the list of coordinate values along one axis for a cube of size N. */
export function axisCoords(N) {
    const h = halfExtent(N);
    return Array.from({ length: N }, (_, i) => -h + i);
}

/**
 * Build FACE_COORDS for a given N. Returns:
 *   { U: [[x,y,z], ...], R: [...], F: [...], D: [...], L: [...], B: [...] }
 * Each face has N×N coordinate triples in row-major viewer order.
 *
 * This matches the inline FACE_COORDS in cube4x4.html exactly for N=4.
 */
export function buildFaceCoords(N) {
    const h = halfExtent(N);
    const coords = axisCoords(N);  // e.g., [-1.5, -0.5, 0.5, 1.5] for N=4

    const out = {};

    // U: y=+h, row goes from z=-h (back) to z=+h (front), col x=-h to x=+h
    out.U = [];
    for (const z of coords) {
        for (const x of coords) {
            out.U.push([x, h, z]);
        }
    }

    // R: x=+h, row z=+h (front) to z=-h (back) — note reversal — col y=+h to y=-h
    out.R = [];
    for (const y of [...coords].reverse()) {
        for (const z of [...coords].reverse()) {
            out.R.push([h, y, z]);
        }
    }

    // F: z=+h, row x=-h to +h, col y=+h to -h
    out.F = [];
    for (const y of [...coords].reverse()) {
        for (const x of coords) {
            out.F.push([x, y, h]);
        }
    }

    // D: y=-h, row z=+h (front) to z=-h (back) — viewer looks up from below; col x=-h to +h
    out.D = [];
    for (const z of [...coords].reverse()) {
        for (const x of coords) {
            out.D.push([x, -h, z]);
        }
    }

    // L: x=-h, row z=-h (back) to z=+h (front), col y=+h to -h
    out.L = [];
    for (const y of [...coords].reverse()) {
        for (const z of coords) {
            out.L.push([-h, y, z]);
        }
    }

    // B: z=-h, row x=+h to -h (because we're looking from behind), col y=+h to -h
    out.B = [];
    for (const y of [...coords].reverse()) {
        for (const x of [...coords].reverse()) {
            out.B.push([x, y, -h]);
        }
    }

    return out;
}

/** Total sticker count for a cube of size N. */
export function totalStickers(N) {
    return 6 * N * N;
}

/** Stickers per face for a cube of size N. */
export function stickersPerFace(N) {
    return N * N;
}

/**
 * Return the global sticker indices that are "centers" — i.e., NOT on a face's
 * outer edge. For N=3, that's just position [4] (the middle). For N=4, positions
 * [5,6,9,10]. For N=5, positions [6,7,8,11,12,13,16,17,18].
 *
 * Returns: { [face]: [globalIndex, ...] }
 *   - For odd N, the literal center [4 for N=3, 12 for N=5] is fixed and
 *     determines the face color.
 *   - For even N, no fixed center exists; the 4-sticker block determines color
 *     after reduction.
 */
export function centerIndices(N) {
    const result = {};
    const pf = stickersPerFace(N);
    FACE_ORDER.forEach((face, fi) => {
        const base = fi * pf;
        const localCenters = [];
        // Centers = positions that are NOT on row 0, row N-1, col 0, or col N-1
        for (let r = 1; r < N - 1; r++) {
            for (let c = 1; c < N - 1; c++) {
                localCenters.push(r * N + c);
            }
        }
        result[face] = localCenters.map(i => base + i);
    });
    return result;
}

/**
 * Indices of the literal fixed center, if N is odd. Returns null for even N.
 * The fixed center sticker determines the face color (immutable through outer
 * moves alone).
 */
export function fixedCenterIndex(N, face) {
    if (N % 2 === 0) return null;
    const pf = stickersPerFace(N);
    const fi = FACE_ORDER.indexOf(face);
    const mid = Math.floor(N / 2);
    return fi * pf + (mid * N + mid);
}

/**
 * Build the SOLVED state string for a cube of size N: N²/face × 'U','R','F','D','L','B'.
 *  - N=3: 9*6 = 54 chars
 *  - N=4: 16*6 = 96 chars
 *  - N=5: 25*6 = 150 chars
 */
export function buildSolvedState(N) {
    const pf = stickersPerFace(N);
    return FACE_ORDER.map(f => f.repeat(pf)).join('');
}
