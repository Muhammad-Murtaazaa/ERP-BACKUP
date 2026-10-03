import React, { useState, useEffect } from 'react';
import { ApiClient } from '../api/client.js';
import { asRows } from '../lib/rows.js';
import { Table, Button, Input, Drawer, Badge, Card, Combobox } from '@omnysync/ui';
import {
  Briefcase,
  Plus,
  RefreshCw,
  FileSpreadsheet,
  Receipt,
  Layers,
  HardHat,
  Truck,
  CheckCircle2,
  TrendingUp,
  Compass,
  Clock,
  Check,
  AlertTriangle,
} from 'lucide-react';
import {
  Project,
  CostCenter,
  BillOfQuantities,
  BOQItem,
  ProgressCertificate,
  Party,
  ProjectSubcontract,
  ProjectSubcontractClaim,
  ProjectSiteDiary,
  ProjectMaterialReceipt,
  ProjectVariation,
  ProjectRFI,
  ProjectDrawing,
} from '@omnysync/contracts';
import { fmtMoney, fmtQty } from '../lib/format.js';

interface SimpleFiscalPeriod {
  id: string;
  name: string;
  status: string;
}

export const ProjectsView: React.FC = () => {
  type ActiveTab =
    | 'PROJECTS'
    | 'BOQ'
    | 'SUBCONTRACTS'
    | 'SITE_DIARY'
    | 'MATERIALS_MRN'
    | 'CHANGE_ORDERS'
    | 'TECHNICAL_DOCS';

  const [activeTab, setActiveTab] = useState<ActiveTab>('PROJECTS');
  const [projects, setProjects] = useState<Project[]>([]);
  const [, setCostCenters] = useState<CostCenter[]>([]);
  const [, setParties] = useState<Party[]>([]);
  const [periods, setPeriods] = useState<SimpleFiscalPeriod[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');

  // Core Data
  const [boqs, setBoqs] = useState<BillOfQuantities[]>([]);
  const [certificates, setCertificates] = useState<ProgressCertificate[]>([]);
  const [subcontracts, setSubcontracts] = useState<ProjectSubcontract[]>([]);
  const [selectedSubId, setSelectedSubId] = useState<string>('');
  const [subClaims, setSubClaims] = useState<ProjectSubcontractClaim[]>([]);
  const [siteDiaries, setSiteDiaries] = useState<ProjectSiteDiary[]>([]);
  const [materialReceipts, setMaterialReceipts] = useState<ProjectMaterialReceipt[]>([]);
  const [variations, setVariations] = useState<ProjectVariation[]>([]);
  const [rfis, setRfis] = useState<ProjectRFI[]>([]);
  const [drawings, setDrawings] = useState<ProjectDrawing[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Modals & Drawers
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [isBoqModalOpen, setIsBoqModalOpen] = useState(false);
  const [isCertModalOpen, setIsCertModalOpen] = useState(false);
  const [isSubcontractModalOpen, setIsSubcontractModalOpen] = useState(false);
  const [isSubClaimModalOpen, setIsSubClaimModalOpen] = useState(false);
  const [isDiaryModalOpen, setIsDiaryModalOpen] = useState(false);
  const [isMrnModalOpen, setIsMrnModalOpen] = useState(false);
  const [isVariationModalOpen, setIsVariationModalOpen] = useState(false);
  const [isRfiModalOpen, setIsRfiModalOpen] = useState(false);
  const [isDrawingModalOpen, setIsDrawingModalOpen] = useState(false);

  // Forms State
  const [projectCode, setProjectCode] = useState('');
  const [projectName, setProjectName] = useState('');
  const [projectCustomerId] = useState('');
  const [projectManager, setProjectManager] = useState('');
  const [projectType] = useState<'CONSTRUCTION' | 'CONSULTING' | 'INTERNAL' | 'EPC' | 'SERVICES'>('EPC');
  const [contractValue, setContractValue] = useState('35000000.00');
  const [budgetedCost, setBudgetedCost] = useState('24000000.00');
  const [retentionPct, setRetentionPct] = useState('5.00');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));

  // BOQ Form
  const [boqNumber, setBoqNumber] = useState('');
  const [boqTitle, setBoqTitle] = useState('');
  const [boqItemCode, setBoqItemCode] = useState('CIV-002');
  const [boqItemDesc, setBoqItemDesc] = useState('Structural Steel Framing & Decking');
  const [boqUom, setBoqUom] = useState('TON');
  const [boqQty, setBoqQty] = useState('450.00');
  const [boqRate, setBoqRate] = useState('220000.00');

  // Certificate Form
  const [certNumber, setCertNumber] = useState('');
  const [certBoqId, setCertBoqId] = useState('');
  const [certPeriodId, setCertPeriodId] = useState('');
  const [certBoqItemId, setCertBoqItemId] = useState('');
  const [certCurrentQty, setCertCurrentQty] = useState('25.00');

  // Subcontract Form
  const [subNumber, setSubNumber] = useState('SUB-2026-ELE-02');
  const [subTitle, setSubTitle] = useState('High Voltage Substation & Busway Electrical Package');
  const [subVendorId] = useState('');
  const [subValue, setSubValue] = useState('6500000.00');
  const [subRetentionPct, setSubRetentionPct] = useState('10.00');
  const [subScope, setSubScope] = useState('Full installation, testing and commissioning of 2500A power busways and switchgear.');

  // Sub Claim Form
  const [claimNumber, setClaimNumber] = useState('IPC-SUB-03');
  const [claimAmount, setClaimAmount] = useState('1200000.00');

  // Site Diary Form
  const [diaryDate, setDiaryDate] = useState(new Date().toISOString().slice(0, 10));
  const [diaryWeather, setDiaryWeather] = useState('Clear / Sunny');
  const [diaryTemp, setDiaryTemp] = useState('31°C');
  const [diaryWork, setDiaryWork] = useState('Poured 120m3 foundation raft grid 4-8. Chilled water pipe pressure test passed at 12 bar.');
  const [diaryIncidents, setDiaryIncidents] = useState('0');

  // MRN Form
  const [mrnNumber, setMrnNumber] = useState('MRN-2026-083');
  const [mrnSupplierId] = useState('');
  const [mrnItemDesc, setMrnItemDesc] = useState('Ready-Mix Concrete Grade C35/40 with Silica Fume');
  const [mrnQty, setMrnQty] = useState('60.00');
  const [mrnUom, setMrnUom] = useState('M3');
  const [mrnVehicle, setMrnVehicle] = useState('TRK-8812-KHI');
  const [mrnTicket, setMrnTicket] = useState('TKT-99124');

  // Variation Form
  const [varNumber, setVarNumber] = useState('VO-2026-003');
  const [varTitle, setVarTitle] = useState('UPS Backup Autonomy Battery Room Expansion');
  const [varType, setVarType] = useState<'CLIENT_ADDITION' | 'SITE_CONDITION' | 'DESIGN_CHANGE' | 'VALUE_ENGINEERING'>('CLIENT_ADDITION');
  const [varAmount, setVarAmount] = useState('1450000.00');
  const [varDays, setVarDays] = useState('10');
  const [varReason, setVarReason] = useState('Client requested Tier-4 runtime compliance upgrade for AI data cluster.');

  // RFI Form
  const [rfiNumber, setRfiNumber] = useState('RFI-KHI-016');
  const [rfiSubject, setRfiSubject] = useState('Conflict between 300mm Chilled Water Pipe and Cable Ladder');
  const [rfiQuestion, setRfiQuestion] = useState('Pipe clashes with tray at Level 1 Grid C-3. Confirm soffit offset to +3.1m.');
  const [rfiAssignee, setRfiAssignee] = useState('Lead MEP Consultant');

  // Drawing Form
  const [dwgNumber, setDwgNumber] = useState('MEP-DWG-305');
  const [dwgTitle, setDwgTitle] = useState('Data Hall Cold Aisle Containment & Fire Dampers');
  const [dwgDiscipline, setDwgDiscipline] = useState<'ARCHITECTURAL' | 'STRUCTURAL' | 'MEP' | 'CIVIL' | 'LANDSCAPE'>('MEP');
  const [dwgRev, setDwgRev] = useState('Rev B');

  const loadData = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [prjRes, ccRes, partiesRes, perRes] = await Promise.all([
        ApiClient.get('/projects'),
        ApiClient.get('/projects/cost-centers'),
        ApiClient.get('/parties'),
        ApiClient.get('/periods'),
      ]);

      const prjList = asRows(prjRes);
      setProjects(prjList);
      setCostCenters(asRows(ccRes));
      setParties(asRows(partiesRes));
      setPeriods(asRows(perRes));

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
      const [boqRes, certRes, subRes, diaryRes, mrnRes, varRes, rfiRes, dwgRes] =
        await Promise.all([
          ApiClient.get(`/projects/${projectId}/boq`),
          ApiClient.get(`/projects/${projectId}/certificates`),
          ApiClient.get(`/projects/${projectId}/subcontracts`),
          ApiClient.get(`/projects/${projectId}/diaries`),
          ApiClient.get(`/projects/${projectId}/material-receipts`),
          ApiClient.get(`/projects/${projectId}/variations`),
          ApiClient.get(`/projects/${projectId}/rfis`),
          ApiClient.get(`/projects/${projectId}/drawings`),
        ]);

      setBoqs(asRows(boqRes));
      setCertificates(asRows(certRes));
      const subs = asRows(subRes);
      setSubcontracts(subs);
      if (subs.length > 0 && !selectedSubId) {
        setSelectedSubId(subs[0].id);
      }
      setSiteDiaries(asRows(diaryRes));
      setMaterialReceipts(asRows(mrnRes));
      setVariations(asRows(varRes));
      setRfis(asRows(rfiRes));
      setDrawings(asRows(dwgRes));
    } catch (err) {
      console.error('Failed to load project details:', err);
    }
  };

  const loadSubClaims = async (projectId: string, subId: string) => {
    if (!projectId || !subId) return;
    try {
      const res = await ApiClient.get(`/projects/${projectId}/subcontracts/${subId}/claims`);
      setSubClaims(asRows(res));
    } catch (err) {
      console.error('Failed to load sub claims:', err);
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

  useEffect(() => {
    if (selectedProjectId && selectedSubId) {
      loadSubClaims(selectedProjectId, selectedSubId);
    }
  }, [selectedProjectId, selectedSubId]);

  // Handlers
  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
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
      });
      setIsProjectModalOpen(false);
      setProjectCode('');
      setProjectName('');
      loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to create project');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateBOQ = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId) return;
    setSaving(true);
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
      alert(err.message || 'Failed to create BOQ');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateCertificate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId || !certBoqId || !certPeriodId || !certBoqItemId) {
      alert('Please select BOQ, Fiscal Period, and BOQ Item');
      return;
    }
    setSaving(true);
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
      alert(err.message || 'Failed to create Progress Certificate');
    } finally {
      setSaving(false);
    }
  };

  const handleCertify = async (certId: string) => {
    try {
      await ApiClient.post(`/projects/${selectedProjectId}/certificates/${certId}/certify`, {});
      loadProjectDetails(selectedProjectId);
    } catch (err: any) {
      alert(err.message || 'Certification failed');
    }
  };

  const handleGenerateInvoice = async (certId: string) => {
    try {
      await ApiClient.post(`/projects/${selectedProjectId}/certificates/${certId}/generate-invoice`, {});
      loadProjectDetails(selectedProjectId);
    } catch (err: any) {
      alert(err.message || 'Failed to generate progress invoice');
    }
  };

  const handleCreateSubcontract = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId) return;
    setSaving(true);
    try {
      await ApiClient.post(`/projects/${selectedProjectId}/subcontracts`, {
        subcontract_number: subNumber,
        title: subTitle,
        vendor_id: subVendorId || undefined,
        contract_value: subValue,
        retention_percentage: subRetentionPct,
        scope_description: subScope,
      });
      setIsSubcontractModalOpen(false);
      loadProjectDetails(selectedProjectId);
    } catch (err: any) {
      alert(err.message || 'Failed to create subcontract');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateSubClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId || !selectedSubId) return;
    setSaving(true);
    try {
      await ApiClient.post(`/projects/${selectedProjectId}/subcontracts/${selectedSubId}/claims`, {
        claim_number: claimNumber,
        claimed_amount: claimAmount,
        certified_amount: claimAmount,
      });
      setIsSubClaimModalOpen(false);
      loadSubClaims(selectedProjectId, selectedSubId);
      loadProjectDetails(selectedProjectId);
    } catch (err: any) {
      alert(err.message || 'Failed to create claim');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateDiary = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId) return;
    setSaving(true);
    try {
      await ApiClient.post(`/projects/${selectedProjectId}/diaries`, {
        diary_date: diaryDate,
        weather_condition: diaryWeather,
        temperature: diaryTemp,
        work_executed: diaryWork,
        safety_incidents: parseInt(diaryIncidents) || 0,
        manpower: [
          { trade_category: 'Steel Fixers & Welders', headcount: 16, hours_worked: '8.00' },
          { trade_category: 'Electricians & Cable Pullers', headcount: 12, hours_worked: '8.00' },
          { trade_category: 'Concreters & Masons', headcount: 14, hours_worked: '8.00' },
          { trade_category: 'Plant Operators', headcount: 6, hours_worked: '8.00' },
        ],
        equipment: [
          { equipment_name: '50-Ton Mobile Crane', operating_hours: '7.50', idle_hours: '0.50', status: 'OPERATING' },
          { equipment_name: 'Concrete Boom Pump 36m', operating_hours: '6.00', idle_hours: '2.00', status: 'OPERATING' },
          { equipment_name: 'Perkins 250kVA Generator', operating_hours: '8.00', idle_hours: '0.00', status: 'OPERATING' },
        ],
      });
      setIsDiaryModalOpen(false);
      loadProjectDetails(selectedProjectId);
    } catch (err: any) {
      alert(err.message || 'Failed to save site diary');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateMRN = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId) return;
    setSaving(true);
    try {
      await ApiClient.post(`/projects/${selectedProjectId}/material-receipts`, {
        mrn_number: mrnNumber,
        supplier_id: mrnSupplierId || undefined,
        item_description: mrnItemDesc,
        received_quantity: mrnQty,
        uom: mrnUom,
        vehicle_number: mrnVehicle,
        delivery_ticket_number: mrnTicket,
        inspected_by: 'Engr. Tariq (QC Lead)',
        quality_status: 'ACCEPTED',
      });
      setIsMrnModalOpen(false);
      loadProjectDetails(selectedProjectId);
    } catch (err: any) {
      alert(err.message || 'Failed to record material receipt');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateVariation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId) return;
    setSaving(true);
    try {
      await ApiClient.post(`/projects/${selectedProjectId}/variations`, {
        variation_number: varNumber,
        title: varTitle,
        variation_type: varType,
        amount: varAmount,
        schedule_impact_days: parseInt(varDays) || 0,
        reason: varReason,
      });
      setIsVariationModalOpen(false);
      loadData();
      loadProjectDetails(selectedProjectId);
    } catch (err: any) {
      alert(err.message || 'Failed to submit variation order');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateRFI = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId) return;
    setSaving(true);
    try {
      await ApiClient.post(`/projects/${selectedProjectId}/rfis`, {
        rfi_number: rfiNumber,
        subject: rfiSubject,
        question: rfiQuestion,
        assigned_to: rfiAssignee,
      });
      setIsRfiModalOpen(false);
      loadProjectDetails(selectedProjectId);
    } catch (err: any) {
      alert(err.message || 'Failed to submit RFI');
    } finally {
      setSaving(false);
    }
  };

  const handleCloseRfi = async (rfiId: string) => {
    try {
      await ApiClient.post(`/projects/${selectedProjectId}/rfis/${rfiId}/close`, {
        response: 'Approved by Project Consultant with revised route per sketch SK-01.',
      });
      loadProjectDetails(selectedProjectId);
    } catch (err: any) {
      alert(err.message || 'Failed to close RFI');
    }
  };

  const handleCreateDrawing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId) return;
    setSaving(true);
    try {
      await ApiClient.post(`/projects/${selectedProjectId}/drawings`, {
        drawing_number: dwgNumber,
        title: dwgTitle,
        discipline: dwgDiscipline,
        revision: dwgRev,
        status: 'APPROVED_FOR_CONSTRUCTION',
      });
      setIsDrawingModalOpen(false);
      loadProjectDetails(selectedProjectId);
    } catch (err: any) {
      alert(err.message || 'Failed to register drawing');
    } finally {
      setSaving(false);
    }
  };

  const activeProject = projects.find((p) => p.id === selectedProjectId) || projects[0];

  return (
    <div className="space-y-6">
      {/* Top Header & Project Selector */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Enterprise Construction & EPC Hub
            </h1>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
              OpenConstructionERP Integrated
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Subcontractor Pay Applications (FIDIC/AIA) • Daily Site Diary • Material Receipts (MRN) • Change Orders & Technical Docs
          </p>
        </div>

        <div className="flex items-center gap-3">
          {projects.length > 0 && (
            <div className="flex items-center gap-2 bg-slate-50 p-1.5 rounded-lg border border-slate-200">
              <span className="text-xs font-semibold text-slate-600 pl-2">Active Project:</span>
              <Combobox aria-label="Active Project"
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="w-64 font-medium text-sm"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} - {p.name}
                  </option>
                ))}
              </Combobox>
            </div>
          )}

          <Button variant="secondary" onClick={() => loadData()}>
            <RefreshCw className="w-4 h-4 mr-1.5" /> Refresh
          </Button>
          <Button variant="primary" onClick={() => setIsProjectModalOpen(true)}>
            <Plus className="w-4 h-4 mr-1.5" /> New Project
          </Button>
        </div>
      </div>

      {/* KPI Highlight Strip for Active Project */}
      {activeProject && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="p-3 bg-white border border-slate-200 shadow-sm">
            <div className="text-xs text-slate-500 uppercase font-semibold">Contract Value</div>
            <div className="text-lg font-bold text-slate-900 mt-1">
              PKR {fmtMoney(activeProject.contract_value)}
            </div>
            <div className="text-xs text-emerald-600 flex items-center gap-1 mt-0.5">
              <TrendingUp className="w-3 h-3" /> Baseline + Approved VO
            </div>
          </Card>
          <Card className="p-3 bg-white border border-slate-200 shadow-sm">
            <div className="text-xs text-slate-500 uppercase font-semibold">Budgeted Cost (BAC)</div>
            <div className="text-lg font-bold text-slate-900 mt-1">
              PKR {fmtMoney(activeProject.budgeted_cost)}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">Direct cost baseline</div>
          </Card>
          <Card className="p-3 bg-white border border-slate-200 shadow-sm">
            <div className="text-xs text-slate-500 uppercase font-semibold">Retention Holdback</div>
            <div className="text-lg font-bold text-indigo-700 mt-1">
              {activeProject.retention_percentage}%
            </div>
            <div className="text-xs text-slate-500 mt-0.5">Milestone DLP release</div>
          </Card>
          <Card className="p-3 bg-white border border-slate-200 shadow-sm">
            <div className="text-xs text-slate-500 uppercase font-semibold">Safety Lost-Time (LTI)</div>
            <div className="text-lg font-bold text-emerald-600 mt-1">0 Incidents</div>
            <div className="text-xs text-slate-500 mt-0.5">180 Safe Work Days</div>
          </Card>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="border-b border-slate-200 overflow-x-auto">
        <nav className="flex space-x-2 pb-px" aria-label="Tabs">
          {[
            { id: 'PROJECTS', label: 'Commercial & WBS', icon: Briefcase },
            { id: 'BOQ', label: 'BOQ & IPC Billing', icon: FileSpreadsheet },
            { id: 'SUBCONTRACTS', label: 'Subcontractors (FIDIC/AIA)', icon: HardHat, badge: `${subcontracts.length}` },
            { id: 'SITE_DIARY', label: 'Daily Site Diary & Plant', icon: Clock, badge: `${siteDiaries.length}` },
            { id: 'MATERIALS_MRN', label: 'Site Goods Receipt (MRN)', icon: Truck, badge: `${materialReceipts.length}` },
            { id: 'CHANGE_ORDERS', label: 'Variations & Change Orders', icon: Layers, badge: `${variations.length}` },
            { id: 'TECHNICAL_DOCS', label: 'RFIs & Drawings Register', icon: Compass, badge: `${rfis.length + drawings.length}` },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as ActiveTab)}
                className={`flex items-center gap-2 py-3 px-3.5 border-b-2 font-medium text-xs whitespace-nowrap transition-colors ${
                  isActive
                    ? 'border-indigo-600 text-indigo-600 bg-indigo-50/40 rounded-t-lg'
                    : 'border-transparent text-slate-600 hover:text-slate-800 hover:border-slate-300'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-indigo-600' : 'text-slate-400'}`} />
                <span>{tab.label}</span>
                {tab.badge && (
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                      isActive ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* TAB 1: PROJECTS & WBS */}
      {activeTab === 'PROJECTS' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-base font-semibold text-slate-800">
              Active Enterprise Construction Projects
            </h3>
            <Button variant="primary" onClick={() => setIsProjectModalOpen(true)}>
              <Plus className="w-4 h-4 mr-1.5" /> Add Project
            </Button>
          </div>

          <Table<Project>
            data={projects}
            keyExtractor={(p) => p.id}
            isLoading={loading}
            error={loadError}
            onRetry={loadData}
            columns={[
              { key: 'code', header: 'Code', render: (p) => <span className="font-semibold text-slate-900">{p.code}</span> },
              {
                key: 'name',
                header: 'Project Title',
                render: (p) => (
                  <div>
                    <div className="font-medium text-slate-800">{p.name}</div>
                    <div className="text-xs text-slate-500">Mgr: {p.manager_name || 'Unassigned'} • Customer: {p.customer_name || 'Client'}</div>
                  </div>
                ),
              },
              { key: 'project_type', header: 'Contract Type', render: (p) => <Badge variant="neutral">{p.project_type}</Badge> },
              {
                key: 'contract_value',
                header: 'Contract Value',
                align: 'right',
                render: (p) => <span className="font-semibold text-slate-900">PKR {fmtMoney(p.contract_value)}</span>,
              },
              {
                key: 'budgeted_cost',
                header: 'Budgeted Cost',
                align: 'right',
                render: (p) => <span className="text-slate-700">PKR {fmtMoney(p.budgeted_cost)}</span>,
              },
              { key: 'retention_percentage', header: 'Retention %', align: 'center', render: (p) => `${p.retention_percentage}%` },
              {
                key: 'status',
                header: 'Status',
                render: (p) => <Badge variant={p.status === 'IN_PROGRESS' ? 'success' : 'neutral'}>{p.status}</Badge>,
              },
              {
                key: 'action',
                header: 'Action',
                render: (p) => (
                  <Button
                    variant={p.id === selectedProjectId ? 'primary' : 'secondary'}
                    size="sm"
                    onClick={() => setSelectedProjectId(p.id)}
                  >
                    {p.id === selectedProjectId ? 'Selected' : 'Select'}
                  </Button>
                ),
              },
            ]}
          />
        </div>
      )}

      {/* TAB 2: BOQ & PROGRESS CERTIFICATES */}
      {activeTab === 'BOQ' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-base font-semibold text-slate-800">
                Bill of Quantities (BOQ) & Contract Schedule
              </h3>
              <p className="text-xs text-slate-500">
                Hierarchical itemized contract quantities, approved unit rates and certified measurements
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setIsCertModalOpen(true)}>
                <Receipt className="w-4 h-4 mr-1.5" /> New Interim Certificate (IPC)
              </Button>
              <Button variant="primary" onClick={() => setIsBoqModalOpen(true)}>
                <Plus className="w-4 h-4 mr-1.5" /> Create BOQ
              </Button>
            </div>
          </div>

          {boqs.map((boq) => (
            <Card key={boq.id} className="p-4 bg-white border border-slate-200">
              <div className="flex justify-between items-start border-b border-slate-200 pb-3 mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900">{boq.boq_number}</span>
                    <span className="text-sm font-medium text-slate-700">— {boq.title}</span>
                    <Badge variant="success">{boq.status}</Badge>
                  </div>
                  <div className="text-xs text-slate-500 mt-1">Version {boq.version} • Managed under Project {boq.project_name}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-500">Total BOQ Amount</div>
                  <div className="text-base font-bold text-indigo-700">PKR {fmtMoney(boq.total_amount)}</div>
                </div>
              </div>

              {boq.items && boq.items.length > 0 && (
                <Table<BOQItem>
                  data={boq.items}
                  keyExtractor={(it) => it.id}
                  columns={[
                    { key: 'item_code', header: 'Item Code', render: (it) => <span className="font-mono text-xs font-bold text-slate-700">{it.item_code}</span> },
                    { key: 'description', header: 'Scope Description', render: (it) => <span className="text-slate-800">{it.description}</span> },
                    { key: 'uom', header: 'UOM', align: 'center', render: (it) => <Badge variant="neutral">{it.uom}</Badge> },
                    { key: 'contract_quantity', header: 'Contract Qty', align: 'right', render: (it) => fmtQty(it.contract_quantity) },
                    { key: 'unit_rate', header: 'Unit Rate', align: 'right', render: (it) => `PKR ${fmtMoney(it.unit_rate)}` },
                    { key: 'total_amount', header: 'Line Total', align: 'right', render: (it) => <span className="font-semibold text-slate-900">PKR {fmtMoney(it.total_amount)}</span> },
                    { key: 'certified_quantity', header: 'Certified Qty', align: 'right', render: (it) => <span className="text-emerald-700 font-semibold">{fmtQty(it.certified_quantity)}</span> },
                  ]}
                />
              )}
            </Card>
          ))}

          {/* Progress Certificates Section */}
          <div className="mt-8 space-y-4">
            <h3 className="text-base font-semibold text-slate-800">
              Interim Payment Certificates (IPC - Client Billing)
            </h3>
            <Table<ProgressCertificate>
              data={certificates}
              keyExtractor={(c) => c.id}
              columns={[
                { key: 'certificate_number', header: 'Cert #', render: (c) => <span className="font-mono font-semibold">{c.certificate_number}</span> },
                { key: 'certificate_date', header: 'Date', render: (c) => c.certificate_date },
                { key: 'gross_certified_amount', header: 'Gross Certified', align: 'right', render: (c) => `PKR ${fmtMoney(c.gross_certified_amount)}` },
                { key: 'retention_amount', header: 'Retention (5%)', align: 'right', render: (c) => <span className="text-amber-700">PKR {fmtMoney(c.retention_amount)}</span> },
                { key: 'net_certified_amount', header: 'Net Certified', align: 'right', render: (c) => <span className="font-bold text-emerald-700">PKR {fmtMoney(c.net_certified_amount)}</span> },
                { key: 'status', header: 'Status', render: (c) => <Badge variant={c.status === 'INVOICED' ? 'success' : c.status === 'CERTIFIED' ? 'warning' : 'neutral'}>{c.status}</Badge> },
                {
                  key: 'actions',
                  header: 'Actions',
                  render: (c) => (
                    <div className="flex gap-2">
                      {c.status === 'DRAFT' && (
                        <Button size="sm" variant="primary" onClick={() => handleCertify(c.id)}>Certify Qty</Button>
                      )}
                      {c.status === 'CERTIFIED' && (
                        <Button size="sm" variant="secondary" onClick={() => handleGenerateInvoice(c.id)}>Generate AR Invoice</Button>
                      )}
                      {c.status === 'INVOICED' && (
                        <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Posted to GL</span>
                      )}
                    </div>
                  ),
                },
              ]}
            />
          </div>
        </div>
      )}

      {/* TAB 3: SUBCONTRACTORS & INTERIM CLAIMS */}
      {activeTab === 'SUBCONTRACTS' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-base font-semibold text-slate-800">
                Subcontractor Packages & Interim Payment Applications (AIA / FIDIC)
              </h3>
              <p className="text-xs text-slate-500">
                Back-to-back trade subcontracts with 10% statutory retention withholding and certification workflow
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setIsSubClaimModalOpen(true)}>
                <Receipt className="w-4 h-4 mr-1.5" /> Submit Subcontractor Claim
              </Button>
              <Button variant="primary" onClick={() => setIsSubcontractModalOpen(true)}>
                <Plus className="w-4 h-4 mr-1.5" /> Award Subcontract
              </Button>
            </div>
          </div>

          <Table<ProjectSubcontract>
            data={subcontracts}
            keyExtractor={(s) => s.id}
            columns={[
              { key: 'subcontract_number', header: 'Subcontract #', render: (s) => <span className="font-mono font-bold text-slate-900">{s.subcontract_number}</span> },
              {
                key: 'title',
                header: 'Trade Package Title',
                render: (s) => (
                  <div>
                    <div className="font-semibold text-slate-800">{s.title}</div>
                    <div className="text-xs text-slate-500">Vendor: {s.vendor_name || 'Apex MEP Systems'}</div>
                  </div>
                ),
              },
              { key: 'contract_value', header: 'Contract Value', align: 'right', render: (s) => <span className="font-semibold text-slate-900">PKR {fmtMoney(s.contract_value)}</span> },
              { key: 'retention_percentage', header: 'Retention', align: 'center', render: (s) => `${s.retention_percentage}%` },
              { key: 'status', header: 'Status', render: (s) => <Badge variant="success">{s.status}</Badge> },
              {
                key: 'claims',
                header: 'Claims',
                render: (s) => (
                  <Button
                    size="sm"
                    variant={s.id === selectedSubId ? 'primary' : 'secondary'}
                    onClick={() => setSelectedSubId(s.id)}
                  >
                    View Claims
                  </Button>
                ),
              },
            ]}
          />

          {/* Subcontractor Claims List */}
          <div className="mt-8 space-y-4">
            <h4 className="text-base font-semibold text-slate-800">
              Interim Payment Applications for Selected Subcontract
            </h4>
            <Table<ProjectSubcontractClaim>
              data={subClaims}
              keyExtractor={(c) => c.id}
              columns={[
                { key: 'claim_number', header: 'Claim #', render: (c) => <span className="font-mono font-semibold">{c.claim_number}</span> },
                { key: 'period_date', header: 'Date', render: (c) => c.period_date },
                { key: 'claimed_amount', header: 'Claimed Amount', align: 'right', render: (c) => `PKR ${fmtMoney(c.claimed_amount)}` },
                { key: 'certified_amount', header: 'Certified Amount', align: 'right', render: (c) => <span className="font-semibold">PKR {fmtMoney(c.certified_amount)}</span> },
                { key: 'retention_deducted', header: 'Retention (10%)', align: 'right', render: (c) => <span className="text-amber-700">PKR {fmtMoney(c.retention_deducted)}</span> },
                { key: 'net_payable', header: 'Net Payable', align: 'right', render: (c) => <span className="font-bold text-emerald-700">PKR {fmtMoney(c.net_payable)}</span> },
                { key: 'status', header: 'Status', render: (c) => <Badge variant="success">{c.status}</Badge> },
              ]}
            />
          </div>
        </div>
      )}

      {/* TAB 5: DAILY SITE DIARY & FIELD OPERATIONS */}
      {activeTab === 'SITE_DIARY' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-base font-semibold text-slate-800">
                Daily Site Diary & Heavy Plant Equipment Logs
              </h3>
              <p className="text-xs text-slate-500">
                Site weather, shift manpower trades headcount, machine operating hours, and HSE safety records
              </p>
            </div>
            <Button variant="primary" onClick={() => setIsDiaryModalOpen(true)}>
              <Plus className="w-4 h-4 mr-1.5" /> Log Daily Site Diary
            </Button>
          </div>

          <div className="space-y-4">
            {siteDiaries.map((diary) => (
              <Card key={diary.id} className="p-4 bg-white border border-slate-200 space-y-4">
                <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2 border-b border-slate-200 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900">{diary.diary_date}</span>
                    <Badge variant="neutral">{diary.weather_condition}</Badge>
                    <Badge variant="neutral">{diary.temperature}</Badge>
                    <Badge variant="success">{diary.status}</Badge>
                  </div>
                  <div className="flex gap-4 text-xs">
                    <span className="text-slate-600 font-medium">
                      Manpower: <strong className="text-slate-900">{diary.manpower_count} workers</strong>
                    </span>
                    <span className="text-slate-600 font-medium">
                      Machinery: <strong className="text-slate-900">{diary.equipment_count} units active</strong>
                    </span>
                    <span className="text-emerald-700 font-bold">
                      HSE: {diary.safety_incidents} Incidents
                    </span>
                  </div>
                </div>

                <div>
                  <div className="text-xs font-semibold text-slate-500 uppercase">Daily Work Accomplished</div>
                  <p className="text-sm text-slate-800 mt-1">{diary.work_executed}</p>
                </div>

                {/* Manpower & Equipment Breakdown */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs">
                    <div className="font-semibold text-slate-700 mb-2">Trade Manpower Breakdown</div>
                    <div className="space-y-1 text-slate-600">
                      <div className="flex justify-between"><span>Steel Fixers & Welders:</span> <strong className="text-slate-900">16 workers (128 hrs)</strong></div>
                      <div className="flex justify-between"><span>Electricians & Cable Pullers:</span> <strong className="text-slate-900">14 workers (112 hrs)</strong></div>
                      <div className="flex justify-between"><span>Concreters & Masons:</span> <strong className="text-slate-900">12 workers (96 hrs)</strong></div>
                      <div className="flex justify-between"><span>Crane & Plant Operators:</span> <strong className="text-slate-900">6 workers (48 hrs)</strong></div>
                    </div>
                  </div>

                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs">
                    <div className="font-semibold text-slate-700 mb-2">Heavy Plant & Equipment Telematics</div>
                    <div className="space-y-1 text-slate-600">
                      <div className="flex justify-between"><span>Tadano 50-Ton Mobile Crane:</span> <strong className="text-emerald-700">7.5 hrs Operating (0.5h Idle)</strong></div>
                      <div className="flex justify-between"><span>Putzmeister Concrete Boom Pump:</span> <strong className="text-emerald-700">6.0 hrs Operating (2.0h Standby)</strong></div>
                      <div className="flex justify-between"><span>Perkins 250kVA Generator:</span> <strong className="text-emerald-700">8.0 hrs Operating (0 Breakdowns)</strong></div>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* TAB 6: SITE MATERIALS & MRN */}
      {activeTab === 'MATERIALS_MRN' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-base font-semibold text-slate-800">
                Site Materials & Goods Receipt Notes (MRN)
              </h3>
              <p className="text-xs text-slate-500">
                Gatekeeper weighbridge & delivery ticket verification with quality inspection pass/fail
              </p>
            </div>
            <Button variant="primary" onClick={() => setIsMrnModalOpen(true)}>
              <Plus className="w-4 h-4 mr-1.5" /> Receive Materials (MRN)
            </Button>
          </div>

          <Table<ProjectMaterialReceipt>
            data={materialReceipts}
            keyExtractor={(m) => m.id}
            columns={[
              { key: 'mrn_number', header: 'MRN #', render: (m) => <span className="font-mono font-bold text-slate-900">{m.mrn_number}</span> },
              { key: 'delivery_date', header: 'Delivery Date', render: (m) => m.delivery_date },
              {
                key: 'item_description',
                header: 'Material Description',
                render: (m) => (
                  <div>
                    <div className="font-medium text-slate-800">{m.item_description}</div>
                    <div className="text-xs text-slate-500">Ticket: {m.delivery_ticket_number || 'N/A'} • Vehicle: {m.vehicle_number || 'Site Gate'}</div>
                  </div>
                ),
              },
              {
                key: 'received_quantity',
                header: 'Received Qty',
                align: 'right',
                render: (m) => <span className="font-bold text-slate-900">{fmtQty(m.received_quantity)} {m.uom}</span>,
              },
              { key: 'inspected_by', header: 'Inspected By', render: (m) => m.inspected_by || 'QC Engineer' },
              {
                key: 'quality_status',
                header: 'QC Status',
                render: (m) => <Badge variant={m.quality_status === 'ACCEPTED' ? 'success' : 'danger'}>{m.quality_status}</Badge>,
              },
            ]}
          />
        </div>
      )}

      {/* TAB 7: CHANGE ORDERS & VARIATIONS */}
      {activeTab === 'CHANGE_ORDERS' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-base font-semibold text-slate-800">
                Variations & Change Orders (VO / PCO)
              </h3>
              <p className="text-xs text-slate-500">
                Contract amendments, scope adjustments, cost impacts and timeline extension approvals
              </p>
            </div>
            <Button variant="primary" onClick={() => setIsVariationModalOpen(true)}>
              <Plus className="w-4 h-4 mr-1.5" /> Submit Change Order
            </Button>
          </div>

          <Table<ProjectVariation>
            data={variations}
            keyExtractor={(v) => v.id}
            columns={[
              { key: 'variation_number', header: 'VO #', render: (v) => <span className="font-mono font-bold text-slate-900">{v.variation_number}</span> },
              {
                key: 'title',
                header: 'Title & Reason',
                render: (v) => (
                  <div>
                    <div className="font-semibold text-slate-800">{v.title}</div>
                    <div className="text-xs text-slate-500">{v.reason || 'Contract scope revision'}</div>
                  </div>
                ),
              },
              { key: 'variation_type', header: 'Type', render: (v) => <Badge variant="neutral">{v.variation_type}</Badge> },
              {
                key: 'amount',
                header: 'Cost Impact',
                align: 'right',
                render: (v) => <span className="font-bold text-emerald-700">+PKR {fmtMoney(v.amount)}</span>,
              },
              {
                key: 'schedule_impact_days',
                header: 'Time Impact',
                align: 'center',
                render: (v) => <span className="font-medium text-slate-700">+{v.schedule_impact_days} Days</span>,
              },
              { key: 'status', header: 'Status', render: (v) => <Badge variant="success">{v.status}</Badge> },
            ]}
          />
        </div>
      )}

      {/* TAB 8: TECHNICAL DOCS (RFIs & DRAWINGS) */}
      {activeTab === 'TECHNICAL_DOCS' && (
        <div className="space-y-8">
          {/* RFIs */}
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-base font-semibold text-slate-800">
                  Requests for Information (RFI)
                </h3>
                <p className="text-xs text-slate-500">
                  Engineering queries, site clash clarifications and consultant directives
                </p>
              </div>
              <Button variant="primary" onClick={() => setIsRfiModalOpen(true)}>
                <Plus className="w-4 h-4 mr-1.5" /> Raise RFI
              </Button>
            </div>

            <Table<ProjectRFI>
              data={rfis}
              keyExtractor={(r) => r.id}
              columns={[
                { key: 'rfi_number', header: 'RFI #', render: (r) => <span className="font-mono font-bold text-slate-900">{r.rfi_number}</span> },
                {
                  key: 'subject',
                  header: 'Subject & Question',
                  render: (r) => (
                    <div>
                      <div className="font-semibold text-slate-800">{r.subject}</div>
                      <div className="text-xs text-slate-600 mt-0.5">{r.question}</div>
                      {r.response && (
                        <div className="text-xs text-emerald-700 mt-1 bg-emerald-50 p-1.5 rounded border border-emerald-200">
                          <strong>Directive:</strong> {r.response}
                        </div>
                      )}
                    </div>
                  ),
                },
                { key: 'assigned_to', header: 'Assigned To', render: (r) => r.assigned_to || 'Consultant' },
                {
                  key: 'status',
                  header: 'Status',
                  render: (r) => <Badge variant={r.status === 'CLOSED' || r.status === 'ANSWERED' ? 'success' : 'warning'}>{r.status}</Badge>,
                },
                {
                  key: 'action',
                  header: 'Action',
                  render: (r) =>
                    r.status !== 'CLOSED' ? (
                      <Button size="sm" variant="secondary" onClick={() => handleCloseRfi(r.id)}>Sign-off / Close</Button>
                    ) : (
                      <span className="text-xs text-slate-400 font-semibold flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Closed</span>
                    ),
                },
              ]}
            />
          </div>

          {/* Drawings Register */}
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-base font-semibold text-slate-800">
                  Engineering Drawing Register & Revision Control
                </h3>
                <p className="text-xs text-slate-500">
                  Approved for Construction (AFC) drawings with automatic superseded warnings
                </p>
              </div>
              <Button variant="secondary" onClick={() => setIsDrawingModalOpen(true)}>
                <Plus className="w-4 h-4 mr-1.5" /> Register Drawing
              </Button>
            </div>

            <Table<ProjectDrawing>
              data={drawings}
              keyExtractor={(d) => d.id}
              columns={[
                { key: 'drawing_number', header: 'Drawing #', render: (d) => <span className="font-mono font-bold text-slate-900">{d.drawing_number}</span> },
                { key: 'title', header: 'Drawing Title', render: (d) => <span className="font-medium text-slate-800">{d.title}</span> },
                { key: 'discipline', header: 'Discipline', render: (d) => <Badge variant="neutral">{d.discipline}</Badge> },
                { key: 'revision', header: 'Revision', align: 'center', render: (d) => <span className="font-bold text-indigo-700">{d.revision}</span> },
                {
                  key: 'status',
                  header: 'Status',
                  render: (d) => (
                    <Badge variant={d.status === 'APPROVED_FOR_CONSTRUCTION' ? 'success' : 'warning'}>
                      {d.status.replace(/_/g, ' ')}
                    </Badge>
                  ),
                },
              ]}
            />
          </div>
        </div>
      )}

      {/* DRAWER: New Project */}
      <Drawer isOpen={isProjectModalOpen} onClose={() => setIsProjectModalOpen(false)} title="Create New Construction Project">
        <form onSubmit={handleCreateProject} className="space-y-4">
          <Input label="Project Code" value={projectCode} onChange={(e) => setProjectCode(e.target.value)} placeholder="e.g. PRJ-2026-002" required />
          <Input label="Project Name" value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="e.g. Islamabad Metro Terminal" required />
          <Input label="Project Manager" value={projectManager} onChange={(e) => setProjectManager(e.target.value)} placeholder="e.g. Engr. Usman Khan" />
          <Input label="Contract Value (PKR)" value={contractValue} onChange={(e) => setContractValue(e.target.value)} required />
          <Input label="Budgeted Cost (PKR)" value={budgetedCost} onChange={(e) => setBudgetedCost(e.target.value)} required />
          <Input label="Retention %" value={retentionPct} onChange={(e) => setRetentionPct(e.target.value)} required />
          <Input label="Start Date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setIsProjectModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Create Project'}</Button>
          </div>
        </form>
      </Drawer>

      {/* DRAWER: Create BOQ */}
      <Drawer isOpen={isBoqModalOpen} onClose={() => setIsBoqModalOpen(false)} title="Create Bill of Quantities (BOQ)">
        <form onSubmit={handleCreateBOQ} className="space-y-4">
          <Input label="BOQ Number" value={boqNumber} onChange={(e) => setBoqNumber(e.target.value)} placeholder="e.g. BOQ-2026-002" required />
          <Input label="BOQ Title" value={boqTitle} onChange={(e) => setBoqTitle(e.target.value)} placeholder="e.g. Substructure & Earthworks" required />
          <div className="p-3 bg-slate-50 rounded border border-slate-200 space-y-3">
            <h4 className="text-xs font-semibold text-slate-700">Initial Line Item</h4>
            <div className="grid grid-cols-2 gap-2">
              <Input label="Item Code" value={boqItemCode} onChange={(e) => setBoqItemCode(e.target.value)} required />
              <Input label="UOM" value={boqUom} onChange={(e) => setBoqUom(e.target.value)} required />
            </div>
            <Input label="Description" value={boqItemDesc} onChange={(e) => setBoqItemDesc(e.target.value)} required />
            <div className="grid grid-cols-2 gap-2">
              <Input label="Quantity" value={boqQty} onChange={(e) => setBoqQty(e.target.value)} required />
              <Input label="Unit Rate (PKR)" value={boqRate} onChange={(e) => setBoqRate(e.target.value)} required />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setIsBoqModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Creating...' : 'Create BOQ'}</Button>
          </div>
        </form>
      </Drawer>

      {/* DRAWER: New Progress Certificate */}
      <Drawer isOpen={isCertModalOpen} onClose={() => setIsCertModalOpen(false)} title="Create Interim Payment Certificate (IPC)">
        <form onSubmit={handleCreateCertificate} className="space-y-4">
          <Input label="Certificate Number" value={certNumber} onChange={(e) => setCertNumber(e.target.value)} placeholder="e.g. IPC-2026-003" required />
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Select BOQ</label>
            <Combobox aria-label="Select BOQ"
              className="w-full"
              value={certBoqId}
              onChange={(e) => {
                setCertBoqId(e.target.value);
                const selectedBoq = boqs.find((b) => b.id === e.target.value);
                if (selectedBoq?.items && selectedBoq.items.length > 0) {
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
          {certBoqId && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded space-y-3">
              <label className="block text-sm font-medium text-slate-700">BOQ Item to Certify</label>
              <Combobox aria-label="BOQ Item to Certify"
                className="w-full"
                value={certBoqItemId}
                onChange={(e) => setCertBoqItemId(e.target.value)}
                required
              >
                {boqs.find((b) => b.id === certBoqId)?.items?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.item_code} - {item.description} (Contract: {item.contract_quantity} {item.uom})
                  </option>
                ))}
              </Combobox>
              <Input label="Current Measured Qty" value={certCurrentQty} onChange={(e) => setCertCurrentQty(e.target.value)} required />
            </div>
          )}
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setIsCertModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Submitting...' : 'Create IPC'}</Button>
          </div>
        </form>
      </Drawer>

      {/* DRAWER: New Subcontract */}
      <Drawer isOpen={isSubcontractModalOpen} onClose={() => setIsSubcontractModalOpen(false)} title="Award Subcontract Package">
        <form onSubmit={handleCreateSubcontract} className="space-y-4">
          <Input label="Subcontract Number" value={subNumber} onChange={(e) => setSubNumber(e.target.value)} required />
          <Input label="Trade Title" value={subTitle} onChange={(e) => setSubTitle(e.target.value)} required />
          <Input label="Contract Value (PKR)" value={subValue} onChange={(e) => setSubValue(e.target.value)} required />
          <Input label="Retention % (Standard 10%)" value={subRetentionPct} onChange={(e) => setSubRetentionPct(e.target.value)} required />
          <Input label="Scope Description" value={subScope} onChange={(e) => setSubScope(e.target.value)} required />
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setIsSubcontractModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>Award Subcontract</Button>
          </div>
        </form>
      </Drawer>

      {/* DRAWER: New Sub Claim */}
      <Drawer isOpen={isSubClaimModalOpen} onClose={() => setIsSubClaimModalOpen(false)} title="Submit Subcontractor Claim (AIA/FIDIC)">
        <form onSubmit={handleCreateSubClaim} className="space-y-4">
          <Input label="Claim Number" value={claimNumber} onChange={(e) => setClaimNumber(e.target.value)} required />
          <Input label="Claimed Amount (PKR)" value={claimAmount} onChange={(e) => setClaimAmount(e.target.value)} required />
          <div className="p-3 bg-slate-50 border border-slate-200 rounded text-xs space-y-1">
            <div className="flex justify-between text-slate-600"><span>10% Retention Deduction:</span> <strong>PKR {fmtMoney(parseFloat(claimAmount || '0') * 0.1)}</strong></div>
            <div className="flex justify-between text-emerald-700 font-bold"><span>Net Payable:</span> <strong>PKR {fmtMoney(parseFloat(claimAmount || '0') * 0.9)}</strong></div>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setIsSubClaimModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>Approve & Issue</Button>
          </div>
        </form>
      </Drawer>

      {/* DRAWER: Daily Site Diary */}
      <Drawer isOpen={isDiaryModalOpen} onClose={() => setIsDiaryModalOpen(false)} title="Log Daily Site Diary">
        <form onSubmit={handleCreateDiary} className="space-y-4">
          <Input label="Date" type="date" value={diaryDate} onChange={(e) => setDiaryDate(e.target.value)} required />
          <div className="grid grid-cols-2 gap-2">
            <Input label="Weather" value={diaryWeather} onChange={(e) => setDiaryWeather(e.target.value)} required />
            <Input label="Temperature" value={diaryTemp} onChange={(e) => setDiaryTemp(e.target.value)} required />
          </div>
          <Input label="Work Accomplished Today" value={diaryWork} onChange={(e) => setDiaryWork(e.target.value)} required />
          <Input label="Safety / HSE Incidents (0 = Clean)" value={diaryIncidents} onChange={(e) => setDiaryIncidents(e.target.value)} required />
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setIsDiaryModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>Submit Site Log</Button>
          </div>
        </form>
      </Drawer>

      {/* DRAWER: Material Receipt Note (MRN) */}
      <Drawer isOpen={isMrnModalOpen} onClose={() => setIsMrnModalOpen(false)} title="Record Site Goods Receipt (MRN)">
        <form onSubmit={handleCreateMRN} className="space-y-4">
          <Input label="MRN Number" value={mrnNumber} onChange={(e) => setMrnNumber(e.target.value)} required />
          <Input label="Material Description" value={mrnItemDesc} onChange={(e) => setMrnItemDesc(e.target.value)} required />
          <div className="grid grid-cols-2 gap-2">
            <Input label="Quantity" value={mrnQty} onChange={(e) => setMrnQty(e.target.value)} required />
            <Input label="UOM" value={mrnUom} onChange={(e) => setMrnUom(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input label="Delivery Ticket #" value={mrnTicket} onChange={(e) => setMrnTicket(e.target.value)} />
            <Input label="Vehicle #" value={mrnVehicle} onChange={(e) => setMrnVehicle(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setIsMrnModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>Accept Delivery</Button>
          </div>
        </form>
      </Drawer>

      {/* DRAWER: Variation / Change Order */}
      <Drawer isOpen={isVariationModalOpen} onClose={() => setIsVariationModalOpen(false)} title="Submit Variation / Change Order">
        <form onSubmit={handleCreateVariation} className="space-y-4">
          <Input label="Variation Number" value={varNumber} onChange={(e) => setVarNumber(e.target.value)} required />
          <Input label="Title" value={varTitle} onChange={(e) => setVarTitle(e.target.value)} required />
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Variation Type</label>
            <Combobox aria-label="Variation Type"
              className="w-full"
              value={varType}
              onChange={(e) => setVarType(e.target.value as any)}
            >
              <option value="CLIENT_ADDITION">Client Addition</option>
              <option value="SITE_CONDITION">Site Condition</option>
              <option value="DESIGN_CHANGE">Design Change</option>
              <option value="VALUE_ENGINEERING">Value Engineering</option>
            </Combobox>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input label="Cost Impact (PKR)" value={varAmount} onChange={(e) => setVarAmount(e.target.value)} required />
            <Input label="Schedule Impact (Days)" value={varDays} onChange={(e) => setVarDays(e.target.value)} required />
          </div>
          <Input label="Technical Rationale" value={varReason} onChange={(e) => setVarReason(e.target.value)} required />
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setIsVariationModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>Approve & Update Budget</Button>
          </div>
        </form>
      </Drawer>

      {/* DRAWER: Raise RFI */}
      <Drawer isOpen={isRfiModalOpen} onClose={() => setIsRfiModalOpen(false)} title="Raise Request for Information (RFI)">
        <form onSubmit={handleCreateRFI} className="space-y-4">
          <Input label="RFI Number" value={rfiNumber} onChange={(e) => setRfiNumber(e.target.value)} required />
          <Input label="Subject" value={rfiSubject} onChange={(e) => setRfiSubject(e.target.value)} required />
          <Input label="Question / Technical Query" value={rfiQuestion} onChange={(e) => setRfiQuestion(e.target.value)} required />
          <Input label="Assign To" value={rfiAssignee} onChange={(e) => setRfiAssignee(e.target.value)} required />
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setIsRfiModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>Submit RFI</Button>
          </div>
        </form>
      </Drawer>

      {/* DRAWER: Register Drawing */}
      <Drawer isOpen={isDrawingModalOpen} onClose={() => setIsDrawingModalOpen(false)} title="Register Engineering Drawing">
        <form onSubmit={handleCreateDrawing} className="space-y-4">
          <Input label="Drawing Number" value={dwgNumber} onChange={(e) => setDwgNumber(e.target.value)} required />
          <Input label="Drawing Title" value={dwgTitle} onChange={(e) => setDwgTitle(e.target.value)} required />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Discipline</label>
              <Combobox aria-label="Discipline"
                className="w-full"
                value={dwgDiscipline}
                onChange={(e) => setDwgDiscipline(e.target.value as any)}
              >
                <option value="STRUCTURAL">Structural</option>
                <option value="MEP">MEP</option>
                <option value="ARCHITECTURAL">Architectural</option>
                <option value="CIVIL">Civil</option>
              </Combobox>
            </div>
            <Input label="Revision" value={dwgRev} onChange={(e) => setDwgRev(e.target.value)} required />
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setIsDrawingModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>Register Drawing</Button>
          </div>
        </form>
      </Drawer>
    </div>
  );
};
