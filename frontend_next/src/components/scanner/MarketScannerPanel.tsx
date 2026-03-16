"use client";

import { 
  Zap, 
  TrendingUp, 
  BarChart3, 
  Search,
  ChevronRight
} from "lucide-react";

interface Opportunity {
  symbol: string;
  change: string;
  volume: string;
  price: number;
  score: number;
}

export default function MarketScannerPanel({ opportunities = [] }: { opportunities?: Opportunity[] }) {
  return (
    <div className="bg-[#161a1e] border border-[#1e2329] rounded-2xl shadow-sm overflow-hidden">
      <div className="p-6 border-b border-[#1e2329] flex justify-between items-center bg-[#1a1e23]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-purple-400/10 rounded-lg flex items-center justify-center">
            <Search className="text-purple-400 w-5 h-5" />
          </div>
          <h3 className="text-lg font-bold">Top Market Opportunities</h3>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Clock size={14} />
          <span>Real-time Scan</span>
        </div>
      </div>

      <div className="divide-y divide-[#1e2329]">
        {opportunities.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm italic">
            Scanning for opportunities...
          </div>
        ) : (
          opportunities.map((opp, index) => (
            <div key={opp.symbol} className="p-4 hover:bg-[#1e2329]/50 transition-all cursor-pointer group">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <span className="text-lg font-bold text-gray-600 font-mono w-4">{index + 1}</span>
                  <div className="flex flex-col">
                    <span className="font-bold text-white group-hover:text-yellow-400 transition-colors uppercase">{opp.symbol}</span>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-gray-500 font-bold uppercase">Vol {opp.volume}</span>
                      <span className="w-1 h-1 rounded-full bg-gray-700"></span>
                      <span className={`text-[10px] font-bold ${opp.change.startsWith('+') ? 'text-green-400' : 'text-red-400'}`}>
                        {opp.change}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <span className="text-xs text-gray-500 font-medium block mb-1">Score</span>
                    <span className="text-sm font-bold font-mono text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded-md">
                      {opp.score.toFixed(1)}
                    </span>
                  </div>
                  <ChevronRight size={20} className="text-gray-600 group-hover:text-white transition-colors" />
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="p-4 bg-[#1a1e23] text-center">
        <button className="text-xs font-bold text-gray-400 hover:text-white transition-colors flex items-center justify-center gap-2 w-full">
          <BarChart3 size={14} />
          View All Futures Markets
        </button>
      </div>
    </div>
  );
}

function Clock({ size, className }: { size?: number, className?: string }) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      className={className}
    >
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  );
}
