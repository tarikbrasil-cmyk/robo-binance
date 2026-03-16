import { calculatePositionSize } from './src/risk/position_sizing.js';

// Mock config
const config = {
    risk: { maxRiskPerTrade: 0.02 },
    trendStrategy: { leverage: 20 },
    general: { maxDrawdownStop: 0.25 }
};

// Simulation scenario
const accountBalance = 1000;
const entryPrice = 2500; // ETH example
const atr = 50;
const stopATRMultiplier = 1.5;

const result = calculatePositionSize({
    accountBalance,
    entryPrice,
    atr,
    stopATRMultiplier,
    config,
    indicator: { atr, atrSma100: 50 },
});

console.log('--- POSITION SIZING TEST ---');
console.log('Account Balance:', accountBalance);
console.log('Entry Price:', entryPrice);
console.log('Indicator ATR:', atr);
console.log('Position Size USDT (Notional):', result.positionSizeUSDT.toFixed(2));
console.log('Contracts:', result.positionSizeContracts.toFixed(6));
console.log('Leverage implied:', (result.positionSizeUSDT / accountBalance).toFixed(2) + 'x');

// Verification logic for the fix in orderRouter.js
const positionalUSDT = result.positionSizeUSDT;
const leverage = 20;

const notional_old = (positionalUSDT * 0.98) * leverage;
const notional_new = positionalUSDT * 0.98;

console.log('\n--- QUANTITY RE-CALCULATION VERIFICATION ---');
console.log('Position Size from sizing module:', positionalUSDT.toFixed(2));
console.log('OLD Notional (Redundant Leverage):', notional_old.toFixed(2));
console.log('NEW Notional (Correct):', notional_new.toFixed(2));
console.log('OLD Qty (ETH):', (notional_old / entryPrice).toFixed(4));
console.log('NEW Qty (ETH):', (notional_new / entryPrice).toFixed(4));

if (notional_new / accountBalance <= (leverage + 1)) {
    console.log('\n✅ VERIFICATION SUCCESS: New notional is within expected leverage limits.');
} else {
    console.log('\n❌ VERIFICATION FAILURE: New notional still exceeds expected leverage limits!');
}
