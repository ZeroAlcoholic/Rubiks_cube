# ADR-3: 掃描後攝影機彈性鎖定

**Date:** 2026-05-08
**Status:** Accepted

## Context

使用者掃描方塊後進入解題流程。實體方塊和螢幕方塊的方向必須對齊，不然「右轉 90°」對使用者來說會混亂。

兩個極端：
1. **完全自由旋轉**：使用者看不同角度方便，但容易把實體方塊轉到和螢幕不一致
2. **完全鎖死**：方向永遠一致，但使用者看不到背面、無法檢查解題進度

## Decision

掃描完成後攝影機**鎖定**至掃描角度，但允許 **±45° 自由旋轉**（彈性鎖）。動畫播完後平滑 Tween 回鎖定角度。

## Implementation

```js
controls.minAzimuthAngle = scanAzimuth - Math.PI / 4;
controls.maxAzimuthAngle = scanAzimuth + Math.PI / 4;
// 動畫結束時 Tween camera 回 scanAzimuth
```

## Consequences

### Benefits
- 使用者翻看不同角度仍可
- 但永遠回得到「跟手上方塊一致」的視角
- 「右轉」永遠是螢幕上看到的右轉

### Costs
- 看背面（180° 對側）需要使用者轉動實體方塊
- 部分使用者可能想自由旋轉 → 提供「解鎖視角」選項做安全閥
