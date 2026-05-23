# ADR-2: 以 N 參數化幾何

**Date:** 2026-05-08
**Status:** Accepted

## Context

3×3 / 4×4 / 5×5 各有不同的座標、貼紙數、層數、座標值。如果各自寫死數字（54, 96, 150 / -1,0,1 / -1.5,-0.5,0.5,1.5 / -2,-1,0,1,2 …），每個尺寸要維護一份重複邏輯。

## Decision

把 N 當成 first-class 參數，從一個 `this.N = 3/4/5` 推導所有與尺寸相關的計算。

## Implementation

- 座標值：`getSlicePositions(N)` 回傳 N 個層的 XYZ 座標
- 外面條件：`Math.abs(coord) === halfExtent(N)`（N=3 → 1, N=4 → 1.5, N=5 → 2）
- 貼紙數：`6 * N * N`
- 中心位置（face-local index）：N=3 中心是 [4]，N=4 是 [5,6,9,10]，N=5 是 [12]
- 邊塊定義表：N=4 邊塊有 12 對；N=5 邊塊有 12 三元組

## Consequences

### Benefits
- 擴充到新尺寸只改一個 N
- 算法一份程式服務多尺寸
- 測試容易（注入不同 N 跑同一條測試）

### Costs
- 邊角案例（5×5 有 fixed center、4×4 沒有）仍需特殊處理
- 演算法本身的「Reduction order」對不同 N 不一定相同（4×4 是 centers → edges → 3×3，5×5 是 strips → triplets → 3×3）

### Files implementing this
- `core/geometry/cube-geometry-n.js` — coords, FACE_ORDER, total stickers
- `core/geometry/perms-n.js` — buildPerms(N)
- `core/solver/reduction.js` — solver constructor takes N
