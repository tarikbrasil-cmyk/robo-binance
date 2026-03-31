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

export default router;
