import React, { useState, useEffect } from 'react';
import { ApiClient } from './api/client.js';
import { DashboardView } from './views/DashboardView.js';
import { CoaView } from './views/CoaView.js';
import { JournalsView } from './views/JournalsView.js';
import { TrialBalanceView } from './views/TrialBalanceView.js';
import { FiscalPeriodsView } from './views/FiscalPeriodsView.js';
import { AuditView } from './views/AuditView.js';
import { Badge } from '@omnysync/ui';
import {
  LayoutDashboard,
  Layers,
  BookOpen,
  FileSpreadsheet,
  Calendar,
  ShieldAlert,
  UserCheck,
  Building2,
} from 'lucide-react';

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState('dashboard');
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activePersonaEmail, setActivePersonaEmail] = useState('admin@omnysync.internal');

  const personas = [
    { email: 'admin@omnysync.internal', name: 'Admin', role: 'ADMIN' },
    { email: 'controller@omnysync.internal', name: 'Controller', role: 'CONTROLLER' },
    { email: 'accountant@omnysync.internal', name: 'Accountant', role: 'ACCOUNTANT' },
    { email: 'auditor@omnysync.internal', name: 'Auditor', role: 'AUDITOR' },
    { email: 'viewer@omnysync.internal', name: 'Viewer', role: 'VIEWER' },
  ];

  const loginAsPersona = async (email: string) => {
    setLoading(true);
    try {
      const res = await ApiClient.post('/auth/login', {
        email,
        password: 'Password123!',
      });
      ApiClient.setToken(res.token);
      setCurrentUser(res.user);
      setActivePersonaEmail(email);
    } catch (err) {
      console.error('Login error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loginAsPersona('admin@omnysync.internal');
  }, []);

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'coa', label: 'Chart of Accounts', icon: Layers },
    { id: 'journals', label: 'Journal Vouchers', icon: BookOpen },
    { id: 'trial-balance', label: 'Trial Balance & GL', icon: FileSpreadsheet },
    { id: 'periods', label: 'Fiscal Periods', icon: Calendar },
    { id: 'audit', label: 'Audit Trail', icon: ShieldAlert },
  ];

  return (
    <div className="flex h-screen bg-[#F7F8FC] text-[#182235] font-sans antialiased overflow-hidden">
      {/* Sidebar Navigation */}
      <aside className="w-64 bg-white border-r border-[#D9DFEA] flex flex-col justify-between shrink-0 shadow-xs">
        <div>
          {/* Brand Header */}
          <div className="p-5 border-b border-[#D9DFEA] flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-[#5940B8] flex items-center justify-center text-white font-bold text-base shadow-xs">
              Ω
            </div>
            <div>
              <div className="font-bold text-sm tracking-tight text-[#182235]">OMNYSYNC ERP</div>
              <div className="text-[10px] uppercase font-semibold text-[#5940B8] tracking-wider">Modular Platform</div>
            </div>
          </div>

          {/* Org / Entity Switcher */}
          <div className="p-3 mx-3 mt-3 bg-[#F1F4F9] rounded-lg border border-[#D9DFEA]">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#182235]">
              <Building2 size={14} className="text-[#5940B8]" />
              <span className="truncate">Omnysync Pakistan Pvt</span>
            </div>
            <div className="text-[11px] text-[#5E6A7D] mt-0.5 flex items-center justify-between">
              <span>Karachi HQ (PKR)</span>
              <Badge size="sm" variant="brand">Active</Badge>
            </div>
          </div>

          {/* Navigation Menu */}
          <nav className="p-3 flex flex-col gap-1 mt-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setCurrentTab(item.id)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold transition-all select-none text-left ${
                    isActive
                      ? 'bg-[#F2EEFF] text-[#5940B8] border border-[#d2c7fc]/60'
                      : 'text-[#46536B] hover:bg-[#F1F4F9] hover:text-[#182235]'
                  }`}
                >
                  <Icon size={16} className={isActive ? 'text-[#5940B8]' : 'text-[#5E6A7D]'} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Persona Switcher Footer */}
        <div className="p-4 border-t border-[#D9DFEA] bg-[#F7F8FC]">
          <div className="text-[11px] font-bold text-[#5E6A7D] uppercase tracking-wider mb-2 flex items-center gap-1">
            <UserCheck size={12} /> Test Personas (RBAC)
          </div>
          <div className="flex flex-wrap gap-1">
            {personas.map((p) => (
              <button
                key={p.email}
                onClick={() => loginAsPersona(p.email)}
                className={`px-2 py-1 text-[11px] font-medium rounded transition-colors ${
                  activePersonaEmail === p.email
                    ? 'bg-[#5940B8] text-white font-bold'
                    : 'bg-white border border-[#D9DFEA] text-[#46536B] hover:bg-[#F1F4F9]'
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Top Header Bar */}
        <header className="h-14 bg-white border-b border-[#D9DFEA] px-6 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-[#5E6A7D]">Scope:</span>
            <span className="text-xs font-bold text-[#182235]">Omnysync Global Trading LLC &gt; Omnysync Pakistan Pvt Ltd</span>
            <Badge variant="brand" size="sm">Demo Environment</Badge>
          </div>

          <div className="flex items-center gap-3">
            {currentUser && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-[#5E6A7D]">Logged in as:</span>
                <span className="text-xs font-bold text-[#182235]">{currentUser.name}</span>
                <Badge variant="neutral" size="sm">{currentUser.roles?.[0]}</Badge>
              </div>
            )}
          </div>
        </header>

        {/* Scrollable View Content */}
        <main className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center h-64 text-sm text-[#5E6A7D]">
              <span className="inline-block animate-spin h-5 w-5 border-2 border-[#5940B8] border-t-transparent rounded-full mr-2" />
              Loading ERP platform...
            </div>
          ) : (
            <>
              {currentTab === 'dashboard' && <DashboardView onNavigate={setCurrentTab} />}
              {currentTab === 'coa' && <CoaView />}
              {currentTab === 'journals' && <JournalsView />}
              {currentTab === 'trial-balance' && <TrialBalanceView />}
              {currentTab === 'periods' && <FiscalPeriodsView />}
              {currentTab === 'audit' && <AuditView />}
            </>
          )}
        </main>
      </div>
    </div>
  );
};
