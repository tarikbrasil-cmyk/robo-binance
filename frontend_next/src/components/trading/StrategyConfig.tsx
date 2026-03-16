"use client";

import { useState } from 'react';
import { Settings, Save, ShieldCheck, Zap } from 'lucide-react';

export default function StrategyConfig() {
  const [config, setConfig] = useState({
    leverage: 10,
    tpPerc: 6,
    slPerc: 3,
    riskPerTrade: 10,
    maxDailyTrades: 5
  });

  return (
    <div className="bg-[#161a1e] border border-[#1e2329] rounded-2xl p-6 shadow-sm">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-8 h-8 bg-yellow-400/10 rounded-lg flex items-center justify-center">
          <Settings className="text-yellow-400 w-5 h-5" />
        </div>
        <h3 className="text-lg font-bold">Strategy Configuration</h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="space-y-6">
          <ConfigInput 
            label="Leverage (x)" 
            value={config.leverage} 
            onChange={(v) => setConfig({...config, leverage: v})} 
            min={1} max={50}
          />
          <ConfigInput 
            label="Take Profit (%)" 
            value={config.tpPerc} 
            onChange={(v) => setConfig({...config, tpPerc: v})} 
            min={0.1} max={50}
          />
          <ConfigInput 
            label="Stop Loss (%)" 
            value={config.slPerc} 
            onChange={(v) => setConfig({...config, slPerc: v})} 
            min={0.1} max={20}
          />
        </div>

        <div className="space-y-6 border-l border-[#1e2329] pl-8">
          <ConfigInput 
            label="Risk per Trade (%)" 
            value={config.riskPerTrade} 
            onChange={(v) => setConfig({...config, riskPerTrade: v})} 
            min={1} max={100}
          />
          <ConfigInput 
            label="Max Daily Trades" 
            value={config.maxDailyTrades} 
            onChange={(v) => setConfig({...config, maxDailyTrades: v})} 
            min={1} max={20}
          />
          
          <div className="pt-4 flex gap-4">
            <button className="flex-1 bg-yellow-400 text-black font-bold py-3 rounded-xl hover:bg-yellow-300 transition-all flex items-center justify-center gap-2">
              <Save size={18} />
              Save Config
            </button>
            <button className="flex-1 bg-[#1e2329] text-white font-bold py-3 rounded-xl hover:bg-[#2b3139] border border-[#2b3139] transition-all flex items-center justify-center gap-2">
              <Zap size={18} />
              Dry Run
            </button>
          </div>
        </div>
      </div>

      <div className="mt-8 p-4 bg-yellow-400/5 rounded-xl border border-yellow-400/10 flex items-start gap-4">
        <ShieldCheck className="text-yellow-400 mt-1 flex-shrink-0" size={20} />
        <div>
          <h4 className="text-sm font-bold text-yellow-400">Risk Warning</h4>
          <p className="text-xs text-gray-400 mt-1 leading-relaxed">
            High leverage increases risk. Ensure your Stop Loss is aligned with your account balance to prevent liquidation cascades.
          </p>
        </div>
      </div>
    </div>
  );
}

function ConfigInput({ label, value, onChange, min, max }: { label: string, value: number, onChange: (v: number) => void, min: number, max: number }) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <label className="text-sm font-medium text-gray-400">{label}</label>
        <span className="text-sm font-mono font-bold text-white">{value}</span>
      </div>
      <input 
        type="range" 
        min={min} 
        max={max} 
        value={value} 
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 bg-[#1e2329] rounded-lg appearance-none cursor-pointer accent-yellow-400"
      />
    </div>
  );
}
