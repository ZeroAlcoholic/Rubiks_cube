\# reference.md — Rubik's Cube Scanner / Solver / Animation References



\## A. 3×3 最速解 / Kociemba / Two-Phase



\- https://github.com/cubing/min2phase

&#x20; - 參考價值：JS 速解核心，可用 Web Worker



\- https://github.com/ldez/cubejs

&#x20; - 參考價值：JS 狀態模型與 two-phase solver



\- https://github.com/cs0x7f/min2phase

&#x20; - 參考價值：min2phase 原始演算法參考



\- https://github.com/torjusti/cube-solver

&#x20; - 參考價值：JS solver 集合與 scramble 工具



\---



\## B. LBL / Beginner Method / 教學式解法



\- https://github.com/tibordp/neishauben

&#x20; - 參考價值：瀏覽器 LBL solver + Three.js



\- https://github.com/zaidmukaddam/rubiks-cube-solver

&#x20; - 參考價值：有 lbl.js 分層解法結構



\- https://github.com/pglass/cube

&#x20; - 參考價值：固定演算法 solver 與測試



\- https://github.com/EliasAhlers/typedcube

&#x20; - 參考價值：TypeScript 原始分層解法



\---



\## C. Three.js 渲染 / 魔術方塊互動



\- https://github.com/joews/rubik-js

&#x20; - 參考價值：Three.js cubie 與拖曳轉層



\- https://github.com/HichemTab-tech/RubiksCube-threejs

&#x20; - 參考價值：Three.js solver/simulator 整合



\- https://github.com/blonkm/rubiks-cube

&#x20; - 參考價值：WebGL 魔術方塊操作模型



\- https://github.com/irisxu02/rubik

&#x20; - 參考價值：Three.js 互動方塊基礎



\---



\## D. 動畫操作 / 步驟播放 / notation



\- https://github.com/larspetrus/Roofpig

&#x20; - 參考價值：notation 驅動動畫播放



\- https://github.com/joews/rubik-js

&#x20; - 參考價值：反向 replay 可做上一步



\- https://github.com/tweenjs/tween.js

&#x20; - 參考價值：轉層與鏡頭補間動畫



\- https://github.com/idootop/MigicCube

&#x20; - 參考價值：Roofpig 同步解法展示



\---



\## E. 鏡頭連動 / Camera / Canvas Capture



\- https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia

&#x20; - 參考價值：鏡頭權限與 HTTPS 限制



\- https://github.com/do-me/js-camera-capture

&#x20; - 參考價值：Vanilla JS 手機拍照範例



\- https://gist.github.com/miguelmota/6403122

&#x20; - 參考價值：getUserMedia 截圖到 canvas



\- https://gist.github.com/kushalvyas/ddd8ef11f764c37b831558bd644c6568

&#x20; - 參考價值：camera frame 取像素範例



\---



\## F. 鏡頭視角 / OrbitControls / Camera Lock



\- https://threejs.org/docs/#examples/en/controls/OrbitControls

&#x20; - 參考價值：相機旋轉限制官方文件



\- https://github.com/yomotsu/camera-controls

&#x20; - 參考價值：更強 smooth camera control



\- https://sbcode.net/threejs/orbit-controls/

&#x20; - 參考價值：OrbitControls 實作教學



\---



\## G. 圖片辨識 / HSV / OpenCV.js



\- https://docs.opencv.org/4.x/db/d64/tutorial\_js\_colorspaces.html

&#x20; - 參考價值：OpenCV.js RGB/HSV 轉換



\- https://docs.opencv.org/3.4/da/d97/tutorial\_threshold\_inRange.html

&#x20; - 參考價值：HSV threshold 與 inRange



\- https://docs.opencv.org/4.x/df/d9d/tutorial\_py\_colorspaces.html

&#x20; - 參考價值：HSV 取色邏輯參考



\- https://github.com/atduskgreg/opencv-processing-book/blob/master/book/tracking/hsv\_color.md

&#x20; - 參考價值：HSV color tracking 說明



\---



\## H. 實體方塊掃描 / OpenCV Scanner



\- https://github.com/kkoomen/qbr

&#x20; - 參考價值：Webcam 掃描與色彩偵測



\- https://github.com/dcheng728/Rubik-s-Cube-Scanner-Solver

&#x20; - 參考價值：OpenCV 掃描流程參考



\- https://github.com/cahidenes/rubiks-cube-solver

&#x20; - 參考價值：兩角度掃描辨識概念



\- https://github.com/ayushdewan/Rubiks-Cube-Solver

&#x20; - 參考價值：九點採樣逐面掃描流程



\- https://github.com/BadagalaAdarsh/Rubiks\_Cube\_Solver

&#x20; - 參考價值：輪廓偵測到 kociemba



\- https://github.com/mustafa1728/Automatic\_Rubiks\_Cube\_Solver

&#x20; - 參考價值：影像分割與色塊分類



\---



\## I. 4×4 / 5×5 / N×N 擴充



\- https://github.com/zimyang/Rubiks-Cube-Solver

&#x20; - 參考價值：N×N reduction solver 方向



\- https://github.com/Voltara/vcube

&#x20; - 參考價值：最佳解搜尋演算法參考



\- https://github.com/stringham/rubiks-solver

&#x20; - 參考價值：JS Thistlethwaite solver 參考



\---



\## J. 實作優先順序



1\. 先讀：

&#x20;  - https://github.com/cubing/min2phase

&#x20;  - https://github.com/ldez/cubejs

&#x20;  - https://github.com/joews/rubik-js

&#x20;  - https://github.com/larspetrus/Roofpig



2\. 再讀：

&#x20;  - https://github.com/tibordp/neishauben

&#x20;  - https://github.com/zaidmukaddam/rubiks-cube-solver

&#x20;  - https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia

&#x20;  - https://docs.opencv.org/4.x/db/d64/tutorial\_js\_colorspaces.html



3\. 最後才讀：

&#x20;  - https://github.com/kkoomen/qbr

&#x20;  - https://github.com/dcheng728/Rubik-s-Cube-Scanner-Solver

&#x20;  - https://github.com/zimyang/Rubiks-Cube-Solver

