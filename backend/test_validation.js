import { calculatePositionSize } from './src/risk/position_sizing.js';

/**
 * STABILIZATION: Validation Test Suite
 * Tests position sizing, trade validation logic, and risk bounds.
 */

let passed = 0;
let failed = 0;

function assert(condition, testName) {
    if (condition) {
        console.log(`  ✅ ${testName}`);
        passed++;
    } else {
        console.error(`  ❌ ${testName}`);
        failed++;
    }
}

console.log('\n=== STABILIZATION VALIDATION TESTS ===\n');

// ── TEST 1: Position sizing with valid data (0.5% risk) ──
console.log('[TEST 1] Position Sizing — Valid data, 0.5% risk');
{
    const result = calculatePositionSize({
        accountBalance: 1000,
        entryPrice: 50000,
        atr: 500,
        stopATRMultiplier: 1.5,
        maxRiskPerTrade: 0.005,
    });

    assert(result.positionSizeUSDT > 0, 'Position size is positive');
    assert(result.finalRiskPct === 0.005, 'Risk is 0.5%');
    assert(result.riskAmountUSDT === 5, 'Risk amount is $5');
    assert(result.expectedLossUSDT <= 5.01, `Expected loss $${result.expectedLossUSDT.toFixed(2)} <= $5`);
    
    // Verify: stopDistance = 500 * 1.5 = 750, stopPct = 750/50000 = 0.015 (1.5%)
    // positionSize = 5 / 0.015 = 333.33
    assert(Math.abs(result.positionSizeUSDT - 333.33) < 1, `Position ~$333 (got $${result.positionSizeUSDT.toFixed(2)})`);
}

// ── TEST 2: Position sizing — drawdown exceeded ──
console.log('\n[TEST 2] Position Sizing — Drawdown exceeded (15%)');
{
    const result = calculatePositionSize({
        accountBalance: 1000,
        entryPrice: 50000,
        atr: 500,
        stopATRMultiplier: 1.5,
        maxRiskPerTrade: 0.005,
        currentDrawdown: 0.16,
    });

    assert(result.positionSizeUSDT === 0, 'Position size is 0');
    assert(result.reason.includes('DRAWDOWN'), `Reason: ${result.reason}`);
}

// ── TEST 3: Position sizing — zero ATR ──
console.log('\n[TEST 3] Position Sizing — Zero ATR');
{
    const result = calculatePositionSize({
        accountBalance: 1000,
        entryPrice: 50000,
        atr: 0,
        stopATRMultiplier: 1.5,
        maxRiskPerTrade: 0.005,
    });

    // Should use MIN_STOP_DISTANCE_PCT (0.2%) or return invalid
    assert(result.positionSizeUSDT >= 0, 'Handles zero ATR gracefully');
    if (result.positionSizeUSDT > 0) {
        assert(result.stopDistanceClipped === true, 'Stop distance was clipped to minimum');
    }
}

// ── TEST 4: Position sizing — tiny ATR (stop distance clipping) ──
console.log('\n[TEST 4] Position Sizing — Tiny ATR (stop clipping)');
{
    const result = calculatePositionSize({
        accountBalance: 1000,
        entryPrice: 50000,
        atr: 1, // Very small ATR
        stopATRMultiplier: 1.5,
        maxRiskPerTrade: 0.005,
    });

    assert(result.positionSizeUSDT > 0, 'Position size is positive');
    assert(result.stopDistanceClipped === true, 'Stop distance was clipped');
    assert(result.stopDistancePercent >= 0.002, 'Stop distance >= 0.2%');
}

// ── TEST 5: Position sizing — leverage cap ──
console.log('\n[TEST 5] Position Sizing — Leverage cap');
{
    const result = calculatePositionSize({
        accountBalance: 100,
        entryPrice: 50000,
        atr: 5, // Very small ATR → huge position
        stopATRMultiplier: 1.5,
        maxRiskPerTrade: 0.005,
        maxLeverage: 5,
    });

    assert(result.positionSizeUSDT <= 500, `Size $${result.positionSizeUSDT.toFixed(2)} <= $500 (5x leverage)`);
}

// ── TEST 6: BTC realistic scenario ──  
console.log('\n[TEST 6] Realistic BTC Scenario');
{
    const result = calculatePositionSize({
        accountBalance: 1000,
        entryPrice: 85000,
        atr: 800,
        stopATRMultiplier: 1.5,
        maxRiskPerTrade: 0.005,
        maxLeverage: 5,
    });

    // Stop = 800 * 1.5 = 1200, stopPct = 1200/85000 = 1.41%
    // Risk = $5, position = 5 / 0.01412 = ~$354
    assert(result.positionSizeUSDT > 0, 'Valid position');
    assert(result.expectedLossUSDT <= 5.01, `Max loss $${result.expectedLossUSDT.toFixed(2)} (should be ~$5)`);
    
    const pnlPct = result.expectedLossUSDT / result.accountBalance * 100;
    assert(pnlPct <= 0.6, `Loss as % of account: ${pnlPct.toFixed(3)}% (should be ~0.5%)`);
}

// ── TEST 7: ETH realistic scenario ──  
console.log('\n[TEST 7] Realistic ETH Scenario');
{
    const result = calculatePositionSize({
        accountBalance: 1000,
        entryPrice: 3500,
        atr: 50,
        stopATRMultiplier: 1.5,
        maxRiskPerTrade: 0.005,
        maxLeverage: 5,
    });

    assert(result.positionSizeUSDT > 0, 'Valid position');
    assert(result.expectedLossUSDT <= 5.01, `Max loss $${result.expectedLossUSDT.toFixed(2)}`);
}

// ── SUMMARY ──
console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
if (failed === 0) {
    console.log('✅ ALL TESTS PASSED');
} else {
    console.error('❌ SOME TESTS FAILED');
}
process.exit(failed > 0 ? 1 : 0);
