import React, { useEffect, useState } from 'react';
import { ApiClient } from '../api/client.js';
import { Card, Badge, Button } from '@omnysync/ui';
import { Building2, ShieldCheck, DollarSign, BookOpen, AlertCircle, RefreshCw, ShoppingCart } from 'lucide-react';

export const DashboardView: React.FC<{ onNavigate: (tab: string) => void }> = ({ onNavigate }) => {
  const [context, setContext] = useState<any>(null);
  const [tb, setTb] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    try {
      const [ctxData, tbData] = await Promise.all([
        ApiClient.get('/orgs/context'),
        ApiClient.get('/ledger/trial-balance'),
      ]);
      setContext(ctxData);
      setTb(tbData);
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  return (
    <div className="flex flex-col gap-6">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-xl border border-[#D9DFEA] shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-[#182235]">Omnysync ERP Core</h1>
            <Badge variant="brand">M1 & M2 Live</Badge>
          </div>
          <p className="text-sm text-[#5E6A7D] mt-1">
            Integrated Trading & Financial Platform • Multi-Entity • 4-Level COA • Exact Decimal Monetary Core
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={loadData} isLoading={loading}>
            <RefreshCw size={14} className="mr-1" /> Refresh
          </Button>
          <Button variant="primary" size="sm" onClick={() => onNavigate('sales-orders')}>
            <ShoppingCart size={14} className="mr-1" /> New Sales Order
          </Button>
        </div>
      </div>

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#5E6A7D] uppercase">Organization Scope</span>
            <Building2 className="text-[#5940B8]" size={18} />
          </div>
          <div className="mt-3">
            <div className="text-base font-bold text-[#182235] truncate">
              {context?.organization?.name || 'Loading...'}
            </div>
            <div className="text-xs text-[#5E6A7D] mt-1 font-mono">
              Code: {context?.organization?.code || '---'}
            </div>
          </div>
        </Card>

        <Card className="flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#5E6A7D] uppercase">Legal Entity</span>
            <ShieldCheck className="text-[#146341]" size={18} />
          </div>
          <div className="mt-3">
            <div className="text-base font-bold text-[#182235] truncate">
              {context?.legalEntities?.[0]?.name || 'Loading...'}
            </div>
            <div className="text-xs text-[#5E6A7D] mt-1">
              Currency: <span className="font-semibold">{context?.legalEntities?.[0]?.functional_currency || 'PKR'}</span>
            </div>
          </div>
        </Card>

        <Card className="flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#5E6A7D] uppercase">Trial Balance Debits</span>
            <DollarSign className="text-[#234FA3]" size={18} />
          </div>
          <div className="mt-3">
            <div className="text-lg font-bold text-[#182235] font-mono">
              {tb ? `PKR ${parseFloat(tb.total_debits).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '0.00'}
            </div>
            <div className="text-xs text-[#146341] mt-1 flex items-center gap-1 font-medium">
              <ShieldCheck size={12} /> Double-Entry Balanced
            </div>
          </div>
        </Card>

        <Card className="flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#5E6A7D] uppercase">Trading & Finance Subledgers</span>
            <BookOpen className="text-[#5940B8]" size={18} />
          </div>
          <div className="mt-3">
            <div className="text-base font-bold text-[#182235]">
              AR / AP / Stock Reconciled
            </div>
            <div className="text-xs text-[#5E6A7D] mt-1">
              Real-time GL Posting Hooks
            </div>
          </div>
        </Card>
      </div>

      {/* Main Content Split */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Integrated Trading Workflows" subtitle="Direct access to Order-to-Cash and Procure-to-Pay vertical flows">
          <div className="flex flex-col gap-3">
            <div
              onClick={() => onNavigate('sales-orders')}
              className="flex items-center justify-between p-3 rounded-lg border border-[#D9DFEA] hover:bg-[#F1F4F9] cursor-pointer transition-colors"
            >
              <div>
                <h4 className="text-sm font-semibold text-[#182235]">Order-to-Cash (Sales Orders & Fulfillments)</h4>
                <p className="text-xs text-[#5E6A7D]">Sales orders, stock reservation, fulfillment, and COGS journal posting</p>
              </div>
              <Badge variant="brand">Sales</Badge>
            </div>

            <div
              onClick={() => onNavigate('ar-invoices')}
              className="flex items-center justify-between p-3 rounded-lg border border-[#D9DFEA] hover:bg-[#F1F4F9] cursor-pointer transition-colors"
            >
              <div>
                <h4 className="text-sm font-semibold text-[#182235]">Customer Billing & AR Subledger</h4>
                <p className="text-xs text-[#5E6A7D]">Tax invoices, AR control debit / Sales credit GL posting, and aging</p>
              </div>
              <Badge variant="success">AR</Badge>
            </div>

            <div
              onClick={() => onNavigate('procurement')}
              className="flex items-center justify-between p-3 rounded-lg border border-[#D9DFEA] hover:bg-[#F1F4F9] cursor-pointer transition-colors"
            >
              <div>
                <h4 className="text-sm font-semibold text-[#182235]">Procure-to-Pay (Purchase Orders & Receipts)</h4>
                <p className="text-xs text-[#5E6A7D]">PO approvals, goods receipt into stock, and GRNI liability accrual</p>
              </div>
              <Badge variant="info">Procurement</Badge>
            </div>

            <div
              onClick={() => onNavigate('payments')}
              className="flex items-center justify-between p-3 rounded-lg border border-[#D9DFEA] hover:bg-[#F1F4F9] cursor-pointer transition-colors"
            >
              <div>
                <h4 className="text-sm font-semibold text-[#182235]">Payments & Open-Item Settlements</h4>
                <p className="text-xs text-[#5E6A7D]">Customer receipts, supplier disbursements, and bank GL postings</p>
              </div>
              <Badge variant="warning">Cash/Bank</Badge>
            </div>
          </div>
        </Card>

        <Card title="System Invariants & Safeguards" subtitle="Non-negotiable accounting and platform rules">
          <div className="flex flex-col gap-3 text-xs text-[#46536B]">
            <div className="flex items-start gap-2 p-2.5 rounded bg-[#F7F8FC] border border-[#D9DFEA]">
              <ShieldCheck className="text-[#146341] shrink-0 mt-0.5" size={16} />
              <div>
                <span className="font-semibold text-[#182235]">Exact Decimal Monetary Arithmetic:</span> All calculations use exact 24,8 precision string serialization with no IEEE 754 float drift.
              </div>
            </div>

            <div className="flex items-start gap-2 p-2.5 rounded bg-[#F7F8FC] border border-[#D9DFEA]">
              <ShieldCheck className="text-[#146341] shrink-0 mt-0.5" size={16} />
              <div>
                <span className="font-semibold text-[#182235]">Immutable Posted Facts:</span> Posted journals and stock valuation facts are strictly immutable. Corrections occur via linked reversals.
              </div>
            </div>

            <div className="flex items-start gap-2 p-2.5 rounded bg-[#F7F8FC] border border-[#D9DFEA]">
              <ShieldCheck className="text-[#146341] shrink-0 mt-0.5" size={16} />
              <div>
                <span className="font-semibold text-[#182235]">Subledger-to-GL Integrity:</span> Inventory, AR, and AP subledgers continuously reconcile with double-entry General Ledger control accounts.
              </div>
            </div>

            <div className="flex items-start gap-2 p-2.5 rounded bg-[#F7F8FC] border border-[#D9DFEA]">
              <AlertCircle className="text-[#5940B8] shrink-0 mt-0.5" size={16} />
              <div>
                <span className="font-semibold text-[#182235]">Deterministic Synthetic Fixtures:</span> Clean demo profile isolated from production transactions.
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};
