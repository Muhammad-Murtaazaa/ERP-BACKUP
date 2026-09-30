import React, { useState, useEffect } from 'react';
import { ApiClient } from '../api/client.js';
import { Table, Button, Input, Modal, Badge, Card } from '@omnysync/ui';
import {
  Factory,
  Plus,
  RefreshCw,
  Play,
  CheckCircle2,
  Layers,
  ChevronRight,
  PackageCheck,
} from 'lucide-react';
import {
  BillOfMaterials,
  WorkOrder,
  Item,
  Warehouse,
} from '@omnysync/contracts';

export const ManufacturingView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'WORK_ORDERS' | 'BOM'>('WORK_ORDERS');
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [boms, setBoms] = useState<BillOfMaterials[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeWO, setActiveWO] = useState<WorkOrder | null>(null);

  // Modals
  const [isBOMModalOpen, setIsBOMModalOpen] = useState(false);
  const [isWOModalOpen, setIsWOModalOpen] = useState(false);
  const [isConsumeModalOpen, setIsConsumeModalOpen] = useState(false);
  const [isCompleteModalOpen, setIsCompleteModalOpen] = useState(false);

  // BOM Form state
  const [bomNumber, setBomNumber] = useState('');
  const [bomName, setBomName] = useState('');
  const [bomFinishedItemId, setBomFinishedItemId] = useState('');
  const [bomYieldQty, setBomYieldQty] = useState('1.00000000');
  const [bomComponentId, setBomComponentId] = useState('');
  const [bomComponentQty, setBomComponentQty] = useState('1.00000000');
  const [bomScrapPct, setBomScrapPct] = useState('0.00');

  // Work Order Form state
  const [woNumber, setWoNumber] = useState('');
  const [selectedBomId, setSelectedBomId] = useState('');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('');
  const [targetQty, setTargetQty] = useState('10.00000000');

  // Consume Form state
  const [consumeItemId, setConsumeItemId] = useState('');
  const [consumeQty, setConsumeQty] = useState('10.00000000');

  // Complete Form state
  const [completedQty, setCompletedQty] = useState('10.00000000');
  const [scrappedQty, setScrappedQty] = useState('0.00000000');

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const [woData, bomData, itmData, whData] = await Promise.all([
        ApiClient.get('/manufacturing/work-orders'),
        ApiClient.get('/manufacturing/boms'),
        ApiClient.get('/items'),
        ApiClient.get('/inventory/warehouses'),
      ]);
      setWorkOrders(woData);
      setBoms(bomData);
      setItems(itmData);
      setWarehouses(whData);

      if (bomData.length > 0 && !selectedBomId) setSelectedBomId(bomData[0].id);
      if (whData.length > 0 && !selectedWarehouseId) setSelectedWarehouseId(whData[0].id);
      if (itmData.length > 0) {
        if (!bomFinishedItemId) setBomFinishedItemId(itmData[0].id);
        if (!bomComponentId) setBomComponentId(itmData[0].id);
        if (!consumeItemId) setConsumeItemId(itmData[0].id);
      }
      if (woData.length > 0) {
        setActiveWO(woData[0]);
      }
    } catch (err) {
      console.error('Failed to load manufacturing data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateBOM = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg('');
    try {
      await ApiClient.post('/manufacturing/boms', {
        bom_number: bomNumber || `BOM-${Date.now().toString().slice(-4)}`,
        name: bomName,
        finished_item_id: bomFinishedItemId,
        yield_quantity: bomYieldQty,
        items: [
          {
            component_item_id: bomComponentId,
            quantity: bomComponentQty,
            scrap_percentage: bomScrapPct,
          },
        ],
      });
      setIsBOMModalOpen(false);
      setBomName('');
      await loadData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create BOM');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateWO = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg('');
    try {
      const newWo = await ApiClient.post('/manufacturing/work-orders', {
        work_order_number: woNumber || `WO-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`,
        bom_id: selectedBomId,
        warehouse_id: selectedWarehouseId,
        target_qty: targetQty,
      });
      setIsWOModalOpen(false);
      await loadData();
      setActiveWO(newWo);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create Work Order');
    } finally {
      setSaving(false);
    }
  };

  const handleReleaseWO = async (id: string) => {
    try {
      await ApiClient.post(`/manufacturing/work-orders/${id}/release`, {});
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to release work order');
    }
  };

  const handleRecordConsumption = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeWO) return;
    setSaving(true);
    setErrorMsg('');
    try {
      await ApiClient.post(`/manufacturing/work-orders/${activeWO.id}/consume`, {
        component_item_id: consumeItemId,
        consumed_qty: consumeQty,
      });
      setIsConsumeModalOpen(false);
      await loadData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to record consumption');
    } finally {
      setSaving(false);
    }
  };

  const handleCompleteWO = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeWO) return;
    setSaving(true);
    setErrorMsg('');
    try {
      await ApiClient.post(`/manufacturing/work-orders/${activeWO.id}/complete`, {
        completed_qty: completedQty,
        scrapped_qty: scrappedQty,
      });
      setIsCompleteModalOpen(false);
      await loadData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to complete work order');
    } finally {
      setSaving(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PLANNED':
        return <Badge variant="neutral">Planned</Badge>;
      case 'RELEASED':
        return <Badge variant="warning">Released</Badge>;
      case 'IN_PROGRESS':
        return <Badge variant="info">In Production</Badge>;
      case 'COMPLETED':
        return <Badge variant="success"><CheckCircle2 size={12} className="mr-1" /> Completed</Badge>;
      default:
        return <Badge variant="neutral">{status}</Badge>;
    }
  };

  const woColumns = [
    {
      key: 'wo_num',
      header: 'WO #',
      accessor: (w: WorkOrder) => (
        <span className={`font-mono font-bold ${activeWO?.id === w.id ? 'text-[#008060]' : 'text-gray-900'}`}>
          {w.work_order_number}
        </span>
      ),
    },
    {
      key: 'item',
      header: 'Finished Product',
      accessor: (w: WorkOrder) => (
        <div>
          <div className="font-semibold text-gray-900">{w.finished_item_name}</div>
          <div className="text-xs font-mono text-gray-500">{w.finished_item_code}</div>
        </div>
      ),
    },
    { key: 'target', header: 'Target Qty', accessor: (w: WorkOrder) => <span className="font-mono font-bold text-blue-600">{parseFloat(w.target_qty).toFixed(0)} units</span> },
    {
      key: 'cost',
      header: 'Actual Mat. Cost',
      accessor: (w: WorkOrder) => (
        <span className="font-mono text-gray-900">
          PKR {parseFloat(w.total_material_cost).toLocaleString('en-US', { minimumFractionDigits: 2 })}
        </span>
      ),
    },
    { key: 'status', header: 'Status', accessor: (w: WorkOrder) => getStatusBadge(w.status) },
    {
      key: 'actions',
      header: '',
      accessor: (w: WorkOrder) => (
        <Button variant="secondary" size="sm" onClick={() => setActiveWO(w)}>
          View <ChevronRight size={14} className="ml-1" />
        </Button>
      ),
    },
  ];

  const bomColumns = [
    { key: 'num', header: 'BOM #', accessor: (b: BillOfMaterials) => <span className="font-mono font-bold text-blue-600">{b.bom_number}</span> },
    { key: 'name', header: 'Assembly Name', accessor: (b: BillOfMaterials) => <span className="font-semibold text-gray-900">{b.name}</span> },
    { key: 'fg', header: 'Finished Item', accessor: (b: BillOfMaterials) => <span className="text-sm text-gray-800">{b.finished_item_name} ({b.finished_item_code})</span> },
    { key: 'yield', header: 'Batch Yield', accessor: (b: BillOfMaterials) => <span className="font-mono font-medium text-gray-700">{parseFloat(b.yield_quantity).toFixed(0)} units</span> },
    {
      key: 'components',
      header: 'Components',
      accessor: (b: BillOfMaterials) => (
        <div className="text-xs font-mono text-gray-600">
          {b.items?.map((it) => `${it.component_code} (${parseFloat(it.quantity).toFixed(0)})`).join(', ')}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#202223]">Manufacturing & Assembly Production</h1>
          <p className="text-sm text-[#6D7175]">
            Multi-level Bills of Materials (BOM), work order shop floor execution, WIP costing, and finished goods assembly.
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <Button variant="secondary" size="sm" onClick={loadData}>
            <RefreshCw size={14} className="mr-1" /> Refresh
          </Button>
          {activeTab === 'WORK_ORDERS' && (
            <Button variant="primary" size="sm" onClick={() => setIsWOModalOpen(true)}>
              <Plus size={14} className="mr-1" /> Create Work Order
            </Button>
          )}
          {activeTab === 'BOM' && (
            <Button variant="primary" size="sm" onClick={() => setIsBOMModalOpen(true)}>
              <Plus size={14} className="mr-1" /> New Bill of Materials
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#E1E3E5] space-x-8">
        <button
          onClick={() => setActiveTab('WORK_ORDERS')}
          className={`pb-3 text-sm font-semibold border-b-2 flex items-center space-x-2 ${
            activeTab === 'WORK_ORDERS' ? 'border-[#008060] text-[#008060]' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Factory size={16} />
          <span>Production Work Orders ({workOrders.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('BOM')}
          className={`pb-3 text-sm font-semibold border-b-2 flex items-center space-x-2 ${
            activeTab === 'BOM' ? 'border-[#008060] text-[#008060]' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Layers size={16} />
          <span>Bills of Materials (BOM) ({boms.length})</span>
        </button>
      </div>

      {/* Main Content */}
      {activeTab === 'WORK_ORDERS' && (
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 lg:col-span-7 space-y-4">
            <Card title="Active Work Orders">
              <Table columns={woColumns} data={workOrders} keyExtractor={(w) => w.id} isLoading={loading} emptyMessage="No work orders created yet." />
            </Card>
          </div>

          <div className="col-span-12 lg:col-span-5 space-y-4">
            {activeWO ? (
              <Card title={`Work Order: ${activeWO.work_order_number}`}>
                <div className="space-y-5">
                  {/* Summary Box */}
                  <div className="p-4 bg-[#F7F8F9] rounded-lg border border-[#E1E3E5] space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</span>
                      {getStatusBadge(activeWO.status)}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Finished Product:</span>
                      <span className="text-sm font-semibold text-gray-900">{activeWO.finished_item_name}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Target Production Qty:</span>
                      <span className="text-sm font-mono font-bold text-blue-600">{parseFloat(activeWO.target_qty).toFixed(0)} units</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Total Material Cost:</span>
                      <span className="text-sm font-mono font-bold text-gray-900">
                        PKR {parseFloat(activeWO.total_material_cost).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-gray-500 uppercase">Shop Floor Execution</div>
                    {activeWO.status === 'PLANNED' && (
                      <Button variant="primary" className="w-full justify-center" onClick={() => handleReleaseWO(activeWO.id)}>
                        <Play size={16} className="mr-2" /> Release to Production Floor
                      </Button>
                    )}
                    {(activeWO.status === 'RELEASED' || activeWO.status === 'IN_PROGRESS') && (
                      <div className="grid grid-cols-2 gap-2">
                        <Button variant="secondary" className="justify-center" onClick={() => setIsConsumeModalOpen(true)}>
                          <Layers size={14} className="mr-1" /> Issue Materials
                        </Button>
                        <Button variant="primary" className="justify-center" onClick={() => setIsCompleteModalOpen(true)}>
                          <PackageCheck size={14} className="mr-1" /> Complete & Settle GL
                        </Button>
                      </div>
                    )}
                    {activeWO.status === 'COMPLETED' && (
                      <div className="p-3 bg-emerald-50 text-emerald-800 rounded text-center text-sm font-semibold flex items-center justify-center">
                        <CheckCircle2 size={16} className="mr-2" /> Finished Goods Assembled & GL Posted
                      </div>
                    )}
                  </div>

                  {/* Consumed Materials */}
                  <div className="space-y-3">
                    <div className="text-xs font-semibold text-gray-500 uppercase">
                      Raw Materials Issued to WIP ({activeWO.consumptions?.length || 0})
                    </div>
                    <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                      {activeWO.consumptions?.map((c) => (
                        <div key={c.id} className="p-3 bg-white border border-gray-200 rounded text-sm space-y-1">
                          <div className="flex justify-between items-center">
                            <span className="font-semibold text-gray-900">{c.component_name}</span>
                            <span className="font-mono text-xs font-bold text-gray-600">{parseFloat(c.consumed_qty).toFixed(0)} units</span>
                          </div>
                          <div className="flex justify-between text-xs text-gray-500">
                            <span>Cost: PKR {parseFloat(c.total_cost).toLocaleString()}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>
            ) : (
              <Card>
                <div className="p-8 text-center text-gray-500 text-sm">
                  Select a work order from the left to view details and manage production.
                </div>
              </Card>
            )}
          </div>
        </div>
      )}

      {activeTab === 'BOM' && (
        <Card title="Bills of Materials (BOM) Specifications">
          <Table columns={bomColumns} data={boms} keyExtractor={(b) => b.id} isLoading={loading} emptyMessage="No BOMs created yet." />
        </Card>
      )}

      {/* New BOM Modal */}
      <Modal isOpen={isBOMModalOpen} onClose={() => setIsBOMModalOpen(false)} title="Create Bill of Materials (BOM)">
        <form onSubmit={handleCreateBOM} className="space-y-4">
          {errorMsg && <div className="p-3 text-sm text-red-700 bg-red-50 rounded border border-red-200">{errorMsg}</div>}
          <div className="grid grid-cols-2 gap-3">
            <Input label="BOM Reference Number" value={bomNumber} onChange={(e) => setBomNumber(e.target.value)} placeholder="BOM-PC-01" required />
            <Input label="Assembly Specification Name" value={bomName} onChange={(e) => setBomName(e.target.value)} placeholder="Desktop Workstation Assembly" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Finished Catalog Item</label>
              <select
                value={bomFinishedItemId}
                onChange={(e) => setBomFinishedItemId(e.target.value)}
                className="w-full h-9 px-3 rounded border border-gray-300 text-sm focus:outline-none focus:ring-1 focus:ring-[#008060]"
                required
              >
                {items.filter((i) => i.item_type === 'INVENTORY').map((i) => (
                  <option key={i.id} value={i.id}>{i.name} ({i.code})</option>
                ))}
              </select>
            </div>
            <Input label="Batch Yield Quantity" value={bomYieldQty} onChange={(e) => setBomYieldQty(e.target.value)} required />
          </div>

          <div className="p-3 bg-gray-50 rounded border border-gray-200 space-y-3">
            <div className="text-xs font-semibold text-gray-700 uppercase">Primary Component Requirement</div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Component</label>
                <select
                  value={bomComponentId}
                  onChange={(e) => setBomComponentId(e.target.value)}
                  className="w-full h-8 px-2 rounded border border-gray-300 text-xs focus:outline-none focus:ring-1 focus:ring-[#008060]"
                  required
                >
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>{i.name} ({i.code})</option>
                  ))}
                </select>
              </div>
              <Input label="Quantity" value={bomComponentQty} onChange={(e) => setBomComponentQty(e.target.value)} required />
              <Input label="Scrap %" value={bomScrapPct} onChange={(e) => setBomScrapPct(e.target.value)} />
            </div>
          </div>

          <div className="flex justify-end space-x-3 pt-4 border-t">
            <Button variant="secondary" type="button" onClick={() => setIsBOMModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Create BOM'}</Button>
          </div>
        </form>
      </Modal>

      {/* New Work Order Modal */}
      <Modal isOpen={isWOModalOpen} onClose={() => setIsWOModalOpen(false)} title="Create Production Work Order">
        <form onSubmit={handleCreateWO} className="space-y-4">
          {errorMsg && <div className="p-3 text-sm text-red-700 bg-red-50 rounded border border-red-200">{errorMsg}</div>}
          <div className="grid grid-cols-2 gap-3">
            <Input label="Work Order Number" value={woNumber} onChange={(e) => setWoNumber(e.target.value)} placeholder="WO-2026-001" required />
            <Input label="Target Production Quantity" value={targetQty} onChange={(e) => setTargetQty(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Bill of Materials (BOM)</label>
              <select
                value={selectedBomId}
                onChange={(e) => setSelectedBomId(e.target.value)}
                className="w-full h-9 px-3 rounded border border-gray-300 text-sm focus:outline-none focus:ring-1 focus:ring-[#008060]"
                required
              >
                {boms.map((b) => (
                  <option key={b.id} value={b.id}>{b.name} ({b.bom_number})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Production Warehouse</label>
              <select
                value={selectedWarehouseId}
                onChange={(e) => setSelectedWarehouseId(e.target.value)}
                className="w-full h-9 px-3 rounded border border-gray-300 text-sm focus:outline-none focus:ring-1 focus:ring-[#008060]"
                required
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name} ({w.code})</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex justify-end space-x-3 pt-4 border-t">
            <Button variant="secondary" type="button" onClick={() => setIsWOModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Creating...' : 'Create Work Order'}</Button>
          </div>
        </form>
      </Modal>

      {/* Issue Materials Modal */}
      <Modal isOpen={isConsumeModalOpen} onClose={() => setIsConsumeModalOpen(false)} title="Issue Raw Materials to WIP">
        <form onSubmit={handleRecordConsumption} className="space-y-4">
          {errorMsg && <div className="p-3 text-sm text-red-700 bg-red-50 rounded border border-red-200">{errorMsg}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Component Raw Material</label>
              <select
                value={consumeItemId}
                onChange={(e) => setConsumeItemId(e.target.value)}
                className="w-full h-9 px-3 rounded border border-gray-300 text-sm focus:outline-none focus:ring-1 focus:ring-[#008060]"
                required
              >
                {items.map((i) => (
                  <option key={i.id} value={i.id}>{i.name} ({i.code}) - Cost: PKR {parseFloat(i.unit_cost).toLocaleString()}</option>
                ))}
              </select>
            </div>
            <Input label="Quantity to Issue" value={consumeQty} onChange={(e) => setConsumeQty(e.target.value)} required />
          </div>
          <div className="flex justify-end space-x-3 pt-4 border-t">
            <Button variant="secondary" type="button" onClick={() => setIsConsumeModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Issuing...' : 'Issue to Production'}</Button>
          </div>
        </form>
      </Modal>

      {/* Complete Work Order Modal */}
      <Modal isOpen={isCompleteModalOpen} onClose={() => setIsCompleteModalOpen(false)} title="Complete Assembly & Settle WIP to Finished Goods">
        <form onSubmit={handleCompleteWO} className="space-y-4">
          {errorMsg && <div className="p-3 text-sm text-red-700 bg-red-50 rounded border border-red-200">{errorMsg}</div>}
          <p className="text-sm text-gray-600">
            Completing this work order will calculate actual material consumption costs and post a balanced General Ledger journal:
            <span className="block font-mono text-xs text-blue-700 mt-1">Dr Finished Goods Inventory 113004 / Dr Scrap 511003 / Cr WIP 113003</span>
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Completed Finished Quantity" value={completedQty} onChange={(e) => setCompletedQty(e.target.value)} required />
            <Input label="Scrapped Units (if any)" value={scrappedQty} onChange={(e) => setScrappedQty(e.target.value)} />
          </div>
          <div className="flex justify-end space-x-3 pt-4 border-t">
            <Button variant="secondary" type="button" onClick={() => setIsCompleteModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Completing...' : 'Complete & Post to GL'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
