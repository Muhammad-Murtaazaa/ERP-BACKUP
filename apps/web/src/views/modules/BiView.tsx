import React, { useEffect, useState } from 'react';
import { ApiClient } from '../../api/client.js';
import { Alert, Button, Card, Input, Table } from '@omnysync/ui';
import { ModuleWorkspace, TabDef } from '../kit/ModuleWorkspace.js';
import { fmtMoney } from '../../lib/format.js';
import { today } from './shared.js';

const PALETTE = ['#5940B8', '#2F9E5B', '#E0A100', '#E5484D', '#1F7AE0', '#8E4EC6', '#12A594'];
const short = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : n.toFixed(n % 1 ? 1 : 0));

/** Dependency-free SVG bar / line chart with axis, gridlines and accessible labels. */
export const Chart: React.FC<{ kind: 'BAR' | 'LINE'; rows: any[]; x: string; y: string; title: string }> = ({ kind, rows, x, y, title }) => {
  const W = 520;
  const H = 220;
  const P = { l: 48, r: 12, t: 12, b: 42 };
  const vals = rows.map((r) => Number(r[y]) || 0);
  const max = Math.max(0, ...vals);
  const min = Math.min(0, ...vals);
  const span = max - min || 1;
  const iw = W - P.l - P.r;
  const ih = H - P.t - P.b;
  const yPos = (v: number) => P.t + ih - ((v - min) / span) * ih;
  const step = iw / Math.max(1, rows.length);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => min + f * span);
  if (!rows.length) return <p className="text-sm text-[#46536B] py-8 text-center">No data in this window.</p>;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`${title}: ${rows.map((r) => `${r[x]} ${r[y]}`).join(', ')}`}>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={P.l} x2={W - P.r} y1={yPos(t)} y2={yPos(t)} stroke="#EEF0F5" />
          <text x={P.l - 6} y={yPos(t) + 3} textAnchor="end" fontSize="10" fill="#46536B">{short(t)}</text>
        </g>
      ))}
      <line x1={P.l} x2={W - P.r} y1={yPos(0)} y2={yPos(0)} stroke="#C9CFDB" />
      {kind === 'BAR' &&
        rows.map((r, i) => {
          const v = Number(r[y]) || 0;
          const bw = Math.min(48, step * 0.62);
          return (
            <g key={i}>
              <rect x={P.l + i * step + (step - bw) / 2} y={Math.min(yPos(v), yPos(0))} width={bw} height={Math.max(1, Math.abs(yPos(v) - yPos(0)))} rx={3} fill={PALETTE[0]}>
                <title>{`${r[x]}: ${r[y]}`}</title>
              </rect>
            </g>
          );
        })}
      {kind === 'LINE' && (
        <>
          <polyline fill="none" stroke={PALETTE[0]} strokeWidth={2.5} points={rows.map((r, i) => `${P.l + i * step + step / 2},${yPos(Number(r[y]) || 0)}`).join(' ')} />
          {rows.map((r, i) => (
            <circle key={i} cx={P.l + i * step + step / 2} cy={yPos(Number(r[y]) || 0)} r={3.5} fill="#fff" stroke={PALETTE[0]} strokeWidth={2}>
              <title>{`${r[x]}: ${r[y]}`}</title>
            </circle>
          ))}
        </>
      )}
      {rows.map((r, i) => (
        <text key={i} x={P.l + i * step + step / 2} y={H - P.b + 14} textAnchor="middle" fontSize="10" fill="#46536B">
          {String(r[x]).length > 12 ? `${String(r[x]).slice(0, 11)}…` : String(r[x])}
        </text>
      ))}
    </svg>
  );
};

const Widget: React.FC<{ w: any }> = ({ w }) => {
  const x = w.dimension;
  const y = w.measure;
  const isMoney = /revenue|amount|outstanding|value|weighted/.test(y);
  return (
    <Card className="p-4 flex flex-col gap-2 min-h-60">
      <div className="text-sm font-semibold text-[#161B26]">{w.title}</div>
      {w.forbidden ? (
        <div className="flex-1 flex items-center justify-center text-center text-sm text-[#46536B] bg-[#F7F8FB] rounded-md p-4">You don’t have access to this dataset. Ask an admin for the matching module permission.</div>
      ) : w.error ? (
        <Alert variant="warning" title="Widget unavailable">{w.error}</Alert>
      ) : w.chart === 'TABLE' ? (
        <Table columns={[{ key: x, header: x }, ...(w.measures || [y]).map((m: string) => ({ key: m, header: m.replace(/_/g, ' '), align: 'right' as const, render: (r: any) => (/revenue|amount|outstanding|value|weighted/.test(m) ? fmtMoney(r[m]) : r[m]) }))]} data={w.rows} keyExtractor={(r: any) => String(r[x])} />
      ) : w.chart === 'KPI' ? (
        <div className="text-3xl font-semibold">{isMoney ? fmtMoney(w.rows.reduce((a: number, r: any) => a + Number(r[y] || 0), 0)) : w.rows.reduce((a: number, r: any) => a + Number(r[y] || 0), 0)}</div>
      ) : (
        <Chart kind={w.chart} rows={w.rows} x={x} y={y} title={w.title} />
      )}
    </Card>
  );
};

const Dashboards: React.FC<{ reloadKey: number }> = ({ reloadKey }) => {
  const [list, setList] = useState<any[]>([]);
  const [sel, setSel] = useState<string>('');
  const [from, setFrom] = useState(`${today().slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today());
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    ApiClient.get('/bi/dashboards?status=ACTIVE').then((r: any) => {
      setList(r);
      if (!sel && r[0]) setSel(r[0].id);
    });
  }, [reloadKey]);
  useEffect(() => {
    if (!sel) return;
    setErr(null);
    ApiClient.get(`/bi/dashboards/${sel}/render?from=${from}&to=${to}`).then(setData).catch((e) => setErr(e.message));
  }, [sel, from, to, reloadKey]);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Dashboard</span>
          <select className="h-9 rounded-md border border-[#C9CFDB] px-2 bg-white" value={sel} onChange={(e) => setSel(e.target.value)}>
            {list.map((d) => (
              <option key={d.id} value={d.id}>{d.name}{d.visibility === 'PRIVATE' ? ' (private)' : ''}</option>
            ))}
          </select>
        </label>
        <div className="w-40"><Input label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="w-40"><Input label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </div>
      {err && <Alert variant="danger" title="Couldn’t render">{err}</Alert>}
      {data && (
        <>
          {data.description && <p className="text-sm text-[#46536B]">{data.description}</p>}
          <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">{data.widgets.map((w: any, i: number) => <Widget key={i} w={w} />)}</div>
        </>
      )}
    </div>
  );
};

const Explorer: React.FC = () => {
  const [sets, setSets] = useState<any[]>([]);
  const [code, setCode] = useState('');
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    ApiClient.get('/bi/datasets').then((r: any) => {
      setSets(r);
      const first = r.find((d: any) => d.readable);
      if (first) setCode(first.code);
    });
  }, []);
  const run = async () => {
    try {
      setErr(null);
      setRes(await ApiClient.get(`/bi/datasets/${code}/query`));
    } catch (e: any) {
      setErr(e.message);
      setRes(null);
    }
  };
  useEffect(() => {
    if (code) run();
  }, [code]);
  const d = sets.find((s) => s.code === code);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
      <Card className="p-3 flex flex-col gap-1">
        <div className="text-xs font-semibold text-[#46536B] mb-1">Governed datasets</div>
        {sets.map((s) => (
          <button key={s.code} disabled={!s.readable} onClick={() => setCode(s.code)} className={`text-left rounded-md px-2 py-1.5 text-sm ${s.code === code ? 'bg-[#EFEBFB] text-[#3E2A8C] font-medium' : 'hover:bg-[#F7F8FB]'} ${!s.readable ? 'opacity-50 cursor-not-allowed' : ''}`} title={s.readable ? s.description : 'No access'}>
            {s.name}
          </button>
        ))}
      </Card>
      <Card className="p-4 flex flex-col gap-3">
        {d && <div><div className="font-semibold">{d.name}</div><div className="text-xs text-[#46536B]">{d.description}</div></div>}
        {err && <Alert variant="danger" title="Query refused">{err}</Alert>}
        {res && <Chart kind={res.dimension === 'month' ? 'LINE' : 'BAR'} rows={res.rows} x={res.dimension} y={res.measures[0]} title={d?.name || ''} />}
        {res && <Table columns={[{ key: res.dimension, header: res.dimension }, ...res.measures.map((m: string) => ({ key: m, header: m.replace(/_/g, ' '), align: 'right' as const }))]} data={res.rows} keyExtractor={(r: any) => String(r[res.dimension])} />}
        <div><Button variant="secondary" onClick={run}>Refresh</Button></div>
      </Card>
    </div>
  );
};

const tabs: TabDef[] = [
  { id: 'dashboards', label: 'Dashboards', render: ({ reloadKey }) => <Dashboards reloadKey={reloadKey} /> },
  { id: 'explore', label: 'Dataset explorer', render: () => <Explorer /> },
  {
    id: 'manage',
    label: 'Manage dashboards',
    endpoint: '/bi/dashboards',
    statuses: ['ACTIVE', 'ARCHIVED'],
    columns: [
      { key: 'code', header: 'Code' },
      { key: 'name', header: 'Name' },
      { key: 'visibility', header: 'Visibility', kind: 'badge' },
      { key: 'widget_count', header: 'Widgets', align: 'right' },
      { key: 'owner_name', header: 'Owner' },
      { key: 'status', header: 'Status', kind: 'status' },
    ],
    createLabel: 'New dashboard',
    createFields: [
      { name: 'code', label: 'Code', type: 'text', required: true, placeholder: 'FIN-WEEKLY' },
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'visibility', label: 'Visibility', type: 'select', options: [{ value: 'PRIVATE', label: 'Private (only me)' }, { value: 'SHARED', label: 'Shared (organisation)' }], default: 'PRIVATE' },
      { name: 'widgets', label: 'Widgets (JSON)', type: 'json', required: true, default: '[{"dataset":"revenue_by_month","chart":"LINE"},{"dataset":"ar_aging","chart":"BAR"}]', hint: 'Datasets: see Dataset explorer. Charts: BAR, LINE, TABLE, KPI. Validated server-side.' },
    ],
    editFields: [
      { name: 'name', label: 'Name', type: 'text' },
      { name: 'visibility', label: 'Visibility', type: 'select', options: [{ value: 'PRIVATE', label: 'Private' }, { value: 'SHARED', label: 'Shared' }] },
      { name: 'widgets', label: 'Widgets (JSON)', type: 'json' },
    ],
    actions: [{ id: 'archive', label: 'Archive', variant: 'destructive', when: ['ACTIVE'] }, { id: 'restore', label: 'Restore', when: ['ARCHIVED'] }],
  },
];

export const BiView: React.FC = () => (
  <ModuleWorkspace
    id="bi"
    title="Business Intelligence"
    description="Governed dashboards over a curated, permission-scoped dataset catalogue — the same numbers as the ledger and operational modules, with no ad-hoc SQL and no data leakage through shared boards."
    tabs={tabs}
  />
);
