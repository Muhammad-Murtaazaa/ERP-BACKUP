import React, { useState, useEffect } from 'react';
import { ApiClient } from '../api/client.js';
import { Table, Button, Input, Badge, Card } from '@omnysync/ui';
import { RefreshCw, AlertTriangle, ShieldCheck } from 'lucide-react';
import { AccountLedgerSummary, TrialBalanceReport } from '@omnysync/financial-engine';

export const TrialBalanceView: React.FC = () => {
  const [report, setReport] = useState<TrialBalanceReport | null>(null);
  const [asOfDate, setAsOfDate] = useState('2026-03-31');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [hideZeroBalances, setHideZeroBalances] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await ApiClient.get(`/ledger/trial-balance?as_of_date=${asOfDate}`);
      setReport(data);
    } catch (err) {
      console.error('Failed to load trial balance:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [asOfDate]);

  const filteredAccounts = (report?.accounts || []).filter((acc) => {
    const matchesSearch =
      acc.account_code.toLowerCase().includes(search.toLowerCase()) ||
      acc.account_name.toLowerCase().includes(search.toLowerCase()) ||
      acc.statement_class.toLowerCase().includes(search.toLowerCase());

    if (!matchesSearch) return false;
    if (hideZeroBalances) {
      return acc.total_debit !== '0.00' || acc.total_credit !== '0.00' || acc.net_balance !== '0.00';
    }
    return true;
  });

  return (
    <div className="flex flex-col gap-6 text-left">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#182235]">General Ledger Trial Balance</h1>
          <p className="text-xs text-[#5E6A7D] mt-0.5">
            Authoritative financial double-entry reconciliation report across all leaf accounts
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Input
            type="date"
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
            className="w-40"
          />
          <Button variant="secondary" size="sm" onClick={loadData} isLoading={loading}>
            <RefreshCw size={13} className="mr-1" /> Recompute
          </Button>
        </div>
      </div>

      {/* Balancing Status Card */}
      {report && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="p-4">
            <span className="text-xs text-[#5E6A7D] uppercase font-semibold block">Total Debits (PKR)</span>
            <span className="text-lg font-bold font-mono text-[#182235] mt-1 block">
              PKR {parseFloat(report.total_debits).toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
          </Card>

          <Card className="p-4">
            <span className="text-xs text-[#5E6A7D] uppercase font-semibold block">Total Credits (PKR)</span>
            <span className="text-lg font-bold font-mono text-[#182235] mt-1 block">
              PKR {parseFloat(report.total_credits).toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
          </Card>

          <Card className={`p-4 ${report.is_balanced ? 'bg-[#EAF7EF]/40 border-[#c3edd2]' : 'bg-[#FDECEF]/40 border-[#f7c2c9]'}`}>
            <span className="text-xs text-[#5E6A7D] uppercase font-semibold block">Reconciliation Invariant</span>
            <div className="mt-1 flex items-center gap-2">
              {report.is_balanced ? (
                <>
                  <ShieldCheck className="text-[#146341]" size={20} />
                  <span className="text-sm font-bold text-[#146341]">Balanced (Difference: PKR 0.00)</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="text-[#A82430]" size={20} />
                  <span className="text-sm font-bold text-[#A82430]">Unbalanced (Difference: PKR {report.net_difference})</span>
                </>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Account Balance Table */}
      <Card>
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-4">
          <Input
            placeholder="Filter accounts by code, name, or class..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />

          <label className="flex items-center gap-2 text-xs font-medium text-[#46536B] cursor-pointer">
            <input
              type="checkbox"
              checked={hideZeroBalances}
              onChange={(e) => setHideZeroBalances(e.target.checked)}
              className="rounded text-[#5940B8] focus:ring-[#5B3CC4]"
            />
            Hide accounts with zero balance
          </label>
        </div>

        <Table<AccountLedgerSummary>
          data={filteredAccounts}
          keyExtractor={(a) => a.account_id}
          isLoading={loading}
          columns={[
            { key: 'account_code', header: 'Code', className: 'font-mono font-semibold text-[#5940B8]' },
            { key: 'account_name', header: 'Account Name' },
            {
              key: 'level',
              header: 'Level',
              render: (a) => <Badge size="sm">L{a.level}</Badge>,
            },
            { key: 'statement_class', header: 'Class' },
            { key: 'normal_balance', header: 'Nature' },
            {
              key: 'total_debit',
              header: 'Total Debit (PKR)',
              align: 'right',
              render: (a) =>
                a.level === 4
                  ? parseFloat(a.total_debit).toLocaleString('en-US', { minimumFractionDigits: 2 })
                  : '---',
            },
            {
              key: 'total_credit',
              header: 'Total Credit (PKR)',
              align: 'right',
              render: (a) =>
                a.level === 4
                  ? parseFloat(a.total_credit).toLocaleString('en-US', { minimumFractionDigits: 2 })
                  : '---',
            },
            {
              key: 'net_balance',
              header: 'Net Balance (PKR)',
              align: 'right',
              className: 'font-bold',
              render: (a) =>
                parseFloat(a.net_balance).toLocaleString('en-US', { minimumFractionDigits: 2 }),
            },
          ]}
        />
      </Card>
    </div>
  );
};
