// Verify core/geometry/* produces output identical to the inline
// FACE_COORDS + buildPerms4() in cube4x4.html.
//
// Why this matters: if even one move's permutation differs, every
// downstream solver / 3D animation / scanner result will be silently
// wrong. The new geometry MUST be a drop-in replacement.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let pass = 0, fail = 0;
const failures = [];

function check(name, cond, extra) {
    if (cond) { pass++; console.log('  ✓', name); }
    else {
        fail++; failures.push({ name, extra });
        console.log('  ✗', name, extra ? '\n      ' + extra : '');
    }
}

async function main() {
    // ─── T1: Module loads & exports ─────────────────────────────────
    console.log('=== T1: cube-geometry-n.js loads & exports ===');
    const geom = await import('../../core/geometry/cube-geometry-n.js');
    check('FACE_ORDER 為陣列', Array.isArray(geom.FACE_ORDER) && geom.FACE_ORDER.length === 6);
    check('FACE_ORDER 順序為 URFDLB', geom.FACE_ORDER.join('') === 'URFDLB');
    check('halfExtent(3) === 1', geom.halfExtent(3) === 1);
    check('halfExtent(4) === 1.5', geom.halfExtent(4) === 1.5);
    check('halfExtent(5) === 2', geom.halfExtent(5) === 2);
    check('totalStickers(3) === 54', geom.totalStickers(3) === 54);
    check('totalStickers(4) === 96', geom.totalStickers(4) === 96);
    check('totalStickers(5) === 150', geom.totalStickers(5) === 150);
    check('axisCoords(4) 正確', JSON.stringify(geom.axisCoords(4)) === '[-1.5,-0.5,0.5,1.5]');

    // ─── T2: buildFaceCoords(4) matches inline FACE_COORDS ──────────
    console.log('\n=== T2: buildFaceCoords(4) vs cube4x4.html FACE_COORDS ===');
    const html = fs.readFileSync(path.join(__dirname, '..', '..', 'cube4x4.html'), 'utf8');
    const faceCoordsBlock = html.slice(
        html.indexOf('const FACE_COORDS = {'),
        html.indexOf('\n        const TWO_SHOT_SCANS')
    );
    const ctx = {};
    vm.createContext(ctx);
    vm.runInContext(faceCoordsBlock + '\nthis.FACE_COORDS = FACE_COORDS;', ctx);
    const inlineFC = ctx.FACE_COORDS;
    const newFC = geom.buildFaceCoords(4);

    for (const face of geom.FACE_ORDER) {
        const inline = inlineFC[face];
        const built = newFC[face];
        check(`${face}: 數量相同 (${inline.length})`, inline.length === built.length);
        let allMatch = true;
        for (let i = 0; i < inline.length; i++) {
            const a = inline[i], b = built[i];
            if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) {
                allMatch = false;
                check(`  ${face}[${i}] 一致`, false,
                    `inline=[${a}] built=[${b}]`);
                break;
            }
        }
        if (allMatch) check(`  ${face}: 全部 ${inline.length} 個座標完全一致`, true);
    }

    // ─── T3: buildPerms(4) matches inline buildPerms4 ───────────────
    console.log('\n=== T3: buildPerms(4) vs cube4x4.html buildPerms4 ===');
    const perms = await import('../../core/geometry/perms-n.js');
    const newPerms = perms.buildPerms(4);

    // Load inline buildPerms4 — needs FACE_COORDS in ctx already
    const buildPermsBlock = html.slice(
        html.indexOf('function buildPerms4()'),
        html.indexOf('const PERMS_4 = buildPerms4();')
    );
    vm.runInContext(buildPermsBlock + '\nconst PERMS_4 = buildPerms4();\nthis.PERMS_4 = PERMS_4;', ctx);
    const inlinePerms = ctx.PERMS_4;

    const inlineKeys = Object.keys(inlinePerms).sort();
    const newKeys = Object.keys(newPerms).sort();
    check('Move 集合大小相同', inlineKeys.length === newKeys.length,
        `inline=${inlineKeys.length} new=${newKeys.length}`);

    // 全部 move 名稱應相同
    const missingInNew = inlineKeys.filter(k => !newPerms[k]);
    const missingInInline = newKeys.filter(k => !inlinePerms[k]);
    check('No moves missing in new', missingInNew.length === 0,
        missingInNew.length ? `missing: ${missingInNew.join(', ')}` : '');
    check('No extra moves in new', missingInInline.length === 0,
        missingInInline.length ? `extra: ${missingInInline.join(', ')}` : '');

    // 每個 move 的 permutation array 必須位元相同
    let mismatchCount = 0;
    const mismatches = [];
    for (const key of inlineKeys) {
        if (!newPerms[key]) continue;
        const a = inlinePerms[key], b = newPerms[key];
        if (a.length !== b.length) {
            mismatches.push(`${key}: length ${a.length} vs ${b.length}`);
            mismatchCount++;
            continue;
        }
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) {
                mismatches.push(`${key}: index ${i} → inline=${a[i]} new=${b[i]}`);
                mismatchCount++;
                break;  // only report first mismatch per move
            }
        }
    }
    check(`所有 ${inlineKeys.length} 個 move 的 permutation 位元相同`,
        mismatchCount === 0,
        mismatchCount ? mismatches.slice(0, 5).join('\n      ') : '');

    // ─── T4: applyMove identity tests ───────────────────────────────
    console.log('\n=== T4: applyMove 行為驗證 ===');
    const SOLVED4 = geom.buildSolvedState(4);
    check('SOLVED state 長度為 96', SOLVED4.length === 96);
    check('SOLVED state 字元集合', /^[URFDLB]+$/.test(SOLVED4));

    // R 然後 R' 應回到 SOLVED
    let s = perms.applyMove(newPerms, SOLVED4, 'R');
    s = perms.applyMove(newPerms, s, "R'");
    check('R + R\' 回到 SOLVED', s === SOLVED4);

    // R2 兩次也應回到 SOLVED
    s = perms.applyMove(newPerms, SOLVED4, 'R2');
    s = perms.applyMove(newPerms, s, 'R2');
    check('R2 × 2 回到 SOLVED', s === SOLVED4);

    // (Rw U Rw' U') × 6 應回到 SOLVED（這個 sexy move 在 4×4 outer 上有 6 階週期）
    s = SOLVED4;
    for (let i = 0; i < 6; i++) {
        s = perms.applyMoves(newPerms, s, ['R', 'U', "R'", "U'"]);
    }
    check('(R U R\' U\') × 6 回到 SOLVED', s === SOLVED4);

    // 反轉函式
    check('inverseNotation("R") = "R\'"', perms.inverseNotation('R') === "R'");
    check('inverseNotation("R\'") = "R"', perms.inverseNotation("R'") === 'R');
    check('inverseNotation("R2") = "R2"', perms.inverseNotation('R2') === 'R2');
    check('inverseNotation("Rw") = "Rw\'"', perms.inverseNotation('Rw') === "Rw'");

    const seq = ['R', 'U', "F'"];
    const inv = perms.inverseMoves(seq);
    check('inverseMoves 反序+反向', JSON.stringify(inv) === '["F","U\'","R\'"]');

    // 套用 seq + 套用 inv 應回到原狀
    s = perms.applyMoves(newPerms, SOLVED4, seq);
    s = perms.applyMoves(newPerms, s, inv);
    check('seq + inverse(seq) 回到原狀', s === SOLVED4);

    // ─── T5: centerIndices & fixedCenterIndex ──────────────────────
    console.log('\n=== T5: centerIndices / fixedCenterIndex ===');
    const ci4 = geom.centerIndices(4);
    check('N=4 U-face centers count', ci4.U.length === 4);
    check('N=4 U-face centers 正確', JSON.stringify(ci4.U) === '[5,6,9,10]');
    check('N=4 R-face centers 正確', JSON.stringify(ci4.R) === '[21,22,25,26]');
    check('N=4 fixedCenterIndex 為 null', geom.fixedCenterIndex(4, 'U') === null);

    const ci3 = geom.centerIndices(3);
    check('N=3 U-face centers 只有 1 個', ci3.U.length === 1);
    check('N=3 U-face center 為 4', ci3.U[0] === 4);
    check('N=3 fixedCenterIndex U = 4', geom.fixedCenterIndex(3, 'U') === 4);
    check('N=3 fixedCenterIndex R = 13', geom.fixedCenterIndex(3, 'R') === 13);

    const ci5 = geom.centerIndices(5);
    check('N=5 U-face centers 9 個', ci5.U.length === 9);
    check('N=5 fixedCenterIndex U = 12', geom.fixedCenterIndex(5, 'U') === 12);

    // ─── Summary ─────────────────────────────────────────────────────
    console.log('\n────────────────────────────');
    console.log(`  ${pass} passed, ${fail} failed (total ${pass + fail})`);
    if (fail === 0) {
        console.log('  ✓ core/geometry 與 cube4x4.html 完全一致');
        process.exit(0);
    } else {
        console.log('  ✗ 失敗項目：');
        failures.forEach(f => console.log('    -', f.name));
        process.exit(1);
    }
}

main().catch(err => {
    console.error('[FATAL]', err);
    process.exit(2);
});
