# ADR-1: 三個獨立 HTML 入口（每個尺寸一個）

**Date:** 2026-05-08 (extracted from CLAUDE.md history)
**Status:** Accepted, scope refined by [ADR-7](./ADR-7-modular-architecture.md)

## Context

魔術方塊掃描解題系統需要支援 3×3、4×4、5×5 三種尺寸。三種尺寸的核心邏輯類似（鏡頭掃描、3D 渲染、解題、引導），但細節差很多：
- 3×3：54 stickers、LBL 解法
- 4×4：96 stickers、Reduction 解法（centers → edges → 3×3）
- 5×5：150 stickers、Reduction 解法（centers strip → edge triplets → 3×3）

選項：
1. 一個 HTML 含三種尺寸切換
2. 每個尺寸一個 HTML

## Decision

採方案 2：cube3x3.html / cube4x4.html / cube5x5.html，每個尺寸獨立。

## Consequences

### Benefits
- 5×5 全功能單檔估計 5,000–6,000 行；切到三個檔讓單檔規模可控
- 各尺寸獨立可單獨部署、測試、除錯
- 修一個尺寸不會打到其他尺寸的程式

### Costs
- 共用程式碼（HSV 分類器、鏡頭 UI、動畫引導）在三個檔案中**重複** ~70%
- 修 bug 要在三個檔同步（實際常漂移）

### Mitigation
- 設計時維持模組內聚，複製貼上後只需調整 `this.N` 和 Reduction 算法
- **後續以 [ADR-7](./ADR-7-modular-architecture.md) 修正**：核心邏輯抽到 ES 模組，HTML 變薄殼
