"use client";

import React, { useState } from 'react';
import { Key, Shield, Settings, Play } from 'lucide-react';

interface SetupStepProps {
  onComplete: (data: any) => void;
}

export default function SetupWizard({ onComplete }: SetupStepProps) {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    apiKey: '',
    apiSecret: '',
    leverage: 10,
    mode: 'PAPER'
  });

  const next = () => setStep(step + 1);

  if (step === 1) {
    return (
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-[#161a1e] border border-yellow-400/20 w-full max-w-md rounded-2xl shadow-2xl p-8 animate-in zoom-in-95 duration-300">
          <div className="w-12 h-12 bg-yellow-400/10 rounded-xl flex items-center justify-center mb-6">
            <Key className="text-yellow-400" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Welcome to QuantSaaS</h2>
          <p className="text-gray-400 text-sm mb-8">Let's connect your Binance account to get started. Your keys are encrypted locally.</p>
          
          <div className="space-y-4">
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase block mb-2">Binance API Key</label>
              <input 
                type="text" 
                className="w-full bg-[#1e2329] border border-[#2b3139] rounded-xl px-4 py-3 text-sm focus:border-yellow-400 outline-none transition-colors"
                placeholder="Enter your API key"
                value={formData.apiKey}
                onChange={(e) => setFormData({...formData, apiKey: e.target.value})}
              />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase block mb-2">Binance API Secret</label>
              <input 
                type="password" 
                className="w-full bg-[#1e2329] border border-[#2b3139] rounded-xl px-4 py-3 text-sm focus:border-yellow-400 outline-none transition-colors"
                placeholder="Enter your API secret"
                value={formData.apiSecret}
                onChange={(e) => setFormData({...formData, apiSecret: e.target.value})}
              />
            </div>
          </div>

          <button 
            className="w-full bg-yellow-400 text-black font-bold py-4 rounded-2xl mt-8 hover:bg-yellow-300 transition-all"
            onClick={next}
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#161a1e] border border-yellow-400/20 w-full max-w-md rounded-2xl shadow-2xl p-8 animate-in slide-in-from-right-8 duration-300">
        <div className="w-12 h-12 bg-yellow-400/10 rounded-xl flex items-center justify-center mb-6">
          <Shield className="text-yellow-400" />
        </div>
        <h2 className="text-2xl font-bold mb-2">Initial Configuration</h2>
        <p className="text-gray-400 text-sm mb-8">Define your default risk and trading environment.</p>
        
        <div className="space-y-6">
          <div className="flex gap-4">
            <button 
              className={`flex-1 py-3 rounded-xl border font-bold text-sm transition-all ${formData.mode === 'PAPER' ? 'bg-white/5 border-yellow-400 text-yellow-400' : 'bg-[#1e2329] border-transparent text-gray-500'}`}
              onClick={() => setFormData({...formData, mode: 'PAPER'})}
            >
              Paper Trading
            </button>
            <button 
              className={`flex-1 py-3 rounded-xl border font-bold text-sm transition-all ${formData.mode === 'LIVE' ? 'bg-red-500/10 border-red-500 text-red-500' : 'bg-[#1e2329] border-transparent text-gray-500'}`}
              onClick={() => setFormData({...formData, mode: 'LIVE'})}
            >
              Live Trading
            </button>
          </div>

          <div>
            <div className="flex justify-between mb-2">
              <label className="text-xs font-bold text-gray-500 uppercase">Default Leverage ({formData.leverage}x)</label>
            </div>
            <input 
              type="range" min="1" max="50" step="1"
              className="w-full h-1.5 bg-[#1e2329] rounded-lg appearance-none cursor-pointer accent-yellow-400"
              value={formData.leverage}
              onChange={(e) => setFormData({...formData, leverage: parseInt(e.target.value)})}
            />
          </div>
        </div>

        <button 
          className="w-full bg-yellow-400 text-black font-bold py-4 rounded-2xl mt-8 hover:bg-yellow-300 transition-all flex items-center justify-center gap-2"
          onClick={() => onComplete(formData)}
        >
          <Play size={18} fill="currentColor" />
          Launch Platform
        </button>
      </div>
    </div>
  );
}
