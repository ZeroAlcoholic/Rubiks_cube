# ADR-8: cstimer 48-element 對稱性 bug workaround

**Date:** 2026-05-23
**Status:** Accepted

## Context

`vendor/cstimer-444.js` 的 `scramble_444.genFacelet(state)` 是設計給「產 scramble」用，不是給「解任意 state」用。我們把它倒過來用（`inverseMoves(genFacelet(S))` 解 S），對絕大多數 state 工作正常，但對 ~8-17% 的特定 state 會回傳**錯誤解**：
- cstimer 接受 state 為合法（`chk = 0`）
- 回傳 42-44 步的 scramble M
- 但 `applyMoves(SOLVED, M)` 不等於原 state S，而是 S 的某對稱等價狀態
- `inverseMoves(M)` 套用到 S 後不回到 SOLVED

### 根本原因

cstimer 內部用 **48-element 對稱群**做 IDA* 剪枝：
- 24 個 proper rotations（cube 的旋轉子群）
- 24 個 reflections（鏡像；物理上方塊轉不出來）

當 state S 落在「兩個對稱類在某種維度上有歧義」的位置時，cstimer 的內部 `finishSym` 選錯類別，回的 scramble 對應到鏡像版本。

來源依據：
- [cs0x7f/cstimer/blob/master/src/js/scramble/scramble_444.js](https://github.com/cs0x7f/cstimer)
- Jaap's Puzzle Page — Rubik's Cube symmetries
- Wikipedia — Rubik's Cube group, O_h symmetry group

## Decision

**多階段 workaround，全在我們程式內**，不修 cstimer：

### 第一階段：24-rotation coord_rotate sweep

對 state S 試 24 個 proper rotation R：
1. `S' = coord_rotate(S, R)` = 物理旋轉 + 顏色 relabel
2. `M = inverseMoves(genFacelet(S'))`
3. `candidate = conj_R(M)`（把 R 帳上的旋轉 conjugate 回原 frame）
4. 驗證 `applyMoves(S, candidate) === SOLVED`，第一個通過的接受

24 rotation 涵蓋約 92% 案例。

### 第二階段：pre-move fallback

對於剩下 ~8% 跨越 chirality 的 state，所有 24 rotation 都失敗。原因：他們只能映射到鏡像類，沒有 proper rotation 能修。

**對策**：套用一個 **outer move（不破壞中心）**把 state 推到不同 chirality coset：
- 順序試：`[]` → `[U]` → `[R]` → `[F]` → `[U2]` → `[R2]`
- 每個 pre-move 都重跑 24-rotation sweep
- 經驗：100/100 case 都在 `[]`、`[U]`、`[R]` 中找到解
- 後面的 fallback 保留作為冗餘安全網

最終解 = `[pre_moves, ...candidate]`

## Consequences

### Benefits
- 240/240 累積測試 0 失敗
- 完全在前端，不需要修 cstimer
- 不需要 fork、不需要 build tool

### Costs
- Worst-case 144 次 `genFacelet` 呼叫（6 pre-moves × 24 rotations），實際幾乎不會打到
- 平均每解多了 1-3 次無效 genFacelet（已用 [ADR-9](./ADR-9-rotation-priority-order.md) 重排優化）
- 解步數比 cstimer 直接 solve API 多（60+ vs 預期的 44），這是用 scramble API 反向解的代價

### Files implementing this
- `core/solver/reduction.js` — `_COORD_ROTS`, `_ROT_PRIORITY`, `_solveEdgesAndBeyond`
- `test/core/diag_premove_fallback.js` — 驗證 fallback 策略
- `test/core/diag_cstimer_chk.js` — 證實 chk=0 但解錯的內部機制

## Future

如果 `vendor/tpr-4x4.js`（cs0x7f 的正規 solve API）被整合，這整套 workaround 可以拆除，預期同時拿到 6× 速度提升和 30% 短解。當前優先級不高。
