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

export const GlobalSearchModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (tabId: string) => void;
}> = ({ isOpen, onClose, onNavigate }) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const baseItems: SearchItem[] = [
    // Core Workspaces
    { id: 'ws-dash', title: 'Dashboards Hub', description: 'Executive, ops, finance and technician overviews', category: 'Workspace', icon: LayoutDashboard, tabId: 'dashboard' },
    { id: 'ws-pos', title: 'Retail POS Terminal', description: 'Counter checkout, barcode scanning & receipt printing', category: 'Workspace', icon: Store, tabId: 'pos', badge: 'Active' },
    { id: 'ws-sales', title: 'Sales Orders', description: 'Manage customer quotes, confirm orders and billings', category: 'Workspace', icon: ShoppingCart, tabId: 'sales-orders' },
    { id: 'ws-ar', title: 'Customer Invoices (AR)', description: 'Accounts receivable tax invoices, payments & balances', category: 'Workspace', icon: Receipt, tabId: 'ar-invoices' },
    { id: 'ws-proc', title: 'Purchase Orders', description: 'Supplier procurement orders and goods receipts', category: 'Workspace', icon: Truck, tabId: 'procurement' },
    { id: 'ws-ap', title: 'Supplier Bills (AP)', description: 'Accounts payable voucher matching and disbursements', category: 'Workspace', icon: FileCheck, tabId: 'ap-invoices' },
    { id: 'ws-wh', title: 'Warehouses & Logistics', description: 'Inventory stock valuations, bins, transfers & lots', category: 'Workspace', icon: Warehouse, tabId: 'warehouses' },
    { id: 'ws-mfg', title: 'Manufacturing & Assembly', description: 'Bills of Materials (BOM), production runs & work orders', category: 'Workspace', icon: Factory, tabId: 'manufacturing' },
    { id: 'ws-qm', title: 'Quality Management (QM)', description: 'Inspection lots, pass/fail thresholds and NCRs', category: 'Workspace', icon: ShieldCheck, tabId: 'quality' },
    { id: 'ws-pm', title: 'Plant Maintenance (PM)', description: 'Equipment preventive plans, break-fix maintenance jobs', category: 'Workspace', icon: Wrench, tabId: 'maintenance' },
    { id: 'ws-proj', title: 'Projects, BOQ & IPC', description: 'Bill of Quantities milestones and interim payment certs', category: 'Workspace', icon: Briefcase, tabId: 'projects' },
    { id: 'ws-emp', title: 'Employees & HRM', description: 'Workforce registry, department records and attendances', category: 'Workspace', icon: Users, tabId: 'employees' },
    { id: 'ws-pay', title: 'Payroll & Disbursals', description: 'Salary slips, tax withholdings and bank advice runs', category: 'Workspace', icon: Wallet, tabId: 'payroll' },
    { id: 'ws-paym', title: 'Payments & Allocations', description: 'Record collections, disbursements and reconcile lines', category: 'Workspace', icon: CreditCard, tabId: 'payments' },
    { id: 'ws-bank', title: 'Bank Reconciliation', description: 'Match statement feeds against posted bank journals', category: 'Workspace', icon: Landmark, tabId: 'treasury-reconciliation' },
    { id: 'ws-fx', title: 'FX Exchange Rates', description: 'Manage base currencies and daily spot rate tables', category: 'Workspace', icon: ArrowRightLeft, tabId: 'fx-rates' },
    { id: 'ws-auto', title: 'Automation & Alerts', description: 'Cron schedules, trigger actions and email notifications', category: 'Workspace', icon: Workflow, tabId: 'automation' },
    { id: 'ws-audit', title: 'Audit Trail & Rollbacks', description: 'Immutable log of ledger entries and rollback manager', category: 'Workspace', icon: ShieldAlert, tabId: 'audit' },

    // Quick Actions
    { id: 'qa-inv', title: 'Create Customer Invoice', description: 'Open AR invoice creator with auto line calculator', category: 'Quick Action', icon: Plus, tabId: 'ar-invoices', badge: 'Action' },
    { id: 'qa-pos', title: 'Start Cashier POS Register', description: 'Quick open POS register for retail sales', category: 'Quick Action', icon: Store, tabId: 'pos', badge: 'Action' },
    { id: 'qa-jv', title: 'Post General Journal Voucher', description: 'Record manual double-entry accounting transaction', category: 'Quick Action', icon: FileText, tabId: 'journals', badge: 'Action' },
    { id: 'qa-party', title: 'Add Customer or Vendor', description: 'Register a new commercial partner in Trading Masters', category: 'Quick Action', icon: Users, tabId: 'parties', badge: 'Action' },
    { id: 'qa-po', title: 'Issue Supplier Purchase Order', description: 'Draft a new procurement order with tax calculation', category: 'Quick Action', icon: Truck, tabId: 'procurement', badge: 'Action' },
  ];

  const filteredItems = query.trim()
    ? baseItems.filter((i) =>
        i.title.toLowerCase().includes(query.toLowerCase()) ||
        i.description.toLowerCase().includes(query.toLowerCase()) ||
        i.category.toLowerCase().includes(query.toLowerCase())
      )
    : baseItems;

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setSelectedIndex(0);
      setQuery('');
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

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
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-[var(--surface)] text-[var(--ink)] rounded-2xl shadow-2xl border border-[var(--line-strong)] overflow-hidden flex flex-col max-h-[75vh]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search Header */}
        <div className="flex items-center px-4 py-3.5 border-b border-[var(--line)] gap-3 bg-[var(--surface-strong)]">
          <Search size={20} className="text-[var(--lime)] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search workspaces, actions, customers, items, employees (e.g. 'POS', 'Advances', 'Bill')..."
            className="flex-1 bg-transparent text-sm font-semibold text-[var(--ink)] placeholder:text-[var(--ink-subtle)] focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-[var(--ink-muted)] hover:text-[var(--ink)] rounded-full hover:bg-[var(--surface-raised)]"
          >
            <X size={18} />
          </button>
        </div>

        {/* Search Results List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredItems.length === 0 ? (
            <div className="py-12 text-center text-sm text-[var(--ink-muted)]">
              No matching modules, records or actions found for <span className="font-semibold text-[var(--ink)]">"{query}"</span>
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
                      ? 'bg-[var(--lime-soft)] text-[var(--ink)] shadow-xs border border-[var(--lime-line)]'
                      : 'text-[var(--ink)] hover:bg-[var(--surface-raised)]'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                        isSelected
                          ? 'bg-[var(--lime)] text-[var(--on-lime)]'
                          : 'bg-[var(--surface-raised)] text-[var(--lime)]'
                      }`}
                    >
                      <Icon size={18} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm truncate">{item.title}</span>
                        {item.badge && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--surface-raised)] text-[var(--lime)] border border-[var(--lime-line)]">
                            {item.badge}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[var(--ink-muted)] truncate mt-0.5">
                        {item.description}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    <span className="text-[11px] font-semibold text-[var(--ink-subtle)] uppercase tracking-wider hidden sm:inline">
                      {item.category}
                    </span>
                    <ArrowRight size={14} className={`transition-transform ${isSelected ? 'translate-x-1 text-[var(--lime)]' : 'text-[var(--ink-muted)]'}`} />
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Search Footer Keyboard Hints */}
        <div className="px-4 py-2.5 bg-[var(--surface-strong)] border-t border-[var(--line)] flex items-center justify-between text-[11px] text-[var(--ink-muted)]">
          <div className="flex items-center gap-3">
            <span><kbd className="px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--line)] font-mono font-bold text-[var(--ink)]">↑</kbd> <kbd className="px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--line)] font-mono font-bold text-[var(--ink)]">↓</kbd> to navigate</span>
            <span><kbd className="px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--line)] font-mono font-bold text-[var(--ink)]">↵</kbd> to select</span>
            <span><kbd className="px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--line)] font-mono font-bold text-[var(--ink)]">esc</kbd> to close</span>
          </div>
          <div className="flex items-center gap-1 font-semibold text-[var(--lime)]">
            <Command size={12} /> Tectonic Universal Search
          </div>
        </div>
      </div>
    </div>
  );
};
