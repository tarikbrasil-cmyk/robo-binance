import { useState, useEffect } from 'react'
import { Activity, Power, TrendingUp, DollarSign, Settings, Target, Zap, BarChart2, History, Download, ChevronRight, AlertTriangle, FlaskConical, Crosshair } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, PieChart, Pie, Cell } from 'recharts'
import { jsPDF } from 'jspdf'
import 'jspdf-autotable'

// Constantes (use Vite env vars in production)
const API_URL = (import.meta.env.VITE_API_BASE) ? `${import.meta.env.VITE_API_BASE.replace(/\/$/, '')}/api` : 'http://localhost:3001/api';
const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001';

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [botMode, setBotMode] = useState('FUTURES');
  const [isDemo, setIsDemo] = useState(true);
  const [botStatus, setBotStatus] = useState('Parado');
  const [config, setConfig] = useState({ leverage: 10, takeProfitPerc: 0.06, stopLossPerc: 0.03 });
  const [riskData, setRiskData] = useState({ isKillSwitchActive: false, consecutiveLosses: 0, startEquity: 0 });
  const [pnl, setPnl] = useState({ daily: 0, wallet: 0 });
  const [prices, setPrices] = useState({});
  const [activePositions, setActivePositions] = useState([]);
  const [tradeHistory, setTradeHistory] = useState([]);
  const [decisionTrail, setDecisionTrail] = useState([]);
  const [metrics, setMetrics] = useState({ totalTrades: 0, winCount: 0, avgRoe: 0, totalProfit: 0, maxDrawdownUsdt: 0 });
  const [logs, setLogs] = useState([{ time: new Date().toLocaleTimeString(), msg: 'Dashboard Inicializado', type: 'info' }]);
  // Backtest state
  const [backtestForm, setBacktestForm] = useState({ symbol: 'BTCUSDT', startDate: '2023-01-01', endDate: '2023-03-31', balance: '1000' });
  const [backtestResult, setBacktestResult] = useState(null);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestError, setBacktestError] = useState(null);

  const isSpot = botMode === 'SPOT';

  const addLog = (msg, type) => {
      setLogs((prev) => [{ time: new Date().toLocaleTimeString(), msg, type }, ...prev].slice(0, 50));
  };

  useEffect(() => {
    fetchInitialStatus();
    fetchHistory();
    fetchMetrics();
    fetchDecisionTrail();
    
        let ws = null;
        try {
            // Only attempt WebSocket connection when URL is secure/allowed or running locally
            const isLocal = typeof location !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
            if (WS_URL.startsWith('wss://') || isLocal || WS_URL.startsWith('ws://')) {
                ws = new WebSocket(WS_URL);
            }
        } catch (err) {
            console.warn('WebSocket unavailable:', err);
            ws = null;
        }

        if (ws) {
            ws.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === 'TICKER_UPDATE') {
        const { symbol, price } = payload.data;
        setPrices(prev => ({ ...prev, [symbol]: price }));
      } else if (payload.type === 'STATUS_UPDATE') {
        setBotStatus(!payload.data.isKillSwitchActive ? 'Operando' : 'Pausado');
        fetchInitialStatus();
            } else if (payload.type === 'DECISION_EVENT') {
                setDecisionTrail(prev => [payload.data, ...prev].slice(0, 100));
      } else if (payload.type === 'SYNC_UPDATE' || payload.type === 'TRADE_CLOSED' || payload.type === 'POSITION_OPENED') {
        fetchInitialStatus();
        fetchHistory();
        fetchMetrics();
                fetchDecisionTrail();
        if (payload.type === 'TRADE_CLOSED') addLog(`Trade fechado: ${payload.data.symbol}`, 'success');
      }
    };

    }

    const poll = setInterval(() => {
        fetchInitialStatus();
        if (activeTab === 'history') fetchHistory();
        if (activeTab === 'analytics') fetchMetrics();
        if (activeTab === 'audit') fetchDecisionTrail();
    }, 10000);

    return () => {
      ws.close();
      clearInterval(poll);
    };
  }, [activeTab]);

  const fetchInitialStatus = async () => {
    try {
      const res = await fetch(`${API_URL}/status`);
      const data = await res.json();
      setBotMode(data.mode);
      setIsDemo(data.isDemo ?? true);
      setConfig(data.config);
      setRiskData(data.riskStatus);
      setPnl({ daily: data.dailyPnL, wallet: data.walletBalance });
      setBotStatus(data.riskStatus?.isKillSwitchActive ? 'Pausado' : 'Operando');
      setActivePositions(data.activePositions || []);
    } catch (e) { console.error('API Error', e); }
  };

    const fetchDecisionTrail = async () => {
        try {
            const res = await fetch(`${API_URL}/decisions?limit=100`);
            const data = await res.json();
            setDecisionTrail(data);
        } catch (e) { console.error('Decision Journal Error', e); }
    };

  const fetchHistory = async () => {
    try {
      const res = await fetch(`${API_URL}/history`);
      const data = await res.json();
      setTradeHistory(data);
    } catch (e) { console.error('History Error', e); }
  };

  const fetchMetrics = async () => {
    try {
      const res = await fetch(`${API_URL}/metrics`);
      const data = await res.json();
      setMetrics(data);
    } catch (e) { console.error('Metrics Error', e); }
  };

  const toggleBot = async () => {
    const action = botStatus === 'Operando' ? 'stop' : 'start';
    try {
      await fetch(`${API_URL}/${action}`, { method: 'POST' });
    } catch (e) { addLog(`Erro ao alternar bot`, 'error'); }
  };

  const runBacktest = async () => {
    setBacktestLoading(true);
    setBacktestResult(null);
    setBacktestError(null);
    try {
      const res = await fetch(`${API_URL}/backtest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: backtestForm.symbol,
          startDate: backtestForm.startDate,
          endDate: backtestForm.endDate,
          balance: parseFloat(backtestForm.balance),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.details || err.error || 'Erro no servidor');
      }
      const data = await res.json();
      setBacktestResult(data);
    } catch (e) {
      setBacktestError(e.message);
    } finally {
      setBacktestLoading(false);
    }
  };

  const exportData = (format) => {
    if (format === 'json') {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(tradeHistory));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href",     dataStr);
      downloadAnchorNode.setAttribute("download", `trades_${Date.now()}.json`);
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
    } else if (format === 'csv') {
        window.open(`${API_URL}/export?format=csv`, '_blank');
    } else if (format === 'pdf') {
        const doc = new jsPDF();
        doc.text("Relatório de Performance - Binance AI Bot", 10, 10);
        doc.autoTable({
            head: [['Símbolo', 'Lado', 'Entrada', 'Saída', 'Lucro (USDT)', 'ROE %', 'Data']],
            body: tradeHistory.map(t => [t.symbol, t.side, t.entry_price, t.exit_price, t.profit_usdt.toFixed(2), t.roe_perc.toFixed(2), t.timestamp])
        });
        doc.save(`relatorio_${Date.now()}.pdf`);
    }
  };

  const updateStrategy = async (newParams) => {
    try {
        const res = await fetch(`${API_URL}/config`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newParams)
        });
        if (res.ok) {
            addLog('Estratégia atualizada com sucesso', 'success');
            fetchInitialStatus();
        }
    } catch (e) { addLog('Falha ao atualizar estratégia', 'error'); }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: '#0a0b0d', color: '#fff', fontFamily: 'Inter, sans-serif' }}>
      
      {/* Sidebar Navigation */}
      <nav style={{ width: '260px', borderRight: '1px solid rgba(255,255,255,0.05)', padding: '2rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '2.5rem', padding: '0 1rem' }}>
          <Zap size={28} color="#00ff87" />
          <h2 style={{ fontSize: '1.2rem', fontWeight: 800, letterSpacing: '-0.5px' }}>QUANT BOT</h2>
        </div>
        
        <NavItem active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={<Activity size={20} />} label="Dashboard" />
        <NavItem active={activeTab === 'analytics'} onClick={() => setActiveTab('analytics')} icon={<BarChart2 size={20} />} label="Analytics" />
        <NavItem active={activeTab === 'backtest'} onClick={() => setActiveTab('backtest')} icon={<FlaskConical size={20} />} label="Backtest" />
        <NavItem active={activeTab === 'benchmark'} onClick={() => setActiveTab('benchmark')} icon={<Crosshair size={20} />} label="Benchmark" />
        <NavItem active={activeTab === 'history'} onClick={() => setActiveTab('history')} icon={<History size={20} />} label="Histórico" />
        <NavItem active={activeTab === 'audit'} onClick={() => setActiveTab('audit')} icon={<ChevronRight size={20} />} label="Auditoria" />
        <NavItem active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} icon={<Settings size={20} />} label="Estratégia" />
        
        <div style={{ marginTop: 'auto', padding: '1rem', background: 'rgba(255,255,255,0.03)', borderRadius: '12px' }}>
            <div style={{ fontSize: '0.75rem', opacity: 0.5, marginBottom: '0.5rem' }}>MODO ATUAL</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.5rem' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: isSpot ? '#00e676' : '#ffb300' }}></div>
                <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{botMode}</span>
            </div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '3px 10px', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 700,
                background: isDemo ? 'rgba(96, 239, 255, 0.15)' : 'rgba(255, 77, 79, 0.15)',
                color: isDemo ? '#60efff' : '#ff4d4f',
                border: `1px solid ${isDemo ? 'rgba(96, 239, 255, 0.3)' : 'rgba(255, 77, 79, 0.3)'}` }}>
                {isDemo ? '🧪 DEMO / TESTNET' : '🔴 LIVE / REAL'}
            </div>
        </div>
      </nav>

      {/* Main Content */}
      <div style={{ flex: 1, padding: '2rem', overflowY: 'auto' }}>
        
        {/* Top Header */}
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
          <div>
            <h1 style={{ fontSize: '1.8rem', fontWeight: 700 }}>{activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}</h1>
            <p style={{ opacity: 0.5, fontSize: '0.9rem' }}>Bem-vindo ao centro de comando de sua IA Trading.</p>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.8rem', opacity: 0.6 }}>Conexão API</div>
                <div style={{ color: '#00ff87', fontWeight: 600, fontSize: '0.9rem' }}>ONLINE</div>
            </div>
            <button 
                onClick={toggleBot}
                className={`btn ${botStatus === 'Operando' ? 'btn-danger' : 'btn-primary'}`}
                style={{ padding: '0.75rem 1.5rem', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}
            >
                <Power size={18} />
                {botStatus === 'Operando' ? 'Desligar Motor' : 'Ligar All-In'}
            </button>
          </div>
        </header>

        {activeTab === 'dashboard' && <DashboardView pnl={pnl} riskData={riskData} prices={prices} activePositions={activePositions} logs={logs} config={config} />}
        {activeTab === 'analytics' && <AnalyticsView metrics={metrics} history={tradeHistory} />}
        {activeTab === 'backtest' && <BacktestView form={backtestForm} onFormChange={setBacktestForm} onRun={runBacktest} loading={backtestLoading} result={backtestResult} error={backtestError} />}
        {activeTab === 'history' && <HistoryView history={tradeHistory} onExport={exportData} />}
        {activeTab === 'audit' && <AuditView decisions={decisionTrail} />}
        {activeTab === 'settings' && <SettingsView config={config} onSave={updateStrategy} />}
        {activeTab === 'benchmark' && <BenchmarkView />}
        
      </div>
    </div>
  )
}

// Sub-components
function NavItem({ active, onClick, icon, label }) {
    return (
        <button 
            onClick={onClick}
            style={{ 
                display: 'flex', alignItems: 'center', gap: '12px', padding: '0.85rem 1rem', borderRadius: '12px', border: 'none',
                background: active ? 'rgba(0, 255, 135, 0.1)' : 'transparent',
                color: active ? '#00ff87' : 'rgba(255,255,255,0.6)',
                fontWeight: active ? 600 : 400, cursor: 'pointer', transition: 'all 0.2s'
            }}
        >
            {icon} {label}
        </button>
    )
}

function DashboardView({ pnl, riskData, prices, activePositions, logs, config }) {
    return (
        <div className="dashboard-grid">
            <StatCard icon={<TrendingUp color="#00ff87" />} label="Lucro 24h (Realizado)" value={`$${pnl.daily.toFixed(2)}`} sub={`${((pnl.daily / (pnl.wallet || 1)) * 100).toFixed(2)}% de retorno`} />
            <StatCard icon={<DollarSign color="#60efff" />} label="Saldo Disponível" value={`$${pnl.wallet.toFixed(2)}`} sub={`Drawdown Max: $${riskData.startEquity.toFixed(2)}`} />
            <StatCard icon={<Target color="#ffb300" />} label="Posições Ativas" value={activePositions.length} sub="Acompanhando o mercado..." />
            
            <div className="glass-panel col-span-8" style={{ padding: '1.5rem' }}>
                <h3 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '10px' }}><Target size={20} color="#00ff87"/> Monitoramento de Risco</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
                    <RiskStat label="Alavancagem" value={`${config.leverage}x`} />
                    <RiskStat label="Losses Consec." value={`${riskData.consecutiveLosses}/3`} />
                    <RiskStat label="Take Profit" value={`${(config.takeProfitPerc * 100).toFixed(1)}%`} />
                    <RiskStat label="Stop Loss" value={`${(config.stopLossPerc * 100).toFixed(1)}%`} />
                </div>
            </div>

            <div className="glass-panel col-span-8" style={{ padding: '1.5rem' }}>
                <h3 style={{ marginBottom: '1rem' }}>Operações em Aberto</h3>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', opacity: 0.5, fontSize: '0.85rem' }}>
                            <th style={{ padding: '12px' }}>PAR</th>
                            <th style={{ padding: '12px' }}>LADO</th>
                            <th style={{ padding: '12px' }}>ENTRADA</th>
                            <th style={{ padding: '12px' }}>ATUAL</th>
                            <th style={{ padding: '12px' }}>ROE %</th>
                        </tr>
                    </thead>
                    <tbody>
                        {activePositions.map((pos, i) => (
                            <tr key={i}>
                                <td style={{ padding: '12px', fontWeight: 700 }}>{pos.symbol}</td>
                                <td style={{ padding: '12px', color: pos.side === 'BUY' ? '#00e676' : '#ff4d4f' }}>{pos.side}</td>
                                <td style={{ padding: '12px' }}>${pos.entryPrice.toFixed(4)}</td>
                                <td style={{ padding: '12px' }}>${prices[pos.symbol]?.toFixed(4) || '---'}</td>
                                <td style={{ padding: '12px', color: '#00ff87' }}>
                                    {prices[pos.symbol] ? (
                                        (((prices[pos.symbol] - pos.entryPrice) / pos.entryPrice) * 100 * (pos.side === 'BUY' ? 1 : -1) * (pos.leverage || 1)).toFixed(2)
                                    ) : '0.00'}%
                                </td>
                            </tr>
                        ))}
                        {activePositions.length === 0 && <tr><td colSpan="5" style={{ textAlign: 'center', padding: '2rem', opacity: 0.3 }}>Nenhuma posição ligada</td></tr>}
                    </tbody>
                </table>
            </div>

            <div className="glass-panel col-span-4" style={{ padding: '1.5rem', maxHeight: '400px', display: 'flex', flexDirection: 'column' }}>
                <h3 style={{ marginBottom: '1rem' }}>Console do Motor</h3>
                <div style={{ flex: 1, overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.8rem' }}>
                    {logs.map((log, i) => (
                        <div key={i} style={{ marginBottom: '6px', color: log.type === 'error' ? '#ff4d4f' : log.type === 'success' ? '#00ff87' : '#fff' }}>
                            <span style={{ opacity: 0.3 }}>{log.time}</span> {log.msg}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}

function AnalyticsView({ metrics, history }) {
    const chartData = history.slice(0, 20).reverse().map((t, i) => ({
        name: i,
        profit: t.profit_usdt,
        roe: t.roe_perc
    }));

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <div className="dashboard-grid">
                <StatCard label="Taxa de Acerto" value={`${((metrics.winCount / (metrics.totalTrades || 1)) * 100).toFixed(1)}%`} sub={`${metrics.winCount} de ${metrics.totalTrades} trades`} />
                <StatCard label="ROE Médio" value={`${(metrics.avgRoe || 0).toFixed(2)}%`} sub="Por operação encerrada" />
                <StatCard label="Máximo Drawdown" value={`-$${Math.abs(metrics.maxDrawdownUsdt || 0).toFixed(2)}`} sub="Histórico total" />
            </div>
            
            <div className="glass-panel" style={{ padding: '2rem', height: '400px' }}>
                <h3 style={{ marginBottom: '1.5rem' }}>Evolução de Lucros Recentes (USDT)</h3>
                <ResponsiveContainer width="100%" height="90%">
                    <AreaChart data={chartData}>
                        <defs>
                            <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#00ff87" stopOpacity={0.3}/>
                                <stop offset="95%" stopColor="#00ff87" stopOpacity={0}/>
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="name" hide />
                        <YAxis stroke="rgba(255,255,255,0.3)" fontSize={12} />
                        <Tooltip contentStyle={{ background: '#1a1b1f', border: 'none', borderRadius: '8px' }} />
                        <Area type="monotone" dataKey="profit" stroke="#00ff87" fillOpacity={1} fill="url(#colorProfit)" />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    )
}

function HistoryView({ history, onExport }) {
    return (
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h3>Histórico de Transações</h3>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button onClick={() => onExport('csv')} className="btn-secondary" style={{ padding: '0.5rem 1rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px' }}><Download size={14}/> CSV</button>
                    <button onClick={() => onExport('pdf')} className="btn-secondary" style={{ padding: '0.5rem 1rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px' }}><Download size={14}/> PDF</button>
                </div>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', opacity: 0.5, fontSize: '0.85rem' }}>
                        <th style={{ padding: '12px' }}>TIMESTAMPS</th>
                        <th style={{ padding: '12px' }}>SÍMBOLO</th>
                        <th style={{ padding: '12px' }}>LADO</th>
                        <th style={{ padding: '12px' }}>ROE %</th>
                        <th style={{ padding: '12px' }}>PNL (USDT)</th>
                    </tr>
                </thead>
                <tbody>
                    {history.map((t, i) => (
                        <tr key={i} style={{ fontSize: '0.9rem', borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                            <td style={{ padding: '12px', opacity: 0.6 }}>{new Date(t.timestamp).toLocaleString()}</td>
                            <td style={{ padding: '12px', fontWeight: 600 }}>{t.symbol}</td>
                            <td style={{ padding: '12px' }}><span style={{ padding: '2px 6px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px' }}>{t.side}</span></td>
                            <td style={{ padding: '12px', color: t.roe_perc >= 0 ? '#00ff87' : '#ff4d4f' }}>{t.roe_perc.toFixed(2)}%</td>
                            <td style={{ padding: '12px', color: t.profit_usdt >= 0 ? '#00ff87' : '#ff4d4f' }}>${t.profit_usdt.toFixed(2)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}

function SettingsView({ config, onSave }) {
    const defaults = {
        // Risk / Position
        leverage: config.leverage ?? 10,
        riskPerTrade: (config.riskPerTrade ?? 0.02) * 100,
        // Symbol & Timeframe
        symbol: config.symbol ?? 'ETHUSDT',
        timeframe: config.timeframe ?? '5m',
        // Engine Mode
        useBreakout: config.useBreakout ?? false,
        useMeanReversion: config.useMeanReversion ?? false,
        // EMA Trend Alignment
        emaFast: config.emaFast ?? 50,
        emaSlow: config.emaSlow ?? 100,
        emaHTF: config.emaHTF ?? 1000,
        useEmaHTF: config.useEmaHTF ?? false,
        // RSI
        rsiPeriod: config.rsiPeriod ?? 14,
        rsiOversold: config.rsiOversold ?? 35,
        rsiOverbought: config.rsiOverbought ?? 65,
        // ATR-based SL / TP
        atrMultiplierSL: config.atrMultiplierSL ?? 3.5,
        atrMultiplierTP: config.atrMultiplierTP ?? 1.5,
        // Session Filter
        useSessionFilter: config.useSessionFilter ?? true,
        session: config.session ?? 'NY',
        // Candle confirmation
        useCandleConfirmation: config.useCandleConfirmation ?? true,
    };
    const [local, setLocal] = useState(defaults);
    const set = (key, val) => setLocal(prev => ({ ...prev, [key]: val }));

    const inputStyle = { background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', padding: '0.8rem', borderRadius: '8px', color: '#fff', width: '100%' };
    const labelStyle = { fontSize: '0.85rem', opacity: 0.6, marginBottom: '6px', display: 'block' };
    const sectionTitle = (text) => <h4 style={{ gridColumn: '1 / -1', marginTop: '0.5rem', paddingBottom: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: '0.95rem', color: '#60efff' }}>{text}</h4>;

    const handleSave = () => {
        onSave({
            leverage: parseInt(local.leverage),
            riskPerTrade: local.riskPerTrade / 100,
            symbol: local.symbol,
            timeframe: local.timeframe,
            useBreakout: local.useBreakout,
            useMeanReversion: local.useMeanReversion,
            emaFast: parseInt(local.emaFast),
            emaSlow: parseInt(local.emaSlow),
            emaHTF: parseInt(local.emaHTF),
            useEmaHTF: local.useEmaHTF,
            rsiPeriod: parseInt(local.rsiPeriod),
            rsiOversold: parseInt(local.rsiOversold),
            rsiOverbought: parseInt(local.rsiOverbought),
            atrMultiplierSL: parseFloat(local.atrMultiplierSL),
            atrMultiplierTP: parseFloat(local.atrMultiplierTP),
            useSessionFilter: local.useSessionFilter,
            session: local.session,
            useCandleConfirmation: local.useCandleConfirmation,
        });
    };

    // Derive active mode label
    const modeLabel = local.useBreakout ? 'Breakout' : local.useMeanReversion ? 'Mean Reversion' : 'Pullback (RSI)';

    return (
        <div className="glass-panel col-span-8" style={{ padding: '2rem', maxWidth: '820px' }}>
            <h3 style={{ marginBottom: '0.5rem' }}>🛠️ Painel de Estratégia — ModularStrategyV6</h3>
            <p style={{ fontSize: '0.85rem', opacity: 0.5, marginBottom: '1.5rem' }}>Configuração completa para backtests e operações live.</p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>

                {/* ── Symbol & Timeframe ── */}
                {sectionTitle('Ativo e Timeframe')}
                <div>
                    <label style={labelStyle}>Símbolo</label>
                    <select value={local.symbol} onChange={e => set('symbol', e.target.value)} style={inputStyle}>
                        <option value="BTCUSDT">BTCUSDT</option>
                        <option value="ETHUSDT">ETHUSDT</option>
                        <option value="SOLUSDT">SOLUSDT</option>
                        <option value="BNBUSDT">BNBUSDT</option>
                    </select>
                </div>
                <div>
                    <label style={labelStyle}>Timeframe</label>
                    <select value={local.timeframe} onChange={e => set('timeframe', e.target.value)} style={inputStyle}>
                        <option value="1m">1m</option>
                        <option value="3m">3m</option>
                        <option value="5m">5m</option>
                        <option value="15m">15m</option>
                        <option value="30m">30m</option>
                        <option value="1h">1h</option>
                        <option value="4h">4h</option>
                    </select>
                </div>

                {/* ── Engine Mode ── */}
                {sectionTitle(`Modo de Operação — ${modeLabel}`)}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <input type="checkbox" id="chkBreakout" checked={local.useBreakout} onChange={e => set('useBreakout', e.target.checked)} />
                    <label htmlFor="chkBreakout" style={{ fontSize: '0.9rem' }}>Breakout</label>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <input type="checkbox" id="chkMR" checked={local.useMeanReversion} onChange={e => set('useMeanReversion', e.target.checked)} />
                    <label htmlFor="chkMR" style={{ fontSize: '0.9rem' }}>Mean Reversion</label>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <input type="checkbox" id="chkCandle" checked={local.useCandleConfirmation} onChange={e => set('useCandleConfirmation', e.target.checked)} />
                    <label htmlFor="chkCandle" style={{ fontSize: '0.9rem' }}>Candle Confirmation</label>
                </div>

                {/* ── Multi-EMA Trend Alignment ── */}
                {sectionTitle('Multi-EMA Trend Alignment')}
                <div>
                    <label style={labelStyle}>EMA Fast</label>
                    <input type="number" value={local.emaFast} onChange={e => set('emaFast', e.target.value)} style={inputStyle} />
                </div>
                <div>
                    <label style={labelStyle}>EMA Slow</label>
                    <input type="number" value={local.emaSlow} onChange={e => set('emaSlow', e.target.value)} style={inputStyle} />
                </div>
                <div>
                    <label style={labelStyle}>EMA HTF</label>
                    <input type="number" value={local.emaHTF} onChange={e => set('emaHTF', e.target.value)} style={inputStyle} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <input type="checkbox" id="chkHTF" checked={local.useEmaHTF} onChange={e => set('useEmaHTF', e.target.checked)} />
                    <label htmlFor="chkHTF" style={{ fontSize: '0.9rem' }}>Usar EMA HTF Filter</label>
                </div>

                {/* ── RSI Settings ── */}
                {sectionTitle('RSI (Pullback Filter)')}
                <div>
                    <label style={labelStyle}>RSI Período</label>
                    <input type="number" value={local.rsiPeriod} onChange={e => set('rsiPeriod', e.target.value)} style={inputStyle} />
                </div>
                <div>
                    <label style={labelStyle}>RSI Oversold</label>
                    <input type="number" value={local.rsiOversold} onChange={e => set('rsiOversold', e.target.value)} style={inputStyle} />
                </div>
                <div>
                    <label style={labelStyle}>RSI Overbought</label>
                    <input type="number" value={local.rsiOverbought} onChange={e => set('rsiOverbought', e.target.value)} style={inputStyle} />
                </div>

                {/* ── ATR-based Risk (SL / TP) ── */}
                {sectionTitle('Stop Loss / Take Profit (ATR Multiplier)')}
                <div>
                    <label style={labelStyle}>ATR × SL</label>
                    <input type="number" step="0.1" value={local.atrMultiplierSL} onChange={e => set('atrMultiplierSL', e.target.value)} style={inputStyle} />
                </div>
                <div>
                    <label style={labelStyle}>ATR × TP</label>
                    <input type="number" step="0.1" value={local.atrMultiplierTP} onChange={e => set('atrMultiplierTP', e.target.value)} style={inputStyle} />
                </div>

                {/* ── Session Filter ── */}
                {sectionTitle('Session Filter')}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <input type="checkbox" id="chkSession" checked={local.useSessionFilter} onChange={e => set('useSessionFilter', e.target.checked)} />
                    <label htmlFor="chkSession" style={{ fontSize: '0.9rem' }}>Ativar Filtro de Sessão</label>
                </div>
                <div>
                    <label style={labelStyle}>Sessão</label>
                    <select value={local.session} onChange={e => set('session', e.target.value)} style={inputStyle}>
                        <option value="NY">New York</option>
                        <option value="LONDON">London</option>
                        <option value="ASIA">Asia</option>
                    </select>
                </div>

                {/* ── Position Sizing ── */}
                {sectionTitle('Position Sizing')}
                <div>
                    <label style={labelStyle}>Alavancagem (Futures)</label>
                    <input type="number" value={local.leverage} onChange={e => set('leverage', e.target.value)} style={inputStyle} />
                </div>
                <div>
                    <label style={labelStyle}>Risco por Trade (%)</label>
                    <input type="number" step="0.5" value={local.riskPerTrade} onChange={e => set('riskPerTrade', e.target.value)} style={inputStyle} />
                </div>
            </div>

            <div style={{ padding: '1rem', marginTop: '1.5rem', background: 'rgba(255, 179, 0, 0.05)', borderRadius: '8px', border: '1px solid rgba(255, 179, 0, 0.2)', display: 'flex', gap: '12px', alignItems: 'center' }}>
                <AlertTriangle color="#ffb300" size={24} />
                <div style={{ fontSize: '0.85rem', color: '#ffb300' }}>Alterar parâmetros afetará apenas novas ordens. Posições abertas continuarão com os stops originais.</div>
            </div>

            <button 
              onClick={handleSave}
              className="btn-primary" style={{ marginTop: '1rem', padding: '1rem', borderRadius: '12px', fontWeight: 700, width: '100%' }}
            >
                Aplicar Configurações
            </button>
        </div>
    )
}

// ── BENCHMARK VIEW ───────────────────────────────────────────────────────────
function BenchmarkView() {
    const [bmConfig, setBmConfig]   = useState(null);
    const [running, setRunning]     = useState(false);
    const [report, setReport]       = useState(null);
    const [error, setError]         = useState(null);
    const [selectedRegimes, setSelRegimes] = useState(['BULL', 'BEAR', 'SIDEWAYS']);
    const [selectedSymbols, setSelSymbols] = useState(['BTCUSDT', 'ETHUSDT']);
    const [selectedTFs, setSelTFs]         = useState(['5m', '15m', '1h']);
    const [activeRegimeTab, setActiveRegimeTab] = useState('ALL');
    const [applying, setApplying]   = useState(null);   // index of row being applied
    const [appliedMsg, setAppliedMsg] = useState(null);  // success message

    useEffect(() => {
        fetch(`${API_URL}/benchmark/config`).then(r => r.json()).then(setBmConfig).catch(() => {});
        // Load last persisted results so they survive page changes
        fetch(`${API_URL}/benchmark/results`).then(r => r.json()).then(data => {
            if (data && data.top50) setReport(data);
        }).catch(() => {});
    }, []);

    const toggleItem = (arr, setArr, item) => {
        setArr(prev => prev.includes(item) ? prev.filter(x => x !== item) : [...prev, item]);
    };

    const runBenchmark = async () => {
        setRunning(true); setReport(null); setError(null);
        try {
            const res = await fetch(`${API_URL}/benchmark/run`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbols: selectedSymbols, timeframes: selectedTFs, regimes: selectedRegimes }),
            });
            if (!res.ok) { const e = await res.json(); throw new Error(e.details || e.error); }
            const data = await res.json();
            setReport(data);
        } catch (e) { setError(e.message); }
        finally { setRunning(false); }
    };

    const applyStrategy = async (result, rowIndex) => {
        setApplying(rowIndex); setAppliedMsg(null);
        try {
            const res = await fetch(`${API_URL}/benchmark/apply`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ params: result.params, symbol: result.symbol, timeframe: result.timeframe }),
            });
            if (!res.ok) { const e = await res.json(); throw new Error(e.details || e.error); }
            setAppliedMsg(`✅ Applied: ${result.strategy} (${result.symbol} ${result.timeframe}) → Demo Bot`);
            setTimeout(() => setAppliedMsg(null), 6000);
        } catch (e) { setError(`Apply failed: ${e.message}`); }
        finally { setApplying(null); }
    };

    const chipStyle = (active) => ({
        padding: '6px 14px', borderRadius: '999px', border: `1px solid ${active ? '#00ff87' : 'rgba(255,255,255,0.1)'}`,
        background: active ? 'rgba(0,255,135,0.12)' : 'transparent', color: active ? '#00ff87' : 'rgba(255,255,255,0.5)',
        cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, userSelect: 'none',
    });

    const regimeColor = { BULL: '#00e676', BEAR: '#ff4d4f', SIDEWAYS: '#ffb300' };

    // Filter results by active regime tab
    const displayResults = report ? (activeRegimeTab === 'ALL' ? report.top50 : (report.byRegime?.[activeRegimeTab] || [])) : [];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {/* Config Panel */}
            <div className="glass-panel" style={{ padding: '1.5rem' }}>
                <h3 style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Crosshair size={20} color="#00ff87" /> Benchmark — Grid × Regime Matrix
                </h3>
                <p style={{ fontSize: '0.85rem', opacity: 0.5, marginBottom: '1.5rem' }}>
                    Testa {bmConfig?.gridSize ?? '...'} combinações de estratégia em períodos fixos de Bull, Bear e Sideways market.
                </p>

                {/* Regime selection */}
                <div style={{ marginBottom: '1rem' }}>
                    <label style={{ fontSize: '0.8rem', opacity: 0.6, display: 'block', marginBottom: '8px' }}>Regimes</label>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {(bmConfig?.regimes || []).map(r => (
                            <span key={r.tag} style={chipStyle(selectedRegimes.includes(r.tag))} onClick={() => toggleItem(selectedRegimes, setSelRegimes, r.tag)}>
                                <span style={{ color: regimeColor[r.tag], marginRight: '6px' }}>●</span>
                                {r.label} ({r.start} → {r.end})
                            </span>
                        ))}
                    </div>
                </div>

                {/* Symbol selection */}
                <div style={{ marginBottom: '1rem' }}>
                    <label style={{ fontSize: '0.8rem', opacity: 0.6, display: 'block', marginBottom: '8px' }}>Symbols</label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        {(bmConfig?.symbols || []).map(s => (
                            <span key={s} style={chipStyle(selectedSymbols.includes(s))} onClick={() => toggleItem(selectedSymbols, setSelSymbols, s)}>{s}</span>
                        ))}
                    </div>
                </div>

                {/* Timeframe selection */}
                <div style={{ marginBottom: '1.5rem' }}>
                    <label style={{ fontSize: '0.8rem', opacity: 0.6, display: 'block', marginBottom: '8px' }}>Timeframes</label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        {(bmConfig?.timeframes || []).map(tf => (
                            <span key={tf} style={chipStyle(selectedTFs.includes(tf))} onClick={() => toggleItem(selectedTFs, setSelTFs, tf)}>{tf}</span>
                        ))}
                    </div>
                </div>

                <button onClick={runBenchmark} disabled={running || selectedRegimes.length === 0}
                    style={{ padding: '0.85rem 2rem', borderRadius: '10px', border: 'none', background: running ? 'rgba(0,255,135,0.2)' : '#00ff87', color: '#000', fontWeight: 700, cursor: running ? 'not-allowed' : 'pointer', fontSize: '0.95rem' }}>
                    {running ? '⏳ Executando benchmark...' : '▶ Iniciar Benchmark'}
                </button>

                {error && <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'rgba(255,77,79,0.1)', border: '1px solid rgba(255,77,79,0.3)', borderRadius: '8px', color: '#ff4d4f', fontSize: '0.9rem' }}>❌ {error}</div>}
                {appliedMsg && <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'rgba(0,255,135,0.1)', border: '1px solid rgba(0,255,135,0.3)', borderRadius: '8px', color: '#00ff87', fontSize: '0.9rem' }}>{appliedMsg}</div>}
            </div>

            {/* Summary stats */}
            {report && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
                    {[
                        { label: 'Total Runs', value: report.totalRuns?.toLocaleString() },
                        { label: 'Qualified (≥5 trades)', value: report.qualified },
                        { label: 'Regimes Tested', value: report.config?.regimes?.length },
                        { label: 'Grid Size', value: report.config?.gridSize },
                    ].map(({ label, value }) => (
                        <div key={label} className="glass-panel" style={{ padding: '1rem' }}>
                            <div style={{ fontSize: '0.75rem', opacity: 0.5, marginBottom: '4px' }}>{label}</div>
                            <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#00ff87' }}>{value}</div>
                        </div>
                    ))}
                </div>
            )}

            {/* Regime tabs + Results table */}
            {report && (
                <div className="glass-panel" style={{ padding: '1.5rem' }}>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
                        <span style={chipStyle(activeRegimeTab === 'ALL')} onClick={() => setActiveRegimeTab('ALL')}>All (Top 50)</span>
                        {report.config?.regimes?.map(tag => (
                            <span key={tag} style={chipStyle(activeRegimeTab === tag)} onClick={() => setActiveRegimeTab(tag)}>
                                <span style={{ color: regimeColor[tag], marginRight: '4px' }}>●</span>{tag}
                            </span>
                        ))}
                    </div>

                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.82rem' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', opacity: 0.55 }}>
                                    {['#', 'Regime', 'Symbol', 'TF', 'Strategy', 'Win Rate', 'PF', 'Trades', 'Max DD', 'PnL', 'Score', 'EMA', 'RSI', 'ATR SL/TP', 'Session', ''].map(h => (
                                        <th key={h} style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {displayResults.map((r, i) => (
                                    <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                                        <td style={{ padding: '6px 10px', opacity: 0.4 }}>{i + 1}</td>
                                        <td style={{ padding: '6px 10px' }}>
                                            <span style={{ color: regimeColor[r.regime], fontWeight: 700, fontSize: '0.78rem' }}>{r.regime}</span>
                                        </td>
                                        <td style={{ padding: '6px 10px', fontWeight: 600 }}>{r.symbol}</td>
                                        <td style={{ padding: '6px 10px' }}>{r.timeframe}</td>
                                        <td style={{ padding: '6px 10px', fontSize: '0.78rem' }}>{r.strategy}</td>
                                        <td style={{ padding: '6px 10px', color: r.metrics.winRate >= 55 ? '#00ff87' : '#ffb300', fontWeight: 600 }}>{r.metrics.winRate.toFixed(1)}%</td>
                                        <td style={{ padding: '6px 10px', color: r.metrics.profitFactor >= 1.3 ? '#00ff87' : '#ffb300' }}>{r.metrics.profitFactor.toFixed(2)}</td>
                                        <td style={{ padding: '6px 10px' }}>{r.metrics.tradesCount}</td>
                                        <td style={{ padding: '6px 10px', color: r.metrics.maxDrawdown > 15 ? '#ff4d4f' : '#00ff87' }}>{r.metrics.maxDrawdown.toFixed(1)}%</td>
                                        <td style={{ padding: '6px 10px', color: r.metrics.totalPnl >= 0 ? '#00ff87' : '#ff4d4f', fontWeight: 600 }}>${r.metrics.totalPnl.toFixed(0)}</td>
                                        <td style={{ padding: '6px 10px', fontWeight: 700, color: '#60efff' }}>{r.composite.toFixed(3)}</td>
                                        <td style={{ padding: '6px 10px', fontSize: '0.78rem' }}>{r.params.emaFastPeriod}/{r.params.emaSlowPeriod}</td>
                                        <td style={{ padding: '6px 10px', fontSize: '0.78rem' }}>{r.params.rsiOversold}/{r.params.rsiOverbought}</td>
                                        <td style={{ padding: '6px 10px', fontSize: '0.78rem' }}>{r.params.atrMultiplier}×/{r.params.tpMultiplier}×</td>
                                        <td style={{ padding: '6px 10px', fontSize: '0.78rem' }}>{r.params.session}</td>
                                        <td style={{ padding: '6px 10px' }}>
                                            <button onClick={() => applyStrategy(r, i)} disabled={applying === i}
                                                style={{ padding: '4px 12px', borderRadius: '6px', border: '1px solid rgba(0,255,135,0.4)',
                                                    background: applying === i ? 'rgba(0,255,135,0.15)' : 'rgba(0,255,135,0.08)',
                                                    color: '#00ff87', fontSize: '0.75rem', fontWeight: 700, cursor: applying === i ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
                                                {applying === i ? '⏳...' : '▶ Apply'}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {displayResults.length === 0 && (
                            <div style={{ textAlign: 'center', padding: '2rem', opacity: 0.4 }}>Nenhum resultado qualificado para este filtro.</div>
                        )}
                    </div>
                </div>
            )}

            {/* Validation info */}
            {report?.validation && (
                <div className="glass-panel" style={{ padding: '1rem' }}>
                    <h4 style={{ marginBottom: '0.75rem', fontSize: '0.9rem', opacity: 0.7 }}>Data Validation</h4>
                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                        {report.validation.map((v, i) => (
                            <div key={i} style={{ padding: '6px 12px', borderRadius: '8px', fontSize: '0.78rem',
                                background: v.ok ? 'rgba(0,255,135,0.08)' : 'rgba(255,77,79,0.08)',
                                border: `1px solid ${v.ok ? 'rgba(0,255,135,0.2)' : 'rgba(255,77,79,0.2)'}`,
                                color: v.ok ? '#00ff87' : '#ff4d4f' }}>
                                {v.ok ? '✓' : '⚠'} {v.symbol} {v.timeframe} — {v.candles?.toLocaleString()} candles
                                {v.gaps > 0 && ` | ${v.gaps} gaps`}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function AuditView({ decisions }) {
    return (
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <div>
                    <h3 style={{ marginBottom: '0.35rem' }}>Decision Journal</h3>
                    <div style={{ fontSize: '0.85rem', opacity: 0.6 }}>Sinais detectados, bloqueios por filtro/risco e execucoes confirmadas.</div>
                </div>
                <div style={{ fontSize: '0.8rem', opacity: 0.45 }}>{decisions.length} eventos</div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {decisions.map((entry) => (
                    <div key={entry.id || `${entry.timestamp}-${entry.symbol}-${entry.event_type}`} style={{ border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '1rem', background: 'rgba(255,255,255,0.02)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                <DecisionBadge decision={entry.decision} />
                                <span style={{ fontWeight: 700 }}>{entry.event_type}</span>
                                {entry.symbol && <span style={{ opacity: 0.7 }}>{entry.symbol}</span>}
                                {entry.side && <span style={{ opacity: 0.7 }}>{entry.side}</span>}
                                {entry.strategy && <span style={{ opacity: 0.6 }}>{entry.strategy}</span>}
                            </div>
                            <span style={{ fontSize: '0.8rem', opacity: 0.45 }}>{new Date(entry.timestamp).toLocaleString()}</span>
                        </div>

                        <div style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>{entry.reason || 'Sem motivo detalhado.'}</div>

                        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.8rem', opacity: 0.6 }}>
                            <span>Origem: {entry.source}</span>
                            <span>Modo: {entry.mode}</span>
                            {typeof entry.price === 'number' && <span>Preco: {entry.price.toFixed(4)}</span>}
                        </div>

                        {entry.context && Object.keys(entry.context).length > 0 && (
                            <pre style={{ marginTop: '0.75rem', padding: '0.75rem', borderRadius: '8px', background: 'rgba(0,0,0,0.25)', fontSize: '0.75rem', opacity: 0.75, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                {JSON.stringify(entry.context, null, 2)}
                            </pre>
                        )}
                    </div>
                ))}

                {decisions.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '2rem', opacity: 0.4 }}>
                        Nenhum evento auditavel registrado ainda.
                    </div>
                )}
            </div>
        </div>
    )
}

function DecisionBadge({ decision }) {
    const palette = {
        DETECTED: { color: '#60efff', background: 'rgba(96, 239, 255, 0.12)' },
        BLOCKED: { color: '#ffb300', background: 'rgba(255, 179, 0, 0.12)' },
        EXECUTED: { color: '#00ff87', background: 'rgba(0, 255, 135, 0.12)' },
        CLOSED: { color: '#c084fc', background: 'rgba(192, 132, 252, 0.12)' },
        FAILED: { color: '#ff4d4f', background: 'rgba(255, 77, 79, 0.12)' },
        INFO: { color: '#ffffff', background: 'rgba(255,255,255,0.08)' },
    };

    const style = palette[decision] || palette.INFO;

    return (
        <span style={{ padding: '4px 8px', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 700, color: style.color, background: style.background }}>
            {decision}
        </span>
    )
}

function StatCard({ icon, label, value, sub }) {
    return (
        <div className="glass-panel col-span-4" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', opacity: 0.6, marginBottom: '0.5rem' }}>
                {icon} <span style={{ fontSize: '0.9rem' }}>{label}</span>
            </div>
            <div style={{ fontSize: '1.8rem', fontWeight: 800, marginBottom: '0.5rem' }}>{value}</div>
            <div style={{ fontSize: '0.8rem', opacity: 0.4 }}>{sub}</div>
        </div>
    )
}

function RiskStat({ label, value }) {
    return (
        <div style={{ background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: '12px' }}>
            <div style={{ fontSize: '0.75rem', opacity: 0.5, marginBottom: '4px' }}>{label}</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{value}</div>
        </div>
    )
}

function BacktestView({ form, onFormChange, onRun, loading, result, error }) {
    const equityData = result?.trades ? (() => {
        let balance = parseFloat(form.balance) || 1000;
        return result.trades.map((t, i) => {
            balance = t.newBalance;
            return { name: i + 1, equity: parseFloat(balance.toFixed(2)) };
        });
    })() : [];

    const inputStyle = { background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.1)', padding: '0.75rem 1rem', borderRadius: '8px', color: '#fff', fontSize: '0.9rem', width: '100%' };
    const labelStyle = { fontSize: '0.85rem', opacity: 0.6, marginBottom: '6px', display: 'block' };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {/* Form */}
            <div className="glass-panel" style={{ padding: '1.5rem' }}>
                <h3 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <FlaskConical size={20} color="#60efff" /> Configurar Simulação
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                    <div>
                        <label style={labelStyle}>Par (Symbol)</label>
                        <select value={form.symbol} onChange={e => onFormChange({ ...form, symbol: e.target.value })} style={inputStyle}>
                            <option>BTCUSDT</option><option>ETHUSDT</option><option>SOLUSDT</option><option>BNBUSDT</option>
                        </select>
                    </div>
                    <div>
                        <label style={labelStyle}>Data Início</label>
                        <input type="date" value={form.startDate} onChange={e => onFormChange({ ...form, startDate: e.target.value })} style={inputStyle} />
                    </div>
                    <div>
                        <label style={labelStyle}>Data Fim</label>
                        <input type="date" value={form.endDate} onChange={e => onFormChange({ ...form, endDate: e.target.value })} style={inputStyle} />
                    </div>
                    <div>
                        <label style={labelStyle}>Saldo Inicial (USDT)</label>
                        <input type="number" value={form.balance} onChange={e => onFormChange({ ...form, balance: e.target.value })} style={inputStyle} />
                    </div>
                </div>
                <button onClick={onRun} disabled={loading} style={{ padding: '0.85rem 2rem', borderRadius: '10px', border: 'none', background: loading ? 'rgba(96,239,255,0.2)' : '#60efff', color: '#000', fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', fontSize: '0.95rem' }}>
                    {loading ? '⏳ Executando...' : '▶ Executar Backtest'}
                </button>
                {error && <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', background: 'rgba(255,77,79,0.1)', border: '1px solid rgba(255,77,79,0.3)', borderRadius: '8px', color: '#ff4d4f', fontSize: '0.9rem' }}>❌ {error}</div>}
            </div>

            {/* Summary stats */}
            {result?.summary && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
                    {[
                        { label: 'Total Trades', value: result.summary.trades },
                        { label: 'Win Rate', value: result.summary.winRate },
                        { label: 'Profit Factor', value: result.summary.profitFactor },
                        { label: 'Max Drawdown', value: result.summary.maxDrawdown },
                        { label: 'Sharpe Ratio', value: result.summary.sharpeRatio },
                        { label: 'Total PnL (USDT)', value: `$${parseFloat(result.summary.totalPnl).toFixed(2)}` },
                        { label: 'Saldo Final', value: `$${parseFloat(result.summary.finalBalance).toFixed(2)}` },
                        { label: 'Expectancy', value: `$${parseFloat(result.summary.expectancy).toFixed(4)}` },
                    ].map(({ label, value }) => (
                        <div key={label} className="glass-panel" style={{ padding: '1rem' }}>
                            <div style={{ fontSize: '0.75rem', opacity: 0.5, marginBottom: '4px' }}>{label}</div>
                            <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#60efff' }}>{value}</div>
                        </div>
                    ))}
                </div>
            )}

            {/* Equity curve */}
            {equityData.length > 1 && (
                <div className="glass-panel" style={{ padding: '1.5rem' }}>
                    <h3 style={{ marginBottom: '1.5rem' }}>Curva de Equity</h3>
                    <ResponsiveContainer width="100%" height={280}>
                        <AreaChart data={equityData}>
                            <defs>
                                <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#60efff" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#60efff" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                            <XAxis dataKey="name" hide />
                            <YAxis stroke="rgba(255,255,255,0.3)" fontSize={11} />
                            <Tooltip contentStyle={{ background: '#1a1b1f', border: 'none', borderRadius: '8px' }} formatter={(v) => [`$${v}`, 'Equity']} />
                            <Area type="monotone" dataKey="equity" stroke="#60efff" fillOpacity={1} fill="url(#eqGrad)" dot={false} />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            )}

            {/* Trades table */}
            {result?.trades?.length > 0 && (
                <div className="glass-panel" style={{ padding: '1.5rem' }}>
                    <h3 style={{ marginBottom: '1rem' }}>Trades Simulados ({result.trades.length})</h3>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', opacity: 0.55 }}>
                                    {['#', 'Símbolo', 'Lado', 'Entrada', 'Saída', 'PnL (USDT)', 'ROE', 'Regime', 'Estratégia'].map(h => (
                                        <th key={h} style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {result.trades.slice(0, 200).map((t, i) => {
                                    const pnl = parseFloat(t.pnl);
                                    return (
                                        <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                                            <td style={{ padding: '8px 12px', opacity: 0.4 }}>{i + 1}</td>
                                            <td style={{ padding: '8px 12px', fontWeight: 600 }}>{t.symbol}</td>
                                            <td style={{ padding: '8px 12px', color: t.side === 'BUY' ? '#00e676' : '#ff4d4f' }}>{t.side}</td>
                                            <td style={{ padding: '8px 12px' }}>{parseFloat(t.entryPrice).toFixed(4)}</td>
                                            <td style={{ padding: '8px 12px' }}>{parseFloat(t.exitPrice).toFixed(4)}</td>
                                            <td style={{ padding: '8px 12px', color: pnl >= 0 ? '#00ff87' : '#ff4d4f', fontWeight: 600 }}>{pnl >= 0 ? '+' : ''}{pnl.toFixed(4)}</td>
                                            <td style={{ padding: '8px 12px', color: pnl >= 0 ? '#00ff87' : '#ff4d4f' }}>{t.roe}</td>
                                            <td style={{ padding: '8px 12px', opacity: 0.6 }}>{t.regime || '-'}</td>
                                            <td style={{ padding: '8px 12px', opacity: 0.6, fontSize: '0.78rem' }}>{t.strategy}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        {result.trades.length > 200 && <div style={{ textAlign: 'center', padding: '1rem', opacity: 0.4, fontSize: '0.85rem' }}>Mostrando 200 de {result.trades.length} trades</div>}
                    </div>
                </div>
            )}

            {result && (!result.trades || result.trades.length === 0) && (
                <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center', opacity: 0.5 }}>Nenhum trade gerado para o período e estratégia selecionados.</div>
            )}
        </div>
    )
}

export default App
