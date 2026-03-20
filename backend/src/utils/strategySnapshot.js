import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { loadStrategyConfig } from '../strategy/regime_engine.js';

/**
 * Generates a unique strategy snapshot based on current config.
 */
export function getStrategySnapshot() {
    const config = loadStrategyConfig();
    
    // Add metadata/labels as requested
    const snapshot = {
        strategyName: config.general.strategyName || "Adaptive Regime Bot V2",
        timestamp: new Date().toISOString(),
        ...config
    };

    const hash = crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex').substring(0, 8);
    snapshot.strategyId = `STRATEGY_${hash}`;

    return snapshot;
}

/**
 * Displays a formatted strategy panel in the console.
 */
export function displayStrategyPanel(snapshot) {
    console.log('\n' + '='.repeat(50));
    console.log('         STRATEGY CONFIGURATION PANEL');
    console.log('='.repeat(50));
    console.log(`\nID: ${snapshot.strategyId}`);
    console.log(`Strategy: ${snapshot.strategyName}`);

    console.log('\n--- Trend Following Strategy ---');
    if (snapshot.trendStrategy) {
        console.log(`EMA Fast/Slow:          ${snapshot.trendStrategy.emaFast} / ${snapshot.trendStrategy.emaSlow}`);
        console.log(`ADX Threshold:          ${snapshot.regime?.trendAdxThreshold}`);
        console.log(`Min Volatility:         ${snapshot.regime?.minVolatilityPercent * 100}%`);
        console.log(`Volume Multiplier:      ${snapshot.trendStrategy.volumeMultiplier}x`);
        console.log(`Preferred Leverage:     ${snapshot.trendStrategy.leverage}x`);
    } else {
        console.log(`No Trend Strategy config found.`);
    }

    console.log('\n--- Risk Management ---');
    if (snapshot.risk) {
        console.log(`Risk Per Trade:         ${(snapshot.risk.maxRiskPerTrade * 100).toFixed(1)}%`);
        console.log(`Max Account Exposure:   ${(snapshot.risk.maxAccountExposure * 100).toFixed(1)}%`);
    }
    console.log(`Max Drawdown Stop:      ${(snapshot.general.maxDrawdownStop * 100).toFixed(1)}%`);
    console.log(`Max Daily Loss:         ${(snapshot.general.maxDailyLoss * 100).toFixed(1)}%`);

    console.log('\n--- Execution ---');
    console.log(`Max Spread:             ${(snapshot.general.maxSpreadPercent * 100).toFixed(2)}%`);
    console.log(`Cooldown:               ${snapshot.general.cooldownMinutes} min`);
    console.log(`Funding Rate Filter:    ${snapshot.general.fundingRateFilter}`);

    console.log('\n' + '='.repeat(50) + '\n');
}

/**
 * Saves a strategy snapshot to the backtest_logs directory.
 */
export function saveStrategySnapshot(snapshot) {
    const logDir = path.join(process.cwd(), 'backtest_logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

    const safeTs = snapshot.timestamp.replace(/[:.]/g, '-');
    const filename = `strategy_snapshot_${safeTs}.json`;
    const filePath = path.join(logDir, filename);

    fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));
    console.log(`[SNAPSHOT] Config saved → ${filePath}`);
    return filename;
}
