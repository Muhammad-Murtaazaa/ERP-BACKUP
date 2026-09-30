import React from 'react';
import { Badge } from '@omnysync/ui';
import { ModuleWorkspace, TabDef, FormField, fmtWhen } from '../kit/ModuleWorkspace.js';
import { fmtMoney } from '../../lib/format.js';
import { opts, partyRef } from './shared.js';

const carrierRef = (required = false): FormField => ({ name: 'carrier_id', label: 'Carrier', type: 'ref', required, ref: { endpoint: '/log/carriers?status=ACTIVE', label: (r) => `${r.code} · ${r.name}`, description: (r) => r.mode } });
const ICON: Record<string, string> = { BOOKED: '📋', PICKED_UP: '📦', IN_TRANSIT: '🚚', AT_HUB: '🏭', OUT_FOR_DELIVERY: '🛵', DELIVERED: '✅', EXCEPTION: '⚠️', NOTE: '📝' };

const Timeline: React.FC<{ row: any }> = ({ row }) => (
  <div className="flex flex-col gap-2">
    {row.tracking_url && (
      <a className="text-sm text-[#5940B8] underline" href={row.tracking_url} target="_blank" rel="noreferrer noopener">Open carrier tracking page</a>
    )}
    <div className="text-sm font-semibold">Tracking timeline</div>
    <ol className="relative border-l border-[#E3E6EE] ml-2">
      {(row.events || []).map((e: any) => (
        <li key={e.id} className="ml-4 mb-3">
          <span className="absolute -left-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-white text-[11px]" aria-hidden>{ICON[e.code] || '•'}</span>
          <div className="text-sm font-medium">{e.code.replace(/_/g, ' ')} {e.location ? <span className="text-[#46536B] font-normal">· {e.location}</span> : null}</div>
          <div className="text-[11px] text-[#46536B]">{fmtWhen(e.event_at)} · {e.source.toLowerCase()}{e.recorded_by ? ` · ${e.recorded_by}` : ''}</div>
          {e.note && <div className="text-xs mt-0.5">{e.note}</div>}
        </li>
      ))}
      {!row.events?.length && <li className="ml-4 text-sm text-[#46536B]">No events yet — book the shipment to start tracking.</li>}
    </ol>
  </div>
);

const tabs: TabDef[] = [
  {
    id: 'shipments',
    label: 'Shipments',
    endpoint: '/log/shipments',
    statuses: ['PLANNED', 'BOOKED', 'IN_TRANSIT', 'EXCEPTION', 'DELIVERED', 'CANCELLED'],
    searchPlaceholder: 'Search number, tracking, destination…',
    columns: [
      { key: 'number', header: 'Shipment' },
      { key: 'direction', header: 'Dir.', kind: 'badge' },
      { key: 'party_name', header: 'Party' },
      { key: 'destination', header: 'Destination' },
      { key: 'carrier_name', header: 'Carrier' },
      { key: 'tracking_number', header: 'Tracking' },
      { key: 'promised_date', header: 'Promised', render: (r) => (r.promised_date ? <span className={r.late ? 'text-[#C62828] font-medium' : ''}>{String(r.promised_date).slice(0, 10)}{r.late ? ' · late' : ''}</span> : '—') },
      { key: 'freight_amount', header: 'Freight', kind: 'money' },
      { key: 'status', header: 'Status', kind: 'status' },
    ],
    detailFields: [
      { key: 'number', header: 'Shipment' },
      { key: 'origin', header: 'From' },
      { key: 'destination', header: 'To' },
      { key: 'sales_order_number', header: 'Sales order' },
      { key: 'purchase_order_number', header: 'Purchase order' },
      { key: 'packages', header: 'Packages' },
      { key: 'weight_kg', header: 'Weight (kg)' },
      { key: 'shipped_at', header: 'Shipped', kind: 'datetime' },
      { key: 'delivered_at', header: 'Delivered', kind: 'datetime' },
      { key: 'pod_name', header: 'Received by' },
      { key: 'exception_reason', header: 'Exception' },
      { key: 'freight_journal_id', header: 'Freight journal', render: (r) => (r.freight_journal_id ? <Badge variant="success">Posted</Badge> : <Badge variant="neutral">Not posted</Badge>) },
    ],
    detailExtra: (row) => <Timeline row={row} />,
    createLabel: 'New shipment',
    createFields: [
      { name: 'direction', label: 'Direction', type: 'select', required: true, options: opts('OUTBOUND', 'INBOUND'), default: 'OUTBOUND' },
      partyRef('party_id', 'Customer / vendor', false),
      { name: 'sales_order_id', label: 'Sales order', type: 'ref', ref: { endpoint: '/sales/orders', label: (r) => r.order_number, description: (r) => r.status }, when: (v) => v.direction !== 'INBOUND' },
      carrierRef(),
      { name: 'origin', label: 'Origin', type: 'text', required: true, default: 'Lahore main warehouse' },
      { name: 'destination', label: 'Destination', type: 'text', required: true },
      { name: 'packages', label: 'Packages', type: 'int', default: '1' },
      { name: 'weight_kg', label: 'Weight (kg)', type: 'decimal' },
      { name: 'planned_ship_date', label: 'Planned ship date', type: 'date' },
      { name: 'promised_date', label: 'Promised delivery', type: 'date' },
      { name: 'freight_amount', label: 'Freight (PKR)', type: 'decimal' },
    ],
    editFields: [carrierRef(), { name: 'destination', label: 'Destination', type: 'text' }, { name: 'promised_date', label: 'Promised delivery', type: 'date' }, { name: 'freight_amount', label: 'Freight (PKR)', type: 'decimal' }],
    actions: [
      { id: 'book', label: 'Book with carrier', variant: 'primary', when: ['PLANNED'], fields: [carrierRef(), { name: 'tracking_number', label: 'Tracking / consignment no.', type: 'text', required: true }] },
      { id: 'dispatch', label: 'Mark picked up', variant: 'primary', when: ['BOOKED'], fields: [{ name: 'shipped_at', label: 'Picked up at', type: 'datetime' }] },
      { id: 'events', label: 'Add tracking event', when: ['BOOKED', 'IN_TRANSIT', 'EXCEPTION'], path: (r) => `/log/shipments/${r.id}/events`, fields: [{ name: 'code', label: 'Event', type: 'select', required: true, options: opts('PICKED_UP', 'IN_TRANSIT', 'AT_HUB', 'OUT_FOR_DELIVERY', 'EXCEPTION', 'NOTE') }, { name: 'event_at', label: 'When', type: 'datetime', required: true }, { name: 'location', label: 'Location', type: 'text' }, { name: 'note', label: 'Note', type: 'textarea' }] },
      { id: 'deliver', label: 'Confirm delivery (POD)', variant: 'primary', when: ['IN_TRANSIT', 'EXCEPTION'], fields: [{ name: 'pod_name', label: 'Received by', type: 'text', required: true }, { name: 'delivered_at', label: 'Delivered at', type: 'datetime' }, { name: 'pod_note', label: 'Note', type: 'textarea' }] },
      { id: 'exception', label: 'Report exception', variant: 'destructive', when: ['BOOKED', 'IN_TRANSIT'], fields: [{ name: 'exception_reason', label: 'What happened', type: 'textarea', required: true }] },
      { id: 'resume', label: 'Resume transit', when: ['EXCEPTION'] },
      { id: 'post-freight', label: 'Post freight cost', when: (r) => !r.freight_journal_id && ['BOOKED', 'IN_TRANSIT', 'DELIVERED', 'EXCEPTION'].includes(r.status), fields: [{ name: 'posting_date', label: 'Posting date', type: 'date' }], confirm: 'Posts DR freight / CR carrier payable (or accrued freight) once, in an open period.' },
      { id: 'cancel', label: 'Cancel', variant: 'destructive', when: ['PLANNED', 'BOOKED'] },
    ],
  },
  {
    id: 'carriers',
    label: 'Carriers',
    endpoint: '/log/carriers',
    statuses: ['ACTIVE', 'INACTIVE'],
    columns: [
      { key: 'code', header: 'Code' },
      { key: 'name', header: 'Name' },
      { key: 'mode', header: 'Mode', kind: 'badge' },
      { key: 'vendor_name', header: 'Vendor account' },
      { key: 'status', header: 'Status', kind: 'status' },
    ],
    createLabel: 'Add carrier',
    createFields: [
      { name: 'code', label: 'Code', type: 'text', required: true },
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'mode', label: 'Mode', type: 'select', required: true, options: opts('ROAD', 'AIR', 'SEA', 'RAIL', 'COURIER', 'OWN_FLEET') },
      partyRef('party_id', 'Vendor account (for AP)', false),
      { name: 'tracking_url_template', label: 'Tracking URL template', type: 'text', placeholder: 'https://carrier.pk/track/{tracking}' },
    ],
    editFields: [{ name: 'name', label: 'Name', type: 'text' }, { name: 'tracking_url_template', label: 'Tracking URL template', type: 'text' }],
    actions: [{ id: 'deactivate', label: 'Deactivate', variant: 'destructive', when: ['ACTIVE'] }, { id: 'activate', label: 'Activate', when: ['INACTIVE'] }],
  },
];

export const LogisticsView: React.FC = () => (
  <ModuleWorkspace
    id="log"
    title="Logistics"
    description="Inbound and outbound shipments with carrier booking, replay-safe tracking events, mandatory proof of delivery, on-time performance and one-time freight cost posting."
    tabs={tabs}
    summaryEndpoint="/log/summary"
    kpis={(s) => [
      { label: 'In flight', value: s.in_flight },
      { label: 'Late', value: s.late, tone: s.late ? 'danger' : 'success' },
      { label: 'Exceptions', value: s.exceptions, tone: s.exceptions ? 'warning' : 'neutral' },
      { label: 'On-time delivery', value: s.otd_pct == null ? '—' : `${s.otd_pct}%` },
      { label: 'Freight posted (MTD)', value: fmtMoney(s.freight_mtd), sub: `${s.freight_unposted} unposted` },
    ]}
  />
);
