import React, { useState, useEffect, lazy, Suspense } from 'react';
import { MODULE_VIEWS, MODULE_NAV, canSeeModule } from './views/modules/registry.js';
import { ApiClient } from './api/client.js';
import { GlobalSearchModal } from './components/GlobalSearchModal.js';
import {
  AgentComposer,
  AgentMessage,
  AgentMark,
  type AgentMessageStep,
} from '@omnysync/ui';

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
  Search,
  Plus,
  ChevronRight,
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
  Sun,
  Moon,
  Grid,
  X,
  Radio,
  Clock,
  Sparkle,
} from 'lucide-react';

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState('dashboard');
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [dashboardSubTab, setDashboardSubTab] = useState<string>('overview');
  const [sidebarExpanded, setSidebarExpanded] = useState<boolean>(true);
  const [agentDrawerOpen, setAgentDrawerOpen] = useState<boolean>(false);

  // Tectonic Theme: 'dark' (Signature #0b0b0b canvas, lime #9df747) or 'light' (#f2f2ef canvas)
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      const saved = localStorage.getItem('tectonic.theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {}
    return 'dark'; // Tectonic default: "Black canvas, one lime"
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('tectonic.theme', theme);
    } catch {}
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const [branding, setBranding] = useState({
    company_name: 'TECTONIC ERP',
    legal_entity_name: 'Omnysync Operations Pakistan Pvt Ltd',
    tagline: 'ENTERPRISE OPERATING SYSTEM',
    logo_url: '',
    primary_color: '#9df747',
  });

  const loadBranding = async () => {
    try {
      const b = await ApiClient.get('/config/branding');
      if (b) {
        setBranding({
          company_name: b.company_name || 'TECTONIC ERP',
          legal_entity_name: b.legal_entity_name || 'Omnysync Operations Pakistan Pvt Ltd',
          tagline: b.tagline || 'ENTERPRISE OPERATING SYSTEM',
          logo_url: b.logo_url || '',
          primary_color: b.primary_color || '#9df747',
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
        setAgentDrawerOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
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
    loginAsPersona('admin@omnysync.internal');
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

  // Primary Suite categories for SideRail
  const suiteRails = [
    { id: 'dashboard', label: 'Dashboards', icon: LayoutDashboard },
    { id: 'trading', label: 'Trading & O2C', icon: ShoppingCart },
    { id: 'procurement-suite', label: 'Procurement & P2P', icon: Truck },
    { id: 'logistics', label: 'Inventory & Warehousing', icon: WarehouseIcon },
    { id: 'mfg-suite', label: 'Manufacturing & Assembly', icon: Factory },
    { id: 'quality-maintenance', label: 'Plant & Quality', icon: Wrench },
    { id: 'projects-suite', label: 'Projects & BOQ', icon: Briefcase },
    { id: 'workforce-suite', label: 'Workforce & Payroll', icon: Users },
    { id: 'finance-suite', label: 'Treasury & GL', icon: Landmark },
    { id: 'governance', label: 'Governance & Setup', icon: ShieldAlert },
  ];

  // All ERP Navigation Sections
  const allNavSections = [
    {
      title: 'Trading Masters',
      suite: 'trading',
      items: [
        { id: 'parties', label: 'Parties (Cust & Vend)', icon: Users },
        { id: 'items', label: 'Catalog & Valuation', icon: Package },
      ],
    },
    {
      title: 'Order-to-Cash',
      suite: 'trading',
      items: [
        { id: 'sales-orders', label: 'Sales Orders', icon: ShoppingCart, hasChevron: true },
        { id: 'pos', label: 'Retail POS Terminal', icon: Store },
        { id: 'ar-invoices', label: 'AR Customer Invoices', icon: Receipt },
      ],
    },
    {
      title: 'Procure-to-Pay',
      suite: 'procurement-suite',
      items: [
        { id: 'procurement', label: 'Purchase Orders (PO)', icon: Truck, hasDot: true, hasChevron: true },
        { id: 'ap-invoices', label: 'AP Supplier Bills', icon: FileCheck },
      ],
    },
    {
      title: 'Supply Chain & Manufacturing',
      suite: 'logistics',
      items: [
        { id: 'warehouses', label: 'Warehouses & Logistics', icon: WarehouseIcon },
        { id: 'manufacturing', label: 'Manufacturing & Assembly', icon: Factory },
      ],
    },
    {
      title: 'Plant & Quality',
      suite: 'quality-maintenance',
      items: [
        { id: 'quality', label: 'Quality & Inspection (QM)', icon: ShieldCheck },
        { id: 'maintenance', label: 'Plant Maintenance (PM)', icon: Wrench },
      ],
    },
    {
      title: 'Projects & Contracts',
      suite: 'projects-suite',
      items: [
        { id: 'projects', label: 'Projects, BOQ & IPC', icon: Briefcase },
      ],
    },
    {
      title: 'Workforce & Payroll',
      suite: 'workforce-suite',
      items: [
        { id: 'employees', label: 'Workforce & HRM', icon: Users, hasChevron: true },
        { id: 'payroll', label: 'Payroll & Disbursals', icon: Wallet },
      ],
    },
    {
      title: 'Treasury & Finance',
      suite: 'finance-suite',
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
      suite: 'governance',
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

  // Find active rail suite based on current tab
  const getActiveSuite = (): string => {
    if (currentTab === 'dashboard') return 'dashboard';
    const found = allNavSections.find((sec) => sec.items.some((i) => i.id === currentTab));
    return found?.suite || 'dashboard';
  };
  const activeSuite = getActiveSuite();

  // Agent chat state
  const [agentMessages, setAgentMessages] = useState<Array<{
    id: string;
    role: 'user' | 'agent';
    content: string;
    timestamp: string;
    steps?: AgentMessageStep[];
  }>>([
    {
      id: 'msg-init',
      role: 'agent',
      content: 'Tectonic Agent initialized. I can post journal vouchers, verify subcontractor BOQ claims, check warehouse valuation, or draft procurement orders.',
      timestamp: 'Just now',
      steps: [
        { label: 'Fiscal period status: Locked check passed', completed: true },
        { label: 'Dual-currency ledger calibrated: PKR / USD', completed: true },
        { label: 'Subcontractor IPC limits validated', completed: true },
      ],
    },
  ]);
  const [agentBusy, setAgentBusy] = useState(false);

  const handleAgentSend = (prompt: string) => {
    if (!prompt.trim()) return;
    const userMsg = {
      id: `u-${Date.now()}`,
      role: 'user' as const,
      content: prompt,
      timestamp: 'Just now',
    };
    setAgentMessages((prev) => [...prev, userMsg]);
    setAgentBusy(true);

    setTimeout(() => {
      const lower = prompt.toLowerCase();
      let reply = "Action executed under authorized audit trail. Transaction logged with correlation ID.";
      let steps: AgentMessageStep[] = [
        { label: 'Validated tenant organization scope', completed: true },
        { label: 'Verified period lock and account permissions', completed: true },
        { label: 'Generated double-entry journal facts', completed: true },
      ];

      if (lower.includes('invoice') || lower.includes('bill')) {
        reply = "Drafted AR Tax Invoice with automatic sales tax breakdown and line items.";
      } else if (lower.includes('project') || lower.includes('boq')) {
        reply = "Loaded BOQ milestones for Indus Highway Package B. Verified cumulative retention and advance recovery.";
      } else if (lower.includes('stock') || lower.includes('inventory')) {
        reply = "Current total warehouse inventory valuation stands at Rs. 48,250,000 across 3 active logistics facilities.";
      }

      setAgentMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'agent',
          content: reply,
          timestamp: 'Just now',
          steps,
        },
      ]);
      setAgentBusy(false);
    }, 900);
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[var(--canvas)] text-[var(--ink)] font-sans antialiased overflow-hidden select-none">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2 focus:bg-[var(--surface)] focus:text-[var(--lime)] focus:rounded-full focus:outline focus:outline-2 focus:outline-[var(--lime)]"
      >
        Skip to content
      </a>

      {/* ========================================================================= */}
      {/* 1. TECTONIC TOPBAR (Component 11: Schedule, Live Meeting, Search, Lime)    */}
      {/* ========================================================================= */}
      <header className="h-16 bg-[var(--surface)] border-b border-[var(--line)] px-4 md:px-6 flex items-center justify-between gap-4 shrink-0 z-30 transition-colors">
        {/* Left: Brand Identity & Schedule Indicator */}
        <div className="flex items-center gap-4 min-w-0">
          <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => handleNavigate('dashboard', 'overview')}>
            {/* Tectonic Spark Symbol */}
            <div className="w-8 h-8 rounded-full bg-[var(--lime)] text-[var(--on-lime)] flex items-center justify-center font-bold shadow-sm shrink-0">
              <Sparkles size={16} />
            </div>
            <div className="min-w-0">
              <div className="display text-base tracking-wider font-extrabold text-[var(--ink)] leading-none">
                TECTONIC
              </div>
              <div className="micro text-[var(--ink-muted)] mt-1 font-mono tracking-widest truncate">
                {branding.legal_entity_name || 'ENTERPRISE ERP'}
              </div>
            </div>
          </div>

          {/* Schedule with Live Meeting Pill (in lime-soft) */}
          <div className="hidden lg:flex items-center gap-2 pl-4 border-l border-[var(--line)]">
            <span className="caption font-medium text-[var(--ink-muted)]">
              {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            </span>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--lime-soft)] border border-[var(--lime-line)] text-xs font-semibold text-[var(--lime)]">
              <span className="w-2 h-2 rounded-full bg-[var(--lime)] animate-ping" />
              <span>10:30 Standup (live) · Google Meet</span>
            </div>
          </div>
        </div>

        {/* Center: SearchField (48px pill search input with shortcut) */}
        <div className="flex-1 max-w-xl mx-2 flex items-center gap-2 relative">
          <button
            type="button"
            onClick={() => setSearchModalOpen(true)}
            className="flex-1 flex items-center justify-between px-4 py-2 rounded-full bg-[var(--surface-raised)] hover:bg-[var(--surface-strong)] border border-[var(--line)] text-xs text-[var(--ink-muted)] hover:text-[var(--ink)] transition group cursor-pointer shadow-sm"
          >
            <div className="flex items-center gap-2.5 truncate">
              <Search size={15} className="text-[var(--ink-subtle)] group-hover:text-[var(--lime)] transition-colors shrink-0" />
              <span className="truncate">Search commands, records, jobs, customers, vouchers...</span>
            </div>
            <kbd className="text-[10px] font-mono bg-[var(--surface)] border border-[var(--line-strong)] px-2 py-0.5 rounded-full text-[var(--ink-muted)] font-semibold shrink-0 ml-2">
              ⌘K
            </kbd>
          </button>

          {/* Quick Create Button (+ Pill Action) */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setQuickCreateOpen((q) => !q)}
              title="Create Document"
              aria-expanded={quickCreateOpen}
              className="h-9 px-3.5 rounded-full bg-[var(--lime)] hover:brightness-105 active:scale-95 text-[var(--on-lime)] font-bold text-xs flex items-center gap-1.5 shadow-sm transition-all shrink-0 cursor-pointer focus-ring"
            >
              <Plus size={16} className={`transition-transform duration-200 ${quickCreateOpen ? 'rotate-45' : ''}`} />
              <span className="hidden sm:inline font-semibold">New</span>
            </button>

            {quickCreateOpen && (
              <>
                <div
                  className="fixed inset-0 z-40 bg-black/40 backdrop-blur-xs"
                  onClick={() => setQuickCreateOpen(false)}
                  aria-hidden="true"
                />

                <div className="absolute right-0 top-full mt-2 w-80 max-h-[calc(100vh-5.5rem)] overflow-y-auto rounded-2xl bg-[var(--surface)] border border-[var(--line-strong)] shadow-float p-2 z-50 animate-in fade-in zoom-in-95 duration-150 text-[var(--ink)]">
                  <div className="px-3 py-2 border-b border-[var(--line)] flex items-center justify-between mb-1">
                    <span className="heading text-xs uppercase tracking-wider text-[var(--ink)]">Create Document</span>
                    <span className="micro px-2 py-0.5 rounded-full bg-[var(--lime-soft)] text-[var(--lime)] border border-[var(--lime-line)]">
                      Instant Posting
                    </span>
                  </div>

                  <div className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        handleNavigate('ar-invoices');
                        setQuickCreateOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl text-xs hover:bg-[var(--surface-raised)] transition flex items-center gap-3 cursor-pointer group"
                    >
                      <div className="h-8 w-8 rounded-full bg-[var(--surface-raised)] text-[var(--lime)] group-hover:bg-[var(--lime)] group-hover:text-[var(--on-lime)] transition-colors flex items-center justify-center shrink-0">
                        <Receipt size={16} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-[var(--ink)] truncate">Tax Invoice (AR)</div>
                        <div className="text-[11px] text-[var(--ink-muted)] truncate">Post customer bill with line items & tax</div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        handleNavigate('sales-orders');
                        setQuickCreateOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl text-xs hover:bg-[var(--surface-raised)] transition flex items-center gap-3 cursor-pointer group"
                    >
                      <div className="h-8 w-8 rounded-full bg-[var(--surface-raised)] text-[var(--lime)] group-hover:bg-[var(--lime)] group-hover:text-[var(--on-lime)] transition-colors flex items-center justify-center shrink-0">
                        <FileText size={16} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-[var(--ink)] truncate">Sales Order & BOQ Quote</div>
                        <div className="text-[11px] text-[var(--ink-muted)] truncate">Draft customer quote / job order</div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        handleNavigate('pos');
                        setQuickCreateOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl text-xs hover:bg-[var(--surface-raised)] transition flex items-center gap-3 cursor-pointer group"
                    >
                      <div className="h-8 w-8 rounded-full bg-[var(--surface-raised)] text-[var(--lime)] group-hover:bg-[var(--lime)] group-hover:text-[var(--on-lime)] transition-colors flex items-center justify-center shrink-0">
                        <Store size={16} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-[var(--ink)] truncate">Retail POS Register</div>
                        <div className="text-[11px] text-[var(--ink-muted)] truncate">Counter barcode scan & cash drawer</div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        handleNavigate('procurement');
                        setQuickCreateOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl text-xs hover:bg-[var(--surface-raised)] transition flex items-center gap-3 cursor-pointer group"
                    >
                      <div className="h-8 w-8 rounded-full bg-[var(--surface-raised)] text-[var(--lime)] group-hover:bg-[var(--lime)] group-hover:text-[var(--on-lime)] transition-colors flex items-center justify-center shrink-0">
                        <Truck size={16} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-[var(--ink)] truncate">Purchase Order (PO)</div>
                        <div className="text-[11px] text-[var(--ink-muted)] truncate">Issue supplier procurement order</div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        handleNavigate('journals');
                        setQuickCreateOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl text-xs hover:bg-[var(--surface-raised)] transition flex items-center gap-3 cursor-pointer group"
                    >
                      <div className="h-8 w-8 rounded-full bg-[var(--surface-raised)] text-[var(--lime)] group-hover:bg-[var(--lime)] group-hover:text-[var(--on-lime)] transition-colors flex items-center justify-center shrink-0">
                        <BookOpen size={16} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-[var(--ink)] truncate">Journal Voucher</div>
                        <div className="text-[11px] text-[var(--ink-muted)] truncate">Post double-entry general ledger voucher</div>
                      </div>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right side: Theme Switcher, Persona Switcher, Tectonic Agent Toggle */}
        <div className="flex items-center gap-2.5 shrink-0">
          {/* Tectonic Agent Assistant Button */}
          <button
            type="button"
            onClick={() => setAgentDrawerOpen((o) => !o)}
            title="Tectonic Agent Assistant"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--surface-raised)] hover:bg-[var(--surface-strong)] border border-[var(--line-strong)] text-xs font-semibold text-[var(--lime)] cursor-pointer transition focus-ring"
          >
            <AgentMark size={18} active={agentDrawerOpen} />
            <span className="hidden sm:inline font-mono">Agent</span>
          </button>

          {/* Theme Toggle (Dark / Light) */}
          <button
            type="button"
            onClick={toggleTheme}
            title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Theme`}
            aria-label="Toggle design system theme"
            className="w-9 h-9 rounded-full flex items-center justify-center bg-[var(--surface-raised)] hover:bg-[var(--surface-strong)] text-[var(--ink)] border border-[var(--line)] cursor-pointer transition focus-ring"
          >
            {theme === 'dark' ? <Sun size={16} className="text-[var(--lime)]" /> : <Moon size={16} className="text-[var(--ink)]" />}
          </button>

          {/* Persona Switcher */}
          <div className="hidden sm:flex items-center gap-1.5 bg-[var(--surface-raised)] px-2.5 py-1 rounded-full border border-[var(--line)]">
            <span className="micro text-[var(--ink-muted)]">Persona:</span>
            <select
              value={currentUser?.email || 'admin@omnysync.internal'}
              onChange={(e) => loginAsPersona(e.target.value)}
              className="text-xs font-semibold text-[var(--ink)] bg-transparent border-none outline-none cursor-pointer pr-1"
              aria-label="Switch active persona"
            >
              {personas.map((p) => (
                <option key={p.email} value={p.email} className="bg-[var(--surface)] text-[var(--ink)]">
                  {p.name} ({p.role})
                </option>
              ))}
            </select>
          </div>

          {/* User Profile Avatar */}
          <div className="flex items-center gap-2 pl-1">
            <div className="w-8 h-8 rounded-full bg-[var(--pill-bg)] text-[var(--pill-ink)] flex items-center justify-center text-xs font-bold shrink-0">
              {currentUser?.name ? currentUser.name.slice(0, 2).toUpperCase() : 'AD'}
            </div>
            <div className="hidden xl:flex flex-col text-left leading-none">
              <span className="body-strong text-xs text-[var(--ink)] truncate max-w-[120px]">{currentUser?.name || 'Admin User'}</span>
              <span className="caption text-[10px] text-[var(--ink-muted)] truncate max-w-[120px] mt-0.5">{currentUser?.displayRole || 'Administrator'}</span>
            </div>
          </div>
        </div>
      </header>

      {/* ========================================================================= */}
      {/* 2. BODY SHELL: 72PX TECTONIC SIDERAIL + SECONDARY NAV + MAIN VIEW         */}
      {/* ========================================================================= */}
      <div className="flex flex-1 min-h-0 overflow-hidden bg-[var(--canvas)]">
        {/* Component 12: 72px Left SideRail with circular icon buttons */}
        <nav
          aria-label="SideRail"
          className="w-[72px] bg-[var(--surface)] border-r border-[var(--line)] flex flex-col items-center justify-between py-4 shrink-0 z-20 select-none transition-colors"
        >
          <div className="flex flex-col items-center gap-3 w-full">
            {suiteRails.map((suite) => {
              const Icon = suite.icon;
              const isSuiteActive = activeSuite === suite.id;

              return (
                <button
                  key={suite.id}
                  type="button"
                  onClick={() => {
                    if (suite.id === 'dashboard') {
                      handleNavigate('dashboard', 'overview');
                    } else {
                      // Navigate to first item in that suite
                      const sec = allNavSections.find((s) => s.suite === suite.id);
                      if (sec && sec.items.length > 0) {
                        handleNavigate(sec.items[0].id);
                      }
                    }
                  }}
                  title={suite.label}
                  className={`w-11 h-11 rounded-full flex items-center justify-center transition-all cursor-pointer relative ${
                    isSuiteActive
                      ? 'bg-[var(--lime)] text-[var(--on-lime)] font-bold shadow-sm'
                      : 'text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-raised)]'
                  }`}
                >
                  <Icon size={20} strokeWidth={isSuiteActive ? 2.2 : 1.7} />
                  {isSuiteActive && (
                    <span className="absolute -left-1 w-1 h-5 rounded-r-full bg-[var(--lime)]" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Bottom rail action: Toggle Secondary Navigation Catalog */}
          <div className="flex flex-col items-center gap-3 w-full pt-3 border-t border-[var(--line)]">
            <button
              type="button"
              onClick={() => setSidebarExpanded((e) => !e)}
              title={sidebarExpanded ? 'Collapse Sub-Navigation' : 'Expand Sub-Navigation'}
              className={`w-11 h-11 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                sidebarExpanded
                  ? 'bg-[var(--surface-strong)] text-[var(--ink)]'
                  : 'text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-raised)]'
              }`}
            >
              <Grid size={18} />
            </button>
          </div>
        </nav>

        {/* Collapsible Secondary Sub-Navigation Panel (modules & workflows) */}
        {sidebarExpanded && (
          <aside
            aria-label="Sub-navigation"
            className="w-64 bg-[var(--surface-muted)] border-r border-[var(--line)] flex flex-col shrink-0 transition-all duration-200 z-10 select-none"
          >
            <div className="px-4 py-3 border-b border-[var(--line)] flex items-center justify-between">
              <span className="label text-xs text-[var(--ink-muted)] font-mono tracking-wider">
                {activeSuite.toUpperCase().replace('-SUITE', '')} MODULES
              </span>
              <button
                type="button"
                onClick={() => setSidebarExpanded(false)}
                className="p-1 rounded-full text-[var(--ink-subtle)] hover:text-[var(--ink)] hover:bg-[var(--surface-raised)]"
              >
                <X size={14} />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-3 space-y-4">
              {/* Dashboard Sub-Items */}
              {activeSuite === 'dashboard' && (
                <div className="space-y-1">
                  <div className="label text-[10px] text-[var(--ink-subtle)] px-2 mb-1">
                    DASHBOARD WORKSPACES
                  </div>
                  {dashboardSubItems.map((sub) => {
                    const Icon = sub.icon;
                    const isSubActive = currentTab === 'dashboard' && dashboardSubTab === sub.id;
                    return (
                      <button
                        key={sub.id}
                        type="button"
                        onClick={() => handleNavigate('dashboard', sub.id)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs transition cursor-pointer text-left ${
                          isSubActive
                            ? 'bg-[var(--lime-soft)] text-[var(--lime)] font-bold border border-[var(--lime-line)]'
                            : 'text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-raised)]'
                        }`}
                      >
                        <Icon size={15} />
                        <span className="truncate">{sub.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Module Nav Items */}
              {allNavSections
                .filter((sec) => activeSuite === 'dashboard' || sec.suite === activeSuite)
                .map((sec) => ({
                  ...sec,
                  items: sec.items.filter((item) => canSeeModule(item.id, currentUser?.permissions)),
                }))
                .filter((sec) => sec.items.length > 0)
                .map((sec, sIdx) => (
                  <div key={sIdx} className="space-y-1">
                    <div className="label text-[10px] text-[var(--ink-subtle)] px-2 mb-1">
                      {sec.title}
                    </div>
                    {sec.items.map((item: any) => {
                      const Icon = item.icon;
                      const isActive = currentTab === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => handleNavigate(item.id)}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition cursor-pointer text-left ${
                            isActive
                              ? 'bg-[var(--lime-soft)] text-[var(--lime)] font-bold border border-[var(--lime-line)]'
                              : 'text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-raised)]'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Icon size={15} />
                            <span className="truncate">{item.label}</span>
                          </div>
                          {isActive && <ChevronRight size={13} className="shrink-0 text-[var(--lime)]" />}
                        </button>
                      );
                    })}
                  </div>
                ))}
            </div>
          </aside>
        )}

        {/* ========================================================================= */}
        {/* 3. MAIN WORKSPACE CONTENT CONTAINER (Near-Black Canvas in Dark Mode)       */}
        {/* ========================================================================= */}
        <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden bg-[var(--canvas)]">
          <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 focus:outline-none">
            {loading ? (
              <div role="status" className="flex items-center justify-center h-64 text-sm text-[var(--ink-muted)]">
                <span className="inline-block animate-spin h-5 w-5 border-2 border-[var(--lime)] border-t-transparent rounded-full mr-2" />
                Synchronizing Tectonic ERP Ledger...
              </div>
            ) : (
              <Suspense
                fallback={
                  <div role="status" className="flex items-center justify-center h-64 text-sm text-[var(--ink-muted)]">
                    <span className="inline-block animate-spin h-5 w-5 border-2 border-[var(--lime)] border-t-transparent rounded-full mr-2" />
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

        {/* ========================================================================= */}
        {/* 4. TECTONIC AGENT ASSISTANT SLIDE-OVER DRAWER (AI Copilot)                 */}
        {/* ========================================================================= */}
        {agentDrawerOpen && (
          <aside className="w-96 max-w-full bg-[var(--surface)] border-l border-[var(--line)] shadow-float flex flex-col h-full z-40 animate-in slide-in-from-right duration-200">
            {/* Header */}
            <div className="px-5 py-4 border-b border-[var(--line)] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-full bg-[var(--lime)] text-[var(--on-lime)] flex items-center justify-center font-bold">
                  <Sparkles size={14} />
                </div>
                <div>
                  <h3 className="heading text-sm text-[var(--ink)] font-semibold">Tectonic Agent</h3>
                  <p className="caption text-[11px] text-[var(--ink-muted)]">Autonomous ERP Copilot</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAgentDrawerOpen(false)}
                className="p-1 rounded-full text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-raised)]"
              >
                <X size={16} />
              </button>
            </div>

            {/* Conversation turns */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {agentMessages.map((msg) => (
                <AgentMessage
                  key={msg.id}
                  role={msg.role}
                  content={msg.content}
                  timestamp={msg.timestamp}
                  steps={msg.steps}
                />
              ))}
              {agentBusy && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-[var(--surface-raised)] text-xs text-[var(--ink-muted)]">
                  <span className="w-2 h-2 rounded-full bg-[var(--lime)] animate-ping" />
                  <span>Tectonic Agent reasoning over ledger...</span>
                </div>
              )}
            </div>

            {/* Agent Composer */}
            <div className="p-4 border-t border-[var(--line)] bg-[var(--surface-muted)] shrink-0">
              <AgentComposer
                onSend={handleAgentSend}
                disabled={agentBusy}
                placeholder="Ask Tectonic Agent (e.g. 'Audit Q3 receivables', 'Verify BOQ')..."
                suggestions={[
                  'Reconcile bank statement against posted GL',
                  'Verify Indus Highway IPC milestone 4',
                  'Check inventory valuation at Port Qasim',
                ]}
              />
            </div>
          </aside>
        )}
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
