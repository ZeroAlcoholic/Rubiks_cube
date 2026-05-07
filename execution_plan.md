# 魔術方塊掃描解題系統 — 精準執行計畫

> **版本資訊**：本文件由 Claude Code（claude-sonnet-4-6）於 2026-05-02 自動生成。  
> 工具：Anthropic Claude Code CLI  
> 專案路徑：`D:\Python\rubiks_cube`

---

*基準日期：2026-05-02　基底：`魔術方塊.html`（758 行）*

---

## 現有基底盤點

| 元件 | 狀態 | 問題 |
|---|---|---|
| `RubiksGame` 類別、Three.js 渲染 | ✅ 可用 | MeshStandardMaterial 耗能 |
| `rotateSlice(axis, val, angle)` | ✅ 可用 | 只支援單層，無廣域 |
| `moveStack` + `autoSolve()` | ⚠️ 部分 | 依賴歷史，無法解掃描狀態 |
| `checkIsSolved()` | ❌ 錯誤 | 比對位置/旋轉，掃描後永遠失敗 |
| `CubeSolver.readState()` | ❌ 死碼 | 半寫死，有大量 TODO 放棄 |
| `LBLSolver` | ❌ 不存在 | — |
| `setState()` / `readCurrentState()` | ❌ 不存在 | — |
| 鏡頭掃描 UI | ❌ 不存在 | — |

**起點檔案**：`cube3x3.html` = 以 `魔術方塊.html` 為基礎全面重構，**非從零寫**。

---

## Phase 1 — State 系統重構

**目標**：讓 3D 模型成為真正的狀態機，可讀取也可設定。

### 1.1 修改 `checkIsSolved()`

現有邏輯比對 `originalPos`，對掃描場景完全無效。  
**改法**：讀取 6 個中心格（座標為軸值 ±1 且僅一軸非零）的 face 材質顏色，與其餘同面貼紙比對。

```
每面中心格固定：U=(0,1,0)、D=(0,-1,0)、F=(0,0,1)、B=(0,0,-1)、R=(1,0,0)、L=(-1,0,0)
讀取中心格的材質 → 定義該面期望顏色
掃描全部 26 個方塊的外露面材質 → 比對期望
全符合 → solved
```

### 1.2 新增 `setState(stateStr)`

- 輸入：54 字元（順序 U1→U9 R1→R9 F1→F9 D1→D9 L1→L9 B1→B9，URFDLB 格式）
- 每個字元對應材質顏色（`U`→yellow, `R`→orange, `F`→blue, `D`→white, `L`→red, `B`→green）
- 先 `createRubiksCube()` 重置，再逐一設定各小方塊的 face 材質

### 1.3 新增 `readCurrentState()`

- 輸出：54 字元 URFDLB 格式
- 對每面的 9 格，根據當前方塊位置與材質反推字元
- **每面掃描順序必須嚴格定義**（後續 Solver 正確性的基礎）：

```
U 面（從 +y 俯視）：
  row 0: (-1,1,-1) (0,1,-1) (1,1,-1)   → stickers 0,1,2
  row 1: (-1,1, 0) (0,1, 0) (1,1, 0)   → stickers 3,4,5
  row 2: (-1,1, 1) (0,1, 1) (1,1, 1)   → stickers 6,7,8
（其餘面類推，必須與 LBLSolver 內部映射一致）
```

### 1.4 材質效能替換

`MeshStandardMaterial` → `MeshLambertMaterial`，預期省 40% GPU。

### Phase 1 驗證測試

| 測試 | 方法 | 通過條件 |
|---|---|---|
| T1-1 setState 正確性 | `setState("UUUUUUUUURRRRRRRRR...")` 6色各9個 | 3D 每面呈現正確顏色 |
| T1-2 readCurrentState 一致性 | reset → scramble N步 → readState → setState(result) | 方塊外觀不變 |
| T1-3 checkIsSolved 正確性 | 已解 / 已亂各測試 | true/false 各自正確 |
| T1-4 setState ↔ readCurrentState 互逆 | 100 筆隨機狀態字串 | `readCurrentState(setState(s)) === s` |

---

## Phase 2 — LBLSolver

**目標**：純 JS 解算任意合法 3×3 狀態，無外部依賴。

### 演算法架構

```
LBLSolver.solve(state54) → [{notation, face, dir, layer, stage}, ...]

7 階段：
  Stage 1: White Cross        ← 白色十字（U面4個邊塊）
  Stage 2: White Corners      ← 白色角塊（U面4個角塊）
  Stage 3: F2L                ← 第二層4對 Edge+Corner
  Stage 4: OLL Cross          ← 頂面十字（Y面4個邊塊方向）
  Stage 5: OLL Corners        ← 頂面角塊方向（朝上）
  Stage 6: PLL Corners        ← 頂面角塊位置（排列）
  Stage 7: PLL Edges          ← 頂面邊塊位置（排列）
```

### 內部狀態表示

```javascript
// 54字元索引到面陣列
// state[0..8]  = U面
// state[9..17] = R面  ... 等
// 所有操作定義為索引重排列（permutation tables）
// 例：R 動作的 permutation 定義 54 個索引如何重排
```

### 關鍵設計約束

- **不使用暴力搜尋**，每個階段用確定性識別（pattern matching）+ 查表（lookup table）+ 已知公式
- `orientationMap`：`{U:'white', R:'orange', F:'blue', D:'white', L:'red', B:'green'}` 供 UI 翻譯成口語動作描述
- Stage 間有快取：若某階段已完成則跳過

### Phase 2 驗證測試

| 測試 | 方法 | 通過條件 |
|---|---|---|
| T2-1 已解狀態 | `solve("UUUU...RRRR...")` | 回傳 `[]` |
| T2-2 單步還原 | 每個基本動作（R/L/U/D/F/B 及其反向）各測 | 1步解題 |
| T2-3 壓力測試 | 隨機打亂 100 次（不同亂度 1–25 步），各自 solve | 全部 `checkIsSolved() === true` |
| T2-4 步數範圍 | 同 T2-3 | 步數 60–180（超出則警告，非失敗） |
| T2-5 階段完整性 | 每階段結束後呼叫對應偵測函數 | 白色十字/F2L/OLL 各自確認通過 |
| T2-6 已知邊界情境 | 十字已好、F2L 已好、純 PLL 各別輸入 | 只執行後續階段 |

**效能目標**：`LBLSolver.solve()` 在 Chrome DevTools 的 Performance 錄製下，任意輸入 `< 50ms`（含 7 個階段完整計算）。

---

## Phase 3 — 鏡頭 UI + HSV 分類器

### HSVClassifier

```javascript
class HSVClassifier {
  // 輸入 {r, g, b}（0-255），輸出 'U'|'R'|'F'|'D'|'L'|'B'
  classify(r, g, b)

  // HSV 閾值表（可調整）
  static THRESHOLDS = {
    U: { hMin:40,  hMax:70,  sMin:0.3, vMin:0.7 },  // Yellow
    R: { hMin:10,  hMax:30,  sMin:0.5, vMin:0.5 },  // Orange
    F: { hMin:200, hMax:260, sMin:0.4, vMin:0.4 },  // Blue
    D: { hMin:0,   hMax:360, sMin:0.0, vMin:0.8 },  // White (high V, low S)
    L: { hMin:0,   hMax:10,  sMin:0.6, vMin:0.4 },  // Red
    B: { hMin:100, hMax:160, sMin:0.4, vMin:0.4 }   // Green
  }
}
```

**設計要點**：白色與黃色依 Saturation 區分（白 S < 0.2，黃 S > 0.35）；紅色跨 Hue 0°/360° 需特別處理。

### CameraScanner

```
getUserMedia({ video: { facingMode:'environment', width:1920, height:1080 } })
  → <video> 元素（不顯示，只作為 pixel 來源）
  → <canvas> 疊層：繪製等軸測引導線框（isometric wireframe）+ N×N 格線
  → 10fps 預覽：取樣各格中心 9 像素（3×3 kernel 取中位數）→ HSVClassifier
  → 拍照：getImageData 全解析度 → 各格中心 5×5 kernel 中位數
```

### 等軸測線框計算

```javascript
// 斜角模式：3個面各 N×N 格的 isometric 投影
// 用標準 isometric 矩陣，方塊邊長 = canvasWidth * 0.4
// 三個面的角點：
//   Top face:   頂部菱形 4 個角點
//   Right face: 右側平行四邊形 4 個角點
//   Left face:  左側平行四邊形 4 個角點
// 各面再等分為 N×N 格，每格中心 = 取樣點
```

### Phase 3 驗證測試

| 測試 | 方法 | 通過條件 |
|---|---|---|
| T3-1 HSV 單色準確 | 用純色 RGB 值分類（各面已知顏色） | 6色各自正確 |
| T3-2 白/黃邊界 | 白色 (240,240,240) 與黃色 (240,220,50) | 各自正確，不混淆 |
| T3-3 橙/紅邊界 | 橙 (240,130,20) 與紅 (220,30,30) | 各自正確 |
| T3-4 中位數穩健性 | 含 1–2 個噪聲像素的 9 像素 kernel | 中位數回傳正確主色 |
| T3-5 等軸測採樣點 | 在不同視窗尺寸（375px, 768px, 1440px） | 採樣點落在線框格內 |
| T3-6 HTTPS 必要性 | HTTP 環境下開啟頁面 | 顯示「請使用 HTTPS」提示 |

**效能目標**：10fps 預覽每幀取樣 + 分類 + 疊層繪製 < 16ms；拍照後全解析度分類 < 100ms。

---

## Phase 4 — 2D 展開確認 + 手動修色

### 展開圖（Unfold Map）

```
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

- 每格可點擊 → 彈出顏色選擇器（6色按鈕）
- 點選後即時更新 3D 模型對應貼紙材質

### 合法性校驗流程

```
Step 1: 計數校驗 — 每種顏色恰好 9 個
Step 2: 中心格校驗 — 6 個中心格顏色各不相同
Step 3: Corner 組合校驗 — 8 個角落各自顏色組合必須合法（不允許同色重複角）
Step 4: Edge 組合校驗 — 12 個邊塊各自顏色組合合法（不允許同色重複邊）
Step 5: Parity 校驗 — 角塊置換奇偶性 + 邊塊置換奇偶性 + 邊塊方向和（3校驗）
```

失敗 → 將問題格標紅 + 提示「第 X 面可能有辨識錯誤，請重拍或手動修正」。

### Phase 4 驗證測試

| 測試 | 方法 | 通過條件 |
|---|---|---|
| T4-1 合法狀態通過 | 輸入 100 個已知合法狀態字串 | 全通過校驗 |
| T4-2 非法計數 | 某顏色10個另一個8個 | 計數校驗失敗 |
| T4-3 非法 Parity | 人工製造奇偶不合法狀態 | Parity 校驗失敗，標出問題格 |
| T4-4 手動修色後更新 | 點格子 → 換色 → 重新校驗 | 3D 模型即時更新 |

---

## Phase 5 — SolveGuideUI（動畫引導）

### 核心狀態機

```
states: IDLE → PLAYING → PAUSED → DONE
                ↑           |
                └───────────┘ (resume)

事件：
  nextStep()  → 執行 moves[currentIdx]，currentIdx++
  prevStep()  → executedMoves.pop() 取反向動作並執行
  play()      → PLAYING，動畫結束後 wait 1500ms → nextStep()
  pause()     → PAUSED
  onAnimDone() → 若 PLAYING 則啟動 countdown(1500ms) → nextStep()
```

### 反向動作映射

```javascript
const inverse = {
  'R': "R'", "R'": 'R', 'R2': 'R2',
  'U': "U'", "U'": 'U', 'U2': 'U2',
  // ... 所有 18 個基本動作 + Rw/Uw 廣域動作
}
```

### 攝影機鎖定

```javascript
// 掃描完成後：
this.lockedAzimuth = controls.getAzimuthalAngle();
controls.minAzimuthAngle = this.lockedAzimuth - Math.PI / 4;
controls.maxAzimuthAngle = this.lockedAzimuth + Math.PI / 4;

// 每步完成後 Tween 回鎖定角度（100ms 線性插值）
```

### Phase 5 驗證測試

| 測試 | 方法 | 通過條件 |
|---|---|---|
| T5-1 完整自動播放 | 25步打亂 → 求解 → 自動播放完整 | `checkIsSolved() === true`，無報錯 |
| T5-2 上一步完整回溯 | 執行 20 步 → 全部按上一步 | 回到初始狀態（`checkIsSolved() === true`） |
| T5-3 暫停/繼續 | 播放中暫停 → 等 3 秒 → 繼續 | 不自動推進，繼續後正常 |
| T5-4 競態條件 | 快速連點下一步 10 次 | 不跳步、不崩潰、狀態正確 |
| T5-5 Countdown 倒數條 | 自動播放時觀察 | 1500ms 後才推進下一步 |
| T5-6 視角鎖定 | 步驟中拖動視角 | 超出 ±45° 後被限制 |

---

## Phase 6 — cube4x4.html

**從 cube3x3.html 複製，修改以下項目**：

| 改動 | 具體內容 |
|---|---|
| `this.N = 4` | 座標 ±1.5, ±0.5；56 個小方塊 |
| `rotateWideSlice(axis, vals, angle)` | `vals = [-1.5,-0.5]`（Lw），全部附到同一 pivot |
| `ReductionSolver4` | Centers（24塊）→ Edges（24塊）→ OLL/PLL Parity |
| 掃描格 | 4×4，96 貼紙 |
| `checkIsSolved()` | 4×4 無固定中心，改比對相對顏色關係 |

**Parity 偵測邏輯**：
- **OLL Parity**：最後一對 Edge 有單邊翻轉 → 套用固定公式（16步）
- **PLL Parity**：兩對 Edge 互換（3×3 不可能的情況）→ 套用固定公式（6步）

### Phase 6 驗證測試

| 測試 | 方法 | 通過條件 |
|---|---|---|
| T6-1 rotateWideSlice | 呼叫 `rotateWideSlice('x', [-1.5,-0.5], π/2)` | 兩層同步旋轉，無分裂 |
| T6-2 Center Pairing | 手動製造已亂中心 → Reduction Stage A | 6面中心完成 |
| T6-3 Edge Pairing | 同上 Stage B | 12組邊塊各自配對 |
| T6-4 OLL Parity | 人工製造 → 偵測 | 正確套用公式 |
| T6-5 PLL Parity | 人工製造 → 偵測 | 正確套用公式 |
| T6-6 完整壓力測試 | 隨機打亂 50 次 → 完整 Reduction+LBL | 全部 `checkIsSolved() === true` |

---

## Phase 7 — cube5x5.html

**從 cube4x4.html 複製，修改**：

| 改動 | 具體內容 |
|---|---|
| `this.N = 5` | 座標 ±2, ±1, 0；98 個小方塊 |
| `ReductionSolver5` | Center Strips（54塊）→ Edge Triplets（36塊）→ OLL Parity only |
| 掃描格 | 5×5，150 貼紙 |
| 移除 PLL Parity | 奇數層天然無此問題 |
| 最後一組 Edge 公式 | `l' U2 l' U2 F2 l' F2 r U2 r' U2 l2` |

---

## Phase 8 — PWA + 入口頁 + 部署

**入口頁 `index.html`**：選 3×3 / 4×4 / 5×5 → 跳轉對應頁。

**`manifest.json`**：
```json
{
  "name": "魔術方塊解題",
  "start_url": "/index.html",
  "display": "standalone",
  "icons": [{"src": "icon.png", "sizes": "192x192"}]
}
```

**`service-worker.js`**：Cache First 策略，預快取所有 HTML 檔案；Three.js CDN 使用 Network First + 30天快取。

### Phase 8 驗證測試

| 測試 | 方法 | 通過條件 |
|---|---|---|
| T8-1 PWA 安裝 | Android Chrome → 加入主畫面 | 正常安裝，Standalone 模式開啟 |
| T8-2 離線功能 | 安裝後斷網 → 開啟 | 主功能可用（不需網路） |
| T8-3 iOS Safari | iPhone → 掃描鏡頭授權 | 正常授權並掃描 |
| T8-4 iOS PWA 限制 | iPhone → 從主畫面開啟（Standalone） | 提示「請用 Safari 瀏覽器開啟掃描功能」 |

---

## 全系統效能目標

| 指標 | 目標值 | 量測方式 |
|---|---|---|
| 初始頁面載入（FCP） | < 2s (3G) | Chrome DevTools Throttling |
| LBLSolver.solve() | < 50ms | `performance.now()` 前後量測 |
| rotateSlice 動畫 | 每幀 < 16ms | DevTools Performance |
| HSV 即時預覽（10fps） | < 10ms/frame | `performance.now()` |
| 拍照後顏色分類 | < 100ms | `performance.now()` |
| min2phase 初始化 | < 5s（首次，有 loading indicator） | 主觀測量 |
| 記憶體（60秒使用） | 無明顯增長 | Chrome Memory Tab |
| 手機 GPU 溫度 | 不過熱（LambertMaterial） | 手機觸感主觀評估 |

---

## 開發順序與交付里程碑

```
M1 (Phase 1+2) — cube3x3.html：State 系統 + LBLSolver 可運作
                  驗證：T1-4 + T2-3（100次壓測全過）

M2 (Phase 3+4) — cube3x3.html：完整掃描流程可用
                  驗證：HTTPS 環境下掃描真實方塊一次成功

M3 (Phase 5)   — cube3x3.html：完整解題引導，手機可操作
                  驗證：T5-1 + T5-2 全過，手機實測

M4 (Phase 6+7) — cube4x4.html + cube5x5.html 完成
                  驗證：T6-6 + 5×5 50次壓測全過

M5 (Phase 8)   — 部署 GitHub Pages，PWA 可安裝
                  驗證：T8-1 到 T8-4 全過
```

---

## 高風險項目與緩解策略

| 風險 | 機率 | 衝擊 | 緩解 |
|---|---|---|---|
| LBLSolver 某特殊 PLL 情況 bug | 中 | 高 | T2-3 壓測 100 次覆蓋，額外測已知難情境 |
| 白色/黃色 HSV 混淆 | 高 | 中 | 手動修色為安全網，T3-2 專項測試 |
| 4×4 Parity 偵測漏洞 | 中 | 高 | 人工製造 Parity 情境並驗證（T6-4/T6-5） |
| iOS PWA Standalone 無鏡頭 | 確定 | 低 | 已知 bug，直接顯示引導提示 |
| min2phase CDN 下線 | 低 | 低 | 此功能僅選配，LBL 永遠可用 |
| 手機 GPU 過熱 | 中 | 中 | Phase 1 改 LambertMaterial；動畫空閒時降至 30fps |
