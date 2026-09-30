import React, { useState, useEffect } from 'react';
import { ApiClient } from '../api/client.js';
import { Table, Button, Input, Drawer, Badge, Card, Column, Combobox } from '@omnysync/ui';
import {
  Briefcase,
  Plus,
  RefreshCw,
  FileSpreadsheet,
  Receipt,
  Building,
} from 'lucide-react';
import {
  Project,
  CostCenter,
  BillOfQuantities,
  BOQItem,
  ProgressCertificate,
  Party,
} from '@omnysync/contracts';
import { fmtDec, fmtMoney, fmtQty } from '../lib/format.js';

interface SimpleFiscalPeriod {
  id: string;
  name: string;
  status: string;
}

export const ProjectsView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'PROJECTS' | 'COST_CENTERS' | 'BOQ' | 'CERTIFICATES'>('PROJECTS');
  const [projects, setProjects] = useState<Project[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [periods, setPeriods] = useState<SimpleFiscalPeriod[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [boqs, setBoqs] = useState<BillOfQuantities[]>([]);
  const [certificates, setCertificates] = useState<ProgressCertificate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Modals
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [isCostCenterModalOpen, setIsCostCenterModalOpen] = useState(false);
  const [isBoqModalOpen, setIsBoqModalOpen] = useState(false);
  const [isCertModalOpen, setIsCertModalOpen] = useState(false);

  // Project Form
  const [projectCode, setProjectCode] = useState('');
  const [projectName, setProjectName] = useState('');
  const [projectCustomerId, setProjectCustomerId] = useState('');
  const [projectManager, setProjectManager] = useState('');
  const [projectType] = useState<'CONSTRUCTION' | 'CONSULTING' | 'INTERNAL' | 'EPC' | 'SERVICES'>('CONSTRUCTION');
  const [contractValue, setContractValue] = useState('5000000.00');
  const [budgetedCost, setBudgetedCost] = useState('3500000.00');
  const [retentionPct, setRetentionPct] = useState('5.00');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [selectedCostCenterId, setSelectedCostCenterId] = useState('');

  // Cost Center Form
  const [ccCode, setCcCode] = useState('');
  const [ccName, setCcName] = useState('');
  const [ccType, setCcType] = useState<'OPERATIONAL' | 'PROJECT' | 'OVERHEAD'>('PROJECT');
  const [ccManager, setCcManager] = useState('');

  // BOQ Form
  const [boqNumber, setBoqNumber] = useState('');
  const [boqTitle, setBoqTitle] = useState('');
  const [boqItemCode, setBoqItemCode] = useState('CIV-001');
  const [boqItemDesc, setBoqItemDesc] = useState('Reinforced Concrete Foundation (C25/30)');
  const [boqUom, setBoqUom] = useState('M3');
  const [boqQty, setBoqQty] = useState('100.00');
  const [boqRate, setBoqRate] = useState('15000.00');

  // Certificate Form
  const [certNumber, setCertNumber] = useState('');
  const [certBoqId, setCertBoqId] = useState('');
  const [certPeriodId, setCertPeriodId] = useState('');
  const [certBoqItemId, setCertBoqItemId] = useState('');
  const [certCurrentQty, setCertCurrentQty] = useState('25.00');

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const loadData = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [prjRes, ccRes, partiesRes, perRes] = await Promise.all([
        ApiClient.get('/projects'),
        ApiClient.get('/projects/cost-centers'),
        ApiClient.get('/parties'),
        ApiClient.get('/finance/periods'),
      ]);

      const prjList = (prjRes as any).data || [];
      setProjects(prjList);
      setCostCenters((ccRes as any).data || []);
      setParties((partiesRes as any).data || []);
      setPeriods((perRes as any).data || []);

      if (prjList.length > 0 && !selectedProjectId) {
        setSelectedProjectId(prjList[0].id);
      }
    } catch (err: any) {
      setLoadError(err instanceof Error ? err.message : String(err));
      console.error('Failed to load project data:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadProjectDetails = async (projectId: string) => {
    if (!projectId) return;
    try {
      const [boqRes, certRes] = await Promise.all([
        ApiClient.get(`/projects/${projectId}/boq`),
        ApiClient.get(`/projects/${projectId}/certificates`),
      ]);
      setBoqs((boqRes as any).data || []);
      setCertificates((certRes as any).data || []);
    } catch (err) {
      console.error('Failed to load project details:', err);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (selectedProjectId) {
      loadProjectDetails(selectedProjectId);
    }
  }, [selectedProjectId]);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg('');
    try {
      await ApiClient.post('/projects', {
        code: projectCode,
        name: projectName,
        customer_id: projectCustomerId || undefined,
        manager_name: projectManager || undefined,
        project_type: projectType,
        contract_value: contractValue,
        budgeted_cost: budgetedCost,
        retention_percentage: retentionPct,
        start_date: startDate,
        cost_center_id: selectedCostCenterId || undefined,
      });
      setIsProjectModalOpen(false);
      setProjectCode('');
      setProjectName('');
      loadData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create project');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateCostCenter = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg('');
    try {
      await ApiClient.post('/projects/cost-centers', {
        code: ccCode,
        name: ccName,
        cost_center_type: ccType,
        manager_name: ccManager || undefined,
      });
      setIsCostCenterModalOpen(false);
      setCcCode('');
      setCcName('');
      loadData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create cost center');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateBOQ = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId) return;
    setSaving(true);
    setErrorMsg('');
    try {
      await ApiClient.post(`/projects/${selectedProjectId}/boq`, {
        boq_number: boqNumber,
        title: boqTitle,
        version: '1.0',
        items: [
          {
            item_code: boqItemCode,
            description: boqItemDesc,
            uom: boqUom,
            contract_quantity: boqQty,
            unit_rate: boqRate,
          },
        ],
      });
      setIsBoqModalOpen(false);
      setBoqNumber('');
      setBoqTitle('');
      loadProjectDetails(selectedProjectId);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create BOQ');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateCertificate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId || !certBoqId || !certPeriodId || !certBoqItemId) {
      setErrorMsg('Please select BOQ, Fiscal Period, and BOQ Item');
      return;
    }
    setSaving(true);
    setErrorMsg('');
    try {
      await ApiClient.post(`/projects/${selectedProjectId}/certificates`, {
        certificate_number: certNumber,
        boq_id: certBoqId,
        period_id: certPeriodId,
        items: [
          {
            boq_item_id: certBoqItemId,
            current_quantity: certCurrentQty,
          },
        ],
      });
      setIsCertModalOpen(false);
      setCertNumber('');
      loadProjectDetails(selectedProjectId);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create Progress Certificate');
    } finally {
      setSaving(false);
    }
  };

  const handleCertify = async (certId: string) => {
    try {
      await ApiClient.post(`/projects/${selectedProjectId}/certificates/${certId}/certify`, {});
      loadProjectDetails(selectedProjectId);
    } catch (err: any) {
      alert(`Certify Error: ${err.message}`);
    }
  };

  const handleGenerateInvoice = async (certId: string) => {
    try {
      await ApiClient.post(`/projects/${selectedProjectId}/certificates/${certId}/generate-invoice`, {});
      alert('Balanced GL Progress Invoice generated and posted successfully!');
      loadProjectDetails(selectedProjectId);
    } catch (err: any) {
      alert(`Invoice Generation Error: ${err.message}`);
    }
  };

  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  const projectColumns: Column<Project>[] = [
    {
      key: 'code',
      header: 'Code',
      render: (p) => <span className="font-mono font-medium text-indigo-600">{p.code}</span>,
    },
    {
      key: 'name',
      header: 'Project Name',
      render: (p) => <span className="font-medium text-slate-900">{p.name}</span>,
    },
    {
      key: 'type',
      header: 'Type',
      render: (p) => <Badge variant="neutral">{p.project_type}</Badge>,
    },
    {
      key: 'customer',
      header: 'Customer',
      render: (p) => <span>{p.customer_name || 'Internal'}</span>,
    },
    {
      key: 'cost_center',
      header: 'Cost Center',
      render: (p) => <span>{p.cost_center_name || 'N/A'}</span>,
    },
    {
      key: 'contract_value',
      header: 'Contract Value',
      align: 'right',
      render: (p) => <span>PKR {fmtMoney(p.contract_value)}</span>,
    },
    {
      key: 'budgeted_cost',
      header: 'Budget Cost',
      align: 'right',
      render: (p) => <span>PKR {fmtMoney(p.budgeted_cost)}</span>,
    },
    {
      key: 'retention',
      header: 'Retention %',
      align: 'center',
      render: (p) => <span>{fmtDec(p.retention_percentage, 1)}%</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (p) => (
        <Badge variant={p.status === 'APPROVED' || p.status === 'IN_PROGRESS' ? 'success' : 'neutral'}>
          {p.status}
        </Badge>
      ),
    },
  ];

  const costCenterColumns: Column<CostCenter>[] = [
    {
      key: 'code',
      header: 'Code',
      render: (cc) => <span className="font-mono font-medium text-indigo-600">{cc.code}</span>,
    },
    {
      key: 'name',
      header: 'Cost Center Name',
      render: (cc) => <span className="font-medium text-slate-900">{cc.name}</span>,
    },
    {
      key: 'type',
      header: 'Type',
      render: (cc) => <Badge variant={cc.cost_center_type === 'PROJECT' ? 'success' : 'neutral'}>{cc.cost_center_type}</Badge>,
    },
    {
      key: 'manager',
      header: 'Manager',
      render: (cc) => <span>{cc.manager_name || 'N/A'}</span>,
    },
  ];

  const boqItemColumns: Column<BOQItem>[] = [
    {
      key: 'item_code',
      header: 'Item Code',
      render: (bi) => <span className="font-mono font-medium text-indigo-600">{bi.item_code}</span>,
    },
    {
      key: 'description',
      header: 'Description',
      render: (bi) => <span>{bi.description}</span>,
    },
    {
      key: 'uom',
      header: 'UOM',
      render: (bi) => <span>{bi.uom}</span>,
    },
    {
      key: 'qty',
      header: 'Contract Qty',
      align: 'right',
      render: (bi) => <span>{fmtDec(bi.contract_quantity, 2)}</span>,
    },
    {
      key: 'rate',
      header: 'Unit Rate (PKR)',
      align: 'right',
      render: (bi) => <span>{fmtMoney(bi.unit_rate)}</span>,
    },
    {
      key: 'total',
      header: 'Total Amount (PKR)',
      align: 'right',
      render: (bi) => <span>{fmtMoney(bi.total_amount)}</span>,
    },
    {
      key: 'certified_qty',
      header: 'Certified Qty',
      align: 'right',
      render: (bi) => <span className="font-semibold text-emerald-600">{fmtDec(bi.certified_quantity, 2)}</span>,
    },
  ];

  const certColumns: Column<ProgressCertificate>[] = [
    {
      key: 'cert_num',
      header: 'Cert #',
      render: (cert) => <span className="font-mono font-medium text-indigo-600">{cert.certificate_number}</span>,
    },
    {
      key: 'date',
      header: 'Date',
      render: (cert) => <span>{cert.certificate_date}</span>,
    },
    {
      key: 'gross',
      header: 'Gross Certified',
      align: 'right',
      render: (cert) => <span>PKR {fmtMoney(cert.gross_certified_amount)}</span>,
    },
    {
      key: 'retention',
      header: 'Retention Withheld',
      align: 'right',
      render: (cert) => (
        <span className="text-amber-600 font-medium">
          PKR {fmtMoney(cert.retention_amount)}
        </span>
      ),
    },
    {
      key: 'net',
      header: 'Net Billable',
      align: 'right',
      render: (cert) => (
        <span className="text-emerald-700 font-bold">
          PKR {fmtMoney(cert.net_certified_amount)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (cert) => (
        <Badge
          variant={
            cert.status === 'INVOICED'
              ? 'success'
              : cert.status === 'CERTIFIED'
              ? 'warning'
              : 'neutral'
          }
        >
          {cert.status}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (cert) => (
        <div className="flex items-center gap-2">
          {cert.status === 'DRAFT' && (
            <Button size="sm" variant="primary" onClick={() => handleCertify(cert.id)}>
              Certify IPC
            </Button>
          )}
          {cert.status === 'CERTIFIED' && (
            <Button size="sm" variant="primary" onClick={() => handleGenerateInvoice(cert.id)}>
              Post GL Progress Invoice
            </Button>
          )}
          {cert.status === 'INVOICED' && (
            <span className="text-xs text-slate-500 font-mono">GL Invoiced ✓</span>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 bg-indigo-50 text-indigo-700 rounded-lg">
              <Briefcase className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Projects & Contracts (M6)</h1>
              <p className="text-sm text-slate-500">
                Cost Centers, Bill of Quantities (BOQ), WBS Breakdown & Milestone Progress Invoicing
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={loadData} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          {activeTab === 'PROJECTS' && (
            <Button variant="primary" onClick={() => setIsProjectModalOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              New Project
            </Button>
          )}
          {activeTab === 'COST_CENTERS' && (
            <Button variant="primary" onClick={() => setIsCostCenterModalOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              New Cost Center
            </Button>
          )}
          {activeTab === 'BOQ' && (
            <Button variant="primary" onClick={() => setIsBoqModalOpen(true)} disabled={!selectedProjectId}>
              <Plus className="w-4 h-4 mr-2" />
              Create BOQ
            </Button>
          )}
          {activeTab === 'CERTIFICATES' && (
            <Button variant="primary" onClick={() => setIsCertModalOpen(true)} disabled={!selectedProjectId || boqs.length === 0}>
              <Plus className="w-4 h-4 mr-2" />
              New Progress Certificate (IPC)
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 gap-6">
        <button
          className={`pb-3 font-medium text-sm flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === 'PROJECTS'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
          onClick={() => setActiveTab('PROJECTS')}
        >
          <Briefcase className="w-4 h-4" />
          Projects Master ({projects.length})
        </button>
        <button
          className={`pb-3 font-medium text-sm flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === 'COST_CENTERS'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
          onClick={() => setActiveTab('COST_CENTERS')}
        >
          <Building className="w-4 h-4" />
          Cost Centers ({costCenters.length})
        </button>
        <button
          className={`pb-3 font-medium text-sm flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === 'BOQ'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
          onClick={() => setActiveTab('BOQ')}
        >
          <FileSpreadsheet className="w-4 h-4" />
          Bill of Quantities ({boqs.length})
        </button>
        <button
          className={`pb-3 font-medium text-sm flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === 'CERTIFICATES'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
          onClick={() => setActiveTab('CERTIFICATES')}
        >
          <Receipt className="w-4 h-4" />
          Progress Invoicing (IPC) ({certificates.length})
        </button>
      </div>

      {/* Active Tab Content */}
      {activeTab === 'PROJECTS' && (
        <Card title="Enterprise Projects Portfolio">
          <Table
            columns={projectColumns}
            data={projects}
            keyExtractor={(p) => p.id}
            isLoading={loading} error={loadError} onRetry={loadData}
            emptyMessage="No projects created yet."
          />
        </Card>
      )}

      {activeTab === 'COST_CENTERS' && (
        <Card title="Cost Centers Hierarchy">
          <Table
            columns={costCenterColumns}
            data={costCenters}
            keyExtractor={(cc) => cc.id}
            isLoading={loading} error={loadError} onRetry={loadData}
            emptyMessage="No cost centers created yet."
          />
        </Card>
      )}

      {activeTab === 'BOQ' && (
        <div className="space-y-6">
          <div className="bg-white p-4 rounded-xl border border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <label className="text-sm font-medium text-slate-700">Select Project:</label>
              <Combobox aria-label="Select Project"
                
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} - {p.name}
                  </option>
                ))}
              </Combobox>
            </div>
            {selectedProject && (
              <div className="flex items-center gap-6 text-sm">
                <div>
                  <span className="text-slate-500">Contract Value:</span>{' '}
                  <span className="font-semibold text-slate-900">
                    PKR {fmtQty(selectedProject.contract_value)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">Retention:</span>{' '}
                  <span className="font-semibold text-indigo-600">{selectedProject.retention_percentage}%</span>
                </div>
              </div>
            )}
          </div>

          {boqs.map((boq) => (
            <Card key={boq.id}>
              <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center -mx-4 -mt-4 mb-4">
                <div>
                  <span className="font-bold text-slate-900">{boq.boq_number}</span> -{' '}
                  <span className="text-slate-600">{boq.title}</span> (v{boq.version})
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-slate-700">
                    Total Amount: PKR {fmtMoney(boq.total_amount)}
                  </span>
                  <Badge variant="success">{boq.status}</Badge>
                </div>
              </div>
              <Table
                columns={boqItemColumns}
                data={boq.items || []}
                keyExtractor={(bi) => bi.id}
                emptyMessage="No BOQ line items found."
              />
            </Card>
          ))}
          {boqs.length === 0 && (
            <div className="text-center py-12 bg-white rounded-xl border border-dashed border-slate-300 text-slate-500">
              No Bill of Quantities (BOQ) created for this project yet.
            </div>
          )}
        </div>
      )}

      {activeTab === 'CERTIFICATES' && (
        <div className="space-y-6">
          <div className="bg-white p-4 rounded-xl border border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <label className="text-sm font-medium text-slate-700">Select Project:</label>
              <Combobox aria-label="Select Project"
                
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} - {p.name}
                  </option>
                ))}
              </Combobox>
            </div>
          </div>

          <Card title="Interim Payment Certificates (IPC) & Progress Billings">
            <Table
              columns={certColumns}
              data={certificates}
              keyExtractor={(cert) => cert.id}
              emptyMessage="No progress certificates recorded."
            />
          </Card>
        </div>
      )}

      {/* New Project Modal */}
      <Drawer isOpen={isProjectModalOpen} onClose={() => setIsProjectModalOpen(false)} title="Create New Project">
        <form onSubmit={handleCreateProject} className="space-y-4">
          {errorMsg && <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg">{errorMsg}</div>}
          <div className="grid grid-cols-2 gap-4">
            <Input label="Project Code" value={projectCode} onChange={(e) => setProjectCode(e.target.value)} placeholder="PRJ-2026-001" required />
            <Input label="Project Name" value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Gulberg Heights Commercial Plaza" required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Customer / Client</label>
              <Combobox aria-label="Customer / Client"
                className="w-full"
                value={projectCustomerId}
                onChange={(e) => setProjectCustomerId(e.target.value)}
              >
                <option value="">-- Internal / None --</option>
                {parties.filter((p) => p.party_type === 'CUSTOMER').map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Combobox>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Cost Center</label>
              <Combobox aria-label="Cost Center"
                className="w-full"
                value={selectedCostCenterId}
                onChange={(e) => setSelectedCostCenterId(e.target.value)}
              >
                <option value="">-- Select Cost Center --</option>
                {costCenters.map((cc) => (
                  <option key={cc.id} value={cc.id}>{cc.code} - {cc.name}</option>
                ))}
              </Combobox>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Input label="Contract Value (PKR)" value={contractValue} onChange={(e) => setContractValue(e.target.value)} required />
            <Input label="Budgeted Cost (PKR)" value={budgetedCost} onChange={(e) => setBudgetedCost(e.target.value)} required />
            <Input label="Retention %" value={retentionPct} onChange={(e) => setRetentionPct(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Project Manager" value={projectManager} onChange={(e) => setProjectManager(e.target.value)} placeholder="Engr. Bilal Khan" />
            <Input label="Start Date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setIsProjectModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Creating...' : 'Create Project'}</Button>
          </div>
        </form>
      </Drawer>

      {/* New Cost Center Modal */}
      <Drawer isOpen={isCostCenterModalOpen} onClose={() => setIsCostCenterModalOpen(false)} title="Create Cost Center">
        <form onSubmit={handleCreateCostCenter} className="space-y-4">
          {errorMsg && <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg">{errorMsg}</div>}
          <div className="grid grid-cols-2 gap-4">
            <Input label="Cost Center Code" value={ccCode} onChange={(e) => setCcCode(e.target.value)} placeholder="CC-PRJ-01" required />
            <Input label="Cost Center Name" value={ccName} onChange={(e) => setCcName(e.target.value)} placeholder="Gulberg Project Site" required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Cost Center Type</label>
              <Combobox aria-label="Cost Center Type"
                className="w-full"
                value={ccType}
                onChange={(e: any) => setCcType(e.target.value)}
              >
                <option value="PROJECT">PROJECT</option>
                <option value="OPERATIONAL">OPERATIONAL</option>
                <option value="OVERHEAD">OVERHEAD</option>
              </Combobox>
            </div>
            <Input label="Manager Name" value={ccManager} onChange={(e) => setCcManager(e.target.value)} placeholder="Manager Name" />
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setIsCostCenterModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Creating...' : 'Create Cost Center'}</Button>
          </div>
        </form>
      </Drawer>

      {/* New BOQ Modal */}
      <Drawer isOpen={isBoqModalOpen} onClose={() => setIsBoqModalOpen(false)} title="Create Bill of Quantities (BOQ)">
        <form onSubmit={handleCreateBOQ} className="space-y-4">
          {errorMsg && <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg">{errorMsg}</div>}
          <div className="grid grid-cols-2 gap-4">
            <Input label="BOQ Number" value={boqNumber} onChange={(e) => setBoqNumber(e.target.value)} placeholder="BOQ-PRJ-01" required />
            <Input label="BOQ Title" value={boqTitle} onChange={(e) => setBoqTitle(e.target.value)} placeholder="Civil & Structural Works" required />
          </div>
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
            <h4 className="font-semibold text-slate-800 text-sm">Initial Contract Item</h4>
            <div className="grid grid-cols-3 gap-3">
              <Input label="Item Code" value={boqItemCode} onChange={(e) => setBoqItemCode(e.target.value)} required />
              <Input label="UOM" value={boqUom} onChange={(e) => setBoqUom(e.target.value)} required />
              <Input label="Contract Qty" value={boqQty} onChange={(e) => setBoqQty(e.target.value)} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Unit Rate (PKR)" value={boqRate} onChange={(e) => setBoqRate(e.target.value)} required />
              <Input label="Item Description" value={boqItemDesc} onChange={(e) => setBoqItemDesc(e.target.value)} required />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setIsBoqModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save BOQ'}</Button>
          </div>
        </form>
      </Drawer>

      {/* New Progress Certificate Modal */}
      <Drawer isOpen={isCertModalOpen} onClose={() => setIsCertModalOpen(false)} title="Create Interim Payment Certificate (IPC)">
        <form onSubmit={handleCreateCertificate} className="space-y-4">
          {errorMsg && <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg">{errorMsg}</div>}
          <div className="grid grid-cols-3 gap-4">
            <Input label="Certificate Number" value={certNumber} onChange={(e) => setCertNumber(e.target.value)} placeholder="IPC-001" required />
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">BOQ</label>
              <Combobox aria-label="BOQ"
                className="w-full"
                value={certBoqId}
                onChange={(e) => {
                  setCertBoqId(e.target.value);
                  const selectedBoq = boqs.find((b) => b.id === e.target.value);
                  if (selectedBoq && selectedBoq.items && selectedBoq.items.length > 0) {
                    setCertBoqItemId(selectedBoq.items[0].id);
                  }
                }}
                required
              >
                <option value="">-- Select BOQ --</option>
                {boqs.map((b) => (
                  <option key={b.id} value={b.id}>{b.boq_number} - {b.title}</option>
                ))}
              </Combobox>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Fiscal Period</label>
              <Combobox aria-label="Fiscal Period"
                className="w-full"
                value={certPeriodId}
                onChange={(e) => setCertPeriodId(e.target.value)}
                required
              >
                <option value="">-- Select Period --</option>
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.status})</option>
                ))}
              </Combobox>
            </div>
          </div>
          {certBoqId && (
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
              <h4 className="font-semibold text-slate-800 text-sm">Measurement & Cumulative Certification</h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">BOQ Item to Certify</label>
                  <Combobox aria-label="BOQ Item to Certify"
                    className="w-full"
                    value={certBoqItemId}
                    onChange={(e) => setCertBoqItemId(e.target.value)}
                    required
                  >
                    {boqs.find((b) => b.id === certBoqId)?.items?.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.item_code} - {item.description} (Contract: {item.contract_quantity} {item.uom}, Rate: PKR {item.unit_rate})
                      </option>
                    ))}
                  </Combobox>
                </div>
                <Input label="Current Measured Qty" value={certCurrentQty} onChange={(e) => setCertCurrentQty(e.target.value)} required />
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setIsCertModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Creating...' : 'Create Certificate Draft'}</Button>
          </div>
        </form>
      </Drawer>
    </div>
  );
};
