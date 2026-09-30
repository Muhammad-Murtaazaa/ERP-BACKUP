import { z } from 'zod';

// ==========================================
// Financial & Money Types
// ==========================================
export const StatementClass = {
  ASSET: 'ASSET',
  LIABILITY: 'LIABILITY',
  EQUITY: 'EQUITY',
  REVENUE: 'REVENUE',
  EXPENSE: 'EXPENSE',
} as const;
export type StatementClass = (typeof StatementClass)[keyof typeof StatementClass];

export const NormalBalance = {
  DEBIT: 'DEBIT',
  CREDIT: 'CREDIT',
} as const;
export type NormalBalance = (typeof NormalBalance)[keyof typeof NormalBalance];

export const AccountControlType = {
  GENERAL: 'GENERAL',
  AR_CONTROL: 'AR_CONTROL',
  AP_CONTROL: 'AP_CONTROL',
  INVENTORY_CONTROL: 'INVENTORY_CONTROL',
  BANK: 'BANK',
  TAX_PAYABLE: 'TAX_PAYABLE',
  TAX_RECEIVABLE: 'TAX_RECEIVABLE',
  GRNI: 'GRNI',
  RETAINED_EARNINGS: 'RETAINED_EARNINGS',
  SUSPENSE: 'SUSPENSE',
} as const;
export type AccountControlType = (typeof AccountControlType)[keyof typeof AccountControlType];

export const CoaLevel = {
  L1_CLASS: 1,
  L2_GROUP: 2,
  L3_SUBGROUP: 3,
  L4_ACCOUNT: 4,
} as const;
export type CoaLevel = (typeof CoaLevel)[keyof typeof CoaLevel];

export const JournalStatus = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  APPROVED: 'APPROVED',
  POSTED: 'POSTED',
  REVERSED: 'REVERSED',
} as const;
export type JournalStatus = (typeof JournalStatus)[keyof typeof JournalStatus];

export const AccountingPurpose = {
  MANUAL_JOURNAL: 'MANUAL_JOURNAL',
  SALES_INVOICE: 'SALES_INVOICE',
  CUSTOMER_PAYMENT: 'CUSTOMER_PAYMENT',
  PURCHASE_RECEIPT: 'PURCHASE_RECEIPT',
  PURCHASE_INVOICE: 'PURCHASE_INVOICE',
  SUPPLIER_PAYMENT: 'SUPPLIER_PAYMENT',
  INVENTORY_ISSUE: 'INVENTORY_ISSUE',
  REVERSAL: 'REVERSAL',
  OPENING_BALANCE: 'OPENING_BALANCE',
  BANK_CHARGE: 'BANK_CHARGE',
  FX_REVALUATION: 'FX_REVALUATION',
  PAYROLL_RUN: 'PAYROLL_RUN',
  PAYROLL_DISBURSEMENT: 'PAYROLL_DISBURSEMENT',
  INVENTORY_ADJUSTMENT: 'INVENTORY_ADJUSTMENT',
  MANUFACTURING_WIP_ISSUE: 'MANUFACTURING_WIP_ISSUE',
  MANUFACTURING_ASSEMBLY_RECEIPT: 'MANUFACTURING_ASSEMBLY_RECEIPT',
  PROJECT_PROGRESS_INVOICE: 'PROJECT_PROGRESS_INVOICE',
  FIXED_ASSET_ACQUISITION: 'FIXED_ASSET_ACQUISITION',
  FIXED_ASSET_DEPRECIATION: 'FIXED_ASSET_DEPRECIATION',
  FIXED_ASSET_DISPOSAL: 'FIXED_ASSET_DISPOSAL',
  POS_SESSION_CLOSE: 'POS_SESSION_CLOSE',
  QUALITY_SCRAP_WRITEOFF: 'QUALITY_SCRAP_WRITEOFF',
  MAINTENANCE_EXPENSE_SETTLEMENT: 'MAINTENANCE_EXPENSE_SETTLEMENT',
} as const;
export type AccountingPurpose = (typeof AccountingPurpose)[keyof typeof AccountingPurpose];

export const PeriodStatus = {
  OPEN: 'OPEN',
  SOFT_CLOSED: 'SOFT_CLOSED',
  HARD_CLOSED: 'HARD_CLOSED',
} as const;
export type PeriodStatus = (typeof PeriodStatus)[keyof typeof PeriodStatus];

// ==========================================
// Zod Schemas
// ==========================================
export const DecimalStringSchema = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, 'Invalid decimal string format');

export const AccountSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  legal_entity_id: z.string().uuid().nullable().optional(),
  code: z.string().min(1).max(32),
  name: z.string().min(1).max(255),
  parent_id: z.string().uuid().nullable().optional(),
  level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  statement_class: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']),
  normal_balance: z.enum(['DEBIT', 'CREDIT']),
  posting_allowed: z.boolean(),
  control_type: z.enum([
    'GENERAL',
    'AR_CONTROL',
    'AP_CONTROL',
    'INVENTORY_CONTROL',
    'BANK',
    'TAX_PAYABLE',
    'TAX_RECEIVABLE',
    'GRNI',
    'RETAINED_EARNINGS',
    'SUSPENSE',
  ]),
  currency_restriction: z.string().length(3).nullable().optional(),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Account = z.infer<typeof AccountSchema>;

export const JournalLineSchema = z.object({
  id: z.string().uuid().optional(),
  line_number: z.number().int().positive(),
  account_id: z.string().uuid(),
  debit_amount: DecimalStringSchema,
  credit_amount: DecimalStringSchema,
  currency: z.string().length(3),
  fx_rate: DecimalStringSchema.default('1.000000000000'),
  base_debit: DecimalStringSchema,
  base_credit: DecimalStringSchema,
  description: z.string().max(500).optional(),
  party_id: z.string().uuid().nullable().optional(),
  dimension_branch_id: z.string().uuid().nullable().optional(),
  dimension_project_id: z.string().uuid().nullable().optional(),
  dimension_cost_center_id: z.string().uuid().nullable().optional(),
});
export type JournalLine = z.infer<typeof JournalLineSchema>;

export const CreateJournalDraftSchema = z.object({
  organization_id: z.string().uuid(),
  legal_entity_id: z.string().uuid(),
  book_id: z.string().uuid().optional(),
  journal_number: z.string().optional(),
  posting_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD required'),
  document_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD required'),
  accounting_purpose: z.string().default(AccountingPurpose.MANUAL_JOURNAL),
  description: z.string().min(1).max(1000),
  base_currency: z.string().length(3).default('PKR'),
  lines: z.array(JournalLineSchema).min(2, 'A journal must contain at least 2 lines'),
});
export type CreateJournalDraftInput = z.infer<typeof CreateJournalDraftSchema>;

export const JournalSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  legal_entity_id: z.string().uuid(),
  journal_number: z.string(),
  posting_date: z.string(),
  document_date: z.string(),
  accounting_purpose: z.string(),
  status: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'REVERSED']),
  base_currency: z.string().length(3),
  total_base_debit: DecimalStringSchema,
  total_base_credit: DecimalStringSchema,
  description: z.string(),
  source_type: z.string().nullable().optional(),
  source_id: z.string().nullable().optional(),
  source_version: z.number().int().default(1),
  reversal_of_journal_id: z.string().uuid().nullable().optional(),
  reversed_by_journal_id: z.string().uuid().nullable().optional(),
  created_by: z.string().uuid(),
  approved_by: z.string().uuid().nullable().optional(),
  posted_by: z.string().uuid().nullable().optional(),
  posted_at: z.string().nullable().optional(),
  revision: z.number().int().default(1),
  lines: z.array(JournalLineSchema).optional(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Journal = z.infer<typeof JournalSchema>;

// ==========================================
// M2: Trading Entities (Parties, Items, Orders, Invoices, Payments)
// ==========================================
export const PartyType = {
  CUSTOMER: 'CUSTOMER',
  VENDOR: 'VENDOR',
  BOTH: 'BOTH',
} as const;
export type PartyType = (typeof PartyType)[keyof typeof PartyType];

export interface Party {
  id: string;
  organization_id: string;
  legal_entity_id?: string | null;
  code: string;
  name: string;
  party_type: PartyType;
  tax_identifier?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  credit_limit: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const ItemType = {
  INVENTORY: 'INVENTORY',
  SERVICE: 'SERVICE',
  NON_INVENTORY: 'NON_INVENTORY',
} as const;
export type ItemType = (typeof ItemType)[keyof typeof ItemType];

export interface Item {
  id: string;
  organization_id: string;
  legal_entity_id?: string | null;
  code: string;
  name: string;
  item_type: ItemType;
  uom: string;
  unit_price: string;
  unit_cost: string;
  sales_account_id?: string | null;
  cogs_account_id?: string | null;
  inventory_account_id?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SalesOrderLine {
  id?: string;
  sales_order_id?: string;
  line_number: number;
  item_id: string;
  quantity: string;
  unit_price: string;
  line_total: string;
  description?: string | null;
  fulfilled_quantity?: string;
  invoiced_quantity?: string;
  item_code?: string;
  item_name?: string;
}

export interface SalesOrder {
  id: string;
  organization_id: string;
  legal_entity_id: string;
  party_id: string;
  party_name?: string;
  order_number: string;
  order_date: string;
  delivery_date?: string | null;
  status: 'DRAFT' | 'CONFIRMED' | 'FULFILLED' | 'INVOICED' | 'CANCELLED';
  subtotal: string;
  tax_amount: string;
  total_amount: string;
  notes?: string | null;
  created_by?: string;
  lines?: SalesOrderLine[];
  created_at: string;
  updated_at: string;
}

export interface PurchaseOrderLine {
  id?: string;
  purchase_order_id?: string;
  line_number: number;
  item_id: string;
  quantity: string;
  unit_price: string;
  line_total: string;
  description?: string | null;
  received_quantity?: string;
  billed_quantity?: string;
  item_code?: string;
  item_name?: string;
}

export interface PurchaseOrder {
  id: string;
  organization_id: string;
  legal_entity_id: string;
  party_id: string;
  party_name?: string;
  po_number: string;
  po_date: string;
  expected_date?: string | null;
  status: 'DRAFT' | 'APPROVED' | 'RECEIVED' | 'BILLED' | 'CANCELLED';
  subtotal: string;
  tax_amount: string;
  total_amount: string;
  notes?: string | null;
  created_by?: string;
  lines?: PurchaseOrderLine[];
  created_at: string;
  updated_at: string;
}

export interface ArInvoiceLine {
  id?: string;
  invoice_id?: string;
  line_number: number;
  item_id: string;
  quantity: string;
  unit_price: string;
  line_total: string;
  description?: string | null;
  item_code?: string;
  item_name?: string;
}

export interface ArInvoice {
  id: string;
  organization_id: string;
  legal_entity_id: string;
  party_id: string;
  party_name?: string;
  sales_order_id?: string | null;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  status: 'DRAFT' | 'POSTED' | 'PAID' | 'PARTIALLY_PAID' | 'CANCELLED';
  subtotal: string;
  tax_amount: string;
  total_amount: string;
  outstanding_amount: string;
  posted_journal_id?: string | null;
  notes?: string | null;
  lines?: ArInvoiceLine[];
  created_at: string;
  updated_at: string;
}

export interface ApInvoiceLine {
  id?: string;
  invoice_id?: string;
  line_number: number;
  item_id: string;
  quantity: string;
  unit_price: string;
  line_total: string;
  description?: string | null;
  item_code?: string;
  item_name?: string;
}

export interface ApInvoice {
  id: string;
  organization_id: string;
  legal_entity_id: string;
  party_id: string;
  party_name?: string;
  purchase_order_id?: string | null;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  status: 'DRAFT' | 'POSTED' | 'PAID' | 'PARTIALLY_PAID' | 'CANCELLED';
  subtotal: string;
  tax_amount: string;
  total_amount: string;
  outstanding_amount: string;
  posted_journal_id?: string | null;
  notes?: string | null;
  lines?: ApInvoiceLine[];
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: string;
  organization_id: string;
  legal_entity_id: string;
  party_id: string;
  party_name?: string;
  payment_type: 'RECEIPT' | 'DISBURSEMENT';
  payment_number: string;
  payment_date: string;
  bank_account_id: string;
  bank_account_name?: string;
  amount: string;
  currency: string;
  reference?: string | null;
  status: 'POSTED' | 'CANCELLED';
  posted_journal_id?: string | null;
  allocations?: {
    id: string;
    invoice_id: string;
    invoice_type: 'AR' | 'AP';
    allocated_amount: string;
    invoice_number?: string;
  }[];
  created_at: string;
}

// ==========================================
// M3: Treasury, FX & Onboarding Types
// ==========================================
export interface ExchangeRate {
  id: string;
  organization_id: string;
  from_currency: string;
  to_currency: string;
  rate: string;
  effective_date: string;
  source: string;
  created_at: string;
}

export interface BankStatementLine {
  id: string;
  statement_id: string;
  line_number: number;
  transaction_date: string;
  value_date?: string | null;
  amount: string;
  reference?: string | null;
  description?: string | null;
  is_matched: boolean;
  matched_journal_line_id?: string | null;
}

export interface BankStatement {
  id: string;
  organization_id: string;
  legal_entity_id: string;
  bank_account_id: string;
  bank_account_name?: string;
  statement_reference: string;
  statement_date: string;
  opening_balance: string;
  closing_balance: string;
  status: 'UPLOADED' | 'RECONCILING' | 'RECONCILED';
  created_by?: string;
  lines?: BankStatementLine[];
  created_at: string;
  updated_at: string;
}

export interface BankReconciliation {
  id: string;
  statement_id: string;
  reconciled_date: string;
  statement_closing_balance: string;
  gl_closing_balance: string;
  unreconciled_difference: string;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'LOCKED';
  reconciled_by?: string;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export const IndustryTemplate = {
  WHOLESALE_DISTRIBUTION: 'WHOLESALE_DISTRIBUTION',
  SERVICES_CONSULTING: 'SERVICES_CONSULTING',
  LIGHT_MANUFACTURING: 'LIGHT_MANUFACTURING',
  CUSTOM: 'CUSTOM',
} as const;
export type IndustryTemplate = (typeof IndustryTemplate)[keyof typeof IndustryTemplate];

export interface OnboardingProfile {
  id: string;
  organization_id: string;
  industry_template: IndustryTemplate;
  setup_step: string;
  is_completed: boolean;
  completed_at?: string | null;
  created_at: string;
}

// ==========================================
// Workforce, HRM & Payroll (M4)
// ==========================================
export interface Department {
  id: string;
  organization_id: string;
  legal_entity_id: string;
  code: string;
  name: string;
  cost_center_code?: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Designation {
  id: string;
  organization_id: string;
  legal_entity_id: string;
  code: string;
  title: string;
  department_id?: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Employee {
  id: string;
  organization_id: string;
  legal_entity_id: string;
  employee_number: string;
  first_name: string;
  last_name: string;
  email?: string | null;
  phone?: string | null;
  national_id?: string | null;
  department_id?: string | null;
  department_name?: string | null;
  designation_id?: string | null;
  designation_title?: string | null;
  employment_type: 'FULL_TIME' | 'PART_TIME' | 'CONTRACT';
  joining_date: string;
  status: 'ACTIVE' | 'ON_LEAVE' | 'TERMINATED';
  bank_name?: string | null;
  bank_account_number?: string | null;
  salary_structure?: SalaryStructure | null;
  created_at: string;
  updated_at: string;
}

export interface SalaryStructure {
  id: string;
  organization_id: string;
  legal_entity_id: string;
  name: string;
  currency: string;
  basic_salary: string;
  house_rent_allowance: string;
  utility_allowance: string;
  medical_allowance: string;
  other_allowances: string;
  gross_salary: string;
  is_active: boolean;
  created_at: string;
}

export interface EmployeeSalaryAssignment {
  id: string;
  employee_id: string;
  salary_structure_id: string;
  effective_from: string;
  is_current: boolean;
  created_at: string;
}

export const PayrollRunStatus = {
  DRAFT: 'DRAFT',
  APPROVED: 'APPROVED',
  POSTED: 'POSTED',
  DISBURSED: 'DISBURSED',
} as const;
export type PayrollRunStatus = (typeof PayrollRunStatus)[keyof typeof PayrollRunStatus];

export interface PayrollRunItem {
  id: string;
  payroll_run_id: string;
  employee_id: string;
  employee_number?: string;
  employee_name?: string;
  basic_salary: string;
  allowances_total: string;
  gross_salary: string;
  tax_deduction: string;
  eobi_deduction: string;
  provident_fund_deduction: string;
  other_deductions: string;
  total_deductions: string;
  net_salary: string;
  payment_status: 'PENDING' | 'PAID';
}

export interface PayrollRun {
  id: string;
  organization_id: string;
  legal_entity_id: string;
  period_id: string;
  run_number: string;
  month_year: string;
  total_gross: string;
  total_tax: string;
  total_eobi: string;
  total_provident_fund: string;
  total_other_deductions: string;
  total_deductions: string;
  total_net: string;
  status: PayrollRunStatus;
  posted_journal_id?: string | null;
  disbursement_journal_id?: string | null;
  created_by: string;
  items?: PayrollRunItem[];
  created_at: string;
  updated_at: string;
}

// ==========================================
// M5: Advanced Inventory, Warehouses, Lots, Counts & Manufacturing BOM/Work Orders
// ==========================================
export interface Warehouse {
  id: string;
  organization_id: string;
  code: string;
  name: string;
  address?: string | null;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type ZoneType = 'STORAGE' | 'PICKING' | 'RECEIVING' | 'SHIPPING' | 'QUARANTINE';

export interface WarehouseZone {
  id: string;
  warehouse_id: string;
  code: string;
  name: string;
  zone_type: ZoneType;
  created_at: string;
}

export interface WarehouseBin {
  id: string;
  warehouse_id: string;
  zone_id?: string | null;
  bin_code: string;
  max_weight_capacity?: string | null;
  is_active: boolean;
  created_at: string;
}

export type ItemLotStatus = 'AVAILABLE' | 'QUARANTINE' | 'EXPIRED' | 'DEPLETED';

export interface ItemLot {
  id: string;
  organization_id: string;
  item_id: string;
  item_code?: string;
  item_name?: string;
  lot_number: string;
  manufacture_date?: string | null;
  expiry_date?: string | null;
  status: ItemLotStatus;
  created_at: string;
}

export type ItemSerialStatus = 'IN_STOCK' | 'RESERVED' | 'SHIPPED' | 'RETIRED';

export interface ItemSerial {
  id: string;
  organization_id: string;
  item_id: string;
  item_code?: string;
  item_name?: string;
  serial_number: string;
  status: ItemSerialStatus;
  warehouse_id?: string | null;
  bin_id?: string | null;
  created_at: string;
}

export type StockTransferStatus = 'DRAFT' | 'IN_TRANSIT' | 'COMPLETED' | 'CANCELLED';

export interface StockTransferItem {
  id?: string;
  transfer_id?: string;
  item_id: string;
  item_code?: string;
  item_name?: string;
  requested_qty: string;
  shipped_qty: string;
  received_qty: string;
  lot_id?: string | null;
}

export interface StockTransfer {
  id: string;
  organization_id: string;
  transfer_number: string;
  source_warehouse_id: string;
  source_warehouse_name?: string;
  destination_warehouse_id: string;
  destination_warehouse_name?: string;
  status: StockTransferStatus;
  transfer_date: string;
  notes?: string | null;
  items?: StockTransferItem[];
  created_at: string;
  updated_at: string;
}

export type InventoryCountStatus = 'PLANNED' | 'IN_PROGRESS' | 'RECONCILED' | 'POSTED' | 'CANCELLED';

export interface InventoryCountItem {
  id?: string;
  count_id?: string;
  item_id: string;
  item_code?: string;
  item_name?: string;
  system_qty: string;
  counted_qty: string;
  variance_qty: string;
  unit_cost: string;
  variance_value: string;
  lot_id?: string | null;
}

export interface InventoryCount {
  id: string;
  organization_id: string;
  count_number: string;
  warehouse_id: string;
  warehouse_name?: string;
  period_id: string;
  count_date: string;
  status: InventoryCountStatus;
  total_variance_value: string;
  journal_id?: string | null;
  items?: InventoryCountItem[];
  created_at: string;
  updated_at: string;
}

export type BOMStatus = 'DRAFT' | 'ACTIVE' | 'OBSOLETE';

export interface BOMItem {
  id?: string;
  bom_id?: string;
  component_item_id: string;
  component_code?: string;
  component_name?: string;
  component_uom?: string;
  quantity: string;
  scrap_percentage: string;
  notes?: string | null;
}

export interface BillOfMaterials {
  id: string;
  organization_id: string;
  bom_number: string;
  finished_item_id: string;
  finished_item_code?: string;
  finished_item_name?: string;
  name: string;
  version: string;
  yield_quantity: string;
  status: BOMStatus;
  items?: BOMItem[];
  created_at: string;
  updated_at: string;
}

export type WorkOrderStatus = 'PLANNED' | 'RELEASED' | 'IN_PROGRESS' | 'COMPLETED' | 'CLOSED' | 'CANCELLED';

export interface WorkOrderConsumption {
  id?: string;
  work_order_id?: string;
  component_item_id: string;
  component_code?: string;
  component_name?: string;
  consumed_qty: string;
  unit_cost: string;
  total_cost: string;
  lot_id?: string | null;
}

export interface WorkOrder {
  id: string;
  organization_id: string;
  work_order_number: string;
  bom_id: string;
  bom_name?: string;
  finished_item_id: string;
  finished_item_code?: string;
  finished_item_name?: string;
  warehouse_id: string;
  warehouse_name?: string;
  target_qty: string;
  completed_qty: string;
  scrapped_qty: string;
  status: WorkOrderStatus;
  start_date: string;
  due_date: string;
  total_material_cost: string;
  completion_journal_id?: string | null;
  consumptions?: WorkOrderConsumption[];
  created_at: string;
  updated_at: string;
}

// ==========================================
// Projects, Cost Centers & BOQ (M6)
// ==========================================
export type CostCenterType = 'OPERATIONAL' | 'PROJECT' | 'OVERHEAD';

export interface CostCenter {
  id: string;
  organization_id: string;
  code: string;
  name: string;
  cost_center_type: CostCenterType;
  manager_name?: string | null;
  created_at?: string;
}

export type ProjectType = 'CONSTRUCTION' | 'CONSULTING' | 'INTERNAL' | 'EPC' | 'SERVICES';
export type ProjectStatus = 'ESTIMATING' | 'APPROVED' | 'IN_PROGRESS' | 'ON_HOLD' | 'COMPLETED' | 'CLOSED';

export interface Project {
  id: string;
  organization_id: string;
  code: string;
  name: string;
  customer_id?: string | null;
  customer_name?: string | null;
  manager_name?: string | null;
  project_type: ProjectType;
  contract_value: string;
  budgeted_cost: string;
  retention_percentage: string;
  status: ProjectStatus;
  start_date: string;
  end_date?: string | null;
  cost_center_id?: string | null;
  cost_center_name?: string | null;
  created_at?: string;
  updated_at?: string;
}

export type WBSStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';

export interface ProjectWBSNode {
  id: string;
  project_id: string;
  wbs_code: string;
  name: string;
  parent_id?: string | null;
  budget_cost: string;
  progress_percentage: string;
  status: WBSStatus;
  created_at?: string;
}

export type BOQStatus = 'DRAFT' | 'APPROVED' | 'REVISED';

export interface BOQItem {
  id: string;
  boq_id: string;
  wbs_node_id?: string | null;
  wbs_code?: string | null;
  item_code: string;
  description: string;
  uom: string;
  contract_quantity: string;
  unit_rate: string;
  total_amount: string;
  certified_quantity: string;
  created_at?: string;
}

export interface BillOfQuantities {
  id: string;
  organization_id: string;
  project_id: string;
  project_code?: string;
  project_name?: string;
  boq_number: string;
  title: string;
  version: string;
  total_amount: string;
  status: BOQStatus;
  items?: BOQItem[];
  created_at?: string;
  updated_at?: string;
}

export type ProgressCertificateStatus = 'DRAFT' | 'CERTIFIED' | 'INVOICED' | 'CANCELLED';

export interface ProgressCertificateItem {
  id: string;
  certificate_id: string;
  boq_item_id: string;
  item_code?: string;
  description?: string;
  previous_quantity: string;
  current_quantity: string;
  cumulative_quantity: string;
  unit_rate: string;
  current_amount: string;
  created_at?: string;
}

export interface ProgressCertificate {
  id: string;
  organization_id: string;
  certificate_number: string;
  project_id: string;
  project_name?: string;
  boq_id: string;
  period_id: string;
  certificate_date: string;
  gross_certified_amount: string;
  retention_amount: string;
  net_certified_amount: string;
  status: ProgressCertificateStatus;
  journal_id?: string | null;
  items?: ProgressCertificateItem[];
  created_at?: string;
  updated_at?: string;
}

// ==========================================
// Fixed Assets & Depreciation (M7)
// ==========================================
export type DepreciationMethod = 'STRAIGHT_LINE' | 'DECLINING_BALANCE' | 'UNITS_OF_PRODUCTION';
export type AssetStatus = 'DRAFT' | 'ACTIVE' | 'FULLY_DEPRECIATED' | 'DISPOSED' | 'WRITTEN_OFF';

export interface AssetCategory {
  id: string;
  organization_id: string;
  code: string;
  name: string;
  depreciation_method: DepreciationMethod;
  useful_life_months: number;
  salvage_value_percentage: string;
  asset_cost_account_id?: string | null;
  accumulated_deprec_account_id?: string | null;
  deprec_expense_account_id?: string | null;
  created_at?: string;
}

export interface FixedAsset {
  id: string;
  organization_id: string;
  asset_number: string;
  name: string;
  category_id: string;
  category_name?: string;
  acquisition_date: string;
  acquisition_cost: string;
  salvage_value: string;
  useful_life_months: number;
  depreciation_method: DepreciationMethod;
  status: AssetStatus;
  location?: string | null;
  custodian_name?: string | null;
  serial_number?: string | null;
  current_book_value: string;
  accumulated_depreciation: string;
  disposal_date?: string | null;
  disposal_proceeds?: string;
  disposal_journal_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface AssetDepreciationEntry {
  id: string;
  organization_id: string;
  asset_id: string;
  period_id: string;
  entry_date: string;
  depreciation_amount: string;
  accumulated_depreciation_after: string;
  book_value_after: string;
  journal_id?: string | null;
  created_at?: string;
}

// ==========================================
// Point of Sale (POS) Terminal & Sessions
// ==========================================
export interface POSRegister {
  id: string;
  organization_id: string;
  register_code: string;
  name: string;
  warehouse_id?: string | null;
  warehouse_name?: string | null;
  cash_account_id?: string | null;
  card_clearing_account_id?: string | null;
  is_active: boolean;
  created_at?: string;
}

export type POSSessionStatus = 'OPEN' | 'CLOSED';

export interface POSSession {
  id: string;
  organization_id: string;
  register_id: string;
  register_name?: string;
  cashier_id: string;
  cashier_name: string;
  opened_at: string;
  closed_at?: string | null;
  opening_float: string;
  cash_sales_total: string;
  card_sales_total: string;
  expected_cash_drawer: string;
  actual_cash_drawer?: string | null;
  cash_difference: string;
  status: POSSessionStatus;
  closing_journal_id?: string | null;
  created_at?: string;
}

export type POSPaymentMethod = 'CASH' | 'CARD' | 'SPLIT';
export type POSOrderStatus = 'COMPLETED' | 'VOIDED' | 'REFUNDED';

export interface POSOrderLine {
  id?: string;
  order_id?: string;
  item_id: string;
  item_code: string;
  item_name: string;
  quantity: string;
  unit_price: string;
  line_total: string;
  tax_amount?: string;
}

export interface POSOrder {
  id: string;
  organization_id: string;
  session_id: string;
  order_number: string;
  customer_id?: string | null;
  customer_name?: string | null;
  subtotal: string;
  discount_amount: string;
  tax_amount: string;
  total_amount: string;
  payment_method: POSPaymentMethod;
  cash_tendered: string;
  change_due: string;
  status: POSOrderStatus;
  lines?: POSOrderLine[];
  created_at?: string;
}

// ==========================================
// M8: Quality Management (QM)
// ==========================================
export type InspectionType = 'RECEIVING' | 'IN_PROCESS' | 'FINAL';
export type ParamDataType = 'NUMERIC' | 'BOOLEAN' | 'TEXT';
export type InspectionLotStatus = 'PENDING' | 'IN_INSPECTION' | 'ACCEPTED' | 'REJECTED' | 'CONDITIONALLY_ACCEPTED';
export type NCRSeverity = 'MINOR' | 'MAJOR' | 'CRITICAL';
export type NCRDisposition = 'REWORK' | 'SCRAP' | 'RETURN_TO_VENDOR' | 'USE_AS_IS';
export type NCRStatus = 'DRAFT' | 'OPEN' | 'RESOLVED' | 'CLOSED';
export type CoAStatus = 'DRAFT' | 'ISSUED' | 'VOID';

export interface QualityInspectionPlanParam {
  id?: string;
  plan_id?: string;
  param_name: string;
  data_type: ParamDataType;
  target_value?: string | null;
  min_tolerance?: string | null;
  max_tolerance?: string | null;
  uom?: string | null;
  is_mandatory: boolean;
}

export interface QualityInspectionPlan {
  id: string;
  organization_id: string;
  plan_code: string;
  name: string;
  item_id?: string | null;
  item_name?: string | null;
  inspection_type: InspectionType;
  sample_size: string;
  status: 'ACTIVE' | 'INACTIVE';
  params?: QualityInspectionPlanParam[];
  created_at?: string;
}

export interface QualityInspectionResult {
  id?: string;
  lot_id?: string;
  param_name: string;
  measured_numeric_value?: string | null;
  measured_text_value?: string | null;
  is_pass: boolean;
  inspector_notes?: string | null;
}

export interface QualityInspectionLot {
  id: string;
  organization_id: string;
  legal_entity_id: string;
  lot_number: string;
  source_type: 'GRN' | 'WORK_ORDER' | 'MANUAL';
  source_id?: string | null;
  item_id: string;
  item_code?: string;
  item_name?: string;
  batch_number?: string | null;
  quantity: string;
  status: InspectionLotStatus;
  usage_decision_notes?: string | null;
  inspector_id?: string | null;
  inspector_name?: string | null;
  inspected_at?: string | null;
  results?: QualityInspectionResult[];
  created_at?: string;
}

export interface QualityNCR {
  id: string;
  organization_id: string;
  ncr_number: string;
  lot_id: string;
  lot_number?: string;
  item_id: string;
  item_name?: string;
  defect_severity: NCRSeverity;
  root_cause?: string | null;
  corrective_action?: string | null;
  disposition: NCRDisposition;
  status: NCRStatus;
  scrap_journal_id?: string | null;
  created_by?: string | null;
  created_at?: string;
}

export interface QualityCoA {
  id: string;
  organization_id: string;
  coa_number: string;
  lot_id: string;
  lot_number?: string;
  item_id: string;
  item_name?: string;
  customer_id?: string | null;
  customer_name?: string | null;
  issue_date: string;
  certified_by: string;
  status: CoAStatus;
  results?: QualityInspectionResult[];
  created_at?: string;
}

// ==========================================
// M9: Plant Maintenance & Equipment Engineering (PM)
// ==========================================
export type EquipmentCategory = 'MACHINERY' | 'VEHICLE' | 'ELECTRICAL' | 'HVAC';
export type EquipmentCriticality = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type EquipmentStatus = 'OPERATIONAL' | 'UNDER_MAINTENANCE' | 'DECOMMISSIONED';
export type PMFrequencyType = 'TIME_BASED_DAYS' | 'METER_USAGE_HOURS';
export type MaintenanceOrderType = 'PREVENTIVE' | 'CORRECTIVE' | 'BREAKDOWN' | 'CALIBRATION';
export type MaintenancePriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'EMERGENCY';
export type MaintenanceOrderStatus = 'DRAFT' | 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export interface MaintenanceEquipment {
  id: string;
  organization_id: string;
  legal_entity_id: string;
  equipment_code: string;
  name: string;
  fixed_asset_id?: string | null;
  fixed_asset_name?: string | null;
  category: EquipmentCategory;
  location?: string | null;
  criticality: EquipmentCriticality;
  status: EquipmentStatus;
  operating_hours: string;
  serial_number?: string | null;
  created_at?: string;
}

export interface PMSchedule {
  id: string;
  organization_id: string;
  equipment_id: string;
  equipment_code?: string;
  equipment_name?: string;
  schedule_name: string;
  frequency_type: PMFrequencyType;
  frequency_interval: string;
  last_performed_date?: string | null;
  next_due_date: string;
  checklist_json?: any;
  status: 'ACTIVE' | 'PAUSED';
  created_at?: string;
}

export interface MaintOrderPart {
  id?: string;
  work_order_id?: string;
  item_id: string;
  item_code?: string;
  item_name?: string;
  quantity: string;
  unit_cost: string;
  total_cost: string;
}

export interface MaintOrderLabor {
  id?: string;
  work_order_id?: string;
  technician_name: string;
  labor_hours: string;
  hourly_rate: string;
  total_cost: string;
}

export interface MaintenanceWorkOrder {
  id: string;
  organization_id: string;
  legal_entity_id: string;
  work_order_number: string;
  equipment_id: string;
  equipment_code?: string;
  equipment_name?: string;
  pm_schedule_id?: string | null;
  order_type: MaintenanceOrderType;
  priority: MaintenancePriority;
  status: MaintenanceOrderStatus;
  description: string;
  failure_code?: string | null;
  start_date?: string | null;
  completion_date?: string | null;
  total_parts_cost: string;
  total_labor_cost: string;
  total_cost: string;
  downtime_hours: string;
  settlement_journal_id?: string | null;
  created_by?: string | null;
  parts?: MaintOrderPart[];
  labor?: MaintOrderLabor[];
  created_at?: string;
}

export interface EquipmentCalibration {
  id: string;
  organization_id: string;
  equipment_id: string;
  equipment_code?: string;
  equipment_name?: string;
  calibration_certificate_no: string;
  calibration_date: string;
  expiry_date: string;
  calibration_agency: string;
  result: 'PASS' | 'FAIL';
  notes?: string | null;
  created_at?: string;
}

// ==========================================
// Organization, Legal Entity, User & Auth
// ==========================================
export const UserRole = {
  ADMIN: 'ADMIN',
  CONTROLLER: 'CONTROLLER',
  ACCOUNTANT: 'ACCOUNTANT',
  SALES_OPERATOR: 'SALES_OPERATOR',
  INVENTORY_MANAGER: 'INVENTORY_MANAGER',
  HR_MANAGER: 'HR_MANAGER',
  PRODUCTION_MANAGER: 'PRODUCTION_MANAGER',
  WAREHOUSE_OPERATOR: 'WAREHOUSE_OPERATOR',
  PROJECT_MANAGER: 'PROJECT_MANAGER',
  QUALITY_MANAGER: 'QUALITY_MANAGER',
  MAINTENANCE_ENGINEER: 'MAINTENANCE_ENGINEER',
  CASHIER: 'CASHIER',
  AUDITOR: 'AUDITOR',
  VIEWER: 'VIEWER',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const Permission = {
  // Platform & Org
  ORG_MANAGE: 'org.manage',
  USER_MANAGE: 'user.manage',
  // Finance & GL
  FINANCE_COA_MANAGE: 'finance.coa.manage',
  FINANCE_COA_VIEW: 'finance.coa.view',
  FINANCE_PERIOD_MANAGE: 'finance.period.manage',
  FINANCE_JOURNAL_CREATE: 'finance.journal.create',
  FINANCE_JOURNAL_SUBMIT: 'finance.journal.submit',
  FINANCE_JOURNAL_APPROVE: 'finance.journal.approve',
  FINANCE_JOURNAL_POST: 'finance.journal.post',
  FINANCE_JOURNAL_REVERSE: 'finance.journal.reverse',
  FINANCE_REPORTS_VIEW: 'finance.reports.view',
  // Trading Workflows (M2)
  PARTIES_MANAGE: 'parties.manage',
  ITEMS_MANAGE: 'items.manage',
  INVENTORY_MANAGE: 'inventory.manage',
  SALES_ORDER_MANAGE: 'sales.order.manage',
  PURCHASE_ORDER_MANAGE: 'purchase.order.manage',
  AR_INVOICE_MANAGE: 'ar.invoice.manage',
  AP_INVOICE_MANAGE: 'ap.invoice.manage',
  PAYMENT_MANAGE: 'payment.manage',
  // Treasury, FX & Onboarding (M3)
  TREASURY_BANK_RECONCILE: 'treasury.bank.reconcile',
  TREASURY_FX_MANAGE: 'treasury.fx.manage',
  ONBOARDING_MANAGE: 'onboarding.manage',
  // Workforce & Payroll (M4)
  HRM_MANAGE: 'hrm.manage',
  PAYROLL_MANAGE: 'payroll.manage',
  PAYROLL_APPROVE: 'payroll.approve',
  PAYROLL_POST: 'payroll.post',
  PAYROLL_DISBURSE: 'payroll.disburse',
  // Advanced Inventory & Manufacturing (M5)
  WAREHOUSE_MANAGE: 'warehouse.manage',
  INVENTORY_TRANSFER: 'inventory.transfer',
  INVENTORY_COUNT: 'inventory.count',
  INVENTORY_ADJUST: 'inventory.adjust',
  BOM_MANAGE: 'bom.manage',
  WORK_ORDER_MANAGE: 'workorder.manage',
  WORK_ORDER_RELEASE: 'workorder.release',
  WORK_ORDER_CONSUME: 'workorder.consume',
  WORK_ORDER_COMPLETE: 'workorder.complete',
  // Projects, Cost Centers & BOQ (M6)
  PROJECT_MANAGE: 'project.manage',
  BOQ_MANAGE: 'boq.manage',
  PROGRESS_CERTIFY: 'progress.certify',
  PROGRESS_INVOICE: 'progress.invoice',
  // Fixed Assets (M7)
  ASSET_MANAGE: 'asset.manage',
  ASSET_DEPRECIATE: 'asset.depreciate',
  ASSET_DISPOSE: 'asset.dispose',
  // POS Terminal
  POS_TERMINAL: 'pos.terminal',
  POS_REGISTER_MANAGE: 'pos.register.manage',
  POS_SESSION_CLOSE: 'pos.session.close',
  // Quality Management (M8)
  QUALITY_PLAN_MANAGE: 'quality.plan.manage',
  QUALITY_INSPECT: 'quality.inspect',
  QUALITY_NCR_MANAGE: 'quality.ncr.manage',
  QUALITY_COA_MANAGE: 'quality.coa.manage',
  // Plant Maintenance (M9)
  EQUIPMENT_MANAGE: 'equipment.manage',
  PM_SCHEDULE_MANAGE: 'pm.schedule.manage',
  MAINT_WORK_ORDER_MANAGE: 'maint.workorder.manage',
  CALIBRATION_MANAGE: 'calibration.manage',
  // Audit
  AUDIT_VIEW: 'audit.view',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

export interface AuthSession {
  user_id: string;
  email: string;
  name: string;
  organization_id: string;
  legal_entity_id: string;
  roles: UserRole[];
  permissions: string[];
}

// ==========================================
// Error Codes & Structure
// ==========================================
export const ErrorCode = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN_SCOPE: 'FORBIDDEN_SCOPE',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  JOURNAL_UNBALANCED: 'JOURNAL_UNBALANCED',
  NON_LEAF_ACCOUNT_POSTING: 'NON_LEAF_ACCOUNT_POSTING',
  INACTIVE_ACCOUNT_POSTING: 'INACTIVE_ACCOUNT_POSTING',
  PERIOD_CLOSED: 'PERIOD_CLOSED',
  PERIOD_NOT_FOUND: 'PERIOD_NOT_FOUND',
  POSTED_FACT_IMMUTABLE: 'POSTED_FACT_IMMUTABLE',
  ALREADY_POSTED: 'ALREADY_POSTED',
  ALREADY_REVERSED: 'ALREADY_REVERSED',
  STALE_REVISION: 'STALE_REVISION',
  DUPLICATE_SOURCE_PURPOSE: 'DUPLICATE_SOURCE_PURPOSE',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  OVER_ALLOCATION: 'OVER_ALLOCATION',
  STATEMENT_ALREADY_RECONCILED: 'STATEMENT_ALREADY_RECONCILED',
  RECONCILIATION_MISMATCH: 'RECONCILIATION_MISMATCH',
  FX_RATE_NOT_FOUND: 'FX_RATE_NOT_FOUND',
  LOT_EXPIRED_OR_DEPLETED: 'LOT_EXPIRED_OR_DEPLETED',
  INSUFFICIENT_RAW_MATERIALS: 'INSUFFICIENT_RAW_MATERIALS',
  WORK_ORDER_NOT_RELEASED: 'WORK_ORDER_NOT_RELEASED',
  COUNT_NOT_RECONCILED: 'COUNT_NOT_RECONCILED',
  OVER_CERTIFICATION: 'OVER_CERTIFICATION',
  RETENTION_LIMIT_EXCEEDED: 'RETENTION_LIMIT_EXCEEDED',
  PROJECT_CLOSED: 'PROJECT_CLOSED',
  ASSET_ALREADY_DISPOSED: 'ASSET_ALREADY_DISPOSED',
  ASSET_NOT_ACTIVE: 'ASSET_NOT_ACTIVE',
  POS_SESSION_ALREADY_OPEN: 'POS_SESSION_ALREADY_OPEN',
  POS_SESSION_CLOSED: 'POS_SESSION_CLOSED',
  INSUFFICIENT_PAYMENT_TENDER: 'INSUFFICIENT_PAYMENT_TENDER',
  LOT_NOT_FOUND: 'LOT_NOT_FOUND',
  LOT_ALREADY_INSPECTED: 'LOT_ALREADY_INSPECTED',
  NCR_NOT_FOUND: 'NCR_NOT_FOUND',
  NCR_ALREADY_CLOSED: 'NCR_ALREADY_CLOSED',
  EQUIPMENT_NOT_FOUND: 'EQUIPMENT_NOT_FOUND',
  WORK_ORDER_ALREADY_COMPLETED: 'WORK_ORDER_ALREADY_COMPLETED',
  WORK_ORDER_ALREADY_CANCELLED: 'WORK_ORDER_ALREADY_CANCELLED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface StandardErrorResponse {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    correlation_id: string;
    details?: unknown;
  };
}

export interface StandardSuccessResponse<T> {
  success: true;
  data: T;
  meta?: {
    correlation_id: string;
    timestamp: string;
    total_count?: number;
  };
}

