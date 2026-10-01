import { describe, it, expect, beforeAll } from 'vitest';
import { bootstrap, login, makeRequest, db } from './harness.js';

describe('Workman Services HRM Features', () => {
  let hr: string;
  let admin: string;
  let tech: string;

  beforeAll(async () => {
    await bootstrap();
    [hr, admin, tech] = await Promise.all(['hr', 'admin', 'tech'].map((u) => login(`${u}@omnysync.internal`)));
  });

  it('1. manages staff advances with maker-checker approval and GL disbursement', async () => {
    const empsRes = await makeRequest('GET', '/api/hrm/employees', undefined, hr);
    expect(empsRes.status).toBe(200);
    const empId = empsRes.body.data[0].id;

    // Create advance request
    const advRes = await makeRequest('POST', '/api/hrm/advances', {
      employee_id: empId,
      advance_type: 'PARTS_FLOAT',
      amount: '30000.00',
      purpose: 'Site emergency float for VRF compressor tools',
      repayment_months: 3,
    }, hr);
    expect(advRes.status).toBe(201);
    expect(advRes.body.data.status).toBe('DRAFT');
    const advId = advRes.body.data.id;

    // Approver cannot be creator (SoD check)
    const selfApprove = await makeRequest('POST', `/api/hrm/advances/${advId}/approve`, {}, hr);
    expect(selfApprove.status).toBe(403);

    // Admin approves
    const approveRes = await makeRequest('POST', `/api/hrm/advances/${advId}/approve`, {}, admin);
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.data.status).toBe('APPROVED');

    // Admin disburses GL
    const disburseRes = await makeRequest('POST', `/api/hrm/advances/${advId}/disburse`, {}, admin);
    expect(disburseRes.status).toBe(200);
    expect(disburseRes.body.data.status).toBe('DISBURSED');
  });

  it('2. records geofence attendance check-in and check-out', async () => {
    const empsRes = await makeRequest('GET', '/api/hrm/employees', undefined, hr);
    const empId = empsRes.body.data[0].id;

    // Check in inside Karachi HQ geofence
    const inRes = await makeRequest('POST', '/api/hrm/attendance/check-in', {
      employee_id: empId,
      latitude: 24.86071,
      longitude: 67.00112,
      verification_method: 'FACE_VERIFIED',
      notes: 'Morning site punch',
    }, tech);
    expect(inRes.status).toBe(201);
    expect(inRes.body.data.geofence_status).toBe('INSIDE_GEOFENCE');
    expect(inRes.body.data.status).toBe('PRESENT');

    // Check out
    const outRes = await makeRequest('POST', '/api/hrm/attendance/check-out', {
      employee_id: empId,
    }, tech);
    expect(outRes.status).toBe(200);
    expect(outRes.body.data.check_out_time).toBeTruthy();
  });

  it('3. handles staff expense claims and cash settlement', async () => {
    const empsRes = await makeRequest('GET', '/api/hrm/employees', undefined, hr);
    const empId = empsRes.body.data[0].id;

    // Submit claim
    const expRes = await makeRequest('POST', '/api/hrm/expenses', {
      employee_id: empId,
      category: 'FUEL',
      amount: '4500.00',
      description: 'Fuel for emergency site visit',
      receipt_reference: 'PSO-9921',
    }, tech);
    expect(expRes.status).toBe(201);
    const expId = expRes.body.data.id;

    // Approve claim
    const appRes = await makeRequest('POST', `/api/hrm/expenses/${expId}/approve`, {}, hr);
    expect(appRes.status).toBe(200);
    expect(appRes.body.data.status).toBe('APPROVED');

    // Settle cash GL
    const settleRes = await makeRequest('POST', `/api/hrm/expenses/${expId}/settle`, {}, admin);
    expect(settleRes.status).toBe(200);
    expect(settleRes.body.data.status).toBe('SETTLED_CASH');
  });
});
