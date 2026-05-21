# Solver contract

This document is the canonical specification for the `Solver` interface
defined in [`core/solver/solver-types.js`](../../core/solver/solver-types.js).

Every concrete solver — current and future — must conform to this shape.
The UI (`ui/solve-guide.js`) accepts any conforming solver's output and
renders it the same way.

## Why an interface?

- A new solver can be added without touching UI code.
- Multiple solvers can coexist (e.g., "educational" vs "fast" for the
  same puzzle).
- Tests can swap in a mock solver without rewriting flow code.
- Engagement features (timing, badges) hook into phase boundaries,
  not into specific solver internals.

## Lifecycle

```
1. App loads.
2. App imports concrete solver, constructs it.
3. App optionally calls solver.preload() during browser idle time.
4. User scans cube → app reads state string.
5. App calls solver.solve(state, { onStatus }).
6. solver.solve returns SolveResult { phases, totalMoves, elapsedMs }.
7. App passes SolveResult to ui/solve-guide.js for playback.
8. SolveGuide renders each phase with its displayName + teachingNote,
   plays the moves, calls user-facing animations.
9. On completion, app fires 'solve-complete' event for engagement
   features.
```

## The Solver shape

```javascript
const solver = {
    name: 'reduction-4x4',           // stable ID
    displayName: '人類教學版',         // UI label
    description: '逐步教你 4×4 解題技巧', // UI tooltip (optional)
    N: 4,                            // puzzle size
    supportsTeaching: true,          // phases will include teachingNote
    estimatedMoves: 100,             // informational
    initialized: false,              // true after preload completes

    async preload() {
        // Warm up lookup tables, etc. Idempotent.
    },

    async solve(state, options) {
        // state: string of length 6 * N * N
        // options: { onStatus?: (event, data) => void, signal?: AbortSignal }
        // returns: SolveResult
        // throws: SolverError on unrecoverable failure
    },
};
```

## The SolveResult shape

```javascript
const result = {
    phases: [
        {
            name: 'centers',                // stable ID
            displayName: '1️⃣ 組中心',       // UI label
            moves: [
                { notation: 'Rw', phaseName: 'centers' },
                { notation: "U'", phaseName: 'centers' },
                // ...
            ],
            teachingNote:
                '4×4 沒有固定中心。要先把每面 4 個中心湊成同色，' +
                '才能像 3×3 一樣解。',
            formulaName: null,              // optional
            estimatedMs: 30000,             // optional, for autoplay pacing
        },
        {
            name: 'edges',
            displayName: '2️⃣ 配對邊塊',
            moves: [/* ... */],
            teachingNote:
                '把 12 組邊塊兩兩配對。每對用 F\' R U\' F R\' 套上去。',
            formulaName: 'edge-pair',
        },
        // Optional parity phases — solver includes only if triggered
        {
            name: 'parity-OLL',
            displayName: 'OLL parity 修正',
            moves: [/* parity formula */],
            teachingNote:
                '4×4 特有的怪狀況：一條邊翻轉了。背公式 fix 它。',
            formulaName: 'OLL-parity',
        },
        {
            name: '3x3-kociemba',
            displayName: '3️⃣ 當 3×3 解',
            moves: [/* ... */],
            teachingNote:
                '化簡完成！現在跟 3×3 一樣，套你已經會的方法。',
        },
    ],
    totalMoves: 87,
    elapsedMs: 245,
    solverName: 'reduction-4x4',
    diagnostic: { /* solver-specific debug */ },
};
```

## Error contract

Solvers throw `SolverError` (from `core/infra/errors.js`) on failure.
Common kinds:

| kind                | meaning                                          |
|---------------------|--------------------------------------------------|
| `reduction-failed`  | Algorithm couldn't complete reduction.           |
| `invalid-state3`    | Reduced 3×3 representation is malformed.         |
| `cubejs-failed`     | Underlying 3×3 solver threw.                     |
| `unsolvable`        | State is mathematically unreachable.             |
| `timeout`           | Solver exceeded its time budget (future).        |

Each error carries `phase` (where it occurred), `state` (input,
truncated), and `cause` (the underlying error if any). The UI catches
these and routes through `ui/handoff-error.js` to show a user-friendly
explanation.

## Implementing a new solver — checklist

1. Create `core/solver/<name>.js` (e.g., `tpr-4x4.js`).
2. Export a class with the Solver shape above.
3. Implement `solve(state, options)` returning a `SolveResult`.
4. If using heavy lookup tables, implement `preload()`.
5. On unrecoverable failure, throw `SolverError` with a clear `kind`.
6. Add to `core/solver/solver-registry.js` so the app can list it.
7. Add a Node test under `test/core/test-<name>.js` covering:
   - SOLVED state → empty or near-empty phases.
   - At least 50 random scrambles → all solve correctly.
   - Edge cases (parity for even-N solvers).
8. If using a vendored library, document the license under `NOTICE.md`.

## Adding a new puzzle size — checklist

1. Add `N=newSize` to `core/geometry/cube-geometry-n.js` (FACE_COORDS,
   center indices, edge defs).
2. Add to `core/geometry/perms-n.js` (BASE / WIDE move definitions).
3. Add to `core/state/validator-n.js` (canonical corner / edge multisets).
4. Add a solver for the new size (typically copy reduction.js, adjust
   the N-specific bits).
5. Write `content/teaching-<size>.js`.
6. Create `cube<size>.html` shell (copy from an existing one, change `N`).
7. Add tests to `test/core/` reusing the framework.
