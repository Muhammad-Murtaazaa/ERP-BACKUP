import React, { useEffect, useState, useRef } from 'react';
import { ApiClient } from '../../api/client.js';
import { Alert, Badge, Button, Combobox, Drawer, Input, Table } from '@omnysync/ui';
import { ModuleWorkspace, TabDef, fmtWhen } from '../kit/ModuleWorkspace.js';
import { ROLE_OPTIONS, opts } from './shared.js';
import { Upload, Image as ImageIcon, Sparkles, Check, RefreshCw, Palette, Building2 } from 'lucide-react';

const BrandingPanel: React.FC<{ notify: (k: any, t: string) => void }> = ({ notify }) => {
  const [companyName, setCompanyName] = useState('OMNYSYNC ERP');
  const [legalEntityName, setLegalEntityName] = useState('Omnysync Pakistan Pvt Ltd');
  const [tagline, setTagline] = useState('Modular Enterprise Platform');
  const [logoUrl, setLogoUrl] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#5940B8');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await ApiClient.get('/config/branding');
      if (data) {
        setCompanyName(data.company_name || 'OMNYSYNC ERP');
        setLegalEntityName(data.legal_entity_name || 'Omnysync Pakistan Pvt Ltd');
        setTagline(data.tagline || 'Modular Enterprise Platform');
        setLogoUrl(data.logo_url || '');
        setPrimaryColor(data.primary_color || '#5940B8');
      }
    } catch (e: any) {
      console.error('Failed to load branding:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Please select a valid image file (PNG, JPG, SVG, etc.)');
      return;
    }

    // Convert file to Base64 Data URL for persistent storage in settings
    const reader = new FileReader();
    reader.onload = (uploadEvent) => {
      const result = uploadEvent.target?.result as string;
      setLogoUrl(result);
    };
    reader.readAsDataURL(file);
  };

  const saveBranding = async () => {
    setSaving(true);
    setSaveErr(null);
    try {
      await ApiClient.post('/config/branding', {
        company_name: companyName,
        legal_entity_name: legalEntityName,
        tagline: tagline,
        logo_url: logoUrl,
        primary_color: primaryColor,
      });

      notify('success', 'Branding & logo updated successfully!');
      
      // Dispatch event to dynamically update the layout and sidebar immediately
      window.dispatchEvent(new CustomEvent('omnysync:branding-updated', {
        detail: {
          company_name: companyName,
          legal_entity_name: legalEntityName,
          tagline: tagline,
          logo_url: logoUrl,
          primary_color: primaryColor,
        },
      }));
    } catch (e: any) {
      setSaveErr(e.message || 'Failed to save branding');
    } finally {
      setSaving(false);
    }
  };

  const applyPreset = (preset: { name: string; legal: string; tag: string; color: string; logo?: string }) => {
    setCompanyName(preset.name);
    setLegalEntityName(preset.legal);
    setTagline(preset.tag);
    setPrimaryColor(preset.color);
    if (preset.logo !== undefined) {
      setLogoUrl(preset.logo);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      {saveErr && <Alert variant="danger" title="Save Error">{saveErr}</Alert>}

      {/* Quick Demo Presets */}
      <div className="bg-white border border-[#D9DFEA] rounded-xl p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-3 text-sm font-bold text-[#182235]">
          <Sparkles size={16} className="text-[#5940B8]" />
          <span>Quick Demo Presets (One-Click Setup)</span>
        </div>
        <p className="text-xs text-[#5E6A7D] mb-4">
          Click any preset to instantly rebrand the ERP interface for your demonstration or client presentation:
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          <button
            type="button"
            onClick={() => applyPreset({
              name: 'WORKMAN SERVICES',
              legal: 'Workman Engineering & Field Services LLC',
              tag: 'Industrial MEP & Maintenance',
              color: '#0284C7',
            })}
            className="p-3 border border-[#D9DFEA] rounded-lg text-left hover:border-[#0284C7] hover:bg-sky-50 transition-colors"
          >
            <div className="text-xs font-bold text-[#0284C7]">Workman Services</div>
            <div className="text-[11px] text-[#5E6A7D] truncate">Field MEP & Engineering</div>
          </button>
          <button
            type="button"
            onClick={() => applyPreset({
              name: 'OMNYSYNC MART',
              legal: 'Omnysync Retail Enterprises Ltd',
              tag: 'Supermarket & FMCG Point of Sale',
              color: '#16A34A',
            })}
            className="p-3 border border-[#D9DFEA] rounded-lg text-left hover:border-[#16A34A] hover:bg-emerald-50 transition-colors"
          >
            <div className="text-xs font-bold text-[#16A34A]">Omnysync Mart</div>
            <div className="text-[11px] text-[#5E6A7D] truncate">Retail & POS Hypermarket</div>
          </button>
          <button
            type="button"
            onClick={() => applyPreset({
              name: 'APEX GLOBAL TRADING',
              legal: 'Apex Industrial Supply Co Pvt Ltd',
              tag: 'Wholesale & B2B Distribution',
              color: '#EA580C',
            })}
            className="p-3 border border-[#D9DFEA] rounded-lg text-left hover:border-[#EA580C] hover:bg-orange-50 transition-colors"
          >
            <div className="text-xs font-bold text-[#EA580C]">Apex Industrial</div>
            <div className="text-[11px] text-[#5E6A7D] truncate">B2B Trade & Distribution</div>
          </button>
          <button
            type="button"
            onClick={() => applyPreset({
              name: 'OMNYSYNC ERP',
              legal: 'Omnysync Pakistan Pvt Ltd',
              tag: 'Modular Enterprise Platform',
              color: '#5940B8',
            })}
            className="p-3 border border-[#D9DFEA] rounded-lg text-left hover:border-[#5940B8] hover:bg-purple-50 transition-colors"
          >
            <div className="text-xs font-bold text-[#5940B8]">Omnysync Core</div>
            <div className="text-[11px] text-[#5E6A7D] truncate">Standard Enterprise Theme</div>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Form Inputs */}
        <div className="lg:col-span-2 space-y-5 bg-white border border-[#D9DFEA] rounded-xl p-6 shadow-sm">
          <h2 className="text-base font-bold text-[#182235] border-b border-[#D9DFEA] pb-3">Branding & Identity</h2>

          {/* Logo Upload Section */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-[#182235]">Company Logo (PNG / JPG / SVG)</label>
            <div className="flex items-center gap-4">
              <div
                className="h-16 w-16 rounded-lg border-2 border-dashed border-[#D9DFEA] bg-[#F7F8FC] flex items-center justify-center overflow-hidden shrink-0"
                style={{ borderColor: primaryColor }}
              >
                {logoUrl ? (
                  <img src={logoUrl} alt="Company Logo" className="h-full w-full object-contain p-1" />
                ) : (
                  <ImageIcon size={24} className="text-[#5E6A7D]" />
                )}
              </div>
              <div className="space-y-2 flex-1">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  className="hidden"
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload size={14} className="mr-1.5" /> Upload PNG Logo
                  </Button>
                  {logoUrl && (
                    <Button
                      type="button"
                      variant="quiet"
                      size="sm"
                      onClick={() => setLogoUrl('')}
                    >
                      Remove Logo
                    </Button>
                  )}
                </div>
                <p className="text-[11px] text-[#5E6A7D]">
                  Recommended: Transparent PNG or SVG with aspect ratio 1:1 or 4:1. Max size 2 MB.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-4 pt-2">
            <Input
              label="Company / Platform Display Name"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="e.g. WORKMAN SERVICES"
              hint="Shown in the sidebar header and top app bar."
              required
            />

            <Input
              label="Tagline / Brand Subtitle"
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="e.g. Industrial MEP & Facility Operations"
              hint="Appears underneath the company name in the navigation header."
            />

            <Input
              label="Legal Entity Name"
              value={legalEntityName}
              onChange={(e) => setLegalEntityName(e.target.value)}
              placeholder="e.g. Workman Engineering Pvt Ltd"
              hint="Printed on invoices, reports, purchase orders, and financial statements."
              required
            />

            <div>
              <label className="block text-xs font-semibold text-[#182235] mb-2 flex items-center gap-1.5">
                <Palette size={14} /> Primary Brand Theme Color
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="h-9 w-12 cursor-pointer rounded border border-[#D9DFEA] p-0.5 bg-white"
                />
                <Input
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  placeholder="#5940B8"
                  className="w-32 font-mono text-xs"
                />
                <div className="flex gap-1.5">
                  {['#5940B8', '#0284C7', '#16A34A', '#EA580C', '#E11D48', '#0F172A'].map((col) => (
                    <button
                      key={col}
                      type="button"
                      onClick={() => setPrimaryColor(col)}
                      className="w-7 h-7 rounded-md border border-black/10 transition-transform hover:scale-110"
                      style={{ backgroundColor: col }}
                      title={col}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-[#D9DFEA] flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={load}
              disabled={loading || saving}
            >
              <RefreshCw size={14} className="mr-1.5" /> Reset
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={saveBranding}
              isLoading={saving}
            >
              <Check size={14} className="mr-1.5" /> Apply & Save Branding
            </Button>
          </div>
        </div>

        {/* Right Col: Live Preview */}
        <div className="space-y-4">
          <div className="bg-white border border-[#D9DFEA] rounded-xl p-5 shadow-sm">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#5E6A7D] mb-4">Live Interface Preview</h3>

            {/* Sidebar Header Preview */}
            <div className="text-xs font-semibold text-[#5E6A7D] mb-1.5">1. Sidebar Brand Header</div>
            <div className="bg-[#182235] text-white p-3.5 rounded-lg flex items-center gap-3 mb-4 shadow-sm">
              {logoUrl ? (
                <img src={logoUrl} alt="Logo" className="h-8 w-8 object-contain shrink-0 rounded bg-white/10 p-0.5" />
              ) : (
                <div
                  className="h-8 w-8 rounded-md flex items-center justify-center text-white font-bold text-base shrink-0"
                  style={{ backgroundColor: primaryColor }}
                >
                  {companyName ? companyName.charAt(0) : 'Ω'}
                </div>
              )}
              <div className="min-w-0">
                <div className="font-bold text-sm tracking-tight truncate">{companyName || 'OMNYSYNC ERP'}</div>
                <div className="text-[10px] uppercase font-semibold tracking-wider opacity-90 truncate" style={{ color: primaryColor === '#5940B8' ? '#A78BFA' : '#93C5FD' }}>
                  {tagline || 'Modular Platform'}
                </div>
              </div>
            </div>

            {/* Entity Switcher Preview */}
            <div className="text-xs font-semibold text-[#5E6A7D] mb-1.5">2. Scope & Entity Card</div>
            <div className="p-3 bg-[#F1F4F9] rounded-[10px] border border-[#D9DFEA] mb-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#182235]">
                <Building2 size={14} style={{ color: primaryColor }} />
                <span className="truncate">{legalEntityName || 'Omnysync Pakistan Pvt'}</span>
              </div>
              <div className="text-[11px] text-[#5E6A7D] mt-1 flex items-center justify-between">
                <span>Operational HQ</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold text-white" style={{ backgroundColor: primaryColor }}>
                  Active Scope
                </span>
              </div>
            </div>

            {/* Top Bar Preview */}
            <div className="text-xs font-semibold text-[#5E6A7D] mb-1.5">3. Top Application Bar</div>
            <div className="bg-white border border-[#D9DFEA] p-3 rounded-lg flex items-center justify-between text-xs">
              <div className="truncate">
                <span className="font-semibold text-[#5E6A7D]">Scope: </span>
                <span className="font-bold text-[#182235]">{companyName} &gt; {legalEntityName}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

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
  { id: 'branding', label: 'Branding & Demo Setup', render: (ctx) => <BrandingPanel notify={ctx.notify} /> },
  {
    id: 'modules',
    label: 'Modules & Lifecycle',
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
  { id: 'settings', label: 'Organization Settings', render: (ctx) => <SettingsPanel {...ctx} /> },
  {
    id: 'users',
    label: 'Users & Roles',
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
    label: 'Role Catalogue',
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
];

export const AdminConfigView: React.FC = () => (
  <ModuleWorkspace
    id="adm"
    title="Administration & Branding"
    description="Customize brand name, logo PNG, theme colors, modules lifecycle, versioned organization settings, and users/roles."
    tabs={tabs}
  />
);
