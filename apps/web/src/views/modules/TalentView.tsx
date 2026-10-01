import React, { useEffect, useState } from 'react';
import { ApiClient } from '../../api/client.js';
import { Alert, Badge, Table } from '@omnysync/ui';
import { ModuleWorkspace, TabDef, FormField } from '../kit/ModuleWorkspace.js';
import { fmtMoney } from '../../lib/format.js';
import { opts, today } from './shared.js';

const STAGES = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED'];
const reqRef: FormField = { name: 'requisition_id', label: 'Requisition', type: 'ref', required: true, ref: { endpoint: '/tal/requisitions?status=OPEN', label: (r) => `${r.number} · ${r.title}`, description: (r) => `${r.positions - r.filled} open seat(s) · ${fmtMoney(r.salary_min)}–${fmtMoney(r.salary_max)}` } };
const candRef: FormField = { name: 'candidate_id', label: 'Candidate', type: 'ref', required: true, ref: { endpoint: '/tal/candidates?status=ACTIVE', label: (r) => r.full_name, description: (r) => `${r.email}${r.years_experience ? ` · ${r.years_experience} yrs` : ''}` } };

const Board: React.FC<{ reloadKey: number }> = ({ reloadKey }) => {
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    ApiClient.get('/tal/applications?limit=200').then(setRows).catch((e) => setErr(e.message));
  }, [reloadKey]);
  if (err) return <Alert variant="danger">{err}</Alert>;
  return (
    <div className="grid grid-cols-5 gap-3">
      {STAGES.map((s) => {
        const items = rows.filter((r) => r.status === s);
        return (
          <div key={s} className="rounded-lg bg-[#F5F7FA] p-2 min-h-[240px]">
            <div className="flex items-center justify-between px-1 pb-2 text-xs font-semibold text-[#5B6472]">{s.replace('_', ' ')}<Badge size="sm" variant="neutral">{items.length}</Badge></div>
            <div className="flex flex-col gap-2">
              {items.map((r) => (
                <div key={r.id} className="rounded-md bg-white border border-[#E3E7ED] p-2 text-sm shadow-sm">
                  <div className="font-medium">{r.full_name}</div>
                  <div className="text-xs text-[#5B6472]">{r.requisition_title}</div>
                  <div className="flex gap-1 mt-1 text-xs">
                    <Badge size="sm" variant="info">{r.source}</Badge>
                    {r.avg_score ? <Badge size="sm" variant={Number(r.avg_score) >= 4 ? 'success' : 'neutral'}>★ {r.avg_score}</Badge> : null}
                  </div>
                </div>
              ))}
              {!items.length && <div className="text-xs text-[#8A94A6] px-1">—</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const tabs: TabDef[] = [
  { id: 'board', label: 'Pipeline', render: ({ reloadKey }) => <Board reloadKey={reloadKey} /> },
  {
    id: 'requisitions',
    label: 'Requisitions',
    endpoint: '/tal/requisitions',
    statuses: ['DRAFT', 'SUBMITTED', 'OPEN', 'ON_HOLD', 'FILLED', 'CANCELLED'],
    columns: [
      { key: 'number', header: 'Requisition' },
      { key: 'title', header: 'Role' },
      { key: 'department', header: 'Department' },
      { key: 'seats', header: 'Filled', align: 'right', render: (r) => `${r.filled} / ${r.positions}` },
      { key: 'band', header: 'Salary band', render: (r) => `${fmtMoney(r.salary_min)} – ${fmtMoney(r.salary_max)}` },
      { key: 'active_applicants', header: 'In pipeline', align: 'right' },
      { key: 'target_date', header: 'Target', kind: 'date' },
      { key: 'status', header: 'Status', kind: 'status' },
    ],
    detailFields: [{ key: 'justification', header: 'Justification' }, { key: 'location', header: 'Location' }, { key: 'employment_type', header: 'Type' }, { key: 'hold_reason', header: 'Hold / cancel reason' }],
    detailExtra: (row) => (
      <div className="flex flex-col gap-2">
        <div className="text-sm font-semibold">Applicants</div>
        <Table columns={[{ key: 'full_name', header: 'Candidate' }, { key: 'email', header: 'Email' }, { key: 'avg_score', header: 'Avg score', align: 'right' }, { key: 'status', header: 'Stage', render: (r: any) => <Badge size="sm" variant="info">{r.status}</Badge> }]} data={row.applications || []} keyExtractor={(r: any) => r.id} emptyMessage="No applicants yet." />
      </div>
    ),
    createLabel: 'New requisition',
    createFields: [
      { name: 'title', label: 'Role title', type: 'text', required: true },
      { name: 'department', label: 'Department', type: 'text', default: 'Field Service' },
      { name: 'location', label: 'Location', type: 'text', default: 'Lahore' },
      { name: 'employment_type', label: 'Type', type: 'select', options: opts('FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'), default: 'FULL_TIME' },
      { name: 'positions', label: 'Positions', type: 'int', default: '1' },
      { name: 'salary_min', label: 'Salary min (PKR / month)', type: 'decimal', required: true },
      { name: 'salary_max', label: 'Salary max (PKR / month)', type: 'decimal', required: true },
      { name: 'target_date', label: 'Target start', type: 'date' },
      { name: 'justification', label: 'Business justification', type: 'textarea' },
    ],
    editFields: [{ name: 'positions', label: 'Positions', type: 'int' }, { name: 'salary_min', label: 'Salary min', type: 'decimal' }, { name: 'salary_max', label: 'Salary max', type: 'decimal' }, { name: 'target_date', label: 'Target start', type: 'date' }],
    actions: [
      { id: 'submit', label: 'Submit for approval', variant: 'primary', when: ['DRAFT'] },
      { id: 'approve', label: 'Approve & open', variant: 'primary', when: ['SUBMITTED'], confirm: 'The submitter cannot approve their own requisition.' },
      { id: 'hold', label: 'Put on hold', when: ['OPEN'], fields: [{ name: 'hold_reason', label: 'Reason', type: 'textarea', required: true }] },
      { id: 'reopen', label: 'Re-open', when: ['ON_HOLD'] },
      { id: 'cancel', label: 'Cancel', variant: 'destructive', when: ['DRAFT', 'SUBMITTED', 'OPEN', 'ON_HOLD'], fields: [{ name: 'hold_reason', label: 'Reason', type: 'textarea', required: true }], confirm: 'Open applications will be rejected.' },
    ],
  },
  {
    id: 'applications',
    label: 'Applications',
    endpoint: '/tal/applications',
    statuses: ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN'],
    columns: [
      { key: 'full_name', header: 'Candidate' },
      { key: 'requisition_title', header: 'Role' },
      { key: 'source', header: 'Source', kind: 'badge' },
      { key: 'interviews', header: 'Interviews', align: 'right' },
      { key: 'avg_score', header: 'Avg score', align: 'right' },
      { key: 'offered_salary', header: 'Offer', kind: 'money' },
      { key: 'applied_on', header: 'Applied', kind: 'date' },
      { key: 'status', header: 'Stage', kind: 'status' },
    ],
    detailFields: [{ key: 'email', header: 'Email' }, { key: 'requisition_number', header: 'Requisition' }, { key: 'offer_start_date', header: 'Start date', kind: 'date' }, { key: 'offer_note', header: 'Offer note' }, { key: 'rejection_reason', header: 'Rejection reason' }],
    detailExtra: (row) => (
      <div className="flex flex-col gap-2">
        <div className="text-sm font-semibold">Interviews</div>
        <Table columns={[{ key: 'interview_date', header: 'Date', render: (r: any) => String(r.interview_date).slice(0, 10) }, { key: 'round', header: 'Round' }, { key: 'interviewer', header: 'Interviewer' }, { key: 'score', header: 'Score', align: 'right' }, { key: 'recommendation', header: 'Recommendation', render: (r: any) => <Badge size="sm" variant={r.recommendation === 'HIRE' ? 'success' : r.recommendation === 'NO_HIRE' ? 'danger' : 'warning'}>{r.recommendation}</Badge> }, { key: 'notes', header: 'Notes' }]} data={row.interviews || []} keyExtractor={(r: any) => r.id} emptyMessage="No interviews yet." />
      </div>
    ),
    createLabel: 'Add application',
    createFields: [reqRef, candRef, { name: 'applied_on', label: 'Applied on', type: 'date', default: today() }],
    actions: [
      { id: 'screen', label: 'Move to screening', when: ['APPLIED'] },
      { id: 'shortlist', label: 'Shortlist for interview', variant: 'primary', when: ['SCREENING'] },
      { id: 'interview', label: 'Log interview', variant: 'primary', when: ['INTERVIEW'], path: (r) => `/tal/applications/${r.id}/interviews`, fields: [{ name: 'interview_date', label: 'Date', type: 'date', default: today() }, { name: 'round', label: 'Round', type: 'select', options: opts('PHONE', 'TECHNICAL', 'PRACTICAL', 'HR', 'FINAL'), default: 'TECHNICAL' }, { name: 'interviewer', label: 'Interviewer', type: 'text', required: true }, { name: 'score', label: 'Score (1–5)', type: 'int', required: true }, { name: 'recommendation', label: 'Recommendation', type: 'select', options: opts('HIRE', 'MAYBE', 'NO_HIRE'), default: 'MAYBE' }, { name: 'notes', label: 'Notes', type: 'textarea' }], transform: (p) => ({ ...p, score: Number(p.score) }) },
      { id: 'offer', label: 'Make offer', variant: 'primary', when: ['INTERVIEW'], fields: [{ name: 'offered_salary', label: 'Monthly salary (PKR)', type: 'decimal', required: true }, { name: 'offer_start_date', label: 'Start date', type: 'date', required: true }, { name: 'offer_note', label: 'Note (required if outside band)', type: 'textarea' }] },
      { id: 'hire', label: 'Mark hired', variant: 'primary', when: ['OFFER'], confirm: 'Creates the employee record and fills a seat on the requisition.' },
      { id: 'reject', label: 'Reject', variant: 'destructive', when: ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER'], fields: [{ name: 'rejection_reason', label: 'Reason', type: 'textarea', required: true }] },
      { id: 'withdraw', label: 'Candidate withdrew', when: ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER'] },
    ],
  },
  {
    id: 'candidates',
    label: 'Candidates',
    endpoint: '/tal/candidates',
    statuses: ['ACTIVE', 'ARCHIVED'],
    columns: [
      { key: 'full_name', header: 'Name' },
      { key: 'email', header: 'Email' },
      { key: 'phone', header: 'Phone' },
      { key: 'source', header: 'Source', kind: 'badge' },
      { key: 'years_experience', header: 'Experience', align: 'right', render: (r) => (r.years_experience ? `${r.years_experience} yrs` : '—') },
      { key: 'skills', header: 'Skills' },
      { key: 'applications', header: 'Applications', align: 'right' },
      { key: 'status', header: 'Status', kind: 'status' },
    ],
    createLabel: 'Add candidate',
    createFields: [{ name: 'full_name', label: 'Full name', type: 'text', required: true }, { name: 'email', label: 'Email', type: 'text', required: true }, { name: 'phone', label: 'Phone', type: 'text' }, { name: 'source', label: 'Source', type: 'select', options: opts('REFERRAL', 'JOB_BOARD', 'WALK_IN', 'AGENCY', 'LINKEDIN', 'CAMPUS'), default: 'JOB_BOARD' }, { name: 'years_experience', label: 'Years of experience', type: 'decimal' }, { name: 'current_city', label: 'City', type: 'text' }, { name: 'skills', label: 'Skills', type: 'textarea' }],
    editFields: [{ name: 'phone', label: 'Phone', type: 'text' }, { name: 'skills', label: 'Skills', type: 'textarea' }, { name: 'years_experience', label: 'Years of experience', type: 'decimal' }],
    actions: [{ id: 'archive', label: 'Archive', when: ['ACTIVE'] }, { id: 'restore', label: 'Restore', when: ['ARCHIVED'] }],
  },
];

export const TalentView: React.FC = () => (
  <ModuleWorkspace
    id="tal"
    title="Recruitment"
    description="Approved requisitions with salary bands, a candidate pool, a stage pipeline with scored interviews, offer gating, and hire straight into an employee record."
    tabs={tabs}
    summaryEndpoint="/tal/summary"
    kpis={(s) => [
      { label: 'Open positions', value: s.open_positions, sub: `${s.open_reqs} requisitions`, tone: 'brand' },
      { label: 'In pipeline', value: s.pipeline },
      { label: 'Offers out', value: s.offers, tone: s.offers ? 'warning' : 'neutral' },
      { label: 'Hired', value: s.hired, sub: s.avg_days_to_hire != null ? `avg ${s.avg_days_to_hire} days` : undefined, tone: 'success' },
    ]}
  />
);
