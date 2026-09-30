import React, { useEffect, useState } from 'react';
import { ApiClient } from '../api/client.js';
import { Card, Badge, Button } from '@omnysync/ui';
import { Building2, ShieldCheck, DollarSign, BookOpen, AlertCircle, RefreshCw, FileText } from 'lucide-react';

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
            <Badge variant="brand">Demo / Development Tier</Badge>
          </div>
          <p className="text-sm text-[#5E6A7D] mt-1">
            Standard Modular Monolith • Multi-Entity • 4-Level COA • Exact Decimal Monetary Core
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={loadData} isLoading={loading}>
            <RefreshCw size={14} className="mr-1" /> Refresh
          </Button>
          <Button variant="primary" size="sm" onClick={() => onNavigate('journals')}>
            <FileText size={14} className="mr-1" /> New Journal
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
            <span className="text-xs font-semibold text-[#5E6A7D] uppercase">Posting Invariant</span>
            <BookOpen className="text-[#5940B8]" size={18} />
          </div>
          <div className="mt-3">
            <div className="text-base font-bold text-[#182235]">
              4-Level Hierarchy
            </div>
            <div className="text-xs text-[#5E6A7D] mt-1">
              Leaf-Only (L4) Postings Enforced
            </div>
          </div>
        </Card>
      </div>

      {/* Main Content Split */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Quick Workflows" subtitle="Direct access to core M0 & M1 business processes">
          <div className="flex flex-col gap-3">
            <div
              onClick={() => onNavigate('coa')}
              className="flex items-center justify-between p-3 rounded-lg border border-[#D9DFEA] hover:bg-[#F1F4F9] cursor-pointer transition-colors"
            >
              <div>
                <h4 className="text-sm font-semibold text-[#182235]">Chart of Accounts Hierarchy</h4>
                <p className="text-xs text-[#5E6A7D]">Manage Statement Classes, Groups, Subgroups and Leaf Accounts</p>
              </div>
              <Badge variant="brand">COA</Badge>
            </div>

            <div
              onClick={() => onNavigate('journals')}
              className="flex items-center justify-between p-3 rounded-lg border border-[#D9DFEA] hover:bg-[#F1F4F9] cursor-pointer transition-colors"
            >
              <div>
                <h4 className="text-sm font-semibold text-[#182235]">Journal Vouchers & Postings</h4>
                <p className="text-xs text-[#5E6A7D]">Draft, validate, approve, post and linked reverse double-entry vouchers</p>
              </div>
              <Badge variant="success">GL</Badge>
            </div>

            <div
              onClick={() => onNavigate('trial-balance')}
              className="flex items-center justify-between p-3 rounded-lg border border-[#D9DFEA] hover:bg-[#F1F4F9] cursor-pointer transition-colors"
            >
              <div>
                <h4 className="text-sm font-semibold text-[#182235]">Trial Balance & General Ledger</h4>
                <p className="text-xs text-[#5E6A7D]">Reconciled accounting trial balance with drilldown</p>
              </div>
              <Badge variant="info">Reports</Badge>
            </div>

            <div
              onClick={() => onNavigate('periods')}
              className="flex items-center justify-between p-3 rounded-lg border border-[#D9DFEA] hover:bg-[#F1F4F9] cursor-pointer transition-colors"
            >
              <div>
                <h4 className="text-sm font-semibold text-[#182235]">Fiscal Periods & Posting Guards</h4>
                <p className="text-xs text-[#5E6A7D]">Control open, soft-closed, and hard-closed fiscal windows</p>
              </div>
              <Badge variant="warning">Periods</Badge>
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
                <span className="font-semibold text-[#182235]">Leaf-Only Posting:</span> Only Level 4 accounts accept financial journal lines. Parent headings (L1-L3) are aggregate-only.
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
