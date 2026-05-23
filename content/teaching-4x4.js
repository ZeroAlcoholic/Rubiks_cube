// 4×4 Reduction-method teaching notes — surfaced by SolveGuide when each
// phase begins. Plain-language Chinese explanations aimed at a learner who
// already understands 3×3 layer-by-layer; each note answers two questions:
// "what's the goal of this phase" and "why this order".
//
// Consumed via:
//   new ReductionSolver({ N: 4, teaching: TEACHING_4X4 })
// where the solver merges these strings into phase.teachingNote on its result.

export const TEACHING_4X4 = {
    centers:
        '把 6 個面的 2×2 中心塊各自湊成同色。' +
        '中心位置之後就固定下來，等於告訴方塊「每一面該是什麼顏色」。',

    edges:
        '把每條邊上 2 塊有相同貼紙的小方塊湊成一對。' +
        '湊好後每條邊就像 3×3 的單一邊塊，整個方塊就能當 3×3 來處理。',

    parity:
        '4×4 特有的「對齊偏差」：因為中心可以自由轉，' +
        '有 1/2 機率會出現一個邊塊上下顛倒、' +
        '或者 1/3 機率出現兩個邊塊位置互換，' +
        '需要用特殊公式修正。如果沒遇到就跳過。',

    kociemba:
        '中心和邊塊都就位後，剩下的就是 3×3 解法。' +
        '我們用 Kociemba 兩階段演算法找出 22 步以內的最短解。',
};
