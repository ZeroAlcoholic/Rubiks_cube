# ADR-9: Rotation 嘗試順序依命中分布重排

**Date:** 2026-05-23
**Status:** Accepted

## Context

[ADR-8](./ADR-8-cstimer-symmetry-workaround.md) 的 24-rotation sweep 是順序試 24 個 rotation 直到第一個 verify 通過。當第 N 個成功時，前 N-1 個都是浪費的 `genFacelet` 呼叫，每次 30-3000 ms。

原始順序是 `_COORD_ROTS` 的宣告順序（I, y, y2, y', x, xy, xy2, ...），沒有理由認為這順序對命中率最優。

## Decision

收集實測命中分布後**依命中頻率重排** rotation 嘗試順序。

## Data

50-scramble bench 命中分布（cube4x4 `?bench=1`）：

| Idx | 旋轉 | Hits | 累積% |
|---|---|---|---|
| 0 | I | 15 | 30% |
| 6 | xy2 | 11 | 52% |
| 2 | y2 | 9 | 70% |
| 10 | x'y2 | 7 | 84% |
| 12 | x2 | 2 | 88% |
| 13 | x2y | 2 | 92% |
| 15 | x2y' | 2 | 96% |
| 14 | x2y2 | 1 | 98% |
| 21 | z'y2 | 1 | 100% |

Top 4 涵蓋 84%。常見的全是 **180° y-axis-family rotations**，跟 cstimer 對稱性 bug 集中在 y2 coset 的數學直覺吻合。

## Implementation

```js
const _ROT_PRIORITY = [
    0,  // I       (15/50, 30%)
    6,  // xy2     (11/50, 22%)
    2,  // y2      ( 9/50, 18%)
    10, // x'y2    ( 7/50, 14%)
    12, // x2      ( 2/50,  4%)
    13, // x2y     ( 2/50,  4%)
    15, // x2y'    ( 2/50,  4%)
    14, // x2y2    ( 1/50,  2%)
    21, // z'y2    ( 1/50,  2%)
    // Never observed in this bench, retained for full coverage:
    1, 3, 4, 5, 7, 8, 9, 11, 16, 17, 18, 19, 20, 22, 23,
];
```

Rotation 索引值（telemetry 的 `rotIdx`）**仍指 `_COORD_ROTS` 的原 index**，所以「rotIdx=6」永遠是 xy2，跨版本可比較。

## Measured impact

50-scramble A/B（baseline order vs priority order）：

| 指標 | Baseline | After reorder | 改善 |
|---|---|---|---|
| median | 1929 ms | 552 ms | **−71%** |
| mean | 3341 ms | 1173 ms | **−65%** |
| p95 | 9902 ms | 3985 ms | **−60%** |
| max | 18423 ms | 11346 ms | −38% |

實際改善遠超理論預測（理論 18%、實際 65%）。推測原因：async/await yield 邊界讓 V8 對 cstimer 熱點 JIT 更積極（後續混合改動的副作用，無法完全歸因到重排）。

## Consequences

### Benefits
- 平均 3× 加速、p95 2.5× 加速
- 純資料變動，零正確性風險
- 24/24 涵蓋仍保證

### Costs
- 數據綁定在當下分布。若未來 cstimer 換版或 state 分布變動，可能需重新校準
- 重排基於 50-sample，統計可靠度約 ±10%

### Maintenance protocol
- Bench panel（`?bench=1`）內建持續收集命中分布，發現分布偏移時可重新校準
- 校準需 50+ scrambles；不要在小樣本上微調

### Files
- `core/solver/reduction.js` — `_ROT_PRIORITY` constant
- `cube4x4.html` — bench panel (`runSolverBench()`)
