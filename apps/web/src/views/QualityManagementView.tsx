import React, { useState, useEffect } from 'react';
import { ApiClient } from '../api/client.js';
import { Table, Button, Input, Drawer, Badge, Card, Column, Combobox } from '@omnysync/ui';
import {
  ShieldCheck,
  Plus,
  RefreshCw,
  AlertTriangle,
  FileCheck2,
  ListFilter,
  CheckCircle2,
} from 'lucide-react';
import {
  QualityInspectionPlan,
  QualityInspectionLot,
  QualityNCR,
  QualityCoA,
  Item,
  Party,
} from '@omnysync/contracts';
import { fmtQty } from '../lib/format.js';

export const QualityManagementView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'LOTS' | 'PLANS' | 'NCR' | 'COA'>('LOTS');
  const [lots, setLots] = useState<QualityInspectionLot[]>([]);
  const [plans, setPlans] = useState<QualityInspectionPlan[]>([]);
  const [ncrs, setNcrs] = useState<QualityNCR[]>([]);
  const [coas, setCoas] = useState<QualityCoA[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Modals
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);
  const [isLotModalOpen, setIsLotModalOpen] = useState(false);
  const [isInspectModalOpen, setIsInspectModalOpen] = useState(false);
  const [isNcrModalOpen, setIsNcrModalOpen] = useState(false);
  const [isCoaModalOpen, setIsCoaModalOpen] = useState(false);
  const [selectedLot, setSelectedLot] = useState<QualityInspectionLot | null>(null);

  // Plan Form
  const [planCode, setPlanCode] = useState('');
  const [planName, setPlanName] = useState('');
  const [planItemId, setPlanItemId] = useState('');
  const [paramName, setParamName] = useState('Purity / Strength');
  const [paramMin, setParamMin] = useState('98.00');
  const [paramMax, setParamMax] = useState('100.00');
  const [paramUom, setParamUom] = useState('%');

  // Lot Form
  const [lotItemId, setLotItemId] = useState('');
  const [lotQty, setLotQty] = useState('100.00');
  const [batchNum, setBatchNum] = useState('');

  // Inspect Form
  const [measuredNumeric, setMeasuredNumeric] = useState('');
  const [measuredText, setMeasuredText] = useState('PASS');
  const [inspectionNotes, setInspectionNotes] = useState('');

  // NCR Form
  const [ncrLotId, setNcrLotId] = useState('');
  const [defectSeverity, setDefectSeverity] = useState<'MINOR' | 'MAJOR' | 'CRITICAL'>('MAJOR');
  const [rootCause, setRootCause] = useState('');
  const [correctiveAction, setCorrectiveAction] = useState('');
  const [ncrDisposition, setNcrDisposition] = useState<'REWORK' | 'SCRAP' | 'RETURN_TO_VENDOR' | 'USE_AS_IS'>('SCRAP');

  // CoA Form
  const [coaLotId, setCoaLotId] = useState('');
  const [coaCustomerId, setCoaCustomerId] = useState('');
  const [certifiedBy, setCertifiedBy] = useState('Lead QA Specialist');

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const loadData = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [lotsRes, plansRes, ncrRes, coaRes, itemsRes, partiesRes] = await Promise.all([
        ApiClient.get('/quality/lots'),
        ApiClient.get('/quality/plans'),
        ApiClient.get('/quality/ncr'),
        ApiClient.get('/quality/coa'),
        ApiClient.get('/items'),
        ApiClient.get('/parties'),
      ]);

      setLots((lotsRes as any).data || []);
      setPlans((plansRes as any).data || []);
      setNcrs((ncrRes as any).data || []);
      setCoas((coaRes as any).data || []);
      const itemList = (itemsRes as any).data || [];
      setItems(itemList);
      const partyList = (partiesRes as any).data || [];
      setParties(partyList);

      if (itemList.length > 0) {
        if (!planItemId) setPlanItemId(itemList[0].id);
        if (!lotItemId) setLotItemId(itemList[0].id);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
      console.error('Failed to load Quality Management data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreatePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg('');
    try {
      await ApiClient.post('/quality/plans', {
        plan_code: planCode,
        name: planName,
        item_id: planItemId,
        inspection_type: 'RECEIVING',
        params: [
          {
            param_name: paramName,
            data_type: 'NUMERIC',
            min_tolerance: paramMin,
            max_tolerance: paramMax,
            uom: paramUom,
            is_mandatory: true,
          },
        ],
      });
      setIsPlanModalOpen(false);
      setPlanCode('');
      setPlanName('');
      await loadData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create inspection plan');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateLot = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg('');
    try {
      await ApiClient.post('/quality/lots', {
        item_id: lotItemId,
        quantity: lotQty,
        batch_number: batchNum || `BATCH-${Date.now().toString().slice(-4)}`,
        source_type: 'MANUAL',
      });
      setIsLotModalOpen(false);
      setBatchNum('');
      await loadData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create inspection lot');
    } finally {
      setSaving(false);
    }
  };

  const handleInspectLot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLot) return;
    setSaving(true);
    setErrorMsg('');
    try {
      await ApiClient.post(`/quality/lots/${selectedLot.id}/inspect`, {
        usage_decision_notes: inspectionNotes,
        results: [
          {
            param_name: 'Purity / Strength',
            measured_numeric_value: measuredNumeric,
            measured_text_value: measuredText,
            inspector_notes: inspectionNotes,
          },
        ],
      });
      setIsInspectModalOpen(false);
      setSelectedLot(null);
      await loadData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Inspection recording failed');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateNcr = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg('');
    try {
      await ApiClient.post('/quality/ncr', {
        lot_id: ncrLotId,
        defect_severity: defectSeverity,
        root_cause: rootCause,
        corrective_action: correctiveAction,
        disposition: ncrDisposition,
      });
      setIsNcrModalOpen(false);
      setRootCause('');
      setCorrectiveAction('');
      await loadData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to file NCR');
    } finally {
      setSaving(false);
    }
  };

  const handleScrapNcr = async (ncrId: string) => {
    if (!confirm('Authorize inventory write-off and post scrap journal to General Ledger?')) return;
    try {
      await ApiClient.post(`/quality/ncr/${ncrId}/scrap`, {});
      alert('Defective inventory written off & scrap journal posted to GL!');
      await loadData();
    } catch (err: any) {
      alert(`Scrap write-off failed: ${err.message}`);
    }
  };

  const handleIssueCoA = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg('');
    try {
      await ApiClient.post('/quality/coa', {
        lot_id: coaLotId,
        customer_id: coaCustomerId || null,
        certified_by: certifiedBy,
      });
      setIsCoaModalOpen(false);
      await loadData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to issue Certificate of Analysis');
    } finally {
      setSaving(false);
    }
  };

  const lotColumns: Column<QualityInspectionLot>[] = [
    { key: 'lot_number', header: 'Lot Number', render: (row) => <span className="font-mono font-bold text-indigo-600">{row.lot_number}</span> },
    { key: 'item', header: 'Item / Material', render: (row) => <span>{row.item_code} - {row.item_name}</span> },
    { key: 'batch', header: 'Batch / Heat #', render: (row) => <span>{row.batch_number || 'N/A'}</span> },
    { key: 'qty', header: 'Quantity', render: (row) => <span>{fmtQty(row.quantity)}</span> },
    {
      key: 'status',
      header: 'Quality Status',
      render: (row) => {
        const variant =
          row.status === 'ACCEPTED'
            ? 'success'
            : row.status === 'REJECTED'
            ? 'danger'
            : row.status === 'IN_INSPECTION'
            ? 'info'
            : 'warning';
        return <Badge variant={variant}>{row.status}</Badge>;
      },
    },
    { key: 'inspector', header: 'Inspector', render: (row) => <span>{row.inspector_name || 'Pending'}</span> },
    {
      key: 'actions',
      header: 'Actions',
      render: (row) => (
        <div className="flex gap-2">
          {row.status === 'PENDING' && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setSelectedLot(row);
                setMeasuredNumeric('99.20');
                setIsInspectModalOpen(true);
              }}
            >
              <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
              Perform QA
            </Button>
          )}
          {row.status === 'REJECTED' && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setNcrLotId(row.id);
                setIsNcrModalOpen(true);
              }}
            >
              <AlertTriangle className="w-3.5 h-3.5 mr-1" />
              Raise NCR
            </Button>
          )}
          {row.status === 'ACCEPTED' && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setCoaLotId(row.id);
                setIsCoaModalOpen(true);
              }}
            >
              <FileCheck2 className="w-3.5 h-3.5 mr-1" />
              Issue CoA
            </Button>
          )}
        </div>
      ),
    },
  ];

  const planColumns: Column<QualityInspectionPlan>[] = [
    { key: 'code', header: 'Plan Code', render: (row) => <span className="font-mono font-bold text-slate-900">{row.plan_code}</span> },
    { key: 'name', header: 'Plan Name', render: (row) => <span>{row.name}</span> },
    { key: 'type', header: 'Inspection Type', render: (row) => <span>{row.inspection_type}</span> },
    {
      key: 'params',
      header: 'Parameters & Tolerances',
      render: (row) => (
        <div className="space-y-0.5 text-xs">
          {(row.params || []).map((p, idx) => (
            <div key={idx} className="text-slate-600">
              <strong className="text-slate-800">{p.param_name}:</strong> {p.min_tolerance} - {p.max_tolerance} {p.uom}
            </div>
          ))}
        </div>
      ),
    },
    { key: 'status', header: 'Status', render: (row) => <Badge variant="success">{row.status}</Badge> },
  ];

  const ncrColumns: Column<QualityNCR>[] = [
    { key: 'ncr_number', header: 'NCR Number', render: (row) => <span className="font-mono font-bold text-rose-600">{row.ncr_number}</span> },
    { key: 'lot_number', header: 'Lot #', render: (row) => <span>{row.lot_number}</span> },
    { key: 'defective_item', header: 'Defective Material', render: (row) => <span>{row.item_name}</span> },
    {
      key: 'severity',
      header: 'Severity',
      render: (row) => (
        <Badge variant={row.defect_severity === 'CRITICAL' ? 'danger' : row.defect_severity === 'MAJOR' ? 'warning' : 'neutral'}>
          {row.defect_severity}
        </Badge>
      ),
    },
    { key: 'disposition', header: 'Disposition', render: (row) => <span className="font-semibold text-slate-700">{row.disposition}</span> },
    { key: 'status', header: 'NCR Status', render: (row) => <Badge variant={row.status === 'CLOSED' ? 'neutral' : 'warning'}>{row.status}</Badge> },
    {
      key: 'actions',
      header: 'Action',
      render: (row) =>
        row.status === 'OPEN' && row.disposition === 'SCRAP' ? (
          <Button variant="destructive" size="sm" onClick={() => handleScrapNcr(row.id)}>
            Post Scrap GL
          </Button>
        ) : (
          <span className="text-xs text-slate-400">Settled</span>
        ),
    },
  ];

  const coaColumns: Column<QualityCoA>[] = [
    { key: 'coa_number', header: 'CoA Number', render: (row) => <span className="font-mono font-bold text-emerald-600">{row.coa_number}</span> },
    { key: 'lot_number', header: 'Lot Number', render: (row) => <span>{row.lot_number}</span> },
    { key: 'item', header: 'Material Certified', render: (row) => <span>{row.item_name}</span> },
    { key: 'customer', header: 'Customer', render: (row) => <span>{row.customer_name || 'Standard Commercial'}</span> },
    { key: 'issue_date', header: 'Issue Date', render: (row) => <span>{row.issue_date}</span> },
    { key: 'certified_by', header: 'Certified By', render: (row) => <span>{row.certified_by}</span> },
    { key: 'status', header: 'Status', render: (row) => <Badge variant="success">{row.status}</Badge> },
  ];

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="w-7 h-7 text-indigo-600" />
            Quality Management & Inspection Lots
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Inspection plans, tolerance verification, lot acceptance, Non-Conformance Reports (NCR), and Certificates of Analysis (CoA).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={loadData}>
            <RefreshCw className="w-4 h-4 mr-1" />
            Refresh
          </Button>

          {activeTab === 'LOTS' && (
            <Button variant="primary" onClick={() => setIsLotModalOpen(true)}>
              <Plus className="w-4 h-4 mr-1" />
              Create Inspection Lot
            </Button>
          )}

          {activeTab === 'PLANS' && (
            <Button variant="primary" onClick={() => setIsPlanModalOpen(true)}>
              <Plus className="w-4 h-4 mr-1" />
              Create Inspection Plan
            </Button>
          )}
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-slate-200 gap-6 text-sm font-semibold">
        <button
          onClick={() => setActiveTab('LOTS')}
          className={`pb-3 flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === 'LOTS' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <ListFilter className="w-4 h-4" />
          Inspection Lots ({lots.length})
        </button>
        <button
          onClick={() => setActiveTab('PLANS')}
          className={`pb-3 flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === 'PLANS' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          Inspection Plans ({plans.length})
        </button>
        <button
          onClick={() => setActiveTab('NCR')}
          className={`pb-3 flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === 'NCR' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <AlertTriangle className="w-4 h-4" />
          Non-Conformance Reports (NCR) ({ncrs.length})
        </button>
        <button
          onClick={() => setActiveTab('COA')}
          className={`pb-3 flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === 'COA' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <FileCheck2 className="w-4 h-4" />
          Certificates of Analysis (CoA) ({coas.length})
        </button>
      </div>

      {/* Tab Contents */}
      {activeTab === 'LOTS' && (
        <Card>
          <Table data={lots} columns={lotColumns} keyExtractor={(r) => r.id} isLoading={loading} error={loadError} onRetry={loadData} emptyMessage="No quality inspection lots found." />
        </Card>
      )}

      {activeTab === 'PLANS' && (
        <Card>
          <Table data={plans} columns={planColumns} keyExtractor={(r) => r.id} isLoading={loading} error={loadError} onRetry={loadData} emptyMessage="No quality inspection plans configured." />
        </Card>
      )}

      {activeTab === 'NCR' && (
        <Card>
          <Table data={ncrs} columns={ncrColumns} keyExtractor={(r) => r.id} isLoading={loading} error={loadError} onRetry={loadData} emptyMessage="No non-conformance reports on record." />
        </Card>
      )}

      {activeTab === 'COA' && (
        <Card>
          <Table data={coas} columns={coaColumns} keyExtractor={(r) => r.id} isLoading={loading} error={loadError} onRetry={loadData} emptyMessage="No Certificates of Analysis issued yet." />
        </Card>
      )}

      {/* Create Inspection Plan Drawer */}
      <Drawer isOpen={isPlanModalOpen} onClose={() => setIsPlanModalOpen(false)} title="Create Quality Inspection Plan">
        <form onSubmit={handleCreatePlan} className="space-y-4">
          {errorMsg && <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg">{errorMsg}</div>}
          <div className="grid grid-cols-2 gap-4">
            <Input label="Plan Code" value={planCode} onChange={(e) => setPlanCode(e.target.value)} placeholder="QP-STEEL-01" required />
            <Input label="Plan Name" value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder="Steel Tensile & Purity Standard" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Catalog Item / Material</label>
            <Combobox aria-label="Catalog Item / Material"
              className="w-full"
              value={planItemId}
              onChange={(e) => setPlanItemId(e.target.value)}
              required
            >
              {items.map((it) => (
                <option key={it.id} value={it.id}>{it.code} - {it.name}</option>
              ))}
            </Combobox>
          </div>
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
            <h4 className="text-xs font-bold text-slate-700 uppercase">Primary Test Parameter</h4>
            <div className="grid grid-cols-4 gap-3">
              <Input label="Parameter" value={paramName} onChange={(e) => setParamName(e.target.value)} required />
              <Input label="Min Tolerance" value={paramMin} onChange={(e) => setParamMin(e.target.value)} required />
              <Input label="Max Tolerance" value={paramMax} onChange={(e) => setParamMax(e.target.value)} required />
              <Input label="UOM" value={paramUom} onChange={(e) => setParamUom(e.target.value)} required />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setIsPlanModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Create Inspection Plan'}</Button>
          </div>
        </form>
      </Drawer>

      {/* Create Inspection Lot Drawer */}
      <Drawer isOpen={isLotModalOpen} onClose={() => setIsLotModalOpen(false)} title="Create Quality Inspection Lot">
        <form onSubmit={handleCreateLot} className="space-y-4">
          {errorMsg && <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg">{errorMsg}</div>}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Material / Item to Inspect</label>
            <Combobox aria-label="Material / Item to Inspect"
              className="w-full"
              value={lotItemId}
              onChange={(e) => setLotItemId(e.target.value)}
              required
            >
              {items.map((it) => (
                <option key={it.id} value={it.id}>{it.code} - {it.name}</option>
              ))}
            </Combobox>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Quantity" value={lotQty} onChange={(e) => setLotQty(e.target.value)} required />
            <Input label="Batch / Heat Number" value={batchNum} onChange={(e) => setBatchNum(e.target.value)} placeholder="HEAT-9921" />
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setIsLotModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Creating...' : 'Create Lot'}</Button>
          </div>
        </form>
      </Drawer>

      {/* Perform QA Inspection Drawer */}
      <Drawer isOpen={isInspectModalOpen} onClose={() => setIsInspectModalOpen(false)} title={`Perform QA: ${selectedLot?.lot_number}`}>
        <form onSubmit={handleInspectLot} className="space-y-4">
          {errorMsg && <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg">{errorMsg}</div>}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm space-y-1">
            <div><span className="text-slate-500">Material:</span> <span className="font-semibold text-slate-900">{selectedLot?.item_name}</span></div>
            <div><span className="text-slate-500">Lot Quantity:</span> <span className="font-bold text-slate-900">{selectedLot?.quantity}</span></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Measured Purity / Strength (Numeric)" value={measuredNumeric} onChange={(e) => setMeasuredNumeric(e.target.value)} required />
            <Input label="Visual / Appearance Test" value={measuredText} onChange={(e) => setMeasuredText(e.target.value)} required />
          </div>
          <Input label="Usage Decision Notes" value={inspectionNotes} onChange={(e) => setInspectionNotes(e.target.value)} placeholder="Verified within ISO 9001 quality limits" />
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setIsInspectModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Evaluating...' : 'Submit QA Decision'}</Button>
          </div>
        </form>
      </Drawer>

      {/* File NCR Drawer */}
      <Drawer isOpen={isNcrModalOpen} onClose={() => setIsNcrModalOpen(false)} title="Raise Non-Conformance Report (NCR)">
        <form onSubmit={handleCreateNcr} className="space-y-4">
          {errorMsg && <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg">{errorMsg}</div>}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Defect Severity</label>
              <Combobox aria-label="Defect Severity"
                className="w-full"
                value={defectSeverity}
                onChange={(e: any) => setDefectSeverity(e.target.value)}
              >
                <option value="MINOR">MINOR</option>
                <option value="MAJOR">MAJOR</option>
                <option value="CRITICAL">CRITICAL</option>
              </Combobox>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Recommended Disposition</label>
              <Combobox aria-label="Recommended Disposition"
                className="w-full"
                value={ncrDisposition}
                onChange={(e: any) => setNcrDisposition(e.target.value)}
              >
                <option value="SCRAP">SCRAP (Write-Off to Scrap Expense)</option>
                <option value="REWORK">REWORK</option>
                <option value="RETURN_TO_VENDOR">RETURN_TO_VENDOR</option>
                <option value="USE_AS_IS">USE_AS_IS</option>
              </Combobox>
            </div>
          </div>
          <Input label="Root Cause Analysis" value={rootCause} onChange={(e) => setRootCause(e.target.value)} placeholder="Supplier raw material impurity" required />
          <Input label="Corrective Action (CAPA)" value={correctiveAction} onChange={(e) => setCorrectiveAction(e.target.value)} placeholder="Vendor audit and batch recall" required />
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setIsNcrModalOpen(false)}>Cancel</Button>
            <Button variant="destructive" type="submit" disabled={saving}>{saving ? 'Filing NCR...' : 'Submit NCR'}</Button>
          </div>
        </form>
      </Drawer>

      {/* Issue CoA Drawer */}
      <Drawer isOpen={isCoaModalOpen} onClose={() => setIsCoaModalOpen(false)} title="Issue Certificate of Analysis (CoA)">
        <form onSubmit={handleIssueCoA} className="space-y-4">
          {errorMsg && <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg">{errorMsg}</div>}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Customer (Optional)</label>
            <Combobox aria-label="Customer (Optional)"
              className="w-full"
              value={coaCustomerId}
              onChange={(e) => setCoaCustomerId(e.target.value)}
            >
              <option value="">-- General Commercial Release --</option>
              {parties.map((p) => (
                <option key={p.id} value={p.id}>{p.code} - {p.name}</option>
              ))}
            </Combobox>
          </div>
          <Input label="Certified Quality Officer" value={certifiedBy} onChange={(e) => setCertifiedBy(e.target.value)} required />
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setIsCoaModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Issuing...' : 'Issue Verified CoA'}</Button>
          </div>
        </form>
      </Drawer>
    </div>
  );
};
