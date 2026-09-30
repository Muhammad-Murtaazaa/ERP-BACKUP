import type { FormField } from '../kit/ModuleWorkspace.js';

export const ROLE_OPTIONS = [
  'ADMIN', 'CONTROLLER', 'ACCOUNTANT', 'SALES_OPERATOR', 'INVENTORY_MANAGER', 'HR_MANAGER', 'PRODUCTION_MANAGER', 'WAREHOUSE_OPERATOR',
  'PROJECT_MANAGER', 'QUALITY_MANAGER', 'MAINTENANCE_ENGINEER', 'CASHIER', 'STORE_MANAGER', 'SERVICE_MANAGER', 'TECHNICIAN', 'AUDITOR', 'VIEWER',
].map((r) => ({ value: r, label: r.replace(/_/g, ' ') }));

export const opts = (...values: string[]) => values.map((v) => ({ value: v, label: v.replace(/_/g, ' ') }));

export const partyRef = (name = 'party_id', label = 'Customer', required = true): FormField => ({
  name,
  label,
  type: 'ref',
  required,
  ref: { endpoint: '/parties', label: (r) => `${r.code} · ${r.name}`, description: (r) => r.party_type },
});
export const itemRef = (name = 'item_id', label = 'Item', required = true): FormField => ({
  name,
  label,
  type: 'ref',
  required,
  ref: { endpoint: '/items', label: (r) => `${r.code} · ${r.name}`, description: (r) => r.item_type },
});
export const employeeRef = (name = 'employee_id', label = 'Employee', required = true): FormField => ({
  name,
  label,
  type: 'ref',
  required,
  ref: { endpoint: '/hrm/employees', label: (r) => `${r.employee_number} · ${r.first_name} ${r.last_name}`, description: (r) => r.designation_name || r.employment_type },
});
export const warehouseRef = (name = 'warehouse_id', label = 'Warehouse', required = true): FormField => ({
  name,
  label,
  type: 'ref',
  required,
  ref: { endpoint: '/inventory/warehouses', label: (r) => `${r.code} · ${r.name}` },
});
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
