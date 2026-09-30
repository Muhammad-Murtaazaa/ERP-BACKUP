import React, { useState } from 'react';
import { ApiClient } from '../../api/client.js';
import { Alert, Badge, Button, Input, Table } from '@omnysync/ui';
import { ModuleWorkspace, TabDef, FormField } from '../kit/ModuleWorkspace.js';
import { fmtMoney } from '../../lib/format.js';
import { opts, partyRef, today } from './shared.js';

const planRef: FormField = { name: 'plan_id', label: 'Plan', type: 'ref', required: true, ref: { endpoint: '/com/plans?status=ACTIVE', label: (r) => `${r.code} · ${r.name}`, description: (r) => `${fmtMoney(r.price)} / ${String(r.billing_interval).toLowerCase()}` } };

const BillingRun: React.FC<{ notify: (k: any, t: string) => void }> = ({ notify }) => {
  const [asOf, setAsOf] = useState(today());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await ApiClient.post('/com/billing-run', { as_of: asOf });
      setResult(r);
      notify(r.failed ? 'warning' : 'success', `Billing run: ${r.invoices} invoice(s), ${r.failed} failed`);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-4 max-w-4xl">
      <p className="text-sm text-[#5B6472]">Bills every active subscription whose next bill date is on or before the run date, in advance, one invoice per period (DR receivables / CR subscription revenue 411007 + output tax). Re-running is safe: a period is never billed twice, and a failure on one subscription (e.g. a closed period) does not block the others.</p>
      <div className="flex items-end gap-3">
        <Input label="Bill up to" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        <Button onClick={run} disabled={busy}>{busy ? 'Running…' : 'Run billing'}</Button>
      </div>
      {err && <Alert variant="danger">{err}</Alert>}
      {result && (
        <Table
          columns={[
            { key: 'subscription', header: 'Subscription', render: (r: any) => r.subscription || r.subscription_id },
            { key: 'invoices', header: 'Invoices', render: (r: any) => (r.invoices?.length ? r.invoices.join(', ') : '—') },
            { key: 'next_bill_date', header: 'Next bill', render: (r: any) => (r.ended ? 'Ended' : r.next_bill_date || '—') },
            { key: 'error', header: 'Result', render: (r: any) => (r.error ? <Badge variant="danger">{r.error}: {r.message}</Badge> : <Badge variant="success">OK</Badge>) },
          ]}
          data={result.results}
          keyExtractor={(r: any) => r.subscription || r.subscription_id}
          emptyMessage="Nothing due on this date."
        />
      )}
    </div>
  );
};

const tabs: TabDef[] = [
  {
    id: 'subscriptions',
    label: 'Subscriptions',
    endpoint: '/com/subscriptions',
    statuses: ['DRAFT', 'ACTIVE', 'PAUSED', 'CANCELLED', 'ENDED'],
    searchPlaceholder: 'Search number, customer or plan',
    columns: [
      { key: 'number', header: 'Number' },
      { key: 'party_name', header: 'Customer' },
      { key: 'plan_name', header: 'Plan' },
      { key: 'quantity', header: 'Qty', align: 'right' },
      { key: 'period_amount', header: 'Per period', kind: 'money' },
      { key: 'billing_interval', header: 'Cycle', kind: 'badge' },
      { key: 'next_bill_date', header: 'Next bill', kind: 'date' },
      { key: 'periods_billed', header: 'Billed', align: 'right' },
      { key: 'status', header: 'Status', kind: 'status' },
    ],
    detailFields: [
      { key: 'number', header: 'Number' },
      { key: 'party_name', header: 'Customer' },
      { key: 'plan_name', header: 'Plan' },
      { key: 'discount_pct', header: 'Discount %' },
      { key: 'start_date', header: 'Start', kind: 'date' },
      { key: 'end_date', header: 'End', kind: 'date' },
      { key: 'service_contract_id', header: 'AMC contract', render: (r) => (r.service_contract_id ? 'Linked in Field Service' : '—') },
      { key: 'cancel_reason', header: 'Cancel reason' },
    ],
    detailExtra: (row) => (
      <div className="flex flex-col gap-2">
        <div className="text-sm font-semibold">Billed periods</div>
        <Table columns={[{ key: 'period_start', header: 'From', render: (r: any) => String(r.period_start).slice(0, 10) }, { key: 'period_end', header: 'To', render: (r: any) => String(r.period_end).slice(0, 10) }, { key: 'net_amount', header: 'Net', align: 'right', render: (r: any) => fmtMoney(r.net_amount) }, { key: 'invoice_number', header: 'Invoice' }]} data={row.periods || []} keyExtractor={(r: any) => r.id} emptyMessage="Not billed yet." />
      </div>
    ),
    createLabel: 'New subscription',
    createFields: [partyRef('party_id', 'Customer'), planRef, { name: 'quantity', label: 'Quantity (units / sites)', type: 'int', default: '1' }, { name: 'discount_pct', label: 'Discount %', type: 'decimal', default: '0' }, { name: 'start_date', label: 'Start date', type: 'date', required: true, default: today() }, { name: 'end_date', label: 'End date (optional)', type: 'date', hint: 'Final period is prorated by days.' }],
    editFields: [{ name: 'quantity', label: 'Quantity', type: 'int' }, { name: 'discount_pct', label: 'Discount %', type: 'decimal' }, { name: 'end_date', label: 'End date', type: 'date' }],
    actions: [
      { id: 'activate', label: 'Activate', variant: 'primary', when: ['DRAFT'], fields: [{ name: 'create_service_contract', label: 'Also create AMC service contract', type: 'select', options: [{ value: 'true', label: 'Yes — create AMC contract in Field Service' }, { value: 'false', label: 'No' }], default: 'true' }], transform: (p) => ({ create_service_contract: p.create_service_contract === 'true' || p.create_service_contract === true }) },
      { id: 'pause', label: 'Pause', when: ['ACTIVE'], confirm: 'Paused periods are not billed retroactively.' },
      { id: 'resume', label: 'Resume', variant: 'primary', when: ['PAUSED'] },
      { id: 'cancel', label: 'Cancel', variant: 'destructive', when: ['DRAFT', 'ACTIVE', 'PAUSED'], fields: [{ name: 'cancel_reason', label: 'Reason', type: 'textarea', required: true }] },
    ],
  },
  {
    id: 'plans',
    label: 'Plans',
    endpoint: '/com/plans',
    statuses: ['ACTIVE', 'RETIRED'],
    columns: [
      { key: 'code', header: 'Code' },
      { key: 'name', header: 'Plan' },
      { key: 'billing_interval', header: 'Cycle', kind: 'badge' },
      { key: 'price', header: 'Price', kind: 'money' },
      { key: 'tax_rate', header: 'Tax %', align: 'right' },
      { key: 'visits_per_year', header: 'Visits / yr', align: 'right' },
      { key: 'active_subscriptions', header: 'Active subs', align: 'right' },
      { key: 'status', header: 'Status', kind: 'status' },
    ],
    detailFields: [{ key: 'description', header: 'Description' }, { key: 'item_code', header: 'Invoice item' }],
    createLabel: 'New plan',
    createFields: [
      { name: 'code', label: 'Code', type: 'text', required: true, placeholder: 'AMC-GOLD' },
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'billing_interval', label: 'Billing cycle', type: 'select', options: opts('MONTHLY', 'QUARTERLY', 'ANNUAL'), default: 'MONTHLY' },
      { name: 'price', label: 'Price per cycle (PKR)', type: 'decimal', required: true },
      { name: 'tax_rate', label: 'Tax rate %', type: 'decimal', default: '18' },
      { name: 'item_id', label: 'Invoice item', type: 'ref', required: true, ref: { endpoint: '/items?item_type=SERVICE', label: (r) => `${r.code} · ${r.name}` } },
      { name: 'visits_per_year', label: 'Preventive visits / year', type: 'int', default: '0' },
      { name: 'description', label: 'Description', type: 'textarea' },
    ],
    editFields: [{ name: 'name', label: 'Name', type: 'text' }, { name: 'visits_per_year', label: 'Visits / year', type: 'int' }, { name: 'description', label: 'Description', type: 'textarea' }],
    actions: [{ id: 'retire', label: 'Retire plan', variant: 'destructive', when: ['ACTIVE'], confirm: 'Existing subscriptions keep billing; no new subscriptions.' }],
  },
  { id: 'billing', label: 'Billing run', render: ({ notify }) => <BillingRun notify={notify} /> },
];

export const SubscriptionsView: React.FC = () => (
  <ModuleWorkspace
    id="com"
    title="Subscriptions & AMC"
    description="Recurring maintenance plans: subscriptions billed in advance on their anniversary, idempotent billing runs, prorated final periods, and optional AMC contracts in Field Service."
    tabs={tabs}
    summaryEndpoint="/com/summary"
    kpis={(s) => [
      { label: 'MRR', value: fmtMoney(s.mrr), sub: `ARR ${fmtMoney(s.arr)}`, tone: 'brand' },
      { label: 'Active subscriptions', value: s.active, sub: `${s.paused} paused` },
      { label: 'Billed this month', value: fmtMoney(s.billed_this_month) },
      { label: 'Churned this month', value: s.churned_this_month, tone: s.churned_this_month ? 'warning' : 'success' },
    ]}
  />
);
