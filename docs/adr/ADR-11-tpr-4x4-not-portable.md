# ADR-11: TPR-4x4 直接整合不可行；cstimer-444 是 JS 生態的天花板

**Date:** 2026-05-24
**Status:** Accepted (research outcome — decision is "stay")

## Context

[ADR-8](./ADR-8-cstimer-symmetry-workaround.md) 提到「未來可考慮換 TPR-4x4-Solver 直連 API，預期 6× 速度（250 ms / 44 步），同時移除 24-rotation 對稱性 workaround」。本 ADR 是該想法的可行性研究結論。

## Investigation

### Q1：TPR-4x4x4-Solver 是 JS 嗎？

**No.** [cs0x7f/TPR-4x4x4-Solver](https://github.com/cs0x7f/TPR-4x4x4-Solver) 是 **99.8% Java** 專案，發布形式是 `threephase.jar` + `twophase.jar`，靠 JVM 跑（`java -cp . :threephase.jar:twophase.jar`）。

> Tables are generated at runtime on first execution: "about 20M's tables will be generated and written to disk"

20MB 表是 Java 程式碼**runtime 算出來**並 cache 到磁碟。瀏覽器既沒 JVM 也沒磁碟 cache（只有 IndexedDB），這 pattern 不能直接搬。

### Q2：有現成 JS port 嗎？

**No.** 廣泛搜尋 GitHub：

| 專案 | 4×4 ? | 純 JS ? | 適合我們 ? |
|---|---|---|---|
| cs0x7f/TPR-4x4x4-Solver | ✅ | ❌ Java | ❌ |
| cs0x7f/cstimer (含 scramble_444) | ✅ | ✅ | ✅ **已整合** |
| ldez/cubejs | ❌ 3×3 only | ✅ | ✅ 已整合（3×3 收尾用）|
| torjusti/cube-solver | ❌ 3×3 only | ✅ | — |
| dwalton76/rubiks-cube-NxNxN | ✅ | ❌ Python + GB-level 表 | ❌ |

純 JS 的 4×4 IDA* solver 在 JS 生態裡**只有 cstimer 一支**。

### Q3：替代路徑（如果真的非要 TPR 性能）

| 路徑 | 工作量 | 風險 | 結論 |
|---|---|---|---|
| Java 手動 port 到 JS | 數週 | 高（演算法複雜） | 不值得 |
| Java → WASM (TeaVM / GraalVM) | 數天 | 中（build tool + 大檔案） | 違反 ADR-7 「不引入 build」 |
| Java → server-side endpoint | 1 天 | 低 | **違反 CLAUDE.md 「零後端」** |
| 自己從零實作 TPR | 數週 | 高 | 不值得 |

## Decision

**不整合 TPR-4x4。保留現有 cstimer-444 + ADR-8 workaround + ADR-10 worker offload 組合。**

理由：
1. 我們已經有 JS 生態最好的 4×4 solver
2. 現有 pipeline 經過充分 tune（median 552 ms, p95 4 s, 0 失敗 in 240+ scrambles）
3. 任何替代路徑都需要違反一條既有 ADR（零後端、不引入 build、或巨額時間投入）
4. 性能不是瓶頸：median <600 ms 對使用者來說已經是「按下就出」

## Consequences

### Benefits
- 維持架構簡潔（純前端、無 build、無後端）
- 240+ scramble 已驗證的穩定性
- 程式碼量小（reduction.js ~770 行 + cstimer-444.js vendored）

### Costs（我們選擇承擔）
- 解步數 60 步而非理論最低 44 步 → 多出約 5-10 秒動畫時間
- p95 4 s vs 理論 250 ms → 偶爾使用者要等
- ADR-8 的 ~150 行對稱性 workaround 程式碼留著

### 取消的後續工作
- ~~移除 _COORD_ROTS / _ROT_PRIORITY / pre-move fallback~~（[ADR-8](./ADR-8-cstimer-symmetry-workaround.md) 保留為永久解）
- ~~bundle vendor/tpr-4x4.js~~（不可能）
- ~~6× 速度承諾~~（理論上限不可達）

## Future re-evaluation triggers

下列任一發生再重啟此議題：
- cs0x7f 或第三方發布純 JS 版 TPR
- 我們有 dev 願意花 2 週手動 port Java → JS
- WCA 規範允許某種 build-tool 妥協（不太可能）
- 使用者 feedback 說「等太久」（目前 P95 4s 對 4×4 解題流程是可接受的）

## References

- TPR upstream: <https://github.com/cs0x7f/TPR-4x4x4-Solver>
- cstimer upstream: <https://github.com/cs0x7f/cstimer>
- 相關 ADR：[ADR-4](./ADR-4-solver-choices.md), [ADR-8](./ADR-8-cstimer-symmetry-workaround.md), [ADR-10](./ADR-10-cstimer-worker-offload.md)
