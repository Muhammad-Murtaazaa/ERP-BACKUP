import { describe, it, expect } from 'vitest';
import { canSeeModule, MODULE_PERMS, MODULE_NAV } from '../src/views/modules/registry.js';

describe('sidebar module gating', () => {
  it('every registered module workspace declares its read permissions', () => {
    for (const sec of MODULE_NAV) for (const it of sec.items) expect(MODULE_PERMS[it.id], it.id).toBeTruthy();
  });
  it('shows a module when the user holds any read permission, hides it otherwise', () => {
    expect(canSeeModule('srv', ['service.workorder.execute'])).toBe(true);
    expect(canSeeModule('srv', ['bi.view'])).toBe(false);
    expect(canSeeModule('bi', ['bi.view'])).toBe(true);
    expect(canSeeModule('dashboard', [])).toBe(true); // legacy items are not gated here
    expect(canSeeModule('srv', undefined)).toBe(true); // before the session loads
  });
});

describe('MODULE_PERMS literals stay in sync with contracts', () => {
  it('every literal is a real Permission value', async () => {
    const { Permission } = await import('@omnysync/contracts');
    const all = new Set(Object.values(Permission));
    for (const [id, perms] of Object.entries(MODULE_PERMS)) for (const p of perms) expect(all.has(p as any), `${id}: ${p}`).toBe(true);
  });
});
