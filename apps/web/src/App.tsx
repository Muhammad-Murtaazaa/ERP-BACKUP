import React, { useState, useEffect, lazy, Suspense } from 'react';
import { MODULE_VIEWS, MODULE_NAV, canSeeModule } from './views/modules/registry.js';
import { ApiClient } from './api/client.js';
import { Badge } from '@omnysync/ui';

// Route-level code splitting: each workspace loads on first visit (clears the 500 kB chunk warning).
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
  BookOpen,
  FileSpreadsheet,
  Calendar,
  ShieldAlert,
  UserCheck,
  Building2,
  Users,
  Package,
  ShoppingCart,
  Receipt,
  Truck,
  FileCheck,
  CreditCard,
  Landmark,
  ArrowRightLeft,
  Sparkles,
  Wallet,
  Warehouse as WarehouseIcon,
  Factory,
  Briefcase,
  Store,
  ShieldCheck,
  Wrench,
  BellRing,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState('dashboard');
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activePersonaEmail, setActivePersonaEmail] = useState('admin@omnysync.internal');
  // Sidebar: 240px expanded / 64px collapsed (design-system.md §Navigation). Persisted; auto-collapses on narrow screens.
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
    { email: 'admin@omnysync.internal', name: 'Admin', role: 'ADMIN' },
    { email: 'controller@omnysync.internal', name: 'Controller', role: 'CONTROLLER' },
    { email: 'accountant@omnysync.internal', name: 'Accountant', role: 'ACCOUNTANT' },
    { email: 'cashier@omnysync.internal', name: 'Cashier', role: 'CASHIER' },
    { email: 'storemanager@omnysync.internal', name: 'Store Mgr', role: 'STORE_MANAGER' },
    { email: 'service@omnysync.internal', name: 'Service Mgr', role: 'SERVICE_MANAGER' },
    { email: 'tech@omnysync.internal', name: 'Technician', role: 'TECHNICIAN' },
    { email: 'hr@omnysync.internal', name: 'HR', role: 'HR_MANAGER' },
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

  const navSections = [
    {
      title: 'Overview',
      items: [{ id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }],
    },
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
        { id: 'pos', label: 'Retail POS Terminal', icon: Store },
        { id: 'sales-orders', label: 'Sales Orders', icon: ShoppingCart },
        { id: 'ar-invoices', label: 'AR Customer Invoices', icon: Receipt },
      ],
    },
    {
      title: 'Procure-to-Pay',
      items: [
        { id: 'procurement', label: 'Purchase Orders', icon: Truck },
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
        { id: 'employees', label: 'Workforce & HRM', icon: Users },
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
        { id: 'coa', label: 'Chart of Accounts', icon: Layers },
        { id: 'periods', label: 'Fiscal Periods', icon: Calendar },
      ],
    },
    ...MODULE_NAV,
    {
      title: 'Setup & Governance',
      items: [
        { id: 'automation', label: 'Automation & Alerts', icon: BellRing },
        { id: 'onboarding', label: 'Onboarding & Templates', icon: Sparkles },
        { id: 'audit', label: 'Audit Trail', icon: ShieldAlert },
      ],
    },
  ];

  return (
    <div className="flex h-screen bg-[#F7F8FC] text-[#182235] font-sans antialiased overflow-hidden">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2 focus:bg-white focus:text-[#5940B8] focus:rounded-md focus:outline focus:outline-2 focus:outline-[#5B3CC4]"
      >
        Skip to content
      </a>
      {/* Sidebar Navigation: 240 expanded / 64 collapsed */}
      <aside
        aria-label="Primary"
        className={`${collapsed ? 'w-16' : 'w-60'} bg-white border-r border-[#D9DFEA] flex flex-col justify-between shrink-0 transition-[width] duration-150`}
      >
        <div className="overflow-y-auto overflow-x-hidden">
          {/* Brand Header (56px, aligned with the top bar) */}
          <div className={`h-14 border-b border-[#D9DFEA] flex items-center gap-3 ${collapsed ? 'justify-center px-2' : 'px-4'}`}>
            <div className="h-8 w-8 rounded-md bg-[#5940B8] flex items-center justify-center text-white font-bold text-base shrink-0" aria-hidden="true">
              Ω
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <div className="font-bold text-sm tracking-tight text-[#182235]">OMNYSYNC ERP</div>
                <div className="text-[11px] uppercase font-semibold text-[#5940B8] tracking-wider">Modular Platform</div>
              </div>
            )}
          </div>

          {/* Org / Entity Switcher */}
          {!collapsed && (
            <div className="p-3 mx-3 mt-3 bg-[#F1F4F9] rounded-[10px] border border-[#D9DFEA]">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#182235]">
                <Building2 size={14} className="text-[#5940B8]" aria-hidden="true" />
                <span className="truncate">Omnysync Pakistan Pvt</span>
              </div>
              <div className="text-xs text-[#5E6A7D] mt-1 flex items-center justify-between">
                <span>Karachi HQ (PKR)</span>
                <Badge size="sm" variant="brand">Active</Badge>
              </div>
            </div>
          )}

          {/* Navigation Sections */}
          <nav aria-label="Modules" className={`${collapsed ? 'px-2 py-3' : 'p-3'} flex flex-col gap-4`}>
            {navSections
              .map((sec) => ({ ...sec, items: sec.items.filter((it: any) => canSeeModule(it.id, currentUser?.permissions)) }))
              .filter((sec) => sec.items.length > 0)
              .map((sec, sIdx) => (
              <div key={sIdx} role="group" aria-labelledby={collapsed ? undefined : `nav-sec-${sIdx}`} aria-label={collapsed ? sec.title : undefined}>
                {!collapsed ? (
                  <div id={`nav-sec-${sIdx}`} className="text-[11px] font-bold text-[#5E6A7D] uppercase tracking-wider px-2 mb-1">
                    {sec.title}
                  </div>
                ) : (
                  sIdx > 0 && <div className="mx-2 mb-2 border-t border-[#D9DFEA]" aria-hidden="true" />
                )}
                <div className="flex flex-col gap-0.5">
                  {sec.items.map((item) => {
                    const Icon = item.icon;
                    const isActive = currentTab === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setCurrentTab(item.id)}
                        aria-current={isActive ? 'page' : undefined}
                        title={collapsed ? item.label : undefined}
                        aria-label={collapsed ? item.label : undefined}
                        className={`flex items-center gap-2.5 min-h-9 rounded-md text-[13px] font-semibold transition-colors select-none text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#5B3CC4] ${
                          collapsed ? 'justify-center px-0' : 'px-2.5'
                        } ${
                          isActive
                            ? 'bg-[#F2EEFF] text-[#5940B8] shadow-[inset_3px_0_0_#5940B8]'
                            : 'text-[#46536B] hover:bg-[#F1F4F9] hover:text-[#182235]'
                        }`}
                      >
                        <Icon size={16} className={`shrink-0 ${isActive ? 'text-[#5940B8]' : 'text-[#5E6A7D]'}`} aria-hidden="true" />
                        {!collapsed && <span className="truncate">{item.label}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </div>

        {/* Persona Switcher Footer */}
        <div className={`border-t border-[#D9DFEA] bg-[#F7F8FC] shrink-0 ${collapsed ? 'p-2' : 'p-3'}`}>
          {!collapsed ? (
            <>
              <div id="persona-label" className="text-[11px] font-bold text-[#5E6A7D] uppercase tracking-wider mb-1.5 flex items-center gap-1">
                <UserCheck size={12} aria-hidden="true" /> Test Personas (RBAC)
              </div>
              <div className="flex flex-wrap gap-1" role="group" aria-labelledby="persona-label">
                {personas.map((p) => (
                  <button
                    key={p.email}
                    type="button"
                    onClick={() => loginAsPersona(p.email)}
                    aria-pressed={activePersonaEmail === p.email}
                    className={`px-2 min-h-6 text-[11px] font-medium rounded-md transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#5B3CC4] ${
                      activePersonaEmail === p.email
                        ? 'bg-[#5940B8] text-white font-bold'
                        : 'bg-white border border-[#D9DFEA] text-[#46536B] hover:bg-[#F1F4F9]'
                    }`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="flex justify-center" title="Expand the sidebar to switch persona">
              <UserCheck size={16} className="text-[#5E6A7D]" aria-hidden="true" />
            </div>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col h-screen overflow-hidden">
        {/* Top Header Bar (56px) */}
        <header className="h-14 bg-white border-b border-[#D9DFEA] px-4 md:px-6 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!collapsed}
              className="h-9 w-9 inline-flex items-center justify-center rounded-md text-[#46536B] hover:bg-[#F1F4F9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5B3CC4] shrink-0"
            >
              {collapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
            </button>
            <span className="hidden md:inline text-xs font-semibold text-[#5E6A7D]">Scope:</span>
            <span className="text-xs font-bold text-[#182235] truncate">Omnysync Global Trading LLC &gt; Omnysync Pakistan Pvt Ltd</span>
            <Badge variant="brand" size="sm" className="hidden sm:inline-flex">Demo Environment</Badge>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {currentUser && (
              <div className="flex items-center gap-2">
                <span className="hidden lg:inline text-xs text-[#5E6A7D]">Logged in as:</span>
                <span className="text-xs font-bold text-[#182235]">{currentUser.name}</span>
                <Badge variant="neutral" size="sm">{currentUser.roles?.[0]}</Badge>
              </div>
            )}
          </div>
        </header>

        {/* Scrollable View Content */}
        <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto p-4 md:p-6 focus:outline-none">
          {loading ? (
            <div role="status" className="flex items-center justify-center h-64 text-sm text-[#5E6A7D]">
              <span className="inline-block animate-spin h-5 w-5 border-2 border-[#5940B8] border-t-transparent rounded-full mr-2" />
              Loading ERP platform...
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
              {currentTab === 'dashboard' && <DashboardView onNavigate={setCurrentTab} />}
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
  );
};
