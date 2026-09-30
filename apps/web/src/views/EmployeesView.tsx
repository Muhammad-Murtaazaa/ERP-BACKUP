import React, { useState, useEffect } from 'react';
import { ApiClient } from '../api/client.js';
import { Table, Button, Input, Drawer, Badge, Card, Combobox } from '@omnysync/ui';
import { Plus, RefreshCw, UserCheck, Briefcase, Building } from 'lucide-react';
import { Employee, Department, Designation, SalaryStructure } from '@omnysync/contracts';

export const EmployeesView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'EMPLOYEES' | 'STRUCTURES' | 'DEPARTMENTS'>('EMPLOYEES');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [structures, setStructures] = useState<SalaryStructure[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [isEmployeeModalOpen, setIsEmployeeModalOpen] = useState(false);
  const [isStructureModalOpen, setIsStructureModalOpen] = useState(false);
  const [isDeptModalOpen, setIsDeptModalOpen] = useState(false);

  // Employee Form State
  const [empNumber, setEmpNumber] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [selectedDeptId, setSelectedDeptId] = useState('');
  const [selectedDesigId, setSelectedDesigId] = useState('');
  const [selectedStructureId, setSelectedStructureId] = useState('');
  const [joiningDate, setJoiningDate] = useState(new Date().toISOString().slice(0, 10));
  const [bankName, setBankName] = useState('Meezan Bank Ltd');
  const [bankAccountNumber, setBankAccountNumber] = useState('');

  // Structure Form State
  const [structName, setStructName] = useState('');
  const [basicSalary, setBasicSalary] = useState('150000.00');
  const [houseRent, setHouseRent] = useState('60000.00');
  const [utility, setUtility] = useState('15000.00');
  const [medical, setMedical] = useState('0.00');

  // Department Form State
  const [deptCode, setDeptCode] = useState('');
  const [deptName, setDeptName] = useState('');
  const [costCenterCode, setCostCenterCode] = useState('');

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const [empData, deptData, desigData, structData] = await Promise.all([
        ApiClient.get('/hrm/employees'),
        ApiClient.get('/hrm/departments'),
        ApiClient.get('/hrm/designations'),
        ApiClient.get('/hrm/salary-structures'),
      ]);
      setEmployees(empData);
      setDepartments(deptData);
      setDesignations(desigData);
      setStructures(structData);
    } catch (err) {
      console.error('Failed to load HRM data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg('');
    try {
      await ApiClient.post('/hrm/employees', {
        employee_number: empNumber,
        first_name: firstName,
        last_name: lastName,
        email: email || undefined,
        phone: phone || undefined,
        national_id: nationalId || undefined,
        department_id: selectedDeptId || undefined,
        designation_id: selectedDesigId || undefined,
        salary_structure_id: selectedStructureId || undefined,
        joining_date: joiningDate,
        bank_name: bankName || undefined,
        bank_account_number: bankAccountNumber || undefined,
      });
      setIsEmployeeModalOpen(false);
      setEmpNumber('');
      setFirstName('');
      setLastName('');
      setEmail('');
      setPhone('');
      setNationalId('');
      setBankAccountNumber('');
      await loadData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create employee');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateStructure = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg('');
    try {
      await ApiClient.post('/hrm/salary-structures', {
        name: structName,
        currency: 'PKR',
        basic_salary: basicSalary,
        house_rent_allowance: houseRent,
        utility_allowance: utility,
        medical_allowance: medical,
        other_allowances: '0.00',
      });
      setIsStructureModalOpen(false);
      setStructName('');
      await loadData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create salary structure');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg('');
    try {
      await ApiClient.post('/hrm/departments', {
        code: deptCode,
        name: deptName,
        cost_center_code: costCenterCode || undefined,
      });
      setIsDeptModalOpen(false);
      setDeptCode('');
      setDeptName('');
      setCostCenterCode('');
      await loadData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create department');
    } finally {
      setSaving(false);
    }
  };

  const employeeColumns = [
    { key: 'emp_num', header: 'Emp #', accessor: (e: Employee) => <span className="font-mono font-bold text-blue-600">{e.employee_number}</span> },
    {
      key: 'name',
      header: 'Full Name',
      accessor: (e: Employee) => (
        <div>
          <div className="font-semibold text-gray-900">{e.first_name} {e.last_name}</div>
          <div className="text-xs text-gray-500">{e.email || 'No email'} • {e.phone || 'No phone'}</div>
        </div>
      ),
    },
    {
      key: 'dept',
      header: 'Department / Role',
      accessor: (e: Employee) => (
        <div>
          <div className="text-sm text-gray-800">{e.department_name || 'Unassigned'}</div>
          <div className="text-xs text-gray-500">{e.designation_title || 'General'}</div>
        </div>
      ),
    },
    {
      key: 'salary',
      header: 'Salary Grade',
      accessor: (e: Employee) =>
        e.salary_structure ? (
          <div>
            <div className="font-medium text-gray-900">{e.salary_structure.name}</div>
            <div className="text-xs font-mono text-emerald-700">Gross: PKR {parseFloat(e.salary_structure.gross_salary).toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
          </div>
        ) : (
          <span className="text-xs text-gray-400 italic">No structure</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      accessor: (e: Employee) => (
        <Badge variant={e.status === 'ACTIVE' ? 'success' : 'neutral'}>
          <UserCheck size={12} className="mr-1" /> {e.status}
        </Badge>
      ),
    },
  ];

  const structureColumns = [
    { key: 'name', header: 'Structure Name', accessor: (s: SalaryStructure) => <span className="font-semibold text-gray-900">{s.name}</span> },
    { key: 'basic', header: 'Basic Pay', accessor: (s: SalaryStructure) => <span className="font-mono text-gray-700">PKR {parseFloat(s.basic_salary).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span> },
    { key: 'hra', header: 'House Rent', accessor: (s: SalaryStructure) => <span className="font-mono text-gray-700">PKR {parseFloat(s.house_rent_allowance).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span> },
    { key: 'utility', header: 'Utility', accessor: (s: SalaryStructure) => <span className="font-mono text-gray-700">PKR {parseFloat(s.utility_allowance).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span> },
    {
      key: 'gross',
      header: 'Total Gross Pay',
      accessor: (s: SalaryStructure) => (
        <span className="font-mono font-bold text-emerald-700">
          PKR {parseFloat(s.gross_salary).toLocaleString('en-US', { minimumFractionDigits: 2 })}
        </span>
      ),
    },
  ];

  const deptColumns = [
    { key: 'code', header: 'Code', accessor: (d: Department) => <span className="font-mono font-bold text-blue-600">{d.code}</span> },
    { key: 'name', header: 'Department Name', accessor: (d: Department) => <span className="font-semibold text-gray-900">{d.name}</span> },
    { key: 'cost_center', header: 'Cost Center', accessor: (d: Department) => <span className="font-mono text-gray-600">{d.cost_center_code || '—'}</span> },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#202223]">Workforce & Human Resources</h1>
          <p className="text-sm text-[#6D7175]">
            Manage employees, cost-center departments, organizational designations, and salary structures.
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <Button variant="secondary" size="sm" onClick={loadData}>
            <RefreshCw size={14} className="mr-1" /> Refresh
          </Button>
          {activeTab === 'EMPLOYEES' && (
            <Button variant="primary" size="sm" onClick={() => setIsEmployeeModalOpen(true)}>
              <Plus size={14} className="mr-1" /> Onboard Employee
            </Button>
          )}
          {activeTab === 'STRUCTURES' && (
            <Button variant="primary" size="sm" onClick={() => setIsStructureModalOpen(true)}>
              <Plus size={14} className="mr-1" /> New Salary Structure
            </Button>
          )}
          {activeTab === 'DEPARTMENTS' && (
            <Button variant="primary" size="sm" onClick={() => setIsDeptModalOpen(true)}>
              <Plus size={14} className="mr-1" /> New Department
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#E1E3E5] space-x-8">
        <button
          onClick={() => setActiveTab('EMPLOYEES')}
          className={`pb-3 text-sm font-semibold border-b-2 flex items-center space-x-2 ${
            activeTab === 'EMPLOYEES'
              ? 'border-[#008060] text-[#008060]'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <UserCheck size={16} />
          <span>Employee Directory ({employees.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('STRUCTURES')}
          className={`pb-3 text-sm font-semibold border-b-2 flex items-center space-x-2 ${
            activeTab === 'STRUCTURES'
              ? 'border-[#008060] text-[#008060]'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Briefcase size={16} />
          <span>Salary Structures ({structures.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('DEPARTMENTS')}
          className={`pb-3 text-sm font-semibold border-b-2 flex items-center space-x-2 ${
            activeTab === 'DEPARTMENTS'
              ? 'border-[#008060] text-[#008060]'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Building size={16} />
          <span>Departments & Cost Centers ({departments.length})</span>
        </button>
      </div>

      {/* Content */}
      {activeTab === 'EMPLOYEES' && (
        <Card>
          <Table columns={employeeColumns} data={employees} keyExtractor={(e) => e.id} isLoading={loading} emptyMessage="No employees onboarded yet." />
        </Card>
      )}

      {activeTab === 'STRUCTURES' && (
        <Card>
          <Table columns={structureColumns} data={structures} keyExtractor={(s) => s.id} isLoading={loading} emptyMessage="No salary structures defined yet." />
        </Card>
      )}

      {activeTab === 'DEPARTMENTS' && (
        <Card>
          <Table columns={deptColumns} data={departments} keyExtractor={(d) => d.id} isLoading={loading} emptyMessage="No departments created yet." />
        </Card>
      )}

      {/* Onboard Employee Modal */}
      <Drawer isOpen={isEmployeeModalOpen} onClose={() => setIsEmployeeModalOpen(false)} title="Onboard New Employee">
        <form onSubmit={handleCreateEmployee} className="space-y-4">
          {errorMsg && <div className="p-3 text-sm text-red-700 bg-red-50 rounded border border-red-200">{errorMsg}</div>}
          <div className="grid grid-cols-3 gap-3">
            <Input label="Employee ID #" value={empNumber} onChange={(e) => setEmpNumber(e.target.value)} placeholder="EMP-001" required />
            <Input label="First Name" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Bilal" required />
            <Input label="Last Name" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Ahmed" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Official Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="bilal@omnysync.internal" />
            <Input label="Phone Number" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+92 300 1234567" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="National ID (CNIC/SSN)" value={nationalId} onChange={(e) => setNationalId(e.target.value)} placeholder="42101-1234567-1" />
            <Input label="Joining Date" type="date" value={joiningDate} onChange={(e) => setJoiningDate(e.target.value)} required />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Department</label>
              <Combobox aria-label="Department"
                value={selectedDeptId}
                onChange={(e) => setSelectedDeptId(e.target.value)}
                className="w-full"
              >
                <option value="">Select Department...</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name} ({d.code})</option>
                ))}
              </Combobox>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Designation</label>
              <Combobox aria-label="Designation"
                value={selectedDesigId}
                onChange={(e) => setSelectedDesigId(e.target.value)}
                className="w-full"
              >
                <option value="">Select Role...</option>
                {designations.map((d) => (
                  <option key={d.id} value={d.id}>{d.title}</option>
                ))}
              </Combobox>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Salary Structure</label>
              <Combobox aria-label="Salary Structure"
                value={selectedStructureId}
                onChange={(e) => setSelectedStructureId(e.target.value)}
                className="w-full"
              >
                <option value="">Select Grade...</option>
                {structures.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} (PKR {parseFloat(s.gross_salary).toLocaleString()})</option>
                ))}
              </Combobox>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Disbursement Bank" value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="Meezan Bank Ltd" />
            <Input label="Bank Account / IBAN" value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value)} placeholder="PK00MEZN..." />
          </div>
          <div className="flex justify-end space-x-3 pt-4 border-t">
            <Button variant="secondary" type="button" onClick={() => setIsEmployeeModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Onboard Employee'}</Button>
          </div>
        </form>
      </Drawer>

      {/* Salary Structure Modal */}
      <Drawer isOpen={isStructureModalOpen} onClose={() => setIsStructureModalOpen(false)} title="Create Salary Structure">
        <form onSubmit={handleCreateStructure} className="space-y-4">
          {errorMsg && <div className="p-3 text-sm text-red-700 bg-red-50 rounded border border-red-200">{errorMsg}</div>}
          <Input label="Structure Grade Name" value={structName} onChange={(e) => setStructName(e.target.value)} placeholder="Executive Grade M-2" required />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Basic Salary (PKR)" value={basicSalary} onChange={(e) => setBasicSalary(e.target.value)} required />
            <Input label="House Rent Allowance (PKR)" value={houseRent} onChange={(e) => setHouseRent(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Utility Allowance (PKR)" value={utility} onChange={(e) => setUtility(e.target.value)} />
            <Input label="Medical Allowance (PKR)" value={medical} onChange={(e) => setMedical(e.target.value)} />
          </div>
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded flex justify-between items-center">
            <span className="text-sm font-semibold text-emerald-900">Total Monthly Gross:</span>
            <span className="text-base font-bold font-mono text-emerald-800">
              PKR {(parseFloat(basicSalary || '0') + parseFloat(houseRent || '0') + parseFloat(utility || '0') + parseFloat(medical || '0')).toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex justify-end space-x-3 pt-4 border-t">
            <Button variant="secondary" type="button" onClick={() => setIsStructureModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Creating...' : 'Save Structure'}</Button>
          </div>
        </form>
      </Drawer>

      {/* Department Modal */}
      <Drawer isOpen={isDeptModalOpen} onClose={() => setIsDeptModalOpen(false)} title="Create Department">
        <form onSubmit={handleCreateDepartment} className="space-y-4">
          {errorMsg && <div className="p-3 text-sm text-red-700 bg-red-50 rounded border border-red-200">{errorMsg}</div>}
          <div className="grid grid-cols-2 gap-3">
            <Input label="Department Code" value={deptCode} onChange={(e) => setDeptCode(e.target.value)} placeholder="ENG" required />
            <Input label="Cost Center Code" value={costCenterCode} onChange={(e) => setCostCenterCode(e.target.value)} placeholder="CC-ENG-01" />
          </div>
          <Input label="Department Name" value={deptName} onChange={(e) => setDeptName(e.target.value)} placeholder="Software Engineering" required />
          <div className="flex justify-end space-x-3 pt-4 border-t">
            <Button variant="secondary" type="button" onClick={() => setIsDeptModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Creating...' : 'Save Department'}</Button>
          </div>
        </form>
      </Drawer>
    </div>
  );
};
