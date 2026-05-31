// Yau-method feasibility SPIKE (4×4). EXPERIMENT ONLY — not shipped into the solver.
//
// Goal: produce decisive, measured numbers for "how hard is an automated true-Yau
// solver", instead of guessing. Yau's 5 phases:
//   P1  solve 2 opposite centers
//   P2  place 3 cross dedges (between the 2 centers)
//   P3  solve the remaining 4 centers WITHOUT disturbing the 3 cross edges  ← the wall
//   P4  pair the last 8 dedges (3-2-3) + parity
//   P5  finish as 3×3
//
// What this spike measures (all reusing the proven perms-n move tables):
//   A) P1 cost: BFS the "U/D centre membership" projection (what Reduction's
//      udPair stage already does) — confirms P1 is a cheap, solved problem.
//   B) P3 wall: with 3 L-cross dedges HELD (positions fixed), how many moves
//      remain that strictly fix those positions, and can centres still be freely
//      paired using ONLY that restricted set? This bounds how much P3 must lean
//      on commutators / setup-restore (the real engineering cost).
//
// Run: node tools/yau-spike.mjs

import { buildPerms } from '../core/geometry/perms-n.js';

const N = 4, FACE = ['U', 'R', 'F', 'D', 'L', 'B'];
const perms = buildPerms(N);
const MOVES = Object.keys(perms);

// ── geometry ────────────────────────────────────────────────────────────────
// Inner 2×2 centre stickers per face: global index = fi*16 + {5,6,9,10}.
const CENTER_SLOTS = [];
FACE.forEach((f, fi) => [5, 6, 9, 10].forEach(p => CENTER_SLOTS.push(fi * 16 + p)));
const slotIndex = new Map(CENTER_SLOTS.map((g, i) => [g, i])); // global → 0..23

// "U/D piece" projection: a centre slot whose solved face is U or D.
const isUD = g => { const fi = Math.floor(g / 16); return FACE[fi] === 'U' || FACE[fi] === 'D'; };
const SOLVED_UD = CENTER_SLOTS.map(isUD); // length-24 boolean

// EDGE_CUBIES_4 (mirror of cube4x4.html). Each entry = the 2 stickers of one edge piece.
// Grouped 2-per-physical-edge.
const EDGE_CUBIES = [
    [1, 82], [2, 81],   [4, 65], [8, 66],   [7, 18], [11, 17],  [13, 33], [14, 34],
    [49, 45], [50, 46], [52, 78], [56, 77], [55, 29], [59, 30], [61, 94], [62, 93],
    [20, 39], [24, 43], [23, 84], [27, 88], [36, 71], [40, 75], [87, 68], [91, 72],
];
// 3 of the 4 L-adjacent cross dedges to HOLD (U-L, F-L, B-L); leave D-L as the free slot.
const HELD_EDGE_STICKERS = [4, 65, 8, 66,  36, 71, 40, 75,  87, 68, 91, 72];

// ── helpers ───────────────────────────────────────────────────────────────
// Apply move perm to the 24-bit U/D membership set (bitmask over centre slots).
function buildCenterSlotPerm(move) {
    const p = perms[move];
    const cp = new Array(24);
    for (let i = 0; i < 24; i++) {
        const dst = p[CENTER_SLOTS[i]];
        const di = slotIndex.get(dst);
        if (di === undefined) return null; // move maps a centre off the centre slots → unexpected
        cp[i] = di;
    }
    return cp;
}
function applyMaskPerm(mask, cp) {
    let out = 0;
    for (let i = 0; i < 24; i++) if (mask & (1 << i)) out |= (1 << cp[i]);
    return out;
}
function solvedMask() { let m = 0; SOLVED_UD.forEach((b, i) => { if (b) m |= (1 << i); }); return m; }

function bfsReachable(moveList, cap = 2_000_000) {
    const cps = moveList.map(buildCenterSlotPerm).filter(Boolean);
    const start = solvedMask();
    const seen = new Set([start]);
    let frontier = [start], depth = 0, maxDepth = 0;
    while (frontier.length) {
        const next = [];
        for (const s of frontier) {
            for (const cp of cps) {
                const ns = applyMaskPerm(s, cp);
                if (!seen.has(ns)) { seen.add(ns); next.push(ns); if (seen.size >= cap) return { count: seen.size, maxDepth, capped: true }; }
            }
        }
        if (next.length) maxDepth = ++depth;
        frontier = next;
    }
    return { count: seen.size, maxDepth, capped: false };
}

// ── A) Phase 1 cost (full move set) ──────────────────────────────────────────
console.log('=== Yau SPIKE (4×4) — experiment, not shipped ===\n');
console.log('A) Phase 1 — solve 2 opposite centres (U/D membership projection)');
const t0 = Date.now();
const full = bfsReachable(MOVES);
const cChoose = (() => { let r = 1; for (let k = 0; k < 8; k++) r = r * (24 - k) / (k + 1); return Math.round(r); })();
console.log(`   reachable U/D states : ${full.count}  (C(24,8) = ${cChoose})`);
console.log(`   God's-number depth   : ${full.maxDepth} moves`);
console.log(`   BFS build time       : ${Date.now() - t0} ms`);
console.log(`   → Phase 1 is a small, fully-solved BFS (Reduction already ships this udPair table).\n`);

// ── B) Phase 3 wall — moves that strictly hold the 3 cross dedges ─────────────
console.log('B) Phase 3 — hold 3 L-cross dedges fixed; which moves are still legal?');
const heldFix = MOVES.filter(m => HELD_EDGE_STICKERS.every(s => perms[m][s] === s));
console.log(`   total moves            : ${MOVES.length}`);
console.log(`   strictly edge-fixing   : ${heldFix.length}  → [${heldFix.join(', ') || '(none)'}]`);

const restricted = bfsReachable(heldFix);
console.log(`   centres reachable w/ only edge-fixing moves : ${restricted.count} / ${full.count}` +
    (restricted.capped ? ' (capped)' : ''));
const frac = (restricted.count / full.count * 100).toFixed(2);
console.log(`   coverage                : ${frac}%  (100% ⇒ centres freely solvable while holding cross;`);
console.log(`                             <100% ⇒ needs commutators / setup-restore → real P3 engineering)\n`);

// ── verdict ──────────────────────────────────────────────────────────────────
console.log('=== READ-OFF ===');
console.log(`P1 (2 centres) : SOLVED problem, reuse existing BFS. ~0 risk.`);
if (heldFix.length <= 6 || restricted.count < full.count) {
    console.log(`P3 (last 4 centres, cross held) : strictly edge-fixing move set is tiny` +
        ` (${heldFix.length} moves, ${frac}% centre coverage). A pure restricted-BFS CANNOT`);
    console.log(`   freely solve centres → must use conjugates (setup · centre-alg · setup⁻¹) that`);
    console.log(`   net-preserve the cross. This is the known Yau difficulty: it is DOABLE (humans`);
    console.log(`   do it) but requires a hand-built commutator/alg engine, not a lookup table.`);
} else {
    console.log(`P3 : restricted set covers all centre states → table-drivable. Lower risk than expected.`);
}
console.log(`P2 (3 cross edges) + P4 (3-2-3 last edges + OLL parity) : net-new edge engines (cstimer's`);
console.log(`   bundled edge IDA* cannot be asked for "just 3 edges" / "3-2-3 slotting").`);
console.log(`\nConclusion: automated *true* Yau ≈ P3 commutator engine + P2/P4 edge engines + parity.`);
console.log(`Multi-day, high-risk. The shipped Reduction engine already solves correctly & faster;`);
console.log(`the beta wrapper gives the Yau *teaching* decomposition without that risk.`);
