// Smoke test: verify that the new core/ modules load correctly under Node
// with ES Modules (Node ≥ 14 supports import() natively).
//
// Run: node test/core/test_modules_smoke.js
//
// This is the Node counterpart to test_modules.html. The HTML version
// verifies the same modules work in a browser. Both should pass.

'use strict';

let pass = 0, fail = 0;
const failures = [];

function check(name, cond, extra) {
    if (cond) {
        pass++;
        console.log('  ✓', name);
    } else {
        fail++;
        failures.push({ name, extra });
        console.log('  ✗', name, extra ? '— ' + extra : '');
    }
}

(async () => {
    console.log('=== T1: core/infra/logger.js ===');
    const loggerMod = await import('../../core/infra/logger.js');
    check('logger 物件存在', typeof loggerMod.logger === 'object');
    check('logger.scan 是 function', typeof loggerMod.logger.scan === 'function');
    check('logger.solve 是 function', typeof loggerMod.logger.solve === 'function');
    check('logger.perf 是 function', typeof loggerMod.logger.perf === 'function');
    check('dumpRecentEvents 是 function', typeof loggerMod.dumpRecentEvents === 'function');

    // 換 sink 避免污染輸出
    const captured = [];
    loggerMod.setSink((cat, ev, data) => captured.push({ cat, ev, data }));
    loggerMod.logger.scan('node-smoke-test', { ok: true });
    check('logger.scan 寫入自訂 sink', captured.length === 1 && captured[0].ev === 'node-smoke-test');
    check('dumpRecentEvents 含此事件', loggerMod.dumpRecentEvents().some(e => e.event === 'node-smoke-test'));
    loggerMod.setSink(null); // 回到 default

    console.log('\n=== T2: core/infra/errors.js ===');
    const errsMod = await import('../../core/infra/errors.js');
    check('AppError 存在', typeof errsMod.AppError === 'function');
    check('ValidationError 存在', typeof errsMod.ValidationError === 'function');
    check('SolverError 存在', typeof errsMod.SolverError === 'function');
    check('ScannerError 存在', typeof errsMod.ScannerError === 'function');
    check('HandoffError 存在', typeof errsMod.HandoffError === 'function');

    const e = new errsMod.AppError('test', { kind: 'X' });
    check('AppError extends Error', e instanceof Error);
    check('AppError.kind 正確', e.kind === 'X');
    check('AppError.name 是 AppError', e.name === 'AppError');

    const v = new errsMod.ValidationError('count fail', { severity: 'count', errors: ['U=15'], state: 'X'.repeat(96) });
    check('ValidationError.severity 正確', v.severity === 'count');
    check('ValidationError.errors 正確', v.errors.length === 1);

    const s = new errsMod.SolverError('reduction failed', { kind: 'reduction-failed', phase: 'centers', state: 'X'.repeat(96), partialMoves: ['R','U'] });
    check('SolverError.phase 正確', s.phase === 'centers');
    check('SolverError.kind 正確', s.kind === 'reduction-failed');

    const json = e.toJSON();
    check('AppError.toJSON 含 kind', json.kind === 'X');
    check('AppError.toJSON 含 message', json.message === 'test');

    // cause chain
    const inner = new Error('original');
    const wrapped = new errsMod.SolverError('wrap', { kind: 'cubejs-failed', cause: inner });
    check('SolverError.cause 保留', wrapped.cause === inner);
    check('toJSON 序列化 cause', wrapped.toJSON().cause !== undefined);

    console.log('\n=== T3: core/infra/perf.js ===');
    const perfMod = await import('../../core/infra/perf.js');
    check('perf 物件存在', typeof perfMod.perf === 'object');
    check('perf.start 是 function', typeof perfMod.perf.start === 'function');
    check('perf.measure 是 function', typeof perfMod.perf.measure === 'function');
    check('perf.measureAsync 是 function', typeof perfMod.perf.measureAsync === 'function');
    check('perf.budgets 是 function', typeof perfMod.perf.budgets === 'function');

    const budgets = perfMod.perf.budgets();
    check('budgets 含 reduction-solve-4x4', typeof budgets['reduction-solve-4x4'] === 'number');
    check('budgets 含 kociemba-init', typeof budgets['kociemba-init'] === 'number');

    // measure 一個 sleep
    const end = perfMod.perf.start('test-no-budget');
    await new Promise(r => setTimeout(r, 30));
    const ms = end();
    check('perf.start/end 回傳 ms', typeof ms === 'number' && ms >= 25 && ms < 200);

    // measure helper
    const result = perfMod.perf.measure('test-no-budget', () => {
        let x = 0; for (let i = 0; i < 1000; i++) x += i; return x;
    });
    check('perf.measure 回傳 fn 結果', result === 499500);

    const asyncResult = await perfMod.perf.measureAsync('test-no-budget', async () => {
        await new Promise(r => setTimeout(r, 10));
        return 'ok';
    });
    check('perf.measureAsync 回傳 fn 結果', asyncResult === 'ok');

    console.log('\n=== T4: core/solver/solver-types.js ===');
    const typesMod = await import('../../core/solver/solver-types.js');
    check('SOLVER_TYPES_VERSION 存在', typeof typesMod.SOLVER_TYPES_VERSION === 'string');
    check('SOLVER_TYPES_VERSION === 1.0.0', typesMod.SOLVER_TYPES_VERSION === '1.0.0');

    console.log('\n=== T5: 跨模組互動 ===');
    // errors.js import logger.js — 確認 chain 正常
    try {
        const newErr = new errsMod.SolverError('cross-module test', { phase: 'centers' });
        loggerMod.logger.error('test-cross', newErr.toJSON());
        check('errors → logger 跨模組 import OK', true);
    } catch (err) {
        check('errors → logger 跨模組 import OK', false, err.message);
    }

    console.log('\n────────────────────────────');
    console.log(`  ${pass} passed, ${fail} failed (total ${pass + fail})`);
    if (fail === 0) {
        console.log('  ✓ Phase 0 核心模組全部 Node-side 通過');
        process.exit(0);
    } else {
        console.log('  ✗ 失敗項目：');
        failures.forEach(f => console.log('    -', f.name, f.extra || ''));
        process.exit(1);
    }
})().catch(err => {
    console.error('\n[FATAL] 測試本身崩潰：', err);
    process.exit(2);
});
