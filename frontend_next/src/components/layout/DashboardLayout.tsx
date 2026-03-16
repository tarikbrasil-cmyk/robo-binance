import Link from "next/link";
import { 
  LayoutDashboard, 
  BarChart2, 
  Settings, 
  History, 
  Activity, 
  LogOut,
  Zap
} from "lucide-react";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen bg-[#0b0e11] text-white">
      {/* Sidebar */}
      <aside className="w-64 border-r border-[#1e2329] bg-[#161a1e] flex flex-col">
        <div className="p-6 flex items-center gap-3">
          <div className="w-8 h-8 bg-yellow-400 rounded-lg flex items-center justify-center">
            <Zap className="text-black w-5 h-5" />
          </div>
          <span className="font-bold text-xl tracking-tight">QuantSaaS</span>
        </div>

        <nav className="flex-1 px-4 space-y-1 mt-4">
          <SidebarItem icon={<LayoutDashboard size={20}/>} label="Dashboard" href="/dashboard" active />
          <SidebarItem icon={<BarChart2 size={20}/>} label="Market Scanner" href="/scanner" />
          <SidebarItem icon={<Activity size={20}/>} label="Live Trading" href="/trading" />
          <SidebarItem icon={<History size={20}/>} label="Trade Logs" href="/history" />
          <SidebarItem icon={<Settings size={20}/>} label="Bot Config" href="/config" />
        </nav>

        <div className="p-4 border-t border-[#1e2329]">
          <button className="flex items-center gap-3 w-full px-4 py-2 text-gray-400 hover:text-white hover:bg-[#1e2329] rounded-lg transition-colors">
            <LogOut size={20} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-[#0b0e11]">
        <header className="h-16 border-b border-[#1e2329] bg-[#161a1e] flex items-center justify-between px-8">
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-400">Total Balance</span>
            <span className="text-xl font-bold font-mono text-yellow-400">$12,450.82</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-end">
              <span className="text-xs text-gray-400 font-medium">Demo Trading</span>
              <span className="text-sm font-semibold text-green-400">Connected</span>
            </div>
            <div className="w-2 h-2 rounded-full bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.5)]"></div>
          </div>
        </header>

        <div className="p-8">
          {children}
        </div>
      </main>
    </div>
  );
}

function SidebarItem({ icon, label, href, active = false }: { icon: React.ReactNode, label: string, href: string, active?: boolean }) {
  return (
    <Link 
      href={href}
      className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${
        active 
        ? "bg-[#1e2329] text-yellow-400 font-medium border border-yellow-400/20" 
        : "text-gray-400 hover:bg-[#1e2329] hover:text-white"
      }`}
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}
