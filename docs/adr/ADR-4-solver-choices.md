# ADR-4: 解題器選擇（隨尺寸）

**Date:** 2026-05-08, **revised 2026-05-23** (4×4 solver decisions)
**Status:** Accepted (revised)

## Context

不同尺寸需要不同的解題器，且同一尺寸內可能有「教學版」和「速解版」兩種需求：
- 3×3：學習者要看 LBL，老手要看最少步數
- 4×4 / 5×5：Reduction 必須先化簡為 3×3 才能用 3×3 solver 收尾

## Decision

### 3×3

| Solver | 適合對象 | 步數 | 來源 |
|---|---|---|---|
| **LBL（層先法）** | 學習者 | 80-120 | 純 JS 內嵌，7 階段，含教學說明 |
| **Kociemba** | 看最少步 | ≤ 22 | `vendor/cubejs-1.3.2.js`（已內嵌，**不是** CDN）|

**修正**：原 ADR-4 寫「min2phase CDN」。實作上採用 `vendor/cubejs-1.3.2.js` Kociemba 實作並 bundle 到 repo，不從 CDN 載；理由是 GitHub Pages 部署可靠性 + 離線可用。

### 4×4

| 階段 | Solver | 步數平均 | 來源 |
|---|---|---|---|
| **Centers** | 自有 BFS 查表 | 18-19 | `core/solver/reduction.js`（pair-UD / pair-FB / sort-joint 三段 BFS）|
| **Edges + Parity + 3×3** | cstimer `scramble_444.genFacelet` | 40+ | `vendor/cstimer-444.js`（cs0x7f IDA*）|

cstimer 為 scramble 產生器，反向使用後遇到 48-element 對稱性 bug；workaround 詳見 [ADR-8](./ADR-8-cstimer-symmetry-workaround.md)。

### 5×5（規劃中）

| 階段 | Solver | 來源 |
|---|---|---|
| Center strips | 自有 BFS（同 4×4 思路擴增到 9-block strip） | (TBD) |
| Edge triplets | 自有 IDA*（cstimer 沒提供） | (TBD) |
| 3×3 + parity | Kociemba | `vendor/cubejs-1.3.2.js` |

## Loading strategy

- LBL / Kociemba：頁面載入時就 ship（已內嵌）
- cstimer 4×4：頁面載入時 ship；Web Worker 中執行以不擋主 thread（[ADR-10](./ADR-10-cstimer-worker-offload.md)）
- 不從 CDN 即時下載任何 solver
- `requestIdleCallback` 預熱所有 solver 的 lookup tables
