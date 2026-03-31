import express from 'express';
import fs from 'fs';
import path from 'path';
import { riskManager } from '../risk/riskManager.js';
import exchangeClient, { getUnifiedBalance, BOT_MODE, IS_DEMO_TRADING } from '../services/exchangeClient.js';
import { getDailyPnL, getDecisionJournal, getHistory, getMetrics } from '../database/db.js';
import { activeTrades } from '../execution/tradeMonitor.js';
import { broadcastMessage } from '../utils/websocket.js';
import { Parser } from 'json2csv';
import { runBacktestProgrammatic } from '../backtestRunner.js';

const router = express.Router();

// ── Helpers: read / write strategy_config.json ─────────────────────────────
const CONFIG_PATH = path.join(process.cwd(), 'config', 'strategy_config.json');

function readStrategyConfig() {
    if (!fs.existsSync(CONFIG_PATH)) return null;
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function writeStrategyConfig(cfg) {
    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

// GET Bot Status
router.get('/status', async (req, res) => {
  try {
    const dailyPnL = await getDailyPnL();
    const walletBalance = await getUnifiedBalance();
    
    // Atualiza saldo base no RiskManager
    if (riskManager.dailyStartEquity === 0 && walletBalance > 0) {
        riskManager.setDailyStartEquity(walletBalance);
    }

    // Merge risk params with full strategy config
    const stratCfg = readStrategyConfig();
    const ts = stratCfg?.trendStrategy || {};
    const rk = stratCfg?.risk || {};

    res.json({
      mode: BOT_MODE,
      isDemo: IS_DEMO_TRADING,
      config: {
        ...riskManager.getRiskParams(),
        // Strategy fields the panel needs
        symbol: (stratCfg?.allowedSymbols?.[0] || 'ETHUSDT').replace(/[/:]/g, ''),
        timeframe: ts.timeframe ?? '5m',
        emaFast: ts.emaFast ?? 50,
        emaSlow: ts.emaSlow ?? 100,
        emaHTF: ts.emaHTF ?? 1000,
        useEmaHTF: ts.useEmaHTF ?? false,
        rsiPeriod: ts.rsiPeriod ?? 14,
        rsiOversold: ts.rsiOversold ?? 35,
        rsiOverbought: ts.rsiOverbought ?? 65,
        atrMultiplierSL: ts.atrMultiplierSL ?? 3.5,
        atrMultiplierTP: ts.atrMultiplierTP ?? 1.5,
        useBreakout: ts.useBreakout ?? false,
        useMeanReversion: ts.useMeanReversion ?? false,
        useSessionFilter: ts.useSessionFilter ?? true,
        session: ts.session ?? 'NY',
        useCandleConfirmation: ts.useCandleConfirmation ?? true,
        riskPerTrade: rk.maxRiskPerTrade ?? 0.02,
      },
      riskStatus: {
          isKillSwitchActive: riskManager.isKillSwitchActive,
          consecutiveLosses: riskManager.consecutiveLosses,
          startEquity: riskManager.dailyStartEquity,
      },
      activePositions: Object.values(activeTrades),
      dailyPnL: dailyPnL || 0,
      walletBalance: walletBalance || 0
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar status do sistema', details: error.message });
  }
});

// GET Trade History
router.get('/history', async (req, res) => {
  try {
    const history = await getHistory(req.query);
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar histórico', details: error.message });
  }
});

// GET Performance Metrics
router.get('/metrics', async (req, res) => {
  try {
    const metrics = await getMetrics();
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao calcular métricas', details: error.message });
  }
});

router.get('/decisions', async (req, res) => {
  try {
    const decisions = await getDecisionJournal(req.query);
    res.json(decisions);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar trilha de auditoria', details: error.message });
  }
});

// GET Export History
router.get('/export', async (req, res) => {
  const format = req.query.format || 'json';
  try {
    const history = await getHistory(req.query);
    if (format === 'csv') {
      const parser = new Parser();
      const csv = parser.parse(history);
      res.header('Content-Type', 'text/csv');
      res.attachment(`trades_${Date.now()}.csv`);
      return res.send(csv);
    }
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: 'Erro na exportação', details: error.message });
  }
});

// POST Start Bot
router.post('/start', (req, res) => {
  riskManager.isKillSwitchActive = false; // Reset Manual
  console.log('▶️ Bot iniciado manualmente via API.');
  const wss = req.app.locals.wss;
  broadcastMessage(wss, 'STATUS_UPDATE', { isKillSwitchActive: false });
  res.json({ message: 'Bot successfully started', config: riskManager.getRiskParams() });
});

// POST Stop Bot
router.post('/stop', (req, res) => {
  riskManager.isKillSwitchActive = true; // Trava entradas
  console.log('⏸️ Bot pausado manualmente via API.');
  const wss = req.app.locals.wss;
  broadcastMessage(wss, 'STATUS_UPDATE', { isKillSwitchActive: true });
  res.json({ message: 'Bot successfully stopped', config: riskManager.getRiskParams() });
});

// PUT Configurações — persists full strategy config
router.put('/config', (req, res) => {
  const body = req.body;

  // 1. Update runtime risk params (leverage)
  if (body.leverage) riskManager.DEFAULT_LEVERAGE = parseInt(body.leverage);

  // 2. Read existing config, merge, and persist
  let cfg = readStrategyConfig() || { general: {}, trendStrategy: {}, risk: {}, regime: {}, allowedSymbols: [] };

  // Map symbol to allowedSymbols format
  if (body.symbol) {
    const base = body.symbol.replace('USDT', '');
    cfg.allowedSymbols = [
      `${base}/USDT`,
      `${base}/USDT:USDT`,
    ];
  }

  // trendStrategy fields
  const tsFields = [
    'timeframe', 'emaFast', 'emaSlow', 'emaHTF', 'useEmaHTF',
    'rsiPeriod', 'rsiOversold', 'rsiOverbought',
    'atrMultiplierSL', 'atrMultiplierTP',
    'useBreakout', 'useMeanReversion', 'useCandleConfirmation',
    'useSessionFilter', 'session',
  ];
  for (const key of tsFields) {
    if (body[key] !== undefined) cfg.trendStrategy[key] = body[key];
  }
  if (body.leverage !== undefined) cfg.trendStrategy.leverage = parseInt(body.leverage);

  // risk fields
  if (body.riskPerTrade !== undefined) cfg.risk.maxRiskPerTrade = parseFloat(body.riskPerTrade);

  // Record when it was saved
  cfg.general = cfg.general || {};
  cfg.general.lastUpdatedAt = new Date().toISOString();
  cfg.general.lastUpdatedSource = 'dashboard_panel';

  writeStrategyConfig(cfg);
  console.log('[CONFIG] Strategy config updated from dashboard panel.');

  res.json({ message: 'Configurações atualizadas e salvas', config: cfg });
});

// POST Backtest — run a historical simulation via the HTTP API
router.post('/backtest', async (req, res) => {
  const { symbol, startDate, endDate, balance = 1000 } = req.body;
  if (!symbol || !startDate || !endDate) {
    return res.status(400).json({ error: 'symbol, startDate e endDate são obrigatórios' });
  }
  try {
    const result = await runBacktestProgrammatic(
      symbol.toUpperCase(),
      startDate,
      endDate,
      parseFloat(balance)
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Backtest falhou', details: error.message });
  }
});

// ── BENCHMARK ────────────────────────────────────────────────────────────────
import { runBenchmark, REGIMES, SYMBOLS, TIMEFRAMES, DEFAULT_GRID } from '../benchmark/benchmarkRunner.js';
import { getMemoryStats } from '../benchmark/columnStore.js';

// GET benchmark config (regimes, symbols, timeframes, grid info)
router.get('/benchmark/config', (req, res) => {
    res.json({
        regimes: REGIMES.map(r => ({ tag: r.tag, label: r.label, start: new Date(r.startMs).toISOString().slice(0, 10), end: new Date(r.endMs).toISOString().slice(0, 10) })),
        symbols: SYMBOLS,
        timeframes: TIMEFRAMES,
        gridSize: Object.values(DEFAULT_GRID).reduce((acc, v) => acc * v.length, 1),
        grid: DEFAULT_GRID,
    });
});

// ── Benchmark results persistence ──────────────────────────────────────────
const BENCHMARK_RESULTS_PATH = path.join(process.cwd(), 'config', 'benchmark_results.json');

function readBenchmarkResults() {
    if (!fs.existsSync(BENCHMARK_RESULTS_PATH)) return [];
    try { return JSON.parse(fs.readFileSync(BENCHMARK_RESULTS_PATH, 'utf8')); } catch { return []; }
}

function writeBenchmarkResults(results) {
    const dir = path.dirname(BENCHMARK_RESULTS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(BENCHMARK_RESULTS_PATH, JSON.stringify(results, null, 2));
}

// POST run benchmark (long-running — returns full report, persists to disk)
router.post('/benchmark/run', async (req, res) => {
    const { symbols, timeframes, regimes } = req.body || {};
    try {
        const report = await runBenchmark({
            symbols:    symbols    || undefined,
            timeframes: timeframes || undefined,
            regimes:    regimes    || undefined,
        });
        // Persist report to disk
        const history = readBenchmarkResults();
        history.unshift(report);  // newest first
        if (history.length > 10) history.length = 10;  // keep last 10 runs
        writeBenchmarkResults(history);
        console.log('[BENCHMARK] Results saved to disk.');
        res.json(report);
    } catch (error) {
        console.error('[BENCHMARK ERROR]', error);
        res.status(500).json({ error: 'Benchmark failed', details: error.message });
    }
});

// GET last benchmark results (persisted)
router.get('/benchmark/results', (req, res) => {
    const history = readBenchmarkResults();
    res.json(history.length > 0 ? history[0] : null);
});

// GET benchmark run history (timestamps + summary)
router.get('/benchmark/history', (req, res) => {
    const history = readBenchmarkResults();
    res.json(history.map((r, i) => ({
        index: i,
        timestamp: r.timestamp,
        totalRuns: r.totalRuns,
        qualified: r.qualified,
        regimes: r.config?.regimes,
        gridSize: r.config?.gridSize,
    })));
});

// POST apply a benchmark result to the demo bot strategy config
router.post('/benchmark/apply', (req, res) => {
    const { params, symbol, timeframe } = req.body || {};
    if (!params) {
        return res.status(400).json({ error: 'Missing params object' });
    }

    let cfg = readStrategyConfig() || { general: {}, trendStrategy: {}, risk: {}, regime: {}, allowedSymbols: [] };

    // Map benchmark grid params → strategy_config.json trendStrategy
    cfg.trendStrategy = cfg.trendStrategy || {};
    if (params.emaFastPeriod !== undefined) cfg.trendStrategy.emaFast = params.emaFastPeriod;
    if (params.emaSlowPeriod !== undefined) cfg.trendStrategy.emaSlow = params.emaSlowPeriod;
    if (params.rsiOversold !== undefined)   cfg.trendStrategy.rsiOversold = params.rsiOversold;
    if (params.rsiOverbought !== undefined) cfg.trendStrategy.rsiOverbought = params.rsiOverbought;
    if (params.atrMultiplier !== undefined) cfg.trendStrategy.atrMultiplierSL = params.atrMultiplier;
    if (params.tpMultiplier !== undefined)  cfg.trendStrategy.atrMultiplierTP = params.tpMultiplier;
    if (params.useBreakout !== undefined)   cfg.trendStrategy.useBreakout = params.useBreakout;
    if (params.useMeanReversion !== undefined) cfg.trendStrategy.useMeanReversion = params.useMeanReversion;
    if (params.session !== undefined)       cfg.trendStrategy.session = params.session;
    if (params.useSessionFilter !== undefined) cfg.trendStrategy.useSessionFilter = params.useSessionFilter;

    // Apply symbol and timeframe from the benchmark result
    if (timeframe) cfg.trendStrategy.timeframe = timeframe;
    if (symbol) {
        const base = symbol.replace('USDT', '');
        cfg.allowedSymbols = [`${base}/USDT`, `${base}/USDT:USDT`];
    }

    // Record promotion source
    cfg.general = cfg.general || {};
    cfg.general.strategyName = `BENCHMARK_${symbol || 'MULTI'}_${timeframe || '5m'}`;
    cfg.general.lastUpdatedAt = new Date().toISOString();
    cfg.general.lastUpdatedSource = 'benchmark_apply';
    cfg.general.lastPromotionAt = new Date().toISOString();
    cfg.general.lastPromotionSource = 'benchmark_panel';

    writeStrategyConfig(cfg);
    console.log(`[BENCHMARK APPLY] Strategy config updated: ${symbol} ${timeframe}`, params);

    res.json({ message: 'Strategy applied to demo bot', config: cfg });
});

// GET memory stats
router.get('/benchmark/memory', (req, res) => {
    res.json(getMemoryStats());
});

export default router;
