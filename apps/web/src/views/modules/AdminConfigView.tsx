import React, { useEffect, useState } from 'react';
import { ApiClient } from '../../api/client.js';
import { Alert, Badge, Button, Combobox, Drawer, Input, Table } from '@omnysync/ui';
import { ModuleWorkspace, TabDef, fmtWhen } from '../kit/ModuleWorkspace.js';
import { ROLE_OPTIONS, opts } from './shared.js';

const SettingsPanel: React.FC<{ reloadKey: number; notify: (k: any, t: string) => void }> = ({ reloadKey, notify }) => {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<any | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [value, setValue] = useState<any>('');
  const [reason, setReason] = useState('');
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setLoading(true);
    try {
      setRows(await ApiClient.get('/config/settings'));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, [reloadKey]);
  const open = async (r: any) => {
    setEdit(r);
    setSaveErr(null);
    setReason('');
    setValue(r.kind === 'hours' ? r.value : r.kind === 'bool' ? String(r.value) : String(r.value));
    setHistory(await ApiClient.get(`/config/settings/${r.key}/history`).catch(() => []));
  };
  const save = async () => {
    setBusy(true);
    setSaveErr(null);
    try {
      const v = edit.kind === 'int' ? Number(value) : edit.kind === 'bool' ? value === 'true' : value;
      await ApiClient.post(`/config/settings/${edit.key}`, { value: v, version: edit.version, reason: reason || undefined });
      notify('success', `${edit.label} updated`);
      setEdit(null);
      load();
    } catch (e: any) {
      setSaveErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const show = (r: any) => (r.kind === 'hours' ? `${r.value.start}–${r.value.end}, days ${r.value.days.join(',')}` : r.kind === 'bool' ? (r.value ? 'On' : 'Off') : String(r.value));
  return (
    <>
      <Table
        columns={[
          { key: 'group', header: 'Area', render: (r: any) => r.group },
          { key: 'label', header: 'Setting', render: (r: any) => <div><div className="font-semibold">{r.label}</div><div className="text-xs text-[#5E6A7D]">{r.help}</div></div> },
          { key: 'value', header: 'Value', render: (r: any) => <span className="font-mono text-xs">{show(r)}</span> },
          { key: 'v', header: 'Version', render: (r: any) => (r.is_default ? <Badge size="sm">Default</Badge> : `v${r.version}`) },
          { key: 'u', header: 'Changed', render: (r: any) => fmtWhen(r.updated_at) },
        ]}
        data={rows}
        keyExtractor={(r: any) => r.key}
        isLoading={loading}
        error={error}
        onRetry={load}
        onRowClick={open}
        stickyHeader
        caption="Organization settings"
      />
      {edit && (
        <Drawer
          isOpen
          onClose={() => setEdit(null)}
          title={edit.label}
          subtitle={`${edit.key} · version ${edit.version}`}
          size="md"
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button>
              <Button onClick={save} isLoading={busy}>Save new version</Button>
            </div>
          }
        >
          <div className="flex flex-col gap-4">
            {saveErr && <Alert variant="danger" title="Couldn’t save">{saveErr}</Alert>}
            <p className="text-sm text-[#46536B]">{edit.help}</p>
            {edit.kind === 'enum' || edit.kind === 'bool' ? (
              <Combobox label="Value" value={value} onValueChange={(v) => setValue(v || '')} options={edit.kind === 'bool' ? [{ value: 'true', label: 'On' }, { value: 'false', label: 'Off' }] : opts(...edit.options)} />
            ) : edit.kind === 'hours' ? (
              <div className="grid grid-cols-2 gap-3">
                <Input label="Opens" type="time" value={value.start} onChange={(e) => setValue({ ...value, start: e.target.value })} />
                <Input label="Closes" type="time" value={value.end} onChange={(e) => setValue({ ...value, end: e.target.value })} />
                <div className="col-span-2">
                  <Input label="Working days (0=Sun … 6=Sat)" value={value.days.join(',')} onChange={(e) => setValue({ ...value, days: e.target.value.split(',').map((x) => Number(x.trim())).filter((x) => !Number.isNaN(x)) })} />
                </div>
              </div>
            ) : (
              <Input label="Value" value={value} onChange={(e) => setValue(e.target.value)} inputMode={edit.kind === 'text' ? undefined : 'decimal'} />
            )}
            <Input label="Reason for change" value={reason} onChange={(e) => setReason(e.target.value)} hint="Stored in the append-only history." />
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-[#5E6A7D] mb-2">History</div>
              {history.length === 0 ? (
                <p className="text-sm text-[#5E6A7D]">Never changed — using the default.</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {history.map((h) => (
                    <li key={h.id} className="border border-[#D9DFEA] rounded-md p-2">
                      <div className="font-semibold">v{h.version} · {fmtWhen(h.changed_at)} · {h.changed_by_name || '—'}</div>
                      <div className="font-mono text-xs text-[#46536B]">{JSON.stringify(h.old_value)} → {JSON.stringify(h.new_value)}</div>
                      {h.reason && <div className="text-xs text-[#5E6A7D]">{h.reason}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Drawer>
      )}
    </>
  );
};

const tabs: TabDef[] = [
  {
    id: 'users',
    label: 'Users & roles',
    endpoint: '/admin/users',
    noDetailFetch: true,
    statuses: ['ACTIVE', 'SUSPENDED'],
    searchPlaceholder: 'Name or email…',
    columns: [
      { key: 'name', header: 'Name' },
      { key: 'email', header: 'Email' },
      { key: 'roles', header: 'Roles', render: (r) => <div className="flex flex-wrap gap-1">{(r.roles || []).map((x: string) => <Badge key={x} size="sm" variant="brand">{x.replace(/_/g, ' ')}</Badge>)}</div> },
      { key: 'status', header: 'Status', kind: 'status' },
    ],
    createLabel: 'Invite user',
    createFields: [
      { name: 'name', label: 'Full name', type: 'text', required: true },
      { name: 'email', label: 'Email', type: 'text', required: true },
      { name: 'initial_password', label: 'Initial password', type: 'text', required: true, hint: 'At least 12 characters; the user changes it on first sign-in.' },
      { name: 'role1', label: 'Primary role', type: 'select', required: true, options: ROLE_OPTIONS },
      { name: 'role2', label: 'Additional role', type: 'select', options: ROLE_OPTIONS },
    ],
    createTransform: ({ role1, role2, ...rest }) => ({ ...rest, roles: [role1, role2].filter(Boolean) }),
    actions: [
      { id: 'roles', transform: ({ role1, role2, reason }) => ({ roles: [role1, role2].filter(Boolean), reason }), label: 'Change roles', variant: 'primary', fields: [{ name: 'role1', label: 'Primary role', type: 'select', required: true, options: ROLE_OPTIONS }, { name: 'role2', label: 'Additional role', type: 'select', options: ROLE_OPTIONS }, { name: 'reason', label: 'Reason', type: 'text', required: true }], success: 'Roles updated' },
      { id: 'suspend', label: 'Suspend', variant: 'destructive', when: ['ACTIVE'], confirm: 'Suspend this user? They lose access immediately.' },
      { id: 'reactivate', label: 'Reactivate', when: ['SUSPENDED'] },
    ],
  },
  {
    id: 'roles',
    label: 'Role catalogue',
    endpoint: '/admin/roles',
    noDetailFetch: true,
    columns: [
      { key: 'name', header: 'Role' },
      { key: 'permission_count', header: 'Permissions', align: 'right' },
    ],
    detailFields: [
      { key: 'name', header: 'Role' },
      { key: 'permissions', header: 'Granted permissions', render: (r) => <div className="flex flex-wrap gap-1">{r.permissions.map((p: string) => <code key={p} className="text-[11px] bg-[#F1F4F9] px-1.5 py-0.5 rounded">{p}</code>)}</div> },
    ],
  },
  { id: 'settings', label: 'Settings', render: (ctx) => <SettingsPanel {...ctx} /> },
  {
    id: 'modules',
    label: 'Modules',
    endpoint: '/config/modules',
    noDetailFetch: true,
    statuses: ['enabled', 'draining', 'read_only', 'disabled'],
    columns: [
      { key: 'code', header: 'Code' },
      { key: 'name', header: 'Module' },
      { key: 'readiness', header: 'Readiness', kind: 'badge' },
      { key: 'state', header: 'State', render: (r) => <Badge size="sm" variant={r.state === 'enabled' ? 'success' : r.state === 'draining' ? 'warning' : 'neutral'}>{r.state}</Badge> },
      { key: 'depends', header: 'Depends on', render: (r) => (r.depends.length ? r.depends.join(', ') : '—') },
    ],
    actions: [
      {
        id: 'state',
        label: 'Change state',
        variant: 'primary',
        when: (r) => !r.core,
        path: (r) => `/config/modules/${r.code}/state`,
        fields: [
          { name: 'state', label: 'New state', type: 'select', required: true, options: opts('enabled', 'draining', 'read_only', 'disabled'), hint: 'enabled → draining → read_only → disabled. Draining blocks new records but lets open work finish.' },
          { name: 'reason', label: 'Reason', type: 'text', required: true },
        ],
        success: 'Module state changed',
      },
    ],
  },
];

export const AdminConfigView: React.FC = () => (
  <ModuleWorkspace
    id="adm"
    title="Administration & Configuration"
    description="Users and roles (self-lockout and last-admin guards), versioned organization settings with history, and module lifecycle with dependency checks. Every change is audited."
    tabs={tabs}
  />
);
