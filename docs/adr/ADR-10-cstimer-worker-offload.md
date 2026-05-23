# ADR-10: cstimer genFacelet 移到 Web Worker

**Date:** 2026-05-24
**Status:** Accepted

## Context

`cstimer.scramble_444.genFacelet` 是 synchronous IDA* 搜索，單次呼叫 30 ms 到 3 s 不等。配合 [ADR-8](./ADR-8-cstimer-symmetry-workaround.md) 的 24-rotation + pre-move fallback，極端情況可累積到 88 秒。這整個時間主 thread 完全卡死：
- 3D 動畫凍結
- 按鈕點不到
- 連 SolveGuide 的 progress text 都不更新（即使我們嘗試用 `setTimeout(0)` yield 也只能在 rotation 之間 yield，單次 cstimer 呼叫內無法）

GitHub Pages 部署限制：
- ✅ 一般 Web Worker 可用
- ❌ SharedArrayBuffer 需要 COOP/COEP header（GH Pages 無法設）
- 但本案不需要 SharedArrayBuffer

## Decision

把 `cstimer.genFacelet` 的呼叫**整個搬到 Web Worker**，主 thread 透過 postMessage 跟 worker 對話。

## Implementation

### Worker (`workers/cstimer-worker.js`)
- Classic worker，用 `importScripts` 載 `vendor/cubejs-1.3.2.js` + `vendor/cstimer-444.js`
- 用 module worker 不行因為 vendor 是 pre-modular IIFE globals
- Stub host globals：`$`, `DEBUG`, `scrMgr`, `image`, `isaac`
- 訊息協定：
  - inbound `{ id, type: 'init' | 'genFacelet', state? }`
  - outbound `{ id, type: 'init-done' | 'result' | 'error', result? | error? }`

### Main thread proxy
- `createCstimerWorkerProxy(onFatal)` 回傳 `{ init, genFacelet }`，介面跟 sync vendor 一致
- 用 Promise + pending Map 把 postMessage 換成 await-able 函式
- `onFatal` callback：worker 死亡（importScripts 404 / CSP block / runtime crash）時觸發 fallback：
  ```js
  solver.cstimerCaller = null;       // 解除 proxy
  solver._preloadPromise = null;     // 讓 preload 重跑
  window.__reduction.ready = solver.preload().then(...);  // 用主 thread cstimer
  ```

### Solver integration
- `ReductionSolver` 加 `cstimerCaller` 欄位
- `_solveEdgesAndBeyond` 改 async + `await csTimer.genFacelet(state)`
- `await` 對 sync 字串是 no-op、對 Promise 是 wait
- Node tests 不設 `cstimerCaller`，走原本 sync 路徑

## Measured impact

主 thread 響應度測試（25-move scramble，1238 ms solve）：
- 期望每 50 ms 一次 tick → 應該有 ~25 ticks
- 實測：**24 ticks**，最大 gap **54 ms**
- → 主 thread 在 worker 解題期間 **100% 可響應**

未在 main thread 跑 cstimer 時：3D 動畫流暢、按鈕可點、SolveGuide progress 即時更新。

## Consequences

### Benefits
- 88 秒 outlier 不再凍 UI
- 為「取消按鈕」（terminate worker）鋪路
- 為「多解平行嘗試」鋪路（多個 worker）

### Costs
- 主 thread + worker **各有一份 cubejs/cstimer 在記憶體**（cubejs 12 MB 表 × 2 = ~24 MB 多佔）。可接受
- 每次 `genFacelet` 多一次 postMessage round-trip（~ms 級，相對 30-3000 ms 的 cstimer 工作可忽略）
- Worker 載入失敗的 fallback 邏輯增加 ~30 行程式碼複雜度

### Fallback robustness
Worker 失敗的 3 種情境，都能 fallback 到主 thread：
1. `new Worker(...)` 拋 — `try/catch` 回 null，host 偵測到後不設 cstimerCaller
2. `importScripts` 404 / CSP block — worker.onerror 觸發 → `onFatal` → preload 重跑用主 thread
3. Runtime crash — 同上

### Files
- `workers/cstimer-worker.js` — new
- `cube4x4.html` — `createCstimerWorkerProxy()` + `onFatal` callback
- `core/solver/reduction.js` — `cstimerCaller` field + `await` in `_solveEdgesAndBeyond`

## Future

- 加「取消解題」按鈕：UI 端 `worker.terminate()` → 解題流程 abort，新建 worker 接手下次 solve
- 多 worker 平行嘗試不同 pre-move：worst-case 解題時間可進一步壓低
- 若採用 [ADR-4 提及的 TPR 直連](./ADR-4-solver-choices.md)，worker offload 仍然有用（TPR 也是 sync IDA*）
