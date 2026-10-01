import React, { useEffect, useState } from 'react';
import { ApiClient } from '../../api/client.js';
import { Alert, Badge, Table } from '@omnysync/ui';
import { ModuleWorkspace, TabDef, FormField } from '../kit/ModuleWorkspace.js';
import { opts, today } from './shared.js';

const LEVELS = [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} — ${['Rare / minimal', 'Unlikely / minor', 'Possible / moderate', 'Likely / major', 'Almost certain / severe'][n - 1]}` }));
const tone = (s: number) => (s >= 20 ? 'danger' : s >= 12 ? 'warning' : s >= 6 ? 'info' : 'success');
const scoreBadge = (s: any) => (s == null ? '—' : <Badge size="sm" variant={tone(Number(s)) as any}>{s}</Badge>);
const riskRef: FormField = { name: 'risk_id', label: 'Risk', type: 'ref', required: true, ref: { endpoint: '/grc/risks', label: (r) => `${r.code} · ${r.title}`, description: (r) => `${r.category} · score ${r.inherent_score}` } };
const cell = (l: number, i: number) => {
  const s = l * i;
  return s >= 20 ? 'bg-[#C62828] text-white' : s >= 12 ? 'bg-[#F4A259]' : s >= 6 ? 'bg-[#F6E27F]' : 'bg-[#BFE3C0]';
};

const Heatmap: React.FC<{ reloadKey: number }> = ({ reloadKey }) => {
  const [s, setS] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    ApiClient.get('/grc/summary').then(setS).catch((e) => setErr(e.message));
  }, [reloadKey]);
  if (err) return <Alert variant="danger">{err}</Alert>;
  if (!s) return null;
  return (
    <div className="flex gap-8 flex-wrap">
      <div>
        <div className="text-sm font-semibold mb-2">Residual risk heatmap (open risks)</div>
        <div className="flex">
          <div className="flex flex-col justify-around pr-2 text-xs text-[#5B6472]">{[5, 4, 3, 2, 1].map((l) => <div key={l} className="h-14 flex items-center">L{l}</div>)}</div>
          <div>
            <div className="grid grid-cols-5 gap-1">
              {s.heatmap.map((row: number[], ri: number) => row.map((n: number, ci: number) => (
                <div key={`${ri}-${ci}`} className={`w-14 h-14 rounded flex items-center justify-center text-sm font-semibold ${cell(5 - ri, ci + 1)}`}>{n || ''}</div>
              )))}
            </div>
            <div className="grid grid-cols-5 gap-1 mt-1 text-xs text-[#5B6472] text-center">{[1, 2, 3, 4, 5].map((i) => <div key={i}>I{i}</div>)}</div>
          </div>
        </div>
        <div className="text-xs text-[#5B6472] mt-2">Appetite: residual score ≤ {s.appetite} (Admin → Settings → Risk).</div>
      </div>
      <div className="flex-1 min-w-[280px]">
        <Table
          columns={[{ key: 'k', header: 'Indicator' }, { key: 'v', header: 'Value', align: 'right' }]}
          data={[
            { k: 'Open risks', v: s.open_risks },
            { k: 'Above appetite', v: s.above_appetite },
            { k: 'Controls operating', v: s.operating },
            { k: 'Controls deficient', v: s.deficient },
            { k: 'Control tests overdue', v: s.tests_overdue },
            { k: 'Open incidents (high/critical)', v: `${s.open_incidents} (${s.open_high})` },
          ]}
          keyExtractor={(r: any) => r.k}
        />
      </div>
    </div>
  );
};

const tabs: TabDef[] = [
  { id: 'heatmap', label: 'Overview', render: ({ reloadKey }) => <Heatmap reloadKey={reloadKey} /> },
  {
    id: 'risks',
    label: 'Risk register',
    endpoint: '/grc/risks',
    statuses: ['OPEN', 'MITIGATING', 'ACCEPTED', 'CLOSED'],
    columns: [
      { key: 'code', header: 'Risk' },
      { key: 'title', header: 'Title' },
      { key: 'category', header: 'Category', kind: 'badge' },
      { key: 'owner', header: 'Owner' },
      { key: 'inherent_score', header: 'Inherent', align: 'center', render: (r) => scoreBadge(r.inherent_score) },
      { key: 'residual_score', header: 'Residual', align: 'center', render: (r) => scoreBadge(r.residual_score) },
      { key: 'controls', header: 'Controls', align: 'right', render: (r) => (r.deficient_controls ? <span className="text-[#C62828] font-medium">{r.controls} ({r.deficient_controls} deficient)</span> : r.controls) },
      { key: 'status', header: 'Status', kind: 'status' },
    ],
    detailFields: [{ key: 'description', header: 'Description' }, { key: 'treatment', header: 'Treatment' }, { key: 'review_date', header: 'Next review', kind: 'date' }, { key: 'acceptance_note', header: 'Acceptance note' }],
    detailExtra: (row) => (
      <div className="flex flex-col gap-3">
        <div className="text-sm font-semibold">Controls</div>
        <Table columns={[{ key: 'code', header: 'Control' }, { key: 'title', header: 'Title' }, { key: 'frequency', header: 'Frequency' }, { key: 'last_result', header: 'Last test' }, { key: 'status', header: 'Status', render: (r: any) => <Badge size="sm" variant={r.status === 'DEFICIENT' ? 'danger' : r.status === 'OPERATING' ? 'success' : 'neutral'}>{r.status}</Badge> }]} data={row.controls || []} keyExtractor={(r: any) => r.id} emptyMessage="No controls mapped." />
        <div className="text-sm font-semibold">Incidents</div>
        <Table columns={[{ key: 'number', header: 'Incident' }, { key: 'title', header: 'Title' }, { key: 'severity', header: 'Severity' }, { key: 'status', header: 'Status' }]} data={row.incidents || []} keyExtractor={(r: any) => r.id} emptyMessage="No incidents linked." />
      </div>
    ),
    createLabel: 'Add risk',
    createFields: [
      { name: 'title', label: 'Risk', type: 'text', required: true },
      { name: 'category', label: 'Category', type: 'select', options: opts('OPERATIONAL', 'FINANCIAL', 'COMPLIANCE', 'SAFETY', 'IT', 'STRATEGIC'), default: 'OPERATIONAL' },
      { name: 'owner', label: 'Owner', type: 'text' },
      { name: 'likelihood', label: 'Inherent likelihood', type: 'select', options: LEVELS, default: '3' },
      { name: 'impact', label: 'Inherent impact', type: 'select', options: LEVELS, default: '3' },
      { name: 'residual_likelihood', label: 'Residual likelihood (after controls)', type: 'select', options: LEVELS },
      { name: 'residual_impact', label: 'Residual impact', type: 'select', options: LEVELS },
      { name: 'review_date', label: 'Next review', type: 'date' },
      { name: 'description', label: 'Description', type: 'textarea' },
    ],
    createTransform: (p) => ({ ...p, likelihood: Number(p.likelihood), impact: Number(p.impact), residual_likelihood: p.residual_likelihood ? Number(p.residual_likelihood) : undefined, residual_impact: p.residual_impact ? Number(p.residual_impact) : undefined }),
    editFields: [{ name: 'owner', label: 'Owner', type: 'text' }, { name: 'residual_likelihood', label: 'Residual likelihood', type: 'int' }, { name: 'residual_impact', label: 'Residual impact', type: 'int' }, { name: 'review_date', label: 'Next review', type: 'date' }],
    actions: [
      { id: 'start_mitigation', label: 'Start mitigation', when: ['OPEN'] },
      { id: 'accept', label: 'Accept risk', when: ['OPEN', 'MITIGATING'], fields: [{ name: 'acceptance_note', label: 'Justification', type: 'textarea', required: true }], confirm: 'Only allowed when the residual score is within the configured appetite.' },
      { id: 'close', label: 'Close', variant: 'destructive', when: ['OPEN', 'MITIGATING', 'ACCEPTED'] },
      { id: 'reopen', label: 'Re-open', when: ['CLOSED', 'ACCEPTED'] },
    ],
  },
  {
    id: 'controls',
    label: 'Controls',
    endpoint: '/grc/controls',
    statuses: ['DESIGN', 'OPERATING', 'DEFICIENT', 'RETIRED'],
    columns: [
      { key: 'code', header: 'Control' },
      { key: 'title', header: 'Title' },
      { key: 'risk_code', header: 'Risk' },
      { key: 'control_type', header: 'Type', kind: 'badge' },
      { key: 'frequency', header: 'Frequency' },
      { key: 'last_tested_on', header: 'Last tested', kind: 'date' },
      { key: 'last_result', header: 'Result', render: (r) => (r.last_result ? <Badge size="sm" variant={r.last_result === 'PASS' ? 'success' : 'danger'}>{r.last_result}</Badge> : '—') },
      { key: 'next_test_due', header: 'Next test', render: (r) => (r.next_test_due ? <span className={r.test_overdue ? 'text-[#C62828] font-medium' : ''}>{String(r.next_test_due).slice(0, 10)}{r.test_overdue ? ' · overdue' : ''}</span> : '—') },
      { key: 'status', header: 'Status', kind: 'status' },
    ],
    detailFields: [{ key: 'procedure', header: 'Test procedure' }, { key: 'owner', header: 'Owner' }],
    detailExtra: (row) => (
      <div className="flex flex-col gap-2">
        <div className="text-sm font-semibold">Test history</div>
        <Table columns={[{ key: 'test_date', header: 'Date', render: (r: any) => String(r.test_date).slice(0, 10) }, { key: 'result', header: 'Result', render: (r: any) => <Badge size="sm" variant={r.result === 'PASS' ? 'success' : 'danger'}>{r.result}</Badge> }, { key: 'sample', header: 'Sample / exceptions', render: (r: any) => (r.sample_size ? `${r.sample_size} / ${r.exceptions}` : '—') }, { key: 'evidence', header: 'Evidence' }, { key: 'tested_by_email', header: 'Tester' }]} data={row.tests || []} keyExtractor={(r: any) => r.id} emptyMessage="Never tested." />
      </div>
    ),
    createLabel: 'Add control',
    createFields: [riskRef, { name: 'title', label: 'Control', type: 'text', required: true }, { name: 'control_type', label: 'Type', type: 'select', options: opts('PREVENTIVE', 'DETECTIVE', 'CORRECTIVE'), default: 'PREVENTIVE' }, { name: 'frequency', label: 'Test frequency', type: 'select', options: opts('MONTHLY', 'QUARTERLY', 'ANNUAL'), default: 'QUARTERLY' }, { name: 'owner', label: 'Owner', type: 'text' }, { name: 'next_test_due', label: 'First test due', type: 'date' }, { name: 'procedure', label: 'Test procedure', type: 'textarea' }],
    editFields: [{ name: 'title', label: 'Control', type: 'text' }, { name: 'owner', label: 'Owner', type: 'text' }, { name: 'procedure', label: 'Test procedure', type: 'textarea' }],
    actions: [
      { id: 'test', label: 'Record test', variant: 'primary', when: ['DESIGN', 'OPERATING', 'DEFICIENT'], path: (r) => `/grc/controls/${r.id}/tests`, fields: [{ name: 'result', label: 'Result', type: 'select', options: opts('PASS', 'FAIL'), default: 'PASS', required: true }, { name: 'test_date', label: 'Test date', type: 'date', default: today() }, { name: 'sample_size', label: 'Sample size', type: 'int' }, { name: 'exceptions', label: 'Exceptions', type: 'int', default: '0' }, { name: 'evidence', label: 'Evidence', type: 'textarea', required: true }], success: 'Test recorded — a failure opens a remediation incident' },
      { id: 'retire', label: 'Retire', variant: 'destructive', when: ['DESIGN', 'OPERATING', 'DEFICIENT'] },
    ],
  },
  {
    id: 'incidents',
    label: 'Incidents',
    endpoint: '/grc/incidents',
    statuses: ['REPORTED', 'INVESTIGATING', 'RESOLVED', 'CLOSED'],
    columns: [
      { key: 'number', header: 'Incident' },
      { key: 'title', header: 'Title' },
      { key: 'incident_type', header: 'Type', kind: 'badge' },
      { key: 'severity', header: 'Severity', render: (r) => <Badge size="sm" variant={r.severity === 'CRITICAL' ? 'danger' : r.severity === 'HIGH' ? 'warning' : 'neutral'}>{r.severity}</Badge> },
      { key: 'occurred_on', header: 'Occurred', kind: 'date' },
      { key: 'risk_code', header: 'Risk' },
      { key: 'due_date', header: 'Action due', render: (r) => (r.due_date ? <span className={r.overdue ? 'text-[#C62828] font-medium' : ''}>{String(r.due_date).slice(0, 10)}</span> : '—') },
      { key: 'status', header: 'Status', kind: 'status' },
    ],
    detailFields: [{ key: 'description', header: 'What happened' }, { key: 'root_cause', header: 'Root cause' }, { key: 'corrective_action', header: 'Corrective action' }, { key: 'control_code', header: 'Failed control' }],
    createLabel: 'Report incident',
    createFields: [{ name: 'title', label: 'Title', type: 'text', required: true }, { name: 'severity', label: 'Severity', type: 'select', options: opts('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'), default: 'MEDIUM' }, { name: 'incident_type', label: 'Type', type: 'select', options: opts('SAFETY', 'ENVIRONMENTAL', 'DATA', 'FRAUD', 'OPERATIONAL'), default: 'OPERATIONAL' }, { name: 'occurred_on', label: 'Occurred on', type: 'date', required: true, default: today() }, { ...riskRef, required: false, label: 'Related risk (optional)' }, { name: 'description', label: 'What happened', type: 'textarea' }, { name: 'due_date', label: 'Action due', type: 'date' }],
    editFields: [{ name: 'description', label: 'What happened', type: 'textarea' }, { name: 'root_cause', label: 'Root cause', type: 'textarea' }, { name: 'corrective_action', label: 'Corrective action', type: 'textarea' }, { name: 'due_date', label: 'Action due', type: 'date' }],
    actions: [
      { id: 'investigate', label: 'Start investigation', when: ['REPORTED'] },
      { id: 'resolve', label: 'Resolve', variant: 'primary', when: ['REPORTED', 'INVESTIGATING'], fields: [{ name: 'root_cause', label: 'Root cause', type: 'textarea', required: true }, { name: 'corrective_action', label: 'Corrective action', type: 'textarea', required: true }] },
      { id: 'close', label: 'Close', when: ['RESOLVED'], confirm: 'Closure must be done by someone other than the reporter.' },
    ],
  },
];

export const GrcView: React.FC = () => (
  <ModuleWorkspace
    id="grc"
    title="Risk & Compliance"
    description="Risk register scored likelihood × impact with residual after controls, appetite-gated acceptance, evidence-based control testing that opens remediation incidents, and a safety / incident log."
    tabs={tabs}
    summaryEndpoint="/grc/summary"
    kpis={(s) => [
      { label: 'Open risks', value: s.open_risks, sub: `${s.above_appetite} above appetite`, tone: s.above_appetite ? 'warning' : 'success' },
      { label: 'Deficient controls', value: s.deficient, tone: s.deficient ? 'danger' : 'success' },
      { label: 'Tests overdue', value: s.tests_overdue, tone: s.tests_overdue ? 'warning' : 'neutral' },
      { label: 'Open incidents', value: s.open_incidents, sub: `${s.open_high} high / critical`, tone: s.open_high ? 'danger' : 'neutral' },
    ]}
  />
);
