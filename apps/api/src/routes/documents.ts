/**
 * DOC — document management. Documents hold immutable versions (sha256, ≤ 5 MB, allow-listed
 * types verified against magic bytes), link to business records (tenant-checked), go through
 * review → approval (approver ≠ submitter), and obey retention and legal hold: a document on hold
 * or inside its retention window cannot be deleted; deletion purges bytes but keeps the hash trail.
 */
import crypto from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { Permission, ErrorCode } from '@omnysync/contracts';
import { db, authenticate, requireAnyPermission } from '../context.js';
import { ok } from '../lib/http.js';
import { ApiError, notFound, validationError } from '../lib/errors.js';
import { audit, defineResource, emit, loadRow, unitOfWork } from '../lib/resource.js';
import { requireModule } from '../lib/modules.js';
import { assertOrgRef } from '../lib/scope.js';
import { str, todayIso, toIsoDate } from '../lib/validate.js';

const VIEW = [Permission.DOC_VIEW, Permission.DOC_MANAGE, Permission.DOC_HOLD];
export const MAX_BYTES = 5 * 1024 * 1024;
export const LINKABLE: Record<string, string> = {
  PARTY: 'parties', SERVICE_CASE: 'srv_cases', SERVICE_WORK_ORDER: 'srv_work_orders', SERVICE_CONTRACT: 'srv_contracts', OPPORTUNITY: 'crm_opportunities',
  SUPPLIER: 'sup_profiles', SHIPMENT: 'log_shipments', PROJECT: 'projects', EMPLOYEE: 'employees', PURCHASE_ORDER: 'purchase_orders', SALES_ORDER: 'sales_orders',
};
/** Human label SQL per linkable type (alias x), used by the link picker and to show what a document is linked to. */
const LINK_LABEL: Record<string, { from: string; label: string; order: string }> = {
  PARTY: { from: 'parties x', label: "x.code || ' · ' || x.name", order: 'x.code' },
  SERVICE_CASE: { from: 'srv_cases x', label: "x.number || ' · ' || x.title", order: 'x.number DESC' },
  SERVICE_WORK_ORDER: { from: 'srv_work_orders x', label: "x.number || ' · ' || x.status", order: 'x.number DESC' },
  SERVICE_CONTRACT: { from: 'srv_contracts x', label: "x.number || ' · ' || x.title", order: 'x.number DESC' },
  OPPORTUNITY: { from: 'crm_opportunities x', label: "x.number || ' · ' || x.name", order: 'x.number DESC' },
  SUPPLIER: { from: 'sup_profiles x JOIN parties p ON p.id = x.party_id', label: "p.code || ' · ' || p.name", order: 'p.code' },
  SHIPMENT: { from: 'log_shipments x', label: "x.number || ' · ' || x.status", order: 'x.number DESC' },
  PROJECT: { from: 'projects x', label: "x.code || ' · ' || x.name", order: 'x.code' },
  EMPLOYEE: { from: 'employees x', label: "x.employee_number || ' · ' || x.first_name || ' ' || x.last_name", order: 'x.employee_number' },
  PURCHASE_ORDER: { from: 'purchase_orders x', label: "x.po_number || ' · ' || x.status", order: 'x.po_number DESC' },
  SALES_ORDER: { from: 'sales_orders x', label: "x.order_number || ' · ' || x.status", order: 'x.order_number DESC' },
};
const entityLabelSql = `CASE t.entity_type ${Object.entries(LINK_LABEL)
  .map(([k, d]) => `WHEN '${k}' THEN (SELECT ${d.label} FROM ${d.from} WHERE x.id::text = t.entity_id::text AND x.organization_id = t.organization_id)`)
  .join(' ')} END`;

const MIME: Record<string, { ext: string[]; magic?: (b: Buffer) => boolean }> = {
  'application/pdf': { ext: ['pdf'], magic: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  'image/png': { ext: ['png'], magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { ext: ['jpg', 'jpeg'], magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'text/plain': { ext: ['txt', 'csv'], magic: (b) => !b.subarray(0, 4096).includes(0) },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: ['docx'], magic: (b) => b[0] === 0x50 && b[1] === 0x4b },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { ext: ['xlsx'], magic: (b) => b[0] === 0x50 && b[1] === 0x4b },
};

/** Validates an upload: allow-listed type, extension matches, bytes match the declared type, size bound. */
export function inspectUpload(filename: string, mime: string, contentBase64: string) {
  const spec = MIME[mime];
  if (!spec) throw validationError(`File type ${mime} is not allowed (${Object.keys(MIME).join(', ')})`, { field: 'mime_type' });
  const clean = filename.replace(/[\\/]/g, '_').replace(/[\u0000-\u001f]/g, '').trim();
  if (!clean || clean.length > 255) throw validationError('Invalid filename', { field: 'filename' });
  const ext = clean.includes('.') ? clean.split('.').pop()!.toLowerCase() : '';
  if (!spec.ext.includes(ext)) throw validationError(`A ${mime} file must end with .${spec.ext.join(' / .')}`, { field: 'filename' });
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(contentBase64)) throw validationError('content_base64 is not valid base64', { field: 'content_base64' });
  const bytes = Buffer.from(contentBase64, 'base64');
  if (!bytes.length) throw validationError('File is empty', { field: 'content_base64' });
  if (bytes.length > MAX_BYTES) throw validationError(`File exceeds ${MAX_BYTES / 1048576} MB`, { field: 'content_base64' });
  if (spec.magic && !spec.magic(bytes)) throw validationError(`File content does not match ${mime}`, { field: 'content_base64' });
  return { filename: clean, bytes, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

export function registerDocumentRoutes(app: Express): void {
  defineResource(app, {
    path: '/api/doc/documents',
    table: 'doc_documents',
    label: 'Document',
    event: 'DOCUMENT',
    module: 'DOC',
    view: VIEW,
    create: Permission.DOC_MANAGE,
    update: Permission.DOC_MANAGE,
    fields: {
      title: { type: 'string', required: true },
      category: { type: 'enum', values: ['CONTRACT', 'WARRANTY_CARD', 'SITE_PHOTO', 'INVOICE', 'CERTIFICATE', 'DRAWING', 'POLICY', 'HR', 'OTHER'], required: true },
      entity_type: { type: 'enum', values: Object.keys(LINKABLE) },
      entity_id: { type: 'string', max: 64 },
      retention_until: { type: 'date' },
    },
    editable: ['title', 'retention_until'],
    editableIn: ['DRAFT', 'IN_REVIEW', 'APPROVED'],
    numbering: { column: 'number', prefix: 'DOC' },
    initialStatus: 'DRAFT',
    select: `t.*, v.filename, v.mime_type, v.size_bytes, v.sha256, u.name AS owner_name, ${entityLabelSql} AS entity_label`,
    joins: 'LEFT JOIN doc_versions v ON v.document_id = t.id AND v.version_no = t.current_version LEFT JOIN users u ON u.id = t.created_by',
    search: ['number', 'title', 'v.filename'],
    filters: ['category', 'entity_type', 'entity_id', 'legal_hold'],
    detail: async (q, row) => ({
      versions: (await q.query(`SELECT v.id, v.version_no, v.filename, v.mime_type, v.size_bytes, v.sha256, v.note, v.created_at, (v.content IS NOT NULL) AS has_content, u.name AS uploaded_by_name FROM doc_versions v LEFT JOIN users u ON u.id = v.uploaded_by WHERE v.document_id = $1 ORDER BY v.version_no DESC`, [row.id])).rows,
    }),
    beforeCreate: async (ctx, v) => {
      if (!!v.entity_type !== !!v.entity_id) throw validationError('Provide both entity_type and entity_id to link a record', { field: 'entity_id' });
      if (v.entity_type) await assertOrgRef(ctx.tx, LINKABLE[v.entity_type], v.entity_id, ctx.org, 'entity_id');
    },
    commands: {
      submit: {
        from: ['DRAFT'],
        to: 'IN_REVIEW',
        permission: Permission.DOC_MANAGE,
        run: async (ctx, row) => {
          if (!row.current_version) throw new ApiError(409, ErrorCode.INVALID_STATE, 'Upload a file before submitting for review');
          return { set: { submitted_by: ctx.user } };
        },
      },
      approve: { from: ['IN_REVIEW'], to: 'APPROVED', permission: Permission.DOC_MANAGE, sodColumn: 'submitted_by', run: async (ctx) => ({ set: { approved_by: ctx.user, approved_at: new Date().toISOString() } }) },
      return: { from: ['IN_REVIEW'], to: 'DRAFT', permission: Permission.DOC_MANAGE },
      obsolete: { from: ['APPROVED'], to: 'OBSOLETE', permission: Permission.DOC_MANAGE },
      hold: { from: ['DRAFT', 'IN_REVIEW', 'APPROVED', 'OBSOLETE'], permission: Permission.DOC_HOLD, fields: { hold_reason: { type: 'text', required: true } }, run: async (_c, row, i) => {
        if (row.legal_hold) throw new ApiError(409, ErrorCode.INVALID_STATE, 'Document is already on legal hold');
        return { set: { legal_hold: true, hold_reason: i.hold_reason } };
      } },
      release: { from: ['DRAFT', 'IN_REVIEW', 'APPROVED', 'OBSOLETE'], permission: Permission.DOC_HOLD, fields: { hold_reason: { type: 'text', required: true } }, run: async (_c, row, i) => {
        if (!row.legal_hold) throw new ApiError(409, ErrorCode.INVALID_STATE, 'Document is not on legal hold');
        return { set: { legal_hold: false, hold_reason: `Released: ${i.hold_reason}` } };
      } },
      delete: {
        from: ['DRAFT', 'IN_REVIEW', 'APPROVED', 'OBSOLETE'],
        to: 'DELETED',
        permission: Permission.DOC_MANAGE,
        fields: { reason: { type: 'text', required: true } },
        run: async (ctx, row) => {
          if (row.legal_hold) throw new ApiError(409, ErrorCode.LEGAL_HOLD, `Document is under legal hold (${row.hold_reason}) and cannot be deleted`);
          if (row.retention_until && toIsoDate(row.retention_until) > todayIso()) throw new ApiError(409, ErrorCode.LEGAL_HOLD, `Retention period runs until ${toIsoDate(row.retention_until)}`);
          await ctx.tx.query(`UPDATE doc_versions SET content = NULL WHERE document_id = $1`, [row.id]);
          return { set: { deleted_at: new Date().toISOString() } };
        },
      },
    },
  });

  /** Link picker: records of one linkable type in this organisation (tenant-scoped, label only). */
  app.get('/api/doc/link-targets', authenticate, requireAnyPermission(Permission.DOC_MANAGE), async (req: Request, res: Response) => {
    const type = String(req.query.type || '');
    const d = LINK_LABEL[type];
    if (!d) throw validationError(`type must be one of ${Object.keys(LINK_LABEL).join(', ')}`, { field: 'type' });
    const search = typeof req.query.search === 'string' && req.query.search.trim() ? `%${req.query.search.trim().slice(0, 80)}%` : null;
    const r = await db.query(
      `SELECT x.id, ${d.label} AS label FROM ${d.from} WHERE x.organization_id = $1 AND ($2::text IS NULL OR ${d.label} ILIKE $2) ORDER BY ${d.order} LIMIT 200`,
      [req.session!.organization_id, search],
    );
    return ok(req, res, r.rows.map((x: any) => ({ ...x, entity_type: type })));
  });

  app.post('/api/doc/documents/:id/versions', authenticate, requireAnyPermission(Permission.DOC_MANAGE), requireModule('DOC'), async (req: Request, res: Response) => {
    const out = await unitOfWork(req, async (ctx) => {
      const d = await loadRow(ctx.tx, 'doc_documents', req.params.id, ctx.org, 'Document', true);
      if (!['DRAFT', 'APPROVED'].includes(d.status)) throw new ApiError(409, ErrorCode.INVALID_STATE, `Cannot add a version to a ${d.status.toLowerCase().replace('_', ' ')} document`);
      const f = inspectUpload(str(req.body?.filename, 'filename', { max: 255 }), str(req.body?.mime_type, 'mime_type', { max: 80 }), String(req.body?.content_base64 ?? ''));
      const latest = (await ctx.tx.query(`SELECT sha256 FROM doc_versions WHERE document_id = $1 AND version_no = $2`, [d.id, d.current_version])).rows[0];
      if (latest && latest.sha256 === f.sha256) throw new ApiError(409, ErrorCode.DUPLICATE_RESOURCE, `Identical to version ${d.current_version} (same sha256)`);
      const n = Number(d.current_version) + 1;
      const v = (
        await ctx.tx.query(
          `INSERT INTO doc_versions (organization_id, document_id, version_no, filename, mime_type, size_bytes, sha256, content, note, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING id, version_no, filename, mime_type, size_bytes, sha256, created_at`,
          [ctx.org, d.id, n, f.filename, req.body.mime_type, f.bytes.length, f.sha256, f.bytes, req.body?.note ? str(req.body.note, 'note', { max: 2000 }) : null, ctx.user],
        )
      ).rows[0];
      // A new version of an approved document goes back through review.
      await ctx.tx.query(`UPDATE doc_documents SET current_version = $2, status = CASE WHEN status = 'APPROVED' THEN 'DRAFT' ELSE status END, approved_by = CASE WHEN status = 'APPROVED' THEN NULL ELSE approved_by END, revision = revision + 1, updated_at = NOW() WHERE id = $1`, [d.id, n]);
      await audit(ctx, 'DOCUMENT_VERSION_ADDED', 'DOCUMENT', d.id, { version: d.current_version }, { version: n, sha256: f.sha256, size: f.bytes.length });
      await emit(ctx, 'DOCUMENT_VERSION_ADDED', { id: d.id, number: d.number, version: n, sha256: f.sha256 });
      return { ...v, requires_review: d.status === 'APPROVED' };
    });
    return ok(req, res, out, 201);
  });

  app.get('/api/doc/documents/:id/versions/:v/download', authenticate, requireAnyPermission(...VIEW), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const r = await db.query(`SELECT v.* FROM doc_versions v JOIN doc_documents d ON d.id = v.document_id WHERE d.organization_id = $1 AND d.id::text = $2 AND v.version_no = $3`, [org, req.params.id, Number(req.params.v) || 0]);
    const v = r.rows[0];
    if (!v) throw notFound('Document version');
    if (!v.content) throw new ApiError(410, ErrorCode.INVALID_STATE, 'Content was purged when the document was deleted; only the hash trail remains');
    const bytes: Buffer = Buffer.isBuffer(v.content) ? v.content : Buffer.from(v.content);
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== v.sha256) throw new ApiError(500, ErrorCode.INVALID_STATE, 'Stored content failed its integrity check');
    res.setHeader('Content-Type', v.mime_type);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename="${String(v.filename).replace(/"/g, '')}"`);
    res.setHeader('X-Content-SHA256', v.sha256);
    return res.send(bytes);
  });

  app.get('/api/doc/summary', authenticate, requireAnyPermission(...VIEW), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const s = (
      await db.query(
        `SELECT COUNT(*) FILTER (WHERE status <> 'DELETED')::int documents, COUNT(*) FILTER (WHERE status = 'IN_REVIEW')::int in_review, COUNT(*) FILTER (WHERE legal_hold)::int on_hold,
          COUNT(*) FILTER (WHERE status <> 'DELETED' AND retention_until IS NOT NULL AND retention_until < CURRENT_DATE)::int retention_expired,
          (SELECT COALESCE(SUM(size_bytes),0)::bigint FROM doc_versions WHERE organization_id = $1 AND content IS NOT NULL)::text stored_bytes
         FROM doc_documents WHERE organization_id = $1`,
        [org],
      )
    ).rows[0];
    return ok(req, res, s);
  });
}
