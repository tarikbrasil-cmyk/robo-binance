import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import schedule from 'node-schedule';
import apiRoutes from './routes/api.js';
import { startBinanceWebSocket, flushAllWebSockets } from './services/binanceWs.js';
import { startLiquidationStream } from './services/liquidationWs.js';
import { scanTopMarketOpportunities } from './data/marketScanner.js';
import { syncPositionsFromExchange } from './execution/tradeMonitor.js';
import { BOT_MODE, IS_SPOT } from './services/exchangeClient.js';
import { getStrategySnapshot, displayStrategyPanel, saveStrategySnapshot } from './utils/strategySnapshot.js';

dotenv.config();

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

// Disponibilizar o WSS global na aplicação para rotas que precisam enviar broadcast
app.locals.wss = wss;

// Use as rotas da API (passando wss via locals)
app.use('/api', apiRoutes);

// WebSocket para atualizar o frontend
wss.on('connection', (ws) => {
  console.log('Frontend dashboard connected via WebSocket.');
  
  ws.on('message', (message) => {
    console.log('Received from Dashboard:', message.toString());
  });

  ws.send(JSON.stringify({ type: 'STATUS', data: `Connected to Bot Engine [${BOT_MODE}]` }));
});

server.listen(PORT, async () => {
  const snapshot = getStrategySnapshot();
  displayStrategyPanel(snapshot);
  saveStrategySnapshot(snapshot);

  console.log(`🚀 Binance Bot Engine rodando na porta ${PORT} [ID: ${snapshot.strategyId}]`);
  console.log(IS_SPOT
    ? '🟦 MODO: SPOT  — sem leverage, apenas BUY, TP/SL via LIMIT orders'
    : '🟨 MODO: FUTURES — com leverage, BUY/SELL, TP/SL via STOP_MARKET orders'
  );
  
  // 1. Startup inicial: Roda scanner para pegar a melhor moeda atual
  const topMoedas = await scanTopMarketOpportunities();
  let targets = ['btcusdt']; // Fallback
  
  if (topMoedas.length > 0) {
      targets = topMoedas.map(m => {
          // SPOT symbols: "BTC/USDT" → "btcusdt"
          // FUTURES symbols: "BTC/USDT:USDT" → "btcusdt"
          return m.symbol.split(':')[0].replace('/', '').toLowerCase();
      });
  }

  // 2. Inicia WSS nas moedas alvo
  targets.forEach(t => startBinanceWebSocket(t, wss));

  // 3. Liquidation Stream: apenas em FUTURES (não relevante para Spot)
  if (!IS_SPOT) {
      startLiquidationStream(wss);
  } else {
      console.log('ℹ️  Liquidation Feed desativado (modo SPOT)');
  }

  // 4. Agendador (Node Schedule)
  // Sincroniza posições perdidas (SL/TP) a cada 2 minutos
  schedule.scheduleJob('*/2 * * * *', async () => {
      console.log('[WORKER] Sincronizando Exchange...');
      await syncPositionsFromExchange();
  });

  // Roda scanner de Market Regime/Oportunidade a cada 30 minutos
  schedule.scheduleJob('*/30 * * * *', async () => {
      console.log('[WORKER] Disparando Scanner de Mercado rotativo...');
      const moedas = await scanTopMarketOpportunities();
      const newTargets = moedas.map(m => m.symbol.split(':')[0].replace('/', '').toLowerCase());
      
      console.log('[WORKER] Trocando streams para os novos líderes...');
      flushAllWebSockets();
      setTimeout(() => {
          newTargets.forEach(t => startBinanceWebSocket(t, wss));
      }, 2000);
  });
});
