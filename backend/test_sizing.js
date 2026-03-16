import { calculatePositionSize } from './src/risk/position_sizing.js';

const config = {
  general: { maxDrawdownStop: 0.25 },
  risk: { maxRiskPerTrade: 0.02 },
  trendStrategy: { leverage: 10 },
  vwapStrategy: { stopLossAtrMultiplier: 1.0 },
};

// Simulate the failing trade: SELL at 36131, ATR=76
const result = calculatePositionSize({
  accountBalance: 1000,
  entryPrice: 36131,
  atr: 76,
  stopATRMultiplier: 1.0,
  config,
  indicator: { atr: 76, atrSma100: 105 }, // atr/atrSma100 = 0.72 (normal vol)
  historicalWinRate: 0.55,
  historicalRewardRisk: 1.5,
  consecutiveWins: 0,
  currentDrawdown: 0,
});

console.log('=== Position Sizing Unit Test ===');
console.log('accountBalance: 1000');
console.log('ATR: 76, entry: 36131');
console.log('stopDistance:', result.stopDistance);
console.log('stopDistancePct:', (result.stopDistancePercent * 100).toFixed(4) + '%');
console.log('stopDistanceClipped:', result.stopDistanceClipped);
console.log('riskAmountUSDT:', result.riskAmountUSDT?.toFixed(4));
console.log('positionSizeUSDT:', result.positionSizeUSDT?.toFixed(4));
console.log('expectedLossUSDT:', result.expectedLossUSDT?.toFixed(4));
console.log('');

// Effective SL for SELL
const effectiveSLPrice = 36131 * (1 + result.stopDistancePercent);
const roe = (36131 - effectiveSLPrice) / 36131; // SELL roe when SL hit
const pnl = result.positionSizeUSDT * roe;
console.log('effectiveSLPrice:', effectiveSLPrice.toFixed(2));
console.log('roe when SL hit:', (roe * 100).toFixed(4) + '%');
console.log('pnl when SL hit:', pnl.toFixed(4));
console.log('pnl / balance:', (pnl / 1000 * 100).toFixed(4) + '%');
console.log('');
console.log(Math.abs(pnl) <= 25 ? '✅ PASS: Loss bounded to ~2% of account' : '❌ FAIL: Loss exceeds limit');
