import React, { useEffect, useMemo, useState } from 'react';
import { ApiClient } from '../api/client.js';
import { Alert, Badge, Button, Card, Combobox, Drawer, Input, Table } from '@omnysync/ui';
import { AlarmClock, CheckCheck, Pause, Play, Plus, RefreshCw, Settings2, Zap } from 'lucide-react';
import { fmtMoney, sumDec, cmpDec } from '../lib/format.js';

type Tab = 'alerts' | 'rules' | 'runs' | 'recurring';

const TZ = 'Asia/Karachi';
export const fmtWhen = (v?: string | null) =>
  v ? `${new Date(v).toLocaleString('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })} PKT` : '—';
const isoDay = (v?: string | null) => (v ? String(v).slice(0, 10) : '—');

const sevVariant = (s: string) => (s === 'CRITICAL' ? 'danger' : s === 'WARNING' ? 'warning' : 'info') as 'danger' | 'warning' | 'info';
const statusVariant = (s?: string | null) =>
  (s === 'SUCCEEDED' || s === 'ACTIVE' ? 'success' : s === 'FAILED' || s === 'PAUSED' ? 'warning' : s === 'DEAD' ? 'danger' : s === 'RUNNING' ? 'info' : 'neutral') as
    | 'success'
    | 'warning'
    | 'danger'
    | 'info'
    | 'neutral';
const tierLabel: Record<string, string> = { A0: 'A0 · alert only', A1: 'A1 · draft', A2: 'A2 · bounded auto', A3: 'A3 · policy posting' };

const scheduleText = (r: any) =>
  r.schedule_kind === 'INTERVAL'
    ? `Every ${r.interval_minutes >= 60 && r.interval_minutes % 60 === 0 ? `${r.interval_minutes / 60} h` : `${r.interval_minutes} min`}`
    : r.schedule_kind === 'DAILY'
      ? `Daily ${String(r.run_at_local).slice(0, 5)}`
      : `Monthly day ${r.day_of_month || 1}, ${String(r.run_at_local).slice(0, 5)}`;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const AutomationView: React.FC = () => {
  const [tab, setTab] = useState<Tab>('alerts');
  const [rules, setRules] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'success' | 'danger' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [alertStatus, setAlertStatus] = useState('ACTIVE');
  const [alertCategory, setAlertCategory] = useState('');
  const [runStatus, setRunStatus] = useState('');

  const [editRule, setEditRule] = useState<any | null>(null);
  const [newTemplate, setNewTemplate] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const qs = new URLSearchParams({ status: alertStatus, ...(alertCategory ? { category: alertCategory } : {}) });
      const [r, a, rn, t] = await Promise.all([
        ApiClient.get('/automation/rules'),
        ApiClient.get(`/automation/alerts?${qs}`),
        ApiClient.get(`/automation/runs?limit=200${runStatus ? `&status=${runStatus}` : ''}`),
        ApiClient.get('/automation/recurring-journals').catch(() => []),
      ]);
      setRules(r);
      setAlerts(a);
      setRuns(rn);
      setTemplates(t);
    } catch (err) {
      setLoadError(errText(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [alertStatus, alertCategory, runStatus]);

  const act = async (key: string, fn: () => Promise<any>, ok: string) => {
    setBusy(key);
    setNotice(null);
    try {
      const res = await fn();
      setNotice({ kind: 'success', text: typeof ok === 'string' ? ok : 'Done' });
      await loadData();
      return res;
    } catch (err) {
      setNotice({ kind: 'danger', text: errText(err) });
    } finally {
      setBusy(null);
    }
  };

  const counts = useMemo(() => {
    const c = { CRITICAL: 0, WARNING: 0, INFO: 0 } as Record<string, number>;
    for (const a of alerts) if (a.status !== 'RESOLVED') c[a.severity] = (c[a.severity] || 0) + 1;
    return c;
  }, [alerts]);
  const categories = useMemo(() => Array.from(new Set(alerts.map((a) => a.category))).sort(), [alerts]);
  const failing = rules.filter((r) => r.last_status === 'FAILED' || r.last_status === 'DEAD').length;

  const alertColumns = [
    { key: 'severity', header: 'Severity', width: '110px', render: (a: any) => <Badge size="sm" variant={sevVariant(a.severity)}>{a.severity}</Badge> },
    {
      key: 'title',
      header: 'Alert',
      render: (a: any) => (
        <div className="min-w-0">
          <div className="font-semibold text-[#182235]">{a.title}</div>
          {a.body && <div className="text-xs text-[#46536B] mt-0.5 max-w-[640px]">{a.body}</div>}
        </div>
      ),
    },
    { key: 'category', header: 'Area', width: '120px', render: (a: any) => <span className="text-xs font-semibold text-[#46536B]">{a.category}</span> },
    { key: 'occurrences', header: 'Seen', align: 'right' as const, width: '70px', render: (a: any) => `${a.occurrences}×` },
    { key: 'last_seen_at', header: 'Last seen', width: '150px', render: (a: any) => <span className="text-xs">{fmtWhen(a.last_seen_at)}</span> },
    { key: 'status', header: 'Status', width: '120px', render: (a: any) => <Badge size="sm" variant={a.status === 'OPEN' ? 'brand' : a.status === 'RESOLVED' ? 'success' : 'neutral'}>{a.status}</Badge> },
    {
      key: 'actions',
      header: 'Actions',
      width: '190px',
      render: (a: any) =>
        a.status === 'RESOLVED' ? (
          <span className="text-xs text-[#5E6A7D]">{a.resolved_at ? `Resolved ${fmtWhen(a.resolved_at)}` : 'Resolved'}</span>
        ) : (
          <div className="flex gap-1.5">
            {a.status === 'OPEN' && (
              <Button size="sm" variant="secondary" isLoading={busy === `ack-${a.id}`} onClick={() => act(`ack-${a.id}`, () => ApiClient.post(`/automation/alerts/${a.id}/acknowledge`, {}), 'Alert acknowledged')}>
                Acknowledge
              </Button>
            )}
            <Button size="sm" variant="quiet" isLoading={busy === `res-${a.id}`} onClick={() => act(`res-${a.id}`, () => ApiClient.post(`/automation/alerts/${a.id}/resolve`, {}), 'Alert resolved')}>
              <CheckCheck size={14} aria-hidden="true" /> Resolve
            </Button>
          </div>
        ),
    },
  ];

  const ruleColumns = [
    {
      key: 'name',
      header: 'Rule',
      className: 'min-w-[300px]',
      render: (r: any) => (
        <div>
          <div className="font-semibold">{r.name}</div>
          <div className="text-xs text-[#5E6A7D] font-mono">{r.code}</div>
          <div className="text-xs text-[#46536B] mt-0.5 max-w-[460px]">{r.description}</div>
        </div>
      ),
    },
    { key: 'tier', header: 'Autonomy', width: '150px', render: (r: any) => <Badge size="sm" variant={r.tier === 'A3' ? 'warning' : r.tier === 'A2' ? 'info' : 'neutral'}>{tierLabel[r.tier] || r.tier}</Badge> },
    { key: 'schedule', header: 'Schedule', width: '160px', render: (r: any) => <span className="text-xs">{scheduleText(r)}</span> },
    {
      key: 'next',
      header: 'Next run',
      width: '150px',
      render: (r: any) => (r.paused ? <Badge size="sm" variant="warning">Paused</Badge> : !r.is_active ? <Badge size="sm">Disabled</Badge> : <span className="text-xs">{fmtWhen(r.next_run_at)}</span>),
    },
    {
      key: 'last',
      header: 'Last run',
      width: '160px',
      render: (r: any) => (r.last_status ? <div className="flex flex-col gap-0.5"><Badge size="sm" variant={statusVariant(r.last_status)}>{r.last_status}</Badge><span className="text-xs text-[#5E6A7D]">{fmtWhen(r.last_run_at)}</span></div> : <span className="text-xs text-[#5E6A7D]">Never</span>),
    },
    { key: 'open_alerts', header: 'Open alerts', align: 'right' as const, width: '100px' },
    {
      key: 'actions',
      header: 'Actions',
      width: '250px',
      render: (r: any) => (
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="secondary" disabled={!r.is_active} isLoading={busy === `run-${r.id}`} onClick={() => act(`run-${r.id}`, () => ApiClient.post(`/automation/rules/${r.id}/run`, {}), `${r.name}: run finished`)}>
            <Zap size={14} aria-hidden="true" /> Run now
          </Button>
          {r.paused ? (
            <Button size="sm" variant="quiet" isLoading={busy === `resume-${r.id}`} onClick={() => act(`resume-${r.id}`, () => ApiClient.post(`/automation/rules/${r.id}/resume`, {}), `${r.name} resumed`)}>
              <Play size={14} aria-hidden="true" /> Resume
            </Button>
          ) : (
            <Button size="sm" variant="quiet" isLoading={busy === `pause-${r.id}`} onClick={() => act(`pause-${r.id}`, () => ApiClient.post(`/automation/rules/${r.id}/pause`, { reason: 'Paused from Automation console' }), `${r.name} paused`)}>
              <Pause size={14} aria-hidden="true" /> Pause
            </Button>
          )}
          <Button size="sm" variant="quiet" aria-label={`Configure ${r.name}`} onClick={() => setEditRule(r)}>
            <Settings2 size={14} aria-hidden="true" /> Configure
          </Button>
        </div>
      ),
    },
  ];

  const runColumns = [
    { key: 'rule', header: 'Rule', render: (r: any) => <div><div className="font-semibold">{r.rule_name}</div><div className="text-xs font-mono text-[#5E6A7D]">{r.occurrence_key}</div></div> },
    { key: 'trigger', header: 'Trigger', width: '100px', render: (r: any) => <Badge size="sm" variant={r.trigger === 'MANUAL' ? 'brand' : 'neutral'}>{r.trigger}</Badge> },
    { key: 'status', header: 'Status', width: '110px', render: (r: any) => <Badge size="sm" variant={statusVariant(r.status)}>{r.status}</Badge> },
    { key: 'attempts', header: 'Attempts', align: 'right' as const, width: '90px' },
    { key: 'started_at', header: 'Started', width: '150px', render: (r: any) => <span className="text-xs">{fmtWhen(r.started_at)}</span> },
    {
      key: 'duration',
      header: 'Took',
      align: 'right' as const,
      width: '80px',
      render: (r: any) => (r.finished_at ? `${Math.max(0, new Date(r.finished_at).getTime() - new Date(r.started_at).getTime())} ms` : '—'),
    },
    {
      key: 'summary',
      header: 'Result',
      render: (r: any) =>
        r.error ? (
          <span className="text-xs text-[#A82430]">{r.error}</span>
        ) : (
          <span className="text-xs text-[#46536B] font-mono break-all">{summarize(r.summary)}</span>
        ),
    },
  ];

  const templateColumns = [
    { key: 'code', header: 'Template', render: (t: any) => <div><div className="font-semibold">{t.name}</div><div className="text-xs font-mono text-[#5E6A7D]">{t.code}</div></div> },
    { key: 'total_amount', header: 'Amount (PKR)', align: 'right' as const, width: '140px', render: (t: any) => fmtMoney(t.total_amount) },
    { key: 'day', header: 'Posts on', width: '110px', render: (t: any) => `Day ${t.day_of_month}` },
    { key: 'next', header: 'Next date', width: '110px', render: (t: any) => (t.status === 'ENDED' ? '—' : isoDay(t.next_run_date)) },
    { key: 'status', header: 'Status', width: '100px', render: (t: any) => <Badge size="sm" variant={statusVariant(t.status)}>{t.status}</Badge> },
    { key: 'maker', header: 'Maker / checker', width: '200px', render: (t: any) => <span className="text-xs">{t.created_by_name || '—'} / {t.approved_by_name || <em className="text-[#7A4700] not-italic font-semibold">awaiting approval</em>}</span> },
    { key: 'posted', header: 'Posted', align: 'right' as const, width: '80px', render: (t: any) => t.occurrences_posted },
    {
      key: 'actions',
      header: 'Actions',
      width: '180px',
      render: (t: any) => (
        <div className="flex gap-1.5">
          {(t.status === 'DRAFT' || t.status === 'PAUSED') && (
            <Button size="sm" variant="secondary" isLoading={busy === `ap-${t.id}`} onClick={() => act(`ap-${t.id}`, () => ApiClient.post(`/automation/recurring-journals/${t.id}/approve`, {}), `${t.code} approved`)}>
              Approve
            </Button>
          )}
          {t.status === 'ACTIVE' && (
            <Button size="sm" variant="quiet" isLoading={busy === `tp-${t.id}`} onClick={() => act(`tp-${t.id}`, () => ApiClient.post(`/automation/recurring-journals/${t.id}/pause`, {}), `${t.code} paused`)}>
              Pause
            </Button>
          )}
          {t.status !== 'ENDED' && (
            <Button size="sm" variant="quiet" isLoading={busy === `te-${t.id}`} onClick={() => act(`te-${t.id}`, () => ApiClient.post(`/automation/recurring-journals/${t.id}/end`, {}), `${t.code} ended`)}>
              End
            </Button>
          )}
        </div>
      ),
    },
  ];

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'alerts', label: 'Alerts inbox', count: alerts.filter((a) => a.status !== 'RESOLVED').length },
    { id: 'rules', label: 'Rules', count: rules.length },
    { id: 'runs', label: 'Run history', count: runs.length },
    { id: 'recurring', label: 'Recurring journals', count: templates.length },
  ];

  const onTabKey = (e: React.KeyboardEvent, idx: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = tabs[(idx + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    setTab(next.id);
    document.getElementById(`auto-tab-${next.id}`)?.focus();
  };

  return (
    <div className="flex flex-col gap-6 text-left">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] leading-9 font-bold text-[#182235]">Automation &amp; Alerts</h1>
          <p className="text-sm text-[#46536B] mt-1 max-w-3xl">
            Deterministic in-house rules (no external services). Each run is keyed per schedule slot so it happens once, retries with backoff, and escalates to the rule owner when it keeps failing.
            Payments and approvals are never automated.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="secondary" size="sm" onClick={loadData} isLoading={loading}>
            <RefreshCw size={14} aria-hidden="true" /> Refresh
          </Button>
          {rules.length === 0 && !loading && !loadError && (
            <Button variant="secondary" size="sm" isLoading={busy === 'install'} onClick={() => act('install', () => ApiClient.post('/automation/rules/install-defaults', {}), 'Default rules installed')}>
              <Plus size={14} aria-hidden="true" /> Install default rules
            </Button>
          )}
          <Button size="sm" isLoading={busy === 'tick'} onClick={() => act('tick', () => ApiClient.post('/automation/tick', {}), 'All due rules have run')}>
            <AlarmClock size={14} aria-hidden="true" /> Run due rules now
          </Button>
        </div>
      </div>

      {loadError && (
        <Alert variant="danger" title="Couldn’t load automation data" action={<Button variant="secondary" size="sm" onClick={loadData}>Try again</Button>}>
          {loadError}
        </Alert>
      )}
      {notice && (
        <Alert variant={notice.kind} title={notice.kind === 'danger' ? 'Action failed' : 'Done'} action={<Button variant="quiet" size="sm" onClick={() => setNotice(null)}>Dismiss</Button>}>
          {notice.text}
        </Alert>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label="Critical alerts" value={counts.CRITICAL} tone={counts.CRITICAL ? 'danger' : 'neutral'} />
        <Kpi label="Warnings" value={counts.WARNING} tone={counts.WARNING ? 'warning' : 'neutral'} />
        <Kpi label="Active rules" value={rules.filter((r) => r.is_active && !r.paused).length} sub={`${rules.filter((r) => r.paused).length} paused`} tone="neutral" />
        <Kpi label="Rules failing" value={failing} tone={failing ? 'danger' : 'success'} sub={failing ? 'See run history' : 'All healthy'} />
      </div>

      <Card>
        <div role="tablist" aria-label="Automation sections" className="flex gap-1 border-b border-[#D9DFEA] mb-4 overflow-x-auto">
          {tabs.map((t, i) => (
            <button
              key={t.id}
              id={`auto-tab-${t.id}`}
              role="tab"
              aria-selected={tab === t.id}
              aria-controls={`auto-panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              onKeyDown={(e) => onTabKey(e, i)}
              onClick={() => setTab(t.id)}
              className={`px-3 h-10 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5B3CC4] rounded-t-md ${
                tab === t.id ? 'border-[#5940B8] text-[#5940B8]' : 'border-transparent text-[#46536B] hover:text-[#182235]'
              }`}
            >
              {t.label}
              {t.count !== undefined && <span className="ml-1.5 text-xs font-medium text-[#5E6A7D]">({t.count})</span>}
            </button>
          ))}
        </div>

        <div role="tabpanel" id={`auto-panel-${tab}`} aria-labelledby={`auto-tab-${tab}`}>
          {tab === 'alerts' && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-3 items-end">
                <Combobox
                  label="Status"
                  className="w-48"
                  value={alertStatus}
                  onValueChange={(v) => setAlertStatus(v || 'ACTIVE')}
                  options={[
                    { value: 'ACTIVE', label: 'Open & acknowledged' },
                    { value: 'OPEN', label: 'Open only' },
                    { value: 'ACKNOWLEDGED', label: 'Acknowledged' },
                    { value: 'RESOLVED', label: 'Resolved' },
                    { value: 'ALL', label: 'All' },
                  ]}
                />
                <Combobox
                  label="Area"
                  className="w-48"
                  clearable
                  placeholder="All areas"
                  value={alertCategory}
                  onValueChange={(v) => setAlertCategory(v || '')}
                  options={Array.from(new Set([...categories, alertCategory].filter(Boolean))).map((c) => ({ value: c, label: c }))}
                />
              </div>
              <Table
                caption="Automation alerts"
                columns={alertColumns}
                data={alerts}
                keyExtractor={(a) => a.id}
                isLoading={loading}
                error={loadError}
                onRetry={loadData}
                emptyTitle="No alerts"
                emptyMessage={alertStatus === 'ACTIVE' ? 'Nothing needs attention right now. Alerts appear here when a rule detects an exception.' : 'No alerts match these filters.'}
              />
            </div>
          )}
          {tab === 'rules' && (
            <Table caption="Automation rules" columns={ruleColumns} data={rules} keyExtractor={(r) => r.id} isLoading={loading} error={loadError} onRetry={loadData} emptyTitle="No rules installed" emptyMessage="Install the default rule catalogue to start monitoring." />
          )}
          {tab === 'runs' && (
            <div className="flex flex-col gap-3">
              <Combobox
                label="Run status"
                className="w-48"
                clearable
                placeholder="All statuses"
                value={runStatus}
                onValueChange={(v) => setRunStatus(v || '')}
                options={['SUCCEEDED', 'FAILED', 'DEAD', 'RUNNING'].map((s) => ({ value: s, label: s }))}
              />
              <Table caption="Automation run history" columns={runColumns} data={runs} keyExtractor={(r) => r.id} isLoading={loading} error={loadError} onRetry={loadData} emptyTitle="No runs yet" emptyMessage="Runs appear after the scheduler ticks or you run a rule manually." />
            </div>
          )}
          {tab === 'recurring' && (
            <div className="flex flex-col gap-3">
              <div className="flex justify-between items-center gap-3">
                <p className="text-[13px] text-[#46536B] max-w-2xl">Maker–checker: the author cannot approve. Approved templates post on their day through the normal posting engine (period locks apply), once per month.</p>
                <Button size="sm" onClick={() => setNewTemplate(true)}>
                  <Plus size={14} aria-hidden="true" /> New template
                </Button>
              </div>
              <Table caption="Recurring journal templates" columns={templateColumns} data={templates} keyExtractor={(t) => t.id} isLoading={loading} error={loadError} onRetry={loadData} emptyTitle="No recurring journals" emptyMessage="Create a template for rent, accruals or other fixed monthly entries." />
            </div>
          )}
        </div>
      </Card>

      {editRule && <RuleDrawer rule={editRule} onClose={() => setEditRule(null)} onSaved={async (msg) => { setEditRule(null); setNotice({ kind: 'success', text: msg }); await loadData(); }} />}
      {newTemplate && <TemplateDrawer onClose={() => setNewTemplate(false)} onSaved={async (msg) => { setNewTemplate(false); setNotice({ kind: 'success', text: msg }); setTab('recurring'); await loadData(); }} />}
    </div>
  );
};

function summarize(s: any): string {
  if (!s) return '—';
  const obj = typeof s === 'string' ? JSON.parse(s) : s;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'alerts' && v && typeof v === 'object') {
      const a = v as any;
      parts.push(`alerts +${a.opened} ↻${a.refreshed} ✓${a.resolved}`);
    } else if (v === null || typeof v !== 'object') parts.push(`${k.replace(/_/g, ' ')}: ${v}`);
    else if (Array.isArray(v)) parts.push(`${k.replace(/_/g, ' ')}: ${v.length}`);
  }
  return parts.join(' · ') || '—';
}

const Kpi: React.FC<{ label: string; value: number; sub?: string; tone: 'danger' | 'warning' | 'success' | 'neutral' }> = ({ label, value, sub, tone }) => (
  <div className="bg-white border border-[#D9DFEA] rounded-[10px] p-4">
    <div className="text-xs font-semibold text-[#46536B]">{label}</div>
    <div className={`text-[28px] leading-9 font-bold tabular-nums ${tone === 'danger' ? 'text-[#A82430]' : tone === 'warning' ? 'text-[#7A4700]' : tone === 'success' ? 'text-[#146341]' : 'text-[#182235]'}`}>{value}</div>
    {sub && <div className="text-xs text-[#5E6A7D]">{sub}</div>}
  </div>
);

const RuleDrawer: React.FC<{ rule: any; onClose: () => void; onSaved: (msg: string) => void }> = ({ rule, onClose, onSaved }) => {
  const [kind, setKind] = useState<string>(rule.schedule_kind);
  const [intervalMins, setIntervalMins] = useState(String(rule.interval_minutes ?? 60));
  const [time, setTime] = useState(String(rule.run_at_local || '06:00').slice(0, 5));
  const [day, setDay] = useState(String(rule.day_of_month ?? 1));
  const [attempts, setAttempts] = useState(String(rule.max_attempts ?? 3));
  const [active, setActive] = useState<boolean>(rule.is_active);
  const [config, setConfig] = useState(JSON.stringify(typeof rule.config === 'string' ? JSON.parse(rule.config) : rule.config || {}, null, 2));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const intervalErr = kind === 'INTERVAL' && !(Number(intervalMins) >= 5 && Number(intervalMins) <= 10080) ? 'Between 5 and 10080 minutes' : '';
  const dayErr = kind === 'MONTHLY' && !(Number(day) >= 1 && Number(day) <= 28) ? 'Day 1–28 (every month has it)' : '';
  const attemptsErr = !(Number(attempts) >= 1 && Number(attempts) <= 10) ? '1 to 10' : '';
  let configErr = '';
  try {
    const c = JSON.parse(config || '{}');
    if (typeof c !== 'object' || Array.isArray(c) || c === null) configErr = 'Must be a JSON object';
  } catch {
    configErr = 'Invalid JSON';
  }
  const invalid = !!(intervalErr || dayErr || attemptsErr || configErr);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid) return;
    setSaving(true);
    setError('');
    try {
      await ApiClient.post(`/automation/rules/${rule.id}`, {
        version: rule.version,
        schedule_kind: kind,
        ...(kind === 'INTERVAL' ? { interval_minutes: Number(intervalMins) } : { run_at_local: time }),
        ...(kind === 'MONTHLY' ? { day_of_month: Number(day) } : {}),
        max_attempts: Number(attempts),
        is_active: active,
        config: JSON.parse(config || '{}'),
      });
      onSaved(`${rule.name} updated`);
    } catch (err) {
      setError(errText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer isOpen onClose={onClose} title={`Configure: ${rule.name}`} subtitle={`${rule.code} · ${tierLabel[rule.tier] || rule.tier} · owner ${rule.owner_role}`} size="md">
      <form onSubmit={save} className="flex flex-col gap-4" noValidate>
        {error && <Alert variant="danger" title="Couldn’t save">{error}</Alert>}
        <Combobox
          label="Schedule"
          value={kind}
          onValueChange={(v) => setKind(v || 'DAILY')}
          options={[
            { value: 'INTERVAL', label: 'Every N minutes' },
            { value: 'DAILY', label: 'Daily at a time' },
            { value: 'MONTHLY', label: 'Monthly on a day' },
          ]}
          hint="Times are in Asia/Karachi (PKT)."
        />
        {kind === 'INTERVAL' ? (
          <Input label="Interval (minutes)" type="number" min={5} max={10080} value={intervalMins} onChange={(e) => setIntervalMins(e.target.value)} error={intervalErr} hint="Minimum 5 minutes." required />
        ) : (
          <Input label="Run at (local time)" type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
        )}
        {kind === 'MONTHLY' && <Input label="Day of month" type="number" min={1} max={28} value={day} onChange={(e) => setDay(e.target.value)} error={dayErr} required />}
        <Input label="Max attempts before escalation" type="number" min={1} max={10} value={attempts} onChange={(e) => setAttempts(e.target.value)} error={attemptsErr} hint="Retries back off 1, 2, 4… minutes; then the run is dead-lettered and the owner is alerted." />
        <label className="flex items-center gap-2 text-sm font-semibold text-[#182235]">
          <input type="checkbox" className="h-4 w-4 accent-[#5940B8]" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Rule enabled
        </label>
        <div className="flex flex-col gap-1">
          <label htmlFor="rule-config" className="text-xs font-semibold text-[#182235]">Parameters (JSON)</label>
          <textarea
            id="rule-config"
            rows={6}
            value={config}
            onChange={(e) => setConfig(e.target.value)}
            aria-invalid={configErr ? true : undefined}
            aria-describedby="rule-config-msg"
            className={`w-full px-3 py-2 font-mono text-xs bg-white border rounded-md focus:outline-none focus:ring-1 focus:ring-[#5B3CC4] ${configErr ? 'border-[#A82430]' : 'border-[#7D8799]'}`}
          />
          <span id="rule-config-msg" className={`text-xs ${configErr ? 'text-[#A82430]' : 'text-[#5E6A7D]'}`}>{configErr || 'Rule-specific thresholds, e.g. {"days_ahead": 7}.'}</span>
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-[#D9DFEA]">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={invalid} isLoading={saving}>Save rule</Button>
        </div>
      </form>
    </Drawer>
  );
};

interface TplLine { account_code: string; side: 'debit' | 'credit'; amount: string; description: string }

const TemplateDrawer: React.FC<{ onClose: () => void; onSaved: (msg: string) => void }> = ({ onClose, onSaved }) => {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [day, setDay] = useState('1');
  const [start, setStart] = useState(new Date().toISOString().slice(0, 10));
  const [end, setEnd] = useState('');
  const [lines, setLines] = useState<TplLine[]>([
    { account_code: '', side: 'debit', amount: '', description: '' },
    { account_code: '', side: 'credit', amount: '', description: '' },
  ]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    ApiClient.get('/coa/accounts').then(setAccounts).catch(() => setAccounts([]));
  }, []);

  const postable = accounts.filter((a) => a.posting_allowed && a.is_active !== false);
  const dr = sumDec(lines.filter((l) => l.side === 'debit').map((l) => l.amount));
  const cr = sumDec(lines.filter((l) => l.side === 'credit').map((l) => l.amount));
  const balanced = cmpDec(dr, cr) === 0 && cmpDec(dr, '0') > 0;
  const lineErr = (l: TplLine) => (!l.account_code ? 'Pick an account' : !(cmpDec(l.amount || '0', '0') > 0) ? 'Amount must be > 0' : '');
  const dayErr = !(Number(day) >= 1 && Number(day) <= 28) ? 'Day 1–28' : '';
  const endErr = end && end < start ? 'End must be on or after start' : '';
  const invalid = !code.trim() || !name.trim() || !!dayErr || !!endErr || !balanced || lines.some((l) => lineErr(l));

  const upd = (i: number, patch: Partial<TplLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (invalid) return;
    setSaving(true);
    setError('');
    try {
      await ApiClient.post('/automation/recurring-journals', {
        code: code.trim(),
        name: name.trim(),
        day_of_month: Number(day),
        start_date: start,
        end_date: end || null,
        lines: lines.map((l) => ({ account_code: l.account_code, [l.side]: l.amount, description: l.description || undefined })),
      });
      onSaved(`Template ${code.toUpperCase()} created; it needs approval by another user before it posts.`);
    } catch (err) {
      setError(errText(err));
    } finally {
      setSaving(false);
    }
  };

  const accountOptions = postable.map((a) => ({ value: a.code, label: `${a.code} · ${a.name}`, group: a.statement_class }));

  return (
    <Drawer isOpen onClose={onClose} title="New recurring journal" subtitle="Posts monthly after maker–checker approval" size="2xl" dirty={!!(code || name || lines.some((l) => l.amount))}>
      <form onSubmit={save} className="flex flex-col gap-4" noValidate>
        {error && <Alert variant="danger" title="Couldn’t create template">{error}</Alert>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="RENT-HQ" required error={touched && !code.trim() ? 'Required' : ''} hint="Unique, e.g. RENT-HQ" />
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Monthly office rent accrual" required error={touched && !name.trim() ? 'Required' : ''} />
          <Input label="Post on day of month" type="number" min={1} max={28} value={day} onChange={(e) => setDay(e.target.value)} error={dayErr} hint="1–28 so every month has the day" />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Start date" type="date" value={start} onChange={(e) => setStart(e.target.value)} required />
            <Input label="End date" type="date" value={end} onChange={(e) => setEnd(e.target.value)} error={endErr} hint="Optional" />
          </div>
        </div>

        <div className="border border-[#D9DFEA] rounded-[10px] overflow-hidden">
          <div className="grid grid-cols-[1fr_120px_140px_1fr_40px] gap-2 px-3 py-2 bg-[#F1F4F9] text-xs font-semibold text-[#46536B]">
            <span>Account</span><span>Side</span><span className="text-right">Amount</span><span>Line memo</span><span className="sr-only">Remove</span>
          </div>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_120px_140px_1fr_40px] gap-2 px-3 py-2 border-t border-[#D9DFEA] items-start">
              <Combobox aria-label={`Line ${i + 1} account`} value={l.account_code} onValueChange={(v) => upd(i, { account_code: v || '' })} options={accountOptions} placeholder="Search account…" error={touched && !l.account_code ? 'Pick an account' : undefined} />
              <Combobox aria-label={`Line ${i + 1} side`} value={l.side} onValueChange={(v) => upd(i, { side: (v as 'debit' | 'credit') || 'debit' })} options={[{ value: 'debit', label: 'Debit' }, { value: 'credit', label: 'Credit' }]} />
              <Input aria-label={`Line ${i + 1} amount`} isMonetary inputMode="decimal" value={l.amount} onChange={(e) => upd(i, { amount: e.target.value.replace(/[^0-9.]/g, '') })} placeholder="0.00" error={touched && lineErr(l) === 'Amount must be > 0' ? '> 0' : ''} />
              <Input aria-label={`Line ${i + 1} memo`} value={l.description} onChange={(e) => upd(i, { description: e.target.value })} placeholder="Optional" />
              <Button type="button" variant="quiet" size="sm" aria-label={`Remove line ${i + 1}`} disabled={lines.length <= 2} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>×</Button>
            </div>
          ))}
          <div className="flex items-center justify-between px-3 py-2 border-t border-[#D9DFEA] bg-[#F7F8FC]">
            <Button type="button" variant="quiet" size="sm" onClick={() => setLines((ls) => [...ls, { account_code: '', side: 'debit', amount: '', description: '' }])}>
              <Plus size={14} aria-hidden="true" /> Add line
            </Button>
            <div className="text-xs font-mono tabular-nums flex gap-4" aria-live="polite">
              <span>Dr {fmtMoney(dr)}</span>
              <span>Cr {fmtMoney(cr)}</span>
              <Badge size="sm" variant={balanced ? 'success' : 'danger'}>{balanced ? 'Balanced' : 'Unbalanced'}</Badge>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-[#D9DFEA]">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving} isLoading={saving}>Create template</Button>
        </div>
      </form>
    </Drawer>
  );
};
