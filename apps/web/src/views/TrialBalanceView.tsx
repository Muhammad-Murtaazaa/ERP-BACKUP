import React, { useState, useEffect } from 'react';
import { ApiClient } from '../api/client.js';
import { Table, Button, Input, Card } from '@omnysync/ui';
import { RefreshCw, AlertTriangle, ShieldCheck, Printer, Download, FileSpreadsheet } from 'lucide-react';
import { AccountLedgerSummary, TrialBalanceReport } from '@omnysync/financial-engine';
import { fmtMoney } from '../lib/format.js';
import {
  exportToCsv,
  exportToExcel,
  printHtmlDocument,
  renderTrialBalancePrintHtml,
} from '../lib/exportUtils.js';

export const TrialBalanceView: React.FC = () => {
  const [report, setReport] = useState<TrialBalanceReport | null>(null);
  const [asOfDate, setAsOfDate] = useState('2026-03-31');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [hideZeroBalances, setHideZeroBalances] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await ApiClient.get(`/ledger/trial-balance?as_of_date=${asOfDate}`);
      setReport(data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
      console.error('Failed to load trial balance:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [asOfDate]);

  const handleExportCsv = () => {
    if (!report?.accounts) return;
    exportToCsv(report.accounts, `Trial-Balance-${asOfDate}`, [
      { header: 'Account Code', key: 'account_code' },
      { header: 'Account Name', key: 'account_name' },
      { header: 'Statement Class', key: 'statement_class' },
      { header: 'Total Debit (PKR)', key: 'total_debit', formatter: (v) => fmtMoney(v) },
      { header: 'Total Credit (PKR)', key: 'total_credit', formatter: (v) => fmtMoney(v) },
      { header: 'Net Balance (PKR)', key: 'net_balance', formatter: (v) => fmtMoney(v) },
    ]);
  };

  const handleExportExcel = () => {
    if (!report?.accounts) return;
    exportToExcel(report.accounts, `Trial-Balance-${asOfDate}`, 'Trial Balance', [
      { header: 'Account Code', key: 'account_code' },
      { header: 'Account Name', key: 'account_name' },
      { header: 'Statement Class', key: 'statement_class' },
      { header: 'Total Debit (PKR)', key: 'total_debit', formatter: (v) => fmtMoney(v) },
      { header: 'Total Credit (PKR)', key: 'total_credit', formatter: (v) => fmtMoney(v) },
      { header: 'Net Balance (PKR)', key: 'net_balance', formatter: (v) => fmtMoney(v) },
    ]);
  };

  const handlePrintStatement = () => {
    if (!report) return;
    const html = renderTrialBalancePrintHtml(report, asOfDate, 'ERP SAMPLE');
    printHtmlDocument(html, `Trial-Balance-Statement-${asOfDate}`);
  };

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
        <div className="flex items-center gap-2.5 flex-wrap">
          <Input
            type="date"
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
            className="w-36"
          />
          <Button variant="secondary" size="sm" onClick={handleExportCsv} title="Export to CSV">
            <Download size={13} className="mr-1" /> Export CSV
          </Button>
          <Button variant="secondary" size="sm" onClick={handleExportExcel} title="Export to Excel">
            <FileSpreadsheet size={13} className="mr-1" /> Export Excel
          </Button>
          <Button variant="secondary" size="sm" onClick={handlePrintStatement} title="Print Statement (PDF)">
            <Printer size={13} className="mr-1" /> Print PDF
          </Button>
          <Button variant="primary" size="sm" onClick={loadData} isLoading={loading}>
            <RefreshCw size={13} className="mr-1" /> Recompute
          </Button>
        </div>
      </div>

      {/* Balancing Status Card */}
      {report && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="p-4">
            <span className="text-xs text-[#5E6A7D] uppercase font-semibold block">Total Debits (PKR)</span>
            <span className="text-lg font-bold font-mono text-[#0D6E51] mt-1 block">
              PKR {fmtMoney(report.total_debits)}
            </span>
          </Card>

          <Card className="p-4">
            <span className="text-xs text-[#5E6A7D] uppercase font-semibold block">Total Credits (PKR)</span>
            <span className="text-lg font-bold font-mono text-[#0D6E51] mt-1 block">
              PKR {fmtMoney(report.total_credits)}
            </span>
          </Card>

          <Card className={`p-4 ${report.is_balanced ? 'bg-[#EAF7EF]/40 border-[#c3edd2]' : 'bg-[#FDECEF]/40 border-[#f7c2c9]'}`}>
            <span className="text-xs text-[#5E6A7D] uppercase font-semibold block">Reconciliation Invariant</span>
            <div className="mt-1 flex items-center gap-2">
              {report.is_balanced ? (
                <>
                  <ShieldCheck className="text-[#0D6E51]" size={20} />
                  <span className="text-sm font-bold text-[#0D6E51]">Balanced (Difference: PKR 0.00)</span>
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

      {/* Filter and Search Bar */}
      <Card className="p-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <Input
              placeholder="Search by code, account, class..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-72"
            />
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-[#5E6A7D] flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hideZeroBalances}
                onChange={(e) => setHideZeroBalances(e.target.checked)}
                className="rounded text-[#0D6E51] focus:ring-[#10B981]"
              />
              Hide Zero-Balance Accounts
            </label>
          </div>
        </div>
      </Card>

      {/* Trial Balance Table */}
      <Card>
        <Table<AccountLedgerSummary>
          data={filteredAccounts}
          keyExtractor={(acc) => acc.account_id}
          isLoading={loading} error={loadError} onRetry={loadData}
          columns={[
            {
              key: 'account_code',
              header: 'Account Code',
              className: 'font-mono font-semibold text-[#0D6E51]',
            },
            {
              key: 'account_name',
              header: 'Account Name',
              className: 'font-medium',
            },
            {
              key: 'statement_class',
              header: 'Class',
              className: 'text-xs text-[#5E6A7D]',
            },
            {
              key: 'total_debit',
              header: 'Total Debit (PKR)',
              align: 'right',
              className: 'font-mono',
              render: (acc) => fmtMoney(acc.total_debit),
            },
            {
              key: 'total_credit',
              header: 'Total Credit (PKR)',
              align: 'right',
              className: 'font-mono',
              render: (acc) => fmtMoney(acc.total_credit),
            },
            {
              key: 'net_balance',
              header: 'Net Balance (PKR)',
              align: 'right',
              className: 'font-mono font-bold',
              render: (acc) => (
                <span className={acc.normal_balance === 'DEBIT' && Number(acc.net_balance) < 0 ? 'text-[#A82430]' : ''}>
                  {fmtMoney(acc.net_balance)} ({acc.normal_balance === 'DEBIT' ? 'Dr' : 'Cr'})
                </span>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
};
