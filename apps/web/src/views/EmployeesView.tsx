import React, { useState, useEffect } from 'react';
import { ApiClient } from '../api/client.js';
import { Table, Button, Input, Drawer, Badge, Card, Combobox } from '@omnysync/ui';
import { Plus, RefreshCw, UserCheck, Briefcase, Building, Wallet, MapPin, Calendar } from 'lucide-react';
import { Employee, Department, Designation, SalaryStructure } from '@omnysync/contracts';
import { fmtMoney, fmtQty, sumDec } from '../lib/format.js';

export const EmployeesView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'EMPLOYEES' | 'ADVANCES' | 'ATTENDANCE' | 'LEAVES' | 'STRUCTURES' | 'DEPARTMENTS'>('EMPLOYEES');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [structures, setStructures] = useState<SalaryStructure[]>([]);
  const [advances, setAdvances] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [leaveAllocations, setLeaveAllocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Modals
  const [isEmployeeModalOpen, setIsEmployeeModalOpen] = useState(false);
  const [isStructureModalOpen, setIsStructureModalOpen] = useState(false);
  const [isDeptModalOpen, setIsDeptModalOpen] = useState(false);
  const [isAdvanceModalOpen, setIsAdvanceModalOpen] = useState(false);

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

  // Advance Form State
  const [advEmployeeId, setAdvEmployeeId] = useState('');
  const [advType, setAdvType] = useState('CASH');
  const [advAmount, setAdvAmount] = useState('25000');
  const [advPurpose, setAdvPurpose] = useState('');
  const [advMonths, setAdvMonths] = useState(1);

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
    setLoadError(null);
    try {
      const [empData, deptData, desigData, structData, advData, attData, leaveData] = await Promise.all([
        ApiClient.get('/hrm/employees').catch(() => []),
        ApiClient.get('/hrm/departments').catch(() => []),
        ApiClient.get('/hrm/designations').catch(() => []),
        ApiClient.get('/hrm/salary-structures').catch(() => []),
        ApiClient.get('/hrm/advances').catch(() => []),
        ApiClient.get('/hrm/attendance').catch(() => []),
        ApiClient.get('/hrm/leave-allocations').catch(() => []),
      ]);
      setEmployees(empData);
      setDepartments(deptData);
      setDesignations(desigData);
      setStructures(structData);
      setAdvances(advData);
      setAttendance(attData);
      setLeaveAllocations(leaveData);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
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
      setNationalId('');
      setBankAccountNumber('');
      await loadData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create employee');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateAdvance = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg('');
    try {
      await ApiClient.post('/hrm/advances', {
        employee_id: advEmployeeId,
        advance_type: advType,
        amount: advAmount,
        purpose: advPurpose,
        repayment_months: advMonths,
      });
      setIsAdvanceModalOpen(false);
      setAdvPurpose('');
      await loadData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to request advance');
    } finally {
      setSaving(false);
    }
  };

  const handleApproveAdvance = async (id: string) => {
    try {
      await ApiClient.post(`/hrm/advances/${id}/approve`, {});
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to approve advance');
    }
  };

  const handleDisburseAdvance = async (id: string) => {
    try {
      await ApiClient.post(`/hrm/advances/${id}/disburse`, {});
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to disburse advance');
    }
  };

  const handleQuickCheckIn = async (employeeId: string) => {
    try {
      await ApiClient.post('/hrm/attendance/check-in', {
        employee_id: employeeId,
        latitude: 24.8607,
        longitude: 67.0011,
        verification_method: 'GEOFENCE',
        notes: 'Quick Web Check-In',
      });
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Check-in failed');
    }
  };

  const handleQuickCheckOut = async (employeeId: string) => {
    try {
      await ApiClient.post('/hrm/attendance/check-out', {
        employee_id: employeeId,
      });
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Check-out failed');
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
            <div className="text-xs font-mono text-emerald-700">Gross: PKR {fmtMoney(e.salary_structure.gross_salary)}</div>
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
    {
      key: 'actions',
      header: 'Attendance Quick-Punch',
      accessor: (e: Employee) => (
        <div className="flex space-x-2">
          <Button size="sm" variant="secondary" onClick={() => handleQuickCheckIn(e.id)}>In</Button>
          <Button size="sm" variant="quiet" onClick={() => handleQuickCheckOut(e.id)}>Out</Button>
        </div>
      ),
    },
  ];

  const advanceColumns = [
    { key: 'num', header: 'Advance #', accessor: (a: any) => <span className="font-mono font-bold text-blue-600">{a.number}</span> },
    { key: 'emp', header: 'Employee', accessor: (a: any) => <div><div className="font-semibold">{a.employee_name}</div><div className="text-xs text-gray-500">{a.employee_number}</div></div> },
    { key: 'type', header: 'Type', accessor: (a: any) => <Badge variant="neutral">{a.advance_type}</Badge> },
    { key: 'amount', header: 'Amount', accessor: (a: any) => <span className="font-mono font-bold">PKR {fmtMoney(a.amount)}</span> },
    { key: 'balance', header: 'Remaining Balance', accessor: (a: any) => <span className="font-mono text-amber-700 font-semibold">PKR {fmtMoney(a.balance_amount)}</span> },
    {
      key: 'status',
      header: 'Status',
      accessor: (a: any) => (
        <Badge variant={a.status === 'DISBURSED' ? 'success' : a.status === 'APPROVED' ? 'info' : 'neutral'}>
          {a.status}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      accessor: (a: any) => (
        <div className="flex space-x-2">
          {a.status === 'DRAFT' && (
            <Button size="sm" variant="primary" onClick={() => handleApproveAdvance(a.id)}>Approve</Button>
          )}
          {a.status === 'APPROVED' && (
            <Button size="sm" variant="primary" onClick={() => handleDisburseAdvance(a.id)}>Disburse GL</Button>
          )}
        </div>
      ),
    },
  ];

  const attendanceColumns = [
    { key: 'date', header: 'Date', accessor: (att: any) => <span className="font-mono font-semibold">{att.work_date?.slice(0, 10)}</span> },
    { key: 'emp', header: 'Employee', accessor: (att: any) => <div><div className="font-semibold">{att.employee_name}</div><div className="text-xs text-gray-500">{att.employee_number}</div></div> },
    { key: 'checkin', header: 'Check In', accessor: (att: any) => <span className="text-xs font-mono">{att.check_in_time ? new Date(att.check_in_time).toLocaleTimeString() : '-'}</span> },
    { key: 'checkout', header: 'Check Out', accessor: (att: any) => <span className="text-xs font-mono">{att.check_out_time ? new Date(att.check_out_time).toLocaleTimeString() : '-'}</span> },
    { key: 'hours', header: 'Total Hours', accessor: (att: any) => <span className="font-mono font-bold">{att.total_hours} hrs</span> },
    {
      key: 'geo',
      header: 'Geofence Status',
      accessor: (att: any) => (
        <Badge variant={att.geofence_status === 'INSIDE_GEOFENCE' ? 'success' : 'warning'}>
          <MapPin size={12} className="mr-1" /> {att.geofence_status}
        </Badge>
      ),
    },
    { key: 'status', header: 'Verification', accessor: (att: any) => <Badge variant="neutral">{att.verification_method}</Badge> },
  ];

  const leaveColumns = [
    { key: 'emp', header: 'Employee', accessor: (la: any) => <div><div className="font-semibold">{la.employee_name}</div><div className="text-xs text-gray-500">{la.employee_number}</div></div> },
    { key: 'type', header: 'Leave Type', accessor: (la: any) => <Badge variant="neutral">{la.leave_type_name}</Badge> },
    { key: 'year', header: 'Year', accessor: (la: any) => <span className="font-mono">{la.year}</span> },
    { key: 'alloc', header: 'Allocated', accessor: (la: any) => <span className="font-mono font-bold">{la.allocated_days} days</span> },
    { key: 'used', header: 'Used', accessor: (la: any) => <span className="font-mono text-amber-700">{la.used_days} days</span> },
    { key: 'rem', header: 'Remaining Balance', accessor: (la: any) => <span className="font-mono font-bold text-emerald-700">{la.remaining_days} days</span> },
  ];

  const structureColumns = [
    { key: 'name', header: 'Grade Title', accessor: (s: SalaryStructure) => <span className="font-bold text-gray-900">{s.name}</span> },
    { key: 'basic', header: 'Basic Salary', accessor: (s: SalaryStructure) => <span className="font-mono">PKR {fmtMoney(s.basic_salary)}</span> },
    { key: 'hra', header: 'House Rent', accessor: (s: SalaryStructure) => <span className="font-mono">PKR {fmtMoney(s.house_rent_allowance)}</span> },
    { key: 'util', header: 'Utility Allowance', accessor: (s: SalaryStructure) => <span className="font-mono">PKR {fmtMoney(s.utility_allowance)}</span> },
    { key: 'gross', header: 'Total Gross', accessor: (s: SalaryStructure) => <span className="font-mono font-bold text-emerald-700">PKR {fmtMoney(s.gross_salary)}</span> },
  ];

  const deptColumns = [
    { key: 'code', header: 'Code', accessor: (d: Department) => <span className="font-mono font-bold text-blue-600">{d.code}</span> },
    { key: 'name', header: 'Department Name', accessor: (d: Department) => <span className="font-semibold text-gray-900">{d.name}</span> },
    { key: 'cc', header: 'Cost Center', accessor: (d: Department) => <span className="font-mono text-gray-600">{d.cost_center_code || 'N/A'}</span> },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Workforce, HRM & Field Operations</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage employee master data, staff advances, geofence attendance, and leave quotas
          </p>
        </div>
        <div className="flex space-x-3">
          <Button variant="secondary" onClick={loadData} disabled={loading}>
            <RefreshCw size={16} className={`mr-2 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          {activeTab === 'EMPLOYEES' && (
            <Button variant="primary" onClick={() => setIsEmployeeModalOpen(true)}>
              <Plus size={16} className="mr-2" /> Onboard Employee
            </Button>
          )}
          {activeTab === 'ADVANCES' && (
            <Button variant="primary" onClick={() => setIsAdvanceModalOpen(true)}>
              <Wallet size={16} className="mr-2" /> Request Advance
            </Button>
          )}
          {activeTab === 'STRUCTURES' && (
            <Button variant="primary" onClick={() => setIsStructureModalOpen(true)}>
              <Plus size={16} className="mr-2" /> Add Structure
            </Button>
          )}
          {activeTab === 'DEPARTMENTS' && (
            <Button variant="primary" onClick={() => setIsDeptModalOpen(true)}>
              <Plus size={16} className="mr-2" /> Add Department
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex space-x-2 border-b border-gray-200 pb-2">
        <button
          onClick={() => setActiveTab('EMPLOYEES')}
          className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors flex items-center ${activeTab === 'EMPLOYEES' ? 'bg-[#5940B8] text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'}`}
        >
          <UserCheck size={16} className="mr-2" /> Employees ({employees.length})
        </button>
        <button
          onClick={() => setActiveTab('ADVANCES')}
          className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors flex items-center ${activeTab === 'ADVANCES' ? 'bg-[#5940B8] text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'}`}
        >
          <Wallet size={16} className="mr-2" /> Advances ({advances.length})
        </button>
        <button
          onClick={() => setActiveTab('ATTENDANCE')}
          className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors flex items-center ${activeTab === 'ATTENDANCE' ? 'bg-[#5940B8] text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'}`}
        >
          <MapPin size={16} className="mr-2" /> Geofence Attendance ({attendance.length})
        </button>
        <button
          onClick={() => setActiveTab('LEAVES')}
          className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors flex items-center ${activeTab === 'LEAVES' ? 'bg-[#5940B8] text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'}`}
        >
          <Calendar size={16} className="mr-2" /> Leave Allocations ({leaveAllocations.length})
        </button>
        <button
          onClick={() => setActiveTab('STRUCTURES')}
          className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors flex items-center ${activeTab === 'STRUCTURES' ? 'bg-[#5940B8] text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'}`}
        >
          <Briefcase size={16} className="mr-2" /> Salary Grades ({structures.length})
        </button>
        <button
          onClick={() => setActiveTab('DEPARTMENTS')}
          className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors flex items-center ${activeTab === 'DEPARTMENTS' ? 'bg-[#5940B8] text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'}`}
        >
          <Building size={16} className="mr-2" /> Departments ({departments.length})
        </button>
      </div>

      {/* Main Content */}
      {activeTab === 'EMPLOYEES' && (
        <Card>
          <Table columns={employeeColumns} data={employees} keyExtractor={(e) => e.id} isLoading={loading} error={loadError} onRetry={loadData} emptyMessage="No employees found." />
        </Card>
      )}

      {activeTab === 'ADVANCES' && (
        <Card>
          <Table columns={advanceColumns} data={advances} keyExtractor={(a) => a.id} isLoading={loading} error={loadError} onRetry={loadData} emptyMessage="No staff advances requested." />
        </Card>
      )}

      {activeTab === 'ATTENDANCE' && (
        <Card>
          <Table columns={attendanceColumns} data={attendance} keyExtractor={(att) => att.id} isLoading={loading} error={loadError} onRetry={loadData} emptyMessage="No attendance logs recorded for today." />
        </Card>
      )}

      {activeTab === 'LEAVES' && (
        <Card>
          <Table columns={leaveColumns} data={leaveAllocations} keyExtractor={(la) => la.id} isLoading={loading} error={loadError} onRetry={loadData} emptyMessage="No leave allocations found." />
        </Card>
      )}

      {activeTab === 'STRUCTURES' && (
        <Card>
          <Table columns={structureColumns} data={structures} keyExtractor={(s) => s.id} isLoading={loading} error={loadError} onRetry={loadData} emptyMessage="No salary structures defined yet." />
        </Card>
      )}

      {activeTab === 'DEPARTMENTS' && (
        <Card>
          <Table columns={deptColumns} data={departments} keyExtractor={(d) => d.id} isLoading={loading} error={loadError} onRetry={loadData} emptyMessage="No departments created yet." />
        </Card>
      )}

      {/* Onboard Employee Drawer */}
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
                  <option key={s.id} value={s.id}>{s.name} (PKR {fmtQty(s.gross_salary)})</option>
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

      {/* Staff Advance Drawer */}
      <Drawer isOpen={isAdvanceModalOpen} onClose={() => setIsAdvanceModalOpen(false)} title="Request Staff Advance / Float">
        <form onSubmit={handleCreateAdvance} className="space-y-4">
          {errorMsg && <div className="p-3 text-sm text-red-700 bg-red-50 rounded border border-red-200">{errorMsg}</div>}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Employee</label>
            <Combobox aria-label="Advance Employee"
              value={advEmployeeId}
              onChange={(e) => setAdvEmployeeId(e.target.value)}
              className="w-full"
              required
            >
              <option value="">Select Employee...</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>{e.first_name} {e.last_name} ({e.employee_number})</option>
              ))}
            </Combobox>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Advance Type</label>
              <Combobox aria-label="Advance Type"
                value={advType}
                onChange={(e) => setAdvType(e.target.value)}
                className="w-full"
              >
                <option value="CASH">Cash Advance</option>
                <option value="TRAVEL">Travel Advance</option>
                <option value="PARTS_FLOAT">Spare Parts Site Float</option>
                <option value="EMERGENCY_LOAN">Emergency Loan</option>
              </Combobox>
            </div>
            <Input label="Amount (PKR)" value={advAmount} onChange={(e) => setAdvAmount(e.target.value)} required />
          </div>
          <Input label="Repayment Months" type="number" min="1" max="12" value={String(advMonths)} onChange={(e) => setAdvMonths(Number(e.target.value))} required />
          <Input label="Purpose / Justification" value={advPurpose} onChange={(e) => setAdvPurpose(e.target.value)} placeholder="Site emergency float for VRF spare parts" required />
          <div className="flex justify-end space-x-3 pt-4 border-t">
            <Button variant="secondary" type="button" onClick={() => setIsAdvanceModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Submitting...' : 'Submit Request'}</Button>
          </div>
        </form>
      </Drawer>

      {/* Salary Structure Drawer */}
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
              PKR {fmtMoney(sumDec([basicSalary, houseRent, utility, medical]))}
            </span>
          </div>
          <div className="flex justify-end space-x-3 pt-4 border-t">
            <Button variant="secondary" type="button" onClick={() => setIsStructureModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Creating...' : 'Save Structure'}</Button>
          </div>
        </form>
      </Drawer>

      {/* Department Drawer */}
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
