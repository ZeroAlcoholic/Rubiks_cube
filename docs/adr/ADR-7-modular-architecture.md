# ADR-7: Modular architecture via ES Modules + Strangler Fig migration

**Date:** 2026-05-20
**Status:** Accepted
**Supersedes:** Part of ADR-1 (the "single self-contained HTML" principle is
relaxed; see "Decision" below).

## Context

The project started as three independent single-file HTML apps (ADR-1).
Each cube*.html contained its own copy of Three.js orbit controls, color
classifier, state validator, scanner UI, solve guide, and game logic.

After ~15 months of evolution:

- `cube3x3.html` is 7,524 lines.
- `cube4x4.html` is 8,793 lines.
- An audit showed ~70% of the content is duplicated between the two files
  (estimated ~6,700 lines × 2 = 13,400 lines of redundant code).
- Bug fixes routinely require editing both files; in practice, fixes drift —
  the 4×4 progressive-palette work was never back-ported to 3×3.
- Adding 5×5 under the current pattern would add ~6,700 more redundant
  lines and a third synchronization burden.
- A failed csTimer integration attempt was made harder to diagnose because
  there were no explicit interfaces, no structured logs, and no error types
  — only `throw new Error('something')` and substring-matching catch blocks.

The work to add a real working 4×4 solver (the immediate next task)
needs interfaces (Phase[], Solver) and infrastructure (logger, errors)
that don't yet exist. Inventing them inline in cube4x4.html would
deepen the duplication problem rather than relieve it.

## Decision

**Adopt a layered modular architecture using browser-native ES Modules.
No build pipeline.** Migrate from inline-everything to module-per-concern
using the [Strangler Fig pattern](https://martinfowler.com/bliki/StranglerFigApplication.html):
each piece is extracted when next touched, not in a giant rewrite.

### Layers (top to bottom)

1. **Application entry points** (`cube3x3.html`, `cube4x4.html`, `cube5x5.html`):
   Thin shells (~200 lines) that load modules and wire them up.
2. **UI layer** (`ui/*.js`): DOM, Three.js, browser-only. May import from
   domain.
3. **Domain layer** (`core/*.js`): Pure logic, Node-testable. May NOT import
   from UI.
4. **Infrastructure** (`core/infra/*.js`): Logger, errors, perf budgets.
   Imported by everyone.
5. **Vendor** (`vendor/*.js`): Third-party libraries, wrapped by domain
   adapters so the rest of the code doesn't depend on vendor APIs directly.
6. **Content** (`content/*.js`): Pure data — localized teaching text.

See [architecture.md](../architecture.md) for the full layer diagram and
module rules.

### Why ES Modules (not bundlers)

- Modern browsers support ES Modules natively. No webpack, no rollup,
  no tooling.
- GitHub Pages serves static files; `<script type="module" src="...">` works
  out of the box.
- HTTP/2 multiplexing makes many small files acceptable.
- `<link rel="modulepreload">` can be used to warm up critical paths.
- `node` (≥ v14) supports ES modules directly — same imports work for tests.
- Keeps ADR-1's spirit: no framework, no toolchain. Just standard JS.

### Why Strangler Fig (not rewrite)

- Existing scanning + 3D + 3×3 solving works. Rewriting it carries
  regression risk for zero user benefit.
- Migrating piece-by-piece, only as we touch each piece, means each PR is
  small and reviewable.
- If migration stalls, the system still works — the un-extracted parts are
  still inside `cube*.html`.

### What gets extracted first

The active work (modular 4×4 ReductionSolver) pulls these out:

1. `core/infra/logger.js`, `errors.js`, `perf.js` — needed by every layer.
2. `core/solver/solver-types.js` — defines Solver / Phase contract.
3. `core/solver/reduction.js` — the new solver.
4. `core/geometry/perms-n.js`, `cube-geometry-n.js` — extracted from
   inline `buildPerms4()` and `FACE_COORDS`, parameterized by N.
5. `ui/solve-guide.js` — when SolveGuide becomes Phase-aware.

Other parts (StateValidator, HSVClassifier, ScannerView, CubeView3D)
stay inline in `cube*.html` until next touched.

### What stays inline (for now)

Things explicitly NOT extracted in this round:

- Scanner UI (2-shot + 6-face flows) — works, mid-evolution, leave alone.
- StateValidator4 — works.
- CubeView3D — works.
- The huge inline test blocks (`runPhase{N}Tests`) — works as a smoke test
  framework, may extract later.

These continue to live in `cube4x4.html` (and their counterparts in
`cube3x3.html`). Extracting them prematurely is busy-work.

## Consequences

### Benefits

- Adding 5×5 becomes: copy `cube4x4.html` shell, change `N` constant,
  import 5×5-specific content. Estimated 2-3 days vs. previous 5-7 days.
- Bug fixes apply once; no drift between sizes.
- New solvers (TPR fast, LBL educational) are plug-in: implement Solver
  interface, register, done. UI doesn't change.
- Tests get faster: `test/core/` runs pure logic without DOM setup.
- Logs are structured and replayable for bug reports.

### Costs

- Initial setup: ~1-2 days for `core/infra/`, contracts, docs (this work).
- Documentation is now load-bearing — interfaces must be documented or
  the contract benefit is lost. Mitigation: keep contracts under
  `docs/contracts/` and treat them as code.
- Many small HTTP requests per page load. Mitigation: `modulepreload`
  for critical paths; HTTP/2 multiplexes cheaply.
- A page now requires the `core/` directory to function. Mitigation:
  it's all static, ship it together; GH Pages deploys everything.
- New developers (or future-me) have more files to navigate. Mitigation:
  `docs/architecture.md` is the map; module top-comments explain purpose.

### Migration safety

- All Phase 0 work (this commit) is **additive** — creates new files in
  `core/`, `docs/`, `ui/`. Does not modify any existing HTML or JS.
- Phase 1 work (build ReductionSolver in `core/`) is also **additive** —
  the new solver lives in a new file. The existing inline
  `ReductionSolver4` class in `cube4x4.html` stays in place.
- The "switch-over" — replacing the inline solver call with an import
  from `core/solver/reduction.js` — is a separate, small commit done
  only after the new solver passes 100/100 round-trip tests.
- Before any modification to `cube*.html`, a backup will be created
  (`cube*.backup-pre-modular.html`) and committed.

### Reversibility

If this migration proves a mistake (it shouldn't, but), we can:

1. Inline each `core/*.js` module back into `cube*.html`.
2. Delete the `core/` directory.
3. We are back at the pre-ADR-7 architecture.

The migration is therefore low-risk in the rollback dimension.

## Notes on ADR-1

ADR-1 (single self-contained HTML) was correct at project inception —
each file deployable independently, no infrastructure overhead. It has
served us for the first ~6 months of development.

ADR-7 relaxes ADR-1 in the following way: each cube*.html becomes a
**self-contained _page_** (with its own entry point, HTML structure,
inline configuration), but the *logic* lives in shared modules. To run
the project locally or deploy it, you ship the whole repo (HTML +
`core/` + `vendor/`). This is no harder than shipping a single HTML
file because all three sizes were always meant to be deployed
together anyway.

ADR-1's prohibition on frameworks (React, Vue, Angular) **still holds.**
ES Modules are not a framework; they are the JS language.
