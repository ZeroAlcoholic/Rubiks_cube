# 魔術方塊掃描解題系統 — 開發原則與架構指南

## 專案目標

以純前端網頁實作「手機鏡頭掃描實體魔術方塊 → 步驟引導使用者解題」的完整體驗。
支援 3×3、4×4、5×5 三種尺寸，部署於 GitHub Pages。

**核心體驗**：3D 模型動畫示範每一步動作，使用者對照畫面在實體方塊上做同樣的動作，完成後繼續下一步。動畫本身就是說明，不需要額外的文字步驟卡。

---

## 部署環境

- **GitHub Pages（HTTPS）**：唯一部署目標，這是手機鏡頭 `getUserMedia` 的必要條件
- **零後端**：所有計算在瀏覽器內完成，不依賴任何伺服器端程式

---

## 檔案架構

```
rubiks_cube/
├── index.html          ← 入口：選擇 3×3 / 4×4 / 5×5
├── cube3x3.html        ← 3×3 完整功能（基底，最先完成）
├── cube4x4.html        ← 4×4（從 cube3x3.html 複製擴充）
└── cube5x5.html        ← 5×5（從 cube4x4.html 複製調整）
```

每個 cube*.html 是自包含的單一 HTML 檔案（HTML + CSS + JS 全部內嵌）。
這讓每個檔案可以獨立開啟、測試、部署，不需要建置工具。

---

## 技術棧

| 用途 | 技術 | 版本 | 來源 |
|---|---|---|---|
| 3D 渲染 | Three.js | r128 | CDN |
| 攝影機控制 | OrbitControls | r128 | CDN |
| 樣式 | Tailwind CSS | CDN | CDN |
| 解題（速解） | min2phase（選配） | latest | CDN（2MB，懶加載） |
| 其餘全部 | 純 Vanilla JS | — | 內嵌 |

**不引入 React、Vue、Angular 等 SPA 框架**。現有 Vanilla JS 結構足夠，框架會增加複雜度而非降低。

---

## 架構決策紀錄

### ADR-1：三個獨立 HTML 而非單一大檔
**決策**：cube3x3 / cube4x4 / cube5x5 各為獨立 HTML。  
**原因**：5×5 全功能單檔估計 5,000–6,000 行，難以維護；各尺寸獨立可單獨部署和測試。  
**代價**：共用程式碼（HSV 分類器、鏡頭 UI、動畫引導）在三個檔案中重複。  
**緩解**：設計時維持模組內聚，複製貼上後只需調整 `this.N` 和 Reduction 算法。

### ADR-5：所有尺寸皆支援斜角 2 張掃描
**決策**：3×3 / 4×4 / 5×5 全部提供「斜角 2 張」和「逐面 6 張」兩種模式。  
**原因**：4×4/5×5 格子較小但仍在可辨識範圍（52px 以上），搭配等軸測輔助線框引導使用者對準，可行性足夠。手動修色為最終安全網。  
**實作**：畫面疊加等軸測立體線框（Canvas），引導文字要求使用者「調整到三個面都清楚可見」再拍，不強制固定特定角度。

### ADR-6：解題導航支援自動播放 / 暫停 / 上一步
**決策**：底部播放列提供 ⏮ 上一步 / ▶ 自動播放 / ⏸ 暫停 / ⏭ 下一步。  
**原因**：純「下一步」按鈕對初學者不夠友善；自動播放讓流暢觀看，暫停讓使用者有時間跟上，上一步讓錯誤可以回溯。  
**上一步實作**：執行反向動作（`R` → `R'`，`R2` → `R2`，`Rw` → `Rw'`），維護 `executedMoves[]` 歷史堆疊。  
**自動播放**：動畫結束後等待 1.5 秒（可設定）再自動觸發下一步，期間顯示倒數進度條。

### ADR-2：以 N 參數化幾何
**決策**：`this.N = 3/4/5` 控制所有與尺寸相關的計算。  
**原因**：座標、格子數、貼紙數、掃描框大小全從 N 推導，擴充到新尺寸只改一個數字。  
**關鍵函數**：`getSlicePositions()` 回傳 N 個層的 XYZ 座標值。

### ADR-3：掃描後攝影機彈性鎖定
**決策**：掃描完成後攝影機鎖定至掃描角度，允許 ±45° 自由旋轉（非硬鎖）。  
**原因**：「鎖定角度」讓使用者的實體方塊方向與畫面一致，降低解題翻譯成本。硬鎖會讓使用者看不到背面。  
**實作**：`controls.minAzimuthAngle` / `controls.maxAzimuthAngle`，動畫播完後平滑 Tween 回鎖定角度。

### ADR-4：3×3 提供 LBL 與 min2phase 兩種正式解法
**決策**：進入解題前讓使用者選擇「層先法（學習）」或「最少步驟（電腦最優）」。兩者皆為正式支援功能。  
**LBL**：純 JS 內嵌，7 階段，80–120 步，含教學說明，預設選項。  
**min2phase（Kociemba）**：從 CDN 懶加載 2MB lookup table，God's Number ≤ 20 步，首次等待 3–5 秒初始化。動畫呈現方式與 LBL 相同，但無教學說明文字。  
**不預先載入 min2phase**：僅在使用者明確選擇後才下載，避免拖慢初始載入。

---

## 各模組職責

### `LBLSolver`
- 輸入：54 字元狀態字串（URFDLB 格式）
- 輸出：步驟陣列 `[{notation:'R', face:'R', dir:-1, stage:2}, ...]`
- 含 `orientationMap`：`{U:'white', R:'orange', ...}` 供 UI 翻譯用
- 不碰 Three.js，純邏輯

### `ReductionSolver`（4×4 / 5×5）
- 輸入：96 或 150 字元狀態
- 輸出：Reduction 步驟陣列（包含廣域動作如 Rw、Uw）
- 完成後呼叫 LBLSolver 處理最終 3×3 階段

### `HSVClassifier`
- 輸入：RGB 三元組
- 輸出：`'U'|'R'|'F'|'D'|'L'|'B'`（顏色代號）
- 閾值可調整，設計為物件可整體替換（未來升級 TensorFlow.js 時介面不變）

### `CameraScanner`
- 管理 WebRTC `getUserMedia`
- 畫面上繪製 N×N 引導線框（Canvas 疊層）
- 即時顏色預覽（10fps 從 video 取樣，呼叫 HSVClassifier）
- 拍照時呼叫 `getImageData` 取得高解析原始像素

### `ScannerUI`
- 管理掃描流程狀態機（Shot 1 → Shot 2 → 確認 → 校準 → 解題）
- 2D 展開圖（Unfold Map）和手動修色
- 合法性校驗（計數、中心格、Parity）

### `SolveGuideUI`
- **動畫為主**：每步直接播放 3D 旋轉動畫，動畫本身就是說明
- 最小文字輔助：notation badge（`R'`）+ 步數進度（`12 / 45`）
- **播放控制列**（底部）：
  - ⏮ 上一步：`executedMoves.pop()` 取出最後一步的反向動作並執行
  - ▶/⏸ 自動播放/暫停：動畫結束後等 1.5 秒自動觸發下一步；暫停則停在當前步
  - ⏭ 下一步：手動推進
- LBL 模式：各大階段之間（非每步）插入階段目標預覽畫面
- 攝影機鎖定，動畫結束後 Tween 回掃描鎖定角度
- 速度控制：慢速（500ms）/ 正常（250ms）/ 快速（100ms）可切換

### `RubiksGame`（現有類別，擴充而非替換）
- 保留：`rotateSlice()`、`pivot`、`materials`、`checkWin()`
- 修改：`checkIsSolved()` 改為比對中心格材質顏色
- 新增：`setState(stateStr)`、`rotateWideSlice()`、`readCurrentState()`
- 移除：`CubeSolver`（死碼）、`moveStack` 依賴的 `autoSolve`

---

## 禁止事項

- **不加後端**：任何需要伺服器的功能一律找純前端替代方案
- **不引入大型框架**：React / Vue / Angular 不在考慮範圍內
- **不在 `autoSolve` 中繼續依賴 `moveStack`**：掃描進來的方塊無歷史紀錄，這個方向已死
- **不把 Kociemba 完整表格內嵌 HTML**：100MB+ 不可行，min2phase CDN 是唯一選項
- **不宣稱 100% 顏色辨識準確率**：必須保留手動修色 UI，這是系統穩定性的核心保障
- **不做 PWA「加入主畫面」**：已廢棄，不需要 manifest.json / service-worker.js

---

## 各尺寸幾何快速參考

| N | 可見方塊 | 座標值 | 外面條件 | 固定中心 | 貼紙數 |
|---|---|---|---|---|---|
| 3 | 26 | -1, 0, 1 | \|coord\| = 1 | ✅ | 54 |
| 4 | 56 | -1.5,-0.5,0.5,1.5 | \|coord\| = 1.5 | ❌ | 96 |
| 5 | 98 | -2,-1,0,1,2 | \|coord\| = 2 | ✅ | 150 |

---

## 解題算法流程

```
3×3：LBLSolver.solve(state54) → 7 階段，80–120 步
4×4：ReductionSolver4.solve(state96)
       → Centers（4塊×6面）
       → Edges（12組×2塊）
       → OLL/PLL Parity（視情況）
       → LBLSolver（最終 3×3 階段）
5×5：ReductionSolver5.solve(state150)
       → Center Strips（9塊×6面，分3條）
       → Edge Triplets（12組×3塊）
       → OLL Parity（視情況，無 PLL Parity）
       → LBLSolver（最終 3×3 階段）
```

---

## 開發順序

```
Phase 1 → LBLSolver（cube3x3.html 的地基）
Phase 2 → State 系統重構（checkIsSolved / setState / Mapping Table）
Phase 3 → 鏡頭 UI + HSV 分類器
Phase 4 → 2D 展開確認 + 手動修色
Phase 5 → 解題引導 UI（動畫示範 + 重播 + 攝影機鎖定）
Phase 6 → 4×4 擴充（cube4x4.html）
Phase 7 → 5×5 擴充（cube5x5.html）
Phase 8 → 入口頁 + GitHub Pages 部署
```

---

## 測試驗證方法

### 正確性（必須全過）
1. **Solver 壓力測試**：隨機打亂 100 次，每次跑 LBL Solver，全部必須正確還原（`checkIsSolved()` 回傳 true）
2. **min2phase 壓力測試**：同上，改用 min2phase，步數應 ≤ 26
3. **上一步反向**：隨機執行 20 步，全部按上一步倒退，應回到初始狀態
4. **自動播放完整流程**：開啟自動播放，跑完一整個解題序列不應崩潰或卡住
5. **狀態同步**：手動呼叫 `setState("UUUUUUUUU...")` 確認 3D 模型顏色正確

### 功能測試
6. **寬動作**：呼叫 `rotateWideSlice('x', [-1.5,-0.5], Math.PI/2)` 確認兩層同步旋轉
7. **掃描流程**：在 HTTPS 環境（GitHub Pages 或 `localhost`）測試 getUserMedia
8. **手機實測**：iPhone Safari + Android Chrome 各別測試鏡頭授權流程
9. **Parity 情境**：4×4 故意製造 OLL/PLL Parity，確認演算法能偵測並套用公式
10. **斜角掃描**：不同螢幕尺寸下確認等軸測輔助線框位置和採樣點正確對應
