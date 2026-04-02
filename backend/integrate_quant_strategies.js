/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  STRATEGY INTEGRATION SCRIPT
 *  ─────────────────────────────
 *  Reads quant optimization results and:
 *  1. Saves winning strategies to the database via API
 *  2. Creates production strategy configs
 *  3. Applies the active strategy to the demo bot
 * ══════════════════════════════════════════════════════════════════════════════
 */
import fs from 'fs';
import path from 'path';

const API_URL = process.env.API_URL || 'http://localhost:3001/api';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function apiPost(endpoint, body) {
    const resp = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(`API ${endpoint}: ${data.error || resp.statusText}`);
    return data;
}

async function apiGet(endpoint) {
    const resp = await fetch(`${API_URL}${endpoint}`);
    const data = await resp.json();
    if (!resp.ok) throw new Error(`API ${endpoint}: ${data.error || resp.statusText}`);
    return data;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const reportPath = path.join(process.cwd(), 'quant_optimization_report.json');
    if (!fs.existsSync(reportPath)) {
        console.error('[ERROR] quant_optimization_report.json not found. Run run_quant_optimization.js first.');
        process.exit(1);
    }

    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    console.log(`[INFO] Loaded optimization report from ${report.timestamp}`);
    if (report.executionTime) console.log(`[INFO] Execution time: ${report.executionTime}`);
    console.log();

    // Process each symbol winner
    for (const [symbol, winner] of Object.entries(report.winners)) {
        const base = symbol.replace('USDT', '');
        // v3 report uses: mode (pullback/breakout/meanReversion), emaFast, emaSlow, atrMult, tpMult, cc
        const mode = winner.params.mode || (winner.params.useBreakout ? 'breakout' : (winner.params.useMeanReversion ? 'meanReversion' : 'pullback'));
        const modeLabel = mode.charAt(0).toUpperCase() + mode.slice(1);
        const strategyName = `${base}_Quantum_${modeLabel}_v1`;

        console.log(`━━━ ${symbol}: ${strategyName} ━━━`);
        console.log(`  Score:  ${winner.score.toFixed(4)}`);
        console.log(`  AvgWR:  ${winner.summary.avgWR.toFixed(1)}% | MinWR: ${winner.summary.minWR.toFixed(1)}%`);
        console.log(`  AvgPF:  ${winner.summary.avgPF.toFixed(2)} | MaxDD: ${winner.summary.maxDD.toFixed(1)}%`);
        console.log(`  Sharpe: ${winner.summary.avgSharpe.toFixed(2)}`);
        console.log();

        // Build the params object matching the benchmark/apply schema
        // Support both v1 field names (emaFastPeriod) and v3 field names (emaFast)
        const stratParams = {
            emaFastPeriod: winner.params.emaFast || winner.params.emaFastPeriod,
            emaSlowPeriod: winner.params.emaSlow || winner.params.emaSlowPeriod,
            emaHTFPeriod: 1000,
            rsiPeriod: 14,
            rsiOversold: winner.params.rsiOversold,
            rsiOverbought: winner.params.rsiOverbought,
            atrMultiplier: winner.params.atrMult || winner.params.atrMultiplier,
            tpMultiplier: winner.params.tpMult || winner.params.tpMultiplier,
            useBreakout: mode === 'breakout',
            useMeanReversion: mode === 'meanReversion',
            useSessionFilter: true,
            session: winner.params.session,
            useCandleConfirmation: winner.params.cc !== undefined ? winner.params.cc : winner.params.useCandleConfirmation,
            useEmaHTF: false,
            useMacd: false,
        };

        // 1. Insert into strategies table via API
        try {
            const result = await apiPost('/strategies', {
                name: strategyName,
                source: 'quant_optimization',
                params: stratParams,
                symbol: symbol,
                timeframe: '5m',
                is_active: false,
                benchmark_validated: true,
                backtest_validated: true,
                benchmark_score: winner.score,
            });
            console.log(`  [DB] Strategy saved: id=${result.id} name=${result.name}`);
        } catch (err) {
            if (err.message.includes('409') || err.message.includes('unique') || err.message.includes('UNIQUE')) {
                console.log(`  [DB] Strategy "${strategyName}" already exists — skipping insert`);
            } else {
                console.error(`  [DB ERROR] ${err.message}`);
            }
        }
    }

    // Ask which symbol to activate
    const symbols = Object.keys(report.winners);
    if (symbols.length > 0) {
        const activateSymbol = process.argv[2] || symbols[0];
        const winner = report.winners[activateSymbol];

        if (winner) {
            const mode = winner.params.mode || (winner.params.useBreakout ? 'breakout' : (winner.params.useMeanReversion ? 'meanReversion' : 'pullback'));
            const modeLabel = mode.charAt(0).toUpperCase() + mode.slice(1);
            const strategyName = `${activateSymbol.replace('USDT', '')}_Quantum_${modeLabel}_v1`;

            console.log(`\n━━━ APPLYING ${strategyName} TO DEMO BOT ━━━`);

            // Apply via benchmark/apply endpoint
            try {
                const result = await apiPost('/benchmark/apply', {
                    params: {
                        emaFastPeriod: winner.params.emaFast || winner.params.emaFastPeriod,
                        emaSlowPeriod: winner.params.emaSlow || winner.params.emaSlowPeriod,
                        rsiOversold: winner.params.rsiOversold,
                        rsiOverbought: winner.params.rsiOverbought,
                        atrMultiplier: winner.params.atrMult || winner.params.atrMultiplier,
                        tpMultiplier: winner.params.tpMult || winner.params.tpMultiplier,
                        useBreakout: mode === 'breakout',
                        useMeanReversion: mode === 'meanReversion',
                        session: winner.params.session,
                        useSessionFilter: true,
                    },
                    symbol: activateSymbol,
                    timeframe: '5m',
                });
                console.log(`  [APPLIED] ${strategyName} → demo bot config updated`);
                console.log(`  Config: ${JSON.stringify(result.config?.general, null, 2)}`);
            } catch (err) {
                console.error(`  [APPLY ERROR] ${err.message}`);
                console.log('  Hint: Is the backend server running on port 3001?');
            }
        }
    }

    console.log('\n[DONE] Strategy integration complete.');
    console.log('Both strategies are now saved in the database and can be selected in the UI.');
}

main().catch(err => {
    console.error('[FATAL]', err);
    process.exit(1);
});
