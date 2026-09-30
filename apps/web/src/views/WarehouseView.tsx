import React, { useState, useEffect } from 'react';
import { ApiClient } from '../api/client.js';
import { Table, Button, Input, Drawer, Badge, Card, Combobox } from '@omnysync/ui';
import {
  Warehouse as WarehouseIcon,
  Plus,
  RefreshCw,
  Truck,
  ClipboardList,
  Layers,
  ArrowRight,
  CheckCircle2,
  FileText,
} from 'lucide-react';
import {
  Warehouse,
  ItemLot,
  StockTransfer,
  InventoryCount,
  Item,
} from '@omnysync/contracts';

export const WarehouseView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'WAREHOUSES' | 'TRANSFERS' | 'COUNTS' | 'LOTS'>('WAREHOUSES');
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [counts, setCounts] = useState<InventoryCount[]>([]);
  const [lots, setLots] = useState<ItemLot[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [periods, setPeriods] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [isWarehouseModalOpen, setIsWarehouseModalOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isCountModalOpen, setIsCountModalOpen] = useState(false);
  const [isRecordCountModalOpen, setIsRecordCountModalOpen] = useState(false);
  const [activeCount, setActiveCount] = useState<InventoryCount | null>(null);

  // Form states
  const [whCode, setWhCode] = useState('');
  const [whName, setWhName] = useState('');
  const [whAddress, setWhAddress] = useState('');

  // Transfer Form state
  const [sourceWhId, setSourceWhId] = useState('');
  const [destWhId, setDestWhId] = useState('');
  const [transferItemId, setTransferItemId] = useState('');
  const [transferQty, setTransferQty] = useState('10.00000000');

  // Count Form state
  const [countWhId, setCountWhId] = useState('');
  const [countPeriodId, setCountPeriodId] = useState('');
  const [countedQuantities, setCountedQuantities] = useState<Record<string, string>>({});

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const [whData, trfData, cntData, lotData, itmData, prdData] = await Promise.all([
        ApiClient.get('/inventory/warehouses'),
        ApiClient.get('/inventory/transfers'),
        ApiClient.get('/inventory/counts'),
        ApiClient.get('/inventory/lots'),
        ApiClient.get('/items'),
        ApiClient.get('/periods'),
      ]);
      setWarehouses(whData);
      setTransfers(trfData);
      setCounts(cntData);
      setLots(lotData);
      setItems(itmData);
      setPeriods(prdData);
      if (whData.length > 0 && !sourceWhId) {
        setSourceWhId(whData[0].id);
        if (whData.length > 1) setDestWhId(whData[1].id);
        setCountWhId(whData[0].id);
      }
      if (prdData.length > 0 && !countPeriodId) {
        const openP = prdData.find((p: any) => p.status === 'OPEN');
        if (openP) setCountPeriodId(openP.id);
      }
      if (itmData.length > 0 && !transferItemId) {
        setTransferItemId(itmData[0].id);
      }
    } catch (err) {
      console.error('Failed to load warehouse data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateWarehouse = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg('');
    try {
      await ApiClient.post('/inventory/warehouses', {
        code: whCode,
        name: whName,
        address: whAddress || undefined,
      });
      setIsWarehouseModalOpen(false);
      setWhCode('');
      setWhName('');
      setWhAddress('');
      await loadData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create warehouse');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg('');
    try {
      await ApiClient.post('/inventory/transfers', {
        source_warehouse_id: sourceWhId,
        destination_warehouse_id: destWhId,
        transfer_date: new Date().toISOString().slice(0, 10),
        items: [
          {
            item_id: transferItemId,
            requested_qty: transferQty,
          },
        ],
      });
      setIsTransferModalOpen(false);
      await loadData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create stock transfer');
    } finally {
      setSaving(false);
    }
  };

  const handleShipTransfer = async (id: string) => {
    try {
      await ApiClient.post(`/inventory/transfers/${id}/ship`, {});
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to ship transfer');
    }
  };

  const handleReceiveTransfer = async (id: string) => {
    try {
      await ApiClient.post(`/inventory/transfers/${id}/receive`, {});
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to receive transfer');
    }
  };

  const handleCreateCount = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg('');
    try {
      await ApiClient.post('/inventory/counts', {
        warehouse_id: countWhId,
        period_id: countPeriodId,
        count_date: new Date().toISOString().slice(0, 10),
      });
      setIsCountModalOpen(false);
      await loadData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to initialize inventory count');
    } finally {
      setSaving(false);
    }
  };

  const openRecordModal = (count: InventoryCount) => {
    setActiveCount(count);
    const initialCounts: Record<string, string> = {};
    for (const it of count.items || []) {
      initialCounts[it.item_id] = it.counted_qty || it.system_qty;
    }
    setCountedQuantities(initialCounts);
    setIsRecordCountModalOpen(true);
  };

  const handleSaveCounted = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCount) return;
    setSaving(true);
    setErrorMsg('');
    try {
      const countsPayload = Object.entries(countedQuantities).map(([item_id, counted_qty]) => ({
        item_id,
        counted_qty,
      }));
      await ApiClient.post(`/inventory/counts/${activeCount.id}/record`, {
        counts: countsPayload,
      });
      setIsRecordCountModalOpen(false);
      await loadData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to record counts');
    } finally {
      setSaving(false);
    }
  };

  const handleReconcileAndPostCount = async (id: string) => {
    try {
      await ApiClient.post(`/inventory/counts/${id}/reconcile-and-post`, {});
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to post inventory adjustment');
    }
  };

  // Columns
  const warehouseColumns = [
    { key: 'code', header: 'Code', accessor: (w: Warehouse) => <span className="font-mono font-bold text-blue-600">{w.code}</span> },
    { key: 'name', header: 'Warehouse Name', accessor: (w: Warehouse) => <span className="font-semibold text-gray-900">{w.name}</span> },
    { key: 'address', header: 'Location / Address', accessor: (w: Warehouse) => <span className="text-xs text-gray-600">{w.address || '—'}</span> },
    {
      key: 'default',
      header: 'Role',
      accessor: (w: Warehouse) => (
        <Badge variant={w.is_default ? 'success' : 'neutral'}>
          {w.is_default ? 'Default Main' : 'Branch Facility'}
        </Badge>
      ),
    },
  ];

  const transferColumns = [
    { key: 'num', header: 'Transfer #', accessor: (t: StockTransfer) => <span className="font-mono font-bold text-gray-900">{t.transfer_number}</span> },
    {
      key: 'route',
      header: 'Route (From -> To)',
      accessor: (t: StockTransfer) => (
        <div className="flex items-center space-x-2 text-sm font-medium text-gray-800">
          <span>{t.source_warehouse_name}</span>
          <ArrowRight size={14} className="text-gray-400" />
          <span>{t.destination_warehouse_name}</span>
        </div>
      ),
    },
    { key: 'date', header: 'Date', accessor: (t: StockTransfer) => <span className="text-xs text-gray-600">{t.transfer_date}</span> },
    {
      key: 'items',
      header: 'Items',
      accessor: (t: StockTransfer) => (
        <div className="text-xs font-mono text-gray-700">
          {t.items?.map((it) => `${it.item_code} (Req: ${parseFloat(it.requested_qty).toFixed(0)})`).join(', ')}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      accessor: (t: StockTransfer) => (
        <Badge variant={t.status === 'COMPLETED' ? 'success' : t.status === 'IN_TRANSIT' ? 'warning' : 'neutral'}>
          {t.status}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      accessor: (t: StockTransfer) => (
        <div className="flex space-x-2">
          {t.status === 'DRAFT' && (
            <Button size="sm" variant="secondary" onClick={() => handleShipTransfer(t.id)}>
              <Truck size={12} className="mr-1" /> Ship Out
            </Button>
          )}
          {t.status === 'IN_TRANSIT' && (
            <Button size="sm" variant="primary" onClick={() => handleReceiveTransfer(t.id)}>
              <CheckCircle2 size={12} className="mr-1" /> Receive In
            </Button>
          )}
        </div>
      ),
    },
  ];

  const countColumns = [
    { key: 'num', header: 'Count Sheet #', accessor: (c: InventoryCount) => <span className="font-mono font-bold text-gray-900">{c.count_number}</span> },
    { key: 'wh', header: 'Warehouse', accessor: (c: InventoryCount) => <span className="font-semibold text-gray-800">{c.warehouse_name}</span> },
    { key: 'date', header: 'Count Date', accessor: (c: InventoryCount) => <span className="text-xs text-gray-600">{c.count_date}</span> },
    {
      key: 'variance',
      header: 'Net Variance Value',
      accessor: (c: InventoryCount) => {
        const val = parseFloat(c.total_variance_value);
        return (
          <span className={`font-mono font-bold ${val < 0 ? 'text-red-600' : val > 0 ? 'text-emerald-700' : 'text-gray-600'}`}>
            PKR {val.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      accessor: (c: InventoryCount) => (
        <Badge variant={c.status === 'POSTED' ? 'success' : c.status === 'RECONCILED' ? 'warning' : 'neutral'}>
          {c.status}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      accessor: (c: InventoryCount) => (
        <div className="flex space-x-2">
          {c.status !== 'POSTED' && (
            <Button size="sm" variant="secondary" onClick={() => openRecordModal(c)}>
              <ClipboardList size={12} className="mr-1" /> Record / Audit
            </Button>
          )}
          {c.status === 'RECONCILED' && (
            <Button size="sm" variant="primary" onClick={() => handleReconcileAndPostCount(c.id)}>
              <FileText size={12} className="mr-1" /> Post GL Adj
            </Button>
          )}
        </div>
      ),
    },
  ];

  const lotColumns = [
    { key: 'lot', header: 'Lot #', accessor: (l: ItemLot) => <span className="font-mono font-bold text-blue-600">{l.lot_number}</span> },
    { key: 'item', header: 'Catalog Item', accessor: (l: ItemLot) => <span className="font-semibold text-gray-900">{l.item_name} ({l.item_code})</span> },
    { key: 'mfg', header: 'Mfg Date', accessor: (l: ItemLot) => <span className="text-xs text-gray-600">{l.manufacture_date || '—'}</span> },
    { key: 'exp', header: 'Expiry Date', accessor: (l: ItemLot) => <span className="text-xs text-gray-600">{l.expiry_date || '—'}</span> },
    {
      key: 'status',
      header: 'Lot Status',
      accessor: (l: ItemLot) => (
        <Badge variant={l.status === 'AVAILABLE' ? 'success' : l.status === 'EXPIRED' ? 'danger' : 'neutral'}>
          {l.status}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#202223]">Warehouse & Multi-Facility Logistics</h1>
          <p className="text-sm text-[#6D7175]">
            Manage multiple warehouses, inter-facility stock transfer orders, lot traceability, and cycle count reconciliations.
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <Button variant="secondary" size="sm" onClick={loadData}>
            <RefreshCw size={14} className="mr-1" /> Refresh
          </Button>
          {activeTab === 'WAREHOUSES' && (
            <Button variant="primary" size="sm" onClick={() => setIsWarehouseModalOpen(true)}>
              <Plus size={14} className="mr-1" /> New Warehouse
            </Button>
          )}
          {activeTab === 'TRANSFERS' && (
            <Button variant="primary" size="sm" onClick={() => setIsTransferModalOpen(true)}>
              <Truck size={14} className="mr-1" /> Create Stock Transfer
            </Button>
          )}
          {activeTab === 'COUNTS' && (
            <Button variant="primary" size="sm" onClick={() => setIsCountModalOpen(true)}>
              <ClipboardList size={14} className="mr-1" /> Start Cycle Count
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#E1E3E5] space-x-8">
        <button
          onClick={() => setActiveTab('WAREHOUSES')}
          className={`pb-3 text-sm font-semibold border-b-2 flex items-center space-x-2 ${
            activeTab === 'WAREHOUSES' ? 'border-[#008060] text-[#008060]' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <WarehouseIcon size={16} />
          <span>Warehouses & Bins ({warehouses.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('TRANSFERS')}
          className={`pb-3 text-sm font-semibold border-b-2 flex items-center space-x-2 ${
            activeTab === 'TRANSFERS' ? 'border-[#008060] text-[#008060]' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Truck size={16} />
          <span>Inter-Facility Transfers ({transfers.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('COUNTS')}
          className={`pb-3 text-sm font-semibold border-b-2 flex items-center space-x-2 ${
            activeTab === 'COUNTS' ? 'border-[#008060] text-[#008060]' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <ClipboardList size={16} />
          <span>Cycle Counts & Adjustments ({counts.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('LOTS')}
          className={`pb-3 text-sm font-semibold border-b-2 flex items-center space-x-2 ${
            activeTab === 'LOTS' ? 'border-[#008060] text-[#008060]' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Layers size={16} />
          <span>Lot & Batch Tracking ({lots.length})</span>
        </button>
      </div>

      {/* Content */}
      {activeTab === 'WAREHOUSES' && (
        <Card>
          <Table columns={warehouseColumns} data={warehouses} keyExtractor={(w) => w.id} isLoading={loading} emptyMessage="No warehouses created yet." />
        </Card>
      )}

      {activeTab === 'TRANSFERS' && (
        <Card>
          <Table columns={transferColumns} data={transfers} keyExtractor={(t) => t.id} isLoading={loading} emptyMessage="No stock transfers created yet." />
        </Card>
      )}

      {activeTab === 'COUNTS' && (
        <Card>
          <Table columns={countColumns} data={counts} keyExtractor={(c) => c.id} isLoading={loading} emptyMessage="No physical counts initiated yet." />
        </Card>
      )}

      {activeTab === 'LOTS' && (
        <Card>
          <Table columns={lotColumns} data={lots} keyExtractor={(l) => l.id} isLoading={loading} emptyMessage="No lot batches tracked yet." />
        </Card>
      )}

      {/* New Warehouse Modal */}
      <Drawer isOpen={isWarehouseModalOpen} onClose={() => setIsWarehouseModalOpen(false)} title="Create New Warehouse / Storage Facility">
        <form onSubmit={handleCreateWarehouse} className="space-y-4">
          {errorMsg && <div className="p-3 text-sm text-red-700 bg-red-50 rounded border border-red-200">{errorMsg}</div>}
          <div className="grid grid-cols-2 gap-3">
            <Input label="Warehouse Code" value={whCode} onChange={(e) => setWhCode(e.target.value)} placeholder="WH-NORTH" required />
            <Input label="Facility Name" value={whName} onChange={(e) => setWhName(e.target.value)} placeholder="Northern Distribution Depot" required />
          </div>
          <Input label="Address & Coordinates" value={whAddress} onChange={(e) => setWhAddress(e.target.value)} placeholder="Plot 10, I-9 Industrial Area, Islamabad" />
          <div className="flex justify-end space-x-3 pt-4 border-t">
            <Button variant="secondary" type="button" onClick={() => setIsWarehouseModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Create Warehouse'}</Button>
          </div>
        </form>
      </Drawer>

      {/* New Stock Transfer Modal */}
      <Drawer isOpen={isTransferModalOpen} onClose={() => setIsTransferModalOpen(false)} title="Initiate Inter-Facility Stock Transfer">
        <form onSubmit={handleCreateTransfer} className="space-y-4">
          {errorMsg && <div className="p-3 text-sm text-red-700 bg-red-50 rounded border border-red-200">{errorMsg}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Source Facility (Dispatch)</label>
              <Combobox aria-label="Source Facility (Dispatch)"
                value={sourceWhId}
                onChange={(e) => setSourceWhId(e.target.value)}
                className="w-full"
                required
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name} ({w.code})</option>
                ))}
              </Combobox>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Destination Facility (Receive)</label>
              <Combobox aria-label="Destination Facility (Receive)"
                value={destWhId}
                onChange={(e) => setDestWhId(e.target.value)}
                className="w-full"
                required
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name} ({w.code})</option>
                ))}
              </Combobox>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Item to Transfer</label>
              <Combobox aria-label="Item to Transfer"
                value={transferItemId}
                onChange={(e) => setTransferItemId(e.target.value)}
                className="w-full"
                required
              >
                {items.filter((i) => i.item_type === 'INVENTORY').map((i) => (
                  <option key={i.id} value={i.id}>{i.name} ({i.code})</option>
                ))}
              </Combobox>
            </div>
            <Input label="Transfer Quantity" value={transferQty} onChange={(e) => setTransferQty(e.target.value)} required />
          </div>
          <div className="flex justify-end space-x-3 pt-4 border-t">
            <Button variant="secondary" type="button" onClick={() => setIsTransferModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Initiating...' : 'Create Transfer'}</Button>
          </div>
        </form>
      </Drawer>

      {/* Start Cycle Count Modal */}
      <Drawer isOpen={isCountModalOpen} onClose={() => setIsCountModalOpen(false)} title="Initialize Physical Inventory Count">
        <form onSubmit={handleCreateCount} className="space-y-4">
          {errorMsg && <div className="p-3 text-sm text-red-700 bg-red-50 rounded border border-red-200">{errorMsg}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Target Warehouse</label>
              <Combobox aria-label="Target Warehouse"
                value={countWhId}
                onChange={(e) => setCountWhId(e.target.value)}
                className="w-full"
                required
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name} ({w.code})</option>
                ))}
              </Combobox>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Fiscal Period</label>
              <Combobox aria-label="Fiscal Period"
                value={countPeriodId}
                onChange={(e) => setCountPeriodId(e.target.value)}
                className="w-full"
                required
              >
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.status})</option>
                ))}
              </Combobox>
            </div>
          </div>
          <p className="text-xs text-gray-500">
            Initializing this count will capture a snapshot of system on-hand quantities across all inventory catalog items.
          </p>
          <div className="flex justify-end space-x-3 pt-4 border-t">
            <Button variant="secondary" type="button" onClick={() => setIsCountModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Starting...' : 'Create Count Sheet'}</Button>
          </div>
        </form>
      </Drawer>

      {/* Record / Audit Counts Modal */}
      <Drawer isOpen={isRecordCountModalOpen} onClose={() => setIsRecordCountModalOpen(false)} title={`Record Physical Counts: ${activeCount?.count_number}`}>
        <form onSubmit={handleSaveCounted} className="space-y-4">
          {errorMsg && <div className="p-3 text-sm text-red-700 bg-red-50 rounded border border-red-200">{errorMsg}</div>}
          <div className="max-h-72 overflow-y-auto space-y-3 pr-1">
            {activeCount?.items?.map((it) => (
              <div key={it.id} className="p-3 bg-gray-50 rounded border border-gray-200 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-gray-900 text-sm">{it.item_name}</div>
                  <div className="text-xs font-mono text-gray-500">{it.item_code} • System Stock: {parseFloat(it.system_qty).toFixed(0)}</div>
                </div>
                <div className="w-32">
                  <Input
                    label="Physical Count"
                    value={countedQuantities[it.item_id] || ''}
                    onChange={(e) =>
                      setCountedQuantities({
                        ...countedQuantities,
                        [it.item_id]: e.target.value,
                      })
                    }
                    required
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end space-x-3 pt-4 border-t">
            <Button variant="secondary" type="button" onClick={() => setIsRecordCountModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Compute Variances & Reconcile'}</Button>
          </div>
        </form>
      </Drawer>
    </div>
  );
};
