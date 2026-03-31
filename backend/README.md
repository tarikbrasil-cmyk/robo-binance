Benchmarks e uso do cache de históricos
=====================================

Resumo
-----
No início do desenvolvimento baixamos e armazenamos candles históricos do Binance para períodos relevantes (p. ex. 3–12 meses) e salvamos em disco para evitar downloads repetidos. Esses arquivos servem como "benchmark" — permitem rodar backtests e otimizações rapidamente sobre o mesmo conjunto de dados.

Local dos dados
---------------
- Diretório: `historical_data/` (no diretório de trabalho do backend)
- Nome dos arquivos: `<SYMBOL>_<INTERVAL>_cache.json` (ex.: `BTCUSDT_5m_cache.json` ou `ETHUSDT_1h_SPOT_cache.json`)

Comportamento do loader
-----------------------
- O loader (`src/data/historicalLoader.js`) tenta usar o cache se cobrir o intervalo pedido; caso contrário baixa apenas os candles faltantes da API pública do Binance e atualiza o cache.
- Não é preciso chave de API para baixar klines públicos.

Pré-requisitos
--------------
- Node.js (v16+ recomendado)
- Instalar dependências no backend:

```bash
cd backend
npm install
```

- Certifique-se de ter `config/strategy_config.json` presente (usado por `loadStrategyConfig()`).

Scripts úteis (já inclusos em `package.json`)
---------------------------------------------
- Rodar benchmark automático (script de exemplo):

```bash
# executa o script de benchmark incluído (parâmetros internos podem variar)
npm run benchmark
```

- Run massive grid search (multi-symbol/timeframe):

```bash
npm run optimize:massive
```

- Walk‑forward optimization (CLI):

```bash
# Exemplo: BTCUSDT de 2024-01-01 até 2024-06-30
node walkforward.js BTCUSDT 2024-01-01 2024-06-30
# Ou via npm script
npm run walkforward -- BTCUSDT 2024-01-01 2024-06-30
```

Dicas práticas
--------------
- Comece com um único símbolo e um intervalo pequeno (p.ex. 2–3 meses) para validar rapidamente.
- Grandes grids + múltiplos timeframes podem demorar; reduza `searchSpace` ou periods durante iterações.
- Para usar dados SPOT, exporte `BOT_MODE=SPOT` antes de executar o WFO (ou ajuste chamadas que aceitam `mode`).

Arquivos gerados
----------------
- `optimization_top_results.json` — resultados do `run_massive_optimization.js` (top candidates)
- `backtest_logs/walkforward_report_<symbol>_<ts>.json` — relatórios completos do WFO
- `wfo_best_config.json` — configuração promovida pelo WFO (quando aplicável)

Se quiser, eu posso:
- Adicionar exemplos práticos reduzidos (pequeno `searchSpace`) para testes rápidos.
- Inserir um `README` de linha no `backend` com comandos copia/cola já ajustados ao seu `package.json`.
