// Yau Solver — Teaching-oriented 4×4 solver.
//
// Scope (current iteration):
//   Yau is canonically a 5-phase method with custom algorithms per phase.
//   Implementing it from scratch is multi-day work with high algorithmic
//   risk (especially Phase 3's "preserve cross edges" constraint). For now,
//   this class wraps ReductionSolver and:
//     1. Splits the bundled `centers` phase into THREE pedagogical substages
//        (pair-UD / pair-FB / sort-joint) by replaying moves and detecting
//        substage transitions on the live state.
//     2. Adds rich, Yau-style teaching notes to every phase.
//     3. Adds per-move templateKey hints so future UI can render per-step
//        explanations.
//
// Future work (deferred to next iteration):
//   - True Yau Phase 1 (only 2 opposite centers, not all 6) via a smaller BFS
//   - True Yau Phase 2 (3 cross edges) via IDA* with edge-pair heuristic
//   - True Yau Phase 3 (remaining 4 centers under cross-edge preservation)
//   - True Yau Phase 4 (3-2-3 slot edge pairing)
//
// The variant name 'yau-teach' is marked `beta: true` in solver-registry so
// the UI can render a "開發中" badge. The algorithm is correct (it's literally
// the proven Reduction algorithm); only the phase decomposition is Yau-flavored.

import { ReductionSolver } from './reduction.js';
import { buildPerms, applyMove } from '../geometry/perms-n.js';
import { SolverError } from '../infra/errors.js';
import { logger } from '../infra/logger.js';

// Substage goal predicates — replayed on the live state to detect where each
// substage finished within the bundled centers move list.
//
// These mirror reduction.js's CENTER_LOCAL definitions but operate on global
// 96-char state positions (the centers are at the inner 2×2 of each face).
const CENTER_FACE_INDICES = {
    // 96-char positions of the 4 centers on each face (the inner 2×2).
    U: [ 5,  6,  9, 10],
    R: [16+5, 16+6, 16+9, 16+10],   // 21, 22, 25, 26
    F: [32+5, 32+6, 32+9, 32+10],   // 37, 38, 41, 42
    D: [48+5, 48+6, 48+9, 48+10],   // 53, 54, 57, 58
    L: [64+5, 64+6, 64+9, 64+10],   // 69, 70, 73, 74
    B: [80+5, 80+6, 80+9, 80+10],   // 85, 86, 89, 90
};
const ALL_CENTER_POS = Object.values(CENTER_FACE_INDICES).flat();

function _allUDColorOnUDFace(state) {
    // pair-UD goal: every center position on U-face or D-face holds a U or D
    // color, AND every UD color is on a UD face.
    for (const p of CENTER_FACE_INDICES.U) if (state[p] !== 'U' && state[p] !== 'D') return false;
    for (const p of CENTER_FACE_INDICES.D) if (state[p] !== 'U' && state[p] !== 'D') return false;
    return true;
}

function _allFBColorOnFBFace(state) {
    // pair-FB goal: pair-UD still holds AND every FB color is on an FB face.
    if (!_allUDColorOnUDFace(state)) return false;
    for (const p of CENTER_FACE_INDICES.F) if (state[p] !== 'F' && state[p] !== 'B') return false;
    for (const p of CENTER_FACE_INDICES.B) if (state[p] !== 'F' && state[p] !== 'B') return false;
    return true;
}

function _allCentersSorted(state) {
    // sort-joint goal: every center position holds the exact color matching
    // its face — what reduction.js verifies at the end of _solveCenters.
    for (const face of ['U', 'R', 'F', 'D', 'L', 'B']) {
        for (const p of CENTER_FACE_INDICES[face]) {
            if (state[p] !== face) return false;
        }
    }
    return true;
}

// Yau-flavored teaching notes — these surface in the SolveGuide footer.
// Tone: short, narrative, explains WHY this step exists in the algorithm.
const YAU_TEACHING = {
    'yau-pair-ud':   '【Yau ①】先把 U/D 顏色聚到上下兩面，這是 Yau 方法把方塊「分層」的第一步。',
    'yau-pair-fb':   '【Yau ②】再把 F/B 顏色聚到前後兩面，左右剩下的自然就是 L/R。',
    'yau-sort':      '【Yau ③】每面 4 個中心同色化 — 中心歸位完成，方塊現在可以當 3×3 識別。',
    'yau-edges':     '【Yau ④】把 12 條邊的兩塊兩塊配對（dedge pairing）。Yau 在這步用 3-2-3 法。',
    'yau-parity':    '【Yau ⑤】4×4 特有偏差：兩塊邊互換或單條邊翻面，套對應公式修正。',
    'yau-kociemba':  '【Yau ⑥】配對後等同 3×3，用 Kociemba 兩階段找最少步收尾。',
};

export class YauSolver {
    constructor({ N, teaching } = {}) {
        if (N !== 4) {
            throw new SolverError(
                `YauSolver only supports N=4, got ${N}`,
                { kind: 'invalid-config' }
            );
        }
        this.N = N;
        this.teaching = { ...YAU_TEACHING, ...(teaching || {}) };
        // Under the hood: the proven Reduction algorithm. We override the
        // phase presentation, not the moves themselves.
        this._reduction = new ReductionSolver({ N, teaching: this.teaching, finisher: 'cstimer' });
        this.perms = buildPerms(N);

        this.name = 'yau-teach';
        this.displayName = '教學版（Yau 路徑）';
        this.description = '把 Reduction 拆解為 6 個 Yau 風格教學階段，每步附上「為什麼」說明';
        this.supportsTeaching = true;
        this.estimatedMoves = 100;
        this._lastTelemetry = null;
    }

    // Pass-through to the underlying solver — host calls this once at init.
    async preload(opts) {
        return this._reduction.preload(opts);
    }

    // Expose the inner solver's cstimer caller setter for worker injection.
    get cstimerCaller() { return this._reduction.cstimerCaller; }
    set cstimerCaller(fn) { this._reduction.cstimerCaller = fn; }

    async solve(state, opts = {}) {
        const result = await this._reduction.solve(state, opts);
        const reorganized = this._reorganizeForYau(state, result);
        this._lastTelemetry = result.telemetry;
        return reorganized;
    }

    /**
     * Walk through Reduction's phases and rewrite them as Yau pedagogy:
     *   centers → 3 substages (pair-UD, pair-FB, sort-joint)
     *   edges → "Yau dedge pairing"
     *   parity → "Yau parity"
     *   3x3-kociemba → "Yau 3×3 finish"
     *
     * Move sequences are preserved verbatim — only phase boundaries and
     * teachingNote strings change.
     */
    _reorganizeForYau(originalState, result) {
        const newPhases = [];
        let liveState = originalState;

        for (const phase of result.phases) {
            if (phase.name === 'centers' && phase.moves.length > 0) {
                // Split the bundled centers phase by replaying moves.
                const substages = this._splitCentersByGoal(liveState, phase.moves);
                newPhases.push(...substages);
                // Update liveState to post-centers (will apply remaining phases on top).
                for (const m of phase.moves) {
                    liveState = applyMove(this.perms, liveState, m.notation);
                }
                continue;
            }

            // Edges / parity / kociemba — keep moves, swap displayName + note.
            const yauPhase = this._yauify(phase);
            newPhases.push(yauPhase);
            for (const m of phase.moves) {
                liveState = applyMove(this.perms, liveState, m.notation);
            }
        }

        return {
            phases: newPhases,
            totalMoves: newPhases.reduce((s, p) => s + p.moves.length, 0),
            solverName: this.name,
            telemetry: result.telemetry,
        };
    }

    /**
     * Replay centers moves on the live state and partition them into three
     * substages by detecting when each goal predicate first becomes true.
     *
     * If a substage's goal is satisfied from the very start (e.g., the state
     * already had paired UD before solving), that substage produces zero
     * moves and is omitted from the output for a cleaner story.
     */
    _splitCentersByGoal(startState, centerMoves) {
        const substageDefs = [
            { name: 'yau-pair-ud',  display: '🌗 Yau ①：U/D 配對到上下面', goal: _allUDColorOnUDFace,  noteKey: 'yau-pair-ud' },
            { name: 'yau-pair-fb',  display: '🌗 Yau ②：F/B 配對到前後面', goal: _allFBColorOnFBFace,  noteKey: 'yau-pair-fb' },
            { name: 'yau-sort',     display: '🌗 Yau ③：每面同色化',       goal: _allCentersSorted,    noteKey: 'yau-sort' },
        ];

        const result = [];
        let state = startState;
        let moveIdx = 0;

        for (const def of substageDefs) {
            if (def.goal(state)) continue; // Already done — skip.

            const substageMoves = [];
            while (moveIdx < centerMoves.length && !def.goal(state)) {
                const m = centerMoves[moveIdx];
                state = applyMove(this.perms, state, m.notation);
                substageMoves.push({
                    notation:  m.notation,
                    phaseName: def.name,
                    templateKey: def.noteKey,
                });
                moveIdx++;
            }

            if (substageMoves.length > 0) {
                result.push({
                    name:         def.name,
                    displayName:  def.display,
                    moves:        substageMoves,
                    teachingNote: this.teaching[def.noteKey],
                });
            }
        }

        // Any leftover moves (shouldn't happen — verify) get tacked onto the
        // last substage with a warning log.
        if (moveIdx < centerMoves.length) {
            logger.solve('yau-split-leftover', {
                remaining: centerMoves.length - moveIdx,
                total: centerMoves.length,
            });
            const tail = centerMoves.slice(moveIdx).map(m => ({
                notation:  m.notation,
                phaseName: 'yau-sort',
                templateKey: 'yau-sort',
            }));
            if (result.length > 0) result[result.length - 1].moves.push(...tail);
        }

        return result;
    }

    /** Rewrite a non-centers phase with Yau-flavored display + note. */
    _yauify(phase) {
        const mapping = {
            'edges':         { display: '🌀 Yau ④：邊塊配對 (dedge pairing)',  noteKey: 'yau-edges' },
            'parity':        { display: '🌀 Yau ⑤：Parity 修正',                noteKey: 'yau-parity' },
            '3x3-kociemba':  { display: '🌀 Yau ⑥：3×3 收尾 (Kociemba)',        noteKey: 'yau-kociemba' },
        };
        const m = mapping[phase.name];
        if (!m) return phase; // unknown phase, leave as-is
        return {
            name:         phase.name,
            displayName:  m.display,
            moves:        phase.moves.map(mv => ({
                notation:    mv.notation,
                phaseName:   phase.name,
                templateKey: m.noteKey,
            })),
            teachingNote: this.teaching[m.noteKey],
        };
    }
}
