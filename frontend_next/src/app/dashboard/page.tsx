"use client";

import { 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Target, 
  Percent,
  Layers,
  Zap
} from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import StrategyConfig from "@/components/trading/StrategyConfig";
import PositionsTable from "@/components/trading/PositionsTable";
import MarketScannerPanel from "@/components/scanner/MarketScannerPanel";
import DashboardLayout from "@/components/layout/DashboardLayout";
import SetupWizard from "@/components/setup/SetupWizard";
import { useState, useEffect } from "react";
import axios from "axios";

const data = [
  { name: 'Mon', value: 10000 },
  { name: 'Tue', value: 10500 },
  { name: 'Wed', value: 10200 },
  { name: 'Thu', value: 11000 },
  { name: 'Fri', value: 10850 },
  { name: 'Sat', value: 11500 },
  { name: 'Sun', value: 12450 },
];

export default function DashboardPage() {
  const [isBotRunning, setIsBotRunning] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [activePositions, setActivePositions] = useState([]);
  const [opportunities, setOpportunities] = useState([]);
  const [dailyPnl, setDailyPnl] = useState(0);

  useEffect(() => {
    const isSetup = localStorage.getItem('isSetupComplete');
    if (!isSetup) {
      setShowSetup(true);
    }
    
    // Initial checks
    checkBotStatus();
    fetchData();

    // Polling for real-time updates from 3-layer backends
    const interval = setInterval(() => {
      checkBotStatus();
      fetchData();
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const checkBotStatus = async () => {
    try {
      const res = await axios.get("http://localhost:8000/health");
      setIsBotRunning(res.data.bot_running);
    } catch (e) {
      console.error("Control API unreachable");
    }
  };

  const fetchData = async () => {
    try {
      const [posRes, pnlRes, oppRes] = await Promise.all([
        axios.get("http://localhost:8000/positions"),
        axios.get("http://localhost:8000/pnl"),
        axios.get("http://localhost:8000/opportunities")
      ]);
      setActivePositions(posRes.data);
      setDailyPnl(pnlRes.data.daily_pnl);
      setOpportunities(oppRes.data);
    } catch (e) {
      console.error("Failed to fetch real-time data");
    }
  };

  const handleStartStop = async () => {
    try {
      if (isBotRunning) {
        await axios.post("http://localhost:8000/bot/stop");
        setIsBotRunning(false);
      } else {
        await axios.post("http://localhost:8000/bot/start");
        setIsBotRunning(true);
      }
    } catch (e) {
      alert("Control API Error: Start/Stop signal failed");
    }
  };

  const handleSetupComplete = async (setupData: any) => {
    try {
      await axios.post("http://localhost:8000/user/setup", setupData);
      localStorage.setItem('isSetupComplete', 'true');
      setShowSetup(false);
    } catch (e) {
      alert("Setup failed. Ensure the Control API is running.");
    }
  };

  return (
    <DashboardLayout>
      {showSetup && <SetupWizard onComplete={handleSetupComplete} />}
      
      <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
        {/* Top Control Bar */}
        <div className="flex items-center justify-between bg-[#161a1e]/50 p-4 rounded-2xl border border-[#1e2329]">
          <div className="flex items-center gap-4">
            <div className="flex flex-col">
              <span className="text-xs text-gray-500 font-bold uppercase tracking-wider">Trading Status</span>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${isBotRunning ? 'bg-green-400 animate-pulse' : 'bg-gray-600'}`}></div>
                <span className={`text-sm font-bold ${isBotRunning ? 'text-green-400' : 'text-gray-400'}`}>
                  {isBotRunning ? 'BOT ACTIVE' : 'BOT STANDBY'}
                </span>
              </div>
            </div>
          </div>
          <button 
            onClick={handleStartStop}
            className={`px-8 py-3 rounded-xl font-bold transition-all shadow-lg flex items-center gap-2 ${
              isBotRunning 
              ? 'bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20' 
              : 'bg-yellow-400 text-black hover:bg-yellow-300'
            }`}
          >
            {isBotRunning ? <Layers size={18} /> : <Zap size={18} fill="currentColor" />}
            {isBotRunning ? 'Stop Trading Bot' : 'Start Trading Bot'}
          </button>
        </div>

        {/* Overview Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard 
            label="Total Equity" 
            value="$12,450.82" 
            change="+12.5%" 
            trend="up"
            icon={<DollarSign className="text-yellow-400" />}
          />
          <StatCard 
            label="Daily PnL" 
            value={`$${dailyPnl >= 0 ? '+' : ''}${dailyPnl}`} 
            change={dailyPnl >= 0 ? "+0.0%" : "-0.0%"} 
            trend={dailyPnl >= 0 ? "up" : "down"}
            icon={<TrendingUp className={dailyPnl >= 0 ? "text-green-400" : "text-red-400"} />}
          />
          <StatCard 
            label="Win Rate" 
            value="--" 
            change="0.0%" 
            trend="up"
            icon={<Target className="text-blue-400" />}
          />
          <StatCard 
            label="Active Pairs" 
            value={`${activePositions.length}/50`} 
            icon={<Layers className="text-purple-400" />}
          />
        </div>

        {/* Equity Chart & Scanner */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 bg-[#161a1e] border border-[#1e2329] rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-lg font-bold">Equity Growth (7 Days)</h3>
              <div className="flex gap-2">
                <button className="px-3 py-1 bg-[#1e2329] rounded-lg text-xs font-medium text-gray-400 hover:text-white transition-colors">7D</button>
                <button className="px-3 py-1 bg-[#1e2329] rounded-lg text-xs font-medium text-gray-400 hover:text-white transition-colors">1M</button>
                <button className="px-3 py-1 bg-[#1e2329] rounded-lg text-xs font-medium text-gray-400 hover:text-white transition-colors">ALL</button>
              </div>
            </div>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data}>
                  <defs>
                    <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#facc15" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#facc15" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e2329" vertical={false} />
                  <XAxis 
                    dataKey="name" 
                    stroke="#4b5563" 
                    fontSize={12} 
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis 
                    stroke="#4b5563" 
                    fontSize={12} 
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(val) => `$${val/1000}k`}
                  />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#161a1e', border: '1px solid #1e2329', borderRadius: '12px' }}
                    itemStyle={{ color: '#facc15' }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="value" 
                    stroke="#facc15" 
                    strokeWidth={3}
                    fillOpacity={1} 
                    fill="url(#colorValue)" 
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="lg:col-span-1">
            <MarketScannerPanel opportunities={opportunities} />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            <PositionsTable positions={activePositions} />
          </div>
          <div className="lg:col-span-1">
            <StrategyConfig />
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

function StatCard({ label, value, change, trend, icon }: { label: string, value: string, change?: string, trend?: 'up' | 'down', icon: React.ReactNode }) {
  return (
    <div className="bg-[#161a1e] border border-[#1e2329] p-6 rounded-2xl hover:border-yellow-400/20 transition-all duration-300 shadow-sm relative overflow-hidden group">
      <div className="absolute -right-2 -top-2 w-12 h-12 bg-white/5 blur-2xl rounded-full group-hover:bg-yellow-400/10 transition-all"></div>
      <div className="flex items-center gap-4 mb-3">
        <div className="w-10 h-10 bg-[#1e2329] rounded-xl flex items-center justify-center border border-white/5 transition-transform group-hover:scale-110">
          {icon}
        </div>
        <span className="text-sm font-medium text-gray-400">{label}</span>
      </div>
      <div className="flex items-baseline gap-3">
        <h4 className="text-2xl font-bold font-mono tracking-tight">{value}</h4>
        {change && (
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
            trend === 'up' ? "bg-green-400/10 text-green-400" : "bg-red-400/10 text-red-400"
          }`}>
            {change}
          </span>
        )}
      </div>
    </div>
  );
}
