import React from 'react';
import { Badge } from '@omnysync/ui';
import { ModuleWorkspace, TabDef } from '../kit/ModuleWorkspace.js';
import { ApiClient } from '../../api/client.js';
import { fmtQty } from '../../lib/format.js';
import { itemRef, opts, warehouseRef } from './shared.js';

const binRef = (name: string, label: string) => ({ name, label, type: 'ref' as const, required: true, ref: { endpoint: '/wms/bins', label: (r: any) => `${r.warehouse_code} / ${r.bin_code}`, description: (r: any) => `${r.bin_type} · ${fmtQty(r.total_qty)} units` } });

const PickLines: React.FC<{ row: any; reload: () => void }> = ({ row, reload }) => {
  const [err, setErr] = React.useState<string | null>(null);
  const confirm = async (l: any) => {
    const remaining = String(Number(l.qty_requested) - Number(l.qty_picked));
    try {
      setErr(null);
      await ApiClient.post(`/wms/pick-lists/${row.id}/lines/${l.id}/confirm`, { quantity: remaining });
      reload();
    } catch (e: any) {
      setErr(e.message);
    }
  };
  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-wider text-[#5E6A7D] mb-2">Pick lines</div>
      {err && <div role="alert" className="text-sm text-[#A82430] mb-2">{err}</div>}
      <ul className="flex flex-col gap-2">
        {(row.lines || []).map((l: any) => (
          <li key={l.id} className="flex items-center justify-between gap-3 border border-[#D9DFEA] rounded-md p-3">
            <div>
              <div className="font-semibold text-sm">{l.item_code} · {l.item_name}</div>
              <div className="text-xs text-[#5E6A7D]">{l.bin_code ? `Bin ${l.bin_code}` : <Badge size="sm" variant="danger">Shortage — no bin stock</Badge>} · picked {fmtQty(l.qty_picked)} / {fmtQty(l.qty_requested)}</div>
            </div>
            {row.status === 'PICKING' && l.bin_id && Number(l.qty_picked) < Number(l.qty_requested) && (
              <button type="button" onClick={() => confirm(l)} className="min-h-9 px-3 rounded-md bg-[#5940B8] text-white text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5B3CC4]">Confirm pick</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};

const tabs: TabDef[] = [
  {
    id: 'picks',
    label: 'Pick lists',
    endpoint: '/wms/pick-lists',
    statuses: ['OPEN', 'PICKING', 'PICKED', 'CANCELLED'],
    columns: [
      { key: 'number', header: 'Pick list' },
      { key: 'order_number', header: 'Sales order' },
      { key: 'warehouse_code', header: 'Warehouse' },
      { key: 'line_count', header: 'Lines', align: 'right' },
      { key: 'shortage', header: 'Shortage', render: (r) => (r.shortage ? <Badge size="sm" variant="danger">Short</Badge> : <Badge size="sm" variant="success">Full</Badge>) },
      { key: 'status', header: 'Status', kind: 'status' },
    ],
    createLabel: 'Generate pick list',
    createEndpoint: '/wms/pick-lists/generate',
    createFields: [
      { name: 'sales_order_id', label: 'Confirmed sales order', type: 'ref', required: true, ref: { endpoint: '/sales/orders', label: (r) => `${r.order_number} · ${r.party_name || ''}`, description: (r) => r.status } },
      { ...warehouseRef('warehouse_id', 'Warehouse (optional)', false) },
    ],
    actions: [
      { id: 'start', label: 'Start picking', variant: 'primary', when: ['OPEN'] },
      { id: 'complete', label: 'Complete', variant: 'primary', when: ['PICKING'] },
      { id: 'cancel', label: 'Cancel', variant: 'destructive', when: ['OPEN', 'PICKING'] },
    ],
    detailExtra: (row, reload) => <PickLines row={row} reload={reload} />,
  },
  {
    id: 'unbinned',
    label: 'Putaway queue',
    endpoint: '/wms/unbinned',
    noDetailFetch: true,
    emptyTitle: 'Everything is binned',
    emptyMessage: 'Received stock that is not yet in a bin appears here.',
    columns: [
      { key: 'warehouse_code', header: 'Warehouse' },
      { key: 'item_code', header: 'Item' },
      { key: 'item_name', header: 'Description' },
      { key: 'on_hand', header: 'On hand', kind: 'qty' },
      { key: 'binned', header: 'In bins', kind: 'qty' },
      { key: 'unbinned', header: 'To put away', kind: 'qty' },
    ],
    createLabel: 'Put away',
    createEndpoint: '/wms/putaway',
    createFields: [binRef('bin_id', 'Destination bin'), itemRef(), { name: 'quantity', label: 'Quantity', type: 'decimal', required: true }],
  },
  {
    id: 'stock',
    label: 'Bin stock',
    endpoint: '/wms/bin-stock',
    noDetailFetch: true,
    columns: [
      { key: 'warehouse_code', header: 'Warehouse' },
      { key: 'bin_code', header: 'Bin' },
      { key: 'bin_type', header: 'Type', kind: 'badge' },
      { key: 'item_code', header: 'Item' },
      { key: 'item_name', header: 'Description' },
      { key: 'quantity', header: 'Quantity', kind: 'qty' },
    ],
    createLabel: 'Move between bins',
    createEndpoint: '/wms/move',
    createFields: [binRef('from_bin_id', 'From bin'), binRef('to_bin_id', 'To bin'), itemRef(), { name: 'quantity', label: 'Quantity', type: 'decimal', required: true }],
  },
  {
    id: 'bins',
    label: 'Bins',
    endpoint: '/wms/bins',
    noDetailFetch: true,
    columns: [
      { key: 'warehouse_code', header: 'Warehouse' },
      { key: 'bin_code', header: 'Bin' },
      { key: 'bin_type', header: 'Type', kind: 'badge' },
      { key: 'capacity_qty', header: 'Capacity', kind: 'qty' },
      { key: 'total_qty', header: 'Holding', kind: 'qty' },
      { key: 'sku_count', header: 'SKUs', align: 'right' },
    ],
    createLabel: 'New bin',
    createFields: [warehouseRef(), { name: 'bin_code', label: 'Bin code', type: 'text', required: true, placeholder: 'A-02-01' }, { name: 'bin_type', label: 'Type', type: 'select', required: true, options: opts('PICK', 'BULK', 'STAGING', 'QUARANTINE') }, { name: 'capacity_qty', label: 'Capacity (units)', type: 'decimal' }],
  },
];

export const WmsView: React.FC = () => (
  <ModuleWorkspace
    id="wms"
    title="Warehouse Execution"
    description="Directed putaway into bins, bin-to-bin moves and pick lists allocated PICK-before-BULK from confirmed orders. Bin stock can never exceed the stock ledger or go negative."
    tabs={tabs}
  />
);
