/**
 * Config-driven module workspace (ADR-012). Every new module screen is declared as tabs of
 * resources; this component supplies the shared UX contract: header + primary action, KPI
 * strip, keyboard tabs, search, status filter, sticky table with loading / empty / error
 * states, create + edit drawers (searchable comboboxes for every choice, server field
 * errors mapped onto inputs, unsaved-change guard, optimistic revision on edit) and a
 * record drawer with state-aware commands.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient, ApiRequestError } from '../../api/client.js';
import { Alert, Badge, Button, Card, Combobox, Drawer, Input, Table } from '@omnysync/ui';
import { Plus, RefreshCw } from 'lucide-react';
import { fmtMoney, fmtQty } from '../../lib/format.js';

export type FieldType = 'text' | 'textarea' | 'decimal' | 'int' | 'date' | 'datetime' | 'select' | 'ref' | 'bool' | 'json';
export interface FormField {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  hint?: string;
  options?: { value: string; label: string }[];
  ref?: { endpoint: string; label: (r: any) => string; description?: (r: any) => string; value?: string };
  default?: string;
  placeholder?: string;
  /** Only show when predicate holds for current values. */
  when?: (v: Record<string, string>) => boolean;
}
export interface ColumnDef {
  key: string;
  header: string;
  kind?: 'text' | 'money' | 'qty' | 'date' | 'datetime' | 'status' | 'bool' | 'badge';
  render?: (row: any) => React.ReactNode;
  align?: 'left' | 'right' | 'center';
}
export interface ActionDef {
  id: string;
  label: string;
  when?: string[] | ((row: any) => boolean);
  fields?: FormField[];
  variant?: 'primary' | 'secondary' | 'destructive';
  confirm?: string;
  success?: string;
  transform?: (payload: Record<string, unknown>, row: any) => Record<string, unknown>;
  /** Override target (default `${endpoint}/${id}/${action}`). */
  path?: (row: any) => string;
}
export interface TabDef {
  id: string;
  label: string;
  endpoint?: string;
  columns?: ColumnDef[];
  createLabel?: string;
  createFields?: FormField[];
  createTransform?: (payload: Record<string, unknown>) => Record<string, unknown>;
  createEndpoint?: string;
  editFields?: FormField[];
  statuses?: string[];
  actions?: ActionDef[];
  searchPlaceholder?: string;
  emptyTitle?: string;
  emptyMessage?: string;
  detailFields?: ColumnDef[];
  /** List rows are complete; do not GET `${endpoint}/:id` for the record drawer. */
  noDetailFetch?: boolean;
  /** Extra query string appended to list requests (e.g. fixed filters). */
  query?: string;
  detailExtra?: (row: any, reload: () => void) => React.ReactNode;
  render?: (ctx: { reloadKey: number; notify: (kind: Notice['kind'], text: string) => void }) => React.ReactNode;
}
export interface KpiDef {
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone?: 'danger' | 'warning' | 'success' | 'neutral' | 'brand';
}
interface Notice {
  kind: 'success' | 'danger' | 'info' | 'warning';
  text: string;
}

const TZ = 'Asia/Karachi';
export const fmtWhen = (v?: string | null) =>
  v ? `${new Date(v).toLocaleString('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })} PKT` : '—';
export const statusTone = (s?: string | null): 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand' => {
  const v = String(s || '').toUpperCase();
  if (/^(ACTIVE|APPROVED|COMPLETED|CLOSED_WON|WON|POSTED|PAID|DELIVERED|RESOLVED|CLOSED|QUALIFIED|HIRED|PUBLISHED|FILED|CONVERTED|EFFECTIVE|DONE|PASSED|SETTLED|BILLED|ACCEPTED|IN_SERVICE|AVAILABLE|LOCKED)$/.test(v)) return 'success';
  if (/^(OPEN|NEW|DRAFT|PLANNED|PROSPECT|APPLIED|SCHEDULED|PENDING)$/.test(v)) return 'info';
  if (/^(SUBMITTED|ASSIGNED|IN_PROGRESS|DISPATCHED|IN_TRANSIT|ON_HOLD|SCREENING|INTERVIEW|OFFER|NEGOTIATION|PROPOSAL|UNDER_REVIEW|PAUSED|PICKING|MAINTENANCE|DUE|OVERDUE_SOON|CONTACTED|EN_ROUTE)$/.test(v)) return 'warning';
  if (/^(REJECTED|CANCELLED|LOST|CLOSED_LOST|FAILED|SUSPENDED|BREACHED|OVERDUE|DEFAULTED|EXPIRED|RETIRED|WITHDRAWN|VOID|DISQUALIFIED|HIGH|CRITICAL)$/.test(v)) return 'danger';
  return 'neutral';
};

export function renderCell(c: ColumnDef, row: any): React.ReactNode {
  if (c.render) return c.render(row);
  const v = row?.[c.key];
  if (v === null || v === undefined || v === '') return <span className="text-[#8A94A6]">—</span>;
  switch (c.kind) {
    case 'money':
      return <span className="tabular-nums">{fmtMoney(v)}</span>;
    case 'qty':
      return <span className="tabular-nums">{fmtQty(v)}</span>;
    case 'date':
      return String(v).slice(0, 10);
    case 'datetime':
      return fmtWhen(String(v));
    case 'bool':
      return v ? 'Yes' : 'No';
    case 'status':
    case 'badge':
      return (
        <Badge size="sm" variant={statusTone(String(v))}>
          {String(v).replace(/_/g, ' ')}
        </Badge>
      );
    default:
      return String(v);
  }
}

const refCache = new Map<string, Promise<any[]>>();
function loadRef(endpoint: string): Promise<any[]> {
  if (!refCache.has(endpoint)) {
    const p = ApiClient.get<any[]>(endpoint).catch((e) => {
      refCache.delete(endpoint);
      throw e;
    });
    refCache.set(endpoint, p);
  }
  return refCache.get(endpoint)!;
}
export const invalidateRefs = () => refCache.clear();

const RefCombobox: React.FC<{ field: FormField; value: string; onChange: (v: string) => void; error?: string }> = ({ field, value, onChange, error }) => {
  const [opts, setOpts] = useState<{ value: string; label: string; description?: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState<string | undefined>();
  useEffect(() => {
    let alive = true;
    loadRef(field.ref!.endpoint)
      .then((rows) => {
        if (!alive) return;
        setOpts(rows.map((r) => ({ value: String(r[field.ref!.value || 'id']), label: field.ref!.label(r), description: field.ref!.description?.(r) })));
      })
      .catch((e: ApiRequestError) => alive && setDenied(e.status === 403 ? 'You do not have access to this list' : e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [field.ref!.endpoint]);
  return (
    <Combobox
      label={field.label}
      value={value}
      onValueChange={(v) => onChange(v || '')}
      options={opts}
      loading={loading}
      deniedReason={denied}
      required={field.required}
      clearable={!field.required}
      error={error}
      hint={field.hint}
      placeholder={field.placeholder || `Select ${field.label.toLowerCase()}`}
    />
  );
};

export const FormFields: React.FC<{ fields: FormField[]; values: Record<string, string>; setValue: (k: string, v: string) => void; errors: Record<string, string> }> = ({
  fields,
  values,
  setValue,
  errors,
}) => (
  <>
    {fields
      .filter((f) => !f.when || f.when(values))
      .map((f) => {
        const v = values[f.name] ?? '';
        const err = errors[f.name];
        if (f.type === 'select')
          return (
            <Combobox
              key={f.name}
              label={f.label}
              value={v}
              onValueChange={(x) => setValue(f.name, x || '')}
              options={f.options || []}
              required={f.required}
              clearable={!f.required}
              error={err}
              hint={f.hint}
            />
          );
        if (f.type === 'ref') return <RefCombobox key={f.name} field={f} value={v} onChange={(x) => setValue(f.name, x)} error={err} />;
        if (f.type === 'bool')
          return (
            <label key={f.name} className="flex items-center gap-2 text-sm text-[#182235] min-h-9">
              <input type="checkbox" className="h-4 w-4 accent-[#5940B8]" checked={v === 'true'} onChange={(e) => setValue(f.name, e.target.checked ? 'true' : 'false')} />
              {f.label}
            </label>
          );
        if (f.type === 'textarea' || f.type === 'json')
          return (
            <div key={f.name} className="flex flex-col gap-1">
              <label htmlFor={`f-${f.name}`} className="text-sm font-semibold text-[#182235]">
                {f.label}
                {f.required && <span className="text-[#A82430]"> *</span>}
              </label>
              <textarea
                id={`f-${f.name}`}
                rows={f.type === 'json' ? 6 : 3}
                value={v}
                placeholder={f.placeholder}
                onChange={(e) => setValue(f.name, e.target.value)}
                aria-invalid={!!err}
                className={`w-full rounded-md border px-3 py-2 text-sm ${f.type === 'json' ? 'font-mono text-xs' : ''} focus:outline focus:outline-2 focus:outline-[#5B3CC4] ${err ? 'border-[#C9303E]' : 'border-[#C7D0DE]'}`}
              />
              {err ? <span className="text-xs text-[#A82430]">{err}</span> : f.hint ? <span className="text-xs text-[#5E6A7D]">{f.hint}</span> : null}
            </div>
          );
        return (
          <Input
            key={f.name}
            label={f.label}
            type={f.type === 'date' ? 'date' : f.type === 'datetime' ? 'datetime-local' : f.type === 'int' ? 'number' : 'text'}
            inputMode={f.type === 'decimal' ? 'decimal' : undefined}
            isMonetary={f.type === 'decimal'}
            value={v}
            required={f.required}
            placeholder={f.placeholder}
            onChange={(e) => setValue(f.name, e.target.value)}
            error={err}
            hint={f.hint}
          />
        );
      })}
  </>
);

export function toPayload(fields: FormField[], values: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.when && !f.when(values)) continue;
    const v = values[f.name];
    if (v === undefined || v === '') continue;
    if (f.type === 'bool') out[f.name] = v === 'true';
    else if (f.type === 'int') out[f.name] = Number(v);
    else if (f.type === 'datetime') out[f.name] = new Date(v).toISOString();
    else if (f.type === 'json') {
      try {
        out[f.name] = JSON.parse(v);
      } catch {
        out[f.name] = v; // server rejects with a field error
      }
    } else out[f.name] = v.trim();
  }
  return out;
}

export function clientValidate(fields: FormField[], values: Record<string, string>): Record<string, string> {
  const errs: Record<string, string> = {};
  for (const f of fields) {
    if (f.when && !f.when(values)) continue;
    const v = (values[f.name] ?? '').trim();
    if (f.required && !v && f.type !== 'bool') errs[f.name] = `${f.label} is required`;
    else if (v && f.type === 'decimal' && !/^-?\d+(\.\d+)?$/.test(v)) errs[f.name] = 'Enter an exact number, e.g. 1250.50';
    else if (v && f.type === 'json') {
      try {
        JSON.parse(v);
      } catch {
        errs[f.name] = 'Must be valid JSON';
      }
    }
  }
  return errs;
}

const initialValues = (fields: FormField[], row?: any) =>
  Object.fromEntries(
    fields.map((f) => {
      const raw = row?.[f.name];
      if (raw !== undefined && raw !== null) {
        if (f.type === 'json') return [f.name, typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2)];
        if (f.type === 'date') return [f.name, String(raw).slice(0, 10)];
        if (f.type === 'bool') return [f.name, raw ? 'true' : 'false'];
        return [f.name, String(raw)];
      }
      return [f.name, f.default ?? ''];
    }),
  ) as Record<string, string>;

/** Drawer form used for create / edit / command inputs. */
export const FormDrawer: React.FC<{
  title: string;
  subtitle?: string;
  fields: FormField[];
  row?: any;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}> = ({ title, subtitle, fields, row, submitLabel, onClose, onSubmit }) => {
  const [values, setValues] = useState<Record<string, string>>(() => initialValues(fields, row));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = clientValidate(fields, values);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(toPayload(fields, values));
    } catch (err: any) {
      const field = err?.details?.field;
      if (field && fields.some((f) => f.name === field)) setErrors({ [field]: err.message });
      setError(err?.code === 'STALE_REVISION' ? `${err.message}` : err?.message || 'Request failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer
      isOpen
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      size="md"
      dirty={dirty}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="kit-form" isLoading={busy}>
            {submitLabel}
          </Button>
        </div>
      }
    >
      <form id="kit-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {error && (
          <Alert variant="danger" title="Couldn’t save">
            {error}
          </Alert>
        )}
        <FormFields
          fields={fields}
          values={values}
          errors={errors}
          setValue={(k, v) => {
            setDirty(true);
            setValues((s) => ({ ...s, [k]: v }));
            setErrors((s) => ({ ...s, [k]: '' }));
          }}
        />
      </form>
    </Drawer>
  );
};

const ResourceTab: React.FC<{ tab: TabDef; reloadKey: number; notify: (k: Notice['kind'], t: string) => void; onChanged: () => void; createSignal: number }> = ({
  tab,
  reloadKey,
  notify,
  onChanged,
  createSignal,
}) => {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<any | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [command, setCommand] = useState<{ action: ActionDef; row: any } | null>(null);
  const first = useRef(true);

  const load = useCallback(async () => {
    if (!tab.endpoint) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (status) params.set('status', status);
      if (tab.query) new URLSearchParams(tab.query).forEach((v, k) => params.set(k, v));
      const data = await ApiClient.get<any[]>(`${tab.endpoint}${params.toString() ? `?${params}` : ''}`);
      let list = Array.isArray(data) ? data : [];
      if (tab.noDetailFetch) {
        const needle = q.trim().toLowerCase();
        if (needle) list = list.filter((r) => Object.values(r).some((v) => typeof v === 'string' && v.toLowerCase().includes(needle)));
        if (status) list = list.filter((r) => r.status === status || r.state === status);
      }
      setRows(list);
    } catch (e: any) {
      setError(e?.status === 403 ? 'You do not have permission to view this list.' : e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [tab.endpoint, q, status]);

  useEffect(() => {
    const t = setTimeout(load, first.current ? 0 : 250);
    first.current = false;
    return () => clearTimeout(t);
  }, [load, reloadKey]);
  const seenSignal = useRef(createSignal);
  useEffect(() => {
    if (createSignal !== seenSignal.current) {
      seenSignal.current = createSignal;
      if (tab.createFields) setCreating(true);
    }
  }, [createSignal]);

  const refreshSelected = async (id: string) => {
    if (tab.noDetailFetch) {
      const fresh = await ApiClient.get<any[]>(`${tab.endpoint}${tab.query ? `?${tab.query}` : ''}`).catch(() => rows);
      setSelected((Array.isArray(fresh) ? fresh : rows).find((r: any) => r.id === id) || null);
      return;
    }
    try {
      setSelected(await ApiClient.get(`${tab.endpoint}/${id}`));
    } catch {
      setSelected(null);
    }
  };
  const availableActions = (row: any) =>
    (tab.actions || []).filter((a) => (!a.when ? true : Array.isArray(a.when) ? a.when.includes(row.status) : a.when(row)));

  const runAction = async (action: ActionDef, row: any, payload: Record<string, unknown> = {}) => {
    const path = action.path ? action.path(row) : `${tab.endpoint}/${row.id}/${action.id}`;
    await ApiClient.post(path, action.transform ? action.transform(payload, row) : payload);
    notify('success', action.success || `${action.label}: done`);
    invalidateRefs();
    await load();
    onChanged();
    await refreshSelected(row.id);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3 items-end">
        <div className="w-full sm:w-72">
          <Input label="Search" type="search" placeholder={tab.searchPlaceholder || 'Search…'} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {tab.statuses && (
          <div className="w-full sm:w-56">
            <Combobox
              label="Status"
              value={status}
              clearable
              onValueChange={(v) => setStatus(v || '')}
              placeholder="All statuses"
              options={tab.statuses.map((s) => ({ value: s, label: s.replace(/_/g, ' ') }))}
            />
          </div>
        )}
        <div className="text-xs text-[#5E6A7D] ml-auto pb-2" aria-live="polite">
          {!loading && !error ? `${rows.length} record${rows.length === 1 ? '' : 's'}` : ''}
        </div>
      </div>
      <Table
        columns={(tab.columns || []).map((c) => ({ key: c.key, header: c.header, align: c.align || (c.kind === 'money' || c.kind === 'qty' ? 'right' : 'left'), render: (r: any) => renderCell(c, r) }))}
        data={rows}
        keyExtractor={(r: any) => r.id}
        isLoading={loading}
        error={error}
        onRetry={load}
        stickyHeader
        maxHeightClassName="max-h-[60vh]"
        emptyTitle={q || status ? 'No matching records' : tab.emptyTitle || 'Nothing here yet'}
        emptyMessage={q || status ? 'Try a different search or clear the status filter.' : tab.emptyMessage || 'Create the first record to get started.'}
        emptyAction={
          !q && !status && tab.createFields ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus size={14} aria-hidden="true" /> {tab.createLabel || 'New'}
            </Button>
          ) : undefined
        }
        onRowClick={(r: any) => (tab.noDetailFetch ? setSelected(r) : refreshSelected(r.id))}
        caption={tab.label}
      />

      {creating && tab.createFields && (
        <FormDrawer
          title={tab.createLabel || 'New record'}
          fields={tab.createFields}
          submitLabel="Create"
          onClose={() => setCreating(false)}
          onSubmit={async (payload) => {
            const created = await ApiClient.post(tab.createEndpoint || tab.endpoint!, tab.createTransform ? tab.createTransform(payload) : payload);
            setCreating(false);
            notify('success', `${tab.createLabel?.replace(/^New /, '') || 'Record'} created${created?.number || created?.code ? `: ${created.number || created.code}` : ''}`);
            invalidateRefs();
            await load();
            onChanged();
          }}
        />
      )}
      {editing && tab.editFields && (
        <FormDrawer
          title={`Edit ${tab.label.replace(/s$/, '').toLowerCase()}`}
          subtitle={`Revision ${editing.revision}`}
          fields={tab.editFields}
          row={editing}
          submitLabel="Save changes"
          onClose={() => setEditing(null)}
          onSubmit={async (payload) => {
            await ApiClient.post(`${tab.endpoint}/${editing.id}/update`, { ...payload, revision: editing.revision });
            setEditing(null);
            notify('success', 'Changes saved');
            invalidateRefs();
            await load();
            await refreshSelected(editing.id);
          }}
        />
      )}
      {command && (
        <FormDrawer
          title={command.action.label}
          subtitle={command.action.confirm}
          fields={command.action.fields || []}
          submitLabel={command.action.label}
          onClose={() => setCommand(null)}
          onSubmit={async (payload) => {
            await runAction(command.action, command.row, payload);
            setCommand(null);
          }}
        />
      )}
      {selected && !editing && !command && (
        <RecordDrawer
          tab={tab}
          row={selected}
          actions={availableActions(selected)}
          onClose={() => setSelected(null)}
          onEdit={tab.editFields ? () => setEditing(selected) : undefined}
          onAction={async (a) => {
            if (a.fields?.length) return setCommand({ action: a, row: selected });
            if (a.confirm && !window.confirm(a.confirm)) return;
            try {
              await runAction(a, selected);
            } catch (e: any) {
              notify('danger', e?.message || 'Action failed');
            }
          }}
          reload={() => refreshSelected(selected.id)}
        />
      )}
    </div>
  );
};

const RecordDrawer: React.FC<{ tab: TabDef; row: any; actions: ActionDef[]; onClose: () => void; onEdit?: () => void; onAction: (a: ActionDef) => void; reload: () => void }> = ({
  tab,
  row,
  actions,
  onClose,
  onEdit,
  onAction,
  reload,
}) => {
  const fields = tab.detailFields || tab.columns || [];
  const title = row.number || row.code || row.name || row.title || tab.label;
  return (
    <Drawer
      isOpen
      onClose={onClose}
      title={String(title)}
      subtitle={
        <span className="flex items-center gap-2">
          {row.status && (
            <Badge size="sm" variant={statusTone(row.status)}>
              {String(row.status).replace(/_/g, ' ')}
            </Badge>
          )}
          {row.revision !== undefined && <span className="text-xs text-[#5E6A7D]">Revision {row.revision}</span>}
        </span>
      }
      size="lg"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          {onEdit && (
            <Button variant="secondary" onClick={onEdit}>
              Edit
            </Button>
          )}
          {actions.map((a) => (
            <Button key={a.id} variant={a.variant || 'secondary'} onClick={() => onAction(a)}>
              {a.label}
            </Button>
          ))}
        </div>
      }
    >
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
        {fields.map((c) => (
          <div key={c.key} className="min-w-0">
            <dt className="text-xs font-semibold text-[#5E6A7D]">{c.header}</dt>
            <dd className="text-[#182235] break-words">{renderCell(c, row)}</dd>
          </div>
        ))}
        <div>
          <dt className="text-xs font-semibold text-[#5E6A7D]">Created</dt>
          <dd className="text-[#182235]">{fmtWhen(row.created_at)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-[#5E6A7D]">Last updated</dt>
          <dd className="text-[#182235]">{fmtWhen(row.updated_at)}</dd>
        </div>
      </dl>
      {tab.detailExtra && <div className="mt-6 flex flex-col gap-4">{tab.detailExtra(row, reload)}</div>}
    </Drawer>
  );
};

export const KpiCard: React.FC<KpiDef> = ({ label, value, sub, tone = 'neutral' }) => (
  <div className="bg-white border border-[#D9DFEA] rounded-[10px] p-4 min-w-0">
    <div className="text-xs font-semibold text-[#46536B] truncate">{label}</div>
    <div
      className={`text-2xl leading-8 font-bold tabular-nums truncate ${
        tone === 'danger' ? 'text-[#A82430]' : tone === 'warning' ? 'text-[#7A4700]' : tone === 'success' ? 'text-[#146341]' : tone === 'brand' ? 'text-[#5940B8]' : 'text-[#182235]'
      }`}
    >
      {value}
    </div>
    {sub && <div className="text-xs text-[#5E6A7D] truncate">{sub}</div>}
  </div>
);

export const ModuleWorkspace: React.FC<{
  id: string;
  title: string;
  description: string;
  tabs: TabDef[];
  summaryEndpoint?: string;
  kpis?: (summary: any) => KpiDef[];
  headerExtra?: React.ReactNode;
}> = ({ id, title, description, tabs, summaryEndpoint, kpis, headerExtra }) => {
  const [tab, setTab] = useState(tabs[0].id);
  const [reloadKey, setReloadKey] = useState(0);
  const [summary, setSummary] = useState<any>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [createSignal, setCreateSignal] = useState(0);
  const current = tabs.find((t) => t.id === tab) || tabs[0];

  const loadSummary = useCallback(async () => {
    if (!summaryEndpoint) return;
    try {
      setSummary(await ApiClient.get(summaryEndpoint));
      setSummaryError(null);
    } catch (e: any) {
      setSummaryError(e?.message || 'Failed to load summary');
    }
  }, [summaryEndpoint]);
  useEffect(() => {
    loadSummary();
  }, [loadSummary, reloadKey]);
  const notify = useCallback((kind: Notice['kind'], text: string) => setNotice({ kind, text }), []);
  const kpiList = useMemo(() => (summary && kpis ? kpis(summary) : []), [summary, kpis]);

  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    setTab(tabs[n].id);
    document.getElementById(`${id}-tab-${tabs[n].id}`)?.focus();
  };

  return (
    <div className="flex flex-col gap-6 text-left">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] leading-9 font-bold text-[#182235]">{title}</h1>
          <p className="text-sm text-[#46536B] mt-1 max-w-3xl">{description}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          {headerExtra}
          <Button variant="secondary" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
            <RefreshCw size={14} aria-hidden="true" /> Refresh
          </Button>
          {current.createFields && (
            <Button size="sm" onClick={() => setCreateSignal((n) => n + 1)}>
              <Plus size={14} aria-hidden="true" /> {current.createLabel || 'New'}
            </Button>
          )}
        </div>
      </div>
      {notice && (
        <Alert
          variant={notice.kind}
          title={notice.kind === 'danger' ? 'Action failed' : notice.kind === 'success' ? 'Done' : 'Note'}
          action={
            <Button variant="quiet" size="sm" onClick={() => setNotice(null)}>
              Dismiss
            </Button>
          }
        >
          {notice.text}
        </Alert>
      )}
      {summaryError && <Alert variant="warning" title="Summary unavailable">{summaryError}</Alert>}
      {kpiList.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {kpiList.map((k) => (
            <KpiCard key={k.label} {...k} />
          ))}
        </div>
      )}
      <Card>
        <div role="tablist" aria-label={`${title} sections`} className="flex gap-1 border-b border-[#D9DFEA] mb-4 overflow-x-auto">
          {tabs.map((t, i) => (
            <button
              key={t.id}
              id={`${id}-tab-${t.id}`}
              role="tab"
              type="button"
              aria-selected={tab === t.id}
              aria-controls={`${id}-panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              onKeyDown={(e) => onTabKey(e, i)}
              onClick={() => setTab(t.id)}
              className={`px-3 h-10 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5B3CC4] rounded-t-md ${
                tab === t.id ? 'border-[#5940B8] text-[#5940B8]' : 'border-transparent text-[#46536B] hover:text-[#182235]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`${id}-panel-${current.id}`} aria-labelledby={`${id}-tab-${current.id}`}>
          {current.render ? (
            current.render({ reloadKey, notify })
          ) : (
            <ResourceTab
              key={current.id}
              tab={current}
              reloadKey={reloadKey}
              notify={notify}
              createSignal={createSignal}
              onChanged={() => {
                loadSummary();
              }}
            />
          )}
        </div>
      </Card>
    </div>
  );
};
