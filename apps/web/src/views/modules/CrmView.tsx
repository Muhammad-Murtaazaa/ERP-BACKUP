import React, { useEffect, useState } from 'react';
import { ApiClient } from '../../api/client.js';
import { Alert, Badge, Card } from '@omnysync/ui';
import { ModuleWorkspace, TabDef } from '../kit/ModuleWorkspace.js';
import { fmtMoney } from '../../lib/format.js';
import { opts, partyRef } from './shared.js';

const STAGES = ['PROSPECTING', 'QUALIFICATION', 'SITE_SURVEY', 'PROPOSAL', 'NEGOTIATION'];

/** Pipeline board: one column per open stage with count, total and weighted value. */
const Pipeline: React.FC<{ reloadKey: number }> = ({ reloadKey }) => {
  const [rows, setRows] = useState<any[] | null>(null);
  const [sum, setSum] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([ApiClient.get('/crm/opportunities?status=OPEN&limit=500'), ApiClient.get('/crm/summary')])
      .then(([r, s]: any) => {
        setRows(r);
        setSum(s);
      })
      .catch((e) => setErr(e.message));
  }, [reloadKey]);
  if (err) return <Alert variant="danger" title="Couldn’t load the pipeline">{err}</Alert>;
  if (!rows || !sum) return <p className="text-sm text-[#46536B]">Loading pipeline…</p>;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-[#46536B]">
        Weighted forecast <strong className="text-[#161B26]">{fmtMoney(sum.weighted_forecast)}</strong> of {fmtMoney(sum.pipeline_total)} open pipeline. Move deals from the Opportunities tab (record → Change stage / Won / Lost).
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-3">
        {STAGES.map((s) => {
          const st = sum.pipeline.find((p: any) => p.stage === s) || { count: 0, amount: '0', weighted: '0' };
          return (
            <Card key={s} className="p-3 bg-[#F7F8FB] flex flex-col gap-2 min-h-40">
              <div>
                <div className="text-xs font-semibold tracking-wide text-[#46536B]">{s.replace('_', ' ')}</div>
                <div className="text-sm font-semibold">{st.count} · {fmtMoney(st.amount)}</div>
                <div className="text-[11px] text-[#46536B]">weighted {fmtMoney(st.weighted)}</div>
              </div>
              {rows.filter((r) => r.stage === s).map((r) => (
                <div key={r.id} className="rounded-md bg-white border border-[#E3E6EE] p-2 shadow-sm">
                  <div className="text-xs font-semibold truncate">{r.name}</div>
                  <div className="text-[11px] text-[#46536B] truncate">{r.party_name}</div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs font-medium">{fmtMoney(r.amount)}</span>
                    <Badge variant="info">{r.probability}%</Badge>
                  </div>
                </div>
              ))}
            </Card>
          );
        })}
      </div>
    </div>
  );
};

const tabs: TabDef[] = [
  { id: 'pipeline', label: 'Pipeline', render: ({ reloadKey }) => <Pipeline reloadKey={reloadKey} /> },
  {
    id: 'leads',
    label: 'Leads',
    endpoint: '/crm/leads',
    statuses: ['NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'DISQUALIFIED'],
    searchPlaceholder: 'Search name, company, email, phone…',
    columns: [
      { key: 'number', header: 'Lead' },
      { key: 'name', header: 'Name' },
      { key: 'company', header: 'Company' },
      { key: 'phone', header: 'Phone' },
      { key: 'source', header: 'Source', kind: 'badge' },
      { key: 'city', header: 'City' },
      { key: 'estimated_value', header: 'Est. value', kind: 'money' },
      { key: 'status', header: 'Status', kind: 'status' },
    ],
    detailFields: [
      { key: 'number', header: 'Lead' },
      { key: 'name', header: 'Name' },
      { key: 'company', header: 'Company' },
      { key: 'email', header: 'Email' },
      { key: 'phone', header: 'Phone' },
      { key: 'interest', header: 'Interest' },
      { key: 'estimated_value', header: 'Estimated value', kind: 'money' },
      { key: 'disqualify_reason', header: 'Disqualified because' },
    ],
    createLabel: 'New lead',
    createFields: [
      { name: 'name', label: 'Contact name', type: 'text', required: true },
      { name: 'company', label: 'Company / household', type: 'text' },
      { name: 'email', label: 'Email', type: 'text' },
      { name: 'phone', label: 'Phone', type: 'text', placeholder: '0300-1234567', hint: 'Email or phone is required. Both are checked for duplicates (+92/0 formats match).' },
      { name: 'source', label: 'Source', type: 'select', options: opts('WEBSITE', 'REFERRAL', 'WALK_IN', 'PHONE', 'SOCIAL', 'PARTNER', 'EVENT', 'OTHER'), default: 'WEBSITE' },
      { name: 'interest', label: 'Interested in', type: 'textarea' },
      { name: 'city', label: 'City', type: 'text' },
      { name: 'estimated_value', label: 'Estimated value', type: 'decimal' },
    ],
    editFields: [
      { name: 'name', label: 'Contact name', type: 'text', required: true },
      { name: 'company', label: 'Company', type: 'text' },
      { name: 'email', label: 'Email', type: 'text' },
      { name: 'phone', label: 'Phone', type: 'text' },
      { name: 'estimated_value', label: 'Estimated value', type: 'decimal' },
    ],
    actions: [
      { id: 'contact', label: 'Mark contacted', when: ['NEW'] },
      { id: 'qualify', label: 'Qualify', variant: 'primary', when: ['NEW', 'CONTACTED'] },
      { id: 'convert', label: 'Convert to customer & deal', variant: 'primary', when: ['QUALIFIED'], fields: [{ name: 'opportunity_name', label: 'Opportunity name', type: 'text', required: true }, { name: 'amount', label: 'Deal amount', type: 'decimal' }, { name: 'expected_close_date', label: 'Expected close', type: 'date' }, partyRef('party_id', 'Existing customer (optional)', false)], success: 'Converted — an existing customer with the same email/phone is reused' },
      { id: 'disqualify', label: 'Disqualify', variant: 'destructive', when: ['NEW', 'CONTACTED', 'QUALIFIED'], fields: [{ name: 'disqualify_reason', label: 'Reason', type: 'textarea', required: true }] },
    ],
  },
  {
    id: 'opportunities',
    label: 'Opportunities',
    endpoint: '/crm/opportunities',
    statuses: ['OPEN', 'WON', 'LOST'],
    columns: [
      { key: 'number', header: 'Deal' },
      { key: 'name', header: 'Name' },
      { key: 'party_name', header: 'Customer' },
      { key: 'stage', header: 'Stage', kind: 'badge' },
      { key: 'amount', header: 'Amount', kind: 'money' },
      { key: 'probability', header: 'Prob. %', align: 'right' },
      { key: 'weighted_amount', header: 'Weighted', kind: 'money' },
      { key: 'expected_close_date', header: 'Close', kind: 'date' },
      { key: 'status', header: 'Status', kind: 'status' },
    ],
    detailFields: [
      { key: 'number', header: 'Deal' },
      { key: 'party_name', header: 'Customer' },
      { key: 'stage', header: 'Stage' },
      { key: 'amount', header: 'Amount', kind: 'money' },
      { key: 'weighted_amount', header: 'Weighted', kind: 'money' },
      { key: 'lost_reason', header: 'Lost reason' },
      { key: 'lost_notes', header: 'Loss notes' },
      { key: 'closed_at', header: 'Closed', kind: 'datetime' },
    ],
    createLabel: 'New opportunity',
    createFields: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      partyRef(),
      { name: 'amount', label: 'Amount', type: 'decimal' },
      { name: 'expected_close_date', label: 'Expected close', type: 'date' },
    ],
    editFields: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'amount', label: 'Amount', type: 'decimal' },
      { name: 'expected_close_date', label: 'Expected close', type: 'date' },
    ],
    actions: [
      { id: 'stage', label: 'Change stage', when: ['OPEN'], fields: [{ name: 'stage', label: 'Stage', type: 'select', required: true, options: opts(...STAGES) }, { name: 'probability', label: 'Probability override (%)', type: 'int' }] },
      { id: 'win', label: 'Mark won', variant: 'primary', when: ['OPEN'], fields: [{ name: 'create_install_case', label: 'Open an installation service case', type: 'bool' }, { name: 'site_address', label: 'Installation site', type: 'textarea', when: (v) => v.create_install_case === 'true' }], success: 'Won — automation rules for won deals have been triggered' },
      { id: 'lose', label: 'Mark lost', variant: 'destructive', when: ['OPEN'], fields: [{ name: 'lost_reason', label: 'Reason', type: 'select', required: true, options: opts('PRICE', 'COMPETITOR', 'NO_BUDGET', 'TIMING', 'NO_RESPONSE', 'SCOPE', 'OTHER') }, { name: 'lost_notes', label: 'Notes', type: 'textarea' }] },
      { id: 'reopen', label: 'Reopen', when: ['LOST'] },
    ],
  },
  {
    id: 'activities',
    label: 'Activities',
    endpoint: '/crm/activities',
    statuses: ['OPEN', 'DONE', 'CANCELLED'],
    columns: [
      { key: 'activity_type', header: 'Type', kind: 'badge' },
      { key: 'subject', header: 'Subject' },
      { key: 'lead_name', header: 'Lead' },
      { key: 'opportunity_name', header: 'Deal' },
      { key: 'party_name', header: 'Customer' },
      { key: 'due_at', header: 'Due', render: (r) => (r.due_at ? <span className={r.overdue ? 'text-[#C62828] font-medium' : ''}>{new Date(r.due_at).toLocaleString('en-GB', { timeZone: 'Asia/Karachi', dateStyle: 'medium', timeStyle: 'short' })}{r.overdue ? ' · overdue' : ''}</span> : '—') },
      { key: 'status', header: 'Status', kind: 'status' },
    ],
    createLabel: 'New activity',
    createFields: [
      { name: 'activity_type', label: 'Type', type: 'select', required: true, options: opts('CALL', 'MEETING', 'EMAIL', 'SITE_VISIT', 'TASK', 'WHATSAPP') },
      { name: 'subject', label: 'Subject', type: 'text', required: true },
      { name: 'due_at', label: 'Due', type: 'datetime' },
      { name: 'opportunity_id', label: 'Opportunity', type: 'ref', ref: { endpoint: '/crm/opportunities?status=OPEN', label: (r) => `${r.number} · ${r.name}`, description: (r) => r.party_name } },
      { name: 'lead_id', label: 'Lead', type: 'ref', ref: { endpoint: '/crm/leads', label: (r) => `${r.number} · ${r.name}`, description: (r) => r.company || r.status } },
      { name: 'notes', label: 'Notes', type: 'textarea', hint: 'Link to a lead, deal or customer.' },
    ],
    actions: [
      { id: 'complete', label: 'Complete', variant: 'primary', when: ['OPEN'], fields: [{ name: 'outcome', label: 'Outcome', type: 'textarea', required: true }] },
      { id: 'cancel', label: 'Cancel', variant: 'destructive', when: ['OPEN'] },
    ],
  },
];

export const CrmView: React.FC = () => (
  <ModuleWorkspace
    id="crm"
    title="CRM"
    description="Lead capture with duplicate detection, one-step conversion to customer and deal, a staged HVAC sales pipeline with weighted forecast, and won/lost analysis with hand-off to field service."
    tabs={tabs}
    summaryEndpoint="/crm/summary"
    kpis={(s) => [
      { label: 'Open pipeline', value: fmtMoney(s.pipeline_total) },
      { label: 'Weighted forecast', value: fmtMoney(s.weighted_forecast), tone: 'brand' },
      { label: 'Win rate', value: s.win_rate_pct == null ? '—' : `${s.win_rate_pct}%`, sub: `Won MTD ${fmtMoney(s.won_mtd)}` },
      { label: 'Open leads', value: s.leads.open, sub: s.lead_conversion_pct == null ? undefined : `${s.lead_conversion_pct}% converted` },
      { label: 'Overdue activities', value: s.overdue_activities, tone: s.overdue_activities ? 'warning' : 'neutral' },
    ]}
  />
);
