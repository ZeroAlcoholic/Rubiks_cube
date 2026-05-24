# rubiks_cube — Architecture

This project is a family of three single-page web apps (3×3, 4×4, 5×5)
that let kids scan a physical Rubik's cube with their phone camera, then
walk through a step-by-step animated solution that teaches the underlying
method (LBL for 3×3, Reduction for 4×4 / 5×5).

This document describes the layered code organization adopted in
[ADR-7](./adr/ADR-7-modular-architecture.md). Before ADR-7 the entire
app lived in a single ~8k-line HTML file per cube size, with ~70%
duplication between files. The new structure factors shared logic into
small ES modules under `core/` and `ui/`.

## Architecture Decision Records

Foundational decisions (extracted from `CLAUDE.md`):
- [ADR-1](./adr/ADR-1-three-html-files.md) — 三個獨立 HTML 入口
- [ADR-2](./adr/ADR-2-n-parameterized-geometry.md) — 以 N 參數化幾何
- [ADR-3](./adr/ADR-3-elastic-camera-lock.md) — 掃描後攝影機彈性鎖定
- [ADR-4](./adr/ADR-4-solver-choices.md) — 解題器選擇（隨尺寸）
- [ADR-5](./adr/ADR-5-tilted-2shot-scan.md) — 所有尺寸皆支援斜角 2 張掃描
- [ADR-6](./adr/ADR-6-solve-guide-controls.md) — 解題導航控制
- [ADR-7](./adr/ADR-7-modular-architecture.md) — Modular architecture + Strangler Fig

Solver implementation decisions (this work):
- [ADR-8](./adr/ADR-8-cstimer-symmetry-workaround.md) — cstimer 48-element 對稱性 bug workaround
- [ADR-9](./adr/ADR-9-rotation-priority-order.md) — Rotation 嘗試順序依命中分布重排
- [ADR-10](./adr/ADR-10-cstimer-worker-offload.md) — cstimer genFacelet 移到 Web Worker
- [ADR-11](./adr/ADR-11-tpr-4x4-not-portable.md) — TPR-4x4 直接整合不可行；cstimer-444 是 JS 生態天花板

## Layer diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ Application entry points (thin shells, ~200 lines each)         │
│   index.html        — picks 3×3 / 4×4 / 5×5                     │
│   cube3x3.html      — loads modules, sets N=3, wires up         │
│   cube4x4.html      — loads modules, sets N=4, wires up         │
│   cube5x5.html      — loads modules, sets N=5, wires up         │
└─────────────────────────────────────────────────────────────────┘
                              ↓ imports
┌─────────────────────────────────────────────────────────────────┐
│ UI layer  (DOM + Three.js — browser-only)                        │
│   ui/rubiks-game.js      — top-level orchestrator                │
│   ui/cube-view-3d.js     — Three.js rendering                    │
│   ui/scanner-view.js     — camera + overlay UI                   │
│   ui/solve-guide.js      — Phase-aware step playback             │
│   ui/teaching-panel.js   — educational notes display             │
│   ui/handoff-error.js    — standardized error modal              │
└─────────────────────────────────────────────────────────────────┘
                              ↓ imports
┌─────────────────────────────────────────────────────────────────┐
│ Domain layer  (pure logic, Node-testable, no DOM)                │
│   core/state/                                                    │
│     state.js               — state string ops, conversions       │
│     validator-n.js         — N-parameterized validator           │
│     moves.js               — notation parsing, inversion, apply  │
│   core/geometry/                                                 │
│     cube-geometry-n.js     — FACE_COORDS by N                    │
│     perms-n.js             — buildPerms(N) → permutation table   │
│   core/solver/                                                   │
│     solver-types.js        — Solver / Phase / Move JSDoc         │
│     solver-registry.js     — N → available solvers               │
│     kociemba-3x3.js        — wraps vendor/cubejs                 │
│     reduction.js           — N-aware Reduction (4×4, 5×5)        │
│     (future) tpr-4x4.js    — fast solver                         │
│     (future) lbl-3x3.js    — educational layer-by-layer          │
│   core/scanner/                                                  │
│     classifier-lab.js      — Lab color classifier                │
│     calibrator.js          — progressive palette                 │
│     confidence-gate.js     — handoff gate logic                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓ imports
┌─────────────────────────────────────────────────────────────────┐
│ Infrastructure layer  (cross-cutting concerns)                   │
│   core/infra/logger.js       — structured categorized logging    │
│   core/infra/errors.js       — explicit error types              │
│   core/infra/perf.js         — performance budgets + measurement │
│   core/infra/persistence.js  — localStorage wrappers (TODO)      │
└─────────────────────────────────────────────────────────────────┘
                              ↓ imports
┌─────────────────────────────────────────────────────────────────┐
│ Vendor layer  (third-party, vendored verbatim)                   │
│   vendor/cubejs-1.3.2.js   — 3×3 Kociemba solver (MIT)           │
│   vendor/cstimer-444.js    — 4×4 cstimer scramble (GPL-3.0)      │
│   vendor/three-r128.min.js — Three.js rendering (MIT)            │
│   vendor/orbit-controls.js — Three.js orbit controls (MIT)       │
└─────────────────────────────────────────────────────────────────┘
                              ↑
┌─────────────────────────────────────────────────────────────────┐
│ Worker layer  (off-main-thread compute — see ADR-10)             │
│   workers/cstimer-worker.js  — runs cstimer IDA* in a Web Worker │
└─────────────────────────────────────────────────────────────────┘
                              ↑
┌─────────────────────────────────────────────────────────────────┐
│ Content layer  (educational text, by language/level)             │
│   content/teaching-3x3.js     — (TBD) Chinese LBL teaching       │
│   content/teaching-4x4.js     — Chinese Reduction teaching notes │
│   content/teaching-5x5.js     — (TBD) Chinese Reduction extended │
└─────────────────────────────────────────────────────────────────┘
```

## Module rules

1. **Domain (`core/`) MUST NOT import from UI (`ui/`)** — domain is pure
   and Node-runnable. Reverse direction is required.
2. **Domain MUST NOT touch DOM, `window`, Three.js, or any browser global.**
   Test by attempting `node -e "import('./core/x.js')"`.
3. **UI MAY import from domain** to invoke logic, display results.
4. **Infrastructure (`core/infra/`) is the bottom of the dependency tree** —
   imported by everyone, imports nobody (except other infra modules).
5. **Vendor is treated as opaque** — wrapped by an adapter module under
   `core/solver/` so the rest of the code never sees vendor APIs directly.
6. **Content is data-only** — no logic, just exported constants and
   localized strings.

## File size guidelines

- Each module should be **< 500 lines**. If approaching that, factor out a
  helper module.
- HTML entry points should be **< 250 lines**. If logic is creeping in,
  push it into a `ui/` module.
- No file should have multiple unrelated responsibilities. A solver is a
  solver, a renderer is a renderer.

## Testing strategy

- **`test/core/`** — pure-logic tests, Node-runnable. Fast (< 1s total).
  No DOM, no Three.js. Imports core modules directly via ES imports.
- **`test/e2e/`** — in-browser tests using the inline `?test=N` URL
  parameter pattern that already exists. Tests full UI flows.
- **`test/fixtures/`** — shared test data: known scrambles, expected
  states, sample classifier inputs.

A failing test in `test/core/` should never need a browser to reproduce.

## Performance budgets

See [`core/infra/perf.js`](../core/infra/perf.js) for the canonical list.
Notable:

- `kociemba-init`: ≤ 6 seconds (preloaded at idle time so users never wait)
- `reduction-solve-4x4`: ≤ 1 second
- `scan-frame-classify`: ≤ 100 ms per frame
- `state-validate-4x4`: ≤ 10 ms

Exceeding a budget emits a `[PERF] budget-exceeded` log event. Track
these — they indicate either a code regression or a needed budget update.

## Migration status

This architecture is being adopted via [Strangler Fig](https://martinfowler.com/bliki/StranglerFigApplication.html) —
old code stays in `cube*.html` until each piece is extracted.

### Done
- ✅ `vendor/cubejs-1.3.2.js` — extracted (commit ae82410)
- ✅ `vendor/cstimer-444.js` — bundled (commit b3685eb)
- ✅ `core/infra/{logger,errors,perf}.js` — infra layer
- ✅ `core/geometry/{cube-geometry-n,perms-n}.js` — N-parameterized geometry
- ✅ `core/solver/reduction.js` — full N=4 pipeline (centers BFS + cstimer edges/parity + cubejs 3×3)
- ✅ `content/teaching-4x4.js` — per-phase teaching strings
- ✅ `workers/cstimer-worker.js` — cstimer offloaded to Web Worker (ADR-10)
- ✅ `cube4x4.html` solve path routes through modular ReductionSolver

### In progress / partial
- 🟡 `ui/solve-guide.js` — phase-aware logic exists in-place in cube4x4.html;
  module extraction deferred until cube5x5 needs it (no second consumer yet)
- 🟡 `core/state/`, `core/scanner/` — pieces still inline in cube*.html

### Not started
- ⏳ `cube3x3.html` modular migration — currently still inline-everything; the
  3×3 path is stable, no immediate trigger to migrate
- ⏳ `cube5x5.html` — pending edge-triplet algorithm design (no cstimer 5×5
  equivalent to delegate to)

The inline `ReductionSolver4` class in `cube4x4.html` is mostly dead —
its `solve()` method is no longer called by the production path, only
`CENTER_IDXS` static field is referenced by the HSV classifier and unfold
map. A future cleanup commit can shrink that class to a single export.

When all modules are extracted, `cube*.html` becomes a ~200-line shell.
Until then, both old (inline) and new (modular) code can coexist —
inline code remains the source of truth for any module not yet extracted.
