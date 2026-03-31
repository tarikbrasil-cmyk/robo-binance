import { useState, useEffect } from 'react'
import { Activity, Power, TrendingUp, DollarSign, Settings, Target, Zap, BarChart2, History, Download, ChevronRight, AlertTriangle, FlaskConical } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, PieChart, Pie, Cell } from 'recharts'
import { jsPDF } from 'jspdf'
import 'jspdf-autotable'

// Constantes
const API_URL = 'http://localhost:3001/api';
const WS_URL = 'ws://localhost:3001';

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
    
    const ws = new WebSocket(WS_URL);
    
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
    const [local, setLocal] = useState({ leverage: config.leverage, takeProfitPerc: config.takeProfitPerc * 100, stopLossPerc: config.stopLossPerc * 100 });
    
    return (
        <div className="glass-panel col-span-8" style={{ padding: '2rem', maxWidth: '600px' }}>
            <h3 style={{ marginBottom: '2rem' }}>Ajustes Estratégicos</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label style={{ fontSize: '0.9rem', opacity: 0.7 }}>Alavancagem Máxima (Futures)</label>
                    <input type="number" value={local.leverage} onChange={e => setLocal({...local, leverage: e.target.value})} style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', padding: '0.8rem', borderRadius: '8px', color: '#fff' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label style={{ fontSize: '0.9rem', opacity: 0.7 }}>Take Profit Alvo (%)</label>
                    <input type="number" value={local.takeProfitPerc} onChange={e => setLocal({...local, takeProfitPerc: e.target.value})} style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', padding: '0.8rem', borderRadius: '8px', color: '#fff' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label style={{ fontSize: '0.9rem', opacity: 0.7 }}>Stop Loss Máximo (%)</label>
                    <input type="number" value={local.stopLossPerc} onChange={e => setLocal({...local, stopLossPerc: e.target.value})} style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', padding: '0.8rem', borderRadius: '8px', color: '#fff' }} />
                </div>
                
                <div style={{ padding: '1rem', background: 'rgba(255, 179, 0, 0.05)', borderRadius: '8px', border: '1px solid rgba(255, 179, 0, 0.2)', display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <AlertTriangle color="#ffb300" size={24} />
                    <div style={{ fontSize: '0.85rem', color: '#ffb300' }}>Alterar parâmetros afetará apenas novas ordens. Posições abertas continuarão com os stops originais.</div>
                </div>

                <button 
                  onClick={() => onSave({ leverage: parseInt(local.leverage), takeProfitPerc: local.takeProfitPerc/100, stopLossPerc: local.stopLossPerc/100 })}
                  className="btn-primary" style={{ marginTop: '1rem', padding: '1rem', borderRadius: '12px', fontWeight: 700 }}
                >
                    Aplicar Configurações
                </button>
            </div>
        </div>
    )
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
