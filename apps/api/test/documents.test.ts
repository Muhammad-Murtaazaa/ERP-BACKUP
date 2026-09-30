import { describe, it, expect, beforeAll } from 'vitest';
import { bootstrap, login, makeRequest, db } from './harness.js';
import { inspectUpload, MAX_BYTES } from '../src/routes/documents.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64');
const PDF2 = Buffer.from('%PDF-1.4\n% revision 2\n%%EOF').toString('base64');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString('base64');

describe('DOC upload inspection', () => {
  it('allow-list, extension, magic bytes, size and base64 are enforced; path characters stripped', () => {
    expect(() => inspectUpload('x.exe', 'application/x-msdownload', PDF)).toThrow(/not allowed/);
    expect(() => inspectUpload('report.png', 'application/pdf', PDF)).toThrow(/must end with/);
    expect(() => inspectUpload('fake.pdf', 'application/pdf', PNG)).toThrow(/does not match/);
    expect(() => inspectUpload('a.pdf', 'application/pdf', '***')).toThrow(/base64/);
    expect(() => inspectUpload('big.txt', 'text/plain', Buffer.alloc(MAX_BYTES + 1, 65).toString('base64'))).toThrow(/exceeds/);
    const ok = inspectUpload('../../etc/warranty.pdf', 'application/pdf', PDF);
    expect(ok.filename).toBe('.._.._etc_warranty.pdf');
    expect(ok.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('DOC API', () => {
  let admin: string;
  let service: string;
  let tech: string;
  let controller: string;
  beforeAll(async () => {
    await bootstrap();
    [admin, service, tech, controller] = await Promise.all(['admin', 'service', 'tech', 'controller'].map((u) => login(`${u}@omnysync.internal`)));
  });

  it('versions, links, review SoD, re-review after new version, integrity-checked download', async () => {
    const c = (await db.query(`SELECT id FROM srv_contracts LIMIT 1`)).rows[0];
    expect((await makeRequest('POST', '/api/doc/documents', { title: 'x', category: 'CONTRACT', entity_type: 'SERVICE_CONTRACT' }, service)).status).toBe(400);
    expect((await makeRequest('POST', '/api/doc/documents', { title: 'x', category: 'CONTRACT', entity_type: 'SERVICE_CONTRACT', entity_id: '00000000-0000-0000-0000-000000000000' }, service)).status).toBe(400);
    expect((await makeRequest('POST', '/api/doc/documents', { title: 'x', category: 'CONTRACT' }, tech)).status).toBe(403);
    const d = (await makeRequest('POST', '/api/doc/documents', { title: 'AMC agreement signed copy', category: 'CONTRACT', entity_type: 'SERVICE_CONTRACT', entity_id: c.id }, service)).body.data;
    expect((await makeRequest('POST', `/api/doc/documents/${d.id}/submit`, {}, service)).status).toBe(409); // no file yet
    const v1 = await makeRequest('POST', `/api/doc/documents/${d.id}/versions`, { filename: 'amc.pdf', mime_type: 'application/pdf', content_base64: PDF }, service);
    expect(v1.status).toBe(201);
    expect(v1.body.data.version_no).toBe(1);
    const same = await makeRequest('POST', `/api/doc/documents/${d.id}/versions`, { filename: 'amc-copy.pdf', mime_type: 'application/pdf', content_base64: PDF }, service);
    expect(same.status).toBe(409);
    expect((await makeRequest('POST', `/api/doc/documents/${d.id}/submit`, {}, service)).status).toBe(200);
    expect((await makeRequest('POST', `/api/doc/documents/${d.id}/versions`, { filename: 'v.pdf', mime_type: 'application/pdf', content_base64: PDF2 }, service)).status).toBe(409); // locked in review
    expect((await makeRequest('POST', `/api/doc/documents/${d.id}/approve`, {}, service)).body.error.code).toBe('SEGREGATION_OF_DUTIES');
    expect((await makeRequest('POST', `/api/doc/documents/${d.id}/approve`, {}, admin)).status).toBe(200);
    const v2 = await makeRequest('POST', `/api/doc/documents/${d.id}/versions`, { filename: 'amc-v2.pdf', mime_type: 'application/pdf', content_base64: PDF2 }, service);
    expect(v2.body.data.requires_review).toBe(true);
    const after = (await makeRequest('GET', `/api/doc/documents/${d.id}`, undefined, tech)).body.data;
    expect(after.status).toBe('DRAFT');
    expect(after.versions.map((v: any) => v.version_no)).toEqual([2, 1]);
    const listed = (await makeRequest('GET', `/api/doc/documents?entity_type=SERVICE_CONTRACT&entity_id=${c.id}`, undefined, tech)).body.data;
    expect(listed.map((x: any) => x.id)).toContain(d.id);
    // Tamper detection on download.
    await db.query(`UPDATE doc_versions SET content = $2 WHERE document_id = $1 AND version_no = 1`, [d.id, Buffer.from('%PDF-tampered')]);
    const bad = await makeRequest('GET', `/api/doc/documents/${d.id}/versions/1/download`, undefined, tech);
    expect(bad.status).toBe(500);
  });

  it('legal hold and retention block deletion; deletion purges bytes but keeps the hash trail', async () => {
    const d = (await makeRequest('POST', '/api/doc/documents', { title: 'Site photo — leak', category: 'SITE_PHOTO', retention_until: '2030-12-31' }, service)).body.data;
    await makeRequest('POST', `/api/doc/documents/${d.id}/versions`, { filename: 'leak.png', mime_type: 'image/png', content_base64: PNG }, service);
    expect((await makeRequest('POST', `/api/doc/documents/${d.id}/delete`, { reason: 'dup' }, service)).body.error.code).toBe('LEGAL_HOLD'); // retention
    expect((await makeRequest('POST', `/api/doc/documents/${d.id}/update`, { revision: 2, retention_until: '2026-01-01' }, service)).status).toBe(200);
    expect((await makeRequest('POST', `/api/doc/documents/${d.id}/hold`, { hold_reason: 'Warranty dispute #44' }, service)).status).toBe(403); // no DOC_HOLD
    expect((await makeRequest('POST', `/api/doc/documents/${d.id}/hold`, { hold_reason: 'Warranty dispute #44' }, controller)).status).toBe(200);
    const blocked = await makeRequest('POST', `/api/doc/documents/${d.id}/delete`, { reason: 'cleanup' }, service);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('LEGAL_HOLD');
    await expect(db.query(`UPDATE doc_documents SET status = 'DELETED' WHERE id = $1`, [d.id])).rejects.toThrow(); // DB constraint backs it up
    expect((await makeRequest('POST', `/api/doc/documents/${d.id}/release`, { hold_reason: 'Dispute settled' }, controller)).status).toBe(200);
    const del = await makeRequest('POST', `/api/doc/documents/${d.id}/delete`, { reason: 'Superseded' }, service);
    expect(del.status).toBe(200);
    const v = (await db.query(`SELECT content, sha256 FROM doc_versions WHERE document_id = $1`, [d.id])).rows[0];
    expect(v.content).toBeNull();
    expect(v.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await makeRequest('GET', `/api/doc/documents/${d.id}/versions/1/download`, undefined, service)).status).toBe(410);
  });
});
