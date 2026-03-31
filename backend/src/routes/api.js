import express from 'express';
import { riskManager } from '../risk/riskManager.js';
import exchangeClient, { getUnifiedBalance, BOT_MODE, IS_DEMO_TRADING } from '../services/exchangeClient.js';
import { getDailyPnL, getDecisionJournal, getHistory, getMetrics } from '../database/db.js';
import { activeTrades } from '../execution/tradeMonitor.js';
import { broadcastMessage } from '../utils/websocket.js';
import { Parser } from 'json2csv';
import { runBacktestProgrammatic } from '../backtestRunner.js';

const router = express.Router();

// GET Bot Status
router.get('/status', async (req, res) => {
  try {
    const dailyPnL = await getDailyPnL();
    const walletBalance = await getUnifiedBalance();
    
    // Atualiza saldo base no RiskManager
    if (riskManager.dailyStartEquity === 0 && walletBalance > 0) {
        riskManager.setDailyStartEquity(walletBalance);
    }

    res.json({
      mode: BOT_MODE,
      isDemo: IS_DEMO_TRADING,
      config: riskManager.getRiskParams(),
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

// PUT Configurações
router.put('/config', (req, res) => {
  const { leverage, takeProfitPerc, stopLossPerc } = req.body;
  if(leverage) riskManager.DEFAULT_LEVERAGE = leverage;
  if(takeProfitPerc) riskManager.TP_PCT = takeProfitPerc;
  if(stopLossPerc) riskManager.SL_PCT = stopLossPerc;
  
  res.json({ message: 'Configurações atualizadas', config: riskManager.getRiskParams() });
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
