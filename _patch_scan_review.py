#!/usr/bin/env python3
# coding: utf-8
"""
Patch cube3x3.html:
1. Two-shot mode: stay in scanner panel after both shots → show in-panel color review
2. Scanner panel goes near-fullscreen on mobile for larger camera view
3. Instruction text updated to say "get closer"
"""
import sys

path = 'D:/Python/rubiks_cube/cube3x3.html'
with open(path, 'r', encoding='utf-8') as f:
    src = f.read()
original_len = len(src)

# ── 1. Instruction text: "靠近方塊" ────────────────────────────────────────
OLD1 = "instruction: '將方塊調整成<strong>右上角斜角視角</strong>（能同時看到三個面），並對準線框後擷取。',"
NEW1 = "instruction: '<strong>靠近方塊</strong>，調整成右上角斜角視角（三面都清楚可見），對準線框後擷取。',"
assert OLD1 in src, 'ERROR 1'
src = src.replace(OLD1, NEW1, 1)
print('✓ 1. instruction text updated')

# ── 2. CSS: scan-review styles + mobile fullscreen scanner ─────────────────
OLD2 = '        /* ── 掃描 UX 改進樣式 ─────────────────────────────────── */'
NEW2 = '''        /* ── 掃描器全螢幕（手機）────────────────────────────── */
        @media (max-width: 640px) {
            #scanner-panel.scanner-fullscreen {
                width: 100vw !important;
                max-width: 100vw !important;
                height: 100dvh !important;
                max-height: 100dvh !important;
                top: 0 !important;
                left: 0 !important;
                transform: none !important;
                border-radius: 0 !important;
                border: none !important;
                padding: 10px !important;
                display: flex;
                flex-direction: column;
            }
            #scanner-panel.scanner-fullscreen .scanner-view {
                flex: 1;
                aspect-ratio: unset;
            }
        }
        /* ── 掃描後顏色確認視圖 ─────────────────────────────── */
        #scan-review { display: none; }
        #scan-review.active { display: flex; flex-direction: column; gap: 8px; }
        .scan-review-title {
            color: #86efac;
            font-size: 0.9rem;
            font-weight: 600;
            text-align: center;
        }
        .scan-review-subtitle {
            color: rgba(255,255,255,0.45);
            font-size: 0.76rem;
            text-align: center;
            margin-top: -4px;
        }
        .scan-review-palette {
            display: flex;
            gap: 7px;
            justify-content: center;
            padding: 4px 0;
        }
        .scan-review-swatch {
            width: 36px;
            height: 36px;
            border-radius: 7px;
            border: 2px solid rgba(255,255,255,0.15);
            cursor: pointer;
            transition: border-color 0.12s, transform 0.12s;
            flex-shrink: 0;
        }
        .scan-review-swatch.active {
            border-color: white;
            transform: scale(1.2);
            box-shadow: 0 0 10px rgba(255,255,255,0.35);
        }
        .scan-review-grid {
            display: grid;
            grid-template-columns: repeat(12, minmax(0, 1fr));
            grid-template-rows: repeat(9, minmax(0, 1fr));
            gap: 3px;
            width: 100%;
            aspect-ratio: 4 / 3;
        }
        .scan-review-sticker {
            border-radius: 3px;
            border: 2px solid rgba(0,0,0,0.22);
            cursor: pointer;
            transition: transform 0.1s;
        }
        .scan-review-sticker:hover { transform: scale(1.18); z-index: 1; }
        .scan-review-sticker.center-mark {
            box-shadow: inset 0 0 0 2px rgba(0,0,0,0.45);
            cursor: default;
        }
        /* ── 掃描 UX 改進樣式 ─────────────────────────────────── */'''
assert OLD2 in src, 'ERROR 2'
src = src.replace(OLD2, NEW2, 1)
print('✓ 2. CSS added')

# ── 3. HTML: add scan-review div before scanner-view ──────────────────────
OLD3 = '''        <div class="scanner-view">
            <video id="scanner-video" playsinline autoplay muted></video>
            <canvas id="scanner-overlay"></canvas>
            <div id="scanner-flash"></div>
        </div>'''
NEW3 = '''        <div id="scan-review">
            <div class="scan-review-title">確認顏色 — 點格子修正</div>
            <div class="scan-review-subtitle">點色板選色，再點格子塗色 &nbsp;|&nbsp; 中心格固定不可改</div>
            <div id="scan-review-palette" class="scan-review-palette"></div>
            <div id="scan-review-grid" class="scan-review-grid"></div>
            <div class="panel-actions" style="margin-top:6px">
                <button class="btn" onclick="game.retakeScanReview()">↩ 重拍</button>
                <button class="btn solve-btn" onclick="game.confirmScanReview()">確認解題 →</button>
            </div>
        </div>

        <div class="scanner-view">
            <video id="scanner-video" playsinline autoplay muted></video>
            <canvas id="scanner-overlay"></canvas>
            <div id="scanner-flash"></div>
        </div>'''
assert OLD3 in src, 'ERROR 3'
src = src.replace(OLD3, NEW3, 1)
print('✓ 3. HTML scan-review div added')

# ── 4. Constructor: init scanReviewState + scanReviewSelectedFace ──────────
OLD4 = "                this.pendingFacePanel = null;"
NEW4 = """                this.pendingFacePanel = null;
                this.scanReviewState = null;
                this.scanReviewSelectedFace = 'U';"""
# Only first occurrence (in constructor)
assert OLD4 in src, 'ERROR 4'
src = src.replace(OLD4, NEW4, 1)
print('✓ 4. constructor init')

# ── 5. openScanner(): reset review + add fullscreen class ─────────────────
OLD5 = """                this.scannerIsCapturing = false;
                this.pendingFacePanel = null;
                // 隱藏偵測結果 banner 與 center hint"""
NEW5 = """                this.scannerIsCapturing = false;
                this.pendingFacePanel = null;
                this.scanReviewState = null;
                this.scanReviewSelectedFace = 'U';
                // 全螢幕模式（手機）
                document.getElementById('scanner-panel').classList.add('scanner-fullscreen');
                // 隱藏偵測結果 banner 與 center hint"""
assert OLD5 in src, 'ERROR 5'
src = src.replace(OLD5, NEW5, 1)
print('✓ 5. openScanner reset + fullscreen class')

# ── 6. closeScanner(): remove fullscreen class ────────────────────────────
OLD6 = """            closeScanner() {
                document.getElementById('scanner-panel').classList.add('hidden');"""
NEW6 = """            closeScanner() {
                document.getElementById('scanner-panel').classList.add('hidden');
                document.getElementById('scanner-panel').classList.remove('scanner-fullscreen');"""
assert OLD6 in src, 'ERROR 6'
src = src.replace(OLD6, NEW6, 1)
print('✓ 6. closeScanner remove fullscreen class')

# ── 7. captureScannerShot(): show review instead of close+editor ──────────
OLD7 = """                    if (this.scanIndex >= TWO_SHOT_SCANS.length) {
                        await new Promise(r => setTimeout(r, 300));
                        const scannedState = this.buildStateFromCapturedPanels(this.scanRawPanels);
                        this.closeScanner();
                        this.openScannedStateEditor(scannedState);
                    } else {
                        if (captureBtn) captureBtn.disabled = false;
                    }"""
NEW7 = """                    if (this.scanIndex >= TWO_SHOT_SCANS.length) {
                        await new Promise(r => setTimeout(r, 300));
                        const scannedState = this.buildStateFromCapturedPanels(this.scanRawPanels);
                        this.showScanReview(scannedState);
                    } else {
                        if (captureBtn) captureBtn.disabled = false;
                    }"""
assert OLD7 in src, 'ERROR 7'
src = src.replace(OLD7, NEW7, 1)
print('✓ 7. captureScannerShot → showScanReview')

# ── 8. Add new methods before captureScannerFace() ────────────────────────
OLD8 = "            async captureScannerFace() {"
NEW8 = """            showScanReview(state) {
                // Stop animation loop
                if (this.scannerAnimation) {
                    cancelAnimationFrame(this.scannerAnimation);
                    this.scannerAnimation = null;
                }
                this.scanReviewState = state.split('');
                this.scanReviewSelectedFace = 'U';
                // Hide shooting UI elements
                const hideIds = ['scanner-view', 'stability-bar', 'scan-instruction-box',
                                 'live-center-hint', 'scan-detected-banner', 'scan-face-chips',
                                 'scanner-motion-guide'];
                hideIds.forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.style.display = 'none';
                });
                // Hide capture-button actions row
                const scannerPanel = document.getElementById('scanner-panel');
                scannerPanel.querySelectorAll('.scanner-modes, .panel-actions').forEach(el => {
                    el.style.display = 'none';
                });
                // Show review
                document.getElementById('scan-review').classList.add('active');
                this.renderScanReview();
            }

            renderScanReview() {
                const palette = document.getElementById('scan-review-palette');
                if (palette) {
                    palette.innerHTML = STATE_FACE_ORDER.map(face => {
                        const active = face === this.scanReviewSelectedFace ? ' active' : '';
                        return `<div class="scan-review-swatch${active}"
                            style="background:${FACE_COLORS[face]}" title="${face}"
                            onclick="game.selectReviewColor('${face}')"></div>`;
                    }).join('');
                }
                const grid = document.getElementById('scan-review-grid');
                if (!grid) return;
                grid.innerHTML = '';
                STATE_FACE_ORDER.forEach(face => {
                    const layout = UNFOLD_LAYOUT[face];
                    for (let i = 0; i < 9; i++) {
                        const row = Math.floor(i / 3);
                        const col = i % 3;
                        const idx = this.stateIndex(face, i);
                        const faceVal = this.scanReviewState[idx];
                        const isCenter = (i === 4);
                        const el = document.createElement('div');
                        el.className = 'scan-review-sticker' + (isCenter ? ' center-mark' : '');
                        el.style.gridRow = String(layout.row + row + 1);
                        el.style.gridColumn = String(layout.col + col + 1);
                        el.style.background = FACE_COLORS[faceVal] || '#444';
                        el.title = isCenter ? `${face} 中心（固定）` : `${face}${i + 1}: ${faceVal}`;
                        if (!isCenter) el.onclick = () => this.paintReviewSticker(idx);
                        grid.appendChild(el);
                    }
                });
            }

            selectReviewColor(face) {
                this.scanReviewSelectedFace = face;
                this.renderScanReview();
            }

            paintReviewSticker(stateIdx) {
                const centers = [4, 13, 22, 31, 40, 49];
                if (centers.includes(stateIdx)) return;
                this.scanReviewState[stateIdx] = this.scanReviewSelectedFace;
                this.renderScanReview();
            }

            confirmScanReview() {
                const state = this.scanReviewState.join('');
                this.closeScanner();
                this.openScannedStateEditor(state);
            }

            retakeScanReview() {
                // Hide review, restore shooting UI
                document.getElementById('scan-review').classList.remove('active');
                const showIds = ['scanner-view', 'stability-bar', 'scan-instruction-box',
                                 'scan-face-chips'];
                showIds.forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.style.display = '';
                });
                const scannerPanel = document.getElementById('scanner-panel');
                scannerPanel.querySelectorAll('.scanner-modes, .panel-actions').forEach(el => {
                    el.style.display = '';
                });
                // Reset scan state
                this.scanIndex = 0;
                this.scanRawPanels = [];
                this.scannerStableFrames = 0;
                this.scannerStabilityScore = 0;
                this.scannerPrevRgbs = null;
                this.scannerIsCapturing = false;
                this.pendingFacePanel = null;
                this.scanReviewState = null;
                const fillEl = document.getElementById('stability-bar-fill');
                if (fillEl) fillEl.style.width = '0%';
                this.updateScannerStatus();
                const captureBtn = document.getElementById('scanner-capture-btn');
                if (captureBtn) captureBtn.disabled = false;
                // Restart animation loop
                this.drawScannerOverlayLoop();
            }

            async captureScannerFace() {"""
assert OLD8 in src, 'ERROR 8'
src = src.replace(OLD8, NEW8, 1)
print('✓ 8. new methods: showScanReview / renderScanReview / selectReviewColor / paintReviewSticker / confirmScanReview / retakeScanReview')

# ── Verify ──────────────────────────────────────────────────────────────────
diff = len(src) - original_len
print(f'\nFile size change: {diff:+,} chars')
with open(path, 'w', encoding='utf-8') as f:
    f.write(src)
print('Saved.')
