import React from 'react';
import { Badge, Table } from '@omnysync/ui';
import { ModuleWorkspace, TabDef, FormField, fmtWhen } from '../kit/ModuleWorkspace.js';
import { fmtMoney } from '../../lib/format.js';
import { opts, today } from './shared.js';

const vehicleRef: FormField = { name: 'vehicle_id', label: 'Vehicle', type: 'ref', required: true, ref: { endpoint: '/flt/vehicles?status=ACTIVE', label: (r) => `${r.code} · ${r.registration}`, description: (r) => `${r.make_model} · ${Number(r.odometer_km).toLocaleString()} km` } };
const techRef: FormField = { name: 'technician_id', label: 'Technician', type: 'ref', required: true, ref: { endpoint: '/srv/technicians?status=ACTIVE', label: (r) => `${r.code} · ${r.name}`, description: (r) => r.zone } };
const due = (d?: string) => {
  if (!d) return '—';
  const days = Math.round((Date.parse(String(d).slice(0, 10)) - Date.now()) / 86400000);
  return <span className={days < 0 ? 'text-[#C62828] font-medium' : days < 30 ? 'text-[#8A5A00] font-medium' : ''}>{String(d).slice(0, 10)}{days < 0 ? ' · expired' : days < 30 ? ` · ${days}d` : ''}</span>;
};

const tabs: TabDef[] = [
  {
    id: 'vehicles',
    label: 'Vehicles',
    endpoint: '/flt/vehicles',
    statuses: ['ACTIVE', 'IN_MAINTENANCE', 'RETIRED'],
    columns: [
      { key: 'code', header: 'Vehicle' },
      { key: 'registration', header: 'Registration' },
      { key: 'make_model', header: 'Make / model' },
      { key: 'odometer_km', header: 'Odometer', align: 'right', render: (r) => `${Number(r.odometer_km).toLocaleString()} km` },
      { key: 'avg_km_per_litre', header: 'km/L', align: 'right' },
      { key: 'current_driver', header: 'With' },
      { key: 'insurance_expiry', header: 'Insurance', render: (r) => due(r.insurance_expiry) },
      { key: 'fitness_expiry', header: 'Fitness', render: (r) => due(r.fitness_expiry) },
      { key: 'status', header: 'Status', kind: 'status' },
    ],
    detailFields: [
      { key: 'code', header: 'Vehicle' },
      { key: 'registration', header: 'Registration' },
      { key: 'make_model', header: 'Make / model' },
      { key: 'model_year', header: 'Year' },
      { key: 'fuel_type', header: 'Fuel' },
      { key: 'status_note', header: 'Status note' },
    ],
    detailExtra: (row) => (
      <div className="flex flex-col gap-3">
        {row.maintenance_work_order && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950/40">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">Maintenance work order {row.maintenance_work_order.work_order_number}</span>
              <Badge variant={row.maintenance_work_order.status === 'COMPLETED' ? 'success' : 'warning'}>{row.maintenance_work_order.status}</Badge>
            </div>
            <div className="mt-1 text-muted-foreground">{row.maintenance_work_order.description}</div>
            <div className="mt-1 text-xs text-muted-foreground">Complete it under Maintenance → Work orders before putting the vehicle back in service.</div>
          </div>
        )}
        <div className="text-sm font-semibold">Recent fuel</div>
        <Table columns={[{ key: 'log_date', header: 'Date', render: (r: any) => String(r.log_date).slice(0, 10) }, { key: 'odometer_km', header: 'Odometer', align: 'right' }, { key: 'litres', header: 'Litres', align: 'right' }, { key: 'km_per_litre', header: 'km/L', align: 'right' }, { key: 'amount', header: 'Amount', align: 'right', render: (r: any) => fmtMoney(r.amount) }, { key: 'status', header: 'Status', render: (r: any) => <Badge variant={r.status === 'POSTED' ? 'success' : r.status === 'VOID' ? 'neutral' : 'info'}>{r.status}</Badge> }]} data={row.fuel || []} keyExtractor={(r: any) => r.id} emptyMessage="No fuel logged." />
        <div className="text-sm font-semibold">Assignments</div>
        <Table columns={[{ key: 'technician_name', header: 'Technician' }, { key: 'start_at', header: 'From', render: (r: any) => fmtWhen(r.start_at) }, { key: 'end_at', header: 'To', render: (r: any) => fmtWhen(r.end_at) }, { key: 'status', header: 'Status' }]} data={row.assignments || []} keyExtractor={(r: any) => r.id} emptyMessage="No assignments." />
      </div>
    ),
    createLabel: 'Add vehicle',
    createFields: [
      { name: 'code', label: 'Fleet code', type: 'text', required: true, placeholder: 'VAN-03' },
      { name: 'registration', label: 'Registration', type: 'text', required: true, placeholder: 'LEB-21-4410' },
      { name: 'make_model', label: 'Make / model', type: 'text', required: true },
      { name: 'model_year', label: 'Model year', type: 'int' },
      { name: 'fuel_type', label: 'Fuel', type: 'select', options: opts('PETROL', 'DIESEL', 'CNG', 'HYBRID', 'EV'), default: 'PETROL' },
      { name: 'odometer_km', label: 'Current odometer (km)', type: 'decimal' },
      { name: 'insurance_expiry', label: 'Insurance expiry', type: 'date' },
      { name: 'fitness_expiry', label: 'Fitness / route permit expiry', type: 'date' },
    ],
    editFields: [{ name: 'make_model', label: 'Make / model', type: 'text' }, { name: 'insurance_expiry', label: 'Insurance expiry', type: 'date' }, { name: 'fitness_expiry', label: 'Fitness expiry', type: 'date' }],
    actions: [
      { id: 'maintenance', label: 'Send to maintenance', when: ['ACTIVE'], fields: [{ name: 'status_note', label: 'What needs fixing', type: 'textarea', required: true }, { name: 'priority', label: 'Priority', type: 'select', options: opts('LOW', 'MEDIUM', 'HIGH', 'EMERGENCY'), hint: 'Opens a corrective work order in Maintenance.' }] },
      { id: 'reactivate', label: 'Back in service', variant: 'primary', when: ['IN_MAINTENANCE'] },
      { id: 'retire', label: 'Retire', variant: 'destructive', when: ['ACTIVE', 'IN_MAINTENANCE'], fields: [{ name: 'status_note', label: 'Reason', type: 'textarea', required: true }] },
    ],
  },
  {
    id: 'assignments',
    label: 'Assignments',
    endpoint: '/flt/assignments',
    statuses: ['BOOKED', 'RETURNED', 'CANCELLED'],
    columns: [
      { key: 'vehicle_code', header: 'Vehicle' },
      { key: 'registration', header: 'Registration' },
      { key: 'technician_name', header: 'Technician' },
      { key: 'start_at', header: 'From', kind: 'datetime' },
      { key: 'end_at', header: 'To', kind: 'datetime' },
      { key: 'purpose', header: 'Purpose' },
      { key: 'status', header: 'Status', kind: 'status' },
    ],
    createLabel: 'Assign vehicle',
    createFields: [vehicleRef, techRef, { name: 'start_at', label: 'From', type: 'datetime', required: true }, { name: 'end_at', label: 'To', type: 'datetime', required: true }, { name: 'purpose', label: 'Purpose', type: 'text' }],
    actions: [{ id: 'return', label: 'Returned', variant: 'primary', when: ['BOOKED'] }, { id: 'cancel', label: 'Cancel', variant: 'destructive', when: ['BOOKED'] }],
  },
  {
    id: 'fuel',
    label: 'Fuel log',
    endpoint: '/flt/fuel',
    statuses: ['LOGGED', 'POSTED', 'VOID'],
    columns: [
      { key: 'log_date', header: 'Date', kind: 'date' },
      { key: 'vehicle_code', header: 'Vehicle' },
      { key: 'odometer_km', header: 'Odometer', align: 'right' },
      { key: 'litres', header: 'Litres', align: 'right' },
      { key: 'price_per_litre', header: 'PKR/L', align: 'right' },
      { key: 'km_per_litre', header: 'km/L', align: 'right' },
      { key: 'amount', header: 'Amount', kind: 'money' },
      { key: 'paid_by', header: 'Paid by', kind: 'badge' },
      { key: 'status', header: 'Status', kind: 'status' },
    ],
    createLabel: 'Log fuel',
    createFields: [vehicleRef, { name: 'log_date', label: 'Date', type: 'date', required: true, default: today() }, { name: 'odometer_km', label: 'Odometer (km)', type: 'decimal', required: true, hint: 'Must exceed the previous reading.' }, { name: 'litres', label: 'Litres', type: 'decimal', required: true }, { name: 'amount', label: 'Amount (PKR)', type: 'decimal', required: true }, { name: 'station', label: 'Station', type: 'text' }, { name: 'paid_by', label: 'Paid by', type: 'select', options: opts('CASH', 'ACCOUNT'), default: 'CASH' }],
    actions: [
      { id: 'post', label: 'Post expense', variant: 'primary', when: ['LOGGED'], confirm: 'Posts DR fuel expense / CR cash or accrued, once, in an open period.' },
      { id: 'void', label: 'Void', variant: 'destructive', when: ['LOGGED'], fields: [{ name: 'void_reason', label: 'Reason', type: 'textarea', required: true }] },
    ],
  },
];

export const FleetView: React.FC = () => (
  <ModuleWorkspace
    id="flt"
    title="Fleet"
    description="Service vans and bikes: compliance expiry, conflict-free technician assignments, odometer-checked fuel logs with efficiency, and one-time fuel expense posting."
    tabs={tabs}
    summaryEndpoint="/flt/summary"
    kpis={(s) => [
      { label: 'Active vehicles', value: s.active, sub: `${s.maintenance} in maintenance` },
      { label: 'Compliance due ≤30d', value: s.compliance_due, tone: s.compliance_due ? 'warning' : 'success' },
      { label: 'Fuel spend (MTD)', value: fmtMoney(s.fuel_mtd), sub: `${Number(s.litres_mtd).toFixed(0)} L` },
      { label: 'Average km/L', value: s.avg_kmpl ?? '—' },
      { label: 'Unposted fuel logs', value: s.unposted, tone: s.unposted ? 'warning' : 'neutral' },
    ]}
  />
);
