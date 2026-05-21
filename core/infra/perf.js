// Performance tracking and budget assertions.
//
// Usage:
//   import { perf } from './core/infra/perf.js';
//   const end = perf.start('reduction-solve');
//   ... work ...
//   end();  // logs duration; warns if exceeded budget
//
// Budgets are documented contracts. If we exceed one, we want to know
// — either tune the code, or update the budget and admit it.

import { logger } from './logger.js';

/**
 * Performance budgets in milliseconds.
 * Keep this list small and meaningful — it's a contract, not a wishlist.
 */
const BUDGETS = {
    'reduction-solve-4x4': 1000,   // 4×4 reduction should complete in <1s
    'kociemba-init':       6000,   // cubejs initSolver (3-5s desktop, more on mobile)
    'kociemba-solve-3x3':  100,    // cubejs cube.solve(22) after init
    'scan-frame-classify': 100,    // per-frame color classification
    'state-validate-4x4':  10,     // StateValidator4.validate
    'palette-rebuild':     50,     // progressive palette refresh
};

/**
 * Start a measurement. Returns a function — call it when work completes.
 * @param {string} label   Identifier; if in BUDGETS, will check against it.
 * @returns {function(): number}  Returns duration in ms.
 */
function start(label) {
    const t0 = (typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now();
    return function end() {
        const t1 = (typeof performance !== 'undefined' && performance.now)
            ? performance.now()
            : Date.now();
        const ms = Math.round((t1 - t0) * 100) / 100;
        const budget = BUDGETS[label];
        if (budget !== undefined && ms > budget) {
            logger.perf('budget-exceeded', { label, ms, budget });
        } else {
            logger.perf('measured', { label, ms });
        }
        return ms;
    };
}

/**
 * Synchronous wrap helper: measures a function execution.
 */
function measure(label, fn) {
    const end = start(label);
    try {
        return fn();
    } finally {
        end();
    }
}

/**
 * Async wrap helper.
 */
async function measureAsync(label, fn) {
    const end = start(label);
    try {
        return await fn();
    } finally {
        end();
    }
}

/** Return the currently configured budgets (for tests / diagnostic UI). */
function budgets() {
    return { ...BUDGETS };
}

export const perf = { start, measure, measureAsync, budgets };
