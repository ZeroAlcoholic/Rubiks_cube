// Solver Registry — a single place where the host (browser) and worker agree
// on which solver implementations are available and how to instantiate them.
//
// The host sends a solver name in the init message; the worker looks up the
// matching entry and instantiates the factory. This lets us add Yau / WASM
// Kociemba / future solvers without touching the worker dispatch logic.
//
// Contract every solver factory MUST honor:
//   - constructor takes { N, teaching, ...solver-specific opts }
//   - has async preload({ cachedTables? }) — idempotent
//   - has async solve(state96, { onStatus?, onProgress? }) returning:
//       { phases: [{ name, displayName, moves, teachingNote }],
//         totalMoves, solverName, telemetry }
//
// Why a registry rather than a switch statement?
//   - Future variants (yau-full, wasm-min2phase) add ONE entry, no glue code
//   - Host can render UI options directly from registry metadata
//   - Tests can iterate registry to verify all variants solve correctly

import { ReductionSolver } from './reduction.js';

// Lazy import of yau-solver so the heavier Yau module only loads when needed.
// This keeps worker boot fast for users who stick with the default 'fast' path.
let _YauSolverPromise = null;
function loadYauSolver() {
    if (!_YauSolverPromise) {
        _YauSolverPromise = import('./yau-solver.js').then(m => m.YauSolver);
    }
    return _YauSolverPromise;
}

export const SOLVER_VARIANTS = {
    'fast': {
        name: 'fast',
        displayName: '速解',
        shortLabel: '速解',
        description: 'Reduction + cstimer IDA*。電腦最快路徑，~80-120 步。',
        estimatedMoves: [80, 120],
        estimatedSolveMs: [3000, 12000],
        factory: ({ teaching } = {}) =>
            new ReductionSolver({ N: 4, teaching, finisher: 'cstimer' }),
    },
    'fast-kociemba': {
        name: 'fast-kociemba',
        displayName: '兩階段最佳',
        shortLabel: '兩階段',
        description: 'Reduction 完成中心+邊塊後，3×3 階段改用 cubejs Kociemba 兩階段，~75-100 步。',
        estimatedMoves: [75, 100],
        estimatedSolveMs: [3500, 13000],
        factory: ({ teaching } = {}) =>
            new ReductionSolver({ N: 4, teaching, finisher: 'cubejs' }),
    },
    'yau-teach': {
        name: 'yau-teach',
        displayName: '教學版 Yau',
        shortLabel: 'Yau',
        description: 'Yau 方法：2 對立中心 → 3 條跨邊 → 剩餘 4 中心 → 邊配對 → 3×3 收尾。每步有故事。',
        estimatedMoves: [85, 110],
        estimatedSolveMs: [4000, 14000],
        // Returns a Promise — host MUST await before instantiation.
        factory: async ({ teaching } = {}) => {
            const Yau = await loadYauSolver();
            return new Yau({ N: 4, teaching });
        },
        // Marked beta so UI can display a "開發中" badge.
        beta: true,
    },
};

export const DEFAULT_VARIANT = 'fast';

/**
 * Instantiate a solver by name. Falls back to DEFAULT_VARIANT if name is unknown.
 * Always returns a Promise — even sync factories are wrapped — so callers have
 * one consistent await pattern.
 */
export async function createSolver(name, opts = {}) {
    const entry = SOLVER_VARIANTS[name] || SOLVER_VARIANTS[DEFAULT_VARIANT];
    const instance = await entry.factory(opts);
    instance._variantName = entry.name;
    instance._variantDisplay = entry.displayName;
    return instance;
}

/** Variant metadata WITHOUT the factory, safe to postMessage. */
export function getVariantMetadata() {
    return Object.values(SOLVER_VARIANTS).map(v => ({
        name: v.name,
        displayName: v.displayName,
        shortLabel: v.shortLabel,
        description: v.description,
        estimatedMoves: v.estimatedMoves,
        estimatedSolveMs: v.estimatedSolveMs,
        beta: !!v.beta,
    }));
}
