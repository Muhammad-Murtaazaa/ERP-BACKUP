import React from 'react';
import { Badge, Table } from '@omnysync/ui';
import { ModuleWorkspace, TabDef } from '../kit/ModuleWorkspace.js';
import { fmtMoney } from '../../lib/format.js';
import { opts, partyRef, today } from './shared.js';

const instState = (r: any) => {
  const due = Number(r.principal) + Number(r.interest);
  const paid = Number(r.paid_principal || 0) + Number(r.paid_interest || 0);
  if (r.preview) return <Badge size="sm" variant="neutral">Preview</Badge>;
  if (paid >= due - 0.005) return <Badge size="sm" variant="success">Paid</Badge>;
  if (String(r.due_date).slice(0, 10) < today()) return <Badge size="sm" variant="danger">Overdue</Badge>;
  return paid > 0 ? <Badge size="sm" variant="warning">Partial</Badge> : <Badge size="sm" variant="info">Due</Badge>;
};

const tabs: TabDef[] = [
  {
    id: 'loans',
    label: 'Loans',
    endpoint: '/lnd/loans',
    statuses: ['DRAFT', 'SUBMITTED', 'APPROVED', 'ACTIVE', 'CLOSED', 'REJECTED'],
    searchPlaceholder: 'Search loan number or customer',
    columns: [
      { key: 'number', header: 'Loan' },
      { key: 'party_name', header: 'Customer' },
      { key: 'principal', header: 'Principal', kind: 'money' },
      { key: 'annual_rate', header: 'Rate %', align: 'right', render: (r) => Number(r.annual_rate).toFixed(2) },
      { key: 'term_months', header: 'Term', align: 'right', render: (r) => `${r.term_months} mo` },
      { key: 'outstanding_principal', header: 'Outstanding', kind: 'money' },
      { key: 'next_due_date', header: 'Next due', kind: 'date' },
      { key: 'overdue_amount', header: 'Overdue', align: 'right', render: (r) => (Number(r.overdue_amount) > 0 ? <span className="text-[#C62828] font-medium">{fmtMoney(r.overdue_amount)}</span> : '—') },
      { key: 'status', header: 'Status', kind: 'status' },
    ],
    detailFields: [
      { key: 'purpose', header: 'Purpose' },
      { key: 'method', header: 'Method' },
      { key: 'application_date', header: 'Applied', kind: 'date' },
      { key: 'disbursement_date', header: 'Disbursed', kind: 'date' },
      { key: 'decision_note', header: 'Decision note' },
    ],
    detailExtra: (row) => (
      <div className="flex flex-col gap-3">
        <div className="text-sm font-semibold">Schedule{row.schedule?.[0]?.preview ? ' (preview — generated at disbursement)' : ''}</div>
        <Table
          columns={[
            { key: 'seq', header: '#' },
            { key: 'due_date', header: 'Due', render: (r: any) => String(r.due_date).slice(0, 10) },
            { key: 'principal', header: 'Principal', align: 'right', render: (r: any) => fmtMoney(r.principal) },
            { key: 'interest', header: 'Interest', align: 'right', render: (r: any) => fmtMoney(r.interest) },
            { key: 'total', header: 'Instalment', align: 'right', render: (r: any) => fmtMoney(Number(r.principal) + Number(r.interest)) },
            { key: 'state', header: '', render: instState },
          ]}
          data={row.schedule || []}
          keyExtractor={(r: any) => String(r.seq)}
        />
        <div className="text-sm font-semibold">Repayments</div>
        <Table columns={[{ key: 'payment_date', header: 'Date', render: (r: any) => String(r.payment_date).slice(0, 10) }, { key: 'reference', header: 'Reference' }, { key: 'amount', header: 'Amount', align: 'right', render: (r: any) => fmtMoney(r.amount) }, { key: 'interest_part', header: 'Interest', align: 'right', render: (r: any) => fmtMoney(r.interest_part) }, { key: 'principal_part', header: 'Principal', align: 'right', render: (r: any) => fmtMoney(r.principal_part) }, { key: 'journal_number', header: 'Journal' }]} data={row.repayments || []} keyExtractor={(r: any) => r.id} emptyMessage="No repayments yet." />
      </div>
    ),
    createLabel: 'New loan application',
    createFields: [
      partyRef('party_id', 'Customer'),
      { name: 'principal', label: 'Principal (PKR)', type: 'decimal', required: true },
      { name: 'annual_rate', label: 'Annual rate %', type: 'decimal', required: true, default: '16' },
      { name: 'term_months', label: 'Term (months)', type: 'int', required: true, default: '12' },
      { name: 'method', label: 'Repayment method', type: 'select', options: opts('ANNUITY', 'EQUAL_PRINCIPAL'), default: 'ANNUITY', hint: 'Annuity = level instalments; equal principal = declining instalments.' },
      { name: 'purpose', label: 'Purpose', type: 'textarea' },
    ],
    editFields: [{ name: 'principal', label: 'Principal', type: 'decimal' }, { name: 'annual_rate', label: 'Annual rate %', type: 'decimal' }, { name: 'term_months', label: 'Term (months)', type: 'int' }, { name: 'purpose', label: 'Purpose', type: 'textarea' }],
    actions: [
      { id: 'submit', label: 'Submit for approval', variant: 'primary', when: ['DRAFT'] },
      { id: 'approve', label: 'Approve', variant: 'primary', when: ['SUBMITTED'], fields: [{ name: 'decision_note', label: 'Note', type: 'textarea' }], confirm: 'The submitter cannot approve their own application.' },
      { id: 'reject', label: 'Reject', variant: 'destructive', when: ['SUBMITTED'], fields: [{ name: 'decision_note', label: 'Reason', type: 'textarea', required: true }] },
      { id: 'disburse', label: 'Disburse', variant: 'primary', when: ['APPROVED'], fields: [{ name: 'disbursement_date', label: 'Disbursement date', type: 'date', default: today() }, { name: 'first_due_date', label: 'First instalment due (default +1 month)', type: 'date' }], confirm: 'Posts DR loans receivable / CR bank once and fixes the schedule. The approver cannot disburse.' },
      { id: 'repay', label: 'Record repayment', variant: 'primary', when: ['ACTIVE'], path: (r) => `/lnd/loans/${r.id}/repayments`, fields: [{ name: 'amount', label: 'Amount received', type: 'decimal', required: true }, { name: 'reference', label: 'Receipt / bank reference', type: 'text', required: true }, { name: 'payment_date', label: 'Payment date', type: 'date', default: today() }], success: 'Repayment posted (interest first, then principal)' },
    ],
  },
];

export const LendingView: React.FC = () => (
  <ModuleWorkspace
    id="lnd"
    title="Customer Financing"
    description="Instalment financing for equipment: applications with maker-checker approval, amortisation schedules, one-time disbursement posting, and interest-first repayment allocation."
    tabs={tabs}
    summaryEndpoint="/lnd/summary"
    kpis={(s) => [
      { label: 'Outstanding principal', value: fmtMoney(s.outstanding), sub: `${s.active} active loans`, tone: 'brand' },
      { label: 'Overdue', value: fmtMoney(s.overdue), sub: `${s.overdue_loans} loans`, tone: Number(s.overdue) > 0 ? 'danger' : 'success' },
      { label: 'Pipeline', value: s.pipeline, sub: 'submitted / approved' },
      { label: 'Interest collected (MTD)', value: fmtMoney(s.interest_mtd) },
    ]}
  />
);
