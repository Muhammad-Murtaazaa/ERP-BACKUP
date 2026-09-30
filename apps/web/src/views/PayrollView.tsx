import React, { useState, useEffect } from 'react';
import { ApiClient } from '../api/client.js';
import { Table, Button, Input, Drawer, Badge, Card, Combobox } from '@omnysync/ui';
import { Plus, RefreshCw, CheckCircle2, DollarSign, Send, CheckCheck, FileText, ChevronRight } from 'lucide-react';
import { PayrollRun } from '@omnysync/contracts';
import { fmtMoney, fmtQty } from '../lib/format.js';

interface FiscalPeriod {
  id: string;
  name: string;
  status: string;
  fiscal_year?: number;
  period_number?: number;
}

export const PayrollView: React.FC = () => {
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [periods, setPeriods] = useState<FiscalPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<PayrollRun | null>(null);

  // New Payroll Run Modal State
  const [isNewRunModalOpen, setIsNewRunModalOpen] = useState(false);
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [monthYear, setMonthYear] = useState('2026-03');
  const [runNumber, setRunNumber] = useState(`PR-2026-03-${Date.now().toString().slice(-3)}`);
  const [calculationPreview, setCalculationPreview] = useState<any | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const loadData = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [runsData, periodsData] = await Promise.all([
        ApiClient.get('/hrm/payroll-runs'),
        ApiClient.get('/periods'),
      ]);
      setRuns(runsData);
      setPeriods(periodsData);
      if (periodsData.length > 0 && !selectedPeriodId) {
        const openP = periodsData.find((p: any) => p.status === 'OPEN');
        if (openP) setSelectedPeriodId(openP.id);
      }
      if (runsData.length > 0) {
        setActiveRun(runsData[0]);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
      console.error('Failed to load payroll data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCalculatePreview = async () => {
    if (!selectedPeriodId) return;
    setCalculating(true);
    setErrorMsg('');
    try {
      const preview = await ApiClient.post('/hrm/payroll/calculate', {
        period_id: selectedPeriodId,
        month_year: monthYear,
      });
      setCalculationPreview(preview);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to calculate payroll preview');
    } finally {
      setCalculating(false);
    }
  };

  const handleCreateRun = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg('');
    try {
      const newRun = await ApiClient.post('/hrm/payroll-runs', {
        period_id: selectedPeriodId,
        month_year: monthYear,
        run_number: runNumber,
      });
      setIsNewRunModalOpen(false);
      setCalculationPreview(null);
      await loadData();
      setActiveRun(newRun);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create payroll run');
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async () => {
    if (!activeRun) return;
    setActionLoading(true);
    try {
      await ApiClient.post(`/hrm/payroll-runs/${activeRun.id}/approve`, {});
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to approve payroll run');
    } finally {
      setActionLoading(false);
    }
  };

  const handlePostGL = async () => {
    if (!activeRun) return;
    setActionLoading(true);
    try {
      await ApiClient.post(`/hrm/payroll-runs/${activeRun.id}/post`, {});
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to post payroll run to GL');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDisburse = async () => {
    if (!activeRun) return;
    setActionLoading(true);
    try {
      await ApiClient.post(`/hrm/payroll-runs/${activeRun.id}/disburse`, {});
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to disburse payroll');
    } finally {
      setActionLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'DRAFT':
        return <Badge variant="neutral">Draft</Badge>;
      case 'APPROVED':
        return <Badge variant="warning">Approved</Badge>;
      case 'POSTED':
        return <Badge variant="info">Posted GL</Badge>;
      case 'DISBURSED':
        return <Badge variant="success"><CheckCircle2 size={12} className="mr-1" /> Disbursed</Badge>;
      default:
        return <Badge variant="neutral">{status}</Badge>;
    }
  };

  const runColumns = [
    {
      key: 'run_number',
      header: 'Run #',
      accessor: (r: PayrollRun) => (
        <span className={`font-mono font-bold ${activeRun?.id === r.id ? 'text-[#008060]' : 'text-gray-900'}`}>
          {r.run_number}
        </span>
      ),
    },
    { key: 'month_year', header: 'Month/Year', accessor: (r: PayrollRun) => <span className="font-semibold text-gray-800">{r.month_year}</span> },
    {
      key: 'gross',
      header: 'Gross Total',
      accessor: (r: PayrollRun) => (
        <span className="font-mono text-gray-900">
          PKR {fmtMoney(r.total_gross)}
        </span>
      ),
    },
    {
      key: 'tax',
      header: 'Tax Withheld',
      accessor: (r: PayrollRun) => (
        <span className="font-mono text-red-600">
          PKR {fmtMoney(r.total_tax)}
        </span>
      ),
    },
    {
      key: 'net',
      header: 'Net Payable',
      accessor: (r: PayrollRun) => (
        <span className="font-mono font-bold text-emerald-700">
          PKR {fmtMoney(r.total_net)}
        </span>
      ),
    },
    { key: 'status', header: 'Status', accessor: (r: PayrollRun) => getStatusBadge(r.status) },
    {
      key: 'actions',
      header: '',
      accessor: (r: PayrollRun) => (
        <Button variant="secondary" size="sm" onClick={() => setActiveRun(r)}>
          View <ChevronRight size={14} className="ml-1" />
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#202223]">Payroll Processing & Disbursements</h1>
          <p className="text-sm text-[#6D7175]">
            Gross-to-net calculations, progressive statutory tax withholdings, GL expense accruals, and bank disbursements.
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <Button variant="secondary" size="sm" onClick={loadData}>
            <RefreshCw size={14} className="mr-1" /> Refresh
          </Button>
          <Button variant="primary" size="sm" onClick={() => setIsNewRunModalOpen(true)}>
            <Plus size={14} className="mr-1" /> Process Monthly Payroll
          </Button>
        </div>
      </div>

      {/* Main Grid: Runs List + Active Run Detail */}
      <div className="grid grid-cols-12 gap-6">
        {/* Runs List */}
        <div className="col-span-12 lg:col-span-7 space-y-4">
          <Card title="Monthly Payroll Batches">
            <Table columns={runColumns} data={runs} keyExtractor={(r) => r.id} isLoading={loading} error={loadError} onRetry={loadData} emptyMessage="No payroll runs processed yet." />
          </Card>
        </div>

        {/* Run Details & Action Drawer */}
        <div className="col-span-12 lg:col-span-5 space-y-4">
          {activeRun ? (
            <Card title={`Batch: ${activeRun.run_number}`}>
              <div className="space-y-5">
                {/* Summary Box */}
                <div className="p-4 bg-[#F7F8F9] rounded-lg border border-[#E1E3E5] space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</span>
                    {getStatusBadge(activeRun.status)}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Month / Year:</span>
                    <span className="text-sm font-semibold text-gray-900">{activeRun.month_year}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Total Gross Salary:</span>
                    <span className="text-sm font-mono font-bold text-gray-900">
                      PKR {fmtMoney(activeRun.total_gross)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Withholding Tax (Income Tax):</span>
                    <span className="text-sm font-mono text-red-600">
                      - PKR {fmtMoney(activeRun.total_tax)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Statutory EOBI Pension:</span>
                    <span className="text-sm font-mono text-red-600">
                      - PKR {fmtMoney(activeRun.total_eobi)}
                    </span>
                  </div>
                  <div className="pt-2 border-t flex items-center justify-between">
                    <span className="text-sm font-bold text-gray-900">Total Net Disbursement:</span>
                    <span className="text-base font-mono font-bold text-emerald-700">
                      PKR {fmtMoney(activeRun.total_net)}
                    </span>
                  </div>
                </div>

                {/* Workflow Actions */}
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-gray-500 uppercase">Workflow Execution</div>
                  {activeRun.status === 'DRAFT' && (
                    <Button variant="primary" className="w-full justify-center" onClick={handleApprove} disabled={actionLoading}>
                      <CheckCheck size={16} className="mr-2" /> Approve Payroll Batch
                    </Button>
                  )}
                  {activeRun.status === 'APPROVED' && (
                    <Button variant="primary" className="w-full justify-center" onClick={handlePostGL} disabled={actionLoading}>
                      <FileText size={16} className="mr-2" /> Post to General Ledger (Dr Expense / Cr Payable)
                    </Button>
                  )}
                  {activeRun.status === 'POSTED' && (
                    <Button variant="primary" className="w-full justify-center" onClick={handleDisburse} disabled={actionLoading}>
                      <Send size={16} className="mr-2" /> Disburse Net Salaries via Bank Transfer
                    </Button>
                  )}
                  {activeRun.status === 'DISBURSED' && (
                    <div className="p-3 bg-emerald-50 text-emerald-800 rounded text-center text-sm font-semibold flex items-center justify-center">
                      <CheckCircle2 size={16} className="mr-2" /> Salaries Fully Disbursed & Reconciled
                    </div>
                  )}
                </div>

                {/* Individual Employee Payslips */}
                <div className="space-y-3">
                  <div className="text-xs font-semibold text-gray-500 uppercase">
                    Payslips in this Run ({activeRun.items?.length || 0})
                  </div>
                  <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                    {activeRun.items?.map((item) => (
                      <div key={item.id} className="p-3 bg-white border border-gray-200 rounded text-sm space-y-1">
                        <div className="flex justify-between items-center">
                          <span className="font-semibold text-gray-900">{item.employee_name || 'Employee'}</span>
                          <span className="font-mono text-xs font-bold text-blue-600">{item.employee_number}</span>
                        </div>
                        <div className="flex justify-between text-xs text-gray-600">
                          <span>Gross: PKR {fmtQty(item.gross_salary)}</span>
                          <span>Tax: PKR {fmtQty(item.tax_deduction)}</span>
                          <span className="font-bold text-emerald-700">Net: PKR {fmtQty(item.net_salary)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          ) : (
            <Card>
              <div className="p-8 text-center text-gray-500 text-sm">
                Select a payroll batch from the left to review details and execute workflow actions.
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Process Monthly Payroll Modal */}
      <Drawer isOpen={isNewRunModalOpen} onClose={() => setIsNewRunModalOpen(false)} title="Process Monthly Payroll Batch">
        <form onSubmit={handleCreateRun} className="space-y-4">
          {errorMsg && <div className="p-3 text-sm text-red-700 bg-red-50 rounded border border-red-200">{errorMsg}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Fiscal Period</label>
              <Combobox aria-label="Fiscal Period"
                value={selectedPeriodId}
                onChange={(e) => setSelectedPeriodId(e.target.value)}
                className="w-full"
                required
              >
                <option value="">Select Period...</option>
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.status})</option>
                ))}
              </Combobox>
            </div>
            <Input label="Payroll Month/Year" value={monthYear} onChange={(e) => setMonthYear(e.target.value)} placeholder="2026-03" required />
          </div>
          <Input label="Batch Reference Number" value={runNumber} onChange={(e) => setRunNumber(e.target.value)} required />

          <div className="flex justify-between items-center pt-2">
            <Button variant="secondary" size="sm" type="button" onClick={handleCalculatePreview} disabled={calculating}>
              <DollarSign size={14} className="mr-1" /> {calculating ? 'Calculating...' : 'Preview Employee Calculations'}
            </Button>
          </div>

          {calculationPreview && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded space-y-3">
              <div className="font-semibold text-emerald-900 text-sm">Gross-to-Net Summary Preview:</div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>Total Gross: <span className="font-mono font-bold">PKR {fmtQty(calculationPreview.totals.total_gross)}</span></div>
                <div>Income Tax: <span className="font-mono font-bold text-red-600">PKR {fmtQty(calculationPreview.totals.total_tax)}</span></div>
                <div>Net Payable: <span className="font-mono font-bold text-emerald-700">PKR {fmtQty(calculationPreview.totals.total_net)}</span></div>
              </div>
              <div className="text-xs text-gray-600">
                Ready to generate payslips for {calculationPreview.items.length} active employees.
              </div>
            </div>
          )}

          <div className="flex justify-end space-x-3 pt-4 border-t">
            <Button variant="secondary" type="button" onClick={() => setIsNewRunModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving || !calculationPreview}>
              {saving ? 'Creating Batch...' : 'Generate Payroll Batch'}
            </Button>
          </div>
        </form>
      </Drawer>
    </div>
  );
};
