import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  ArrowRight,
  LayoutDashboard,
  Store,
  ShoppingCart,
  Receipt,
  Truck,
  FileCheck,
  Warehouse,
  Factory,
  ShieldCheck,
  Wrench,
  Briefcase,
  Users,
  Wallet,
  CreditCard,
  Landmark,
  ArrowRightLeft,
  Sparkles,
  ShieldAlert,
  Cog,
  FileText,
  Boxes,
  Handshake,
  Clock,
  BadgeCheck,
  BarChart3,
  Car,
  Target,
  Repeat,
  Workflow,
  Plus,
  Command,
  X,
} from 'lucide-react';
import { ApiClient } from '../api/client.js';

interface SearchItem {
  id: string;
  title: string;
  description: string;
  category: 'Workspace' | 'Quick Action' | 'Master Record';
  icon: React.ComponentType<any>;
  tabId: string;
  action?: () => void;
  badge?: string;
}

interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (tabId: string) => void;
}

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({
  isOpen,
  onClose,
  onNavigate,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [entities, setEntities] = useState<SearchItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Static list of navigation modules and actions
  const staticItems: SearchItem[] = [
    // Core Workspaces
    { id: 'ws-dashboard', title: 'Executive Dashboards Hub', description: 'Cross-departmental KPI overview & operational summaries', category: 'Workspace', icon: LayoutDashboard, tabId: 'dashboard', badge: 'Overview' },
    { id: 'ws-pos', title: 'Retail POS Terminal', description: 'Cashier checkout, barcode scanner, discounts & receipts', category: 'Workspace', icon: Store, tabId: 'pos', badge: 'Retail' },
    { id: 'ws-sales', title: 'Sales Orders', description: 'Customer order confirmation, reservation & fulfillment', category: 'Workspace', icon: ShoppingCart, tabId: 'sales-orders', badge: 'Sales' },
    { id: 'ws-ar', title: 'AR Customer Invoices', description: 'Customer billing, sales tax invoices, AR aging & collections', category: 'Workspace', icon: Receipt, tabId: 'ar-invoices', badge: 'Receivables' },
    { id: 'ws-procurement', title: 'Purchase Orders', description: 'Supplier purchase requisitions, PO approval & goods receipts', category: 'Workspace', icon: Truck, tabId: 'procurement', badge: 'Purchasing' },
    { id: 'ws-ap', title: 'AP Supplier Bills', description: '3-way matching, vendor invoices & GRNI clearing', category: 'Workspace', icon: FileCheck, tabId: 'ap-invoices', badge: 'Payables' },
    { id: 'ws-warehouse', title: 'Warehouses & Bins', description: 'Multi-warehouse stock layers, bin locations & inventory transfers', category: 'Workspace', icon: Warehouse, tabId: 'warehouses', badge: 'Supply Chain' },
    { id: 'ws-manufacturing', title: 'Manufacturing & Assembly', description: 'BOM recipe costing, work orders & production variance', category: 'Workspace', icon: Factory, tabId: 'manufacturing', badge: 'Production' },
    { id: 'ws-quality', title: 'Quality Management (QM)', description: 'Inspection plans, quality lots & usage decisions', category: 'Workspace', icon: ShieldCheck, tabId: 'quality', badge: 'Compliance' },
    { id: 'ws-maintenance', title: 'Plant Maintenance (PM)', description: 'Work orders, preventive schedules & equipment history', category: 'Workspace', icon: Wrench, tabId: 'maintenance', badge: 'Maintenance' },
    { id: 'ws-projects', title: 'Projects, BOQ & IPC', description: 'Bill of quantities, contract milestones & IPC billing', category: 'Workspace', icon: Briefcase, tabId: 'projects', badge: 'Projects' },
    { id: 'ws-employees', title: 'Workforce & HRM', description: 'Employee master, staff advances, geofence attendance & expenses', category: 'Workspace', icon: Users, tabId: 'employees', badge: 'HRM' },
    { id: 'ws-payroll', title: 'Payroll & Disbursals', description: 'Monthly salary runs, tax deductions, EOBI & bank payments', category: 'Workspace', icon: Wallet, tabId: 'payroll', badge: 'Payroll' },
    { id: 'ws-payments', title: 'Payments & Settlements', description: 'Open-item payment vouchers & cashier collections', category: 'Workspace', icon: CreditCard, tabId: 'payments', badge: 'Treasury' },
    { id: 'ws-assets', title: 'Fixed Assets Register', description: 'Asset acquisition, monthly straight-line depreciation & disposal', category: 'Workspace', icon: Landmark, tabId: 'assets', badge: 'Assets' },
    { id: 'ws-bankrec', title: 'Bank Reconciliation', description: 'Bank statement statement import & GL ledger auto-matching', category: 'Workspace', icon: Landmark, tabId: 'treasury-reconciliation', badge: 'Treasury' },
    { id: 'ws-fx', title: 'FX & Exchange Rates', description: 'Daily currency spot rates & realized/unrealized revaluation', category: 'Workspace', icon: ArrowRightLeft, tabId: 'fx-rates', badge: 'Finance' },
    { id: 'ws-journals', title: 'Journal Vouchers', description: 'Double-entry general journal entries with maker-checker', category: 'Workspace', icon: FileText, tabId: 'journals', badge: 'General Ledger' },
    { id: 'ws-trial-balance', title: 'Trial Balance & GL', description: '4-level Chart of Accounts trial balance & subledger proof', category: 'Workspace', icon: FileText, tabId: 'trial-balance', badge: 'Financials' },
    { id: 'ws-coa', title: 'Chart of Accounts', description: 'Assets, Liabilities, Equity, Revenue, and Expense 4-level tree', category: 'Workspace', icon: Boxes, tabId: 'coa', badge: 'Finance' },
    { id: 'ws-admin-config', title: 'Admin, Branding & Settings', description: 'Upload PNG logo, custom brand name, module lifecycle & RBAC users', category: 'Workspace', icon: Cog, tabId: 'admin-config', badge: 'Administration' },
    { id: 'ws-srv', title: 'Field Service & Tickets', description: 'Customer service cases, technician dispatch & warranty repairs', category: 'Workspace', icon: Wrench, tabId: 'srv', badge: 'Service' },
    { id: 'ws-crm', title: 'CRM & Pipeline', description: 'Leads, deals, customer opportunities & win-loss analysis', category: 'Workspace', icon: Handshake, tabId: 'crm', badge: 'CRM' },
    { id: 'ws-time', title: 'Time & Attendance', description: 'Weekly technician timesheets, leave requests & overtime', category: 'Workspace', icon: Clock, tabId: 'time', badge: 'Time' },
    { id: 'ws-sup', title: 'Supplier Management', description: 'Vendor qualification, certifications & supplier scorecards', category: 'Workspace', icon: BadgeCheck, tabId: 'sup', badge: 'Procurement' },
    { id: 'ws-log', title: 'Logistics & Shipments', description: 'Waybills, carrier tracking, freight liabilities & POD', category: 'Workspace', icon: Truck, tabId: 'log', badge: 'Logistics' },
    { id: 'ws-bi', title: 'BI Dashboards', description: 'Executive analytics, pivot charts & governed reports', category: 'Workspace', icon: BarChart3, tabId: 'bi', badge: 'Analytics' },
    { id: 'ws-flt', title: 'Fleet Management', description: 'Vehicle telemetry, fuel expense logs & driver assignments', category: 'Workspace', icon: Car, tabId: 'flt', badge: 'Fleet' },
    { id: 'ws-epm', title: 'Budgets & Planning', description: 'Cost center budget vs actual variances & commitment control', category: 'Workspace', icon: Target, tabId: 'epm', badge: 'Budgeting' },
    { id: 'ws-lnd', title: 'Customer Financing & Loans', description: 'Hire-purchase repayment schedules, interest accrual & late fees', category: 'Workspace', icon: Landmark, tabId: 'lnd', badge: 'Financing' },
    { id: 'ws-grc', title: 'Risk & Governance (GRC)', description: 'Risk register, internal control tests & compliance audits', category: 'Workspace', icon: ShieldAlert, tabId: 'grc', badge: 'Governance' },
    { id: 'ws-tal', title: 'Recruitment & ATS', description: 'Job openings, applicant interviews, scorecards & offers', category: 'Workspace', icon: Users, tabId: 'tal', badge: 'Recruitment' },
    { id: 'ws-com', title: 'Subscriptions & Contracts', description: 'Recurring billing cycles, deferred revenue & AMC warranties', category: 'Workspace', icon: Repeat, tabId: 'com', badge: 'Recurring' },
    { id: 'ws-workflow', title: 'Workflow Studio', description: 'Visual automation builder, event triggers & audit actions', category: 'Workspace', icon: Workflow, tabId: 'workflow-studio', badge: 'Automation' },

    // Quick Action Shortcuts
    { id: 'act-new-order', title: 'Create Sales Order', description: 'Book a new customer trading order with line items & taxes', category: 'Quick Action', icon: Plus, tabId: 'sales-orders', badge: 'Action' },
    { id: 'act-onboard-emp', title: 'Onboard New Employee', description: 'Add new staff member with salary structure & bank details', category: 'Quick Action', icon: Plus, tabId: 'employees', badge: 'Action' },
    { id: 'act-request-adv', title: 'Request Staff Advance / Float', description: 'File site spare parts float or salary advance with recovery plan', category: 'Quick Action', icon: Plus, tabId: 'employees', badge: 'Action' },
    { id: 'act-submit-exp', title: 'Submit Field Expense Claim', description: 'Submit technician travel, fuel, or emergency parts receipt', category: 'Quick Action', icon: Plus, tabId: 'employees', badge: 'Action' },
    { id: 'act-branding', title: 'Upload Logo & Rebrand Interface', description: 'Upload company PNG logo, custom title, and brand colors', category: 'Quick Action', icon: Sparkles, tabId: 'admin-config', badge: 'Action' },
    { id: 'act-pos-register', title: 'Open Retail POS Register', description: 'Launch point of sale register for instant scanning and cash checkout', category: 'Quick Action', icon: Store, tabId: 'pos', badge: 'Action' },
    { id: 'act-post-journal', title: 'Post Manual Journal Voucher', description: 'Create balanced debits and credits voucher on general ledger', category: 'Quick Action', icon: Plus, tabId: 'journals', badge: 'Action' },
    { id: 'act-create-po', title: 'Create Purchase Order (PO)', description: 'Issue supplier procurement order for trading stock or materials', category: 'Quick Action', icon: Plus, tabId: 'procurement', badge: 'Action' },
  ];

  // Fetch quick master records on open
  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setSelectedIndex(0);

    // Auto-focus input
    setTimeout(() => {
      inputRef.current?.focus();
    }, 50);

    // Load top parties and items
    const fetchEntities = async () => {
      try {
        const [partiesRes, itemsRes, empRes] = await Promise.all([
          ApiClient.get('/parties').catch(() => []),
          ApiClient.get('/items').catch(() => []),
          ApiClient.get('/hrm/employees').catch(() => []),
        ]);

        const partyItems: SearchItem[] = (Array.isArray(partiesRes) ? partiesRes : []).slice(0, 8).map((p: any) => ({
          id: `party-${p.id}`,
          title: `${p.name} (${p.code})`,
          description: `${p.party_type === 'CUSTOMER' ? 'Customer Account' : 'Vendor Supplier'} • Tax: ${p.tax_identifier || 'N/A'}`,
          category: 'Master Record',
          icon: Users,
          tabId: 'parties',
          badge: p.party_type,
        }));

        const catalogueItems: SearchItem[] = (Array.isArray(itemsRes) ? itemsRes : []).slice(0, 8).map((it: any) => ({
          id: `item-${it.id}`,
          title: `${it.name} (${it.code})`,
          description: `${it.item_type} Item • Price: PKR ${it.unit_price} • Cost: PKR ${it.unit_cost}`,
          category: 'Master Record',
          icon: Boxes,
          tabId: 'items',
          badge: 'Item',
        }));

        const employeeItems: SearchItem[] = (Array.isArray(empRes) ? empRes : []).slice(0, 6).map((e: any) => ({
          id: `emp-${e.id}`,
          title: `${e.first_name} ${e.last_name} (${e.employee_number})`,
          description: `${e.department_name || 'General'} • ${e.designation_title || 'Staff'} • Status: ${e.status}`,
          category: 'Master Record',
          icon: Users,
          tabId: 'employees',
          badge: 'Staff',
        }));

        setEntities([...partyItems, ...catalogueItems, ...employeeItems]);
      } catch {
        // Ignore fetch errors
      }
    };

    fetchEntities();
  }, [isOpen]);

  const allItems = [...staticItems, ...entities];

  const filteredItems = query.trim() === ''
    ? staticItems.slice(0, 14)
    : allItems.filter((it) => {
        const q = query.toLowerCase();
        return (
          it.title.toLowerCase().includes(q) ||
          it.description.toLowerCase().includes(q) ||
          it.category.toLowerCase().includes(q) ||
          (it.badge && it.badge.toLowerCase().includes(q))
        );
      });

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredItems.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % Math.max(1, filteredItems.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selected = filteredItems[selectedIndex];
      if (selected) {
        onNavigate(selected.tabId);
        onClose();
      }
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-[#D9DFEA] overflow-hidden flex flex-col max-h-[75vh]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search Header */}
        <div className="flex items-center px-4 py-3.5 border-b border-[#D9DFEA] gap-3 bg-[#F7F8FC]">
          <Search size={20} className="text-[#5940B8] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search workspaces, actions, customers, items, employees (e.g. 'POS', 'Advances', 'Bill', 'Workman')..."
            className="flex-1 bg-transparent text-sm font-semibold text-[#182235] placeholder:text-[#5E6A7D] focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-[#5E6A7D] hover:text-[#182235] rounded-md hover:bg-black/5"
          >
            <X size={18} />
          </button>
        </div>

        {/* Search Results List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredItems.length === 0 ? (
            <div className="py-12 text-center text-sm text-[#5E6A7D]">
              No matching modules, records or actions found for <span className="font-semibold text-[#182235]">"{query}"</span>
            </div>
          ) : (
            filteredItems.map((item, index) => {
              const Icon = item.icon;
              const isSelected = index === selectedIndex;
              return (
                <div
                  key={item.id}
                  onClick={() => {
                    onNavigate(item.tabId);
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-[#F2EEFF] text-[#5940B8] shadow-xs'
                      : 'text-[#182235] hover:bg-[#F7F8FC]'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                        isSelected
                          ? 'bg-[#5940B8] text-white'
                          : 'bg-[#F1F4F9] text-[#5940B8]'
                      }`}
                    >
                      <Icon size={18} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm truncate">{item.title}</span>
                        {item.badge && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#E8E2FF] text-[#5940B8]">
                            {item.badge}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#5E6A7D] truncate mt-0.5">
                        {item.description}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    <span className="text-[11px] font-semibold text-[#5E6A7D] uppercase tracking-wider hidden sm:inline">
                      {item.category}
                    </span>
                    <ArrowRight size={14} className={`transition-transform ${isSelected ? 'translate-x-1 text-[#5940B8]' : 'text-[#5E6A7D]'}`} />
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Search Footer Keyboard Hints */}
        <div className="px-4 py-2.5 bg-[#F7F8FC] border-t border-[#D9DFEA] flex items-center justify-between text-[11px] text-[#5E6A7D]">
          <div className="flex items-center gap-3">
            <span><kbd className="px-1.5 py-0.5 rounded bg-white border border-[#D9DFEA] shadow-2xs font-mono font-bold">↑</kbd> <kbd className="px-1.5 py-0.5 rounded bg-white border border-[#D9DFEA] shadow-2xs font-mono font-bold">↓</kbd> to navigate</span>
            <span><kbd className="px-1.5 py-0.5 rounded bg-white border border-[#D9DFEA] shadow-2xs font-mono font-bold">↵</kbd> to select</span>
            <span><kbd className="px-1.5 py-0.5 rounded bg-white border border-[#D9DFEA] shadow-2xs font-mono font-bold">esc</kbd> to close</span>
          </div>
          <div className="flex items-center gap-1 font-semibold text-[#5940B8]">
            <Command size={12} /> Universal Search Engine
          </div>
        </div>
      </div>
    </div>
  );
};
