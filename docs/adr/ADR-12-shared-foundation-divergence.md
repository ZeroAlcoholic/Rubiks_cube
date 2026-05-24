# ADR-12: cube3x3 與 cube4x4 共用底層的已知差異

**Date:** 2026-05-24
**Status:** Accepted (status snapshot, not a forward decision)

## Context

cube3x3.html 與 cube4x4.html 兩個入口點共用許多概念（HSVClassifier、StateValidator、CubeJSSolverAdapter、SolveGuide、camera scanner 等），但**仍各自獨立 inline**（[ADR-7](./ADR-7-modular-architecture.md) 的 Strangler Fig 尚未推進到這些 class）。

審查時發現的差異需要記錄，讓未來抽 module 的人知道哪些需要協調。

## 已修復差異（本 commit）

- ✅ 兩檔 `CubeJSSolverAdapter.ensureAvailable()` 過時錯誤訊息「請確認網路可連線到 unpkg CDN」→ 改為「請確認 vendor/cubejs-1.3.2.js 可被瀏覽器讀取」。cubejs 已 vendored 自 commit ae82410，無 CDN 依賴。
- ✅ cube3x3 補上 `requestIdleCallback` 預熱 `Cube.initSolver()` 區塊，與 cube4x4 同模式。先前 cube3x3 首次解題會多等 3-5 s（桌機）/ 5-15 s（手機）。

## 已知未修差異（記錄供未來抽 module 時參考）

### 1. StateValidator API 形狀不一致

| 檔案 | 類別 | 回傳 shape |
|---|---|---|
| cube3x3.html | `StateValidator3` | `{ ok, errors }` |
| cube4x4.html | `StateValidator4` | `{ ok, errors, severity }` |

`severity` 是 4×4 額外加的（`'fatal'` / `'count'` / `'piece'` / `null`），供 `_finishScanAndSolve` 區分嚴重程度。3×3 沒有對應的多階段 gate，因此沒這欄。

**未來抽 module 時的決議候選**：
- (a) 統一為 4×4 介面，3×3 永遠回 `severity: null`
- (b) 抽 base class，subclass 各自擴增

不在本輪修：兩邊 callers 各自正確處理自己的 shape，無 bug。

### 2. SolveGuide 不同步

| 功能 | cube3x3 | cube4x4 | 註 |
|---|---|---|---|
| `startSolveGuide(moves)` | ✅ | ✅ + `teachingByPhase` 參數 | 4×4 端的擴增 |
| `_guidePhaseInfo()` helper | ❌ | ✅ | 4×4 端為 Reduction 多階段需求 |
| Phase-aware progress text | ❌ | ✅ | 4×4 端的擴增 |
| Teaching footer | ❌ | ✅ | 4×4 端的擴增 |

3×3 不需要這些是因為 LBL solver 目前只標 `stage: 'Kociemba'`，沒更細的 phaseName。若未來 LBL 教學內容寫入並標 phase（centers cross / F2L / OLL / PLL），就會需要把 cube4x4 的這些擴增 backport。

不在本輪修：dead-code 風險（加了 helper 沒人用）。

### 3. 重複的純邏輯類別

- **HSVClassifier**：兩檔 100% 相同
- **CubeJSSolverAdapter**：兩檔 ~95% 相同（4×4 額外含 vendor 載入 fallback 邏輯）

[Task #25](https://github.com/.../tasks/25) 規劃把 SolveGuide 抽到 `ui/solve-guide.js`。同時可順便處理這兩個類別 — 但這要在 cube5x5 啟動、有第二消費者後才動，避免無人受益的早期抽象（[ADR-7](./ADR-7-modular-architecture.md) 的「extracted only when touched」原則）。

### 4. cube3x3 沒有 Worker offload / bench panel

| 功能 | cube3x3 | cube4x4 | 原因 |
|---|---|---|---|
| cstimer Web Worker | ❌ | ✅ ([ADR-10](./ADR-10-cstimer-worker-offload.md)) | 3×3 用 cubejs Kociemba，~ms 級已不需要 |
| `?bench=1` panel | ❌ | ✅ | 3×3 解題很快，bench 收益小 |

刻意分歧，不視為 bug。

## Re-evaluation triggers

- 啟動 cube5x5.html 時：把 SolveGuide、HSVClassifier、CubeJSSolverAdapter 都抽到 `ui/` 與 `core/` 模組（[ADR-7](./ADR-7-modular-architecture.md) 的下一步）。屆時要解決 StateValidator API 不一致。
- 為 cube3x3 寫 LBL 教學內容時：backport phase-aware progress + teaching footer。
- 任何讓 cube3x3 解題感到慢的回報：考慮加 cubejs Worker offload。
