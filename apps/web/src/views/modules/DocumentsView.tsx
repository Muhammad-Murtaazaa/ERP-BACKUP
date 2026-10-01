import React, { useRef, useState } from 'react';
import { ApiClient, API_BASE } from '../../api/client.js';
import { Alert, Badge, Button, Input, Table } from '@omnysync/ui';
import { ModuleWorkspace, TabDef, FormField, fmtWhen } from '../kit/ModuleWorkspace.js';
import { opts } from './shared.js';

const LINK_TYPES = ['PARTY', 'SERVICE_CASE', 'SERVICE_WORK_ORDER', 'SERVICE_CONTRACT', 'OPPORTUNITY', 'SUPPLIER', 'SHIPMENT', 'PROJECT', 'EMPLOYEE', 'PURCHASE_ORDER', 'SALES_ORDER', 'CANDIDATE'];
const ALLOWED = 'application/pdf,image/png,image/jpeg,text/plain,.csv,.docx,.xlsx';
const size = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const toBase64 = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('Could not read the file'));
    r.readAsDataURL(f);
  });

const Versions: React.FC<{ row: any; reload: () => void }> = ({ row, reload }) => {
  const input = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'danger'; text: string } | null>(null);
  const canUpload = ['DRAFT', 'APPROVED'].includes(row.status);
  const upload = async () => {
    const f = input.current?.files?.[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) return setMsg({ kind: 'danger', text: 'Files are limited to 5 MB.' });
    try {
      setBusy(true);
      setMsg(null);
      const r: any = await ApiClient.post(`/doc/documents/${row.id}/versions`, { filename: f.name, mime_type: f.type || 'text/plain', content_base64: await toBase64(f), note: note || undefined });
      setMsg({ kind: 'success', text: `Version ${r.version_no} stored (sha256 ${r.sha256.slice(0, 12)}…)${r.requires_review ? ' — document returned to draft for re-review' : ''}` });
      setNote('');
      if (input.current) input.current.value = '';
      reload();
    } catch (e: any) {
      setMsg({ kind: 'danger', text: e.message });
    } finally {
      setBusy(false);
    }
  };
  const download = async (v: any) => {
    const res = await fetch(`${API_BASE}/doc/documents/${row.id}/versions/${v.version_no}/download`, { headers: { Authorization: `Bearer ${ApiClient.getToken()}` } });
    if (!res.ok) return setMsg({ kind: 'danger', text: res.status === 410 ? 'Content was purged when the document was deleted.' : 'Download failed.' });
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = v.filename;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="flex flex-col gap-3">
      {row.legal_hold && <Alert variant="warning" title="Legal hold">{row.hold_reason} — this document cannot be deleted.</Alert>}
      {msg && <Alert variant={msg.kind} title={msg.kind === 'success' ? 'Uploaded' : 'Upload refused'}>{msg.text}</Alert>}
      {canUpload && (
        <div className="flex flex-col gap-2 rounded-md border border-dashed border-[#C9CFDB] p-3">
          <label className="text-sm font-medium" htmlFor="doc-file">Upload new version</label>
          <input id="doc-file" ref={input} type="file" accept={ALLOWED} className="text-sm" />
          <Input label="Version note" value={note} onChange={(e) => setNote(e.target.value)} />
          <div><Button onClick={upload} disabled={busy}>{busy ? 'Uploading…' : 'Upload'}</Button></div>
          <p className="text-[11px] text-[#46536B]">PDF, PNG, JPEG, TXT/CSV, DOCX, XLSX up to 5 MB. Content is checked against its declared type.</p>
        </div>
      )}
      <Table
        columns={[
          { key: 'version_no', header: 'v' },
          { key: 'filename', header: 'File' },
          { key: 'size_bytes', header: 'Size', render: (v: any) => size(v.size_bytes) },
          { key: 'sha256', header: 'SHA-256', render: (v: any) => <code className="text-[11px]">{v.sha256.slice(0, 16)}…</code> },
          { key: 'created_at', header: 'Uploaded', render: (v: any) => `${fmtWhen(v.created_at)} · ${v.uploaded_by_name || ''}` },
          { key: 'id', header: '', render: (v: any) => (v.has_content ? <Button size="sm" variant="secondary" onClick={() => download(v)}>Download</Button> : <Badge variant="neutral">Purged</Badge>) },
        ]}
        data={row.versions || []}
        keyExtractor={(v: any) => v.id}
        emptyMessage="No versions yet."
      />
    </div>
  );
};

const tabs: TabDef[] = [
  {
    id: 'documents',
    label: 'Documents',
    endpoint: '/doc/documents',
    statuses: ['DRAFT', 'IN_REVIEW', 'APPROVED', 'OBSOLETE', 'DELETED'],
    searchPlaceholder: 'Search number, title, filename…',
    columns: [
      { key: 'number', header: 'Document' },
      { key: 'title', header: 'Title' },
      { key: 'category', header: 'Category', kind: 'badge' },
      { key: 'entity_type', header: 'Linked to', render: (r) => (r.entity_type ? `${r.entity_type.replace(/_/g, ' ').toLowerCase()}${r.entity_label ? ` · ${r.entity_label}` : ''}` : '—') },
      { key: 'current_version', header: 'v', align: 'right' },
      { key: 'filename', header: 'File' },
      { key: 'legal_hold', header: 'Hold', render: (r) => (r.legal_hold ? <Badge variant="warning">Legal hold</Badge> : '') },
      { key: 'status', header: 'Status', kind: 'status' },
    ],
    detailFields: [
      { key: 'number', header: 'Document' },
      { key: 'title', header: 'Title' },
      { key: 'category', header: 'Category' },
      { key: 'entity_type', header: 'Linked record type' },
      { key: 'entity_label', header: 'Linked record' },
      { key: 'retention_until', header: 'Retain until', kind: 'date' },
      { key: 'owner_name', header: 'Owner' },
      { key: 'approved_at', header: 'Approved', kind: 'datetime' },
    ],
    detailExtra: (row, reload) => <Versions row={row} reload={reload} />,
    createLabel: 'New document',
    createFields: [
      { name: 'title', label: 'Title', type: 'text', required: true },
      { name: 'category', label: 'Category', type: 'select', required: true, options: opts('CONTRACT', 'WARRANTY_CARD', 'SITE_PHOTO', 'INVOICE', 'CERTIFICATE', 'DRAWING', 'POLICY', 'HR', 'OTHER') },
      { name: 'entity_type', label: 'Link to record type', type: 'select', options: opts(...LINK_TYPES) },
      ...LINK_TYPES.map((t): FormField => ({ name: 'entity_id', label: `Linked ${t.replace(/_/g, ' ').toLowerCase()}`, type: 'ref', when: (v) => v.entity_type === t, ref: { endpoint: `/doc/link-targets?type=${t}`, label: (r) => r.label } })),
      { name: 'retention_until', label: 'Retain until', type: 'date', hint: 'Deletion is refused before this date.' },
    ],
    editFields: [{ name: 'title', label: 'Title', type: 'text' }, { name: 'retention_until', label: 'Retain until', type: 'date' }],
    actions: [
      { id: 'submit', label: 'Submit for review', variant: 'primary', when: ['DRAFT'] },
      { id: 'approve', label: 'Approve', variant: 'primary', when: ['IN_REVIEW'], confirm: 'The submitter cannot approve their own document.' },
      { id: 'return', label: 'Return to draft', when: ['IN_REVIEW'] },
      { id: 'obsolete', label: 'Mark obsolete', when: ['APPROVED'] },
      { id: 'hold', label: 'Place legal hold', when: (r) => !r.legal_hold && r.status !== 'DELETED', fields: [{ name: 'hold_reason', label: 'Matter / reason', type: 'textarea', required: true }] },
      { id: 'release', label: 'Release hold', when: (r) => r.legal_hold, fields: [{ name: 'hold_reason', label: 'Release reason', type: 'textarea', required: true }] },
      { id: 'delete', label: 'Delete', variant: 'destructive', when: (r) => r.status !== 'DELETED' && !r.legal_hold, fields: [{ name: 'reason', label: 'Reason', type: 'textarea', required: true }], confirm: 'Purges file content (hashes are kept). Refused under legal hold or retention.' },
    ],
  },
];

export const DocumentsView: React.FC = () => (
  <ModuleWorkspace
    id="doc"
    title="Documents"
    description="Versioned documents with integrity hashes and type checks, links to customers, service jobs, suppliers and shipments, review with maker-checker, retention and legal hold."
    tabs={tabs}
    summaryEndpoint="/doc/summary"
    kpis={(s) => [
      { label: 'Documents', value: s.documents },
      { label: 'In review', value: s.in_review, tone: s.in_review ? 'warning' : 'neutral' },
      { label: 'On legal hold', value: s.on_hold },
      { label: 'Past retention', value: s.retention_expired },
      { label: 'Stored', value: size(Number(s.stored_bytes)) },
    ]}
  />
);
