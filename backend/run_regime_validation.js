import fs from 'fs';
import path from 'path';
import { loadHistoricalData } from './src/data/historicalLoader.js';
import { evaluateCandidateOnCandles } from './src/optimization/OptimizationEngine.js';
import { calculateIndicators, detectMarketRegime, loadStrategyConfig } from './src/strategy/regime_engine.js';

const DEFAULT_START = '2023-01-01T00:00:00Z';
const DEFAULT_END = '2023-03-31T23:59:59Z';
const MIN_SEGMENT_CANDLES = 250;
const REGIME_WINDOW_CANDLES = 240;
const REGIME_WINDOW_STEP = 120;
const TARGET_REGIMES = ['BULL', 'BEAR', 'SIDEWAYS'];

function loadCandidates() {
    const candidatesPath = path.join(process.cwd(), 'optimization_top_results.json');
    if (!fs.existsSync(candidatesPath)) {
        throw new Error('optimization_top_results.json not found. Run npm run optimize:massive first.');
    }

    return JSON.parse(fs.readFileSync(candidatesPath, 'utf8'));
}

function parseArgs() {
    const options = { top: 10 };

    for (const arg of process.argv.slice(2)) {
        if (arg.startsWith('--top=')) options.top = Number.parseInt(arg.split('=')[1], 10) || options.top;
        if (arg.startsWith('--start=')) options.start = arg.split('=')[1];
        if (arg.startsWith('--end=')) options.end = arg.split('=')[1];
    }

    return options;
}

function classifyDirectionalRegime(indicator, config) {
    const regime = detectMarketRegime(indicator, config);

    if (regime === 'TREND') {
        return indicator.emaFast >= indicator.emaSlow ? 'BULL' : 'BEAR';
    }

    if (regime === 'RANGE') {
        return 'SIDEWAYS';
    }

    return 'OTHER';
}

function extractSegments(candles, indicators, config) {
    const segments = [];

    for (let startIndex = MIN_SEGMENT_CANDLES; startIndex + REGIME_WINDOW_CANDLES <= candles.length; startIndex += REGIME_WINDOW_STEP) {
        const endIndex = startIndex + REGIME_WINDOW_CANDLES - 1;
        const counts = { BULL: 0, BEAR: 0, SIDEWAYS: 0 };

        for (let index = startIndex; index <= endIndex; index++) {
            const regime = classifyDirectionalRegime(indicators[index], config);
            if (counts[regime] !== undefined) {
                counts[regime] += 1;
            }
        }

        const dominantRegime = Object.entries(counts)
            .sort((left, right) => right[1] - left[1])[0];

        if (!dominantRegime || dominantRegime[1] / REGIME_WINDOW_CANDLES < 0.55) {
            continue;
        }

        segments.push({
            regime: dominantRegime[0],
            startIndex,
            endIndex,
        });
    }

    return segments;
}

function aggregateSegmentResults(segmentResults) {
    const totals = {
        netProfit: 0,
        tradesCount: 0,
        weightedWinRate: 0,
        worstDrawdown: 0,
        profitFactorSum: 0,
    };

    for (const result of segmentResults) {
        totals.netProfit += result.summary.totalPnl;
        totals.tradesCount += result.summary.tradesCount;
        totals.weightedWinRate += result.summary.winRateValue * result.summary.tradesCount;
        totals.worstDrawdown = Math.max(totals.worstDrawdown, result.summary.maxDrawdown || 0);
        totals.profitFactorSum += result.summary.profitFactor;
    }

    return {
        segments: segmentResults.length,
        tradesCount: totals.tradesCount,
        totalPnl: totals.netProfit,
        winRateValue: totals.tradesCount > 0 ? totals.weightedWinRate / totals.tradesCount : 0,
        avgProfitFactor: segmentResults.length > 0 ? totals.profitFactorSum / segmentResults.length : 0,
        worstDrawdown: totals.worstDrawdown,
    };
}

function scoreCandidateByRegime(regimeStats) {
    const regimesCovered = TARGET_REGIMES.filter((regime) => regimeStats[regime]?.segments > 0);
    if (regimesCovered.length !== TARGET_REGIMES.length) return -Infinity;

    const minProfitFactor = Math.min(...TARGET_REGIMES.map((regime) => regimeStats[regime].avgProfitFactor));
    const minTrades = Math.min(...TARGET_REGIMES.map((regime) => regimeStats[regime].tradesCount));
    const averageWinRate = TARGET_REGIMES.reduce((sum, regime) => sum + regimeStats[regime].winRateValue, 0) / TARGET_REGIMES.length;
    const maxDrawdown = Math.max(...TARGET_REGIMES.map((regime) => regimeStats[regime].worstDrawdown));
    const totalPnl = TARGET_REGIMES.reduce((sum, regime) => sum + regimeStats[regime].totalPnl, 0);

    if (minTrades < 5 || minProfitFactor < 1.05) return -Infinity;

    return (minProfitFactor * 40) + (averageWinRate * 0.35) + (Math.min(totalPnl, 1000) * 0.01) - (maxDrawdown * 25);
}

async function main() {
    const options = parseArgs();
    const baseConfig = loadStrategyConfig();
    const candidates = loadCandidates().slice(0, options.top);
    const groupedCandidates = new Map();

    for (const candidate of candidates) {
        const key = `${candidate.symbol}::${candidate.tf}`;
        const existing = groupedCandidates.get(key) || [];
        existing.push(candidate);
        groupedCandidates.set(key, existing);
    }

    const evaluatedCandidates = [];

    for (const [groupKey, group] of groupedCandidates.entries()) {
        const [symbol, timeframe] = groupKey.split('::');
        console.log(`\n[REGIME VALIDATION] Loading ${symbol} ${timeframe}...`);

        const candles = await loadHistoricalData(
            symbol,
            timeframe,
            new Date(options.start || DEFAULT_START).getTime(),
            new Date(options.end || DEFAULT_END).getTime()
        );

        if (!candles.length) {
            console.warn(`[REGIME VALIDATION] Skipping ${symbol} ${timeframe}: no candles loaded.`);
            continue;
        }

        const indicators = calculateIndicators(candles, baseConfig);
        const segments = extractSegments(candles, indicators, baseConfig);
        const groupedSegments = Object.fromEntries(TARGET_REGIMES.map((regime) => [regime, segments.filter((segment) => segment.regime === regime)]));

        console.log(`[REGIME VALIDATION] Segments: ${TARGET_REGIMES.map((regime) => `${regime}=${groupedSegments[regime].length}`).join(' | ')}`);

        for (const candidate of group) {
            const regimeStats = {};

            for (const regime of TARGET_REGIMES) {
                const segmentResults = [];

                for (const segment of groupedSegments[regime]) {
                    const segmentCandles = candles.slice(segment.startIndex, segment.endIndex + 1);
                    if (segmentCandles.length < MIN_SEGMENT_CANDLES) continue;

                    const result = evaluateCandidateOnCandles(segmentCandles, candidate.params, baseConfig, symbol);
                    if (result.summary.tradesCount > 0) {
                        segmentResults.push(result);
                    }
                }

                regimeStats[regime] = aggregateSegmentResults(segmentResults);
            }

            const score = scoreCandidateByRegime(regimeStats);
            evaluatedCandidates.push({
                symbol,
                tf: timeframe,
                params: candidate.params,
                sourceMetrics: candidate.metrics,
                regimeStats,
                robustnessScore: score,
            });
        }
    }

    const ranked = evaluatedCandidates
        .filter((candidate) => Number.isFinite(candidate.robustnessScore))
        .sort((left, right) => right.robustnessScore - left.robustnessScore);

    const report = {
        generatedAt: new Date().toISOString(),
        evaluatedCandidates: evaluatedCandidates.length,
        qualifiedCandidates: ranked.length,
        bestCandidate: ranked[0] || null,
        candidates: ranked,
    };

    const reportPath = path.join(process.cwd(), 'regime_validation_report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    if (!ranked.length) {
        console.log('\n[REGIME VALIDATION] No candidate passed the multi-regime robustness gate.');
        console.log(`[REGIME VALIDATION] Report saved to ${reportPath}`);
        return;
    }

    console.log(`\n[REGIME VALIDATION] Best candidate: ${ranked[0].symbol} ${ranked[0].tf}`);
    console.log(`[REGIME VALIDATION] Score: ${ranked[0].robustnessScore.toFixed(2)}`);
    console.log(`[REGIME VALIDATION] Report saved to ${reportPath}`);
}

main().catch((error) => {
    console.error('[REGIME VALIDATION] Failed:', error.message);
    process.exitCode = 1;
});