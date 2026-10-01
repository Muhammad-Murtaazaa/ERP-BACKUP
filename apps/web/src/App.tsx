import React, { useState, useEffect, lazy, Suspense } from 'react';
import { MODULE_VIEWS, MODULE_NAV, canSeeModule } from './views/modules/registry.js';
import { ApiClient } from './api/client.js';
import { GlobalSearchModal } from './components/GlobalSearchModal.js';

// Route-level code splitting: each workspace loads on first visit
const DashboardView = lazy(() => import('./views/DashboardView.js').then((m) => ({ default: m.DashboardView })));
const CoaView = lazy(() => import('./views/CoaView.js').then((m) => ({ default: m.CoaView })));
const JournalsView = lazy(() => import('./views/JournalsView.js').then((m) => ({ default: m.JournalsView })));
const TrialBalanceView = lazy(() => import('./views/TrialBalanceView.js').then((m) => ({ default: m.TrialBalanceView })));
const FiscalPeriodsView = lazy(() => import('./views/FiscalPeriodsView.js').then((m) => ({ default: m.FiscalPeriodsView })));
const AuditView = lazy(() => import('./views/AuditView.js').then((m) => ({ default: m.AuditView })));
const PartiesView = lazy(() => import('./views/PartiesView.js').then((m) => ({ default: m.PartiesView })));
const ItemsView = lazy(() => import('./views/ItemsView.js').then((m) => ({ default: m.ItemsView })));
const SalesOrdersView = lazy(() => import('./views/SalesOrdersView.js').then((m) => ({ default: m.SalesOrdersView })));
const ArInvoicesView = lazy(() => import('./views/ArInvoicesView.js').then((m) => ({ default: m.ArInvoicesView })));
const ProcurementOrdersView = lazy(() => import('./views/ProcurementOrdersView.js').then((m) => ({ default: m.ProcurementOrdersView })));
const ApInvoicesView = lazy(() => import('./views/ApInvoicesView.js').then((m) => ({ default: m.ApInvoicesView })));
const PaymentsView = lazy(() => import('./views/PaymentsView.js').then((m) => ({ default: m.PaymentsView })));
const BankReconciliationView = lazy(() => import('./views/BankReconciliationView.js').then((m) => ({ default: m.BankReconciliationView })));
const FxRatesView = lazy(() => import('./views/FxRatesView.js').then((m) => ({ default: m.FxRatesView })));
const OnboardingWizardView = lazy(() => import('./views/OnboardingWizardView.js').then((m) => ({ default: m.OnboardingWizardView })));
const EmployeesView = lazy(() => import('./views/EmployeesView.js').then((m) => ({ default: m.EmployeesView })));
const PayrollView = lazy(() => import('./views/PayrollView.js').then((m) => ({ default: m.PayrollView })));
const WarehouseView = lazy(() => import('./views/WarehouseView.js').then((m) => ({ default: m.WarehouseView })));
const ManufacturingView = lazy(() => import('./views/ManufacturingView.js').then((m) => ({ default: m.ManufacturingView })));
const ProjectsView = lazy(() => import('./views/ProjectsView.js').then((m) => ({ default: m.ProjectsView })));
const FixedAssetsView = lazy(() => import('./views/FixedAssetsView.js').then((m) => ({ default: m.FixedAssetsView })));
const PosTerminalView = lazy(() => import('./views/PosTerminalView.js').then((m) => ({ default: m.PosTerminalView })));
const QualityManagementView = lazy(() => import('./views/QualityManagementView.js').then((m) => ({ default: m.QualityManagementView })));
const PlantMaintenanceView = lazy(() => import('./views/PlantMaintenanceView.js').then((m) => ({ default: m.PlantMaintenanceView })));
const AutomationView = lazy(() => import('./views/AutomationView.js').then((m) => ({ default: m.AutomationView })));

import {
  LayoutDashboard,
  Layers,
  Users,
  ShoppingCart,
  Warehouse as WarehouseIcon,
  Briefcase,
  Store,
  ShieldCheck,
  Wrench,
  PanelLeftOpen,
  Search,
  Plus,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  TrendingUp,
  Headphones,
  Landmark,
  Package,
  Receipt,
  FileText,
  BookOpen,
  UserPlus,
  Truck,
  FileCheck,
  Factory,
  Wallet,
  CreditCard,
  ArrowRightLeft,
  FileSpreadsheet,
  Calendar,
  BellRing,
  Sparkles,
  ShieldAlert,
} from 'lucide-react';

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState('dashboard');
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [dashboardSubTab, setDashboardSubTab] = useState<string>('overview');
  const [dashboardHubExpanded, setDashboardHubExpanded] = useState(true);

  const [branding, setBranding] = useState({
    company_name: 'HVAC ERP',
    legal_entity_name: 'Omnysync Operations Pakistan Pvt Ltd',
    tagline: 'OPERATIONS V2',
    logo_url: '',
    primary_color: '#5940B8',
  });

  const loadBranding = async () => {
    try {
      const b = await ApiClient.get('/config/branding');
      if (b) {
        setBranding({
          company_name: b.company_name || 'HVAC ERP',
          legal_entity_name: b.legal_entity_name || 'Omnysync Operations Pakistan Pvt Ltd',
          tagline: b.tagline || 'OPERATIONS V2',
          logo_url: b.logo_url || '',
          primary_color: b.primary_color || '#5940B8',
        });
      }
    } catch {
      // Fallback
    }
  };

  useEffect(() => {
    loadBranding();
    const handleBrandingUpdated = (e: any) => {
      if (e.detail) {
        setBranding((prev) => ({ ...prev, ...e.detail }));
      } else {
        loadBranding();
      }
    };
    window.addEventListener('omnysync:branding-updated', handleBrandingUpdated);
    return () => window.removeEventListener('omnysync:branding-updated', handleBrandingUpdated);
  }, []);

  // Keyboard shortcut for Universal Search (Ctrl+K or Cmd+K) & Escape to close popovers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchModalOpen((prev) => !prev);
      } else if (e.key === 'Escape') {
        setQuickCreateOpen(false);
        setSearchModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Sidebar: 256px expanded / 68px collapsed.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('omnysync.nav.collapsed');
      if (saved !== null) return saved === '1';
    } catch {}
    return typeof window !== 'undefined' && window.innerWidth < 1024;
  });
  useEffect(() => {
    try {
      localStorage.setItem('omnysync.nav.collapsed', collapsed ? '1' : '0');
    } catch {}
  }, [collapsed]);
  useEffect(() => {
    const mq = window.matchMedia?.('(max-width: 1023px)');
    const onChange = (e: MediaQueryListEvent) => e.matches && setCollapsed(true);
    mq?.addEventListener?.('change', onChange);
    return () => mq?.removeEventListener?.('change', onChange);
  }, []);

  const personas = [
    { email: 'accountant@omnysync.internal', name: 'Fatima Noor', role: 'Chief Financial Accountant' },
    { email: 'admin@omnysync.internal', name: 'Admin User', role: 'System Administrator' },
    { email: 'controller@omnysync.internal', name: 'Controller', role: 'Financial Controller' },
    { email: 'cashier@omnysync.internal', name: 'Cashier', role: 'POS Cashier' },
    { email: 'storemanager@omnysync.internal', name: 'Store Mgr', role: 'Warehouse Manager' },
    { email: 'service@omnysync.internal', name: 'Service Mgr', role: 'Operations Dispatcher' },
    { email: 'tech@omnysync.internal', name: 'Technician', role: 'Field Technician' },
    { email: 'hr@omnysync.internal', name: 'HR Manager', role: 'HR & Workforce Lead' },
    { email: 'auditor@omnysync.internal', name: 'Auditor', role: 'Compliance Auditor' },
  ];

  const loginAsPersona = async (email: string) => {
    setLoading(true);
    try {
      const res = await ApiClient.post('/auth/login', {
        email,
        password: 'Password123!',
      });
      ApiClient.setToken(res.token);
      const selected = personas.find((p) => p.email === email);
      setCurrentUser({
        ...res.user,
        name: selected?.name || res.user.name,
        displayRole: selected?.role || res.user.roles?.[0] || 'Operations Lead',
      });
      loadBranding();
    } catch (err) {
      console.error('Login error:', err);
      // Fallback user object
      const selected = personas.find((p) => p.email === email) || personas[0];
      setCurrentUser({
        name: selected.name,
        email: selected.email,
        roles: ['ACCOUNTANT', 'ADMIN'],
        displayRole: selected.role,
        permissions: ['*'],
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loginAsPersona('accountant@omnysync.internal');
  }, []);

  // Dashboard Hub sub-items
  const dashboardSubItems = [
    { id: 'overview', label: 'Executive Overview', icon: TrendingUp },
    { id: 'technicians', label: 'Technicians & Ops', icon: Wrench },
    { id: 'finance', label: 'Accountants & Finance', icon: Landmark },
    { id: 'purchasing', label: 'Purchasing & Stock', icon: Package },
    { id: 'workforce', label: 'HRM & Workforce', icon: Users },
    { id: 'qa', label: 'Customer Care & QA', icon: Headphones },
  ];

  // Complete, Full ERP Navigation Sections & Original Labels
  const allNavSections = [
    {
      title: 'Trading Masters',
      items: [
        { id: 'parties', label: 'Parties (Cust & Vend)', icon: Users },
        { id: 'items', label: 'Catalog & Valuation', icon: Package },
      ],
    },
    {
      title: 'Order-to-Cash',
      items: [
        { id: 'sales-orders', label: 'Sales Orders', icon: ShoppingCart, hasChevron: true },
        { id: 'pos', label: 'Retail POS Terminal', icon: Store },
        { id: 'ar-invoices', label: 'AR Customer Invoices', icon: Receipt },
      ],
    },
    {
      title: 'Procure-to-Pay',
      items: [
        { id: 'procurement', label: 'Purchase Orders', icon: Truck, hasDot: true, hasChevron: true },
        { id: 'ap-invoices', label: 'AP Supplier Bills', icon: FileCheck },
      ],
    },
    {
      title: 'Supply Chain & Manufacturing',
      items: [
        { id: 'warehouses', label: 'Warehouses & Logistics', icon: WarehouseIcon },
        { id: 'manufacturing', label: 'Manufacturing & Assembly', icon: Factory },
      ],
    },
    {
      title: 'Plant & Quality',
      items: [
        { id: 'quality', label: 'Quality & Inspection (QM)', icon: ShieldCheck },
        { id: 'maintenance', label: 'Plant Maintenance (PM)', icon: Wrench },
      ],
    },
    {
      title: 'Projects & Contracts',
      items: [
        { id: 'projects', label: 'Projects, BOQ & IPC', icon: Briefcase },
      ],
    },
    {
      title: 'Workforce & Payroll',
      items: [
        { id: 'employees', label: 'Workforce & HRM', icon: Users, hasChevron: true },
        { id: 'payroll', label: 'Payroll & Disbursals', icon: Wallet },
      ],
    },
    {
      title: 'Treasury & Finance',
      items: [
        { id: 'payments', label: 'Payments & Allocations', icon: CreditCard },
        { id: 'assets', label: 'Fixed Assets Register', icon: Landmark },
        { id: 'treasury-reconciliation', label: 'Bank Reconciliation', icon: Landmark },
        { id: 'fx-rates', label: 'FX & Exchange Rates', icon: ArrowRightLeft },
        { id: 'journals', label: 'Journal Vouchers', icon: BookOpen },
        { id: 'trial-balance', label: 'Trial Balance & GL', icon: FileSpreadsheet },
        { id: 'coa', label: 'Chart of Accounts', icon: Layers, hasChevron: true },
        { id: 'periods', label: 'Fiscal Periods', icon: Calendar },
      ],
    },
    ...MODULE_NAV,
    {
      title: 'Setup & Governance',
      items: [
        { id: 'automation', label: 'Automation & Alerts', icon: BellRing },
        { id: 'onboarding', label: 'Onboarding & Templates', icon: Sparkles },
        { id: 'audit', label: 'Audit & Rollbacks', icon: ShieldAlert },
      ],
    },
  ];

  const handleNavigate = (tabId: string, subTab?: string) => {
    setCurrentTab(tabId);
    if (subTab) {
      setDashboardSubTab(subTab);
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#F8FAFC] text-[#182235] font-sans antialiased overflow-hidden select-none">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2 focus:bg-white focus:text-[#5940B8] focus:rounded-md focus:outline focus:outline-2 focus:outline-[#5940B8]"
      >
        Skip to content
      </a>

      {/* ========================================================================= */}
      {/* 1. TOP HEADER BAR (Light Theme)                                           */}
      {/* ========================================================================= */}
      <header className="h-16 bg-white border-b border-zinc-200/80 px-4 md:px-6 flex items-center justify-between gap-4 shrink-0 z-30 shadow-2xs">
        {/* Brand & Logo on Top Left */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="min-w-0">
            <div className="text-zinc-900 font-extrabold text-sm tracking-tight leading-tight truncate">
              {branding.company_name || 'HVAC ERP'}
            </div>
            <div className="text-[10px] font-mono font-bold tracking-widest text-[#5940B8] uppercase leading-none mt-0.5">
              {branding.tagline || 'OPERATIONS V2'}
            </div>
          </div>
        </div>

        {/* Center: Wide Search Bar Pill + Purple Plus Action */}
        <div className="flex-1 max-w-xl mx-4 flex items-center gap-2.5 relative">
          <button
            type="button"
            onClick={() => setSearchModalOpen(true)}
            className="flex-1 flex items-center justify-between px-4 py-2 rounded-full bg-zinc-100/80 hover:bg-zinc-200/60 border border-zinc-200 text-xs text-zinc-600 hover:text-zinc-900 transition shadow-2xs group cursor-pointer"
          >
            <div className="flex items-center gap-2.5 truncate">
              <Search size={14} className="text-zinc-400 group-hover:text-[#5940B8] transition-colors shrink-0" />
              <span className="truncate">Find or Ask... (Jobs, customers, techs, invoices)</span>
            </div>
            <kbd className="text-[10px] font-mono bg-white border border-zinc-200 px-1.5 py-0.5 rounded text-zinc-500 font-bold shrink-0 ml-2 shadow-2xs">
              ⌘K
            </kbd>
          </button>

          {/* Quick Create Button & Popover */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setQuickCreateOpen((q) => !q)}
              title="Create New Invoice, Quote, Job or Voucher"
              aria-expanded={quickCreateOpen}
              className="h-8 w-8 rounded-full bg-[#5940B8] hover:bg-[#463091] text-white flex items-center justify-center font-bold text-base shadow-xs hover:shadow transition-all shrink-0 cursor-pointer focus:outline focus:outline-2 focus:outline-[#5940B8]"
            >
              <Plus size={16} className={`transition-transform duration-200 ${quickCreateOpen ? 'rotate-45' : ''}`} />
            </button>

            {quickCreateOpen && (
              <>
                {/* Backdrop to dismiss when clicking anywhere outside */}
                <div
                  className="fixed inset-0 z-40 bg-black/5"
                  onClick={() => setQuickCreateOpen(false)}
                  aria-hidden="true"
                />

                <div className="absolute right-0 top-full mt-2 w-80 max-h-[calc(100vh-5.5rem)] overflow-y-auto rounded-2xl bg-white border border-zinc-200/90 shadow-2xl p-2 z-50 animate-in fade-in zoom-in-95 duration-150">
                  <div className="px-3 py-2 border-b border-zinc-100 flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-zinc-900 tracking-tight">Quick Create Document</span>
                    <span className="text-[10px] font-mono font-bold uppercase px-1.5 py-0.5 rounded bg-purple-50 text-[#5940B8] border border-purple-200/60">ERP Action</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        handleNavigate('ar-invoices');
                        setQuickCreateOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl text-xs hover:bg-purple-50 hover:text-[#5940B8] transition flex items-center gap-3 cursor-pointer group"
                    >
                      <div className="h-8 w-8 rounded-lg bg-purple-50 text-[#5940B8] group-hover:bg-[#5940B8] group-hover:text-white transition-colors flex items-center justify-center shrink-0">
                        <Receipt size={16} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-zinc-900 group-hover:text-[#5940B8] truncate">New Tax Invoice (AR)</div>
                        <div className="text-[11px] text-zinc-500 truncate">Post customer bill with line items & tax</div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        handleNavigate('sales-orders');
                        setQuickCreateOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl text-xs hover:bg-purple-50 hover:text-[#5940B8] transition flex items-center gap-3 cursor-pointer group"
                    >
                      <div className="h-8 w-8 rounded-lg bg-purple-50 text-[#5940B8] group-hover:bg-[#5940B8] group-hover:text-white transition-colors flex items-center justify-center shrink-0">
                        <FileText size={16} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-zinc-900 group-hover:text-[#5940B8] truncate">New Quote & Sales Order</div>
                        <div className="text-[11px] text-zinc-500 truncate">Create customer quote / job intake</div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        handleNavigate('pos');
                        setQuickCreateOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl text-xs hover:bg-purple-50 hover:text-[#5940B8] transition flex items-center gap-3 cursor-pointer group"
                    >
                      <div className="h-8 w-8 rounded-lg bg-purple-50 text-[#5940B8] group-hover:bg-[#5940B8] group-hover:text-white transition-colors flex items-center justify-center shrink-0">
                        <Store size={16} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-zinc-900 group-hover:text-[#5940B8] truncate">New Retail POS Sale</div>
                        <div className="text-[11px] text-zinc-500 truncate">Counter barcode checkout & receipt</div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        handleNavigate('procurement');
                        setQuickCreateOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl text-xs hover:bg-purple-50 hover:text-[#5940B8] transition flex items-center gap-3 cursor-pointer group"
                    >
                      <div className="h-8 w-8 rounded-lg bg-purple-50 text-[#5940B8] group-hover:bg-[#5940B8] group-hover:text-white transition-colors flex items-center justify-center shrink-0">
                        <ShoppingCart size={16} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-zinc-900 group-hover:text-[#5940B8] truncate">New Purchase Order (PO)</div>
                        <div className="text-[11px] text-zinc-500 truncate">Issue supplier procurement order</div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        handleNavigate('journals');
                        setQuickCreateOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl text-xs hover:bg-purple-50 hover:text-[#5940B8] transition flex items-center gap-3 cursor-pointer group"
                    >
                      <div className="h-8 w-8 rounded-lg bg-purple-50 text-[#5940B8] group-hover:bg-[#5940B8] group-hover:text-white transition-colors flex items-center justify-center shrink-0">
                        <BookOpen size={16} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-zinc-900 group-hover:text-[#5940B8] truncate">Manual Journal Voucher</div>
                        <div className="text-[11px] text-zinc-500 truncate">Post debit/credit ledger voucher</div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        handleNavigate('parties');
                        setQuickCreateOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl text-xs hover:bg-purple-50 hover:text-[#5940B8] transition flex items-center gap-3 cursor-pointer group"
                    >
                      <div className="h-8 w-8 rounded-lg bg-purple-50 text-[#5940B8] group-hover:bg-[#5940B8] group-hover:text-white transition-colors flex items-center justify-center shrink-0">
                        <UserPlus size={16} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-zinc-900 group-hover:text-[#5940B8] truncate">New Customer / Vendor</div>
                        <div className="text-[11px] text-zinc-500 truncate">Add commercial account & tax ID</div>
                      </div>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right side placeholder */}
        <div className="flex items-center gap-2 shrink-0"></div>
      </header>

      {/* ========================================================================= */}
      {/* 2. BODY SHELL: LIGHT SIDEBAR + MAIN PANEL                                 */}
      {/* ========================================================================= */}
      <div className="flex flex-1 min-h-0 overflow-hidden bg-[#F8FAFC]">
        {/* Light Sidebar */}
        <aside
          aria-label="Primary"
          className={`${
            collapsed ? 'w-20' : 'w-64'
          } bg-white border-r border-zinc-200/80 text-zinc-700 flex flex-col justify-between shrink-0 transition-all duration-200 z-20 select-none pb-3 shadow-xs`}
        >
          <div className="overflow-y-auto overflow-x-hidden flex-1 flex flex-col px-3 pt-3 space-y-4">
            {/* Top Category: Dashboards Hub */}
            <div>
              <button
                type="button"
                onClick={() => {
                  if (collapsed) {
                    handleNavigate('dashboard', 'overview');
                  } else {
                    setDashboardHubExpanded((prev) => !prev);
                  }
                }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                  currentTab === 'dashboard' ? 'text-zinc-900 bg-zinc-100/80' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100/60'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <LayoutDashboard size={16} className={currentTab === 'dashboard' ? 'text-[#5940B8]' : 'text-zinc-500'} />
                  {!collapsed && <span className="text-sm font-bold text-zinc-900 tracking-tight">Dashboards Hub</span>}
                </div>
                {!collapsed && (
                  <ChevronDown
                    size={14}
                    className={`text-zinc-400 transition-transform duration-150 ${dashboardHubExpanded ? '' : '-rotate-90'}`}
                  />
                )}
              </button>

              {/* Sub-items for Dashboards Hub with connecting vertical line */}
              {!collapsed && dashboardHubExpanded && (
                <div className="ml-3 pl-3 border-l border-zinc-200 mt-1 flex flex-col gap-1">
                  {dashboardSubItems.map((sub) => {
                    const Icon = sub.icon;
                    const isSubActive = currentTab === 'dashboard' && dashboardSubTab === sub.id;
                    return (
                      <button
                        key={sub.id}
                        type="button"
                        onClick={() => handleNavigate('dashboard', sub.id)}
                        className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-xl text-xs transition cursor-pointer text-left ${
                          isSubActive
                            ? 'bg-[#5940B8] text-white font-bold shadow-xs'
                            : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100/70'
                        }`}
                      >
                        <Icon size={14} className={isSubActive ? 'text-white' : 'text-zinc-500'} />
                        <span className="truncate">{sub.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* All ERP Navigation Categories */}
            {allNavSections
              .map((sec) => ({
                ...sec,
                items: sec.items.filter((item) => canSeeModule(item.id, currentUser?.permissions)),
              }))
              .filter((sec) => sec.items.length > 0)
              .map((sec, sIdx) => (
                <div key={sIdx} className="flex flex-col gap-1">
                  {!collapsed ? (
                    <div className="text-[10px] font-mono font-bold text-zinc-400 uppercase tracking-wider px-3 mb-1">
                      {sec.title}
                    </div>
                  ) : (
                    <div className="mx-2 my-1 border-t border-zinc-200" />
                  )}

                  <div className="flex flex-col gap-0.5">
                    {sec.items.map((item: any) => {
                      const Icon = item.icon;
                      const isActive = currentTab === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => handleNavigate(item.id)}
                          title={collapsed ? item.label : undefined}
                          className={`flex items-center gap-2.5 min-h-9 text-xs transition cursor-pointer select-none ${
                            collapsed ? 'justify-center px-0 rounded-xl' : 'px-3 justify-between rounded-xl'
                          } ${
                            isActive
                              ? 'bg-purple-50 text-purple-900 font-bold border-l-2 border-[#5940B8] rounded-l-none'
                              : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Icon size={16} className={isActive ? 'text-[#5940B8]' : 'text-zinc-400'} />
                            {!collapsed && <span className="truncate font-medium">{item.label}</span>}
                          </div>

                          {!collapsed && (
                            <div className="flex items-center gap-1.5 shrink-0 text-zinc-400">
                              {item.hasDot && <span className="h-1.5 w-1.5 rounded-full bg-[#5940B8]" />}
                              {item.hasChevron && <ChevronRight size={14} />}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
          </div>

          {/* Bottom Sidebar Controls */}
          <div className="px-3 pt-2 border-t border-zinc-200/80 flex flex-col gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 transition cursor-pointer ${
                collapsed ? 'justify-center' : ''
              }`}
            >
              {collapsed ? (
                <PanelLeftOpen size={16} />
              ) : (
                <>
                  <ChevronLeft size={16} />
                  <span className="font-medium">Collapse Sidebar</span>
                </>
              )}
            </button>
          </div>
        </aside>

        {/* ========================================================================= */}
        {/* 3. MAIN CONTENT CONTAINER (Clean Light Canvas)                            */}
        {/* ========================================================================= */}
        <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden bg-[#F8FAFC]">
          <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-7 focus:outline-none">
            {loading ? (
              <div role="status" className="flex items-center justify-center h-64 text-sm text-[#5E6A7D]">
                <span className="inline-block animate-spin h-5 w-5 border-2 border-[#5940B8] border-t-transparent rounded-full mr-2" />
                Synchronizing ERP Operations...
              </div>
            ) : (
              <Suspense
                fallback={
                  <div role="status" className="flex items-center justify-center h-64 text-sm text-[#5E6A7D]">
                    <span className="inline-block animate-spin h-5 w-5 border-2 border-[#5940B8] border-t-transparent rounded-full mr-2" />
                    Loading workspace…
                  </div>
                }
              >
                {currentTab === 'dashboard' && (
                  <DashboardView
                    onNavigate={(tab) => handleNavigate(tab)}
                    activeTabProp={dashboardSubTab}
                    onTabChange={(tab) => setDashboardSubTab(tab)}
                  />
                )}
                {currentTab === 'pos' && <PosTerminalView />}
                {currentTab === 'parties' && <PartiesView />}
                {currentTab === 'items' && <ItemsView />}
                {currentTab === 'sales-orders' && <SalesOrdersView />}
                {currentTab === 'ar-invoices' && <ArInvoicesView />}
                {currentTab === 'procurement' && <ProcurementOrdersView />}
                {currentTab === 'ap-invoices' && <ApInvoicesView />}
                {currentTab === 'warehouses' && <WarehouseView />}
                {currentTab === 'manufacturing' && <ManufacturingView />}
                {currentTab === 'quality' && <QualityManagementView />}
                {currentTab === 'maintenance' && <PlantMaintenanceView />}
                {currentTab === 'projects' && <ProjectsView />}
                {currentTab === 'assets' && <FixedAssetsView />}
                {currentTab === 'employees' && <EmployeesView />}
                {currentTab === 'payroll' && <PayrollView />}
                {currentTab === 'payments' && <PaymentsView />}
                {currentTab === 'treasury-reconciliation' && <BankReconciliationView />}
                {currentTab === 'fx-rates' && <FxRatesView />}
                {currentTab === 'automation' && <AutomationView />}
                {currentTab === 'onboarding' && <OnboardingWizardView />}
                {currentTab === 'journals' && <JournalsView />}
                {currentTab === 'trial-balance' && <TrialBalanceView />}
                {currentTab === 'coa' && <CoaView />}
                {currentTab === 'periods' && <FiscalPeriodsView />}
                {currentTab === 'audit' && <AuditView />}
                {MODULE_VIEWS[currentTab] && React.createElement(MODULE_VIEWS[currentTab])}
              </Suspense>
            )}
          </main>
        </div>
      </div>

      {/* Universal Search Modal (Ctrl+K) */}
      <GlobalSearchModal
        isOpen={searchModalOpen}
        onClose={() => setSearchModalOpen(false)}
        onNavigate={(tabId) => handleNavigate(tabId)}
      />
    </div>
  );
};
