// Solver interface contract — pure type definitions, no runtime code.
//
// All concrete solvers (ReductionSolver, KociembaSolver, future TPRSolver,
// LBLSolver, YauSolver) MUST conform to the Solver shape below.
//
// Why: explicit contract means the SolveGuide UI doesn't care which solver
// produced the result; it just renders Phase[]. Adding a new solver is a
// drop-in: implement Solver, register it, done.
//
// See docs/contracts/solver.md for prose + worked examples.

/**
 * @typedef {Object} Solver
 *
 * @property {string} name
 *   Stable identifier, e.g. 'reduction-4x4', 'kociemba-3x3', 'tpr-4x4',
 *   'lbl-3x3'. Used in logs and registry lookups. snake-case-with-dashes.
 *
 * @property {string} displayName
 *   User-facing label, e.g. '人類教學版', '電腦最佳解', '層先法'.
 *
 * @property {string} [description]
 *   One-line explanation for solver-picker UI tooltip.
 *
 * @property {number} N
 *   Cube size (3, 4, 5). Solvers are size-specific; a 4×4 solver should
 *   reject N=3 input.
 *
 * @property {boolean} supportsTeaching
 *   If true, phases will include teachingNote and formulaName fields.
 *
 * @property {number} [estimatedMoves]
 *   Typical move count for random scrambles. Informational only —
 *   used in UI to set user expectation. ~44 for TPR, ~100 for Reduction.
 *
 * @property {boolean} [initialized]
 *   True once the solver has loaded its lookup tables / is warm. Solvers
 *   needing init (cubejs, TPR) should expose this. The app preloads at
 *   idle time when possible.
 *
 * @property {function(): Promise<void>} [preload]
 *   Optional warm-up. App calls this during browser idle time to avoid
 *   a stall on first solve. Idempotent.
 *
 * @property {function(string, SolveOptions=): Promise<SolveResult>} solve
 *   The main entry. Takes a state string (length 9*N*N for that puzzle),
 *   returns phases + metadata. Throws SolverError on unrecoverable failure.
 */

/**
 * @typedef {Object} SolveOptions
 * @property {function(string, object=): void} [onStatus]
 *   Progress callback. Called with ('phase-name', { ...details }).
 * @property {AbortSignal} [signal]
 *   For canceling long-running solves (future).
 */

/**
 * @typedef {Object} SolveResult
 *
 * @property {Phase[]} phases
 *   Ordered phases. UI renders each in sequence with stage labels.
 *
 * @property {number} totalMoves
 *   Sum of moves across all phases.
 *
 * @property {number} elapsedMs
 *   Total wall-clock time of the solve.
 *
 * @property {string} solverName
 *   Echoed from Solver.name — for logging.
 *
 * @property {Object} [diagnostic]
 *   Solver-specific debug payload. UI ignores this; useful for tests.
 */

/**
 * @typedef {Object} Phase
 *
 * @property {string} name
 *   Stable identifier: 'centers' | 'edges' | 'parity-OLL' | 'parity-PLL'
 *   | '3x3-kociemba' | '3x3-lbl-cross' | '3x3-lbl-f2l' | ... etc.
 *
 * @property {string} displayName
 *   Chinese label for UI, e.g. '1️⃣ 組中心', '2️⃣ 配對邊塊', 'OLL 偶數性修正'.
 *
 * @property {Move[]} moves
 *   Ordered moves for this phase. May be empty (e.g., parity phase that
 *   wasn't triggered — solver can omit it entirely, or include with
 *   moves:[] for explicit "no parity needed" status).
 *
 * @property {string} [teachingNote]
 *   Markdown-light explanation shown when phase begins. Educational
 *   solvers populate this; fast solvers leave it undefined.
 *
 * @property {string} [formulaName]
 *   If this phase uses a specific named formula (e.g., 'edge-pair',
 *   'OLL-parity'), the UI can highlight it. Optional.
 *
 * @property {number} [estimatedMs]
 *   How long users typically take to physically execute this phase.
 *   Used by guide UI to set autoplay delay sensibly.
 */

/**
 * @typedef {Object} Move
 *
 * @property {string} notation
 *   Standard WCA notation: 'R', "R'", 'R2', 'Rw', "Rw'", 'Rw2', etc.
 *   Must be a key in the puzzle's PERMS table.
 *
 * @property {string} [phaseName]
 *   Echo of the parent Phase.name. Convenience for flat iteration.
 *
 * @property {string} [formulaTag]
 *   For UI highlighting: 'edge-pair-step', 'OLL-parity-step', etc.
 *   If set, the guide can show a "applying formula X" badge.
 */

// This file exports nothing at runtime — JSDoc types only. Importing it is
// optional; it serves primarily as the canonical reference for the contract.
// The `void` export is a marker so tooling can confirm the file loaded.
export const SOLVER_TYPES_VERSION = '1.0.0';
