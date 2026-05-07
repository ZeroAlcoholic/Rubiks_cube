# 魔術方塊掃描解題系統：單一最佳可執行計畫

基準日期：2026-05-02  
基底檔案：`魔術方塊.html`（目前約 760 行）  
目標部署：GitHub Pages HTTPS、純前端、PWA、零後端  
最終支援：3×3、4×4、5×5；每個尺寸皆支援「斜角 2 張」與「逐面 6 張」掃描

---

## 0. 現有基底盤點

| 元件 | 狀態 | 問題 | 處置 |
|---|---:|---|---|
| `RubiksGame`、Three.js 渲染 | 可用 | 材質偏耗能 | 保留，Phase 1 評估改 `MeshLambertMaterial` |
| `rotateSlice(axis,val,angle)` | 可用 | 只支援單層 | 保留並新增 `rotateWideSlice()` |
| `moveStack + autoSolve()` | 部分可用 | 依賴歷史，無法解掃描狀態 | `moveStack` 只作互動歷史/Undo，不作 solver 輸入 |
| `checkIsSolved()` | 不適用 | 比對原始位置/旋轉，掃描後直接上色會失效 | 改為比對每面貼紙與中心色 |
| `CubeSolver.readState()` | 死碼 | 半成品註解與放棄邏輯 | 移除或替換為正式 `LBLSolver` |
| `LBLSolver` | 不存在 | 無正式解題 | Phase 2 建立 |
| `setState()` / `readCurrentState()` | 不存在 | 無法掃描同步 | Phase 1 建立 |
| 鏡頭掃描 UI | 不存在 | 無掃描流程 | Phase 3 建立 |
| 2D 展開確認/手動修色 | 不存在 | 顏色誤判無安全網 | Phase 4 建立 |
| PWA 檔案 | 不存在 | 無安裝/離線能力 | Phase 8 建立 |

起點策略：`cube3x3.html` 以 `魔術方塊.html` 為基礎全面重構，不從零重寫；原檔保留作歷史參考。

---

## 1. 最終檔案架構

```text
rubiks_cube/
├── index.html          # 入口：選擇 3×3 / 4×4 / 5×5
├── cube3x3.html        # 3×3 完整功能，最先完成
├── cube4x4.html        # 從 cube3x3.html 複製擴充
├── cube5x5.html        # 從 cube4x4.html 複製調整
├── manifest.json
├── service-worker.js
└── icon.png
```

每個 `cube*.html` 維持自包含單檔：HTML、CSS、JS 全部內嵌。允許 CDN 載入 Three.js r128、OrbitControls r128、Tailwind CDN；min2phase 僅在使用者選擇速解模式時懶載入。

核心資料流：

```text
CameraScanner / 手動輸入
→ HSVClassifier
→ ScannerUI 2D unfold state
→ StateValidator
→ RubiksGame.setState()
→ LBLSolver 或 Min2PhaseAdapter
→ SolveGuideUI 動畫播放
→ readCurrentState() / checkIsSolved()
```

### 外部技術採用決策

- 3×3 正式速解先採 `cubejs@1.3.2`：其 README 明確支援瀏覽器、`Cube.fromString()` 的 54 字元 URFDLB facelet string、`Cube.initSolver()` 與 `solve([maxDepth])`，並實作 Kociemba two-phase。這比自寫 solver 風險低，現階段作為 3×3 正式解題核心。
- `cubing/min2phase.js` 保留為後續升級候選：它支援 worker/off-thread solve，適合在 Phase 3/5 後把 solver 初始化和求解移出主執行緒，降低 UI 卡頓。
- LBL/教學式 solver 不在沒有完整測試前開放。後續參考 `neishauben`、`rubiks-cube-solver`、`typedcube` 等分層解法，但必須包在同一個 `SolverAdapter` 邊界下。
- 動畫播放採 notation-driven 架構，參考 Roofpig 類型的「演算法字串驅動畫面」思路，但不引入 Roofpig runtime，避免與現有 Three.js cubie 狀態模型衝突。
- 鏡頭掃描遵守 MDN `getUserMedia()` 安全脈絡要求：HTTPS、`file://`、`localhost` 才可用；權限拒絕與 iOS PWA 限制必須有 fallback。
- 顏色辨識先採 HSV threshold + 中位數取樣；OpenCV.js 的 `cvtColor()`/`inRange()` 作為演算法參考，除非 Vanilla HSV 無法達標，否則不提前引入 OpenCV.js 大型依賴。
- 高耗視覺特效暫停到核心流程完成後再恢復；完成前不讓粒子、重 shader 或非必要動畫干擾效能測試。

---

## 2. Phase 1：3×3 State 系統重構

目標：讓 3D 模型成為真正可讀、可寫、可驗證的狀態機。

### 1.1 建立 `cube3x3.html`

交付：

- 複製 `魔術方塊.html` 為 `cube3x3.html`。
- 建立基本 `index.html`，先可進入 `cube3x3.html`；4×4/5×5 可暫時標示開發中。
- `CubeSolver` 草稿移除或隔離，避免被誤認為可用 solver。

### 1.2 修改 `checkIsSolved()`

現有邏輯比對 `originalPos` 與 cubie rotation，對掃描後 `setState()` 的場景無效。

改法：

- 讀取 6 個中心格的外露面材質作為該面期望顏色。
- 中心格座標：
  - `U=(0,1,0)`
  - `D=(0,-1,0)`
  - `F=(0,0,1)`
  - `B=(0,0,-1)`
  - `R=(1,0,0)`
  - `L=(-1,0,0)`
- 掃描全部外露貼紙，比對其所在面的中心色。
- 全部符合才回傳 solved。

### 1.3 新增 `setState(stateStr)`

規格：

- 輸入 54 字元 URFDLB 格式：
  - `state[0..8] = U`
  - `state[9..17] = R`
  - `state[18..26] = F`
  - `state[27..35] = D`
  - `state[36..44] = L`
  - `state[45..53] = B`
- 字元到材質：
  - `U → yellow`
  - `R → orange`
  - `F → blue`
  - `D → white`
  - `L → red`
  - `B → green`
- 先重置幾何，再依 face/index 設定外露貼紙材質。

### 1.4 新增 `readCurrentState()`

規格：

- 輸出 54 字元 URFDLB。
- 根據當前 cubie 位置、外露面法線、材質反推字元。
- 每面掃描順序必須固定，且與 solver permutation table 完全一致。

U 面順序範例（從 `+y` 俯視）：

```text
row 0: (-1,1,-1) (0,1,-1) (1,1,-1) → stickers 0,1,2
row 1: (-1,1, 0) (0,1, 0) (1,1, 0) → stickers 3,4,5
row 2: (-1,1, 1) (0,1, 1) (1,1, 1) → stickers 6,7,8
```

其餘 `R/F/D/L/B` 面必須在程式內以 mapping table 明確列出，不用推測式散落邏輯。

### 1.5 材質與幾何準備

交付：

- 新增 `this.N = 3`。
- 新增 `getSlicePositions()`，3×3 回傳 `[-1,0,1]`。
- `createRubiksCube()` 改為由 N 推導。
- `MeshStandardMaterial` 評估替換為 `MeshLambertMaterial`，目標降低手機 GPU 負載。

### Phase 1 驗證

| 測試 | 方法 | 通過條件 |
|---|---|---|
| T1-1 `setState` 正確性 | `setState("UUUUUUUUURRRRRRRRR...")` | 3D 每面呈現正確顏色 |
| T1-2 `readCurrentState` 一致性 | reset → scramble N 步 → read → setState(read) | 外觀不變 |
| T1-3 `checkIsSolved` 正確性 | solved / scrambled 各測 | true / false 正確 |
| T1-4 `setState ↔ readCurrentState` 互逆 | 100 筆合法隨機狀態 | `readCurrentState(setState(s)) === s` |
| T1-5 move round-trip | 每個基本動作後接 inverse | 回到原 state |
| T1-6 浮點穩定性 | 1,000 個隨機 90° 旋轉 | 座標仍在 `{-1,0,1}` |

退出條件：T1-1 到 T1-6 全過，且 `cube3x3.html` 無 console error。

---

## 3. Phase 2：3×3 真實 Solver

目標：純 JS 解算任意合法 3×3 狀態，不依賴 `moveStack`。

### 2.1 `LBLSolver`

API：

```js
LBLSolver.solve(state54)
// → [{ notation, face, dir, layer, stage }]
```

7 階段：

1. White Cross
2. White Corners
3. F2L / 第二層邊塊
4. OLL Cross
5. OLL Corners
6. PLL Corners
7. PLL Edges

內部狀態：

- 使用 54 字元索引陣列。
- 所有動作用 permutation table 定義，例如 `R` 是 54 index 的重排列。
- 不使用暴力搜尋；每階段使用確定性識別、lookup table、已知公式。
- 階段已完成則跳過。
- `orientationMap` 供 UI 把 notation 翻成使用者可理解的色面描述。

注意：若完整 LBL 實作風險過高，允許先以 min2phase 作為「正式可用 solver」保證端到端正確；但 UI 不得宣稱 LBL 已可用，直到 T2 全過。

### 2.2 `Min2PhaseAdapter`

交付：

- 使用者選擇「速解」時才懶載入。
- 初始化 loading 需明確顯示。
- CDN 失敗時回報可恢復錯誤，並可退回 LBL 或手動模式。

### 2.3 改造 `autoSolve()`

流程：

```text
state = readCurrentState()
→ StateValidator3.validate(state)
→ solver.solve(state)
→ SolveGuideUI.load(moves)
```

`moveStack` 不再作為 solver 輸入。

### Phase 2 驗證

| 測試 | 方法 | 通過條件 |
|---|---|---|
| T2-1 已解狀態 | `solve(solvedState)` | 回傳 `[]` |
| T2-2 單步還原 | `R/L/U/D/F/B`、反向、2 次轉 | 1 步或最短合理解還原 |
| T2-3 壓力測試 | 隨機打亂 100 次，亂度 1-25 | 全部還原，`checkIsSolved() === true` |
| T2-4 步數範圍 | 同 T2-3 | LBL 60-180 為目標，超出警告 |
| T2-5 階段完整性 | 每階段結束呼叫對應檢測函數 | 白十字、角塊、F2L、OLL/PLL 狀態正確 |
| T2-6 邊界情境 | 十字已好、F2L 已好、純 PLL | 只執行必要後續階段 |
| T2-7 非法狀態 | 錯誤計數、單邊翻轉、單角扭轉、奇排列 | validator 拒絕，不進 solver |
| T2-8 min2phase | 100 組 scramble | 全部還原，步數目標 `<= 26` |

效能目標：`LBLSolver.solve()` 任意輸入 `< 50ms`；min2phase 初始化 `< 5s` 並有 loading，初始化後單次 solve `< 200ms`。

退出條件：至少一個正式 solver 通過 T2-1、T2-3、T2-7；LBL 模式需完整通過 T2 全項後才開放。

---

## 4. Phase 3：鏡頭 UI + HSV 分類器

目標：從手機鏡頭取得可校正的 state draft。

### 3.1 `HSVClassifier`

API：

```js
class HSVClassifier {
  classify(r, g, b) // → 'U'|'R'|'F'|'D'|'L'|'B'
}
```

初始閾值：

```js
{
  U: { hMin: 40, hMax: 70, sMin: 0.35, vMin: 0.60 },  // Yellow
  R: { hMin: 10, hMax: 35, sMin: 0.45, vMin: 0.35 },  // Orange
  F: { hMin: 200, hMax: 260, sMin: 0.35, vMin: 0.30 }, // Blue
  D: { hMin: 0, hMax: 360, sMax: 0.25, vMin: 0.70 },  // White
  L: { hMinA: 0, hMaxA: 10, hMinB: 345, hMaxB: 360, sMin: 0.45, vMin: 0.30 }, // Red
  B: { hMin: 90, hMax: 160, sMin: 0.30, vMin: 0.30 }   // Green
}
```

設計要點：

- 白色優先用低 saturation + 高 value 判斷。
- 紅色需處理 hue 0/360 跨界。
- 即時預覽可用 3×3 kernel 中位數；拍照用 5×5 kernel 中位數。
- 閾值集中管理，未來可做校準 UI。

### 3.2 `CameraScanner`

流程：

```text
getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } })
→ video pixel source
→ canvas overlay 繪製 guide
→ 10fps preview classification
→ capture full-resolution frame
→ output state draft
```

掃描模式：

- 斜角 2 張：Shot 1 = U/F/R，Shot 2 = D/B/L。
- 逐面 6 張：U/R/F/D/L/B。
- 3×3、4×4、5×5 全部都要提供兩種模式。

等軸測線框：

- 斜角模式繪製三個 N×N 面。
- 依 canvas 尺寸計算面角點與每格中心。
- 開發模式可顯示採樣點。

資源管理：

- 關閉 scanner 時必須 `track.stop()`。
- HTTP 非安全來源顯示 HTTPS 提示。
- iOS Standalone 顯示「請用 Safari 瀏覽器開啟掃描功能」。

### Phase 3 驗證

| 測試 | 方法 | 通過條件 |
|---|---|---|
| T3-1 HSV 單色準確 | 純色 RGB 分類 | 6 色正確 |
| T3-2 白/黃邊界 | `(240,240,240)` vs `(240,220,50)` | 不混淆 |
| T3-3 橙/紅邊界 | `(240,130,20)` vs `(220,30,30)` | 不混淆 |
| T3-4 中位數穩健 | 9/25 像素含 1-2 個噪聲 | 主色正確 |
| T3-5 採樣點幾何 | 375、768、1440、1920 寬度 | 採樣點在格內 |
| T3-6 HTTPS 必要性 | HTTP 開啟 | 顯示 HTTPS 提示 |
| T3-7 鏡頭釋放 | scanner 開關 20 次 | 無 active track 殘留 |

效能目標：10fps 預覽每幀分類與疊層 `< 16ms`，拍照後全解析度分類 `< 100ms`。

退出條件：桌面 HTTPS/localhost 與至少一台 Android Chrome 可完成拍攝並產生完整 state draft。

---

## 5. Phase 4：2D 展開確認 + 手動修色 + 合法性校驗

目標：讓顏色誤判可修復，非法狀態不能進 solver。

### 4.1 展開圖

```text
        U U U
        U U U
        U U U
L L L   F F F   R R R   B B B
L L L   F F F   R R R   B B B
L L L   F F F   R R R   B B B
        D D D
        D D D
        D D D
```

交付：

- 每格可點擊更色。
- 色盤 6 色按鈕。
- 修改後立即更新 state draft、3D 預覽與 validator 結果。
- 支援純手動輸入備援。

### 4.2 `StateValidator3`

流程：

1. 計數校驗：每色 9 個。
2. 中心格校驗：6 個中心互不相同。
3. Corner 組合：8 個角塊組合合法，無重複。
4. Edge 組合：12 個邊塊組合合法，無重複。
5. Orientation：角塊方向和、邊塊方向和合法。
6. Permutation parity：角置換與邊置換 parity 一致。

失敗時：

- 標紅相關格。
- 顯示可操作訊息：重拍某面或手動修正。

### Phase 4 驗證

| 測試 | 方法 | 通過條件 |
|---|---|---|
| T4-1 合法狀態通過 | 100 個已知合法 state | 全通過 |
| T4-2 非法計數 | 某色 10、某色 8 | 計數失敗 |
| T4-3 非法中心 | 中心重複 | 中心校驗失敗 |
| T4-4 非法組合 | 不存在的 edge/corner | 組合校驗失敗 |
| T4-5 非法 parity | 人工製造奇偶不合法 | parity 失敗 |
| T4-6 手動修色 | 點格 → 換色 → 重校驗 | 3D 即時更新 |
| T4-7 手機版面 | 360px 寬度 | 不溢出、不重疊 |

退出條件：任意掃描 draft 都必經確認頁；validator 失敗時不能進 solver。

---

## 6. Phase 5：SolveGuideUI 動畫引導

目標：以動畫作為主要教學，支援下一步、上一步、自動播放、暫停、速度切換。

### 5.1 狀態機

```text
IDLE → PLAYING → WAITING → PLAYING → DONE
        ↓          ↑
      PAUSED ──────┘
```

事件：

- `nextStep()`：執行 `moves[currentIdx]`，成功後 `currentIdx++`。
- `prevStep()`：`executedMoves.pop()`，執行 inverse move。
- `play()`：進入自動播放。
- `pause()`：停在目前狀態，不推進倒數。
- `onAnimDone()`：若自動播放，等待 1500ms countdown 後下一步。

### 5.2 inverse move

必須涵蓋：

- 18 個基本動作：`R R' R2 ... B2`
- 4×4/5×5 wide moves：`Rw Rw' Rw2 Uw ...`
- 5×5 3-wide moves。

規則：

- `X → X'`
- `X' → X`
- `X2 → X2`

### 5.3 攝影機鎖定

掃描完成後：

```js
lockedAzimuth = controls.getAzimuthalAngle()
controls.minAzimuthAngle = lockedAzimuth - Math.PI / 4
controls.maxAzimuthAngle = lockedAzimuth + Math.PI / 4
```

每步完成後用 100ms tween 回鎖定角度。保留「重設視角」按鈕。

### Phase 5 驗證

| 測試 | 方法 | 通過條件 |
|---|---|---|
| T5-1 完整自動播放 | 25 步打亂 → 求解 → 自動播放 | solved，無錯誤 |
| T5-2 上一步完整回溯 | 執行 20 步 → 全部上一步 | 回到初始狀態 |
| T5-3 暫停/繼續 | 播放中暫停 3 秒再繼續 | 暫停期間不推進 |
| T5-4 競態條件 | 快速連點下一步 10 次 | 不跳步、不崩潰 |
| T5-5 倒數條 | 自動播放觀察 | 1500ms 後才推進 |
| T5-6 視角鎖定 | 步驟中拖動視角 | 限制在 ±45° |
| T5-7 速度切換 | 慢/正常/快 | duration 正確套用 |

退出條件：3×3 從掃描/手動 state 到完整動畫還原可端到端完成。

---

## 7. Phase 6：`cube4x4.html`

目標：以完成的 `cube3x3.html` 擴充 4×4。

交付：

| 改動 | 內容 |
|---|---|
| `this.N = 4` | 座標 `-1.5,-0.5,0.5,1.5`；56 個 cubies |
| 外面條件 | `abs(coord) === 1.5` |
| `rotateWideSlice(axis, vals, angle)` | 例如 `Rw = [0.5,1.5]` 或依 notation mapping 決定 |
| state | 96 stickers |
| 掃描 | 4×4；斜角 2 張與逐面 6 張 |
| `ReductionSolver4` | Centers → Edges → OLL parity → PLL parity → 3×3 solver |
| `checkIsSolved()` | 以每面 16 格同色與全局相對色關係驗證，不依賴固定中心 |

Parity：

- OLL parity：最後一組 edge 單邊翻轉，套用固定公式。
- PLL parity：兩組 edge 互換，套用固定公式。

### Phase 6 驗證

| 測試 | 方法 | 通過條件 |
|---|---|---|
| T6-1 `rotateWideSlice` | `rotateWideSlice('x',[0.5,1.5],π/2)` | 兩層同步旋轉 |
| T6-2 Center Pairing | 製造亂中心 → Stage A | 6 面中心完成 |
| T6-3 Edge Pairing | Stage B | 12 組邊配對 |
| T6-4 OLL Parity | 人工製造 | 正確偵測與套公式 |
| T6-5 PLL Parity | 人工製造 | 正確偵測與套公式 |
| T6-6 完整壓測 | 50 組 scramble → Reduction+3×3 | 全部 solved |
| T6-7 notation | 外層、內層、wide moves | 全解析或明確拒絕 |

退出條件：4×4 掃描/手動輸入、校驗、解題引導、parity case 全流程可用。

---

## 8. Phase 7：`cube5x5.html`

目標：以完成的 `cube4x4.html` 擴充 5×5。

交付：

| 改動 | 內容 |
|---|---|
| `this.N = 5` | 座標 `-2,-1,0,1,2`；98 個 cubies |
| 外面條件 | `abs(coord) === 2` |
| state | 150 stickers |
| 掃描 | 5×5；斜角 2 張與逐面 6 張 |
| `ReductionSolver5` | Center Strips → Edge Triplets → OLL parity → 3×3 solver |
| PLL parity | 奇數層天然無 PLL parity，不應誤判 |
| notation | 支援 wide 與 3-wide moves |

最後一組 edge 公式可納入 regression，例如：

```text
l' U2 l' U2 F2 l' F2 r U2 r' U2 l2
```

### Phase 7 驗證

| 測試 | 方法 | 通過條件 |
|---|---|---|
| T7-1 幾何 | reset 5×5 | 98 cubies、150 stickers |
| T7-2 wide / 3-wide | 執行所有支援 notation | 動畫與 state 正確 |
| T7-3 Center Strips | 固定 case | 中心條完成 |
| T7-4 Edge Triplets | 固定 case | 12 組邊三拼完成 |
| T7-5 OLL Parity | 人工製造 | 正確處理 |
| T7-6 無 PLL Parity | 類似 PLL parity case | 不走 4×4 PLL parity 流程 |
| T7-7 完整壓測 | 30-50 組 scramble | 全部 solved |

退出條件：5×5 掃描/手動輸入、校驗、解題引導完整可用。

---

## 9. Phase 8：PWA、入口頁與 GitHub Pages 部署

交付：

- `index.html`：選擇 3×3 / 4×4 / 5×5。
- `manifest.json`：名稱、短名稱、start URL、display、theme/background、icons。
- `service-worker.js`：
  - HTML 與 icon 預快取。
  - Three.js/Tailwind CDN 採 Network First + cache fallback。
  - min2phase 不預快取，除非使用者已選速解且明確需要離線。
- `icon.png`。
- 使用說明更新：掃描模式、手動修色、iOS 限制、離線限制。

manifest 最小範例：

```json
{
  "name": "魔術方塊解題",
  "short_name": "Cube Solver",
  "start_url": "./index.html",
  "display": "standalone",
  "icons": [{ "src": "icon.png", "sizes": "192x192", "type": "image/png" }]
}
```

### Phase 8 驗證

| 測試 | 方法 | 通過條件 |
|---|---|---|
| T8-1 PWA 安裝 | Android Chrome 加入主畫面 | 可安裝且 standalone 開啟 |
| T8-2 離線功能 | 安裝後斷網 | 已快取主功能可開啟 |
| T8-3 iOS Safari | iPhone Safari 掃描 | 可授權鏡頭 |
| T8-4 iOS PWA 限制 | iPhone 主畫面開啟 | 顯示 Safari 掃描提示 |
| T8-5 GitHub Pages | HTTPS URL | 三個 cube 頁可開啟 |
| T8-6 Lighthouse | PWA 檢查 | 無阻斷性問題 |

退出條件：GitHub Pages HTTPS、PWA 安裝、Android/iPhone 掃描流程全過。

---

## 10. 全系統效能目標

| 指標 | 目標 | 量測方式 |
|---|---:|---|
| 初始頁面 FCP | `< 2s`，3G 模擬下盡量達成 | DevTools throttling |
| `LBLSolver.solve()` | `< 50ms` | `performance.now()` |
| min2phase 初始化 | `< 5s`，有 loading | 實測 |
| min2phase solve | `< 200ms` | `performance.now()` |
| `rotateSlice` 動畫 | 每幀 `< 16ms` | DevTools Performance |
| 3×3 渲染 | 60fps 目標 | DevTools FPS |
| 4×4/5×5 渲染 | 不低於 45fps | 手機實測 |
| HSV 預覽 10fps | `< 16ms/frame` | `performance.now()` |
| 拍照分類 | `< 100ms` | `performance.now()` |
| scanner 關閉 | 1 秒內釋放鏡頭 | media track 檢查 |
| 60 秒記憶體 | 無持續增長 | Chrome Memory |

效能策略：

- 不預載 min2phase。
- renderer pixel ratio 保持 `Math.min(devicePixelRatio, 2)`。
- 手機 GPU 壓力高時使用 `MeshLambertMaterial`。
- 4×4/5×5 reduction 若超過 100ms，分段 `await` 讓出主執行緒。
- 空閒或背景狀態可降幀，避免手機過熱。

---

## 11. 開發里程碑

| 里程碑 | 範圍 | 必過驗證 |
|---|---|---|
| M1 | Phase 1+2，`cube3x3.html` state + solver | T1 全過；T2-3 100 次壓測全過 |
| M2 | Phase 3+4，3×3 掃描與修色 | HTTPS 掃描真實方塊，validator 與手動修色可用 |
| M3 | Phase 5，3×3 解題引導 | T5-1、T5-2、T5-4 全過，手機可操作 |
| M4 | Phase 6+7，4×4/5×5 | T6-6、T7-7 全過，parity regression 全過 |
| M5 | Phase 8，PWA + Pages | T8-1 到 T8-6 全過 |

---

## 12. 高風險項目與緩解

| 風險 | 機率 | 衝擊 | 緩解 |
|---|---:|---:|---|
| LBL 特殊 PLL/F2L bug | 中 | 高 | T2 壓測、固定邊界情境、先用 min2phase 保端到端 |
| 白/黃 HSV 混淆 | 高 | 中 | 手動修色必經、T3-2 專項、閾值可調 |
| 紅/橘 HSV 混淆 | 中 | 中 | T3-3 專項、環境光測試、手動修色 |
| 掃描透視採樣偏移 | 中 | 高 | 開發模式採樣點 overlay、多尺寸測試 |
| 4×4 parity 偵測漏洞 | 中 | 高 | 人工 parity regression：T6-4/T6-5 |
| 5×5 reduction 複雜度 | 中 | 高 | 4×4 穩定後再做 5×5；固定 case regression |
| iOS PWA Standalone 鏡頭限制 | 確定 | 低 | 直接提示使用 Safari |
| min2phase CDN 下線 | 低 | 低 | 選配功能；LBL 或手動 fallback |
| 手機 GPU 過熱 | 中 | 中 | Lambert 材質、降幀、減少高耗特效 |
| 單檔 HTML 維護困難 | 中 | 中 | 以 class 區塊分段、每階段更新測試與計畫 |

---

## 13. 完成定義

專案完成不是「頁面可開」；必須同時滿足：

- `index.html` 可進入 `cube3x3.html`、`cube4x4.html`、`cube5x5.html`。
- 三個尺寸皆支援斜角 2 張與逐面 6 張掃描。
- 每個掃描流程都有 2D 展開確認與手動修色。
- 非法狀態不能進 solver，錯誤要能定位到相關格。
- 解題動畫支援下一步、上一步、自動播放、暫停、速度切換。
- 3×3 通過 100 組 scramble 還原；4×4/5×5 通過 reduction 壓測與 parity regression。
- GitHub Pages HTTPS、PWA 安裝、Android Chrome、iPhone Safari 實測通過。

---

## 14. 下一步

立即開始 Phase 1：

1. 建立 `cube3x3.html` 與基本 `index.html`。
2. 實作 `setState()`、`readCurrentState()`、新版 `checkIsSolved()`。
3. 建立 T1 測試入口。
4. 通過 T1-1 到 T1-6 後，才進入 Phase 2 solver。
