import React, { useEffect, useMemo, useState } from 'react';
import { ApiClient } from '../../api/client.js';
import { Alert, Badge, Button, Combobox, Input, Table } from '@omnysync/ui';
import { ModuleWorkspace, TabDef } from '../kit/ModuleWorkspace.js';
import { fmtMoney } from '../../lib/format.js';
import { opts } from './shared.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const LinesGrid: React.FC<{ row: any; reload: () => void }> = ({ row, reload }) => {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [account, setAccount] = useState<string>('');
  const [annual, setAnnual] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const draft = row.status === 'DRAFT';
  useEffect(() => {
    if (draft) ApiClient.get('/coa/accounts').then((a: any[]) => setAccounts(a.filter((x) => x.posting_allowed && ['REVENUE', 'EXPENSE'].includes(x.statement_class)))).catch(() => setAccounts([]));
  }, [draft]);
  const pivot = useMemo(() => {
    const m = new Map<string, any>();
    for (const l of row.lines || []) {
      const e = m.get(l.account_id) || { id: l.account_id, account: `${l.account_code} · ${l.account_name}`, cls: l.statement_class, months: Array(12).fill(0), total: 0 };
      e.months[l.period_month - 1] = Number(l.amount);
      e.total += Number(l.amount);
      m.set(l.account_id, e);
    }
    return [...m.values()];
  }, [row]);
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await ApiClient.post(`/epm/budgets/${row.id}/lines`, { lines: [{ account_id: account, annual }] });
      setAnnual('');
      reload();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm font-semibold">Budget lines</div>
      {!draft && <Alert variant="info">This version is {String(row.status).toLowerCase()} and locked. Use “Revise” to open a new version.</Alert>}
      <div className="overflow-x-auto">
        <Table
          columns={[
            { key: 'account', header: 'Account', render: (r: any) => <span>{r.account} <Badge size="sm" variant={r.cls === 'REVENUE' ? 'success' : 'neutral'}>{r.cls}</Badge></span> },
            ...MONTHS.map((m, i) => ({ key: `m${i}`, header: m, align: 'right' as const, render: (r: any) => (r.months[i] / 1000).toFixed(0) + 'k' })),
            { key: 'total', header: 'Annual', align: 'right' as const, render: (r: any) => fmtMoney(r.total) },
          ]}
          data={pivot}
          keyExtractor={(r: any) => r.id}
          emptyMessage="No lines yet."
        />
      </div>
      {draft && (
        <div className="flex items-end gap-2">
          <div className="min-w-[260px] flex-1">
            <Combobox label="Account" value={account} onValueChange={(v) => setAccount(v || '')} options={accounts.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))} />
          </div>
          <Input label="Annual amount (spread evenly)" value={annual} onChange={(e) => setAnnual(e.target.value)} />
          <Button onClick={save} disabled={busy || !account || !annual}>Set line</Button>
        </div>
      )}
      {err && <Alert variant="danger">{err}</Alert>}
    </div>
  );
};

const Variance: React.FC<{ reloadKey: number }> = ({ reloadKey }) => {
  const [budgets, setBudgets] = useState<any[]>([]);
  const [sel, setSel] = useState('');
  const [through, setThrough] = useState(String(new Date().getMonth() + 1));
  const [data, setData] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    ApiClient.get('/epm/budgets?status=APPROVED').then((b: any[]) => {
      setBudgets(b);
      if (b[0] && !sel) setSel(b[0].id);
    }).catch((e) => setErr(e.message));
  }, [reloadKey]);
  useEffect(() => {
    if (!sel) return;
    ApiClient.get(`/epm/budgets/${sel}/variance?through_month=${through}`).then((d) => { setData(d); setErr(null); }).catch((e) => setErr(e.message));
  }, [sel, through]);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end gap-3">
        <div className="min-w-[280px]"><Combobox label="Approved budget" value={sel} onValueChange={(v) => setSel(v || '')} options={budgets.map((b) => ({ value: b.id, label: `${b.code} v${b.version} · FY${b.fiscal_year}` }))} /></div>
        <div className="w-40"><Combobox label="Through month" value={through} onValueChange={(v) => setThrough(v || '12')} options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} /></div>
      </div>
      {err && <Alert variant="danger">{err}</Alert>}
      {!budgets.length && !err && <Alert variant="info">No approved budget yet — submit and approve one on the Budgets tab.</Alert>}
      {data && (
        <>
          <div className="grid grid-cols-3 gap-3 text-sm">
            {[['Revenue', data.totals.revenue_budget, data.totals.revenue_actual], ['Expense', data.totals.expense_budget, data.totals.expense_actual], ['Profit', data.totals.profit_budget, data.totals.profit_actual]].map(([l, b, a]) => (
              <div key={l} className="rounded-lg border border-[#E3E7ED] p-3"><div className="text-[#5B6472]">{l} YTD</div><div className="font-semibold">{fmtMoney(a)} <span className="text-[#5B6472] font-normal">of {fmtMoney(b)}</span></div></div>
            ))}
          </div>
          <Table
            columns={[
              { key: 'code', header: 'Account', render: (r: any) => `${r.code} · ${r.name}` },
              { key: 'statement_class', header: 'Class' },
              { key: 'budget', header: 'Budget', align: 'right', render: (r: any) => fmtMoney(r.budget) },
              { key: 'actual', header: 'Actual', align: 'right', render: (r: any) => fmtMoney(r.actual) },
              { key: 'variance', header: 'Variance', align: 'right', render: (r: any) => <span className={r.favourable ? 'text-[#1B7F3B]' : 'text-[#C62828]'}>{fmtMoney(r.variance)}{r.variance_pct !== null ? ` (${r.variance_pct}%)` : ''}</span> },
              { key: 'unbudgeted', header: '', render: (r: any) => (r.unbudgeted ? <Badge size="sm" variant="warning">Unbudgeted</Badge> : null) },
            ]}
            data={data.rows}
            keyExtractor={(r: any) => r.account_id}
            emptyMessage="No budget lines or postings in this window."
          />
        </>
      )}
    </div>
  );
};

const tabs: TabDef[] = [
  {
    id: 'budgets',
    label: 'Budgets',
    endpoint: '/epm/budgets',
    statuses: ['DRAFT', 'SUBMITTED', 'APPROVED', 'SUPERSEDED', 'ARCHIVED'],
    columns: [
      { key: 'code', header: 'Code' },
      { key: 'name', header: 'Name' },
      { key: 'fiscal_year', header: 'FY' },
      { key: 'version', header: 'Version', render: (r) => `v${r.version}` },
      { key: 'scenario', header: 'Scenario', kind: 'badge' },
      { key: 'accounts', header: 'Accounts', align: 'right' },
      { key: 'total_amount', header: 'Total', kind: 'money' },
      { key: 'status', header: 'Status', kind: 'status' },
    ],
    detailFields: [{ key: 'notes', header: 'Notes' }, { key: 'submitted_at', header: 'Submitted', kind: 'datetime' }, { key: 'approved_at', header: 'Approved', kind: 'datetime' }],
    detailExtra: (row, reload) => <LinesGrid row={row} reload={reload} />,
    createLabel: 'New budget',
    createFields: [
      { name: 'code', label: 'Code', type: 'text', required: true, placeholder: 'FY2027-OPS' },
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'fiscal_year', label: 'Fiscal year', type: 'int', required: true, default: String(new Date().getFullYear() + 1) },
      { name: 'scenario', label: 'Scenario', type: 'select', options: opts('BUDGET', 'FORECAST'), default: 'BUDGET' },
      { name: 'copy_from_id', label: 'Copy lines from (optional)', type: 'ref', ref: { endpoint: '/epm/budgets', label: (r) => `${r.code} v${r.version} · FY${r.fiscal_year}` } },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
    editFields: [{ name: 'name', label: 'Name', type: 'text' }, { name: 'notes', label: 'Notes', type: 'textarea' }],
    actions: [
      { id: 'submit', label: 'Submit for approval', variant: 'primary', when: ['DRAFT'], confirm: 'Lines lock while the budget is under review.' },
      { id: 'approve', label: 'Approve', variant: 'primary', when: ['SUBMITTED'], confirm: 'The submitter cannot approve their own budget. Approval supersedes the previous live version.' },
      { id: 'reject', label: 'Send back', when: ['SUBMITTED'], fields: [{ name: 'notes', label: 'What to change', type: 'textarea', required: true }] },
      { id: 'revise', label: 'Revise (new version)', when: ['APPROVED'], confirm: 'Opens version n+1 as a draft copy; this version stays live until the new one is approved.' },
      { id: 'archive', label: 'Archive', variant: 'destructive', when: ['DRAFT', 'SUPERSEDED'] },
    ],
  },
  { id: 'variance', label: 'Budget vs actual', render: ({ reloadKey }) => <Variance reloadKey={reloadKey} /> },
];

export const BudgetsView: React.FC = () => (
  <ModuleWorkspace
    id="epm"
    title="Budgets & Planning"
    description="Versioned P&L budgets by account and month, approval with segregation of duties, locked approved versions, and live budget-vs-actual from posted journals."
    tabs={tabs}
    summaryEndpoint="/epm/summary"
    kpis={(s) => [
      { label: 'Approved budgets', value: s.approved, tone: 'brand' },
      { label: 'Awaiting approval', value: s.submitted, tone: s.submitted ? 'warning' : 'neutral' },
      { label: 'Drafts', value: s.draft },
      { label: 'Approved opex (this FY)', value: fmtMoney(s.approved_expense_budget) },
    ]}
  />
);
