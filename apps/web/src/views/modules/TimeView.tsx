import React, { useState } from 'react';
import { ApiClient } from '../../api/client.js';
import { Alert, Button, Table } from '@omnysync/ui';
import { ModuleWorkspace, TabDef } from '../kit/ModuleWorkspace.js';
import { fmtMoney } from '../../lib/format.js';
import { employeeRef, opts, today } from './shared.js';
import type { FormField } from '../kit/ModuleWorkspace.js';

/** TIM forms pick from /time/employees, which limits technicians (self-service) to their own record. */
const timeEmployeeRef = (): FormField => { const f = employeeRef(); return { ...f, ref: { ...f.ref!, endpoint: '/time/employees', description: (r: any) => r.employment_type } }; };

const monday = () => {
  const d = new Date();
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const Entries: React.FC<{ row: any; reload: () => void }> = ({ row, reload }) => {
  const [err, setErr] = useState<string | null>(null);
  const editable = ['DRAFT', 'REJECTED'].includes(row.status);
  const remove = async (id: string) => {
    try {
      setErr(null);
      await ApiClient.post(`/time/entries/${id}/delete`, {});
      reload();
    } catch (e: any) {
      setErr(e.message);
    }
  };
  const byDay = new Map<string, number>();
  for (const e of row.entries || []) byDay.set(String(e.work_date).slice(0, 10), (byDay.get(String(e.work_date).slice(0, 10)) || 0) + Number(e.hours));
  return (
    <div className="flex flex-col gap-3">
      {err && <Alert variant="danger" title="Couldn’t remove">{err}</Alert>}
      <div className="grid grid-cols-7 gap-1 text-center">
        {Array.from({ length: 7 }, (_, i) => {
          const d = new Date(Date.parse(`${String(row.week_start).slice(0, 10)}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10);
          const h = byDay.get(d) || 0;
          return (
            <div key={d} className={`rounded-md border p-1 ${h > 8 ? 'border-[#E0A100] bg-[#FFF8E6]' : 'border-[#E3E6EE]'}`}>
              <div className="text-[10px] text-[#46536B]">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i]} {d.slice(8)}</div>
              <div className="text-sm font-semibold">{h ? h.toFixed(2) : '–'}</div>
            </div>
          );
        })}
      </div>
      <Table
        columns={[
          { key: 'work_date', header: 'Date', render: (r: any) => String(r.work_date).slice(0, 10) },
          { key: 'start_time', header: 'From', render: (r: any) => String(r.start_time).slice(0, 5) },
          { key: 'end_time', header: 'To', render: (r: any) => String(r.end_time).slice(0, 5) },
          { key: 'hours', header: 'Hours', align: 'right' },
          { key: 'activity', header: 'Activity' },
          { key: 'project_code', header: 'Project' },
          { key: 'id', header: '', render: (r: any) => (editable ? <Button size="sm" variant="secondary" onClick={() => remove(r.id)}>Remove</Button> : null) },
        ]}
        data={row.entries || []}
        keyExtractor={(r: any) => r.id}
        emptyMessage="No entries yet — use “Add entry”."
      />
    </div>
  );
};

const tabs: TabDef[] = [
  {
    id: 'timesheets',
    label: 'Timesheets',
    endpoint: '/time/timesheets',
    statuses: ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'POSTED'],
    columns: [
      { key: 'number', header: 'Timesheet' },
      { key: 'employee_name', header: 'Employee' },
      { key: 'week_start', header: 'Week of', kind: 'date' },
      { key: 'total_hours', header: 'Hours', align: 'right' },
      { key: 'overtime_hours', header: 'Overtime', align: 'right' },
      { key: 'cost_amount', header: 'Cost', kind: 'money' },
      { key: 'status', header: 'Status', kind: 'status' },
    ],
    detailFields: [
      { key: 'number', header: 'Timesheet' },
      { key: 'employee_name', header: 'Employee' },
      { key: 'week_start', header: 'Week start', kind: 'date' },
      { key: 'week_end', header: 'Week end', kind: 'date' },
      { key: 'cost_rate', header: 'Cost rate / h', kind: 'money' },
      { key: 'total_hours', header: 'Total hours' },
      { key: 'overtime_hours', header: 'Overtime hours (×1.5)' },
      { key: 'cost_amount', header: 'Labour cost', kind: 'money' },
      { key: 'approved_by_name', header: 'Approved by' },
      { key: 'reject_reason', header: 'Rejected because' },
    ],
    detailExtra: (row, reload) => <Entries row={row} reload={reload} />,
    createLabel: 'New timesheet',
    createFields: [timeEmployeeRef(), { name: 'week_start', label: 'Week starting (Monday)', type: 'date', required: true, default: monday() }, { name: 'cost_rate', label: 'Cost rate (PKR / hour)', type: 'decimal', required: true }, { name: 'notes', label: 'Notes', type: 'textarea' }],
    editFields: [{ name: 'cost_rate', label: 'Cost rate', type: 'decimal' }, { name: 'notes', label: 'Notes', type: 'textarea' }],
    actions: [
      {
        id: 'entries',
        label: 'Add entry',
        variant: 'primary',
        when: ['DRAFT', 'REJECTED'],
        path: (r) => `/time/timesheets/${r.id}/entries`,
        fields: [
          { name: 'work_date', label: 'Date', type: 'date', required: true, default: today() },
          { name: 'start_time', label: 'From (HH:MM)', type: 'text', required: true, placeholder: '09:00' },
          { name: 'end_time', label: 'To (HH:MM)', type: 'text', required: true, placeholder: '17:30' },
          { name: 'activity', label: 'Activity', type: 'text', required: true },
          { name: 'project_id', label: 'Project', type: 'ref', ref: { endpoint: '/projects', label: (r) => `${r.code} · ${r.name}` } },
          { name: 'billable', label: 'Billable', type: 'bool' },
        ],
        success: 'Entry added — overlaps and leave days are rejected',
      },
      { id: 'submit', label: 'Submit', variant: 'primary', when: ['DRAFT', 'REJECTED'] },
      { id: 'approve', label: 'Approve', variant: 'primary', when: ['SUBMITTED'], confirm: 'You cannot approve a timesheet you prepared.' },
      { id: 'reject', label: 'Reject', variant: 'destructive', when: ['SUBMITTED'], fields: [{ name: 'reject_reason', label: 'Reason', type: 'textarea', required: true }] },
      { id: 'post', label: 'Post labour cost', variant: 'primary', when: ['APPROVED'], fields: [{ name: 'posting_date', label: 'Posting date (default week end)', type: 'date' }], confirm: 'Posts DR project labour cost / CR accrued labour once, in an open period.' },
    ],
  },
  {
    id: 'leave',
    label: 'Leave',
    endpoint: '/time/leave',
    statuses: ['REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED'],
    columns: [
      { key: 'employee_name', header: 'Employee' },
      { key: 'leave_type', header: 'Type', kind: 'badge' },
      { key: 'start_date', header: 'From', kind: 'date' },
      { key: 'end_date', header: 'To', kind: 'date' },
      { key: 'days', header: 'Working days', align: 'right' },
      { key: 'status', header: 'Status', kind: 'status' },
    ],
    createLabel: 'Request leave',
    createFields: [timeEmployeeRef(), { name: 'leave_type', label: 'Type', type: 'select', required: true, options: opts('ANNUAL', 'SICK', 'CASUAL', 'UNPAID', 'MATERNITY', 'PATERNITY', 'HAJJ') }, { name: 'start_date', label: 'From', type: 'date', required: true }, { name: 'end_date', label: 'To', type: 'date', required: true }, { name: 'reason', label: 'Reason', type: 'textarea' }],
    actions: [
      { id: 'approve', label: 'Approve', variant: 'primary', when: ['REQUESTED'], fields: [{ name: 'decision_note', label: 'Note', type: 'textarea' }] },
      { id: 'reject', label: 'Reject', variant: 'destructive', when: ['REQUESTED'], fields: [{ name: 'decision_note', label: 'Reason', type: 'textarea', required: true }] },
      { id: 'cancel', label: 'Cancel', when: ['REQUESTED', 'APPROVED'] },
    ],
  },
];

export const TimeView: React.FC = () => (
  <ModuleWorkspace
    id="time"
    title="Time & Attendance"
    description="Weekly timesheets with overlap-checked clock entries, daily overtime, maker-checker approval, one-time labour cost posting by project, and leave requests that block time on leave days."
    tabs={tabs}
    summaryEndpoint="/time/summary"
    kpis={(s) => [
      { label: 'Awaiting approval', value: s.awaiting_approval, tone: s.awaiting_approval ? 'warning' : 'neutral' },
      { label: 'Approved, not posted', value: s.awaiting_posting },
      { label: 'Hours (MTD)', value: Number(s.hours_mtd).toFixed(1), sub: `${Number(s.overtime_mtd).toFixed(1)} overtime` },
      { label: 'Labour cost posted', value: fmtMoney(s.posted_cost) },
      { label: 'Leave pending / today', value: `${s.leave.pending} / ${s.leave.on_leave_today}` },
    ]}
  />
);
