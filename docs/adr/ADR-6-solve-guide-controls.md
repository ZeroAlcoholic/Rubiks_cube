# ADR-6: 解題導航支援自動播放 / 暫停 / 上一步

**Date:** 2026-05-08, **enhanced 2026-05-23** (phase-aware + teaching)
**Status:** Accepted

## Context

純「下一步」按鈕對初學者不夠友善：
- 沒法流暢觀看整個解法
- 不知道現在進度
- 跟錯一步無法回溯

## Decision

底部播放列提供四個按鈕：
- **⏮ 上一步**：執行反向動作，回退一步
- **▶ 自動播放 / ⏸ 暫停**：自動依速度播放完整序列
- **⏭ 下一步**：手動推進

加上速度切換（慢 / 正常 / 快）。

## Implementation

### 上一步反向動作
```
R  → R'
R' → R
R2 → R2 (involution)
Rw → Rw'
```
維護 `executedMoves[]` 歷史堆疊；`previousGuideStep()` pop 最後一步並執行其反向。

### 自動播放
動畫結束後等待 `guideDelayMs`（預設 1500ms，速度切換變更）再自動觸發下一步。

### Phase-aware（2026-05-23 加入）
每步的 move 帶 `stageLabel` 與 `phaseName` metadata：
- 進度顯示為「**1️⃣ 中心歸位 · 第 3 / 21 步**」而非「第 25 / 63 步」
- 換 phase 時 SolveGuide footer 顯示該階段教學文字
- 文字來自 `content/teaching-4x4.js`（per [ADR-7](./ADR-7-modular-architecture.md) modular content）

### Worker offload 配合（2026-05-23）
配 [ADR-10](./ADR-10-cstimer-worker-offload.md)，cstimer 解題在 Worker 中跑時，主 thread 仍可流暢播放動畫（沒有 frozen UI）。
