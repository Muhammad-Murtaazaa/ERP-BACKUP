import React from 'react';
import { Badge, Table } from '@omnysync/ui';
import { ModuleWorkspace, TabDef, FormField } from '../kit/ModuleWorkspace.js';
import { opts, partyRef } from './shared.js';

const CERTS = ['NTN', 'STRN', 'ISO9001', 'ISO14001', 'OEM_AUTHORISATION', 'INSURANCE', 'SAFETY', 'BANK_LETTER', 'OTHER'];
const profileRef: FormField = { name: 'profile_id', label: 'Supplier', type: 'ref', required: true, ref: { endpoint: '/sup/profiles', label: (r) => `${r.party_code} · ${r.party_name}`, description: (r) => `${r.category} · ${r.status}` } };
const gradeTone = (g?: string) => (g === 'A' ? 'success' : g === 'B' ? 'info' : g === 'C' ? 'warning' : g ? 'danger' : 'neutral');

const ProfileExtra: React.FC<{ row: any }> = ({ row }) => (
  <div className="flex flex-col gap-3">
    {row.missing_certificates?.length > 0 && (
      <p className="text-sm text-[#8A5A00] bg-[#FFF8E6] border border-[#F0D48A] rounded-md p-2">Approval blocked until these are on file and valid: <strong>{row.missing_certificates.join(', ')}</strong></p>
    )}
    <div className="text-sm font-semibold">Certificates</div>
    <Table
      columns={[
        { key: 'cert_type', header: 'Type' },
        { key: 'reference', header: 'Reference' },
        { key: 'expires_on', header: 'Expires', render: (r: any) => (r.expires_on ? String(r.expires_on).slice(0, 10) : 'No expiry') },
        { key: 'status', header: 'State', render: (r: any) => <Badge variant={r.status !== 'ACTIVE' ? 'neutral' : r.expired ? 'danger' : 'success'}>{r.status !== 'ACTIVE' ? r.status : r.expired ? 'EXPIRED' : 'VALID'}</Badge> },
      ]}
      data={row.certificates || []}
      keyExtractor={(r: any) => r.id}
      emptyMessage="No certificates yet."
    />
    {row.scorecards?.length > 0 && (
      <>
        <div className="text-sm font-semibold">Scorecards</div>
        <Table columns={[{ key: 'period', header: 'Period' }, { key: 'weighted_score', header: 'Score', align: 'right' }, { key: 'grade', header: 'Grade', render: (r: any) => <Badge variant={gradeTone(r.grade) as any}>{r.grade}</Badge> }, { key: 'status', header: 'Status' }]} data={row.scorecards} keyExtractor={(r: any) => r.id} />
      </>
    )}
  </div>
);

const tabs: TabDef[] = [
  {
    id: 'profiles',
    label: 'Suppliers',
    endpoint: '/sup/profiles',
    statuses: ['PROSPECT', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED', 'BLOCKED'],
    columns: [
      { key: 'party_name', header: 'Supplier' },
      { key: 'category', header: 'Category', kind: 'badge' },
      { key: 'risk_level', header: 'Risk', kind: 'badge' },
      { key: 'latest_score', header: 'Score', align: 'right' },
      { key: 'latest_grade', header: 'Grade', render: (r) => (r.latest_grade ? <Badge variant={gradeTone(r.latest_grade) as any}>{r.latest_grade}</Badge> : '—') },
      { key: 'certs_expiring', header: 'Certs expiring ≤30d', render: (r) => (r.certs_expiring ? <Badge variant="warning">{r.certs_expiring}</Badge> : '—') },
      { key: 'status', header: 'Status', kind: 'status' },
    ],
    detailFields: [
      { key: 'party_name', header: 'Supplier' },
      { key: 'category', header: 'Category' },
      { key: 'risk_level', header: 'Risk' },
      { key: 'contact_name', header: 'Contact' },
      { key: 'status_reason', header: 'Status reason' },
      { key: 'approved_at', header: 'Approved', kind: 'datetime' },
    ],
    detailExtra: (row) => <ProfileExtra row={row} />,
    createLabel: 'New supplier profile',
    createFields: [
      partyRef('party_id', 'Vendor'),
      { name: 'category', label: 'Category', type: 'select', required: true, options: opts('EQUIPMENT', 'SPARE_PARTS', 'REFRIGERANT', 'SUBCONTRACTOR', 'LOGISTICS', 'SERVICES', 'OTHER') },
      { name: 'risk_level', label: 'Risk', type: 'select', options: opts('LOW', 'MEDIUM', 'HIGH'), default: 'MEDIUM' },
      { name: 'required_certificates', label: 'Required certificates (JSON list)', type: 'json', default: '["NTN","STRN"]', hint: CERTS.join(', ') },
      { name: 'contact_name', label: 'Contact', type: 'text' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
    editFields: [
      { name: 'risk_level', label: 'Risk', type: 'select', options: opts('LOW', 'MEDIUM', 'HIGH') },
      { name: 'contact_name', label: 'Contact', type: 'text' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
    actions: [
      { id: 'submit', label: 'Submit for approval', variant: 'primary', when: ['PROSPECT', 'REJECTED'] },
      { id: 'approve', label: 'Approve', variant: 'primary', when: ['UNDER_REVIEW'], confirm: 'Requires every required certificate valid today; the submitter cannot approve.' },
      { id: 'reject', label: 'Reject', variant: 'destructive', when: ['UNDER_REVIEW'], fields: [{ name: 'status_reason', label: 'Reason', type: 'textarea', required: true }] },
      { id: 'suspend', label: 'Suspend', when: ['APPROVED'], fields: [{ name: 'status_reason', label: 'Reason', type: 'textarea', required: true }] },
      { id: 'block', label: 'Block', variant: 'destructive', when: ['PROSPECT', 'UNDER_REVIEW', 'APPROVED', 'SUSPENDED'], fields: [{ name: 'status_reason', label: 'Reason', type: 'textarea', required: true }], confirm: 'Blocked suppliers cannot receive purchase orders.' },
      { id: 'reinstate', label: 'Reinstate (to review)', when: ['SUSPENDED', 'BLOCKED'], fields: [{ name: 'status_reason', label: 'Reason', type: 'textarea', required: true }] },
    ],
  },
  {
    id: 'certificates',
    label: 'Certificates',
    endpoint: '/sup/certificates',
    statuses: ['ACTIVE', 'REVOKED'],
    columns: [
      { key: 'supplier_name', header: 'Supplier' },
      { key: 'cert_type', header: 'Type', kind: 'badge' },
      { key: 'reference', header: 'Reference' },
      { key: 'expires_on', header: 'Expires', kind: 'date' },
      { key: 'days_to_expiry', header: 'Days left', render: (r) => (r.days_to_expiry == null ? '—' : <span className={r.days_to_expiry < 0 ? 'text-[#C62828] font-medium' : r.days_to_expiry < 30 ? 'text-[#8A5A00] font-medium' : ''}>{r.days_to_expiry}</span>) },
      { key: 'status', header: 'Status', kind: 'status' },
    ],
    createLabel: 'Add certificate',
    createFields: [profileRef, { name: 'cert_type', label: 'Type', type: 'select', required: true, options: opts(...CERTS) }, { name: 'reference', label: 'Reference / number', type: 'text', required: true }, { name: 'issued_on', label: 'Issued', type: 'date' }, { name: 'expires_on', label: 'Expires', type: 'date' }],
    editFields: [{ name: 'reference', label: 'Reference', type: 'text' }, { name: 'expires_on', label: 'Expires', type: 'date' }],
    actions: [{ id: 'revoke', label: 'Revoke', variant: 'destructive', when: ['ACTIVE'] }],
  },
  {
    id: 'scorecards',
    label: 'Scorecards',
    endpoint: '/sup/scorecards',
    statuses: ['DRAFT', 'FINAL'],
    columns: [
      { key: 'supplier_name', header: 'Supplier' },
      { key: 'period', header: 'Period' },
      { key: 'quality_score', header: 'Quality (40)', align: 'right' },
      { key: 'delivery_score', header: 'Delivery (30)', align: 'right', render: (r) => `${r.delivery_score}${r.total_receipts ? ` · ${r.on_time_receipts}/${r.total_receipts} on time` : ''}` },
      { key: 'price_score', header: 'Price (20)', align: 'right', render: (r) => `${r.price_score}${r.price_index != null ? ` · index ${Number(r.price_index).toFixed(2)}` : ''}` },
      { key: 'service_score', header: 'Service (10)', align: 'right' },
      { key: 'weighted_score', header: 'Weighted', align: 'right' },
      { key: 'grade', header: 'Grade', render: (r) => <Badge variant={gradeTone(r.grade) as any}>{r.grade}</Badge> },
      { key: 'status', header: 'Status', kind: 'status' },
    ],
    createLabel: 'New scorecard',
    createFields: [
      profileRef,
      { name: 'period', label: 'Period (YYYY-MM)', type: 'text', required: true, placeholder: '2026-09' },
      { name: 'quality_score', label: 'Quality 0–100', type: 'int', required: true },
      { name: 'delivery_score', label: 'Delivery 0–100', type: 'int', hint: 'Leave empty to derive from goods-receipt dates vs PO expected dates.' },
      { name: 'price_score', label: 'Price 0–100', type: 'int', hint: 'Leave empty to derive from this period’s PO prices vs the 12-month price paid to all suppliers for the same items.' },
      { name: 'service_score', label: 'Service 0–100', type: 'int', required: true },
      { name: 'comments', label: 'Comments', type: 'textarea' },
    ],
    editFields: [
      { name: 'quality_score', label: 'Quality', type: 'int' },
      { name: 'delivery_score', label: 'Delivery', type: 'int' },
      { name: 'price_score', label: 'Price', type: 'int' },
      { name: 'service_score', label: 'Service', type: 'int' },
    ],
    actions: [{ id: 'finalise', label: 'Finalise', variant: 'primary', when: ['DRAFT'], confirm: 'Final scorecards are locked.' }],
  },
];

export const SupplierView: React.FC = () => (
  <ModuleWorkspace
    id="sup"
    title="Supplier Management"
    description="Supplier qualification with certificate checks and maker-checker approval, expiry tracking, weighted scorecards, and a procurement block on suspended or blocked suppliers."
    tabs={tabs}
    summaryEndpoint="/sup/summary"
    kpis={(s) => [
      { label: 'Approved suppliers', value: s.by_status.APPROVED || 0, tone: 'success' },
      { label: 'Under review', value: s.by_status.UNDER_REVIEW || 0 },
      { label: 'Blocked / suspended', value: (s.by_status.BLOCKED || 0) + (s.by_status.SUSPENDED || 0), tone: (s.by_status.BLOCKED || 0) + (s.by_status.SUSPENDED || 0) ? 'danger' : 'neutral' },
      { label: 'Certificates expired / ≤30d', value: `${s.certificates.expired} / ${s.certificates.expiring}`, tone: s.certificates.expired ? 'warning' : 'neutral' },
      { label: 'Average score', value: s.average_score ?? '—' },
    ]}
  />
);
