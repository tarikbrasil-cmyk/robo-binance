import fs from 'fs';
import path from 'path';

function parseArgs() {
    const options = { rank: 1, dryRun: false };

    for (const arg of process.argv.slice(2)) {
        if (arg === '--dry-run') options.dryRun = true;
        if (arg.startsWith('--rank=')) options.rank = Math.max(1, Number.parseInt(arg.split('=')[1], 10) || 1);
    }

    return options;
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolveCandidate(baseDir, rank) {
    const regimeReportPath = path.join(baseDir, 'regime_validation_report.json');
    const optimizationPath = path.join(baseDir, 'optimization_top_results.json');

    if (fs.existsSync(regimeReportPath)) {
        const report = readJson(regimeReportPath);
        const candidate = report.candidates?.[rank - 1];
        if (candidate) {
            return { candidate, source: 'regime_validation_report.json' };
        }
    }

    if (fs.existsSync(optimizationPath)) {
        const report = readJson(optimizationPath);
        const candidate = report?.[rank - 1];
        if (!candidate) throw new Error(`No candidate at rank ${rank} in optimization_top_results.json`);
        return { candidate, source: 'optimization_top_results.json' };
    }

    throw new Error('No optimization report found. Run optimize:massive or validate:regimes first.');
}

function applyCandidateToConfig(config, candidate, source) {
    const nextConfig = JSON.parse(JSON.stringify(config));
    const params = candidate.params;

    nextConfig.general.strategyName = `PROMOTED_${candidate.symbol}_${candidate.tf}`;
    nextConfig.general.lastPromotionSource = source;
    nextConfig.general.lastPromotionAt = new Date().toISOString();

    nextConfig.trendStrategy.timeframe = candidate.tf;
    nextConfig.trendStrategy.emaFast = params.emaFastPeriod;
    nextConfig.trendStrategy.emaSlow = params.emaSlowPeriod;
    nextConfig.trendStrategy.emaHTF = params.emaHTFPeriod;
    nextConfig.trendStrategy.rsiPeriod = params.rsiPeriod;
    nextConfig.trendStrategy.rsiOversold = params.rsiOversold;
    nextConfig.trendStrategy.rsiOverbought = params.rsiOverbought;
    nextConfig.trendStrategy.useEmaHTF = params.useEmaHTF;
    nextConfig.trendStrategy.atrMultiplierSL = params.atrMultiplier;
    nextConfig.trendStrategy.atrMultiplierTP = params.tpMultiplier;
    nextConfig.trendStrategy.useSessionFilter = params.useSessionFilter;
    nextConfig.trendStrategy.session = params.session;
    nextConfig.trendStrategy.useBreakout = params.useBreakout;
    nextConfig.trendStrategy.useMeanReversion = params.useMeanReversion;

    return nextConfig;
}

function main() {
    const options = parseArgs();
    const baseDir = process.cwd();
    const configPath = path.join(baseDir, 'config', 'strategy_config.json');
    const currentConfig = readJson(configPath);
    const { candidate, source } = resolveCandidate(baseDir, options.rank);
    const nextConfig = applyCandidateToConfig(currentConfig, candidate, source);

    console.log(`[PROMOTION] Source: ${source}`);
    console.log(`[PROMOTION] Candidate: ${candidate.symbol} ${candidate.tf}`);
    console.log(`[PROMOTION] Params: ${JSON.stringify(candidate.params)}`);

    if (options.dryRun) {
        console.log('[PROMOTION] Dry run only. strategy_config.json was not changed.');
        return;
    }

    fs.writeFileSync(configPath, JSON.stringify(nextConfig, null, 2));
    console.log('[PROMOTION] strategy_config.json updated for DEMO deployment.');
    console.log('[PROMOTION] Real trading remains blocked unless ALLOW_LIVE_TRADING=true.');
}

main();