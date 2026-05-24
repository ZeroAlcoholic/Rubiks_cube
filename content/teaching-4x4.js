// 4×4 Reduction-method teaching notes — surfaced by SolveGuide when each
// phase begins. One-line Chinese explanations (≤22 chars) sized to fit a
// single row in the solve guide footer on mobile widths.
//
// The stage emoji + title (e.g. "1️⃣ 中心歸位") is already shown in the
// progress text via stageLabel, so these strings can focus on the goal,
// not repeat the phase name.
//
// Consumed via:
//   new ReductionSolver({ N: 4, teaching: TEACHING_4X4 })
// where the solver merges these strings into phase.teachingNote on its result.

export const TEACHING_4X4 = {
    centers:  '把 6 個面的 2×2 中心塊湊成同色',
    edges:    '把 12 條邊的 2 塊各湊成同色對',
    parity:   '修正 4×4 特有的對齊偏差（如有）',
    kociemba: '當作 3×3 用 Kociemba 演算法收尾',
};
