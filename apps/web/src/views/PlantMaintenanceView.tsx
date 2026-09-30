import React, { useState, useEffect } from 'react';
import { ApiClient } from '../api/client.js';
import { Table, Button, Input, Drawer, Badge, Card, Column, Combobox } from '@omnysync/ui';
import {
  Wrench,
  Plus,
  RefreshCw,
  Calendar,
  CheckCircle2,
  Cpu,
  Clock,
} from 'lucide-react';
import {
  MaintenanceEquipment,
  PMSchedule,
  MaintenanceWorkOrder,
  EquipmentCalibration,
  FixedAsset,
  Item,
} from '@omnysync/contracts';
import { fmtMoney, fmtQty } from '../lib/format.js';

export const PlantMaintenanceView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'EQUIPMENT' | 'SCHEDULES' | 'WORK_ORDERS' | 'CALIBRATIONS'>('EQUIPMENT');
  const [equipment, setEquipment] = useState<MaintenanceEquipment[]>([]);
  const [schedules, setSchedules] = useState<PMSchedule[]>([]);
  const [workOrders, setWorkOrders] = useState<MaintenanceWorkOrder[]>([]);
  const [calibrations, setCalibrations] = useState<EquipmentCalibration[]>([]);
  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Modals
  const [isEquipModalOpen, setIsEquipModalOpen] = useState(false);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [isWoModalOpen, setIsWoModalOpen] = useState(false);
  const [isCompleteModalOpen, setIsCompleteModalOpen] = useState(false);
  const [isCalibModalOpen, setIsCalibModalOpen] = useState(false);
  const [selectedWo, setSelectedWo] = useState<MaintenanceWorkOrder | null>(null);

  // Equipment Form
  const [equipCode, setEquipCode] = useState('');
  const [equipName, setEquipName] = useState('');
  const [equipAssetId, setEquipAssetId] = useState('');
  const [equipCategory, setEquipCategory] = useState<'MACHINERY' | 'VEHICLE' | 'ELECTRICAL' | 'HVAC'>('MACHINERY');
  const [equipLocation, setEquipLocation] = useState('Production Floor Bay 2');
  const [equipCriticality, setEquipCriticality] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'>('HIGH');
  const [equipSerial, setEquipSerial] = useState('');

  // Schedule Form
  const [schedEquipId, setSchedEquipId] = useState('');
  const [schedName, setSchedName] = useState('Monthly Motor Lubrication & Bearing Check');
  const [schedInterval, setSchedInterval] = useState('30');

  // Work Order Form
  const [woEquipId, setWoEquipId] = useState('');
  const [woType, setWoType] = useState<'PREVENTIVE' | 'CORRECTIVE' | 'BREAKDOWN' | 'CALIBRATION'>('PREVENTIVE');
  const [woPriority, setWoPriority] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'EMERGENCY'>('MEDIUM');
  const [woDesc, setWoDesc] = useState('');
  const [partItemId, setPartItemId] = useState('');
  const [partQty, setPartQty] = useState('1');
  const [partCost, setPartCost] = useState('4500.00');
  const [techName, setTechName] = useState('Senior Millwright');
  const [laborHours, setLaborHours] = useState('4.00');
  const [laborRate, setLaborRate] = useState('2000.00');

  // Complete Form
  const [downtimeHours, setDowntimeHours] = useState('2.50');

  // Calibration Form
  const [calibEquipId, setCalibEquipId] = useState('');
  const [calibCertNo, setCalibCertNo] = useState('');
  const [calibAgency, setCalibAgency] = useState('National Metrology Institute');
  const [calibResult, setCalibResult] = useState<'PASS' | 'FAIL'>('PASS');

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const loadData = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [equipRes, schedRes, woRes, calibRes, assetsRes, itemsRes] = await Promise.all([
        ApiClient.get('/maintenance/equipment'),
        ApiClient.get('/maintenance/schedules'),
        ApiClient.get('/maintenance/work-orders'),
        ApiClient.get('/maintenance/calibrations'),
        ApiClient.get('/assets'),
        ApiClient.get('/items'),
      ]);

      const equipList = (equipRes as any).data || [];
      setEquipment(equipList);
      setSchedules((schedRes as any).data || []);
      setWorkOrders((woRes as any).data || []);
      setCalibrations((calibRes as any).data || []);
      setAssets((assetsRes as any).data || []);
      const itemList = (itemsRes as any).data || [];
      setItems(itemList);

      if (equipList.length > 0) {
        if (!schedEquipId) setSchedEquipId(equipList[0].id);
        if (!woEquipId) setWoEquipId(equipList[0].id);
        if (!calibEquipId) setCalibEquipId(equipList[0].id);
      }
      if (itemList.length > 0 && !partItemId) {
        setPartItemId(itemList[0].id);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
      console.error('Failed to load Maintenance data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateEquip = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg('');
    try {
      await ApiClient.post('/maintenance/equipment', {
        equipment_code: equipCode,
        name: equipName,
        fixed_asset_id: equipAssetId || null,
        category: equipCategory,
        location: equipLocation,
        criticality: equipCriticality,
        serial_number: equipSerial,
      });
      setIsEquipModalOpen(false);
      setEquipCode('');
      setEquipName('');
      await loadData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create equipment');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg('');
    try {
      await ApiClient.post('/maintenance/schedules', {
        equipment_id: schedEquipId,
        schedule_name: schedName,
        frequency_type: 'TIME_BASED_DAYS',
        frequency_interval: schedInterval,
      });
      setIsScheduleModalOpen(false);
      await loadData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create PM schedule');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateWo = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg('');
    try {
      await ApiClient.post('/maintenance/work-orders', {
        equipment_id: woEquipId,
        order_type: woType,
        priority: woPriority,
        description: woDesc,
        parts: partItemId ? [{ item_id: partItemId, quantity: partQty, unit_cost: partCost }] : [],
        labor: [{ technician_name: techName, labor_hours: laborHours, hourly_rate: laborRate }],
      });
      setIsWoModalOpen(false);
      setWoDesc('');
      await loadData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create work order');
    } finally {
      setSaving(false);
    }
  };

  const handleCompleteWo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWo) return;
    setSaving(true);
    setErrorMsg('');
    try {
      await ApiClient.post(`/maintenance/work-orders/${selectedWo.id}/complete`, {
        downtime_hours: downtimeHours,
      });
      setIsCompleteModalOpen(false);
      setSelectedWo(null);
      alert('Maintenance Work Order settled & balanced journal posted to General Ledger!');
      await loadData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Completion settlement failed');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateCalib = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg('');
    try {
      await ApiClient.post('/maintenance/calibrations', {
        equipment_id: calibEquipId,
        calibration_certificate_no: calibCertNo,
        calibration_agency: calibAgency,
        result: calibResult,
      });
      setIsCalibModalOpen(false);
      setCalibCertNo('');
      await loadData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to record calibration');
    } finally {
      setSaving(false);
    }
  };

  const equipColumns: Column<MaintenanceEquipment>[] = [
    { key: 'code', header: 'Equipment Code', render: (row) => <span className="font-mono font-bold text-indigo-600">{row.equipment_code}</span> },
    { key: 'name', header: 'Machine Name', render: (row) => <span>{row.name}</span> },
    { key: 'category', header: 'Category', render: (row) => <span>{row.category}</span> },
    { key: 'location', header: 'Location', render: (row) => <span>{row.location || 'Unassigned'}</span> },
    {
      key: 'criticality',
      header: 'Criticality',
      render: (row) => (
        <Badge variant={row.criticality === 'CRITICAL' ? 'danger' : row.criticality === 'HIGH' ? 'warning' : 'neutral'}>
          {row.criticality}
        </Badge>
      ),
    },
    {
      key: 'status',
      header: 'Operational Status',
      render: (row) => (
        <Badge variant={row.status === 'OPERATIONAL' ? 'success' : row.status === 'UNDER_MAINTENANCE' ? 'warning' : 'neutral'}>
          {row.status}
        </Badge>
      ),
    },
    { key: 'hours', header: 'Operating Hours', render: (row) => <span>{fmtQty(row.operating_hours)} hrs</span> },
  ];

  const schedColumns: Column<PMSchedule>[] = [
    { key: 'name', header: 'Schedule Name', render: (row) => <span className="font-semibold text-slate-900">{row.schedule_name}</span> },
    { key: 'equipment', header: 'Equipment', render: (row) => <span>{row.equipment_code} - {row.equipment_name}</span> },
    { key: 'frequency', header: 'Frequency', render: (row) => <span>Every {fmtQty(row.frequency_interval)} days</span> },
    { key: 'next_due', header: 'Next Due Date', render: (row) => <span className="font-mono font-bold text-amber-700">{row.next_due_date}</span> },
    { key: 'status', header: 'Status', render: (row) => <Badge variant="success">{row.status}</Badge> },
  ];

  const woColumns: Column<MaintenanceWorkOrder>[] = [
    { key: 'number', header: 'WO Number', render: (row) => <span className="font-mono font-bold text-indigo-600">{row.work_order_number}</span> },
    { key: 'equipment', header: 'Equipment', render: (row) => <span>{row.equipment_code} - {row.equipment_name}</span> },
    { key: 'type', header: 'Order Type', render: (row) => <span>{row.order_type}</span> },
    {
      key: 'priority',
      header: 'Priority',
      render: (row) => (
        <Badge variant={row.priority === 'EMERGENCY' ? 'danger' : row.priority === 'HIGH' ? 'warning' : 'neutral'}>
          {row.priority}
        </Badge>
      ),
    },
    { key: 'cost', header: 'Total Cost (PKR)', render: (row) => <span>PKR {fmtMoney(row.total_cost)}</span> },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <Badge variant={row.status === 'COMPLETED' ? 'success' : row.status === 'IN_PROGRESS' ? 'warning' : 'neutral'}>
          {row.status}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (row) =>
        row.status === 'IN_PROGRESS' ? (
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setSelectedWo(row);
              setIsCompleteModalOpen(true);
            }}
          >
            <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
            Complete & Settle GL
          </Button>
        ) : (
          <span className="text-xs text-slate-400 font-mono">Settled</span>
        ),
    },
  ];

  const calibColumns: Column<EquipmentCalibration>[] = [
    { key: 'cert', header: 'Certificate No', render: (row) => <span className="font-mono font-bold text-slate-900">{row.calibration_certificate_no}</span> },
    { key: 'equipment', header: 'Equipment', render: (row) => <span>{row.equipment_code} - {row.equipment_name}</span> },
    { key: 'agency', header: 'Agency', render: (row) => <span>{row.calibration_agency}</span> },
    { key: 'date', header: 'Calibration Date', render: (row) => <span>{row.calibration_date}</span> },
    { key: 'expiry', header: 'Expiry Date', render: (row) => <span className="font-mono font-semibold text-slate-700">{row.expiry_date}</span> },
    { key: 'result', header: 'Result', render: (row) => <Badge variant={row.result === 'PASS' ? 'success' : 'danger'}>{row.result}</Badge> },
  ];

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Wrench className="w-7 h-7 text-indigo-600" />
            Plant Maintenance & Equipment Engineering
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Machinery register, preventive maintenance schedules, spare parts costing, labor tracking, and calibration certificates.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={loadData}>
            <RefreshCw className="w-4 h-4 mr-1" />
            Refresh
          </Button>

          {activeTab === 'EQUIPMENT' && (
            <Button variant="primary" onClick={() => setIsEquipModalOpen(true)}>
              <Plus className="w-4 h-4 mr-1" />
              Register Equipment
            </Button>
          )}

          {activeTab === 'SCHEDULES' && (
            <Button variant="primary" onClick={() => setIsScheduleModalOpen(true)}>
              <Plus className="w-4 h-4 mr-1" />
              Add PM Schedule
            </Button>
          )}

          {activeTab === 'WORK_ORDERS' && (
            <Button variant="primary" onClick={() => setIsWoModalOpen(true)}>
              <Plus className="w-4 h-4 mr-1" />
              Create Work Order
            </Button>
          )}

          {activeTab === 'CALIBRATIONS' && (
            <Button variant="primary" onClick={() => setIsCalibModalOpen(true)}>
              <Plus className="w-4 h-4 mr-1" />
              Log Calibration
            </Button>
          )}
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-slate-200 gap-6 text-sm font-semibold">
        <button
          onClick={() => setActiveTab('EQUIPMENT')}
          className={`pb-3 flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === 'EQUIPMENT' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Cpu className="w-4 h-4" />
          Machinery Register ({equipment.length})
        </button>
        <button
          onClick={() => setActiveTab('SCHEDULES')}
          className={`pb-3 flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === 'SCHEDULES' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Calendar className="w-4 h-4" />
          PM Schedules ({schedules.length})
        </button>
        <button
          onClick={() => setActiveTab('WORK_ORDERS')}
          className={`pb-3 flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === 'WORK_ORDERS' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Wrench className="w-4 h-4" />
          Work Orders ({workOrders.length})
        </button>
        <button
          onClick={() => setActiveTab('CALIBRATIONS')}
          className={`pb-3 flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === 'CALIBRATIONS' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Clock className="w-4 h-4" />
          Calibrations ({calibrations.length})
        </button>
      </div>

      {/* Tab Contents */}
      {activeTab === 'EQUIPMENT' && (
        <Card>
          <Table data={equipment} columns={equipColumns} keyExtractor={(r) => r.id} isLoading={loading} error={loadError} onRetry={loadData} emptyMessage="No plant machinery registered." />
        </Card>
      )}

      {activeTab === 'SCHEDULES' && (
        <Card>
          <Table data={schedules} columns={schedColumns} keyExtractor={(r) => r.id} isLoading={loading} error={loadError} onRetry={loadData} emptyMessage="No preventive maintenance schedules configured." />
        </Card>
      )}

      {activeTab === 'WORK_ORDERS' && (
        <Card>
          <Table data={workOrders} columns={woColumns} keyExtractor={(r) => r.id} isLoading={loading} error={loadError} onRetry={loadData} emptyMessage="No maintenance work orders on record." />
        </Card>
      )}

      {activeTab === 'CALIBRATIONS' && (
        <Card>
          <Table data={calibrations} columns={calibColumns} keyExtractor={(r) => r.id} isLoading={loading} error={loadError} onRetry={loadData} emptyMessage="No equipment calibration records found." />
        </Card>
      )}

      {/* Register Equipment Drawer */}
      <Drawer isOpen={isEquipModalOpen} onClose={() => setIsEquipModalOpen(false)} title="Register Machinery / Equipment">
        <form onSubmit={handleCreateEquip} className="space-y-4">
          {errorMsg && <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg">{errorMsg}</div>}
          <div className="grid grid-cols-2 gap-4">
            <Input label="Equipment Code" value={equipCode} onChange={(e) => setEquipCode(e.target.value)} placeholder="CNC-MILL-02" required />
            <Input label="Machine / Asset Name" value={equipName} onChange={(e) => setEquipName(e.target.value)} placeholder="5-Axis CNC Milling Center" required />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
              <Combobox aria-label="Category"
                className="w-full"
                value={equipCategory}
                onChange={(e: any) => setEquipCategory(e.target.value)}
              >
                <option value="MACHINERY">MACHINERY</option>
                <option value="VEHICLE">VEHICLE</option>
                <option value="ELECTRICAL">ELECTRICAL</option>
                <option value="HVAC">HVAC</option>
              </Combobox>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Criticality</label>
              <Combobox aria-label="Criticality"
                className="w-full"
                value={equipCriticality}
                onChange={(e: any) => setEquipCriticality(e.target.value)}
              >
                <option value="LOW">LOW</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="HIGH">HIGH</option>
                <option value="CRITICAL">CRITICAL</option>
              </Combobox>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Fixed Asset Link</label>
              <Combobox aria-label="Fixed Asset Link"
                className="w-full"
                value={equipAssetId}
                onChange={(e) => setEquipAssetId(e.target.value)}
              >
                <option value="">-- No Fixed Asset Link --</option>
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>{a.asset_number} - {a.name}</option>
                ))}
              </Combobox>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Location" value={equipLocation} onChange={(e) => setEquipLocation(e.target.value)} />
            <Input label="Serial Number" value={equipSerial} onChange={(e) => setEquipSerial(e.target.value)} placeholder="SN-HAAS-8819" />
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setIsEquipModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Register Equipment'}</Button>
          </div>
        </form>
      </Drawer>

      {/* Add PM Schedule Drawer */}
      <Drawer isOpen={isScheduleModalOpen} onClose={() => setIsScheduleModalOpen(false)} title="Create Preventive Maintenance Schedule">
        <form onSubmit={handleCreateSchedule} className="space-y-4">
          {errorMsg && <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg">{errorMsg}</div>}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Target Equipment</label>
            <Combobox aria-label="Target Equipment"
              className="w-full"
              value={schedEquipId}
              onChange={(e) => setSchedEquipId(e.target.value)}
              required
            >
              {equipment.map((eq) => (
                <option key={eq.id} value={eq.id}>{eq.equipment_code} - {eq.name}</option>
              ))}
            </Combobox>
          </div>
          <Input label="Maintenance Schedule Title" value={schedName} onChange={(e) => setSchedName(e.target.value)} required />
          <Input label="Frequency Interval (Days)" type="number" min="1" value={schedInterval} onChange={(e) => setSchedInterval(e.target.value)} required />
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setIsScheduleModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save PM Schedule'}</Button>
          </div>
        </form>
      </Drawer>

      {/* Create Work Order Drawer */}
      <Drawer isOpen={isWoModalOpen} onClose={() => setIsWoModalOpen(false)} title="Create Maintenance Work Order">
        <form onSubmit={handleCreateWo} className="space-y-4">
          {errorMsg && <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg">{errorMsg}</div>}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Equipment</label>
              <Combobox aria-label="Equipment"
                className="w-full"
                value={woEquipId}
                onChange={(e) => setWoEquipId(e.target.value)}
                required
              >
                {equipment.map((eq) => (
                  <option key={eq.id} value={eq.id}>{eq.equipment_code} - {eq.name}</option>
                ))}
              </Combobox>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Order Type</label>
              <Combobox aria-label="Order Type"
                className="w-full"
                value={woType}
                onChange={(e: any) => setWoType(e.target.value)}
              >
                <option value="PREVENTIVE">PREVENTIVE</option>
                <option value="CORRECTIVE">CORRECTIVE</option>
                <option value="BREAKDOWN">BREAKDOWN</option>
                <option value="CALIBRATION">CALIBRATION</option>
              </Combobox>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Priority</label>
              <Combobox aria-label="Priority"
                className="w-full"
                value={woPriority}
                onChange={(e: any) => setWoPriority(e.target.value)}
              >
                <option value="LOW">LOW</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="HIGH">HIGH</option>
                <option value="EMERGENCY">EMERGENCY</option>
              </Combobox>
            </div>
          </div>
          <Input label="Work Order Description" value={woDesc} onChange={(e) => setWoDesc(e.target.value)} placeholder="Spindle bearing replacement and balance alignment" required />
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
            <h4 className="text-xs font-bold text-slate-700 uppercase">Spare Parts & Technician Labor</h4>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Spare Part Item</label>
                <Combobox aria-label="Spare Part Item"
                  className="w-full"
                  value={partItemId}
                  onChange={(e) => setPartItemId(e.target.value)}
                >
                  <option value="">-- No Parts Consumed --</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>{it.code} - {it.name}</option>
                  ))}
                </Combobox>
              </div>
              <Input label="Part Quantity" value={partQty} onChange={(e) => setPartQty(e.target.value)} />
              <Input label="Unit Cost (PKR)" value={partCost} onChange={(e) => setPartCost(e.target.value)} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Input label="Technician Name" value={techName} onChange={(e) => setTechName(e.target.value)} />
              <Input label="Labor Hours" value={laborHours} onChange={(e) => setLaborHours(e.target.value)} />
              <Input label="Hourly Rate (PKR)" value={laborRate} onChange={(e) => setLaborRate(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setIsWoModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Creating...' : 'Create Work Order'}</Button>
          </div>
        </form>
      </Drawer>

      {/* Complete Work Order Drawer */}
      <Drawer isOpen={isCompleteModalOpen} onClose={() => setIsCompleteModalOpen(false)} title={`Complete Work Order: ${selectedWo?.work_order_number}`}>
        <form onSubmit={handleCompleteWo} className="space-y-4">
          {errorMsg && <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg">{errorMsg}</div>}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm space-y-1">
            <div><span className="text-slate-500">Machine:</span> <span className="font-semibold text-slate-900">{selectedWo?.equipment_name}</span></div>
            <div><span className="text-slate-500">Total Settlement Expense:</span> <span className="font-bold text-indigo-700">PKR {fmtQty(selectedWo?.total_cost || '0')}</span></div>
          </div>
          <Input label="Actual Equipment Downtime (Hours)" value={downtimeHours} onChange={(e) => setDowntimeHours(e.target.value)} required />
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setIsCompleteModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Posting GL...' : 'Complete & Post Settlement Voucher'}</Button>
          </div>
        </form>
      </Drawer>

      {/* Log Calibration Drawer */}
      <Drawer isOpen={isCalibModalOpen} onClose={() => setIsCalibModalOpen(false)} title="Log Equipment Calibration">
        <form onSubmit={handleCreateCalib} className="space-y-4">
          {errorMsg && <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg">{errorMsg}</div>}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Equipment</label>
            <Combobox aria-label="Equipment"
              className="w-full"
              value={calibEquipId}
              onChange={(e) => setCalibEquipId(e.target.value)}
              required
            >
              {equipment.map((eq) => (
                <option key={eq.id} value={eq.id}>{eq.equipment_code} - {eq.name}</option>
              ))}
            </Combobox>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Calibration Certificate #" value={calibCertNo} onChange={(e) => setCalibCertNo(e.target.value)} placeholder="CAL-2026-9901" required />
            <Input label="Testing Agency / Lab" value={calibAgency} onChange={(e) => setCalibAgency(e.target.value)} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Calibration Result</label>
            <Combobox aria-label="Calibration Result"
              className="w-full"
              value={calibResult}
              onChange={(e: any) => setCalibResult(e.target.value)}
            >
              <option value="PASS">PASS (Certified Operational)</option>
              <option value="FAIL">FAIL (Recalibration Required)</option>
            </Combobox>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setIsCalibModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Log Calibration'}</Button>
          </div>
        </form>
      </Drawer>
    </div>
  );
};
