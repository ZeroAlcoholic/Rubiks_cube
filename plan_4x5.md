# 4×4 / 5×5 實作計畫

## 背景
- `cube3x3.html` 完成後複製為 `cube4x4.html`，再從 4×4 複製為 `cube5x5.html`
- 每個檔案自包含（HTML+CSS+JS 全部內嵌），不需要 build tool
- 架構目標：`this.N` 改成 4 或 5，幾何自動推導；解題算法替換即可

---

## Phase A — Web Worker 架構（橫跨所有尺寸）

**動機**：4×4 Reduction 需 0.5–5 秒，5×5 需 5–30 秒，主執行緒跑這段會凍結 UI。

### 實作
```
主執行緒                  Web Worker
RubiksGame.startSolve()
  → postMessage({state})  →  ReductionSolver.solve(state)
                          ←  postMessage({steps[]})  (完成或分段)
  ← onmessage(steps)
  → 交給 SolveGuideUI 播放
```

- Worker blob URL 從 `<script type="text/plain" id="solver-worker-src">` 區塊取出，`URL.createObjectURL(new Blob([src], {type:'application/javascript'}))`
- Worker 用 `importScripts` 不可行（blob origin），故 solver 程式碼內嵌在 Worker src 中
- 錯誤處理：Worker 拋出例外 → 主執行緒顯示 toast，提供「手動輸入步驟」的備案

### 測試
- [ ] Worker 初始化後 `postMessage({type:'ping'})` 收到 `{type:'pong'}`
- [ ] 傳入 solved state → Worker 回傳空步驟陣列
- [ ] 傳入隨機打亂 state → Worker 在 30 秒內回傳；主執行緒 UI 不凍結（可繼續點按）
- [ ] Worker 回傳 steps → SolveGuideUI.startGuide(steps) 正常播放

---

## Phase B — 4×4 幾何與旋轉

### `this.N = 4` 幾何
- 座標值：`-1.5, -0.5, 0.5, 1.5`（共 4 個切片）
- `getSlicePositions()` 回傳這 4 個值
- 外面條件：`Math.abs(coord) === 1.5`（而非 3×3 的 1.0）
- 無固定中心（4×4 中心是邊中點，可互換）
- 可見方塊：56 個（總數 64，減去內部 8）
- 貼紙數：96（每面 16）

### `rotateWideSlice(axis, slicePositions[], angle)`
- 同時旋轉多個切片（廣域動作 Rw = 最外 2 層）
- `slicePositions = [0.5, 1.5]`（x 軸的最外 2 層）
- 對每個方塊：若其 axis 座標在 `slicePositions` 內，套用旋轉矩陣
- 動作字典：
  ```js
  'Rw':  { axis:'x', slices:[0.5,1.5],  angle:-90 }
  'Rw2': { axis:'x', slices:[0.5,1.5],  angle:-180 }
  "Rw'": { axis:'x', slices:[0.5,1.5],  angle:+90 }
  'Uw':  { axis:'y', slices:[0.5,1.5],  angle:-90 }
  // 以此類推 Lw, Dw, Fw, Bw
  ```

### `readCurrentState4()` / `setState4(state96)`
- 和 3×3 同邏輯，但 FACE_COORDS 4×4 版本需列出 16 個座標
- 狀態字串：96 字元，順序 URFDLB，每面 16 字元（row-major，外側視角）

### 測試
- [ ] N=4 cube 正確顯示 56 個可見方塊
- [ ] `rotateWideSlice('x', [0.5, 1.5], -Math.PI/2)` 讓最外 2 層 x 方向同步旋轉，動畫流暢
- [ ] `readCurrentState4()` 在 solved 狀態返回 96 字元全為正確面色
- [ ] `setState4(scrambled96)` 後 `readCurrentState4()` 返回相同字串
- [ ] 隨機執行 20 個廣域動作後，`readCurrentState4()` 與手動追蹤一致

---

## Phase C — ReductionSolver4（4×4 解題）

### 算法概述（Reduction 法）
```
Step 1: Centers（6 面各 4 個中心塊 → 正確排列）
Step 2: Edges（12 組各 2 個邊塊 → 配對成 2-block edge pair）
Step 3: Parity 檢測與修正
  - OLL Parity：奇數邊翻轉，套用公式（~12 步）
  - PLL Parity：swap 兩組邊，套用公式（~16 步）
Step 4: 3×3 階段（呼叫 LBLSolver，忽略中心塊差異）
```

### Centers（Step 1）
- 每面 4 個中心塊，位於 `|x/y/z| = 0.5`
- 6 面 × 4 塊 = 24 塊，目標是讓每面 4 塊同色
- 策略：BFS/greedy，用 `U, D, L, R, B, F, Uw, Dw` 等移動
- 只需達成「同色在同面」，不需特定排列（無固定中心基準）
- 但必須確保相對面顏色正確（U 對 D，L 對 R，F 對 B）

### Edges（Step 2）
- 12 個邊組，每組 2 塊需配對
- 策略：逐一取出未配對的邊塊對，用 Uw/Dw 移到工作區配對後放回
- 最後 2 組可能需要同時處理（避免破壞已配對的邊）

### Parity（Step 3）
- **OLL Parity 偵測**：`readCurrentState4()` → 轉換成 3×3 等效狀態 → 計算邊塊方向奇偶性
- **PLL Parity 偵測**：3×3 階段 LBL 解完後，若出現「單次對換」（在 3×3 是不可能的）
- 公式：固定的步驟序列，直接內嵌為字串陣列

### 測試
- [ ] Centers solver：隨機打亂 centers，解完後每面 4 塊同色（10 次隨機）
- [ ] Edges solver：隨機打亂 edges，解完後 12 組都配對（10 次隨機）
- [ ] OLL Parity：手動製造奇偶錯誤（奇數邊翻轉），solver 偵測並修正
- [ ] PLL Parity：手動製造，solver 偵測並修正
- [ ] 端對端：隨機打亂 96-char state，Worker 解完後 `setState4()` + 動畫播放到底，checkIsSolved4() 為 true（20 次壓力測試）

---

## Phase D — 5×5 擴充

**從 cube4x4.html 複製並調整以下項目：**

### 幾何差異
- 座標值：`-2, -1, 0, 1, 2`（5 個切片）
- 外面條件：`Math.abs(coord) === 2`
- 有固定中心（N=5 的中心就是原點，座標 0,0,0 之外各面）
- 可見方塊：98 個（總數 125，減去內部 27）
- 貼紙數：150（每面 25）

### 廣域動作
- 5×5 有 Rw（2 層）和 3Rw（3 層）等
- `rotateWideSlice` 接受任意多個 slicePositions，同樣適用

### ReductionSolver5
```
Step 1: Centers（每面 9 個中心塊，分 3 條：頂條、中條、底條）
  - 先對齊頂條（3塊），再中條，再底條
Step 2: Edge Triplets（12 組各 3 塊 → 配成 triplet）
  - 比 4×4 多一個邊，策略類似但需 3-way matching
Step 3: OLL Parity（5×5 存在，修正公式稍長）
  - 注意：5×5 沒有 PLL Parity！
Step 4: 3×3 階段（呼叫 LBLSolver）
```

### 測試
- [ ] Centers solver（9塊×6面）：20 次隨機壓力測試
- [ ] Edge Triplets：20 次隨機壓力測試
- [ ] OLL Parity：手動製造，偵測並修正
- [ ] 確認無 PLL Parity 發生（5×5 理論上不存在）
- [ ] 端對端：20 次隨機打亂 → Worker 解完 → 動畫播放 → checkIsSolved5() = true

---

## 掃描器擴充（4×4 / 5×5）

- **採樣格子大小**：4×4 = 65px，5×5 = 52px（在手機螢幕上仍可辨識）
- **引導線框**：`CameraScanner.drawNxNGrid(N)` 根據 N 自動計算格子
- **等軸測 2 張模式**：同 3×3，3 個可見面的格子數 × N²
- **逐面 6 張模式**：每面拍 N×N，同樣適用
- **中心格（用於 palette 校準）**：
  - 4×4：中心格是第 2 行第 2 列和第 3 行第 3 列的 4 個格子取平均
  - 5×5：中心格是第 3 行第 3 列（索引 12）

---

## 開發順序與里程碑

| 里程碑 | 內容 | 完成標準 |
|--------|------|----------|
| M1 | Phase A：Worker 架構 | Worker ping/pong + 3×3 LBL 在 Worker 中跑通 |
| M2 | Phase B：4×4 幾何 | rotateWideSlice 動畫正確，state 讀寫一致 |
| M3 | Phase C：ReductionSolver4 | 20 次隨機全過 |
| M4 | 4×4 掃描器整合 | 完整流程：掃描 → 解題 → 引導 |
| M5 | Phase D：5×5 | 20 次隨機全過 |
| M6 | 5×5 掃描器整合 | 完整流程 |

**優先順序**：M1 → M2 → M3 → M4（可交付 4×4） → M5 → M6

---

## 效能考量

| 操作 | 3×3 | 4×4 | 5×5 |
|------|-----|-----|-----|
| 幾何初始化 | <10ms | <20ms | <50ms |
| 掃描採樣（10fps） | <5ms | <8ms | <12ms |
| Solver（主執行緒） | OK 100ms | 阻塞 0.5–5s | 阻塞 5–30s |
| Solver（Worker） | N/A | 0.5–5s 背景 | 5–30s 背景 |
| 動畫每步 | 250ms | 250ms | 250ms |
| 記憶體 | <5MB | <8MB | <15MB |

**Worker 是 4×4/5×5 的必要條件，不是選配。**

---

## 程式碼共用策略

由於三個檔案是獨立 HTML（ADR-1），共用邏輯用「複製貼上後只改一個數字」策略：

- `this.N` 控制幾何
- `this.FACE_COORDS` 4×4/5×5 版本在 Phase B 生成
- `HSVClassifier`、`CameraScanner`、`SolveGuideUI` 三個類別幾乎一樣，小差異用 `if (this.N === 4)` 或 `if (this.N === 5)` 分支

**不抽共用 JS 檔**：保持每個 HTML 完全自包含，方便 GitHub Pages 直接部署。
