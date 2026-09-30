import React, { useEffect, useMemo, useState } from 'react';
import { ApiClient } from '../../api/client.js';
import { Alert, Badge, Button, Combobox, Input } from '@omnysync/ui';
import { ArrowDown, FlaskConical, Plus, Send, Trash2 } from 'lucide-react';
import { ModuleWorkspace, TabDef, fmtWhen } from '../kit/ModuleWorkspace.js';
import { ROLE_OPTIONS, opts } from './shared.js';

const OPS = [
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'does not equal' },
  { value: 'gt', label: 'is greater than' },
  { value: 'gte', label: 'is at least' },
  { value: 'lt', label: 'is less than' },
  { value: 'lte', label: 'is at most' },
  { value: 'contains', label: 'contains' },
  { value: 'in', label: 'is one of (comma list)' },
  { value: 'exists', label: 'is present' },
  { value: 'not_exists', label: 'is empty' },
];

interface Cond { field: string; op: string; value: string }
interface Act { type: 'ALERT' | 'TASK'; title: string; severity: string; assigned_role: string; due_in_days: string }

const Step: React.FC<{ n: number; title: string; children: React.ReactNode }> = ({ n, title, children }) => (
  <section className="border border-[#D9DFEA] rounded-[10px] p-4 bg-white" aria-labelledby={`step-${n}`}>
    <h3 id={`step-${n}`} className="text-sm font-bold text-[#182235] mb-3 flex items-center gap-2">
      <span className="h-6 w-6 rounded-full bg-[#F2EEFF] text-[#5940B8] text-xs flex items-center justify-center" aria-hidden="true">{n}</span>
      {title}
    </h3>
    {children}
  </section>
);

const Builder: React.FC<{ notify: (k: any, t: string) => void }> = ({ notify }) => {
  const [catalog, setCatalog] = useState<any[]>([]);
  const [code, setCode] = useState('EVT-');
  const [name, setName] = useState('');
  const [eventType, setEventType] = useState('');
  const [conds, setConds] = useState<Cond[]>([]);
  const [acts, setActs] = useState<Act[]>([{ type: 'ALERT', title: '', severity: 'WARNING', assigned_role: '', due_in_days: '' }]);
  const [sim, setSim] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  useEffect(() => {
    ApiClient.get('/automation/event-catalog').then(setCatalog).catch(() => setCatalog([]));
  }, []);
  const sample = useMemo(() => catalog.find((c) => c.event_type === eventType), [catalog, eventType]);
  const def = () => ({
    event_type: eventType,
    conditions: conds.map((c) => ({ field: c.field, op: c.op, ...(c.op === 'exists' || c.op === 'not_exists' ? {} : { value: c.value }) })),
    actions: acts.map((a) => ({ type: a.type, title: a.title, ...(a.type === 'ALERT' ? { severity: a.severity } : {}), ...(a.assigned_role ? { assigned_role: a.assigned_role } : {}), ...(a.type === 'TASK' && a.due_in_days ? { due_in_days: Number(a.due_in_days) } : {}) })),
  });
  const simulate = async () => {
    setBusy('sim');
    setErr(null);
    try {
      setSim(await ApiClient.post('/automation/event-rules/simulate', def()));
    } catch (e: any) {
      setErr(e.message);
      setSim(null);
    } finally {
      setBusy('');
    }
  };
  const save = async (publish: boolean) => {
    setBusy(publish ? 'pub' : 'save');
    setErr(null);
    try {
      const r = await ApiClient.post('/automation/event-rules', { code, name, ...def() });
      if (publish) await ApiClient.post(`/automation/event-rules/${r.id}/publish`, {});
      notify('success', `Rule ${code} ${publish ? 'published (v1) — it applies to events from now on' : 'saved as draft'}`);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy('');
    }
  };
  const fieldOptions = (sample?.fields || []).map((f: string) => ({ value: f, label: f, description: sample?.sample?.[f] !== undefined ? `e.g. ${String(sample.sample[f]).slice(0, 40)}` : undefined }));
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-6">
      <div className="flex flex-col gap-3">
        {err && <Alert variant="danger" title="Rule is not valid">{err}</Alert>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Rule code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} hint="Unique, e.g. EVT-LATE-DELIVERY" />
          <Input label="Rule name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <Step n={1} title="When this happens (trigger)">
          <Combobox
            label="Committed business event"
            value={eventType}
            onValueChange={(v) => setEventType(v || '')}
            options={catalog.map((c) => ({ value: c.event_type, label: c.event_type, description: `${c.count} seen · last ${fmtWhen(c.last_seen)}` }))}
            hint="Events come from the transactional outbox, after the business record committed."
          />
        </Step>
        <div className="flex justify-center text-[#8A94A6]" aria-hidden="true"><ArrowDown size={16} /></div>
        <Step n={2} title="Only if (conditions — all must hold)">
          <div className="flex flex-col gap-2">
            {conds.length === 0 && <p className="text-sm text-[#5E6A7D]">No conditions: every event of this type matches.</p>}
            {conds.map((c, i) => (
              <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
                <Combobox label={`Field ${i + 1}`} value={c.field} onValueChange={(v) => setConds(conds.map((x, j) => (j === i ? { ...x, field: v || '' } : x)))} options={fieldOptions} emptyText="Pick a trigger to see fields" />
                <Combobox label="Operator" value={c.op} onValueChange={(v) => setConds(conds.map((x, j) => (j === i ? { ...x, op: v || 'eq' } : x)))} options={OPS} />
                <Input label="Value" value={c.value} disabled={c.op === 'exists' || c.op === 'not_exists'} onChange={(e) => setConds(conds.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                <Button variant="quiet" aria-label={`Remove condition ${i + 1}`} onClick={() => setConds(conds.filter((_, j) => j !== i))}><Trash2 size={14} aria-hidden="true" /></Button>
              </div>
            ))}
            <div><Button variant="secondary" size="sm" onClick={() => setConds([...conds, { field: '', op: 'eq', value: '' }])} disabled={conds.length >= 10}><Plus size={14} aria-hidden="true" /> Add condition</Button></div>
          </div>
        </Step>
        <div className="flex justify-center text-[#8A94A6]" aria-hidden="true"><ArrowDown size={16} /></div>
        <Step n={3} title="Then do (bounded, non-financial actions)">
          <div className="flex flex-col gap-3">
            {acts.map((a, i) => (
              <div key={i} className="grid grid-cols-1 sm:grid-cols-2 gap-2 border border-dashed border-[#D9DFEA] rounded-md p-3">
                <Combobox label="Action" value={a.type} onValueChange={(v) => setActs(acts.map((x, j) => (j === i ? { ...x, type: (v as any) || 'ALERT' } : x)))} options={[{ value: 'ALERT', label: 'Raise alert in inbox' }, { value: 'TASK', label: 'Create task for a role' }]} />
                <Combobox label="Assign to role" value={a.assigned_role} clearable onValueChange={(v) => setActs(acts.map((x, j) => (j === i ? { ...x, assigned_role: v || '' } : x)))} options={ROLE_OPTIONS} />
                <div className="sm:col-span-2"><Input label="Title" value={a.title} onChange={(e) => setActs(acts.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} hint="Use {{field}} to insert event values, e.g. Case {{number}}" /></div>
                {a.type === 'ALERT' ? (
                  <Combobox label="Severity" value={a.severity} onValueChange={(v) => setActs(acts.map((x, j) => (j === i ? { ...x, severity: v || 'INFO' } : x)))} options={opts('INFO', 'WARNING', 'CRITICAL')} />
                ) : (
                  <Input label="Due in (days)" type="number" min={0} max={365} value={a.due_in_days} onChange={(e) => setActs(acts.map((x, j) => (j === i ? { ...x, due_in_days: e.target.value } : x)))} />
                )}
                <div className="flex items-end justify-end">{acts.length > 1 && <Button variant="quiet" onClick={() => setActs(acts.filter((_, j) => j !== i))}><Trash2 size={14} aria-hidden="true" /> Remove</Button>}</div>
              </div>
            ))}
            <div><Button variant="secondary" size="sm" onClick={() => setActs([...acts, { type: 'TASK', title: '', severity: 'INFO', assigned_role: '', due_in_days: '1' }])} disabled={acts.length >= 5}><Plus size={14} aria-hidden="true" /> Add action</Button></div>
            <p className="text-xs text-[#5E6A7D]">Posting, payments and approvals can never be triggered by an event rule (AUTOMATION-AND-AI tiers).</p>
          </div>
        </Step>
        <div className="flex flex-wrap gap-2 justify-end">
          <Button variant="secondary" onClick={simulate} isLoading={busy === 'sim'}><FlaskConical size={14} aria-hidden="true" /> Simulate on recent events</Button>
          <Button variant="secondary" onClick={() => save(false)} isLoading={busy === 'save'}>Save draft</Button>
          <Button onClick={() => save(true)} isLoading={busy === 'pub'}><Send size={14} aria-hidden="true" /> Publish</Button>
        </div>
      </div>
      <aside className="flex flex-col gap-3" aria-label="Simulation result">
        <div className="text-xs font-bold uppercase tracking-wider text-[#5E6A7D]">Simulation (no side effects)</div>
        {!sim ? (
          <p className="text-sm text-[#5E6A7D]">Run a simulation to see which of the last 50 events would match and what would be created.</p>
        ) : (
          <>
            <div className="text-sm"><Badge variant={sim.matched ? 'success' : 'neutral'}>{sim.matched} of {sim.evaluated} match</Badge></div>
            <ul className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto">
              {sim.results.map((r: any) => (
                <li key={r.event_id} className={`border rounded-md p-2 text-xs ${r.matched ? 'border-[#c3edd2] bg-[#EAF7EF]' : 'border-[#D9DFEA]'}`}>
                  <div className="font-semibold">{fmtWhen(r.created_at)} · {r.matched ? 'match' : 'skipped'}</div>
                  {r.preview.map((p: string) => <div key={p}>{p}</div>)}
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>
    </div>
  );
};

const tabs: TabDef[] = [
  { id: 'builder', label: 'Rule builder', render: ({ notify }) => <Builder notify={notify} /> },
  {
    id: 'rules',
    label: 'Event rules',
    endpoint: '/automation/event-rules',
    statuses: ['DRAFT', 'PUBLISHED', 'PAUSED'],
    columns: [
      { key: 'code', header: 'Code' },
      { key: 'name', header: 'Name' },
      { key: 'event_type', header: 'Trigger' },
      { key: 'version', header: 'Version', align: 'right' },
      { key: 'match_count', header: 'Matches', align: 'right' },
      { key: 'status', header: 'Status', kind: 'status' },
    ],
    detailFields: [
      { key: 'code', header: 'Code' },
      { key: 'event_type', header: 'Trigger' },
      { key: 'conditions', header: 'Conditions', render: (r) => <pre className="text-xs bg-[#F7F8FC] p-2 rounded whitespace-pre-wrap">{JSON.stringify(r.conditions, null, 1)}</pre> },
      { key: 'actions', header: 'Actions', render: (r) => <pre className="text-xs bg-[#F7F8FC] p-2 rounded whitespace-pre-wrap">{JSON.stringify(r.actions, null, 1)}</pre> },
      { key: 'published_at', header: 'Published', kind: 'datetime' },
      { key: 'version', header: 'Published version' },
    ],
    editFields: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'conditions', label: 'Conditions (JSON)', type: 'json' },
      { name: 'actions', label: 'Actions (JSON)', type: 'json', required: true },
    ],
    actions: [
      { id: 'publish', label: 'Publish new version', variant: 'primary', when: ['DRAFT', 'PUBLISHED', 'PAUSED'] },
      { id: 'pause', label: 'Pause', when: ['PUBLISHED'] },
    ],
  },
  {
    id: 'tasks',
    label: 'Task inbox',
    endpoint: '/automation/tasks',
    noDetailFetch: true,
    columns: [
      { key: 'title', header: 'Task' },
      { key: 'rule_code', header: 'From rule' },
      { key: 'assigned_role', header: 'Role' },
      { key: 'due_date', header: 'Due', kind: 'date' },
      { key: 'status', header: 'Status', kind: 'status' },
    ],
    actions: [{ id: 'complete', label: 'Mark done', variant: 'primary', when: ['OPEN'] }],
  },
];

export const WorkflowStudioView: React.FC = () => (
  <ModuleWorkspace
    id="wf"
    title="Workflow Studio"
    description="Event-triggered rules alongside the scheduled jobs: choose a committed event, add typed conditions, pick bounded actions, simulate on real recent events, then publish a version. Each event fires a rule at most once."
    tabs={tabs}
    headerExtra={<Button variant="secondary" size="sm" onClick={() => ApiClient.post('/automation/events/process', {}).catch(() => undefined)}>Process events now</Button>}
  />
);
