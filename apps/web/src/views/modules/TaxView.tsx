import React, { useState } from 'react';
import { ApiClient } from '../../api/client.js';
import { Alert, Button, Input, Table } from '@omnysync/ui';
import { ModuleWorkspace, TabDef } from '../kit/ModuleWorkspace.js';
import { fmtMoney } from '../../lib/format.js';
import { opts, today } from './shared.js';

const Calculator: React.FC = () => {
  const [code, setCode] = useState('GST18');
  const [amount, setAmount] = useState('1000');
  const [date, setDate] = useState(today());
  const [inclusive, setInclusive] = useState(false);
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setErr(null);
      setRes(await ApiClient.post('/tax/calculate', { lines: [{ amount, tax_code: code, date, inclusive }] }));
    } catch (e: any) {
      setErr(e.message);
      setRes(null);
    }
  };
  return (
    <form onSubmit={run} className="flex flex-col gap-4 max-w-2xl">
      <p className="text-sm text-[#46536B]">Exact decimals, HALF_UP per line. Inclusive prices extract tax so net + tax always equals the price.</p>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
        <Input label="Tax code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        <Input label="Amount" value={amount} isMonetary onChange={(e) => setAmount(e.target.value)} />
        <Input label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <label className="flex items-center gap-2 text-sm min-h-9"><input type="checkbox" className="accent-[#5940B8]" checked={inclusive} onChange={(e) => setInclusive(e.target.checked)} /> Price includes tax</label>
      </div>
      <div><Button type="submit">Calculate</Button></div>
      {err && <Alert variant="danger" title="Couldn’t calculate">{err}</Alert>}
      {res && (
        <Table
          columns={[
            { key: 'tax_code', header: 'Code' },
            { key: 'rate', header: 'Rate %', align: 'right' },
            { key: 'net', header: 'Net', align: 'right', render: (r: any) => fmtMoney(r.net) },
            { key: 'tax', header: 'Tax', align: 'right', render: (r: any) => fmtMoney(r.tax) },
            { key: 'gross', header: 'Gross', align: 'right', render: (r: any) => fmtMoney(r.gross) },
          ]}
          data={res.lines}
          keyExtractor={(r: any) => r.tax_code + r.net}
        />
      )}
    </form>
  );
};

const tabs: TabDef[] = [
  {
    id: 'returns',
    label: 'Tax returns',
    endpoint: '/tax/returns',
    statuses: ['DRAFT', 'FILED', 'SETTLED', 'CANCELLED'],
    columns: [
      { key: 'number', header: 'Return' },
      { key: 'period_start', header: 'From', kind: 'date' },
      { key: 'period_end', header: 'To', kind: 'date' },
      { key: 'output_tax', header: 'Output tax', kind: 'money' },
      { key: 'input_tax', header: 'Input tax', kind: 'money' },
      { key: 'net_payable', header: 'Net payable', kind: 'money' },
      { key: 'status', header: 'Status', kind: 'status' },
    ],
    detailFields: [
      { key: 'number', header: 'Return' },
      { key: 'period_start', header: 'From', kind: 'date' },
      { key: 'period_end', header: 'To', kind: 'date' },
      { key: 'output_tax', header: 'Output tax (212001)', kind: 'money' },
      { key: 'input_tax', header: 'Input tax (114001)', kind: 'money' },
      { key: 'net_payable', header: 'Net payable', kind: 'money' },
      { key: 'filing_reference', header: 'Filing reference' },
      { key: 'filed_at', header: 'Filed', kind: 'datetime' },
      { key: 'settlement_journal_id', header: 'Settlement journal' },
    ],
    createLabel: 'Prepare return',
    createFields: [
      { name: 'period_start', label: 'Period start', type: 'date', required: true },
      { name: 'period_end', label: 'Period end', type: 'date', required: true },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
    actions: [
      { id: 'recalculate', label: 'Recalculate from ledger', when: ['DRAFT'] },
      { id: 'file', label: 'File return', variant: 'primary', when: ['DRAFT'], fields: [{ name: 'filing_reference', label: 'Authority reference', type: 'text', required: true }], confirm: 'The preparer cannot file their own return (segregation of duties).' },
      { id: 'settle', label: 'Record payment & post', variant: 'primary', when: ['FILED'], fields: [{ name: 'payment_date', label: 'Payment date', type: 'date', required: true, default: today() }], confirm: 'Posts DR output tax / CR input tax / CR bank in an open period.' },
      { id: 'cancel', label: 'Cancel draft', variant: 'destructive', when: ['DRAFT'] },
    ],
  },
  {
    id: 'codes',
    label: 'Tax codes',
    endpoint: '/tax/codes',
    statuses: ['ACTIVE', 'RETIRED'],
    columns: [
      { key: 'code', header: 'Code' },
      { key: 'name', header: 'Name' },
      { key: 'kind', header: 'Kind', kind: 'badge' },
      { key: 'rate', header: 'Rate %', align: 'right' },
      { key: 'is_inclusive', header: 'Inclusive', kind: 'bool' },
      { key: 'effective_from', header: 'From', kind: 'date' },
      { key: 'effective_to', header: 'To', kind: 'date' },
      { key: 'status', header: 'Status', kind: 'status' },
    ],
    createLabel: 'New tax code version',
    createFields: [
      { name: 'code', label: 'Code', type: 'text', required: true, placeholder: 'GST18' },
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'kind', label: 'Kind', type: 'select', required: true, options: opts('OUTPUT', 'INPUT', 'WITHHOLDING', 'EXEMPT') },
      { name: 'rate', label: 'Rate (%)', type: 'decimal', required: true },
      { name: 'is_inclusive', label: 'Prices include this tax', type: 'bool' },
      { name: 'account_code', label: 'GL account code', type: 'text', placeholder: '212001' },
      { name: 'effective_from', label: 'Effective from', type: 'date', required: true },
      { name: 'effective_to', label: 'Effective to', type: 'date', hint: 'Leave empty for open-ended. Versions of one code cannot overlap.' },
    ],
    editFields: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'effective_to', label: 'Effective to', type: 'date' },
      { name: 'account_code', label: 'GL account code', type: 'text' },
    ],
    actions: [{ id: 'retire', label: 'Retire', variant: 'destructive', when: ['ACTIVE'] }],
  },
  { id: 'calc', label: 'Calculator', render: () => <Calculator /> },
];

export const TaxView: React.FC = () => (
  <ModuleWorkspace
    id="tax"
    title="Tax Compliance"
    description="Effective-dated tax codes, returns derived from posted ledger balances, filing with preparer/filer segregation and a period-guarded settlement journal."
    tabs={tabs}
    summaryEndpoint="/tax/summary"
    kpis={(s) => [
      { label: 'Output tax (MTD)', value: fmtMoney(s.month_to_date.output) },
      { label: 'Input tax (MTD)', value: fmtMoney(s.month_to_date.input) },
      { label: 'Net payable (MTD)', value: fmtMoney(s.month_to_date.net), tone: Number(s.month_to_date.net) > 0 ? 'warning' : 'success' },
      { label: 'Returns filed / draft', value: `${s.returns.FILED || 0} / ${s.returns.DRAFT || 0}`, sub: `${s.active_codes} active codes` },
    ]}
  />
);
