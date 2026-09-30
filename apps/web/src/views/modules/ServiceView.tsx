import React, { useEffect, useState } from 'react';
import { ApiClient } from '../../api/client.js';
import { Alert, Badge, Button, Card, Input, Table } from '@omnysync/ui';
import { ModuleWorkspace, TabDef, FormField, fmtWhen, statusTone } from '../kit/ModuleWorkspace.js';
import { fmtMoney } from '../../lib/format.js';
import { itemRef, opts, partyRef, today } from './shared.js';

const TZ = 'Asia/Karachi';
const hm = (v?: string) => (v ? new Date(v).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '');
const priTone = (p: string) => (p === 'CRITICAL' ? 'danger' : p === 'HIGH' ? 'warning' : p === 'LOW' ? 'neutral' : 'info');
const techRef = (name = 'technician_id'): FormField => ({ name, label: 'Technician', type: 'ref', required: true, ref: { endpoint: '/srv/technicians?status=ACTIVE', label: (r) => `${r.code} · ${r.name}`, description: (r) => [r.zone, r.skills].filter(Boolean).join(' — ') } });
const uid = () => (globalThis.crypto && 'randomUUID' in globalThis.crypto ? globalThis.crypto.randomUUID() : String(Date.now()));

/** Dispatch board: technicians × one day (PKT), 08:00–20:00 lanes, unassigned queue. */
const DispatchBoard: React.FC<{ reloadKey: number }> = ({ reloadKey }) => {
  const [date, setDate] = useState(today());
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    ApiClient.get(`/srv/board?date=${date}`).then(setData).catch((e) => setErr(e.message));
  }, [date, reloadKey]);
  const dayStart = Date.parse(`${date}T08:00:00+05:00`);
  const span = 12 * 3600000;
  const pos = (s: string, e: string) => {
    const a = Math.max(0, (Date.parse(s) - dayStart) / span);
    const b = Math.min(1, (Date.parse(e) - dayStart) / span);
    return { left: `${a * 100}%`, width: `${Math.max(2, (b - a) * 100)}%` };
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44"><Input label="Day" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <Button variant="secondary" onClick={() => setDate(today())}>Today</Button>
        <p className="text-xs text-[#46536B] pb-2">Bookings cannot overlap for a technician — the server rejects double-booking with CAPACITY_CONFLICT.</p>
      </div>
      {err && <Alert variant="danger" title="Couldn’t load the board">{err}</Alert>}
      {data && (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_280px] gap-4">
          <Card className="p-0 overflow-x-auto">
            <div className="min-w-[760px]">
              <div className="grid grid-cols-[180px_1fr] border-b border-[#E3E6EE] text-[11px] text-[#46536B]">
                <div className="px-3 py-2 font-semibold">Technician</div>
                <div className="relative h-8">
                  {Array.from({ length: 13 }, (_, i) => (
                    <span key={i} className="absolute top-2 -translate-x-1/2" style={{ left: `${(i / 12) * 100}%` }}>{String(8 + i).padStart(2, '0')}:00</span>
                  ))}
                </div>
              </div>
              {data.technicians.length === 0 && <div className="p-6 text-sm text-[#46536B]">No active technicians. Add one in the Technicians tab.</div>}
              {data.technicians.map((t: any) => (
                <div key={t.id} className="grid grid-cols-[180px_1fr] border-b border-[#EEF0F5] last:border-0">
                  <div className="px-3 py-3">
                    <div className="text-sm font-semibold text-[#161B26]">{t.name}</div>
                    <div className="text-[11px] text-[#46536B]">{t.code} · {t.zone || 'No zone'}</div>
                  </div>
                  <div className="relative h-16 bg-[repeating-linear-gradient(90deg,transparent,transparent_calc(100%/12_-_1px),#EEF0F5_calc(100%/12_-_1px),#EEF0F5_calc(100%/12))]">
                    {t.jobs.map((j: any) => (
                      <div key={j.id} title={`${j.number} · ${j.party_name} · ${hm(j.scheduled_start)}–${hm(j.scheduled_end)}`} className={`absolute top-2 h-12 rounded-md px-2 py-1 text-[11px] leading-tight overflow-hidden border ${j.priority === 'CRITICAL' ? 'bg-[#FDECEC] border-[#E5484D]' : j.status === 'IN_PROGRESS' ? 'bg-[#EAF6EE] border-[#2F9E5B]' : 'bg-[#EFEBFB] border-[#5940B8]'}`} style={pos(j.scheduled_start, j.scheduled_end)}>
                        <div className="font-semibold truncate">{j.number} · {hm(j.scheduled_start)}</div>
                        <div className="truncate text-[#46536B]">{j.party_name}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-sm font-semibold mb-2">Unassigned ({data.unassigned.length})</div>
            <div className="flex flex-col gap-2">
              {data.unassigned.length === 0 && <p className="text-xs text-[#46536B]">Every scheduled job has a technician.</p>}
              {data.unassigned.map((j: any) => (
                <div key={j.id} className="rounded-md border border-[#E3E6EE] p-2">
                  <div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold">{j.number}</span><Badge variant={priTone(j.priority) as any}>{j.priority}</Badge></div>
                  <div className="text-xs text-[#46536B] truncate">{j.party_name} — {j.title}</div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-[#46536B] mt-3">Dispatch from the Work orders tab (record → Dispatch).</p>
          </Card>
        </div>
      )}
    </div>
  );
};

const SlaBadge: React.FC<{ s?: string | null }> = ({ s }) => (s ? <Badge variant={(s === 'BREACHED' ? 'danger' : s === 'AT_RISK' ? 'warning' : s === 'MET' ? 'success' : 'info') as any}>{s.replace('_', ' ')}</Badge> : null);

const CaseExtra: React.FC<{ row: any }> = ({ row }) => (
  <div className="flex flex-col gap-3">
    <div className="grid grid-cols-2 gap-2 text-sm">
      <div><div className="text-[11px] text-[#46536B]">Response SLA</div><SlaBadge s={row.response_sla} /> <span className="text-xs">{fmtWhen(row.response_due_at)}</span></div>
      <div><div className="text-[11px] text-[#46536B]">Resolution SLA</div><SlaBadge s={row.resolution_sla} /> <span className="text-xs">{fmtWhen(row.resolution_due_at)}</span></div>
    </div>
    {row.paused_minutes > 0 && <p className="text-xs text-[#46536B]">Clock paused for {row.paused_minutes} business minutes (added to the due time).</p>}
    {row.work_orders?.length > 0 && (
      <Table columns={[{ key: 'number', header: 'Work order' }, { key: 'technician_name', header: 'Technician' }, { key: 'scheduled_start', header: 'Scheduled', render: (r: any) => fmtWhen(r.scheduled_start) }, { key: 'status', header: 'Status', render: (r: any) => <Badge variant={statusTone(r.status) as any}>{r.status}</Badge> }]} data={row.work_orders} keyExtractor={(r: any) => r.id} />
    )}
  </div>
);

const WorkOrderExtra: React.FC<{ row: any; reload: () => void }> = ({ row, reload }) => {
  const [err, setErr] = useState<string | null>(null);
  const toggle = async (i: number, done: boolean) => {
    try {
      setErr(null);
      await ApiClient.post(`/srv/work-orders/${row.id}/checklist`, { index: i, done });
      reload();
    } catch (e: any) {
      setErr(e.message);
    }
  };
  const decide = async (id: string, accept: boolean) => {
    const name = accept ? window.prompt('Customer name accepting this extra work') : null;
    if (accept && !name) return;
    try {
      await ApiClient.post(`/srv/extras/${id}/decide`, { accept, accepted_by_name: name });
      reload();
    } catch (e: any) {
      setErr(e.message);
    }
  };
  const list = (typeof row.checklist === 'string' ? JSON.parse(row.checklist) : row.checklist) || [];
  return (
    <div className="flex flex-col gap-4">
      {err && <Alert variant="danger" title="Action refused">{err}</Alert>}
      <div>
        <div className="text-sm font-semibold mb-1">Checklist</div>
        <ul className="flex flex-col gap-1">
          {list.map((c: any, i: number) => (
            <li key={i} className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="accent-[#5940B8]" checked={!!c.done} disabled={row.status !== 'IN_PROGRESS'} onChange={(e) => toggle(i, e.target.checked)} aria-label={c.item} />
              <span className={c.done ? 'line-through text-[#46536B]' : ''}>{c.item}</span>
              {c.mandatory && <Badge variant="warning">Required</Badge>}
            </li>
          ))}
        </ul>
      </div>
      <div className="text-sm">
        Customer sign-off:{' '}
        {row.customer_signoff_name ? (
          <span>
            <strong>{row.customer_signoff_name}</strong> at {fmtWhen(row.signed_at)} {row.signoff_valid === false ? <Badge variant="danger">Work changed — re-sign</Badge> : <Badge variant="success">Valid</Badge>}
          </span>
        ) : (
          <span className="text-[#46536B]">not captured</span>
        )}
      </div>
      {row.parts?.length > 0 && (
        <div>
          <div className="text-sm font-semibold mb-1">Parts issued</div>
          <Table columns={[{ key: 'item_code', header: 'Item' }, { key: 'quantity', header: 'Qty', align: 'right', render: (r: any) => Number(r.quantity).toFixed(2) }, { key: 'unit_price', header: 'Price', align: 'right', render: (r: any) => fmtMoney(r.unit_price) }, { key: 'chargeable', header: 'Chargeable', render: (r: any) => (r.chargeable ? 'Yes' : 'No') }]} data={row.parts} keyExtractor={(r: any) => r.id} />
        </div>
      )}
      {row.time?.length > 0 && (
        <div>
          <div className="text-sm font-semibold mb-1">Time</div>
          <Table columns={[{ key: 'technician_name', header: 'Technician' }, { key: 'start_at', header: 'From', render: (r: any) => fmtWhen(r.start_at) }, { key: 'minutes', header: 'Hours', align: 'right', render: (r: any) => (r.minutes / 60).toFixed(2) }, { key: 'status', header: 'Status', render: (r: any) => <Badge variant={statusTone(r.status) as any}>{r.status}</Badge> }]} data={row.time} keyExtractor={(r: any) => r.id} />
        </div>
      )}
      {row.extras?.length > 0 && (
        <div>
          <div className="text-sm font-semibold mb-1">Additional work</div>
          <Table
            columns={[
              { key: 'description', header: 'Description' },
              { key: 'amount', header: 'Amount', align: 'right', render: (r: any) => fmtMoney(r.amount) },
              { key: 'status', header: 'Status', render: (r: any) => (r.status === 'PROPOSED' && row.status === 'IN_PROGRESS' ? <span className="flex gap-1"><Button size="sm" onClick={() => decide(r.id, true)}>Accept</Button><Button size="sm" variant="secondary" onClick={() => decide(r.id, false)}>Decline</Button></span> : <Badge variant={statusTone(r.status) as any}>{r.status}{r.accepted_by_name ? ` · ${r.accepted_by_name}` : ''}</Badge>) },
            ]}
            data={row.extras}
            keyExtractor={(r: any) => r.id}
          />
        </div>
      )}
    </div>
  );
};

const tabs: TabDef[] = [
  { id: 'board', label: 'Dispatch board', render: ({ reloadKey }) => <DispatchBoard reloadKey={reloadKey} /> },
  {
    id: 'cases',
    label: 'Cases',
    endpoint: '/srv/cases',
    statuses: ['NEW', 'TRIAGED', 'SCHEDULED', 'IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'CLOSED', 'CANCELLED'],
    searchPlaceholder: 'Search case, customer, address…',
    columns: [
      { key: 'number', header: 'Case' },
      { key: 'title', header: 'Issue' },
      { key: 'party_name', header: 'Customer' },
      { key: 'priority', header: 'Priority', render: (r) => <Badge variant={priTone(r.priority) as any}>{r.priority}</Badge> },
      { key: 'channel', header: 'Channel', kind: 'badge' },
      { key: 'resolution_due_at', header: 'Resolve by', kind: 'datetime' },
      { key: 'contract_number', header: 'Contract' },
      { key: 'status', header: 'Status', kind: 'status' },
    ],
    detailFields: [
      { key: 'number', header: 'Case' },
      { key: 'party_name', header: 'Customer' },
      { key: 'title', header: 'Issue' },
      { key: 'description', header: 'Details' },
      { key: 'site_address', header: 'Site' },
      { key: 'category', header: 'Category' },
      { key: 'contract_number', header: 'Contract' },
      { key: 'triage_reason', header: 'Triage / hold reason' },
      { key: 'resolution_summary', header: 'Resolution' },
    ],
    detailExtra: (row) => <CaseExtra row={row} />,
    createLabel: 'Log service request',
    createFields: [
      partyRef(),
      { name: 'title', label: 'Issue', type: 'text', required: true, placeholder: 'AC not cooling in master bedroom' },
      { name: 'description', label: 'Details', type: 'textarea' },
      { name: 'priority', label: 'Priority', type: 'select', options: opts('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'), default: 'MEDIUM' },
      { name: 'category', label: 'Category', type: 'select', options: opts('REPAIR', 'INSTALLATION', 'MAINTENANCE', 'INSPECTION', 'COMPLAINT', 'OTHER'), default: 'REPAIR' },
      { name: 'channel', label: 'Channel', type: 'select', options: opts('PHONE', 'EMAIL', 'WHATSAPP', 'PORTAL', 'WALK_IN'), default: 'PHONE' },
      { name: 'external_ref', label: 'Channel reference', type: 'text', hint: 'Message/ticket id; a retried request with the same reference returns the existing case.' },
      { name: 'contract_id', label: 'Contract / warranty', type: 'ref', ref: { endpoint: '/srv/contracts?status=ACTIVE', label: (r) => `${r.number} · ${r.title}`, description: (r) => `${r.party_name} · ${r.contract_type}` }, hint: 'Validated: must be active, cover today and belong to this customer.' },
      { name: 'site_address', label: 'Site address', type: 'textarea' },
    ],
    editFields: [
      { name: 'title', label: 'Issue', type: 'text', required: true },
      { name: 'description', label: 'Details', type: 'textarea' },
      { name: 'site_address', label: 'Site address', type: 'textarea' },
    ],
    actions: [
      { id: 'triage', label: 'Triage', variant: 'primary', when: ['NEW', 'TRIAGED'], fields: [{ name: 'priority', label: 'Priority', type: 'select', required: true, options: opts('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') }, { name: 'triage_reason', label: 'Reason', type: 'textarea', required: true }] },
      { id: 'create-wo', label: 'Create work order', when: ['NEW', 'TRIAGED', 'SCHEDULED', 'IN_PROGRESS'], path: () => '/srv/work-orders', transform: (p, row) => ({ ...p, case_id: row.id }), fields: [{ name: 'instructions', label: 'Instructions for technician', type: 'textarea' }], success: 'Work order created with the standard HVAC checklist' },
      { id: 'hold', label: 'Pause (awaiting customer/parts)', when: ['TRIAGED', 'SCHEDULED', 'IN_PROGRESS'], fields: [{ name: 'triage_reason', label: 'Reason', type: 'textarea', required: true }] },
      { id: 'resume', label: 'Resume', when: ['ON_HOLD'] },
      { id: 'resolve', label: 'Resolve', variant: 'primary', when: ['TRIAGED', 'SCHEDULED', 'IN_PROGRESS'], fields: [{ name: 'resolution_summary', label: 'Resolution summary', type: 'textarea', required: true }] },
      { id: 'close', label: 'Close', when: ['RESOLVED'], confirm: 'Closing requires every completed work order to be billed.' },
      { id: 'cancel', label: 'Cancel', variant: 'destructive', when: ['NEW', 'TRIAGED', 'ON_HOLD'], fields: [{ name: 'triage_reason', label: 'Reason', type: 'textarea', required: true }] },
    ],
  },
  {
    id: 'work-orders',
    label: 'Work orders',
    endpoint: '/srv/work-orders',
    statuses: ['SCHEDULED', 'DISPATCHED', 'IN_PROGRESS', 'COMPLETED', 'BILLED', 'CANCELLED'],
    columns: [
      { key: 'number', header: 'Work order' },
      { key: 'case_number', header: 'Case' },
      { key: 'party_name', header: 'Customer' },
      { key: 'technician_name', header: 'Technician' },
      { key: 'scheduled_start', header: 'Scheduled', kind: 'datetime' },
      { key: 'warranty_covered', header: 'Warranty', kind: 'bool' },
      { key: 'billed_amount', header: 'Billed', kind: 'money' },
      { key: 'status', header: 'Status', kind: 'status' },
    ],
    detailFields: [
      { key: 'number', header: 'Work order' },
      { key: 'case_title', header: 'Issue' },
      { key: 'party_name', header: 'Customer' },
      { key: 'site_address', header: 'Site' },
      { key: 'technician_name', header: 'Technician' },
      { key: 'scheduled_start', header: 'From', kind: 'datetime' },
      { key: 'scheduled_end', header: 'To', kind: 'datetime' },
      { key: 'instructions', header: 'Instructions' },
      { key: 'resolution_notes', header: 'Resolution notes' },
    ],
    detailExtra: (row, reload) => <WorkOrderExtra row={row} reload={reload} />,
    actions: [
      { id: 'dispatch', label: 'Dispatch', variant: 'primary', when: ['SCHEDULED', 'DISPATCHED'], fields: [techRef(), { name: 'scheduled_start', label: 'Start', type: 'datetime', required: true }, { name: 'scheduled_end', label: 'End', type: 'datetime', required: true }] },
      { id: 'start', label: 'Start job', variant: 'primary', when: ['DISPATCHED'] },
      { id: 'parts', label: 'Issue part', when: ['IN_PROGRESS'], path: (r) => `/srv/work-orders/${r.id}/parts`, transform: (p) => ({ ...p, issue_key: p.issue_key || uid() }), fields: [itemRef(), { name: 'quantity', label: 'Quantity', type: 'decimal', required: true }, { name: 'chargeable', label: 'Charge to customer', type: 'bool', default: 'true' }], success: 'Part issued from stock (retry-safe)' },
      { id: 'time', label: 'Log time', when: ['IN_PROGRESS'], path: (r) => `/srv/work-orders/${r.id}/time`, fields: [{ name: 'start_at', label: 'From', type: 'datetime', required: true }, { name: 'end_at', label: 'To', type: 'datetime', required: true }, { name: 'billable', label: 'Billable', type: 'bool', default: 'true' }] },
      { id: 'extras', label: 'Propose extra work', when: ['IN_PROGRESS'], path: (r) => `/srv/work-orders/${r.id}/extras`, fields: [{ name: 'description', label: 'Description', type: 'text', required: true }, { name: 'amount', label: 'Price (PKR, excl. tax)', type: 'decimal', required: true }] },
      { id: 'signoff', label: 'Capture sign-off', when: ['IN_PROGRESS'], fields: [{ name: 'customer_signoff_name', label: 'Customer name', type: 'text', required: true }], success: 'Sign-off recorded; any later change to parts/time/checklist voids it' },
      { id: 'complete', label: 'Complete', variant: 'primary', when: ['IN_PROGRESS'], fields: [{ name: 'resolution_notes', label: 'What was done', type: 'textarea', required: true }] },
      { id: 'bill', label: 'Bill customer', variant: 'primary', when: ['COMPLETED'], fields: [{ name: 'invoice_date', label: 'Invoice date', type: 'date', required: true, default: today() }], confirm: 'Posts one AR invoice for approved labour, chargeable parts and accepted extras (warranty cover excluded). Cannot be repeated.' },
      { id: 'cancel', label: 'Cancel', variant: 'destructive', when: ['SCHEDULED', 'DISPATCHED'] },
    ],
  },
  {
    id: 'time',
    label: 'Time approvals',
    endpoint: '/srv/time',
    statuses: ['LOGGED', 'APPROVED', 'REJECTED'],
    noDetailFetch: true,
    columns: [
      { key: 'work_order_number', header: 'Work order' },
      { key: 'technician_name', header: 'Technician' },
      { key: 'start_at', header: 'From', kind: 'datetime' },
      { key: 'end_at', header: 'To', kind: 'datetime' },
      { key: 'hours', header: 'Hours', align: 'right' },
      { key: 'billable', header: 'Billable', kind: 'bool' },
      { key: 'logged_by', header: 'Logged by' },
      { key: 'status', header: 'Status', kind: 'status' },
    ],
    actions: [
      { id: 'approve', label: 'Approve', variant: 'primary', when: ['LOGGED'], path: (r) => `/srv/time/${r.id}/approve`, confirm: 'You cannot approve time you logged yourself.' },
      { id: 'reject', label: 'Reject', variant: 'destructive', when: ['LOGGED'], path: (r) => `/srv/time/${r.id}/reject` },
    ],
  },
  {
    id: 'contracts',
    label: 'Contracts & warranties',
    endpoint: '/srv/contracts',
    statuses: ['DRAFT', 'ACTIVE', 'EXPIRED', 'CANCELLED'],
    columns: [
      { key: 'number', header: 'Contract' },
      { key: 'title', header: 'Title' },
      { key: 'party_name', header: 'Customer' },
      { key: 'contract_type', header: 'Type', kind: 'badge' },
      { key: 'end_date', header: 'Valid to', kind: 'date' },
      { key: 'response_hours', header: 'Resp. h', align: 'right' },
      { key: 'next_pm_date', header: 'Next PM', kind: 'date' },
      { key: 'status', header: 'Status', kind: 'status' },
    ],
    createLabel: 'New contract',
    createFields: [
      partyRef(),
      { name: 'contract_type', label: 'Type', type: 'select', required: true, options: opts('WARRANTY', 'AMC', 'SLA_ONLY') },
      { name: 'title', label: 'Title', type: 'text', required: true },
      { name: 'equipment', label: 'Covered equipment', type: 'textarea' },
      { name: 'site_address', label: 'Site address', type: 'textarea' },
      { name: 'start_date', label: 'Start', type: 'date', required: true, default: today() },
      { name: 'end_date', label: 'End', type: 'date', required: true },
      { name: 'response_hours', label: 'Response (business hours)', type: 'int', default: '4' },
      { name: 'resolution_hours', label: 'Resolution (business hours)', type: 'int', default: '24' },
      { name: 'covers_labour', label: 'Covers labour', type: 'bool' },
      { name: 'covers_parts', label: 'Covers parts', type: 'bool' },
      { name: 'pm_interval_months', label: 'Preventive visit every (months)', type: 'int' },
      { name: 'contract_value', label: 'Contract value', type: 'decimal' },
    ],
    editFields: [
      { name: 'title', label: 'Title', type: 'text', required: true },
      { name: 'end_date', label: 'End', type: 'date' },
      { name: 'next_pm_date', label: 'Next PM date', type: 'date' },
    ],
    actions: [
      { id: 'activate', label: 'Activate', variant: 'primary', when: ['DRAFT'] },
      { id: 'expire', label: 'Mark expired', when: ['ACTIVE'] },
      { id: 'cancel', label: 'Cancel', variant: 'destructive', when: ['DRAFT', 'ACTIVE'] },
    ],
  },
  {
    id: 'technicians',
    label: 'Technicians',
    endpoint: '/srv/technicians',
    statuses: ['ACTIVE', 'INACTIVE'],
    columns: [
      { key: 'code', header: 'Code' },
      { key: 'name', header: 'Name' },
      { key: 'zone', header: 'Zone' },
      { key: 'skills', header: 'Skills' },
      { key: 'hourly_cost', header: 'Cost/h', kind: 'money' },
      { key: 'status', header: 'Status', kind: 'status' },
    ],
    createLabel: 'Add technician',
    createFields: [
      { name: 'code', label: 'Code', type: 'text', required: true, placeholder: 'T-004' },
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'skills', label: 'Skills', type: 'text' },
      { name: 'zone', label: 'Zone', type: 'text' },
      { name: 'phone', label: 'Phone', type: 'text' },
      { name: 'hourly_cost', label: 'Hourly cost', type: 'decimal' },
    ],
    editFields: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'skills', label: 'Skills', type: 'text' },
      { name: 'zone', label: 'Zone', type: 'text' },
      { name: 'phone', label: 'Phone', type: 'text' },
    ],
    actions: [
      { id: 'deactivate', label: 'Deactivate', variant: 'destructive', when: ['ACTIVE'] },
      { id: 'activate', label: 'Activate', when: ['INACTIVE'] },
    ],
  },
];

export const ServiceView: React.FC = () => (
  <ModuleWorkspace
    id="srv"
    title="Field Service"
    description="Service requests with business-hours SLAs, contract/warranty entitlements, conflict-free technician dispatch, checklists and customer sign-off, stock-backed parts, and one-time billing to receivables."
    tabs={tabs}
    summaryEndpoint="/srv/summary"
    kpis={(s) => [
      { label: 'Open cases', value: s.open_cases, sub: `${s.critical_open} critical`, tone: s.critical_open ? 'warning' : 'neutral' },
      { label: 'SLA breached', value: s.breached, tone: s.breached ? 'danger' : 'success' },
      { label: 'SLA attainment', value: s.sla_attainment_pct == null ? '—' : `${s.sla_attainment_pct}%`, sub: `${s.resolved} resolved` },
      { label: 'First-time fix', value: s.first_time_fix_pct == null ? '—' : `${s.first_time_fix_pct}%`, sub: s.first_time_fix_basis },
      { label: 'Awaiting billing', value: s.unbilled_work_orders, tone: s.unbilled_work_orders ? 'warning' : 'neutral' },
    ]}
  />
);
