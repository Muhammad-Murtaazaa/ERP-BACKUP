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
// Organization, Legal Entity, User & Auth
// ==========================================
export const UserRole = {
  ADMIN: 'ADMIN',
  CONTROLLER: 'CONTROLLER',
  ACCOUNTANT: 'ACCOUNTANT',
  SALES_OPERATOR: 'SALES_OPERATOR',
  INVENTORY_MANAGER: 'INVENTORY_MANAGER',
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

