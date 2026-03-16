import { getStrategySnapshot, displayStrategyPanel, saveStrategySnapshot } from './src/utils/strategySnapshot.js';

console.log('--- STRATEGY SNAPSHOT TEST ---');

const snapshot = getStrategySnapshot();
displayStrategyPanel(snapshot);

console.log('Strategy ID:', snapshot.strategyId);

const filename = saveStrategySnapshot(snapshot);
console.log('Saved to:', filename);

// Verify hashing (changing a value should change the hash)
import fs from 'fs';
import path from 'path';

const configPath = path.join(process.cwd(), 'config', 'strategy_config.json');
const originalConfig = fs.readFileSync(configPath, 'utf8');

try {
    const config = JSON.parse(originalConfig);
    config.risk.maxRiskPerTrade = 0.99; // temporary change
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    const snapshot2 = getStrategySnapshot();
    console.log('New Strategy ID (after config change):', snapshot2.strategyId);

    if (snapshot.strategyId !== snapshot2.strategyId) {
        console.log('✅ Hashing verification success: Hash changed after config change.');
    } else {
        console.log('❌ Hashing verification failure: Hash remained the same!');
    }
} finally {
    // Restore original config
    fs.writeFileSync(configPath, originalConfig);
}
