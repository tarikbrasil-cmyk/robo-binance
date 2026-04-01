import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import schedule from 'node-schedule';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import apiRoutes from './routes/api.js';
import { startBinanceWebSocket } from './services/binanceWs.js';
import { startLiquidationStream } from './services/liquidationWs.js';
import { syncPositionsFromExchange } from './execution/tradeMonitor.js';
import { BOT_MODE, IS_SPOT } from './services/exchangeClient.js';
import { getStrategySnapshot, displayStrategyPanel, saveStrategySnapshot } from './utils/strategySnapshot.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:3001',
    'https://robo-binance-rwvp.vercel.app',
  ],
  credentials: true,
}));
app.use(express.json());

const PORT = process.env.PORT || 3001;

// Disponibilizar o WSS global na aplicação para rotas que precisam enviar broadcast
app.locals.wss = wss;

// Use as rotas da API (passando wss via locals)
app.use('/api', apiRoutes);

// ── Serve frontend static build (if present) ─────────────────────────────────
const frontendDist = join(__dirname, '..', '..', 'frontend', 'dist');
if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    // SPA fallback — any non-API route serves index.html
    app.get('*', (req, res) => {
        res.sendFile(join(frontendDist, 'index.html'));
    });
    console.log(`[STATIC] Frontend servido de ${frontendDist}`);
} else {
    console.log('[STATIC] frontend/dist não encontrado — execute "npm run build" no frontend para ativar.');
}

// WebSocket para atualizar o frontend
wss.on('connection', (ws) => {
  console.log('Frontend dashboard connected via WebSocket.');
  
  ws.on('message', (message) => {
    console.log('Received from Dashboard:', message.toString());
  });

  ws.send(JSON.stringify({ type: 'STATUS', data: `Connected to Bot Engine [${BOT_MODE}]` }));
});

// ── STABILIZATION: Fixed symbol whitelist (no dynamic scanner rotation) ──
const ALLOWED_TARGETS = ['btcusdt', 'ethusdt', 'solusdt'];

server.listen(PORT, async () => {
  const snapshot = getStrategySnapshot();
  displayStrategyPanel(snapshot);
  saveStrategySnapshot(snapshot);

  console.log(`🚀 Binance Bot Engine rodando na porta ${PORT} [ID: ${snapshot.strategyId}]`);
  console.log(`[SCANNER] Symbols locked to: ${ALLOWED_TARGETS.map(t => t.toUpperCase()).join(', ')}`);
  console.log(IS_SPOT
    ? '🟦 MODO: SPOT  — sem leverage, apenas BUY, TP/SL via LIMIT orders'
    : '🟨 MODO: FUTURES — com leverage, BUY/SELL, TP/SL via STOP_MARKET orders'
  );

  // 1. Start persistent WebSocket streams for allowed symbols only
  ALLOWED_TARGETS.forEach(t => startBinanceWebSocket(t, wss));

  // 2. Liquidation Stream: apenas em FUTURES (filtered by liquidityEngine)
  if (!IS_SPOT) {
      console.log('[LIQUIDITY] Liquidation stream active with candle/volume/trend filters');
      startLiquidationStream(wss);
  } else {
      console.log('ℹ️  Liquidation Feed desativado (modo SPOT)');
  }

  // 3. Position sync every 2 minutes (only scheduled job remaining)
  schedule.scheduleJob('*/2 * * * *', async () => {
      console.log('[WORKER] Sincronizando Exchange...');
      await syncPositionsFromExchange();
  });

  // NOTE: 30-min scanner rotation REMOVED for stabilization.
  // Streams are persistent — only BTC/ETH/SOL.
});
