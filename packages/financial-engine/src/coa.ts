import { Account, CoaLevel, StatementClass, NormalBalance, AccountControlType } from '@omnysync/contracts';

export interface CoaNode extends Account {
  children?: CoaNode[];
}

export class CoaHierarchyValidator {
  /**
   * Validates that an account conforms to the 4-level hierarchy rules:
   * Level 1: Statement Class (Assets, Liabilities, Equity, Revenue, Expense) -> posting_allowed = FALSE
   * Level 2: Group (Current assets, Non-current liabilities, etc.) -> posting_allowed = FALSE
   * Level 3: Subgroup (Cash & bank, Receivables, Payables, etc.) -> posting_allowed = FALSE
   * Level 4: Leaf Account (Operating Bank, Trade AR, etc.) -> posting_allowed = TRUE
   */
  static validateAccount(
    account: Partial<Account>,
    parent?: Account | null,
  ): { valid: boolean; error?: string } {
    if (!account.level || account.level < 1 || account.level > 4) {
      return { valid: false, error: `Level must be between 1 and 4, got: ${account.level}` };
    }

    if (account.level === CoaLevel.L1_CLASS) {
      if (account.parent_id) {
        return { valid: false, error: 'Level 1 (Statement Class) accounts must not have a parent' };
      }
      if (account.posting_allowed) {
        return { valid: false, error: 'Posting is strictly forbidden on Level 1 accounts' };
      }
    } else {
      if (!account.parent_id && !parent) {
        return { valid: false, error: `Level ${account.level} accounts must have a parent account` };
      }
      if (parent) {
        if (parent.level !== account.level - 1) {
          return {
            valid: false,
            error: `Invalid parent hierarchy: Level ${account.level} account must have a Level ${account.level - 1} parent, but parent is Level ${parent.level}`,
          };
        }
        if (parent.statement_class !== account.statement_class) {
          return {
            valid: false,
            error: `Statement class mismatch: parent is ${parent.statement_class} but account is ${account.statement_class}`,
          };
        }
      }
    }

    if (account.level === CoaLevel.L2_GROUP || account.level === CoaLevel.L3_SUBGROUP) {
      if (account.posting_allowed) {
        return { valid: false, error: `Posting is strictly forbidden on Level ${account.level} heading accounts` };
      }
    }

    if (account.level === CoaLevel.L4_ACCOUNT) {
      if (account.posting_allowed !== true) {
        return { valid: false, error: 'Level 4 accounts must have posting_allowed = true' };
      }
    }

    return { valid: true };
  }

  /**
   * Constructs a nested hierarchy tree from flat account array.
   */
  static buildTree(accounts: Account[]): CoaNode[] {
    const map = new Map<string, CoaNode>();
    const roots: CoaNode[] = [];

    // First pass: initialize node map
    for (const acc of accounts) {
      map.set(acc.id, { ...acc, children: [] });
    }

    // Second pass: link children to parent
    for (const acc of accounts) {
      const node = map.get(acc.id)!;
      if (node.parent_id && map.has(node.parent_id)) {
        map.get(node.parent_id)!.children!.push(node);
      } else {
        roots.push(node);
      }
    }

    // Sort roots and children by code
    const sortNodes = (nodes: CoaNode[]) => {
      nodes.sort((a, b) => a.code.localeCompare(b.code));
      for (const node of nodes) {
        if (node.children && node.children.length > 0) {
          sortNodes(node.children);
        }
      }
    };
    sortNodes(roots);

    return roots;
  }
}

/**
 * Standard enterprise 4-level Chart of Accounts template conforming to COA.md
 */
export interface CoaTemplateItem {
  code: string;
  name: string;
  level: CoaLevel;
  parentCode?: string;
  statementClass: StatementClass;
  normalBalance: NormalBalance;
  postingAllowed: boolean;
  controlType: AccountControlType;
  currencyRestriction?: string;
}

export const STANDARD_COA_TEMPLATE: CoaTemplateItem[] = [
  // --- 1. ASSETS ---
  { code: '1000', name: 'Assets', level: 1, statementClass: StatementClass.ASSET, normalBalance: NormalBalance.DEBIT, postingAllowed: false, controlType: AccountControlType.GENERAL },
  
  // 1.1 Current Assets
  { code: '1100', name: 'Current Assets', level: 2, parentCode: '1000', statementClass: StatementClass.ASSET, normalBalance: NormalBalance.DEBIT, postingAllowed: false, controlType: AccountControlType.GENERAL },
  { code: '1110', name: 'Cash and Bank', level: 3, parentCode: '1100', statementClass: StatementClass.ASSET, normalBalance: NormalBalance.DEBIT, postingAllowed: false, controlType: AccountControlType.GENERAL },
  { code: '111001', name: 'Cash on Hand', level: 4, parentCode: '1110', statementClass: StatementClass.ASSET, normalBalance: NormalBalance.DEBIT, postingAllowed: true, controlType: AccountControlType.GENERAL },
  { code: '111002', name: 'Operating Bank PKR', level: 4, parentCode: '1110', statementClass: StatementClass.ASSET, normalBalance: NormalBalance.DEBIT, postingAllowed: true, controlType: AccountControlType.BANK, currencyRestriction: 'PKR' },
  { code: '111003', name: 'Operating Bank USD', level: 4, parentCode: '1110', statementClass: StatementClass.ASSET, normalBalance: NormalBalance.DEBIT, postingAllowed: true, controlType: AccountControlType.BANK, currencyRestriction: 'USD' },
  { code: '111004', name: 'Cash Clearing Account', level: 4, parentCode: '1110', statementClass: StatementClass.ASSET, normalBalance: NormalBalance.DEBIT, postingAllowed: true, controlType: AccountControlType.GENERAL },

  { code: '1120', name: 'Receivables', level: 3, parentCode: '1100', statementClass: StatementClass.ASSET, normalBalance: NormalBalance.DEBIT, postingAllowed: false, controlType: AccountControlType.GENERAL },
  { code: '112001', name: 'Trade AR Control', level: 4, parentCode: '1120', statementClass: StatementClass.ASSET, normalBalance: NormalBalance.DEBIT, postingAllowed: true, controlType: AccountControlType.AR_CONTROL },
  { code: '112002', name: 'Allowance for Doubtful Debts', level: 4, parentCode: '1120', statementClass: StatementClass.ASSET, normalBalance: NormalBalance.CREDIT, postingAllowed: true, controlType: AccountControlType.GENERAL },

  { code: '1130', name: 'Inventory', level: 3, parentCode: '1100', statementClass: StatementClass.ASSET, normalBalance: NormalBalance.DEBIT, postingAllowed: false, controlType: AccountControlType.GENERAL },
  { code: '113001', name: 'Trading Inventory', level: 4, parentCode: '1130', statementClass: StatementClass.ASSET, normalBalance: NormalBalance.DEBIT, postingAllowed: true, controlType: AccountControlType.INVENTORY_CONTROL },
  { code: '113002', name: 'Raw Materials', level: 4, parentCode: '1130', statementClass: StatementClass.ASSET, normalBalance: NormalBalance.DEBIT, postingAllowed: true, controlType: AccountControlType.INVENTORY_CONTROL },
  { code: '113003', name: 'Work in Progress', level: 4, parentCode: '1130', statementClass: StatementClass.ASSET, normalBalance: NormalBalance.DEBIT, postingAllowed: true, controlType: AccountControlType.INVENTORY_CONTROL },
  { code: '113004', name: 'Finished Goods', level: 4, parentCode: '1130', statementClass: StatementClass.ASSET, normalBalance: NormalBalance.DEBIT, postingAllowed: true, controlType: AccountControlType.INVENTORY_CONTROL },

  { code: '1140', name: 'Recoverable Tax', level: 3, parentCode: '1100', statementClass: StatementClass.ASSET, normalBalance: NormalBalance.DEBIT, postingAllowed: false, controlType: AccountControlType.GENERAL },
  { code: '114001', name: 'Input Sales Tax', level: 4, parentCode: '1140', statementClass: StatementClass.ASSET, normalBalance: NormalBalance.DEBIT, postingAllowed: true, controlType: AccountControlType.TAX_RECEIVABLE },
  { code: '114002', name: 'Withholding Tax Receivable', level: 4, parentCode: '1140', statementClass: StatementClass.ASSET, normalBalance: NormalBalance.DEBIT, postingAllowed: true, controlType: AccountControlType.TAX_RECEIVABLE },

  // 1.2 Non-Current Assets
  { code: '1200', name: 'Non-Current Assets', level: 2, parentCode: '1000', statementClass: StatementClass.ASSET, normalBalance: NormalBalance.DEBIT, postingAllowed: false, controlType: AccountControlType.GENERAL },
  { code: '1210', name: 'Property, Plant & Equipment', level: 3, parentCode: '1200', statementClass: StatementClass.ASSET, normalBalance: NormalBalance.DEBIT, postingAllowed: false, controlType: AccountControlType.GENERAL },
  { code: '121001', name: 'Office Equipment Cost', level: 4, parentCode: '1210', statementClass: StatementClass.ASSET, normalBalance: NormalBalance.DEBIT, postingAllowed: true, controlType: AccountControlType.GENERAL },
  { code: '121002', name: 'Accumulated Depreciation - Office Equipment', level: 4, parentCode: '1210', statementClass: StatementClass.ASSET, normalBalance: NormalBalance.CREDIT, postingAllowed: true, controlType: AccountControlType.GENERAL },

  // --- 2. LIABILITIES ---
  { code: '2000', name: 'Liabilities', level: 1, statementClass: StatementClass.LIABILITY, normalBalance: NormalBalance.CREDIT, postingAllowed: false, controlType: AccountControlType.GENERAL },
  
  // 2.1 Current Liabilities
  { code: '2100', name: 'Current Liabilities', level: 2, parentCode: '2000', statementClass: StatementClass.LIABILITY, normalBalance: NormalBalance.CREDIT, postingAllowed: false, controlType: AccountControlType.GENERAL },
  { code: '2110', name: 'Payables and Accruals', level: 3, parentCode: '2100', statementClass: StatementClass.LIABILITY, normalBalance: NormalBalance.CREDIT, postingAllowed: false, controlType: AccountControlType.GENERAL },
  { code: '211001', name: 'Trade AP Control', level: 4, parentCode: '2110', statementClass: StatementClass.LIABILITY, normalBalance: NormalBalance.CREDIT, postingAllowed: true, controlType: AccountControlType.AP_CONTROL },
  { code: '211002', name: 'GRNI (Goods Received Not Invoiced)', level: 4, parentCode: '2110', statementClass: StatementClass.LIABILITY, normalBalance: NormalBalance.CREDIT, postingAllowed: true, controlType: AccountControlType.GRNI },
  { code: '211003', name: 'Accrued Expenses', level: 4, parentCode: '2110', statementClass: StatementClass.LIABILITY, normalBalance: NormalBalance.CREDIT, postingAllowed: true, controlType: AccountControlType.GENERAL },
  { code: '211004', name: 'Salaries Payable', level: 4, parentCode: '2110', statementClass: StatementClass.LIABILITY, normalBalance: NormalBalance.CREDIT, postingAllowed: true, controlType: AccountControlType.GENERAL },

  { code: '2120', name: 'Tax Payable', level: 3, parentCode: '2100', statementClass: StatementClass.LIABILITY, normalBalance: NormalBalance.CREDIT, postingAllowed: false, controlType: AccountControlType.GENERAL },
  { code: '212001', name: 'Output Sales Tax Payable', level: 4, parentCode: '2120', statementClass: StatementClass.LIABILITY, normalBalance: NormalBalance.CREDIT, postingAllowed: true, controlType: AccountControlType.TAX_PAYABLE },
  { code: '212002', name: 'Withholding Tax Payable', level: 4, parentCode: '2120', statementClass: StatementClass.LIABILITY, normalBalance: NormalBalance.CREDIT, postingAllowed: true, controlType: AccountControlType.TAX_PAYABLE },
  { code: '212003', name: 'EOBI & Social Security Payable', level: 4, parentCode: '2120', statementClass: StatementClass.LIABILITY, normalBalance: NormalBalance.CREDIT, postingAllowed: true, controlType: AccountControlType.TAX_PAYABLE },
  { code: '212004', name: 'Provident Fund Payable', level: 4, parentCode: '2120', statementClass: StatementClass.LIABILITY, normalBalance: NormalBalance.CREDIT, postingAllowed: true, controlType: AccountControlType.TAX_PAYABLE },

  // --- 3. EQUITY ---
  { code: '3000', name: 'Equity', level: 1, statementClass: StatementClass.EQUITY, normalBalance: NormalBalance.CREDIT, postingAllowed: false, controlType: AccountControlType.GENERAL },
  { code: '3100', name: 'Contributed Capital', level: 2, parentCode: '3000', statementClass: StatementClass.EQUITY, normalBalance: NormalBalance.CREDIT, postingAllowed: false, controlType: AccountControlType.GENERAL },
  { code: '3110', name: 'Owner Capital', level: 3, parentCode: '3100', statementClass: StatementClass.EQUITY, normalBalance: NormalBalance.CREDIT, postingAllowed: false, controlType: AccountControlType.GENERAL },
  { code: '311001', name: 'Share Capital', level: 4, parentCode: '3110', statementClass: StatementClass.EQUITY, normalBalance: NormalBalance.CREDIT, postingAllowed: true, controlType: AccountControlType.GENERAL },

  { code: '3200', name: 'Retained Earnings and Reserves', level: 2, parentCode: '3000', statementClass: StatementClass.EQUITY, normalBalance: NormalBalance.CREDIT, postingAllowed: false, controlType: AccountControlType.GENERAL },
  { code: '3210', name: 'Retained Earnings', level: 3, parentCode: '3200', statementClass: StatementClass.EQUITY, normalBalance: NormalBalance.CREDIT, postingAllowed: false, controlType: AccountControlType.GENERAL },
  { code: '321001', name: 'Retained Earnings', level: 4, parentCode: '3210', statementClass: StatementClass.EQUITY, normalBalance: NormalBalance.CREDIT, postingAllowed: true, controlType: AccountControlType.RETAINED_EARNINGS },

  // --- 4. REVENUE ---
  { code: '4000', name: 'Revenue', level: 1, statementClass: StatementClass.REVENUE, normalBalance: NormalBalance.CREDIT, postingAllowed: false, controlType: AccountControlType.GENERAL },
  { code: '4100', name: 'Operating Revenue', level: 2, parentCode: '4000', statementClass: StatementClass.REVENUE, normalBalance: NormalBalance.CREDIT, postingAllowed: false, controlType: AccountControlType.GENERAL },
  { code: '4110', name: 'Goods and Services Sales', level: 3, parentCode: '4100', statementClass: StatementClass.REVENUE, normalBalance: NormalBalance.CREDIT, postingAllowed: false, controlType: AccountControlType.GENERAL },
  { code: '411001', name: 'Product Sales', level: 4, parentCode: '4110', statementClass: StatementClass.REVENUE, normalBalance: NormalBalance.CREDIT, postingAllowed: true, controlType: AccountControlType.GENERAL },
  { code: '411002', name: 'Service Income', level: 4, parentCode: '4110', statementClass: StatementClass.REVENUE, normalBalance: NormalBalance.CREDIT, postingAllowed: true, controlType: AccountControlType.GENERAL },

  // --- 5. EXPENSES ---
  { code: '5000', name: 'Expenses', level: 1, statementClass: StatementClass.EXPENSE, normalBalance: NormalBalance.DEBIT, postingAllowed: false, controlType: AccountControlType.GENERAL },
  { code: '5100', name: 'Cost of Sales', level: 2, parentCode: '5000', statementClass: StatementClass.EXPENSE, normalBalance: NormalBalance.DEBIT, postingAllowed: false, controlType: AccountControlType.GENERAL },
  { code: '5110', name: 'Direct Goods Cost', level: 3, parentCode: '5100', statementClass: StatementClass.EXPENSE, normalBalance: NormalBalance.DEBIT, postingAllowed: false, controlType: AccountControlType.GENERAL },
  { code: '511001', name: 'Product COGS', level: 4, parentCode: '5110', statementClass: StatementClass.EXPENSE, normalBalance: NormalBalance.DEBIT, postingAllowed: true, controlType: AccountControlType.GENERAL },

  { code: '5200', name: 'Operating Expenses', level: 2, parentCode: '5000', statementClass: StatementClass.EXPENSE, normalBalance: NormalBalance.DEBIT, postingAllowed: false, controlType: AccountControlType.GENERAL },
  { code: '5210', name: 'General & Administrative', level: 3, parentCode: '5200', statementClass: StatementClass.EXPENSE, normalBalance: NormalBalance.DEBIT, postingAllowed: false, controlType: AccountControlType.GENERAL },
  { code: '521001', name: 'Rent Expense', level: 4, parentCode: '5210', statementClass: StatementClass.EXPENSE, normalBalance: NormalBalance.DEBIT, postingAllowed: true, controlType: AccountControlType.GENERAL },
  { code: '521002', name: 'Salaries Expense', level: 4, parentCode: '5210', statementClass: StatementClass.EXPENSE, normalBalance: NormalBalance.DEBIT, postingAllowed: true, controlType: AccountControlType.GENERAL },
  { code: '521003', name: 'Utilities Expense', level: 4, parentCode: '5210', statementClass: StatementClass.EXPENSE, normalBalance: NormalBalance.DEBIT, postingAllowed: true, controlType: AccountControlType.GENERAL },
  { code: '521004', name: 'Depreciation Expense', level: 4, parentCode: '5210', statementClass: StatementClass.EXPENSE, normalBalance: NormalBalance.DEBIT, postingAllowed: true, controlType: AccountControlType.GENERAL },

  // --- 9. TECHNICAL ACCOUNTS ---
  { code: '9000', name: 'Technical Accounts', level: 1, statementClass: StatementClass.EQUITY, normalBalance: NormalBalance.CREDIT, postingAllowed: false, controlType: AccountControlType.GENERAL },
  { code: '9100', name: 'Clearing & Suspense', level: 2, parentCode: '9000', statementClass: StatementClass.EQUITY, normalBalance: NormalBalance.CREDIT, postingAllowed: false, controlType: AccountControlType.GENERAL },
  { code: '9110', name: 'Controlled Clearing', level: 3, parentCode: '9100', statementClass: StatementClass.EQUITY, normalBalance: NormalBalance.CREDIT, postingAllowed: false, controlType: AccountControlType.GENERAL },
  { code: '911001', name: 'Opening Migration Clearing', level: 4, parentCode: '9110', statementClass: StatementClass.EQUITY, normalBalance: NormalBalance.CREDIT, postingAllowed: true, controlType: AccountControlType.SUSPENSE },
  { code: '911002', name: 'Rounding Difference Account', level: 4, parentCode: '9110', statementClass: StatementClass.EQUITY, normalBalance: NormalBalance.CREDIT, postingAllowed: true, controlType: AccountControlType.GENERAL },
];
