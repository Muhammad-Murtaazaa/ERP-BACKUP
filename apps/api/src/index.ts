import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import {
  PGliteAdapter,
  DbMigrator,
  SyntheticSeedRunner,
  AuthService,
  AuditLogger,
  OutboxService,
} from '@omnysync/platform';
import {
  Money,
  JournalValidator,
  CoaHierarchyValidator,
  PeriodManager,
  LedgerEngine,
  JournalReversalEngine,
  BankReconciliationEngine,
  FxEngine,
  PayrollEngine,
  ManufacturingEngine,
  InventoryReconciliationEngine,
  ProjectsEngine,
  FixedAssetsEngine,
  POSEngine,
} from '@omnysync/financial-engine';
import {
  ErrorCode,
  StandardErrorResponse,
  StandardSuccessResponse,
  AuthSession,
  UserRole,
  Permission,
  JournalStatus,
  AccountingPurpose,
  PeriodStatus,
  Account,
  Journal,
  JournalLine,
} from '@omnysync/contracts';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Express app initialization
const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: '*' }));
app.use(express.json());

// Initialize Database, Migrator, and Services
const db = new PGliteAdapter();
const migrator = new DbMigrator(db, path.join(__dirname, '../../packages/platform/src/db/migrations'));
const authService = new AuthService(db);
const auditLogger = new AuditLogger(db);
const outboxService = new OutboxService(db);

// Context typing
declare global {
  namespace Express {
    interface Request {
      correlationId: string;
      session?: AuthSession;
    }
  }
}

// Correlation ID & Logging Middleware with redaction
app.use((req: Request, res: Response, next: NextFunction) => {
  req.correlationId = (req.headers['x-correlation-id'] as string) || crypto.randomUUID();
  res.setHeader('x-correlation-id', req.correlationId);

  // Redacted logging
  const sanitizedBody = { ...req.body };
  if (sanitizedBody.password) sanitizedBody.password = '[REDACTED]';
  if (sanitizedBody.password_hash) sanitizedBody.password_hash = '[REDACTED]';

  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${req.correlationId}] ${req.method} ${req.originalUrl} ${res.statusCode} (${duration}ms)`);
  });

  next();
});

// Auth Middleware
const authenticate = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: {
        code: ErrorCode.UNAUTHENTICATED,
        message: 'Missing or invalid Bearer authentication token',
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  const token = authHeader.substring(7);
  const session = authService.verifySessionToken(token);
  if (!session) {
    return res.status(401).json({
      success: false,
      error: {
        code: ErrorCode.UNAUTHENTICATED,
        message: 'Invalid or expired session token',
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  req.session = session;
  next();
};

const requirePermission = (permission: Permission) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.session) {
      return res.status(401).json({
        success: false,
        error: {
          code: ErrorCode.UNAUTHENTICATED,
          message: 'Authentication required',
          correlation_id: req.correlationId,
        },
      } satisfies StandardErrorResponse);
    }

    if (!AuthService.hasPermission(req.session, permission)) {
      return res.status(403).json({
        success: false,
        error: {
          code: ErrorCode.UNAUTHORIZED,
          message: `Forbidden: Missing required permission "${permission}"`,
          correlation_id: req.correlationId,
        },
      } satisfies StandardErrorResponse);
    }

    next();
  };
};

// ==========================================
// 1. Auth Routes
// ==========================================
app.post('/api/auth/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({
      success: false,
      error: {
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Email and password are required',
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  const userQuery = await db.query(
    `
    SELECT u.id, u.email, u.name, u.password_hash, m.organization_id, m.legal_entity_id, m.roles
    FROM users u
    JOIN memberships m ON m.user_id = u.id
    WHERE u.email = $1 AND u.is_active = true AND m.is_active = true
  `,
    [email.toLowerCase().trim()],
  );

  if (userQuery.rows.length === 0) {
    return res.status(401).json({
      success: false,
      error: {
        code: ErrorCode.UNAUTHENTICATED,
        message: 'Invalid email or credentials',
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  const userRow = userQuery.rows[0];
  const isValidPass = AuthService.verifyPassword(password, userRow.password_hash);
  if (!isValidPass) {
    return res.status(401).json({
      success: false,
      error: {
        code: ErrorCode.UNAUTHENTICATED,
        message: 'Invalid email or credentials',
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  const roles = (typeof userRow.roles === 'string' ? JSON.parse(userRow.roles) : userRow.roles) as UserRole[];
  const permissions = AuthService.resolvePermissions(roles);

  const session: AuthSession = {
    user_id: userRow.id,
    email: userRow.email,
    name: userRow.name,
    organization_id: userRow.organization_id,
    legal_entity_id: userRow.legal_entity_id,
    roles,
    permissions,
  };

  const token = authService.generateSessionToken(session);

  return res.json({
    success: true,
    data: {
      token,
      user: session,
    },
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
    },
  } satisfies StandardSuccessResponse<any>);
});

app.get('/api/auth/me', authenticate, (req: Request, res: Response) => {
  return res.json({
    success: true,
    data: req.session,
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
    },
  } satisfies StandardSuccessResponse<any>);
});

// ==========================================
// 2. Organization & Master Data
// ==========================================
app.get('/api/orgs/context', authenticate, async (req: Request, res: Response) => {
  const orgRes = await db.query('SELECT * FROM organizations WHERE id = $1', [req.session!.organization_id]);
  const leRes = await db.query('SELECT * FROM legal_entities WHERE organization_id = $1', [req.session!.organization_id]);
  const branchRes = await db.query('SELECT * FROM branches WHERE organization_id = $1', [req.session!.organization_id]);

  return res.json({
    success: true,
    data: {
      organization: orgRes.rows[0] || null,
      legalEntities: leRes.rows,
      branches: branchRes.rows,
    },
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
    },
  } satisfies StandardSuccessResponse<any>);
});

// ==========================================
// 3. Chart of Accounts (COA)
// ==========================================
app.get('/api/coa/accounts', authenticate, async (req: Request, res: Response) => {
  const accountsRes = await db.query<Account>(
    'SELECT * FROM accounts WHERE organization_id = $1 ORDER BY code ASC',
    [req.session!.organization_id],
  );

  return res.json({
    success: true,
    data: accountsRes.rows,
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
      total_count: accountsRes.rows.length,
    },
  } satisfies StandardSuccessResponse<Account[]>);
});

app.get('/api/coa/tree', authenticate, async (req: Request, res: Response) => {
  const accountsRes = await db.query<Account>(
    'SELECT * FROM accounts WHERE organization_id = $1 ORDER BY code ASC',
    [req.session!.organization_id],
  );

  const tree = CoaHierarchyValidator.buildTree(accountsRes.rows);

  return res.json({
    success: true,
    data: tree,
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
    },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/coa/accounts', authenticate, requirePermission(Permission.FINANCE_COA_MANAGE), async (req: Request, res: Response) => {
  const { code, name, parent_id, level, statement_class, normal_balance, posting_allowed, control_type, currency_restriction } = req.body;

  let parent: Account | null = null;
  if (parent_id) {
    const parentQuery = await db.query<Account>('SELECT * FROM accounts WHERE id = $1 AND organization_id = $2', [
      parent_id,
      req.session!.organization_id,
    ]);
    parent = parentQuery.rows[0] || null;
  }

  const validation = CoaHierarchyValidator.validateAccount(
    { level, parent_id, statement_class, normal_balance, posting_allowed },
    parent,
  );

  if (!validation.valid) {
    return res.status(400).json({
      success: false,
      error: {
        code: ErrorCode.VALIDATION_FAILED,
        message: validation.error || 'Invalid account hierarchy parameters',
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  const accountId = crypto.randomUUID();
  await db.query(
    `
    INSERT INTO accounts (
      id, organization_id, legal_entity_id, code, name, parent_id, level,
      statement_class, normal_balance, posting_allowed, control_type, currency_restriction, is_active
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true)
  `,
    [
      accountId,
      req.session!.organization_id,
      req.session!.legal_entity_id,
      code,
      name,
      parent_id || null,
      level,
      statement_class,
      normal_balance,
      posting_allowed,
      control_type || 'GENERAL',
      currency_restriction || null,
    ],
  );

  await auditLogger.record({
    organization_id: req.session!.organization_id,
    user_id: req.session!.user_id,
    action: 'COA_ACCOUNT_CREATED',
    entity_type: 'ACCOUNT',
    entity_id: accountId,
    after_state: req.body,
    correlation_id: req.correlationId,
  });

  return res.status(201).json({
    success: true,
    data: { id: accountId, code, name, level },
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
    },
  } satisfies StandardSuccessResponse<any>);
});

// ==========================================
// 4. Fiscal Periods
// ==========================================
app.get('/api/periods', authenticate, async (req: Request, res: Response) => {
  const periodsRes = await db.query(
    'SELECT * FROM fiscal_periods WHERE organization_id = $1 ORDER BY fiscal_year ASC, period_number ASC',
    [req.session!.organization_id],
  );

  return res.json({
    success: true,
    data: periodsRes.rows,
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
    },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/periods/:id/status', authenticate, requirePermission(Permission.FINANCE_PERIOD_MANAGE), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['OPEN', 'SOFT_CLOSED', 'HARD_CLOSED'].includes(status)) {
    return res.status(400).json({
      success: false,
      error: {
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Status must be OPEN, SOFT_CLOSED, or HARD_CLOSED',
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  const existingPeriod = await db.query('SELECT * FROM fiscal_periods WHERE id = $1 AND organization_id = $2', [
    id,
    req.session!.organization_id,
  ]);

  if (existingPeriod.rows.length === 0) {
    return res.status(404).json({
      success: false,
      error: {
        code: ErrorCode.RESOURCE_NOT_FOUND,
        message: 'Fiscal period not found',
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  await db.query('UPDATE fiscal_periods SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [status, id]);

  await auditLogger.record({
    organization_id: req.session!.organization_id,
    user_id: req.session!.user_id,
    action: 'PERIOD_STATUS_CHANGED',
    entity_type: 'FISCAL_PERIOD',
    entity_id: id,
    before_state: existingPeriod.rows[0],
    after_state: { status },
    correlation_id: req.correlationId,
  });

  return res.json({
    success: true,
    data: { id, status },
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
    },
  } satisfies StandardSuccessResponse<any>);
});

// ==========================================
// 5. Journals & Immutable Posting Workflow
// ==========================================
app.get('/api/journals', authenticate, async (req: Request, res: Response) => {
  const { status, search } = req.query;

  let sql = `
    SELECT j.*, u.name as creator_name
    FROM journals j
    LEFT JOIN users u ON u.id = j.created_by
    WHERE j.organization_id = $1
  `;
  const params: any[] = [req.session!.organization_id];

  if (status) {
    params.push(status);
    sql += ` AND j.status = $${params.length}`;
  }
  if (search) {
    params.push(`%${search}%`);
    sql += ` AND (j.journal_number ILIKE $${params.length} OR j.description ILIKE $${params.length})`;
  }

  sql += ` ORDER BY j.posting_date DESC, j.created_at DESC LIMIT 100`;

  const journalsRes = await db.query(sql, params);

  return res.json({
    success: true,
    data: journalsRes.rows,
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
      total_count: journalsRes.rows.length,
    },
  } satisfies StandardSuccessResponse<any>);
});

app.get('/api/journals/:id', authenticate, async (req: Request, res: Response) => {
  const { id } = req.params;
  const journalRes = await db.query('SELECT * FROM journals WHERE id = $1 AND organization_id = $2', [
    id,
    req.session!.organization_id,
  ]);

  if (journalRes.rows.length === 0) {
    return res.status(404).json({
      success: false,
      error: {
        code: ErrorCode.RESOURCE_NOT_FOUND,
        message: 'Journal entry not found',
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  const linesRes = await db.query(
    `
    SELECT jl.*, a.code as account_code, a.name as account_name, a.level as account_level
    FROM journal_lines jl
    JOIN accounts a ON a.id = jl.account_id
    WHERE jl.journal_id = $1
    ORDER BY jl.line_number ASC
  `,
    [id],
  );

  return res.json({
    success: true,
    data: {
      ...journalRes.rows[0],
      lines: linesRes.rows,
    },
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
    },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/journals/draft', authenticate, requirePermission(Permission.FINANCE_JOURNAL_CREATE), async (req: Request, res: Response) => {
  const { posting_date, document_date, description, lines, accounting_purpose } = req.body;

  // Retrieve accounts map for validation
  const accountsRes = await db.query<Account>('SELECT * FROM accounts WHERE organization_id = $1', [
    req.session!.organization_id,
  ]);
  const accountMap = new Map(accountsRes.rows.map((a) => [a.id, a]));

  const validation = JournalValidator.validate(lines || [], accountMap);
  if (!validation.isValid) {
    return res.status(400).json({
      success: false,
      error: {
        code: ErrorCode.JOURNAL_UNBALANCED,
        message: validation.errors.join('; '),
        correlation_id: req.correlationId,
        details: validation.errors,
      },
    } satisfies StandardErrorResponse);
  }

  const journalId = crypto.randomUUID();
  const journalNumber = `JV-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;

  await db.transaction(async (tx) => {
    await tx.query(
      `
      INSERT INTO journals (
        id, organization_id, legal_entity_id, journal_number, posting_date, document_date,
        accounting_purpose, status, base_currency, total_base_debit, total_base_credit,
        description, created_by, revision
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'DRAFT', 'PKR', $8, $9, $10, $11, 1)
    `,
      [
        journalId,
        req.session!.organization_id,
        req.session!.legal_entity_id,
        journalNumber,
        posting_date,
        document_date,
        accounting_purpose || AccountingPurpose.MANUAL_JOURNAL,
        validation.totalDebit.toFixed(8),
        validation.totalCredit.toFixed(8),
        description,
        req.session!.user_id,
      ],
    );

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const lineId = crypto.randomUUID();
      await tx.query(
        `
        INSERT INTO journal_lines (
          id, journal_id, line_number, account_id, debit_amount, credit_amount,
          currency, fx_rate, base_debit, base_credit, description
        ) VALUES ($1, $2, $3, $4, $5, $6, 'PKR', 1.0, $7, $8, $9)
      `,
        [
          lineId,
          journalId,
          i + 1,
          l.account_id,
          l.debit_amount || '0',
          l.credit_amount || '0',
          l.base_debit || l.debit_amount || '0',
          l.base_credit || l.credit_amount || '0',
          l.description || null,
        ],
      );
    }
  });

  await auditLogger.record({
    organization_id: req.session!.organization_id,
    user_id: req.session!.user_id,
    action: 'JOURNAL_DRAFT_CREATED',
    entity_type: 'JOURNAL',
    entity_id: journalId,
    after_state: { journalId, journalNumber, linesCount: lines.length },
    correlation_id: req.correlationId,
  });

  return res.status(201).json({
    success: true,
    data: { id: journalId, journal_number: journalNumber, status: 'DRAFT' },
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
    },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/journals/:id/submit', authenticate, requirePermission(Permission.FINANCE_JOURNAL_SUBMIT), async (req: Request, res: Response) => {
  const { id } = req.params;
  const journalRes = await db.query('SELECT * FROM journals WHERE id = $1 AND organization_id = $2', [
    id,
    req.session!.organization_id,
  ]);

  if (journalRes.rows.length === 0) {
    return res.status(404).json({
      success: false,
      error: {
        code: ErrorCode.RESOURCE_NOT_FOUND,
        message: 'Journal entry not found',
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  const j = journalRes.rows[0];
  if (j.status !== 'DRAFT') {
    return res.status(400).json({
      success: false,
      error: {
        code: ErrorCode.VALIDATION_FAILED,
        message: `Only DRAFT journals can be submitted, current status is "${j.status}"`,
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  await db.query(
    'UPDATE journals SET status = $1, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
    [JournalStatus.SUBMITTED, id],
  );

  return res.json({
    success: true,
    data: { id, status: JournalStatus.SUBMITTED },
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
    },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/journals/:id/approve', authenticate, requirePermission(Permission.FINANCE_JOURNAL_APPROVE), async (req: Request, res: Response) => {
  const { id } = req.params;
  const journalRes = await db.query('SELECT * FROM journals WHERE id = $1 AND organization_id = $2', [
    id,
    req.session!.organization_id,
  ]);

  if (journalRes.rows.length === 0) {
    return res.status(404).json({
      success: false,
      error: {
        code: ErrorCode.RESOURCE_NOT_FOUND,
        message: 'Journal entry not found',
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  const j = journalRes.rows[0];
  if (j.status !== 'SUBMITTED') {
    return res.status(400).json({
      success: false,
      error: {
        code: ErrorCode.VALIDATION_FAILED,
        message: `Only SUBMITTED journals can be approved, current status is "${j.status}"`,
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  await db.query(
    'UPDATE journals SET status = $1, approved_by = $2, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
    [JournalStatus.APPROVED, req.session!.user_id, id],
  );

  return res.json({
    success: true,
    data: { id, status: JournalStatus.APPROVED },
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
    },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/journals/:id/post', authenticate, requirePermission(Permission.FINANCE_JOURNAL_POST), async (req: Request, res: Response) => {
  const { id } = req.params;

  const journalRes = await db.query('SELECT * FROM journals WHERE id = $1 AND organization_id = $2', [
    id,
    req.session!.organization_id,
  ]);

  if (journalRes.rows.length === 0) {
    return res.status(404).json({
      success: false,
      error: {
        code: ErrorCode.RESOURCE_NOT_FOUND,
        message: 'Journal entry not found',
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  const j = journalRes.rows[0];
  if (j.status === JournalStatus.POSTED) {
    return res.status(400).json({
      success: false,
      error: {
        code: ErrorCode.ALREADY_POSTED,
        message: 'This journal is already POSTED',
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  // 1. Period Guard Check
  const periodsRes = await db.query('SELECT * FROM fiscal_periods WHERE legal_entity_id = $1', [j.legal_entity_id]);
  const period = PeriodManager.findPeriodForDate(periodsRes.rows, j.posting_date);
  const periodCheck = PeriodManager.assertPostingAllowed(period, j.posting_date);

  if (!periodCheck.allowed) {
    return res.status(400).json({
      success: false,
      error: {
        code: ErrorCode.PERIOD_CLOSED,
        message: periodCheck.error || 'Fiscal period closed for posting',
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  // 2. Fetch lines & accounts to re-verify accounting balance
  const linesRes = await db.query<JournalLine>('SELECT * FROM journal_lines WHERE journal_id = $1', [id]);
  const accountsRes = await db.query<Account>('SELECT * FROM accounts WHERE organization_id = $1', [
    req.session!.organization_id,
  ]);
  const accountMap = new Map(accountsRes.rows.map((a) => [a.id, a]));

  const validation = JournalValidator.validate(linesRes.rows, accountMap);
  if (!validation.isValid) {
    return res.status(400).json({
      success: false,
      error: {
        code: ErrorCode.JOURNAL_UNBALANCED,
        message: validation.errors.join('; '),
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  // 3. Atomically Post, Record Audit, and Emit Outbox Event
  await db.transaction(async (tx) => {
    await tx.query(
      `
      UPDATE journals
      SET status = $1, posted_by = $2, posted_at = CURRENT_TIMESTAMP, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
    `,
      [JournalStatus.POSTED, req.session!.user_id, id],
    );

    await outboxService.emit(
      {
        organization_id: req.session!.organization_id,
        event_type: 'JOURNAL_POSTED',
        payload: {
          journal_id: id,
          journal_number: j.journal_number,
          total_base_debit: j.total_base_debit,
          posted_by: req.session!.user_id,
        },
      },
      tx,
    );

    await auditLogger.record(
      {
        organization_id: req.session!.organization_id,
        user_id: req.session!.user_id,
        action: 'JOURNAL_POSTED',
        entity_type: 'JOURNAL',
        entity_id: id,
        before_state: { status: j.status },
        after_state: { status: JournalStatus.POSTED, posted_by: req.session!.user_id },
        correlation_id: req.correlationId,
      },
      tx,
    );
  });

  return res.json({
    success: true,
    data: { id, status: JournalStatus.POSTED, journal_number: j.journal_number },
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
    },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/journals/:id/reverse', authenticate, requirePermission(Permission.FINANCE_JOURNAL_REVERSE), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { reversal_posting_date, reason } = req.body;

  if (!reversal_posting_date || !reason) {
    return res.status(400).json({
      success: false,
      error: {
        code: ErrorCode.VALIDATION_FAILED,
        message: 'reversal_posting_date and reason are required',
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  const journalRes = await db.query('SELECT * FROM journals WHERE id = $1 AND organization_id = $2', [
    id,
    req.session!.organization_id,
  ]);

  if (journalRes.rows.length === 0) {
    return res.status(404).json({
      success: false,
      error: {
        code: ErrorCode.RESOURCE_NOT_FOUND,
        message: 'Journal not found',
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  const originalJournal: Journal = journalRes.rows[0];
  const linesRes = await db.query<JournalLine>('SELECT * FROM journal_lines WHERE journal_id = $1', [id]);
  originalJournal.lines = linesRes.rows;

  let reversalData: ReturnType<typeof JournalReversalEngine.createLinkedReversal>;
  try {
    reversalData = JournalReversalEngine.createLinkedReversal({
      originalJournal,
      reversalPostingDate: reversal_posting_date,
      reversalDocumentDate: reversal_posting_date,
      reason,
      reversingUserId: req.session!.user_id,
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: {
        code: ErrorCode.ALREADY_REVERSED,
        message: err.message,
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  const rev = reversalData.reversalJournal;
  const reversalJournalId = crypto.randomUUID();

  await db.transaction(async (tx) => {
    // 1. Insert Reversal Journal
    await tx.query(
      `
      INSERT INTO journals (
        id, organization_id, legal_entity_id, journal_number, posting_date, document_date,
        accounting_purpose, status, base_currency, total_base_debit, total_base_credit,
        description, source_type, source_id, reversal_of_journal_id, created_by, posted_by, posted_at, revision
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, CURRENT_TIMESTAMP, 1)
    `,
      [
        reversalJournalId,
        rev.organization_id,
        rev.legal_entity_id,
        rev.journal_number,
        rev.posting_date,
        rev.document_date,
        rev.accounting_purpose,
        JournalStatus.POSTED,
        rev.base_currency,
        rev.total_base_debit,
        rev.total_base_credit,
        rev.description,
        rev.source_type,
        rev.source_id,
        rev.reversal_of_journal_id,
        req.session!.user_id,
        req.session!.user_id,
      ],
    );

    // 2. Insert Reversal Lines
    for (let i = 0; i < rev.lines.length; i++) {
      const l = rev.lines[i];
      const lineId = crypto.randomUUID();
      await tx.query(
        `
        INSERT INTO journal_lines (
          id, journal_id, line_number, account_id, debit_amount, credit_amount,
          currency, fx_rate, base_debit, base_credit, description
        ) VALUES ($1, $2, $3, $4, $5, $6, 'PKR', 1.0, $7, $8, $9)
      `,
        [lineId, reversalJournalId, i + 1, l.account_id, l.debit_amount, l.credit_amount, l.base_debit, l.base_credit, l.description],
      );
    }

    // 3. Mark original journal as reversed
    await tx.query(
      'UPDATE journals SET reversed_by_journal_id = $1, status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
      [reversalJournalId, JournalStatus.REVERSED, originalJournal.id],
    );

    // 4. Record Audit
    await auditLogger.record(
      {
        organization_id: req.session!.organization_id,
        user_id: req.session!.user_id,
        action: 'JOURNAL_REVERSED',
        entity_type: 'JOURNAL',
        entity_id: originalJournal.id,
        after_state: { reversalJournalId, reason },
        correlation_id: req.correlationId,
      },
      tx,
    );
  });

  return res.status(201).json({
    success: true,
    data: {
      original_journal_id: originalJournal.id,
      reversal_journal_id: reversalJournalId,
      status: JournalStatus.REVERSED,
    },
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
    },
  } satisfies StandardSuccessResponse<any>);
});

// ==========================================
// 6. General Ledger & Trial Balance
// ==========================================
app.get('/api/ledger/trial-balance', authenticate, requirePermission(Permission.FINANCE_REPORTS_VIEW), async (req: Request, res: Response) => {
  const asOfDate = (req.query.as_of_date as string) || new Date().toISOString().slice(0, 10);

  const accountsRes = await db.query<Account>('SELECT * FROM accounts WHERE organization_id = $1 ORDER BY code ASC', [
    req.session!.organization_id,
  ]);

  const postedLinesRes = await db.query<JournalLine>(
    `
    SELECT jl.*
    FROM journal_lines jl
    JOIN journals j ON j.id = jl.journal_id
    WHERE j.organization_id = $1 AND j.status IN ('POSTED', 'REVERSED') AND j.posting_date <= $2
  `,
    [req.session!.organization_id, asOfDate],
  );

  const report = LedgerEngine.computeTrialBalance(
    accountsRes.rows,
    postedLinesRes.rows,
    asOfDate,
    req.session!.legal_entity_id,
    'PKR',
  );

  return res.json({
    success: true,
    data: report,
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
    },
  } satisfies StandardSuccessResponse<any>);
});

// ==========================================
// 7. Audit Log Inspector
// ==========================================
app.get('/api/audit/logs', authenticate, requirePermission(Permission.AUDIT_VIEW), async (req: Request, res: Response) => {
  const logs = await auditLogger.queryLogs(req.session!.organization_id);

  return res.json({
    success: true,
    data: logs,
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
      total_count: logs.length,
    },
  } satisfies StandardSuccessResponse<any>);
});

// ==========================================
// 8. M2: Parties (Customers & Vendors)
// ==========================================
app.get('/api/parties', authenticate, async (req: Request, res: Response) => {
  const { type, search } = req.query;
  let sql = 'SELECT * FROM parties WHERE organization_id = $1 AND is_active = true';
  const params: any[] = [req.session!.organization_id];

  if (type) {
    params.push(type);
    sql += ` AND (party_type = $${params.length} OR party_type = 'BOTH')`;
  }
  if (search) {
    params.push(`%${search}%`);
    sql += ` AND (name ILIKE $${params.length} OR code ILIKE $${params.length})`;
  }

  sql += ' ORDER BY name ASC';
  const partiesRes = await db.query(sql, params);

  return res.json({
    success: true,
    data: partiesRes.rows,
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
      total_count: partiesRes.rows.length,
    },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/parties', authenticate, requirePermission(Permission.PARTIES_MANAGE), async (req: Request, res: Response) => {
  const { code, name, party_type, tax_identifier, email, phone, address, credit_limit } = req.body;

  if (!code || !name || !party_type) {
    return res.status(400).json({
      success: false,
      error: {
        code: ErrorCode.VALIDATION_FAILED,
        message: 'code, name, and party_type are required',
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  const id = crypto.randomUUID();
  await db.query(
    `
    INSERT INTO parties (
      id, organization_id, legal_entity_id, code, name, party_type,
      tax_identifier, email, phone, address, credit_limit, is_active
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)
  `,
    [
      id,
      req.session!.organization_id,
      req.session!.legal_entity_id,
      code,
      name,
      party_type,
      tax_identifier || null,
      email || null,
      phone || null,
      address || null,
      credit_limit || '0',
    ],
  );

  return res.status(201).json({
    success: true,
    data: { id, code, name, party_type },
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
    },
  } satisfies StandardSuccessResponse<any>);
});

// ==========================================
// 9. M2: Items & Inventory Catalog
// ==========================================
app.get('/api/items', authenticate, async (req: Request, res: Response) => {
  const itemsRes = await db.query(
    `
    SELECT i.*, 
      COALESCE((SELECT SUM(quantity) FROM stock_movements sm WHERE sm.item_id = i.id), 0) as on_hand_qty
    FROM items i
    WHERE i.organization_id = $1 AND i.is_active = true
    ORDER BY i.name ASC
  `,
    [req.session!.organization_id],
  );

  return res.json({
    success: true,
    data: itemsRes.rows,
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
      total_count: itemsRes.rows.length,
    },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/items', authenticate, requirePermission(Permission.ITEMS_MANAGE), async (req: Request, res: Response) => {
  const { code, name, item_type, uom, unit_price, unit_cost, sales_account_id, cogs_account_id, inventory_account_id } = req.body;

  if (!code || !name) {
    return res.status(400).json({
      success: false,
      error: {
        code: ErrorCode.VALIDATION_FAILED,
        message: 'code and name are required',
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  const id = crypto.randomUUID();
  await db.query(
    `
    INSERT INTO items (
      id, organization_id, legal_entity_id, code, name, item_type, uom,
      unit_price, unit_cost, sales_account_id, cogs_account_id, inventory_account_id, is_active
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true)
  `,
    [
      id,
      req.session!.organization_id,
      req.session!.legal_entity_id,
      code,
      name,
      item_type || 'INVENTORY',
      uom || 'UNIT',
      unit_price || '0',
      unit_cost || '0',
      sales_account_id || null,
      cogs_account_id || null,
      inventory_account_id || null,
    ],
  );

  return res.status(201).json({
    success: true,
    data: { id, code, name },
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
    },
  } satisfies StandardSuccessResponse<any>);
});

app.get('/api/inventory/stock', authenticate, async (req: Request, res: Response) => {
  const stockRes = await db.query(
    `
    SELECT 
      i.id as item_id,
      i.code as item_code,
      i.name as item_name,
      i.uom,
      i.unit_cost,
      i.unit_price,
      COALESCE(SUM(sm.quantity), 0) as on_hand_qty,
      COALESCE(SUM(sm.total_value), 0) as total_valuation
    FROM items i
    LEFT JOIN stock_movements sm ON sm.item_id = i.id
    WHERE i.organization_id = $1 AND i.item_type = 'INVENTORY'
    GROUP BY i.id, i.code, i.name, i.uom, i.unit_cost, i.unit_price
    ORDER BY i.name ASC
  `,
    [req.session!.organization_id],
  );

  return res.json({
    success: true,
    data: stockRes.rows,
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
      total_count: stockRes.rows.length,
    },
  } satisfies StandardSuccessResponse<any>);
});

// ==========================================
// 10. M2: Sales Orders & Fulfillments
// ==========================================
app.get('/api/sales/orders', authenticate, async (req: Request, res: Response) => {
  const ordersRes = await db.query(
    `
    SELECT so.*, p.name as party_name, p.code as party_code
    FROM sales_orders so
    JOIN parties p ON p.id = so.party_id
    WHERE so.organization_id = $1
    ORDER BY so.order_date DESC, so.created_at DESC
  `,
    [req.session!.organization_id],
  );

  return res.json({
    success: true,
    data: ordersRes.rows,
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
      total_count: ordersRes.rows.length,
    },
  } satisfies StandardSuccessResponse<any>);
});

app.get('/api/sales/orders/:id', authenticate, async (req: Request, res: Response) => {
  const { id } = req.params;
  const orderRes = await db.query(
    `
    SELECT so.*, p.name as party_name, p.code as party_code
    FROM sales_orders so
    JOIN parties p ON p.id = so.party_id
    WHERE so.id = $1 AND so.organization_id = $2
  `,
    [id, req.session!.organization_id],
  );

  if (orderRes.rows.length === 0) {
    return res.status(404).json({
      success: false,
      error: {
        code: ErrorCode.RESOURCE_NOT_FOUND,
        message: 'Sales order not found',
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  const linesRes = await db.query(
    `
    SELECT sol.*, i.code as item_code, i.name as item_name, i.uom
    FROM sales_order_lines sol
    JOIN items i ON i.id = sol.item_id
    WHERE sol.sales_order_id = $1
    ORDER BY sol.line_number ASC
  `,
    [id],
  );

  return res.json({
    success: true,
    data: {
      ...orderRes.rows[0],
      lines: linesRes.rows,
    },
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
    },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/sales/orders', authenticate, requirePermission(Permission.SALES_ORDER_MANAGE), async (req: Request, res: Response) => {
  const { party_id, order_date, delivery_date, lines, notes } = req.body;

  if (!party_id || !lines || lines.length === 0) {
    return res.status(400).json({
      success: false,
      error: {
        code: ErrorCode.VALIDATION_FAILED,
        message: 'party_id and at least 1 line are required',
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  let subtotal = Money.zero();
  for (const l of lines) {
    const qty = new Money(l.quantity || '0');
    const price = new Money(l.unit_price || '0');
    subtotal = subtotal.add(qty.mul(price));
  }

  const orderId = crypto.randomUUID();
  const orderNumber = `SO-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`;

  await db.transaction(async (tx) => {
    await tx.query(
      `
      INSERT INTO sales_orders (
        id, organization_id, legal_entity_id, party_id, order_number, order_date,
        delivery_date, status, subtotal, tax_amount, total_amount, notes, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'DRAFT', $8, 0, $8, $9, $10)
    `,
      [
        orderId,
        req.session!.organization_id,
        req.session!.legal_entity_id,
        party_id,
        orderNumber,
        order_date || new Date().toISOString().slice(0, 10),
        delivery_date || null,
        subtotal.toFixed(8),
        notes || null,
        req.session!.user_id,
      ],
    );

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const lineId = crypto.randomUUID();
      const lineTotal = new Money(l.quantity).mul(new Money(l.unit_price)).toFixed(8);

      await tx.query(
        `
        INSERT INTO sales_order_lines (
          id, sales_order_id, line_number, item_id, quantity, unit_price, line_total, description
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
        [lineId, orderId, i + 1, l.item_id, l.quantity, l.unit_price, lineTotal, l.description || null],
      );
    }
  });

  return res.status(201).json({
    success: true,
    data: { id: orderId, order_number: orderNumber, status: 'DRAFT', subtotal: subtotal.toFixed(2) },
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
    },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/sales/orders/:id/confirm', authenticate, requirePermission(Permission.SALES_ORDER_MANAGE), async (req: Request, res: Response) => {
  const { id } = req.params;
  await db.query("UPDATE sales_orders SET status = 'CONFIRMED', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [id]);

  return res.json({
    success: true,
    data: { id, status: 'CONFIRMED' },
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
    },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/sales/orders/:id/fulfill', authenticate, requirePermission(Permission.INVENTORY_MANAGE), async (req: Request, res: Response) => {
  const { id } = req.params;

  const orderRes = await db.query('SELECT * FROM sales_orders WHERE id = $1 AND organization_id = $2', [
    id,
    req.session!.organization_id,
  ]);
  if (orderRes.rows.length === 0) {
    return res.status(404).json({
      success: false,
      error: {
        code: ErrorCode.RESOURCE_NOT_FOUND,
        message: 'Sales order not found',
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  const order = orderRes.rows[0];
  const linesRes = await db.query(
    'SELECT sol.*, i.item_type, i.unit_cost, i.cogs_account_id, i.inventory_account_id FROM sales_order_lines sol JOIN items i ON i.id = sol.item_id WHERE sol.sales_order_id = $1',
    [id],
  );

  let totalCogs = Money.zero();
  const branchRow = await db.query('SELECT id FROM branches WHERE organization_id = $1 LIMIT 1', [req.session!.organization_id]);
  const branchId = branchRow.rows[0]?.id;

  await db.transaction(async (tx) => {
    for (const line of linesRes.rows) {
      if (line.item_type === 'INVENTORY') {
        const qty = parseFloat(line.quantity);
        const cost = new Money(line.unit_cost || '0');
        const lineVal = cost.mul(qty);
        totalCogs = totalCogs.add(lineVal);

        // Record stock movement (SHIPMENT negative qty)
        const smId = crypto.randomUUID();
        await tx.query(
          `
          INSERT INTO stock_movements (
            id, organization_id, legal_entity_id, item_id, warehouse_id,
            movement_type, movement_date, quantity, unit_cost, total_value, reference_type, reference_id, description
          ) VALUES ($1, $2, $3, $4, $5, 'SHIPMENT', CURRENT_DATE, $6, $7, $8, 'SALES_ORDER', $9, 'Sales Order Shipment')
        `,
          [smId, req.session!.organization_id, req.session!.legal_entity_id, line.item_id, branchId, -qty, cost.toFixed(8), -parseFloat(lineVal.toFixed(8)), id],
        );

        await tx.query(
          'UPDATE sales_order_lines SET fulfilled_quantity = quantity WHERE id = $1',
          [line.id],
        );
      }
    }

    await tx.query("UPDATE sales_orders SET status = 'FULFILLED', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [id]);

    // If inventory COGS applies, post GL journal voucher
    if (totalCogs.isPositive()) {
      const cogsAccRes = await tx.query("SELECT id FROM accounts WHERE code = '511001' AND organization_id = $1", [req.session!.organization_id]);
      const invAccRes = await tx.query("SELECT id FROM accounts WHERE code = '113001' AND organization_id = $1", [req.session!.organization_id]);

      if (cogsAccRes.rows[0] && invAccRes.rows[0]) {
        const jId = crypto.randomUUID();
        const jNum = `JV-COGS-${Date.now().toString().slice(-6)}`;
        await tx.query(
          `
          INSERT INTO journals (
            id, organization_id, legal_entity_id, journal_number, posting_date, document_date,
            accounting_purpose, status, base_currency, total_base_debit, total_base_credit,
            description, source_type, source_id, created_by, posted_by, posted_at
          ) VALUES ($1, $2, $3, $4, CURRENT_DATE, CURRENT_DATE, 'INVENTORY_ISSUE', 'POSTED', 'PKR', $5, $5, $6, 'SALES_ORDER', $7, $8, $8, CURRENT_TIMESTAMP)
        `,
          [jId, req.session!.organization_id, req.session!.legal_entity_id, jNum, totalCogs.toFixed(8), `COGS for order ${order.order_number}`, id, req.session!.user_id],
        );

        // Lines: Dr COGS, Cr Inventory
        await tx.query(
          `
          INSERT INTO journal_lines (id, journal_id, line_number, account_id, debit_amount, credit_amount, base_debit, base_credit, description)
          VALUES 
            ($1, $2, 1, $3, $4, 0, $4, 0, 'Cost of goods sold'),
            ($5, $2, 2, $6, 0, $4, 0, $4, 'Inventory decrease')
        `,
          [crypto.randomUUID(), jId, cogsAccRes.rows[0].id, totalCogs.toFixed(8), crypto.randomUUID(), invAccRes.rows[0].id],
        );
      }
    }
  });

  return res.json({
    success: true,
    data: { id, status: 'FULFILLED' },
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
    },
  } satisfies StandardSuccessResponse<any>);
});

// ==========================================
// 11. M2: Customer Invoicing (AR Billing)
// ==========================================
app.get('/api/ar/invoices', authenticate, async (req: Request, res: Response) => {
  const invRes = await db.query(
    `
    SELECT inv.*, p.name as party_name, p.code as party_code
    FROM ar_invoices inv
    JOIN parties p ON p.id = inv.party_id
    WHERE inv.organization_id = $1
    ORDER BY inv.invoice_date DESC, inv.created_at DESC
  `,
    [req.session!.organization_id],
  );

  return res.json({
    success: true,
    data: invRes.rows,
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
      total_count: invRes.rows.length,
    },
  } satisfies StandardSuccessResponse<any>);
});

app.get('/api/ar/invoices/:id', authenticate, async (req: Request, res: Response) => {
  const { id } = req.params;
  const invRes = await db.query(
    `
    SELECT inv.*, p.name as party_name, p.code as party_code
    FROM ar_invoices inv
    JOIN parties p ON p.id = inv.party_id
    WHERE inv.id = $1 AND inv.organization_id = $2
  `,
    [id, req.session!.organization_id],
  );

  if (invRes.rows.length === 0) {
    return res.status(404).json({
      success: false,
      error: {
        code: ErrorCode.RESOURCE_NOT_FOUND,
        message: 'AR Invoice not found',
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  const linesRes = await db.query(
    `
    SELECT il.*, i.code as item_code, i.name as item_name
    FROM ar_invoice_lines il
    JOIN items i ON i.id = il.item_id
    WHERE il.invoice_id = $1
    ORDER BY il.line_number ASC
  `,
    [id],
  );

  return res.json({
    success: true,
    data: {
      ...invRes.rows[0],
      lines: linesRes.rows,
    },
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
    },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/ar/invoices', authenticate, requirePermission(Permission.AR_INVOICE_MANAGE), async (req: Request, res: Response) => {
  const { party_id, sales_order_id, invoice_date, due_date, lines, notes } = req.body;

  if (!party_id || !lines || lines.length === 0) {
    return res.status(400).json({
      success: false,
      error: {
        code: ErrorCode.VALIDATION_FAILED,
        message: 'party_id and at least 1 line are required',
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  let subtotal = Money.zero();
  for (const l of lines) {
    const qty = new Money(l.quantity || '0');
    const price = new Money(l.unit_price || '0');
    subtotal = subtotal.add(qty.mul(price));
  }

  const invoiceId = crypto.randomUUID();
  const invoiceNumber = `INV-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`;

  await db.transaction(async (tx) => {
    await tx.query(
      `
      INSERT INTO ar_invoices (
        id, organization_id, legal_entity_id, party_id, sales_order_id, invoice_number,
        invoice_date, due_date, status, subtotal, tax_amount, total_amount, outstanding_amount,
        notes, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'DRAFT', $9, 0, $9, $9, $10, $11)
    `,
      [
        invoiceId,
        req.session!.organization_id,
        req.session!.legal_entity_id,
        party_id,
        sales_order_id || null,
        invoiceNumber,
        invoice_date || new Date().toISOString().slice(0, 10),
        due_date || new Date().toISOString().slice(0, 10),
        subtotal.toFixed(8),
        notes || null,
        req.session!.user_id,
      ],
    );

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const lineId = crypto.randomUUID();
      const lineTotal = new Money(l.quantity).mul(new Money(l.unit_price)).toFixed(8);

      await tx.query(
        `
        INSERT INTO ar_invoice_lines (
          id, invoice_id, line_number, item_id, quantity, unit_price, line_total, description
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
        [lineId, invoiceId, i + 1, l.item_id, l.quantity, l.unit_price, lineTotal, l.description || null],
      );
    }
  });

  return res.status(201).json({
    success: true,
    data: { id: invoiceId, invoice_number: invoiceNumber, status: 'DRAFT', total_amount: subtotal.toFixed(2) },
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
    },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/ar/invoices/:id/post', authenticate, requirePermission(Permission.AR_INVOICE_MANAGE), async (req: Request, res: Response) => {
  const { id } = req.params;

  const invRes = await db.query(
    'SELECT inv.*, p.name as party_name FROM ar_invoices inv JOIN parties p ON p.id = inv.party_id WHERE inv.id = $1 AND inv.organization_id = $2',
    [id, req.session!.organization_id],
  );

  if (invRes.rows.length === 0) {
    return res.status(404).json({
      success: false,
      error: {
        code: ErrorCode.RESOURCE_NOT_FOUND,
        message: 'AR invoice not found',
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  const invoice = invRes.rows[0];
  if (invoice.status === 'POSTED') {
    return res.status(400).json({
      success: false,
      error: {
        code: ErrorCode.ALREADY_POSTED,
        message: 'Invoice is already posted',
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  // Look up Trade AR Control (112001) and Product Sales (411001)
  const arAccRes = await db.query("SELECT id FROM accounts WHERE code = '112001' AND organization_id = $1", [req.session!.organization_id]);
  const salesAccRes = await db.query("SELECT id FROM accounts WHERE code = '411001' AND organization_id = $1", [req.session!.organization_id]);

  if (!arAccRes.rows[0] || !salesAccRes.rows[0]) {
    return res.status(400).json({
      success: false,
      error: {
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Missing standard AR Control (112001) or Sales (411001) account in COA',
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  const arAccId = arAccRes.rows[0].id;
  const salesAccId = salesAccRes.rows[0].id;
  const total = new Money(invoice.total_amount);

  const journalId = crypto.randomUUID();
  const journalNumber = `JV-AR-${invoice.invoice_number}`;

  await db.transaction(async (tx) => {
    // 1. Post GL Journal
    await tx.query(
      `
      INSERT INTO journals (
        id, organization_id, legal_entity_id, journal_number, posting_date, document_date,
        accounting_purpose, status, base_currency, total_base_debit, total_base_credit,
        description, source_type, source_id, created_by, posted_by, posted_at
      ) VALUES ($1, $2, $3, $4, $5, $5, 'SALES_INVOICE', 'POSTED', 'PKR', $6, $6, $7, 'AR_INVOICE', $8, $9, $9, CURRENT_TIMESTAMP)
    `,
      [
        journalId,
        req.session!.organization_id,
        req.session!.legal_entity_id,
        journalNumber,
        invoice.invoice_date,
        total.toFixed(8),
        `Invoice ${invoice.invoice_number} to ${invoice.party_name}`,
        id,
        req.session!.user_id,
      ],
    );

    // 2. Insert Lines (Dr AR Control, Cr Sales Revenue)
    await tx.query(
      `
      INSERT INTO journal_lines (id, journal_id, line_number, account_id, debit_amount, credit_amount, base_debit, base_credit, description, party_id)
      VALUES
        ($1, $2, 1, $3, $4, 0, $4, 0, $5, $6),
        ($7, $2, 2, $8, 0, $4, 0, $4, $5, $6)
    `,
      [
        crypto.randomUUID(),
        journalId,
        arAccId,
        total.toFixed(8),
        `Receivable from ${invoice.party_name}`,
        invoice.party_id,
        crypto.randomUUID(),
        salesAccId,
      ],
    );

    // 3. Mark AR Invoice as POSTED
    await tx.query(
      "UPDATE ar_invoices SET status = 'POSTED', posted_journal_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
      [journalId, id],
    );
  });

  return res.json({
    success: true,
    data: { id, status: 'POSTED', posted_journal_id: journalId },
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
    },
  } satisfies StandardSuccessResponse<any>);
});

// ==========================================
// 12. M2: Purchase Orders & AP Invoices (Procure-to-Pay)
// ==========================================
app.get('/api/procurement/orders', authenticate, async (req: Request, res: Response) => {
  const ordersRes = await db.query(
    `
    SELECT po.*, p.name as party_name, p.code as party_code
    FROM purchase_orders po
    JOIN parties p ON p.id = po.party_id
    WHERE po.organization_id = $1
    ORDER BY po.po_date DESC, po.created_at DESC
  `,
    [req.session!.organization_id],
  );

  return res.json({
    success: true,
    data: ordersRes.rows,
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
      total_count: ordersRes.rows.length,
    },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/procurement/orders', authenticate, requirePermission(Permission.PURCHASE_ORDER_MANAGE), async (req: Request, res: Response) => {
  const { party_id, po_date, expected_date, lines, notes } = req.body;

  if (!party_id || !lines || lines.length === 0) {
    return res.status(400).json({
      success: false,
      error: {
        code: ErrorCode.VALIDATION_FAILED,
        message: 'party_id and at least 1 line are required',
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  let subtotal = Money.zero();
  for (const l of lines) {
    const qty = new Money(l.quantity || '0');
    const price = new Money(l.unit_price || '0');
    subtotal = subtotal.add(qty.mul(price));
  }

  const poId = crypto.randomUUID();
  const poNumber = `PO-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`;

  await db.transaction(async (tx) => {
    await tx.query(
      `
      INSERT INTO purchase_orders (
        id, organization_id, legal_entity_id, party_id, po_number, po_date,
        expected_date, status, subtotal, tax_amount, total_amount, notes, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'DRAFT', $8, 0, $8, $9, $10)
    `,
      [
        poId,
        req.session!.organization_id,
        req.session!.legal_entity_id,
        party_id,
        poNumber,
        po_date || new Date().toISOString().slice(0, 10),
        expected_date || null,
        subtotal.toFixed(8),
        notes || null,
        req.session!.user_id,
      ],
    );

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const lineId = crypto.randomUUID();
      const lineTotal = new Money(l.quantity).mul(new Money(l.unit_price)).toFixed(8);

      await tx.query(
        `
        INSERT INTO purchase_order_lines (
          id, purchase_order_id, line_number, item_id, quantity, unit_price, line_total, description
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
        [lineId, poId, i + 1, l.item_id, l.quantity, l.unit_price, lineTotal, l.description || null],
      );
    }
  });

  return res.status(201).json({
    success: true,
    data: { id: poId, po_number: poNumber, status: 'DRAFT', subtotal: subtotal.toFixed(2) },
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
    },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/procurement/orders/:id/approve', authenticate, requirePermission(Permission.PURCHASE_ORDER_MANAGE), async (req: Request, res: Response) => {
  const { id } = req.params;
  await db.query("UPDATE purchase_orders SET status = 'APPROVED', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [id]);

  return res.json({
    success: true,
    data: { id, status: 'APPROVED' },
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
    },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/procurement/orders/:id/receive', authenticate, requirePermission(Permission.INVENTORY_MANAGE), async (req: Request, res: Response) => {
  const { id } = req.params;

  const poRes = await db.query('SELECT * FROM purchase_orders WHERE id = $1 AND organization_id = $2', [
    id,
    req.session!.organization_id,
  ]);
  if (poRes.rows.length === 0) {
    return res.status(404).json({
      success: false,
      error: {
        code: ErrorCode.RESOURCE_NOT_FOUND,
        message: 'Purchase order not found',
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  const po = poRes.rows[0];
  const linesRes = await db.query(
    'SELECT pol.*, i.item_type, i.unit_cost FROM purchase_order_lines pol JOIN items i ON i.id = pol.item_id WHERE pol.purchase_order_id = $1',
    [id],
  );

  const branchRow = await db.query('SELECT id FROM branches WHERE organization_id = $1 LIMIT 1', [req.session!.organization_id]);
  const branchId = branchRow.rows[0]?.id;

  let totalReceivedVal = Money.zero();

  await db.transaction(async (tx) => {
    for (const line of linesRes.rows) {
      if (line.item_type === 'INVENTORY') {
        const qty = parseFloat(line.quantity);
        const cost = new Money(line.unit_price || line.unit_cost || '0');
        const lineVal = cost.mul(qty);
        totalReceivedVal = totalReceivedVal.add(lineVal);

        const smId = crypto.randomUUID();
        await tx.query(
          `
          INSERT INTO stock_movements (
            id, organization_id, legal_entity_id, item_id, warehouse_id,
            movement_type, movement_date, quantity, unit_cost, total_value, reference_type, reference_id, description
          ) VALUES ($1, $2, $3, $4, $5, 'RECEIPT', CURRENT_DATE, $6, $7, $8, 'PURCHASE_ORDER', $9, 'Goods Receipt from PO')
        `,
          [smId, req.session!.organization_id, req.session!.legal_entity_id, line.item_id, branchId, qty, cost.toFixed(8), lineVal.toFixed(8), id],
        );

        await tx.query('UPDATE purchase_order_lines SET received_quantity = quantity WHERE id = $1', [line.id]);
      }
    }

    await tx.query("UPDATE purchase_orders SET status = 'RECEIVED', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [id]);

    // Post Inventory / GRNI Journal (Dr Inventory 113001, Cr GRNI 211002)
    if (totalReceivedVal.isPositive()) {
      const invAccRes = await tx.query("SELECT id FROM accounts WHERE code = '113001' AND organization_id = $1", [req.session!.organization_id]);
      const grniAccRes = await tx.query("SELECT id FROM accounts WHERE code = '211002' AND organization_id = $1", [req.session!.organization_id]);

      if (invAccRes.rows[0] && grniAccRes.rows[0]) {
        const jId = crypto.randomUUID();
        const jNum = `JV-GRNI-${Date.now().toString().slice(-6)}`;
        await tx.query(
          `
          INSERT INTO journals (
            id, organization_id, legal_entity_id, journal_number, posting_date, document_date,
            accounting_purpose, status, base_currency, total_base_debit, total_base_credit,
            description, source_type, source_id, created_by, posted_by, posted_at
          ) VALUES ($1, $2, $3, $4, CURRENT_DATE, CURRENT_DATE, 'PURCHASE_RECEIPT', 'POSTED', 'PKR', $5, $5, $6, 'PURCHASE_ORDER', $7, $8, $8, CURRENT_TIMESTAMP)
        `,
          [jId, req.session!.organization_id, req.session!.legal_entity_id, jNum, totalReceivedVal.toFixed(8), `Goods receipt for PO ${po.po_number}`, id, req.session!.user_id],
        );

        await tx.query(
          `
          INSERT INTO journal_lines (id, journal_id, line_number, account_id, debit_amount, credit_amount, base_debit, base_credit, description)
          VALUES 
            ($1, $2, 1, $3, $4, 0, $4, 0, 'Inventory received'),
            ($5, $2, 2, $6, 0, $4, 0, $4, 'GRNI liability')
        `,
          [crypto.randomUUID(), jId, invAccRes.rows[0].id, totalReceivedVal.toFixed(8), crypto.randomUUID(), grniAccRes.rows[0].id],
        );
      }
    }
  });

  return res.json({
    success: true,
    data: { id, status: 'RECEIVED' },
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
    },
  } satisfies StandardSuccessResponse<any>);
});

app.get('/api/ap/invoices', authenticate, async (req: Request, res: Response) => {
  const invRes = await db.query(
    `
    SELECT inv.*, p.name as party_name, p.code as party_code
    FROM ap_invoices inv
    JOIN parties p ON p.id = inv.party_id
    WHERE inv.organization_id = $1
    ORDER BY inv.invoice_date DESC, inv.created_at DESC
  `,
    [req.session!.organization_id],
  );

  return res.json({
    success: true,
    data: invRes.rows,
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
      total_count: invRes.rows.length,
    },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/ap/invoices', authenticate, requirePermission(Permission.AP_INVOICE_MANAGE), async (req: Request, res: Response) => {
  const { party_id, purchase_order_id, invoice_number, invoice_date, due_date, lines, notes } = req.body;

  if (!party_id || !lines || lines.length === 0) {
    return res.status(400).json({
      success: false,
      error: {
        code: ErrorCode.VALIDATION_FAILED,
        message: 'party_id and at least 1 line are required',
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  let subtotal = Money.zero();
  for (const l of lines) {
    const qty = new Money(l.quantity || '0');
    const price = new Money(l.unit_price || '0');
    subtotal = subtotal.add(qty.mul(price));
  }

  const invoiceId = crypto.randomUUID();
  const invNum = invoice_number || `BILL-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`;

  await db.transaction(async (tx) => {
    await tx.query(
      `
      INSERT INTO ap_invoices (
        id, organization_id, legal_entity_id, party_id, purchase_order_id, invoice_number,
        invoice_date, due_date, status, subtotal, tax_amount, total_amount, outstanding_amount,
        notes, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'DRAFT', $9, 0, $9, $9, $10, $11)
    `,
      [
        invoiceId,
        req.session!.organization_id,
        req.session!.legal_entity_id,
        party_id,
        purchase_order_id || null,
        invNum,
        invoice_date || new Date().toISOString().slice(0, 10),
        due_date || new Date().toISOString().slice(0, 10),
        subtotal.toFixed(8),
        notes || null,
        req.session!.user_id,
      ],
    );

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const lineId = crypto.randomUUID();
      const lineTotal = new Money(l.quantity).mul(new Money(l.unit_price)).toFixed(8);

      await tx.query(
        `
        INSERT INTO ap_invoice_lines (
          id, invoice_id, line_number, item_id, quantity, unit_price, line_total, description
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
        [lineId, invoiceId, i + 1, l.item_id, l.quantity, l.unit_price, lineTotal, l.description || null],
      );
    }
  });

  return res.status(201).json({
    success: true,
    data: { id: invoiceId, invoice_number: invNum, status: 'DRAFT', total_amount: subtotal.toFixed(2) },
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
    },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/ap/invoices/:id/post', authenticate, requirePermission(Permission.AP_INVOICE_MANAGE), async (req: Request, res: Response) => {
  const { id } = req.params;

  const invRes = await db.query(
    'SELECT inv.*, p.name as party_name FROM ap_invoices inv JOIN parties p ON p.id = inv.party_id WHERE inv.id = $1 AND inv.organization_id = $2',
    [id, req.session!.organization_id],
  );

  if (invRes.rows.length === 0) {
    return res.status(404).json({
      success: false,
      error: {
        code: ErrorCode.RESOURCE_NOT_FOUND,
        message: 'AP bill not found',
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  const bill = invRes.rows[0];
  if (bill.status === 'POSTED') {
    return res.status(400).json({
      success: false,
      error: {
        code: ErrorCode.ALREADY_POSTED,
        message: 'Bill is already posted',
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  // Look up GRNI (211002) or Inventory (113001) and Trade AP Control (211001)
  const apAccRes = await db.query("SELECT id FROM accounts WHERE code = '211001' AND organization_id = $1", [req.session!.organization_id]);
  const grniAccRes = await db.query("SELECT id FROM accounts WHERE code = '211002' AND organization_id = $1", [req.session!.organization_id]);

  const apAccId = apAccRes.rows[0].id;
  const grniAccId = grniAccRes.rows[0]?.id;
  const total = new Money(bill.total_amount);

  const journalId = crypto.randomUUID();
  const journalNumber = `JV-AP-${bill.invoice_number}`;

  await db.transaction(async (tx) => {
    // 1. Post GL Journal (Dr GRNI/Inventory, Cr AP Control)
    await tx.query(
      `
      INSERT INTO journals (
        id, organization_id, legal_entity_id, journal_number, posting_date, document_date,
        accounting_purpose, status, base_currency, total_base_debit, total_base_credit,
        description, source_type, source_id, created_by, posted_by, posted_at
      ) VALUES ($1, $2, $3, $4, $5, $5, 'PURCHASE_INVOICE', 'POSTED', 'PKR', $6, $6, $7, 'AP_INVOICE', $8, $9, $9, CURRENT_TIMESTAMP)
    `,
      [
        journalId,
        req.session!.organization_id,
        req.session!.legal_entity_id,
        journalNumber,
        bill.invoice_date,
        total.toFixed(8),
        `Bill ${bill.invoice_number} from ${bill.party_name}`,
        id,
        req.session!.user_id,
      ],
    );

    // 2. Insert Lines
    await tx.query(
      `
      INSERT INTO journal_lines (id, journal_id, line_number, account_id, debit_amount, credit_amount, base_debit, base_credit, description, party_id)
      VALUES
        ($1, $2, 1, $3, $4, 0, $4, 0, $5, $6),
        ($7, $2, 2, $8, 0, $4, 0, $4, $5, $6)
    `,
      [
        crypto.randomUUID(),
        journalId,
        grniAccId,
        total.toFixed(8),
        `Goods clearance for ${bill.party_name}`,
        bill.party_id,
        crypto.randomUUID(),
        apAccId,
      ],
    );

    // 3. Mark AP Invoice as POSTED
    await tx.query(
      "UPDATE ap_invoices SET status = 'POSTED', posted_journal_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
      [journalId, id],
    );
  });

  return res.json({
    success: true,
    data: { id, status: 'POSTED', posted_journal_id: journalId },
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
    },
  } satisfies StandardSuccessResponse<any>);
});

// ==========================================
// 13. M2: Payments & Allocations (Receipts & Disbursements)
// ==========================================
app.get('/api/payments', authenticate, async (req: Request, res: Response) => {
  const paymentsRes = await db.query(
    `
    SELECT pmt.*, p.name as party_name, a.name as bank_account_name
    FROM payments pmt
    JOIN parties p ON p.id = pmt.party_id
    JOIN accounts a ON a.id = pmt.bank_account_id
    WHERE pmt.organization_id = $1
    ORDER BY pmt.payment_date DESC, pmt.created_at DESC
  `,
    [req.session!.organization_id],
  );

  return res.json({
    success: true,
    data: paymentsRes.rows,
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
      total_count: paymentsRes.rows.length,
    },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/payments/receipt', authenticate, requirePermission(Permission.PAYMENT_MANAGE), async (req: Request, res: Response) => {
  const { party_id, amount, bank_account_id, payment_date, reference, allocations } = req.body;

  if (!party_id || !amount || !bank_account_id) {
    return res.status(400).json({
      success: false,
      error: {
        code: ErrorCode.VALIDATION_FAILED,
        message: 'party_id, amount, and bank_account_id are required',
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  const pmtAmount = new Money(amount);
  const paymentId = crypto.randomUUID();
  const paymentNumber = `RCT-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`;

  // Accounts: Operating Bank (111002 / custom) and AR Control (112001)
  const arAccRes = await db.query("SELECT id FROM accounts WHERE code = '112001' AND organization_id = $1", [req.session!.organization_id]);
  const arAccId = arAccRes.rows[0].id;
  const journalId = crypto.randomUUID();

  await db.transaction(async (tx) => {
    // 1. Post GL Journal (Dr Bank, Cr AR Control)
    await tx.query(
      `
      INSERT INTO journals (
        id, organization_id, legal_entity_id, journal_number, posting_date, document_date,
        accounting_purpose, status, base_currency, total_base_debit, total_base_credit,
        description, source_type, source_id, created_by, posted_by, posted_at
      ) VALUES ($1, $2, $3, $4, $5, $5, 'CUSTOMER_PAYMENT', 'POSTED', 'PKR', $6, $6, $7, 'PAYMENT', $8, $9, $9, CURRENT_TIMESTAMP)
    `,
      [
        journalId,
        req.session!.organization_id,
        req.session!.legal_entity_id,
        `JV-${paymentNumber}`,
        payment_date || new Date().toISOString().slice(0, 10),
        pmtAmount.toFixed(8),
        `Customer Receipt ${paymentNumber}`,
        paymentId,
        req.session!.user_id,
      ],
    );

    await tx.query(
      `
      INSERT INTO journal_lines (id, journal_id, line_number, account_id, debit_amount, credit_amount, base_debit, base_credit, description, party_id)
      VALUES
        ($1, $2, 1, $3, $4, 0, $4, 0, 'Cash received in bank', $5),
        ($6, $2, 2, $7, 0, $4, 0, $4, 'AR settlement', $5)
    `,
      [
        crypto.randomUUID(),
        journalId,
        bank_account_id,
        pmtAmount.toFixed(8),
        party_id,
        crypto.randomUUID(),
        arAccId,
      ],
    );

    // 2. Insert Payment Record
    await tx.query(
      `
      INSERT INTO payments (
        id, organization_id, legal_entity_id, party_id, payment_type, payment_number,
        payment_date, bank_account_id, amount, currency, reference, status, posted_journal_id, created_by
      ) VALUES ($1, $2, $3, $4, 'RECEIPT', $5, $6, $7, $8, 'PKR', $9, 'POSTED', $10, $11)
    `,
      [
        paymentId,
        req.session!.organization_id,
        req.session!.legal_entity_id,
        party_id,
        paymentNumber,
        payment_date || new Date().toISOString().slice(0, 10),
        bank_account_id,
        pmtAmount.toFixed(8),
        reference || null,
        journalId,
        req.session!.user_id,
      ],
    );

    // 3. Process Allocations against AR Invoices
    if (allocations && Array.isArray(allocations)) {
      for (const alloc of allocations) {
        const allocId = crypto.randomUUID();
        const allocAmt = new Money(alloc.amount);

        await tx.query(
          `
          INSERT INTO allocations (id, organization_id, payment_id, invoice_id, invoice_type, allocated_amount, allocated_date)
          VALUES ($1, $2, $3, $4, 'AR', $5, $6)
        `,
          [allocId, req.session!.organization_id, paymentId, alloc.invoice_id, allocAmt.toFixed(8), payment_date || new Date().toISOString().slice(0, 10)],
        );

        // Update AR invoice outstanding balance and status
        await tx.query(
          `
          UPDATE ar_invoices
          SET 
            outstanding_amount = GREATEST(0, outstanding_amount - $1),
            status = CASE WHEN outstanding_amount - $1 <= 0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $2
        `,
          [allocAmt.toFixed(8), alloc.invoice_id],
        );
      }
    }
  });

  return res.status(201).json({
    success: true,
    data: { id: paymentId, payment_number: paymentNumber, status: 'POSTED' },
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
    },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/payments/disbursement', authenticate, requirePermission(Permission.PAYMENT_MANAGE), async (req: Request, res: Response) => {
  const { party_id, amount, bank_account_id, payment_date, reference, allocations } = req.body;

  if (!party_id || !amount || !bank_account_id) {
    return res.status(400).json({
      success: false,
      error: {
        code: ErrorCode.VALIDATION_FAILED,
        message: 'party_id, amount, and bank_account_id are required',
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  const pmtAmount = new Money(amount);
  const paymentId = crypto.randomUUID();
  const paymentNumber = `DISB-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`;

  // Accounts: Trade AP Control (211001) and Operating Bank
  const apAccRes = await db.query("SELECT id FROM accounts WHERE code = '211001' AND organization_id = $1", [req.session!.organization_id]);
  const apAccId = apAccRes.rows[0].id;
  const journalId = crypto.randomUUID();

  await db.transaction(async (tx) => {
    // 1. Post GL Journal (Dr AP Control, Cr Bank)
    await tx.query(
      `
      INSERT INTO journals (
        id, organization_id, legal_entity_id, journal_number, posting_date, document_date,
        accounting_purpose, status, base_currency, total_base_debit, total_base_credit,
        description, source_type, source_id, created_by, posted_by, posted_at
      ) VALUES ($1, $2, $3, $4, $5, $5, 'SUPPLIER_PAYMENT', 'POSTED', 'PKR', $6, $6, $7, 'PAYMENT', $8, $9, $9, CURRENT_TIMESTAMP)
    `,
      [
        journalId,
        req.session!.organization_id,
        req.session!.legal_entity_id,
        `JV-${paymentNumber}`,
        payment_date || new Date().toISOString().slice(0, 10),
        pmtAmount.toFixed(8),
        `Supplier Payment ${paymentNumber}`,
        paymentId,
        req.session!.user_id,
      ],
    );

    await tx.query(
      `
      INSERT INTO journal_lines (id, journal_id, line_number, account_id, debit_amount, credit_amount, base_debit, base_credit, description, party_id)
      VALUES
        ($1, $2, 1, $3, $4, 0, $4, 0, 'AP settlement', $5),
        ($6, $2, 2, $7, 0, $4, 0, $4, 'Cash paid from bank', $5)
    `,
      [
        crypto.randomUUID(),
        journalId,
        apAccId,
        pmtAmount.toFixed(8),
        party_id,
        crypto.randomUUID(),
        bank_account_id,
      ],
    );

    // 2. Insert Payment Record
    await tx.query(
      `
      INSERT INTO payments (
        id, organization_id, legal_entity_id, party_id, payment_type, payment_number,
        payment_date, bank_account_id, amount, currency, reference, status, posted_journal_id, created_by
      ) VALUES ($1, $2, $3, $4, 'DISBURSEMENT', $5, $6, $7, $8, 'PKR', $9, 'POSTED', $10, $11)
    `,
      [
        paymentId,
        req.session!.organization_id,
        req.session!.legal_entity_id,
        party_id,
        paymentNumber,
        payment_date || new Date().toISOString().slice(0, 10),
        bank_account_id,
        pmtAmount.toFixed(8),
        reference || null,
        journalId,
        req.session!.user_id,
      ],
    );

    // 3. Process Allocations against AP Bills
    if (allocations && Array.isArray(allocations)) {
      for (const alloc of allocations) {
        const allocId = crypto.randomUUID();
        const allocAmt = new Money(alloc.amount);

        await tx.query(
          `
          INSERT INTO allocations (id, organization_id, payment_id, invoice_id, invoice_type, allocated_amount, allocated_date)
          VALUES ($1, $2, $3, $4, 'AP', $5, $6)
        `,
          [allocId, req.session!.organization_id, paymentId, alloc.invoice_id, allocAmt.toFixed(8), payment_date || new Date().toISOString().slice(0, 10)],
        );

        // Update AP invoice outstanding balance and status
        await tx.query(
          `
          UPDATE ap_invoices
          SET 
            outstanding_amount = GREATEST(0, outstanding_amount - $1),
            status = CASE WHEN outstanding_amount - $1 <= 0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $2
        `,
          [allocAmt.toFixed(8), alloc.invoice_id],
        );
      }
    }
  });

  return res.status(201).json({
    success: true,
    data: { id: paymentId, payment_number: paymentNumber, status: 'POSTED' },
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
    },
  } satisfies StandardSuccessResponse<any>);
});

// ==========================================
// 14. M3: Multi-Currency & FX Engine
// ==========================================
app.get('/api/fx/rates', authenticate, async (req: Request, res: Response) => {
  const ratesRes = await db.query(
    'SELECT * FROM exchange_rates WHERE organization_id = $1 ORDER BY effective_date DESC, from_currency ASC',
    [req.session!.organization_id],
  );

  return res.json({
    success: true,
    data: ratesRes.rows,
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
      total_count: ratesRes.rows.length,
    },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/fx/rates', authenticate, requirePermission(Permission.TREASURY_FX_MANAGE), async (req: Request, res: Response) => {
  const { from_currency, to_currency, rate, effective_date, source } = req.body;

  if (!from_currency || !to_currency || !rate || !effective_date) {
    return res.status(400).json({
      success: false,
      error: {
        code: ErrorCode.VALIDATION_FAILED,
        message: 'from_currency, to_currency, rate, and effective_date are required',
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  const id = crypto.randomUUID();
  await db.query(
    `
    INSERT INTO exchange_rates (
      id, organization_id, from_currency, to_currency, rate, effective_date, source
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (organization_id, from_currency, to_currency, effective_date)
    DO UPDATE SET rate = EXCLUDED.rate, source = EXCLUDED.source
  `,
    [id, req.session!.organization_id, from_currency.toUpperCase(), to_currency.toUpperCase(), rate, effective_date, source || 'MANUAL'],
  );

  return res.status(201).json({
    success: true,
    data: { id, from_currency, to_currency, rate, effective_date },
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
    },
  } satisfies StandardSuccessResponse<any>);
});

// ==========================================
// 15. M3: Treasury & Bank Statement Reconciliation
// ==========================================
app.get('/api/treasury/statements', authenticate, async (req: Request, res: Response) => {
  const stmtsRes = await db.query(
    `
    SELECT bs.*, a.name as bank_account_name, a.code as bank_account_code,
      (SELECT COUNT(*) FROM bank_statement_lines bsl WHERE bsl.statement_id = bs.id) as total_lines,
      (SELECT COUNT(*) FROM bank_statement_lines bsl WHERE bsl.statement_id = bs.id AND bsl.is_matched = true) as matched_lines
    FROM bank_statements bs
    JOIN accounts a ON a.id = bs.bank_account_id
    WHERE bs.organization_id = $1
    ORDER BY bs.statement_date DESC, bs.created_at DESC
  `,
    [req.session!.organization_id],
  );

  return res.json({
    success: true,
    data: stmtsRes.rows,
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
      total_count: stmtsRes.rows.length,
    },
  } satisfies StandardSuccessResponse<any>);
});

app.get('/api/treasury/statements/:id', authenticate, async (req: Request, res: Response) => {
  const { id } = req.params;

  const stmtRes = await db.query(
    `
    SELECT bs.*, a.name as bank_account_name, a.code as bank_account_code
    FROM bank_statements bs
    JOIN accounts a ON a.id = bs.bank_account_id
    WHERE bs.id = $1 AND bs.organization_id = $2
  `,
    [id, req.session!.organization_id],
  );

  if (stmtRes.rows.length === 0) {
    return res.status(404).json({
      success: false,
      error: {
        code: ErrorCode.RESOURCE_NOT_FOUND,
        message: 'Bank statement not found',
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  const statement = stmtRes.rows[0];
  const linesRes = await db.query(
    'SELECT * FROM bank_statement_lines WHERE statement_id = $1 ORDER BY line_number ASC',
    [id],
  );

  // Fetch un-reconciled GL journal lines for this bank account
  const glRes = await db.query(
    `
    SELECT jl.*, j.journal_number, j.posting_date
    FROM journal_lines jl
    JOIN journals j ON j.id = jl.journal_id
    WHERE jl.account_id = $1 AND j.status = 'POSTED' AND j.organization_id = $2
    ORDER BY j.posting_date ASC
  `,
    [statement.bank_account_id, req.session!.organization_id],
  );

  // Calculate current bank balance from GL
  let glBalance = Money.zero();
  for (const l of glRes.rows) {
    glBalance = glBalance.add(l.base_debit).sub(l.base_credit);
  }

  const summary = BankReconciliationEngine.computeReconciliation({
    statementOpeningBalance: statement.opening_balance,
    statementClosingBalance: statement.closing_balance,
    glBalanceAsOfDate: glBalance.toFixed(8),
    statementLines: linesRes.rows,
  });

  return res.json({
    success: true,
    data: {
      ...statement,
      lines: linesRes.rows,
      summary,
      unreconciled_gl_lines: glRes.rows,
    },
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
    },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/treasury/statements/upload', authenticate, requirePermission(Permission.TREASURY_BANK_RECONCILE), async (req: Request, res: Response) => {
  const { bank_account_id, statement_reference, statement_date, opening_balance, closing_balance, lines } = req.body;

  if (!bank_account_id || !statement_reference || !statement_date || !lines || lines.length === 0) {
    return res.status(400).json({
      success: false,
      error: {
        code: ErrorCode.VALIDATION_FAILED,
        message: 'bank_account_id, statement_reference, statement_date, and lines are required',
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  const statementId = crypto.randomUUID();

  await db.transaction(async (tx) => {
    await tx.query(
      `
      INSERT INTO bank_statements (
        id, organization_id, legal_entity_id, bank_account_id, statement_reference,
        statement_date, opening_balance, closing_balance, status, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'UPLOADED', $9)
    `,
      [
        statementId,
        req.session!.organization_id,
        req.session!.legal_entity_id,
        bank_account_id,
        statement_reference,
        statement_date,
        opening_balance || '0.00',
        closing_balance || '0.00',
        req.session!.user_id,
      ],
    );

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const lineId = crypto.randomUUID();
      await tx.query(
        `
        INSERT INTO bank_statement_lines (
          id, statement_id, line_number, transaction_date, value_date, amount, reference, description, is_matched
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false)
      `,
        [lineId, statementId, i + 1, l.transaction_date, l.value_date || l.transaction_date, l.amount, l.reference || null, l.description || null],
      );
    }
  });

  return res.status(201).json({
    success: true,
    data: { id: statementId, statement_reference, status: 'UPLOADED', lines_count: lines.length },
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
    },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/treasury/reconciliation/match', authenticate, requirePermission(Permission.TREASURY_BANK_RECONCILE), async (req: Request, res: Response) => {
  const { statement_line_id, journal_line_id, is_matched } = req.body;

  if (!statement_line_id) {
    return res.status(400).json({
      success: false,
      error: {
        code: ErrorCode.VALIDATION_FAILED,
        message: 'statement_line_id is required',
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  await db.query(
    `
    UPDATE bank_statement_lines
    SET is_matched = $1, matched_journal_line_id = $2
    WHERE id = $3
  `,
    [is_matched !== false, journal_line_id || null, statement_line_id],
  );

  return res.json({
    success: true,
    data: { statement_line_id, is_matched: is_matched !== false, journal_line_id },
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
    },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/treasury/reconciliation/sign-off', authenticate, requirePermission(Permission.TREASURY_BANK_RECONCILE), async (req: Request, res: Response) => {
  const { statement_id, notes } = req.body;

  const stmtRes = await db.query('SELECT * FROM bank_statements WHERE id = $1 AND organization_id = $2', [
    statement_id,
    req.session!.organization_id,
  ]);
  if (stmtRes.rows.length === 0) {
    return res.status(404).json({
      success: false,
      error: {
        code: ErrorCode.RESOURCE_NOT_FOUND,
        message: 'Bank statement not found',
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  const statement = stmtRes.rows[0];
  const linesRes = await db.query('SELECT * FROM bank_statement_lines WHERE statement_id = $1', [statement_id]);

  const unmatched = linesRes.rows.filter((l: any) => !l.is_matched);
  if (unmatched.length > 0) {
    return res.status(400).json({
      success: false,
      error: {
        code: ErrorCode.RECONCILIATION_MISMATCH,
        message: `Cannot sign off: ${unmatched.length} statement line(s) remain unmatched`,
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  const reconId = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.query("UPDATE bank_statements SET status = 'RECONCILED', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [statement_id]);

    await tx.query(
      `
      INSERT INTO bank_reconciliations (
        id, statement_id, reconciled_date, statement_closing_balance, gl_closing_balance,
        unreconciled_difference, status, reconciled_by, notes
      ) VALUES ($1, $2, CURRENT_DATE, $3, $3, 0, 'COMPLETED', $4, $5)
    `,
      [reconId, statement_id, statement.closing_balance, req.session!.user_id, notes || null],
    );

    await auditLogger.record(
      {
        organization_id: req.session!.organization_id,
        user_id: req.session!.user_id,
        action: 'BANK_STATEMENT_RECONCILED',
        entity_type: 'BANK_STATEMENT',
        entity_id: statement_id,
        after_state: { status: 'RECONCILED', statement_reference: statement.statement_reference },
        correlation_id: req.correlationId,
      },
      tx,
    );
  });

  return res.json({
    success: true,
    data: { statement_id, status: 'RECONCILED', reconciliation_id: reconId },
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
    },
  } satisfies StandardSuccessResponse<any>);
});

// ==========================================
// 16. M3: Onboarding & Industry Template Provisioning
// ==========================================
app.get('/api/onboarding/profile', authenticate, async (req: Request, res: Response) => {
  const profileRes = await db.query('SELECT * FROM onboarding_profiles WHERE organization_id = $1 LIMIT 1', [
    req.session!.organization_id,
  ]);

  return res.json({
    success: true,
    data: profileRes.rows[0] || {
      organization_id: req.session!.organization_id,
      industry_template: 'WHOLESALE_DISTRIBUTION',
      setup_step: 'COMPLETED',
      is_completed: true,
    },
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
    },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/onboarding/provision', authenticate, requirePermission(Permission.ONBOARDING_MANAGE), async (req: Request, res: Response) => {
  const { industry_template } = req.body;

  const validTemplates = ['WHOLESALE_DISTRIBUTION', 'SERVICES_CONSULTING', 'LIGHT_MANUFACTURING', 'CUSTOM'];
  if (!validTemplates.includes(industry_template)) {
    return res.status(400).json({
      success: false,
      error: {
        code: ErrorCode.VALIDATION_FAILED,
        message: `industry_template must be one of: ${validTemplates.join(', ')}`,
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  const profileId = crypto.randomUUID();
  await db.query(
    `
    INSERT INTO onboarding_profiles (id, organization_id, industry_template, setup_step, is_completed, completed_at)
    VALUES ($1, $2, $3, 'COMPLETED', true, CURRENT_TIMESTAMP)
  `,
    [profileId, req.session!.organization_id, industry_template],
  );

  return res.status(201).json({
    success: true,
    data: { id: profileId, industry_template, is_completed: true },
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
    },
  } satisfies StandardSuccessResponse<any>);
});

// ==========================================
// 17. Workforce & Human Resources (M4)
// ==========================================
app.get('/api/hrm/departments', authenticate, async (req: Request, res: Response) => {
  const result = await db.query(
    `SELECT * FROM departments WHERE legal_entity_id = $1 ORDER BY code ASC`,
    [req.session!.legal_entity_id],
  );
  return res.json({
    success: true,
    data: result.rows,
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString(), total_count: result.rows.length },
  } satisfies StandardSuccessResponse<any[]>);
});

app.post('/api/hrm/departments', authenticate, requirePermission(Permission.HRM_MANAGE), async (req: Request, res: Response) => {
  const { code, name, cost_center_code } = req.body;
  if (!code || !name) {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED, message: 'Department code and name are required', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const deptId = crypto.randomUUID();
  await db.query(
    `INSERT INTO departments (id, organization_id, legal_entity_id, code, name, cost_center_code, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, true)`,
    [deptId, req.session!.organization_id, req.session!.legal_entity_id, code, name, cost_center_code || null],
  );

  const dept = (await db.query(`SELECT * FROM departments WHERE id = $1`, [deptId])).rows[0];
  return res.status(201).json({
    success: true,
    data: dept,
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

app.get('/api/hrm/designations', authenticate, async (req: Request, res: Response) => {
  const result = await db.query(
    `SELECT d.*, dept.name as department_name 
     FROM designations d 
     LEFT JOIN departments dept ON dept.id = d.department_id 
     WHERE d.legal_entity_id = $1 ORDER BY d.code ASC`,
    [req.session!.legal_entity_id],
  );
  return res.json({
    success: true,
    data: result.rows,
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString(), total_count: result.rows.length },
  } satisfies StandardSuccessResponse<any[]>);
});

app.post('/api/hrm/designations', authenticate, requirePermission(Permission.HRM_MANAGE), async (req: Request, res: Response) => {
  const { code, title, department_id } = req.body;
  if (!code || !title) {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED, message: 'Designation code and title are required', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const desigId = crypto.randomUUID();
  await db.query(
    `INSERT INTO designations (id, organization_id, legal_entity_id, code, title, department_id, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, true)`,
    [desigId, req.session!.organization_id, req.session!.legal_entity_id, code, title, department_id || null],
  );

  const desig = (await db.query(`SELECT * FROM designations WHERE id = $1`, [desigId])).rows[0];
  return res.status(201).json({
    success: true,
    data: desig,
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

app.get('/api/hrm/salary-structures', authenticate, async (req: Request, res: Response) => {
  const result = await db.query(
    `SELECT * FROM salary_structures WHERE legal_entity_id = $1 ORDER BY name ASC`,
    [req.session!.legal_entity_id],
  );
  return res.json({
    success: true,
    data: result.rows,
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString(), total_count: result.rows.length },
  } satisfies StandardSuccessResponse<any[]>);
});

app.post('/api/hrm/salary-structures', authenticate, requirePermission(Permission.HRM_MANAGE), async (req: Request, res: Response) => {
  const { name, currency, basic_salary, house_rent_allowance, utility_allowance, medical_allowance, other_allowances } = req.body;
  if (!name || !basic_salary) {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED, message: 'Name and basic salary are required', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const { gross } = PayrollEngine.computeGross({
    basic_salary,
    house_rent_allowance,
    utility_allowance,
    medical_allowance,
    other_allowances,
  });

  const structId = crypto.randomUUID();
  await db.query(
    `INSERT INTO salary_structures (
      id, organization_id, legal_entity_id, name, currency,
      basic_salary, house_rent_allowance, utility_allowance, medical_allowance, other_allowances, gross_salary, is_active
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)`,
    [
      structId,
      req.session!.organization_id,
      req.session!.legal_entity_id,
      name,
      currency || 'PKR',
      new Money(basic_salary).format(),
      new Money(house_rent_allowance || '0').format(),
      new Money(utility_allowance || '0').format(),
      new Money(medical_allowance || '0').format(),
      new Money(other_allowances || '0').format(),
      gross.format(),
    ],
  );

  const struct = (await db.query(`SELECT * FROM salary_structures WHERE id = $1`, [structId])).rows[0];
  return res.status(201).json({
    success: true,
    data: struct,
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

app.get('/api/hrm/employees', authenticate, async (req: Request, res: Response) => {
  const result = await db.query(
    `SELECT e.*, 
            dept.name as department_name, 
            desig.title as designation_title,
            ss.id as salary_structure_id,
            ss.name as salary_structure_name,
            ss.basic_salary,
            ss.gross_salary
     FROM employees e
     LEFT JOIN departments dept ON dept.id = e.department_id
     LEFT JOIN designations desig ON desig.id = e.designation_id
     LEFT JOIN employee_salary_assignments esa ON esa.employee_id = e.id AND esa.is_current = true
     LEFT JOIN salary_structures ss ON ss.id = esa.salary_structure_id
     WHERE e.legal_entity_id = $1
     ORDER BY e.employee_number ASC`,
    [req.session!.legal_entity_id],
  );

  const formatted = result.rows.map((r) => ({
    id: r.id,
    organization_id: r.organization_id,
    legal_entity_id: r.legal_entity_id,
    employee_number: r.employee_number,
    first_name: r.first_name,
    last_name: r.last_name,
    email: r.email,
    phone: r.phone,
    national_id: r.national_id,
    department_id: r.department_id,
    department_name: r.department_name,
    designation_id: r.designation_id,
    designation_title: r.designation_title,
    employment_type: r.employment_type,
    joining_date: r.joining_date,
    status: r.status,
    bank_name: r.bank_name,
    bank_account_number: r.bank_account_number,
    salary_structure: r.salary_structure_id ? {
      id: r.salary_structure_id,
      name: r.salary_structure_name,
      basic_salary: r.basic_salary,
      gross_salary: r.gross_salary,
    } : null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));

  return res.json({
    success: true,
    data: formatted,
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString(), total_count: formatted.length },
  } satisfies StandardSuccessResponse<any[]>);
});

app.post('/api/hrm/employees', authenticate, requirePermission(Permission.HRM_MANAGE), async (req: Request, res: Response) => {
  const {
    employee_number,
    first_name,
    last_name,
    email,
    phone,
    national_id,
    department_id,
    designation_id,
    employment_type,
    joining_date,
    salary_structure_id,
    bank_name,
    bank_account_number,
  } = req.body;

  if (!employee_number || !first_name || !last_name || !joining_date) {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED, message: 'Employee number, name, and joining date are required', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const empId = crypto.randomUUID();
  await db.query(
    `INSERT INTO employees (
      id, organization_id, legal_entity_id, employee_number, first_name, last_name,
      email, phone, national_id, department_id, designation_id, employment_type, joining_date,
      status, bank_name, bank_account_number
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'ACTIVE', $14, $15)`,
    [
      empId,
      req.session!.organization_id,
      req.session!.legal_entity_id,
      employee_number,
      first_name,
      last_name,
      email || null,
      phone || null,
      national_id || null,
      department_id || null,
      designation_id || null,
      employment_type || 'FULL_TIME',
      joining_date,
      bank_name || null,
      bank_account_number || null,
    ],
  );

  if (salary_structure_id) {
    await db.query(
      `INSERT INTO employee_salary_assignments (id, employee_id, salary_structure_id, effective_from, is_current)
       VALUES ($1, $2, $3, $4, true)`,
      [crypto.randomUUID(), empId, salary_structure_id, joining_date],
    );
  }

  const emp = (await db.query(`SELECT * FROM employees WHERE id = $1`, [empId])).rows[0];
  return res.status(201).json({
    success: true,
    data: emp,
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

// ==========================================
// 18. Payroll Calculation & Runs (M4)
// ==========================================
app.post('/api/hrm/payroll/calculate', authenticate, requirePermission(Permission.PAYROLL_MANAGE), async (req: Request, res: Response) => {
  const { period_id, month_year } = req.body;
  if (!period_id || !month_year) {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED, message: 'period_id and month_year are required', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  // Fetch all active employees with their current salary structures
  const employeesRes = await db.query(
    `SELECT e.id as employee_id, e.employee_number, e.first_name, e.last_name,
            ss.basic_salary, ss.house_rent_allowance, ss.utility_allowance, ss.medical_allowance, ss.other_allowances
     FROM employees e
     JOIN employee_salary_assignments esa ON esa.employee_id = e.id AND esa.is_current = true
     JOIN salary_structures ss ON ss.id = esa.salary_structure_id
     WHERE e.legal_entity_id = $1 AND e.status = 'ACTIVE'`,
    [req.session!.legal_entity_id],
  );

  if (employeesRes.rows.length === 0) {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED, message: 'No active employees with assigned salary structures found', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const calculatedItems = employeesRes.rows.map((emp) => {
    const calc = PayrollEngine.computeEmployeePayroll(emp.employee_id, {
      basic_salary: emp.basic_salary,
      house_rent_allowance: emp.house_rent_allowance,
      utility_allowance: emp.utility_allowance,
      medical_allowance: emp.medical_allowance,
      other_allowances: emp.other_allowances,
    });
    return {
      ...calc,
      employee_number: emp.employee_number,
      employee_name: `${emp.first_name} ${emp.last_name}`,
      payment_status: 'PENDING',
    };
  });

  const totals = PayrollEngine.aggregatePayrollRun(calculatedItems);

  return res.json({
    success: true,
    data: {
      period_id,
      month_year,
      totals,
      items: calculatedItems,
    },
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

app.get('/api/hrm/payroll-runs', authenticate, async (req: Request, res: Response) => {
  const runsRes = await db.query(
    `SELECT pr.*, fp.name as period_name
     FROM payroll_runs pr
     LEFT JOIN fiscal_periods fp ON fp.id = pr.period_id
     WHERE pr.legal_entity_id = $1
     ORDER BY pr.created_at DESC`,
    [req.session!.legal_entity_id],
  );

  const runsWithItems = await Promise.all(
    runsRes.rows.map(async (run) => {
      const itemsRes = await db.query(
        `SELECT pri.*, e.employee_number, e.first_name, e.last_name
         FROM payroll_run_items pri
         JOIN employees e ON e.id = pri.employee_id
         WHERE pri.payroll_run_id = $1
         ORDER BY e.employee_number ASC`,
        [run.id],
      );
      return {
        ...run,
        items: itemsRes.rows.map((it) => ({
          ...it,
          employee_name: `${it.first_name} ${it.last_name}`,
        })),
      };
    }),
  );

  return res.json({
    success: true,
    data: runsWithItems,
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString(), total_count: runsWithItems.length },
  } satisfies StandardSuccessResponse<any[]>);
});

app.post('/api/hrm/payroll-runs', authenticate, requirePermission(Permission.PAYROLL_MANAGE), async (req: Request, res: Response) => {
  const { period_id, month_year, run_number } = req.body;
  if (!period_id || !month_year || !run_number) {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED, message: 'period_id, month_year, and run_number are required', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  // Fetch employees
  const employeesRes = await db.query(
    `SELECT e.id as employee_id, e.employee_number, e.first_name, e.last_name,
            ss.basic_salary, ss.house_rent_allowance, ss.utility_allowance, ss.medical_allowance, ss.other_allowances
     FROM employees e
     JOIN employee_salary_assignments esa ON esa.employee_id = e.id AND esa.is_current = true
     JOIN salary_structures ss ON ss.id = esa.salary_structure_id
     WHERE e.legal_entity_id = $1 AND e.status = 'ACTIVE'`,
    [req.session!.legal_entity_id],
  );

  if (employeesRes.rows.length === 0) {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED, message: 'No active employees with assigned salary structures', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const calculatedItems = employeesRes.rows.map((emp) => {
    return PayrollEngine.computeEmployeePayroll(emp.employee_id, {
      basic_salary: emp.basic_salary,
      house_rent_allowance: emp.house_rent_allowance,
      utility_allowance: emp.utility_allowance,
      medical_allowance: emp.medical_allowance,
      other_allowances: emp.other_allowances,
    });
  });

  const totals = PayrollEngine.aggregatePayrollRun(calculatedItems);
  const runId = crypto.randomUUID();

  await db.query(
    `INSERT INTO payroll_runs (
      id, organization_id, legal_entity_id, period_id, run_number, month_year,
      total_gross, total_tax, total_eobi, total_provident_fund, total_other_deductions,
      total_deductions, total_net, status, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'DRAFT', $14)`,
    [
      runId,
      req.session!.organization_id,
      req.session!.legal_entity_id,
      period_id,
      run_number,
      month_year,
      totals.total_gross,
      totals.total_tax,
      totals.total_eobi,
      totals.total_provident_fund,
      totals.total_other_deductions,
      totals.total_deductions,
      totals.total_net,
      req.session!.user_id,
    ],
  );

  for (const item of calculatedItems) {
    await db.query(
      `INSERT INTO payroll_run_items (
        id, payroll_run_id, employee_id, basic_salary, allowances_total, gross_salary,
        tax_deduction, eobi_deduction, provident_fund_deduction, other_deductions,
        total_deductions, net_salary, payment_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'PENDING')`,
      [
        crypto.randomUUID(),
        runId,
        item.employee_id,
        item.basic_salary,
        item.allowances_total,
        item.gross_salary,
        item.tax_deduction,
        item.eobi_deduction,
        item.provident_fund_deduction,
        item.other_deductions,
        item.total_deductions,
        item.net_salary,
      ],
    );
  }

  const run = (await db.query(`SELECT * FROM payroll_runs WHERE id = $1`, [runId])).rows[0];
  return res.status(201).json({
    success: true,
    data: { ...run, totals, items: calculatedItems },
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/hrm/payroll-runs/:id/approve', authenticate, requirePermission(Permission.PAYROLL_APPROVE), async (req: Request, res: Response) => {
  const { id } = req.params;
  const runRes = await db.query(
    `SELECT * FROM payroll_runs WHERE id = $1 AND legal_entity_id = $2`,
    [id, req.session!.legal_entity_id],
  );

  if (runRes.rows.length === 0) {
    return res.status(404).json({
      success: false,
      error: { code: ErrorCode.RESOURCE_NOT_FOUND, message: 'Payroll run not found', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const run = runRes.rows[0];
  if (run.status !== 'DRAFT') {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED, message: `Only DRAFT payroll runs can be approved (current: ${run.status})`, correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  await db.query(`UPDATE payroll_runs SET status = 'APPROVED', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);

  return res.json({
    success: true,
    data: { id, status: 'APPROVED' },
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/hrm/payroll-runs/:id/post', authenticate, requirePermission(Permission.PAYROLL_POST), async (req: Request, res: Response) => {
  const { id } = req.params;
  const runRes = await db.query(
    `SELECT * FROM payroll_runs WHERE id = $1 AND legal_entity_id = $2`,
    [id, req.session!.legal_entity_id],
  );

  if (runRes.rows.length === 0) {
    return res.status(404).json({
      success: false,
      error: { code: ErrorCode.RESOURCE_NOT_FOUND, message: 'Payroll run not found', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const run = runRes.rows[0];
  if (run.status !== 'APPROVED') {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED, message: `Only APPROVED payroll runs can be posted (current: ${run.status})`, correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  // Verify Fiscal Period is OPEN
  const periodRes = await db.query(`SELECT * FROM fiscal_periods WHERE id = $1`, [run.period_id]);
  const period = periodRes.rows[0];
  if (!period || period.status !== PeriodStatus.OPEN) {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.PERIOD_CLOSED, message: `Fiscal period is closed or invalid for posting`, correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  // Lookup GL Accounts
  const accountsRes = await db.query(
    `SELECT id, code, name FROM accounts WHERE legal_entity_id = $1 AND code IN ('521002', '212002', '212003', '212004', '211004')`,
    [req.session!.legal_entity_id],
  );
  const accountMap = new Map(accountsRes.rows.map((a) => [a.code, a.id]));

  const salExpId = accountMap.get('521002');
  const taxPayId = accountMap.get('212002');
  const eobiPayId = accountMap.get('212003');
  const pfPayId = accountMap.get('212004');
  const salPayId = accountMap.get('211004');

  if (!salExpId || !taxPayId || !eobiPayId || !salPayId) {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED, message: 'Required payroll GL accounts (521002, 212002, 212003, 211004) are missing in COA', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const journalLines = PayrollEngine.generatePayrollJournalLines({
    totals: {
      total_gross: run.total_gross,
      total_tax: run.total_tax,
      total_eobi: run.total_eobi,
      total_provident_fund: run.total_provident_fund,
      total_other_deductions: run.total_other_deductions,
      total_deductions: run.total_deductions,
      total_net: run.total_net,
    },
    salariesExpenseAccountId: salExpId,
    taxPayableAccountId: taxPayId,
    eobiPayableAccountId: eobiPayId,
    providentFundPayableAccountId: pfPayId,
    salariesPayableAccountId: salPayId,
  });

  const journalId = crypto.randomUUID();
  const journalNumber = `PAY-JRN-${run.run_number}`;

  // Insert Journal and Lines
  const todayStr = new Date().toISOString().slice(0, 10);
  await db.query(
    `INSERT INTO journals (
      id, organization_id, legal_entity_id, journal_number, posting_date, document_date,
      status, accounting_purpose, total_base_debit, total_base_credit, description,
      source_type, source_id, created_by, posted_by, posted_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CURRENT_TIMESTAMP)`,
    [
      journalId,
      req.session!.organization_id,
      req.session!.legal_entity_id,
      journalNumber,
      todayStr,
      todayStr,
      JournalStatus.POSTED,
      AccountingPurpose.PAYROLL_RUN,
      run.total_gross,
      run.total_gross,
      `Payroll expense and liabilities accrual for ${run.month_year} (${run.run_number})`,
      'PAYROLL_RUN',
      run.id,
      req.session!.user_id,
      req.session!.user_id,
    ],
  );

  for (const line of journalLines) {
    await db.query(
      `INSERT INTO journal_lines (
        id, journal_id, line_number, account_id, debit_amount, credit_amount,
        currency, fx_rate, base_debit, base_credit, description
      ) VALUES ($1, $2, $3, $4, $5, $6, 'PKR', 1.0, $7, $8, $9)`,
      [
        crypto.randomUUID(),
        journalId,
        line.line_number,
        line.account_id,
        line.debit_amount,
        line.credit_amount,
        line.base_debit,
        line.base_credit,
        line.description,
      ],
    );
  }

  // Update Payroll Run
  await db.query(
    `UPDATE payroll_runs SET status = 'POSTED', posted_journal_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
    [journalId, id],
  );

  await auditLogger.log({
    organizationId: req.session!.organization_id,
    userId: req.session!.user_id,
    action: 'POST_PAYROLL_RUN',
    entityType: 'PAYROLL_RUN',
    entityId: id,
    afterState: { id, journal_id: journalId, totals: run.total_gross },
    correlationId: req.correlationId,
  });

  return res.json({
    success: true,
    data: { id, status: 'POSTED', posted_journal_id: journalId },
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/hrm/payroll-runs/:id/disburse', authenticate, requirePermission(Permission.PAYROLL_DISBURSE), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { bank_account_id } = req.body;

  const runRes = await db.query(
    `SELECT * FROM payroll_runs WHERE id = $1 AND legal_entity_id = $2`,
    [id, req.session!.legal_entity_id],
  );

  if (runRes.rows.length === 0) {
    return res.status(404).json({
      success: false,
      error: { code: ErrorCode.RESOURCE_NOT_FOUND, message: 'Payroll run not found', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const run = runRes.rows[0];
  if (run.status !== 'POSTED') {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED, message: `Only POSTED payroll runs can be disbursed (current: ${run.status})`, correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  // Lookup Accounts
  const salPayRes = await db.query(
    `SELECT id FROM accounts WHERE legal_entity_id = $1 AND code = '211004'`,
    [req.session!.legal_entity_id],
  );
  if (salPayRes.rows.length === 0) {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED, message: 'Salaries Payable account 211004 not found', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }
  const salPayId = salPayRes.rows[0].id;

  let targetBankId = bank_account_id;
  if (!targetBankId) {
    const bankRes = await db.query(
      `SELECT id FROM accounts WHERE legal_entity_id = $1 AND code = '111002'`,
      [req.session!.legal_entity_id],
    );
    if (bankRes.rows.length > 0) {
      targetBankId = bankRes.rows[0].id;
    } else {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode.VALIDATION_FAILED, message: 'Bank account not found for disbursement', correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }
  }

  const disbLines = PayrollEngine.generateDisbursementJournalLines({
    totalNet: run.total_net,
    salariesPayableAccountId: salPayId,
    bankAccountId: targetBankId,
  });

  const journalId = crypto.randomUUID();
  const journalNumber = `PAY-DISB-${run.run_number}`;

  // Insert Journal and Lines
  const todayStr = new Date().toISOString().slice(0, 10);
  await db.query(
    `INSERT INTO journals (
      id, organization_id, legal_entity_id, journal_number, posting_date, document_date,
      status, accounting_purpose, total_base_debit, total_base_credit, description,
      source_type, source_id, created_by, posted_by, posted_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CURRENT_TIMESTAMP)`,
    [
      journalId,
      req.session!.organization_id,
      req.session!.legal_entity_id,
      journalNumber,
      todayStr,
      todayStr,
      JournalStatus.POSTED,
      AccountingPurpose.PAYROLL_DISBURSEMENT,
      run.total_net,
      run.total_net,
      `Bank disbursement of net salaries for ${run.month_year} (${run.run_number})`,
      'PAYROLL_RUN',
      run.id,
      req.session!.user_id,
      req.session!.user_id,
    ],
  );

  for (const line of disbLines) {
    await db.query(
      `INSERT INTO journal_lines (
        id, journal_id, line_number, account_id, debit_amount, credit_amount,
        currency, fx_rate, base_debit, base_credit, description
      ) VALUES ($1, $2, $3, $4, $5, $6, 'PKR', 1.0, $7, $8, $9)`,
      [
        crypto.randomUUID(),
        journalId,
        line.line_number,
        line.account_id,
        line.debit_amount,
        line.credit_amount,
        line.base_debit,
        line.base_credit,
        line.description,
      ],
    );
  }

  // Update Payroll Run and Items
  await db.query(
    `UPDATE payroll_runs SET status = 'DISBURSED', disbursement_journal_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
    [journalId, id],
  );
  await db.query(
    `UPDATE payroll_run_items SET payment_status = 'PAID' WHERE payroll_run_id = $1`,
    [id],
  );

  await auditLogger.log({
    organizationId: req.session!.organization_id,
    userId: req.session!.user_id,
    action: 'DISBURSE_PAYROLL_RUN',
    entityType: 'PAYROLL_RUN',
    entityId: id,
    afterState: { id, disbursement_journal_id: journalId, total_disbursed: run.total_net },
    correlationId: req.correlationId,
  });

  return res.json({
    success: true,
    data: { id, status: 'DISBURSED', disbursement_journal_id: journalId },
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

// ==========================================
// 19. Advanced Inventory, Warehouses, Lots, Counts & Manufacturing
// ==========================================

// 19.1 Warehouses, Zones & Bins
app.get('/api/inventory/warehouses', authenticate, async (req: Request, res: Response) => {
  const warehousesResult = await db.query(
    `SELECT * FROM warehouses WHERE organization_id = $1 ORDER BY is_default DESC, name ASC`,
    [req.session!.organization_id],
  );
  const warehouses = warehousesResult.rows;

  // Enrich with zones and bins
  for (const wh of warehouses) {
    const zonesRes = await db.query(
      `SELECT * FROM warehouse_zones WHERE warehouse_id = $1 ORDER BY code ASC`,
      [wh.id],
    );
    const binsRes = await db.query(
      `SELECT b.*, z.name as zone_name FROM warehouse_bins b LEFT JOIN warehouse_zones z ON b.zone_id = z.id WHERE b.warehouse_id = $1 ORDER BY b.bin_code ASC`,
      [wh.id],
    );
    wh.zones = zonesRes.rows;
    wh.bins = binsRes.rows;
  }

  return res.json({
    success: true,
    data: warehouses,
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/inventory/warehouses', authenticate, requirePermission(Permission.WAREHOUSE_MANAGE), async (req: Request, res: Response) => {
  const { code, name, address, is_default } = req.body;
  if (!code || !name) {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED, message: 'Code and Name are required', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const result = await db.query(
    `INSERT INTO warehouses (code, name, address, is_default, organization_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [code, name, address || null, !!is_default, req.session!.organization_id],
  );

  return res.status(201).json({
    success: true,
    data: result.rows[0],
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/inventory/warehouses/:id/zones', authenticate, requirePermission(Permission.WAREHOUSE_MANAGE), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { code, name, zone_type } = req.body;

  const result = await db.query(
    `INSERT INTO warehouse_zones (warehouse_id, code, name, zone_type)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [id, code, name, zone_type || 'STORAGE'],
  );

  return res.status(201).json({
    success: true,
    data: result.rows[0],
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/inventory/warehouses/:id/bins', authenticate, requirePermission(Permission.WAREHOUSE_MANAGE), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { zone_id, bin_code, max_weight_capacity } = req.body;

  const result = await db.query(
    `INSERT INTO warehouse_bins (warehouse_id, zone_id, bin_code, max_weight_capacity)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [id, zone_id || null, bin_code, max_weight_capacity || null],
  );

  return res.status(201).json({
    success: true,
    data: result.rows[0],
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

// 19.2 Lots & Serials
app.get('/api/inventory/lots', authenticate, async (req: Request, res: Response) => {
  const result = await db.query(
    `SELECT l.*, i.code as item_code, i.name as item_name 
     FROM item_lots l 
     JOIN items i ON l.item_id = i.id 
     WHERE l.organization_id = $1 
     ORDER BY l.created_at DESC`,
    [req.session!.organization_id],
  );

  return res.json({
    success: true,
    data: result.rows,
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/inventory/lots', authenticate, requirePermission(Permission.INVENTORY_MANAGE), async (req: Request, res: Response) => {
  const { item_id, lot_number, manufacture_date, expiry_date, status } = req.body;
  if (!item_id || !lot_number) {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED, message: 'Item and lot number are required', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const result = await db.query(
    `INSERT INTO item_lots (item_id, lot_number, manufacture_date, expiry_date, status, organization_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [item_id, lot_number, manufacture_date || null, expiry_date || null, status || 'AVAILABLE', req.session!.organization_id],
  );

  return res.status(201).json({
    success: true,
    data: result.rows[0],
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

app.get('/api/inventory/serials', authenticate, async (req: Request, res: Response) => {
  const result = await db.query(
    `SELECT s.*, i.code as item_code, i.name as item_name, w.name as warehouse_name, b.bin_code 
     FROM item_serials s 
     JOIN items i ON s.item_id = i.id 
     LEFT JOIN warehouses w ON s.warehouse_id = w.id 
     LEFT JOIN warehouse_bins b ON s.bin_id = b.id 
     WHERE s.organization_id = $1 
     ORDER BY s.created_at DESC`,
    [req.session!.organization_id],
  );

  return res.json({
    success: true,
    data: result.rows,
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/inventory/serials', authenticate, requirePermission(Permission.INVENTORY_MANAGE), async (req: Request, res: Response) => {
  const { item_id, serial_number, warehouse_id, bin_id, status } = req.body;
  if (!item_id || !serial_number) {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED, message: 'Item and serial number are required', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const result = await db.query(
    `INSERT INTO item_serials (item_id, serial_number, warehouse_id, bin_id, status, organization_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [item_id, serial_number, warehouse_id || null, bin_id || null, status || 'IN_STOCK', req.session!.organization_id],
  );

  return res.status(201).json({
    success: true,
    data: result.rows[0],
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

// 19.3 Inter-Warehouse Stock Transfers
app.get('/api/inventory/transfers', authenticate, async (req: Request, res: Response) => {
  const transfersRes = await db.query(
    `SELECT t.*, sw.name as source_warehouse_name, dw.name as destination_warehouse_name 
     FROM stock_transfers t 
     JOIN warehouses sw ON t.source_warehouse_id = sw.id 
     JOIN warehouses dw ON t.destination_warehouse_id = dw.id 
     WHERE t.organization_id = $1 
     ORDER BY t.created_at DESC`,
    [req.session!.organization_id],
  );
  const transfers = transfersRes.rows;

  for (const t of transfers) {
    const itemsRes = await db.query(
      `SELECT ti.*, i.code as item_code, i.name as item_name 
       FROM stock_transfer_items ti 
       JOIN items i ON ti.item_id = i.id 
       WHERE ti.transfer_id = $1`,
      [t.id],
    );
    t.items = itemsRes.rows;
  }

  return res.json({
    success: true,
    data: transfers,
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/inventory/transfers', authenticate, requirePermission(Permission.INVENTORY_TRANSFER), async (req: Request, res: Response) => {
  const { transfer_number, source_warehouse_id, destination_warehouse_id, transfer_date, notes, items } = req.body;
  if (!source_warehouse_id || !destination_warehouse_id || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED, message: 'Source, destination, and items are required', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const num = transfer_number || `TRF-${Date.now().toString().slice(-6)}`;
  const date = transfer_date || new Date().toISOString().slice(0, 10);

  const transferRes = await db.query(
    `INSERT INTO stock_transfers (transfer_number, source_warehouse_id, destination_warehouse_id, transfer_date, notes, status, organization_id)
     VALUES ($1, $2, $3, $4, $5, 'DRAFT', $6) RETURNING *`,
    [num, source_warehouse_id, destination_warehouse_id, date, notes || null, req.session!.organization_id],
  );
  const transfer = transferRes.rows[0];

  const insertedItems: any[] = [];
  for (const it of items) {
    const itemRes = await db.query(
      `INSERT INTO stock_transfer_items (transfer_id, item_id, requested_qty, shipped_qty, received_qty, lot_id)
       VALUES ($1, $2, $3, 0.00000000, 0.00000000, $4) RETURNING *`,
      [transfer.id, it.item_id, it.requested_qty, it.lot_id || null],
    );
    insertedItems.push(itemRes.rows[0]);
  }
  transfer.items = insertedItems;

  return res.status(201).json({
    success: true,
    data: transfer,
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/inventory/transfers/:id/ship', authenticate, requirePermission(Permission.INVENTORY_TRANSFER), async (req: Request, res: Response) => {
  const { id } = req.params;
  const transferRes = await db.query(
    `SELECT * FROM stock_transfers WHERE id = $1 AND organization_id = $2`,
    [id, req.session!.organization_id],
  );
  if (transferRes.rows.length === 0) {
    return res.status(404).json({
      success: false,
      error: { code: ErrorCode.RESOURCE_NOT_FOUND, message: 'Transfer not found', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const transfer = transferRes.rows[0];
  if (transfer.status !== 'DRAFT') {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED, message: `Cannot ship transfer in status ${transfer.status}`, correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  // Update shipped_qty = requested_qty and status = IN_TRANSIT
  await db.query(
    `UPDATE stock_transfer_items SET shipped_qty = requested_qty WHERE transfer_id = $1`,
    [id],
  );
  await db.query(
    `UPDATE stock_transfers SET status = 'IN_TRANSIT', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [id],
  );

  return res.json({
    success: true,
    data: { id, status: 'IN_TRANSIT' },
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/inventory/transfers/:id/receive', authenticate, requirePermission(Permission.INVENTORY_TRANSFER), async (req: Request, res: Response) => {
  const { id } = req.params;
  const transferRes = await db.query(
    `SELECT * FROM stock_transfers WHERE id = $1 AND organization_id = $2`,
    [id, req.session!.organization_id],
  );
  if (transferRes.rows.length === 0) {
    return res.status(404).json({
      success: false,
      error: { code: ErrorCode.RESOURCE_NOT_FOUND, message: 'Transfer not found', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const transfer = transferRes.rows[0];
  if (transfer.status !== 'IN_TRANSIT') {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED, message: `Cannot receive transfer in status ${transfer.status}`, correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  // Update received_qty = shipped_qty and status = COMPLETED
  await db.query(
    `UPDATE stock_transfer_items SET received_qty = shipped_qty WHERE transfer_id = $1`,
    [id],
  );
  await db.query(
    `UPDATE stock_transfers SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [id],
  );

  return res.json({
    success: true,
    data: { id, status: 'COMPLETED' },
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

// 19.4 Physical Inventory Cycle Counts & Adjustments
app.get('/api/inventory/counts', authenticate, async (req: Request, res: Response) => {
  const countsRes = await db.query(
    `SELECT c.*, w.name as warehouse_name 
     FROM inventory_counts c 
     JOIN warehouses w ON c.warehouse_id = w.id 
     WHERE c.organization_id = $1 
     ORDER BY c.created_at DESC`,
    [req.session!.organization_id],
  );
  const counts = countsRes.rows;

  for (const c of counts) {
    const itemsRes = await db.query(
      `SELECT ci.*, i.code as item_code, i.name as item_name 
       FROM inventory_count_items ci 
       JOIN items i ON ci.item_id = i.id 
       WHERE ci.count_id = $1`,
      [c.id],
    );
    c.items = itemsRes.rows;
  }

  return res.json({
    success: true,
    data: counts,
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/inventory/counts', authenticate, requirePermission(Permission.INVENTORY_COUNT), async (req: Request, res: Response) => {
  const { warehouse_id, period_id, count_date, count_number } = req.body;
  if (!warehouse_id || !period_id) {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED, message: 'Warehouse and period are required', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const num = count_number || `CNT-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;
  const date = count_date || new Date().toISOString().slice(0, 10);

  // Snapshot current items
  const itemsRes = await db.query(
    `SELECT id, unit_cost FROM items WHERE organization_id = $1 AND item_type = 'INVENTORY'`,
    [req.session!.organization_id],
  );

  const countRes = await db.query(
    `INSERT INTO inventory_counts (count_number, warehouse_id, period_id, count_date, status, organization_id)
     VALUES ($1, $2, $3, $4, 'PLANNED', $5) RETURNING *`,
    [num, warehouse_id, period_id, date, req.session!.organization_id],
  );
  const count = countRes.rows[0];

  const insertedItems: any[] = [];
  for (const it of itemsRes.rows) {
    // Get aggregated stock on hand
    const stockRes = await db.query(
      `SELECT COALESCE(SUM(quantity), 0) as on_hand FROM stock_movements WHERE item_id = $1`,
      [it.id],
    );
    const systemQty = stockRes.rows[0].on_hand.toString();

    const cItemRes = await db.query(
      `INSERT INTO inventory_count_items (count_id, item_id, system_qty, counted_qty, variance_qty, unit_cost, variance_value)
       VALUES ($1, $2, $3, $3, 0.00000000, $4, 0.00000000) RETURNING *`,
      [count.id, it.id, systemQty, it.unit_cost],
    );
    insertedItems.push(cItemRes.rows[0]);
  }
  count.items = insertedItems;

  return res.status(201).json({
    success: true,
    data: count,
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/inventory/counts/:id/record', authenticate, requirePermission(Permission.INVENTORY_COUNT), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { counts } = req.body; // Array of { item_id, counted_qty }

  const countRes = await db.query(
    `SELECT * FROM inventory_counts WHERE id = $1 AND organization_id = $2`,
    [id, req.session!.organization_id],
  );
  if (countRes.rows.length === 0) {
    return res.status(404).json({
      success: false,
      error: { code: ErrorCode.RESOURCE_NOT_FOUND, message: 'Count sheet not found', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const count = countRes.rows[0];
  if (count.status === 'POSTED') {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.POSTED_FACT_IMMUTABLE, message: 'Count is already posted', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  // Update counted quantities and compute variances
  const existingItemsRes = await db.query(`SELECT * FROM inventory_count_items WHERE count_id = $1`, [id]);
  const countMap = new Map<string, string>();
  for (const c of counts || []) {
    countMap.set(c.item_id, c.counted_qty);
  }

  const itemsToCalc = existingItemsRes.rows.map((row) => ({
    item_id: row.item_id,
    system_qty: row.system_qty,
    counted_qty: countMap.has(row.item_id) ? countMap.get(row.item_id)! : row.counted_qty,
    unit_cost: row.unit_cost,
  }));

  const varianceResult = InventoryReconciliationEngine.calculateVariances(itemsToCalc);

  for (const item of varianceResult.items) {
    await db.query(
      `UPDATE inventory_count_items 
       SET counted_qty = $1, variance_qty = $2, variance_value = $3 
       WHERE count_id = $4 AND item_id = $5`,
      [item.counted_qty, item.variance_qty, item.variance_value, id, item.item_id],
    );
  }

  await db.query(
    `UPDATE inventory_counts 
     SET status = 'RECONCILED', total_variance_value = $1, updated_at = CURRENT_TIMESTAMP 
     WHERE id = $2`,
    [varianceResult.total_variance_value, id],
  );

  return res.json({
    success: true,
    data: { id, status: 'RECONCILED', total_variance_value: varianceResult.total_variance_value },
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/inventory/counts/:id/reconcile-and-post', authenticate, requirePermission(Permission.INVENTORY_ADJUST), async (req: Request, res: Response) => {
  const { id } = req.params;

  const countRes = await db.query(
    `SELECT * FROM inventory_counts WHERE id = $1 AND organization_id = $2`,
    [id, req.session!.organization_id],
  );
  if (countRes.rows.length === 0) {
    return res.status(404).json({
      success: false,
      error: { code: ErrorCode.RESOURCE_NOT_FOUND, message: 'Count sheet not found', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const count = countRes.rows[0];
  if (count.status === 'POSTED') {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.ALREADY_POSTED, message: 'Count already posted to GL', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const varianceVal = new Money(count.total_variance_value);
  if (varianceVal.isZero()) {
    // Zero variance: simply mark POSTED without creating a zero GL voucher
    await db.query(`UPDATE inventory_counts SET status = 'POSTED', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);
    return res.json({
      success: true,
      data: { id, status: 'POSTED', journal_id: null },
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  }

  // Lookup Accounts: 113001 (Inventory Asset) and 511002 (Inventory Adjustments)
  const invAccRes = await db.query(
    `SELECT id FROM accounts WHERE code = '113001' AND organization_id = $1`,
    [req.session!.organization_id],
  );
  const adjAccRes = await db.query(
    `SELECT id FROM accounts WHERE code = '511002' AND organization_id = $1`,
    [req.session!.organization_id],
  );

  if (invAccRes.rows.length === 0 || adjAccRes.rows.length === 0) {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED, message: 'Required GL accounts (113001 or 511002) not found in COA', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const today = new Date().toISOString().slice(0, 10);
  const draft = InventoryReconciliationEngine.generateAdjustmentJournal({
    inventoryCount: count,
    organizationId: req.session!.organization_id,
    legalEntityId: req.session!.legal_entity_id,
    inventoryAccountId: invAccRes.rows[0].id,
    adjustmentExpenseAccountId: adjAccRes.rows[0].id,
    postingDate: today,
    documentDate: today,
  });

  // Calculate totals
  let totalBaseDebit = Money.zero();
  let totalBaseCredit = Money.zero();
  for (const l of draft.lines) {
    totalBaseDebit = totalBaseDebit.add(new Money(l.base_debit));
    totalBaseCredit = totalBaseCredit.add(new Money(l.base_credit));
  }

  const journalId = crypto.randomUUID();
  const journalNumber = `JV-ADJ-${count.count_number}`;
  await db.query(
    `INSERT INTO journals (
      id, organization_id, legal_entity_id, journal_number, posting_date, document_date,
      accounting_purpose, status, base_currency, total_base_debit, total_base_credit,
      description, source_type, source_id, created_by, posted_by, posted_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'POSTED', $8, $9, $10, $11, 'INVENTORY_COUNT', $12, $13, $13, CURRENT_TIMESTAMP)`,
    [
      journalId,
      req.session!.organization_id,
      req.session!.legal_entity_id,
      journalNumber,
      today,
      today,
      AccountingPurpose.INVENTORY_ADJUSTMENT,
      'PKR',
      totalBaseDebit.format(),
      totalBaseCredit.format(),
      draft.description,
      id,
      req.session!.user_id,
    ],
  );

  for (const line of draft.lines) {
    await db.query(
      `INSERT INTO journal_lines (
        id, journal_id, line_number, account_id, debit_amount, credit_amount, currency, fx_rate, base_debit, base_credit, description
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        crypto.randomUUID(),
        journalId,
        line.line_number,
        line.account_id,
        line.debit_amount,
        line.credit_amount,
        line.currency || 'PKR',
        line.fx_rate || '1.000000000000',
        line.base_debit,
        line.base_credit,
        line.description,
      ],
    );
  }

  // Update Inventory Count status
  await db.query(
    `UPDATE inventory_counts SET status = 'POSTED', journal_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
    [journalId, id],
  );

  return res.json({
    success: true,
    data: { id, status: 'POSTED', journal_id: journalId, total_variance_value: count.total_variance_value },
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

// 19.5 Bills of Materials (BOM)
app.get('/api/manufacturing/boms', authenticate, async (req: Request, res: Response) => {
  const bomsRes = await db.query(
    `SELECT b.*, i.code as finished_item_code, i.name as finished_item_name 
     FROM bill_of_materials b 
     JOIN items i ON b.finished_item_id = i.id 
     WHERE b.organization_id = $1 
     ORDER BY b.created_at DESC`,
    [req.session!.organization_id],
  );
  const boms = bomsRes.rows;

  for (const b of boms) {
    const itemsRes = await db.query(
      `SELECT bi.*, i.code as component_code, i.name as component_name, i.uom as component_uom 
       FROM bom_items bi 
       JOIN items i ON bi.component_item_id = i.id 
       WHERE bi.bom_id = $1`,
      [b.id],
    );
    b.items = itemsRes.rows;
  }

  return res.json({
    success: true,
    data: boms,
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/manufacturing/boms', authenticate, requirePermission(Permission.BOM_MANAGE), async (req: Request, res: Response) => {
  const { bom_number, finished_item_id, name, version, yield_quantity, items } = req.body;
  if (!finished_item_id || !name || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED, message: 'Finished item, name, and components are required', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const num = bom_number || `BOM-${Date.now().toString().slice(-6)}`;
  const yieldQty = yield_quantity || '1.00000000';

  const bomRes = await db.query(
    `INSERT INTO bill_of_materials (bom_number, finished_item_id, name, version, yield_quantity, status, organization_id)
     VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6) RETURNING *`,
    [num, finished_item_id, name, version || '1.0', yieldQty, req.session!.organization_id],
  );
  const bom = bomRes.rows[0];

  const insertedItems: any[] = [];
  for (const it of items) {
    const biRes = await db.query(
      `INSERT INTO bom_items (bom_id, component_item_id, quantity, scrap_percentage, notes)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [bom.id, it.component_item_id, it.quantity, it.scrap_percentage || '0.00', it.notes || null],
    );
    insertedItems.push(biRes.rows[0]);
  }
  bom.items = insertedItems;

  return res.status(201).json({
    success: true,
    data: bom,
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

// 19.6 Work Orders & Manufacturing Assembly
app.get('/api/manufacturing/work-orders', authenticate, async (req: Request, res: Response) => {
  const wosRes = await db.query(
    `SELECT wo.*, b.name as bom_name, i.code as finished_item_code, i.name as finished_item_name, w.name as warehouse_name 
     FROM work_orders wo 
     JOIN bill_of_materials b ON wo.bom_id = b.id 
     JOIN items i ON wo.finished_item_id = i.id 
     JOIN warehouses w ON wo.warehouse_id = w.id 
     WHERE wo.organization_id = $1 
     ORDER BY wo.created_at DESC`,
    [req.session!.organization_id],
  );
  const workOrders = wosRes.rows;

  for (const wo of workOrders) {
    const consRes = await db.query(
      `SELECT c.*, i.code as component_code, i.name as component_name 
       FROM work_order_consumptions c 
       JOIN items i ON c.component_item_id = i.id 
       WHERE c.work_order_id = $1`,
      [wo.id],
    );
    wo.consumptions = consRes.rows;
  }

  return res.json({
    success: true,
    data: workOrders,
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/manufacturing/work-orders', authenticate, requirePermission(Permission.WORK_ORDER_MANAGE), async (req: Request, res: Response) => {
  const { work_order_number, bom_id, warehouse_id, target_qty, start_date, due_date } = req.body;
  if (!bom_id || !warehouse_id || !target_qty) {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED, message: 'BOM, warehouse, and target quantity are required', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const bomRes = await db.query(`SELECT * FROM bill_of_materials WHERE id = $1`, [bom_id]);
  if (bomRes.rows.length === 0) {
    return res.status(404).json({
      success: false,
      error: { code: ErrorCode.RESOURCE_NOT_FOUND, message: 'BOM not found', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }
  const bom = bomRes.rows[0];

  const num = work_order_number || `WO-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;
  const sDate = start_date || new Date().toISOString().slice(0, 10);
  const dDate = due_date || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  const woRes = await db.query(
    `INSERT INTO work_orders (
      work_order_number, bom_id, finished_item_id, warehouse_id, target_qty,
      status, start_date, due_date, organization_id
    ) VALUES ($1, $2, $3, $4, $5, 'PLANNED', $6, $7, $8) RETURNING *`,
    [num, bom_id, bom.finished_item_id, warehouse_id, target_qty, sDate, dDate, req.session!.organization_id],
  );

  return res.status(201).json({
    success: true,
    data: woRes.rows[0],
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/manufacturing/work-orders/:id/release', authenticate, requirePermission(Permission.WORK_ORDER_RELEASE), async (req: Request, res: Response) => {
  const { id } = req.params;
  const woRes = await db.query(
    `SELECT * FROM work_orders WHERE id = $1 AND organization_id = $2`,
    [id, req.session!.organization_id],
  );
  if (woRes.rows.length === 0) {
    return res.status(404).json({
      success: false,
      error: { code: ErrorCode.RESOURCE_NOT_FOUND, message: 'Work order not found', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const wo = woRes.rows[0];
  if (wo.status !== 'PLANNED') {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED, message: `Cannot release work order in status ${wo.status}`, correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  await db.query(`UPDATE work_orders SET status = 'RELEASED', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);

  return res.json({
    success: true,
    data: { id, status: 'RELEASED' },
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/manufacturing/work-orders/:id/consume', authenticate, requirePermission(Permission.WORK_ORDER_CONSUME), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { component_item_id, consumed_qty, lot_id } = req.body;
  if (!component_item_id || !consumed_qty) {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED, message: 'Component item and consumed quantity are required', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const woRes = await db.query(
    `SELECT * FROM work_orders WHERE id = $1 AND organization_id = $2`,
    [id, req.session!.organization_id],
  );
  if (woRes.rows.length === 0) {
    return res.status(404).json({
      success: false,
      error: { code: ErrorCode.RESOURCE_NOT_FOUND, message: 'Work order not found', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const itemRes = await db.query(`SELECT unit_cost FROM items WHERE id = $1`, [component_item_id]);
  const unitCost = itemRes.rows[0]?.unit_cost || '0.00000000';
  const totalCost = new Money(consumed_qty).multiply(new Money(unitCost)).format();

  const consRes = await db.query(
    `INSERT INTO work_order_consumptions (work_order_id, component_item_id, consumed_qty, unit_cost, total_cost, lot_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [id, component_item_id, consumed_qty, unitCost, totalCost, lot_id || null],
  );

  // Update total material cost and status = IN_PROGRESS on work order
  await db.query(
    `UPDATE work_orders 
     SET status = 'IN_PROGRESS', 
         total_material_cost = (SELECT COALESCE(SUM(total_cost), 0) FROM work_order_consumptions WHERE work_order_id = $1),
         updated_at = CURRENT_TIMESTAMP 
     WHERE id = $1`,
    [id],
  );

  return res.status(201).json({
    success: true,
    data: consRes.rows[0],
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/manufacturing/work-orders/:id/complete', authenticate, requirePermission(Permission.WORK_ORDER_COMPLETE), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { completed_qty, scrapped_qty } = req.body;

  const woRes = await db.query(
    `SELECT * FROM work_orders WHERE id = $1 AND organization_id = $2`,
    [id, req.session!.organization_id],
  );
  if (woRes.rows.length === 0) {
    return res.status(404).json({
      success: false,
      error: { code: ErrorCode.RESOURCE_NOT_FOUND, message: 'Work order not found', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const wo = woRes.rows[0];
  if (wo.status === 'COMPLETED' || wo.status === 'CLOSED') {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.ALREADY_POSTED, message: 'Work order already completed', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const consRes = await db.query(`SELECT * FROM work_order_consumptions WHERE work_order_id = $1`, [id]);
  if (consRes.rows.length === 0) {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.INSUFFICIENT_RAW_MATERIALS, message: 'No materials recorded as consumed for this work order', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const finalCompletedQty = completed_qty || wo.target_qty;
  const finalScrappedQty = scrapped_qty || '0.00000000';

  wo.completed_qty = finalCompletedQty;
  wo.scrapped_qty = finalScrappedQty;

  // Lookup Accounts: 113004 (Finished Goods), 113003 (WIP), 511003 (Scrap)
  const fgAccRes = await db.query(`SELECT id FROM accounts WHERE code = '113004' AND organization_id = $1`, [req.session!.organization_id]);
  const wipAccRes = await db.query(`SELECT id FROM accounts WHERE code = '113003' AND organization_id = $1`, [req.session!.organization_id]);
  const scrapAccRes = await db.query(`SELECT id FROM accounts WHERE code = '511003' AND organization_id = $1`, [req.session!.organization_id]);

  if (fgAccRes.rows.length === 0 || wipAccRes.rows.length === 0 || scrapAccRes.rows.length === 0) {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED, message: 'Required GL accounts (113004, 113003, or 511003) not found in COA', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const today = new Date().toISOString().slice(0, 10);
  const draft = ManufacturingEngine.generateCompletionJournal({
    workOrder: wo,
    organizationId: req.session!.organization_id,
    legalEntityId: req.session!.legal_entity_id,
    finishedGoodsAccountId: fgAccRes.rows[0].id,
    wipAccountId: wipAccRes.rows[0].id,
    scrapExpenseAccountId: scrapAccRes.rows[0].id,
    postingDate: today,
    documentDate: today,
    consumptions: consRes.rows,
  });

  // Calculate totals
  let totalBaseDebit = Money.zero();
  let totalBaseCredit = Money.zero();
  for (const l of draft.lines) {
    totalBaseDebit = totalBaseDebit.add(new Money(l.base_debit));
    totalBaseCredit = totalBaseCredit.add(new Money(l.base_credit));
  }

  const journalId = crypto.randomUUID();
  const journalNumber = `JV-MFG-${wo.work_order_number}`;
  await db.query(
    `INSERT INTO journals (
      id, organization_id, legal_entity_id, journal_number, posting_date, document_date,
      accounting_purpose, status, base_currency, total_base_debit, total_base_credit,
      description, source_type, source_id, created_by, posted_by, posted_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'POSTED', $8, $9, $10, $11, 'WORK_ORDER', $12, $13, $13, CURRENT_TIMESTAMP)`,
    [
      journalId,
      req.session!.organization_id,
      req.session!.legal_entity_id,
      journalNumber,
      today,
      today,
      AccountingPurpose.MANUFACTURING_ASSEMBLY_RECEIPT,
      'PKR',
      totalBaseDebit.format(),
      totalBaseCredit.format(),
      draft.description,
      id,
      req.session!.user_id,
    ],
  );

  for (const line of draft.lines) {
    await db.query(
      `INSERT INTO journal_lines (
        id, journal_id, line_number, account_id, debit_amount, credit_amount, currency, fx_rate, base_debit, base_credit, description
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        crypto.randomUUID(),
        journalId,
        line.line_number,
        line.account_id,
        line.debit_amount,
        line.credit_amount,
        line.currency || 'PKR',
        line.fx_rate || '1.000000000000',
        line.base_debit,
        line.base_credit,
        line.description,
      ],
    );
  }

  // Update Work Order
  await db.query(
    `UPDATE work_orders 
     SET status = 'COMPLETED', completed_qty = $1, scrapped_qty = $2, completion_journal_id = $3, updated_at = CURRENT_TIMESTAMP 
     WHERE id = $4`,
    [finalCompletedQty, finalScrappedQty, journalId, id],
  );

  return res.json({
    success: true,
    data: { id, status: 'COMPLETED', completion_journal_id: journalId, completed_qty: finalCompletedQty },
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

// ==========================================
// 20. Projects, Cost Centers, BOQ & Progress Invoicing (M6)
// ==========================================

// Cost Centers
app.get('/api/projects/cost-centers', authenticate, requirePermission(Permission.FINANCE_COA_VIEW), async (req: Request, res: Response) => {
  const result = await db.query(
    'SELECT * FROM cost_centers WHERE organization_id = $1 ORDER BY code ASC',
    [req.session!.organization_id]
  );

  return res.json({
    success: true,
    data: result.rows,
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/projects/cost-centers', authenticate, requirePermission(Permission.PROJECT_MANAGE), async (req: Request, res: Response) => {
  const { code, name, cost_center_type, manager_name } = req.body;

  if (!code || !name) {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED, message: 'Code and name are required', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO cost_centers (id, code, name, cost_center_type, manager_name, organization_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, code, name, cost_center_type || 'OPERATIONAL', manager_name || null, req.session!.organization_id]
  );

  return res.status(201).json({
    success: true,
    data: { id, code, name, cost_center_type: cost_center_type || 'OPERATIONAL', manager_name },
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

// Projects Master
app.get('/api/projects', authenticate, requirePermission(Permission.FINANCE_REPORTS_VIEW), async (req: Request, res: Response) => {
  const result = await db.query(
    `SELECT p.*, c.name as customer_name, cc.name as cost_center_name 
     FROM projects p 
     LEFT JOIN parties c ON c.id = p.customer_id 
     LEFT JOIN cost_centers cc ON cc.id = p.cost_center_id 
     WHERE p.organization_id = $1 
     ORDER BY p.code ASC`,
    [req.session!.organization_id]
  );

  return res.json({
    success: true,
    data: result.rows,
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/projects', authenticate, requirePermission(Permission.PROJECT_MANAGE), async (req: Request, res: Response) => {
  const {
    code,
    name,
    customer_id,
    manager_name,
    project_type,
    contract_value,
    budgeted_cost,
    retention_percentage,
    start_date,
    end_date,
    cost_center_id,
  } = req.body;

  if (!code || !name || !start_date) {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED, message: 'Code, name, and start_date are required', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO projects (
      id, code, name, customer_id, manager_name, project_type,
      contract_value, budgeted_cost, retention_percentage, status,
      start_date, end_date, cost_center_id, organization_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'APPROVED', $10, $11, $12, $13)`,
    [
      id,
      code,
      name,
      customer_id || null,
      manager_name || null,
      project_type || 'CONSTRUCTION',
      new Money(contract_value || '0').toFixed(8),
      new Money(budgeted_cost || '0').toFixed(8),
      retention_percentage || 5.0,
      start_date,
      end_date || null,
      cost_center_id || null,
      req.session!.organization_id,
    ]
  );

  return res.status(201).json({
    success: true,
    data: { id, code, name, status: 'APPROVED' },
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

// Project WBS
app.get('/api/projects/:id/wbs', authenticate, requirePermission(Permission.PROJECT_MANAGE), async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await db.query(
    'SELECT * FROM project_wbs_nodes WHERE project_id = $1 ORDER BY wbs_code ASC',
    [id]
  );

  return res.json({
    success: true,
    data: result.rows,
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/projects/:id/wbs', authenticate, requirePermission(Permission.PROJECT_MANAGE), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { wbs_code, name, parent_id, budget_cost, progress_percentage, status } = req.body;

  if (!wbs_code || !name) {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED, message: 'WBS code and name are required', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const nodeId = crypto.randomUUID();
  await db.query(
    `INSERT INTO project_wbs_nodes (id, project_id, wbs_code, name, parent_id, budget_cost, progress_percentage, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      nodeId,
      id,
      wbs_code,
      name,
      parent_id || null,
      new Money(budget_cost || '0').toFixed(8),
      progress_percentage || 0.0,
      status || 'NOT_STARTED',
    ]
  );

  return res.status(201).json({
    success: true,
    data: { id: nodeId, project_id: id, wbs_code, name },
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

// Bill of Quantities (BOQ)
app.get('/api/projects/:id/boq', authenticate, requirePermission(Permission.BOQ_MANAGE), async (req: Request, res: Response) => {
  const { id } = req.params;
  const boqRes = await db.query(
    `SELECT b.*, p.code as project_code, p.name as project_name 
     FROM bill_of_quantities b
     JOIN projects p ON p.id = b.project_id
     WHERE b.project_id = $1 AND b.organization_id = $2
     ORDER BY b.created_at DESC`,
    [id, req.session!.organization_id]
  );

  const boqs = [];
  for (const boq of boqRes.rows) {
    const itemsRes = await db.query(
      `SELECT bi.*, w.wbs_code 
       FROM boq_items bi 
       LEFT JOIN project_wbs_nodes w ON w.id = bi.wbs_node_id 
       WHERE bi.boq_id = $1 
       ORDER BY bi.item_code ASC`,
      [boq.id]
    );
    boqs.push({
      ...boq,
      items: itemsRes.rows,
    });
  }

  return res.json({
    success: true,
    data: boqs,
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/projects/:id/boq', authenticate, requirePermission(Permission.BOQ_MANAGE), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { boq_number, title, version, items } = req.body;

  if (!boq_number || !title || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED, message: 'boq_number, title, and at least one item are required', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  let totalAmount = Money.zero();
  const calculatedItems = items.map((it: any) => {
    const qty = new Money(it.contract_quantity || '0');
    const rate = new Money(it.unit_rate || '0');
    const lineTotal = qty.mul(rate);
    totalAmount = totalAmount.add(lineTotal);
    return {
      ...it,
      contract_quantity: qty.toFixed(8),
      unit_rate: rate.toFixed(8),
      total_amount: lineTotal.toFixed(8),
    };
  });

  const boqId = crypto.randomUUID();

  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO bill_of_quantities (id, project_id, boq_number, title, version, total_amount, status, organization_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'APPROVED', $7)`,
      [boqId, id, boq_number, title, version || '1.0', totalAmount.toFixed(8), req.session!.organization_id]
    );

    for (const item of calculatedItems) {
      await tx.query(
        `INSERT INTO boq_items (id, boq_id, wbs_node_id, item_code, description, uom, contract_quantity, unit_rate, total_amount, certified_quantity)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '0.00000000')`,
        [
          crypto.randomUUID(),
          boqId,
          item.wbs_node_id || null,
          item.item_code,
          item.description,
          item.uom || 'UNIT',
          item.contract_quantity,
          item.unit_rate,
          item.total_amount,
        ]
      );
    }
  });

  return res.status(201).json({
    success: true,
    data: { id: boqId, boq_number, title, total_amount: totalAmount.toFixed(8), status: 'APPROVED' },
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

// Progress Certificates (Interim Payment Certificates - IPC)
app.get('/api/projects/:id/certificates', authenticate, requirePermission(Permission.PROGRESS_CERTIFY), async (req: Request, res: Response) => {
  const { id } = req.params;
  const certRes = await db.query(
    `SELECT pc.*, p.name as project_name 
     FROM progress_certificates pc 
     JOIN projects p ON p.id = pc.project_id 
     WHERE pc.project_id = $1 AND pc.organization_id = $2 
     ORDER BY pc.certificate_date DESC, pc.certificate_number DESC`,
    [id, req.session!.organization_id]
  );

  const certs = [];
  for (const cert of certRes.rows) {
    const itemsRes = await db.query(
      `SELECT pci.*, bi.item_code, bi.description 
       FROM progress_certificate_items pci 
       JOIN boq_items bi ON bi.id = pci.boq_item_id 
       WHERE pci.certificate_id = $1`,
      [cert.id]
    );
    certs.push({
      ...cert,
      items: itemsRes.rows,
    });
  }

  return res.json({
    success: true,
    data: certs,
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/projects/:id/certificates', authenticate, requirePermission(Permission.PROGRESS_CERTIFY), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { certificate_number, boq_id, period_id, certificate_date, items } = req.body;

  if (!certificate_number || !boq_id || !period_id || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED, message: 'certificate_number, boq_id, period_id, and items are required', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  // Fetch project
  const prjRes = await db.query('SELECT * FROM projects WHERE id = $1 AND organization_id = $2', [id, req.session!.organization_id]);
  if (prjRes.rows.length === 0) {
    return res.status(404).json({
      success: false,
      error: { code: ErrorCode.RESOURCE_NOT_FOUND, message: 'Project not found', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }
  const project = prjRes.rows[0];

  // Fetch BOQ items
  const boqItemsRes = await db.query('SELECT * FROM boq_items WHERE boq_id = $1', [boq_id]);
  const boqItems = boqItemsRes.rows;

  // Validate quantities
  const validation = ProjectsEngine.validateBoqQuantities(boqItems, items);
  if (!validation.valid) {
    return res.status(422).json({
      success: false,
      error: {
        code: ErrorCode.OVER_CERTIFICATION,
        message: `Certification quantity exceeds contract quantity for item ${validation.exceededItemCode} by ${validation.exceededQty}`,
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  // Prepare items with unit rate and previous quantity
  const itemsForCalc = items.map((it: any) => {
    const boqItem = boqItems.find((b) => b.id === it.boq_item_id);
    if (!boqItem) {
      throw new Error(`BOQ item ${it.boq_item_id} not found`);
    }
    return {
      boq_item_id: it.boq_item_id,
      previous_quantity: boqItem.certified_quantity || '0.00000000',
      current_quantity: new Money(it.current_quantity || '0').toFixed(8),
      unit_rate: boqItem.unit_rate,
    };
  });

  const calculated = ProjectsEngine.calculateProgressCertificate(itemsForCalc, project.retention_percentage.toString());
  const certId = crypto.randomUUID();

  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO progress_certificates (
        id, certificate_number, project_id, boq_id, period_id,
        certificate_date, gross_certified_amount, retention_amount, net_certified_amount,
        status, organization_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'DRAFT', $10)`,
      [
        certId,
        certificate_number,
        id,
        boq_id,
        period_id,
        certificate_date || new Date().toISOString().slice(0, 10),
        calculated.gross_certified_amount,
        calculated.retention_amount,
        calculated.net_certified_amount,
        req.session!.organization_id,
      ]
    );

    for (const item of calculated.items) {
      await tx.query(
        `INSERT INTO progress_certificate_items (
          id, certificate_id, boq_item_id, previous_quantity, current_quantity, cumulative_quantity, unit_rate, current_amount
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          crypto.randomUUID(),
          certId,
          item.boq_item_id,
          item.previous_quantity,
          item.current_quantity,
          item.cumulative_quantity,
          item.unit_rate,
          item.current_amount,
        ]
      );
    }
  });

  return res.status(201).json({
    success: true,
    data: {
      id: certId,
      certificate_number,
      gross_certified_amount: calculated.gross_certified_amount,
      retention_amount: calculated.retention_amount,
      net_certified_amount: calculated.net_certified_amount,
      status: 'DRAFT',
    },
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/projects/:id/certificates/:certId/certify', authenticate, requirePermission(Permission.PROGRESS_CERTIFY), async (req: Request, res: Response) => {
  const { id, certId } = req.params;

  const certRes = await db.query(
    'SELECT * FROM progress_certificates WHERE id = $1 AND project_id = $2 AND organization_id = $3',
    [certId, id, req.session!.organization_id]
  );
  if (certRes.rows.length === 0) {
    return res.status(404).json({
      success: false,
      error: { code: ErrorCode.RESOURCE_NOT_FOUND, message: 'Progress certificate not found', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const cert = certRes.rows[0];
  if (cert.status !== 'DRAFT') {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED, message: `Certificate cannot be certified from status ${cert.status}`, correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const itemsRes = await db.query('SELECT * FROM progress_certificate_items WHERE certificate_id = $1', [certId]);

  await db.transaction(async (tx) => {
    for (const item of itemsRes.rows) {
      await tx.query(
        'UPDATE boq_items SET certified_quantity = $1 WHERE id = $2',
        [item.cumulative_quantity, item.boq_item_id]
      );
    }

    await tx.query(
      "UPDATE progress_certificates SET status = 'CERTIFIED', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
      [certId]
    );
  });

  return res.json({
    success: true,
    data: { id: certId, status: 'CERTIFIED' },
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/projects/:id/certificates/:certId/generate-invoice', authenticate, requirePermission(Permission.PROGRESS_INVOICE), async (req: Request, res: Response) => {
  const { id, certId } = req.params;

  const certRes = await db.query(
    `SELECT pc.*, p.code as project_code, p.cost_center_id 
     FROM progress_certificates pc 
     JOIN projects p ON p.id = pc.project_id 
     WHERE pc.id = $1 AND pc.project_id = $2 AND pc.organization_id = $3`,
    [certId, id, req.session!.organization_id]
  );

  if (certRes.rows.length === 0) {
    return res.status(404).json({
      success: false,
      error: { code: ErrorCode.RESOURCE_NOT_FOUND, message: 'Progress certificate not found', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const cert = certRes.rows[0];
  if (cert.status !== 'CERTIFIED') {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED, message: `Cannot generate invoice for certificate in status ${cert.status}. Must be CERTIFIED.`, correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  // Look up accounts:
  // AR: 112001 (Trade AR Control)
  // Retention Receivable: 112003 (Project Retention Receivable)
  // Revenue: 411003 (Project Milestone & Contract Revenue)
  const accRes = await db.query(
    `SELECT id, code FROM accounts WHERE organization_id = $1 AND code IN ('112001', '112003', '411003')`,
    [req.session!.organization_id]
  );
  const accountsMap = new Map<string, string>(accRes.rows.map((r) => [r.code, r.id]));

  const arAccountId = accountsMap.get('112001');
  const retentionAccountId = accountsMap.get('112003');
  const revenueAccountId = accountsMap.get('411003');

  if (!arAccountId || !retentionAccountId || !revenueAccountId) {
    return res.status(422).json({
      success: false,
      error: {
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Required accounts (112001, 112003, 411003) not found in COA',
        correlation_id: req.correlationId,
      },
    } satisfies StandardErrorResponse);
  }

  const journalDraft = ProjectsEngine.generateProgressInvoiceJournal({
    organization_id: req.session!.organization_id,
    legal_entity_id: req.session!.legal_entity_id,
    period_id: cert.period_id,
    certificate_number: cert.certificate_number,
    project_code: cert.project_code,
    gross_amount: cert.gross_certified_amount,
    retention_amount: cert.retention_amount,
    net_amount: cert.net_certified_amount,
    ar_account_id: arAccountId,
    retention_receivable_account_id: retentionAccountId,
    revenue_account_id: revenueAccountId,
    cost_center_id: cert.cost_center_id,
    user_id: req.session!.user_id,
  });

  const journalId = crypto.randomUUID();
  const today = new Date().toISOString().slice(0, 10);

  await db.transaction(async (tx) => {
    // Insert journal
    await tx.query(
      `INSERT INTO journals (
        id, organization_id, legal_entity_id, journal_number, posting_date, document_date,
        accounting_purpose, status, base_currency, total_base_debit, total_base_credit,
        description, source_type, source_id, created_by, posted_by, posted_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'POSTED', 'PKR', $8, $9, $10, 'PROGRESS_CERTIFICATE', $11, $12, $12, CURRENT_TIMESTAMP)`,
      [
        journalId,
        req.session!.organization_id,
        req.session!.legal_entity_id,
        journalDraft.journal_number,
        today,
        today,
        journalDraft.accounting_purpose,
        cert.gross_certified_amount,
        cert.gross_certified_amount,
        journalDraft.description,
        certId,
        req.session!.user_id,
      ]
    );

    // Insert journal lines
    for (let i = 0; i < journalDraft.lines.length; i++) {
      const line = journalDraft.lines[i];
      await tx.query(
        `INSERT INTO journal_lines (
          id, journal_id, line_number, account_id, debit_amount, credit_amount, currency, fx_rate, base_debit, base_credit, description
        ) VALUES ($1, $2, $3, $4, $5, $6, 'PKR', '1.000000000000', $7, $8, $9)`,
        [
          crypto.randomUUID(),
          journalId,
          i + 1,
          line.account_id,
          line.debit_amount,
          line.credit_amount,
          line.base_debit,
          line.base_credit,
          line.description,
        ]
      );
    }

    // Update progress certificate
    await tx.query(
      "UPDATE progress_certificates SET status = 'INVOICED', journal_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
      [journalId, certId]
    );
  });

  return res.json({
    success: true,
    data: {
      id: certId,
      status: 'INVOICED',
      journal_id: journalId,
      gross_amount: cert.gross_certified_amount,
      retention_amount: cert.retention_amount,
      net_amount: cert.net_certified_amount,
    },
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

// ==========================================
// 21. Fixed Assets & Depreciation Engine (M7)
// ==========================================

// Asset Categories
app.get('/api/assets/categories', authenticate, requirePermission(Permission.FINANCE_COA_VIEW), async (req: Request, res: Response) => {
  const result = await db.query(
    'SELECT * FROM asset_categories WHERE organization_id = $1 ORDER BY code ASC',
    [req.session!.organization_id]
  );
  return res.json({
    success: true,
    data: result.rows,
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/assets/categories', authenticate, requirePermission(Permission.ASSET_MANAGE), async (req: Request, res: Response) => {
  const {
    code,
    name,
    depreciation_method,
    useful_life_months,
    salvage_value_percentage,
    asset_cost_account_id,
    accumulated_deprec_account_id,
    deprec_expense_account_id,
  } = req.body;

  if (!code || !name) {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED, message: 'Code and name are required', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO asset_categories (
      id, code, name, depreciation_method, useful_life_months, salvage_value_percentage,
      asset_cost_account_id, accumulated_deprec_account_id, deprec_expense_account_id, organization_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      id,
      code,
      name,
      depreciation_method || 'STRAIGHT_LINE',
      useful_life_months || 60,
      salvage_value_percentage || 0.0,
      asset_cost_account_id || null,
      accumulated_deprec_account_id || null,
      deprec_expense_account_id || null,
      req.session!.organization_id,
    ]
  );

  return res.status(201).json({
    success: true,
    data: { id, code, name },
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

// Fixed Assets Register
app.get('/api/assets', authenticate, requirePermission(Permission.FINANCE_REPORTS_VIEW), async (req: Request, res: Response) => {
  const result = await db.query(
    `SELECT fa.*, ac.name as category_name 
     FROM fixed_assets fa 
     JOIN asset_categories ac ON ac.id = fa.category_id 
     WHERE fa.organization_id = $1 
     ORDER BY fa.asset_number ASC`,
    [req.session!.organization_id]
  );
  return res.json({
    success: true,
    data: result.rows,
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/assets', authenticate, requirePermission(Permission.ASSET_MANAGE), async (req: Request, res: Response) => {
  const {
    asset_number,
    name,
    category_id,
    acquisition_date,
    acquisition_cost,
    salvage_value,
    useful_life_months,
    depreciation_method,
    location,
    custodian_name,
    serial_number,
  } = req.body;

  if (!asset_number || !name || !category_id || !acquisition_cost) {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED, message: 'Asset number, name, category_id, and acquisition_cost are required', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const cost = new Money(acquisition_cost).toFixed(8);
  const salvage = new Money(salvage_value || '0').toFixed(8);
  const id = crypto.randomUUID();

  await db.query(
    `INSERT INTO fixed_assets (
      id, asset_number, name, category_id, acquisition_date, acquisition_cost,
      salvage_value, useful_life_months, depreciation_method, status,
      location, custodian_name, serial_number, current_book_value, accumulated_depreciation, organization_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ACTIVE', $10, $11, $12, $13, '0.00000000', $14)`,
    [
      id,
      asset_number,
      name,
      category_id,
      acquisition_date || new Date().toISOString().slice(0, 10),
      cost,
      salvage,
      useful_life_months || 60,
      depreciation_method || 'STRAIGHT_LINE',
      location || null,
      custodian_name || null,
      serial_number || null,
      cost,
      req.session!.organization_id,
    ]
  );

  return res.status(201).json({
    success: true,
    data: { id, asset_number, name, acquisition_cost: cost, status: 'ACTIVE' },
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

// Run Monthly Asset Depreciation
app.post('/api/assets/:id/depreciate', authenticate, requirePermission(Permission.ASSET_DEPRECIATE), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { period_id, period_months } = req.body;

  const assetRes = await db.query(
    `SELECT fa.*, ac.deprec_expense_account_id, ac.accumulated_deprec_account_id 
     FROM fixed_assets fa 
     JOIN asset_categories ac ON ac.id = fa.category_id 
     WHERE fa.id = $1 AND fa.organization_id = $2`,
    [id, req.session!.organization_id]
  );

  if (assetRes.rows.length === 0) {
    return res.status(404).json({
      success: false,
      error: { code: ErrorCode.RESOURCE_NOT_FOUND, message: 'Fixed asset not found', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const asset = assetRes.rows[0];
  if (asset.status !== 'ACTIVE') {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.ASSET_NOT_ACTIVE, message: `Asset is in status ${asset.status}, not eligible for depreciation`, correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  // Look up accounts:
  let expenseAccountId = asset.deprec_expense_account_id;
  let accumulatedAccountId = asset.accumulated_deprec_account_id;

  if (!expenseAccountId || !accumulatedAccountId) {
    const accRes = await db.query(
      `SELECT id, code FROM accounts WHERE organization_id = $1 AND code IN ('521004', '121002')`,
      [req.session!.organization_id]
    );
    const map = new Map<string, string>(accRes.rows.map((r) => [r.code, r.id]));
    expenseAccountId = expenseAccountId || map.get('521004');
    accumulatedAccountId = accumulatedAccountId || map.get('121002');
  }

  if (!expenseAccountId || !accumulatedAccountId) {
    return res.status(422).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED, message: 'Depreciation expense or accumulated depreciation account not configured', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const calc = FixedAssetsEngine.calculateDepreciation(
    asset.acquisition_cost,
    asset.accumulated_depreciation,
    asset.salvage_value,
    asset.useful_life_months,
    asset.depreciation_method,
    period_months || 1
  );

  if (new Money(calc.depreciation_amount).isZero()) {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED, message: 'Asset is already fully depreciated down to salvage value', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const today = new Date().toISOString().slice(0, 10);
  const journalDraft = FixedAssetsEngine.generateDepreciationJournal({
    organization_id: req.session!.organization_id,
    legal_entity_id: req.session!.legal_entity_id,
    period_id: period_id || '',
    posting_date: today,
    asset_number: asset.asset_number,
    asset_name: asset.name,
    depreciation_amount: calc.depreciation_amount,
    expense_account_id: expenseAccountId,
    accumulated_account_id: accumulatedAccountId,
  });

  const journalId = crypto.randomUUID();
  const entryId = crypto.randomUUID();

  await db.transaction(async (tx) => {
    // Insert journal
    await tx.query(
      `INSERT INTO journals (
        id, organization_id, legal_entity_id, journal_number, posting_date, document_date,
        accounting_purpose, status, base_currency, total_base_debit, total_base_credit,
        description, source_type, source_id, created_by, posted_by, posted_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'POSTED', 'PKR', $8, $9, $10, 'FIXED_ASSET', $11, $12, $12, CURRENT_TIMESTAMP)`,
      [
        journalId,
        req.session!.organization_id,
        req.session!.legal_entity_id,
        journalDraft.journal_number,
        today,
        today,
        journalDraft.accounting_purpose,
        calc.depreciation_amount,
        calc.depreciation_amount,
        journalDraft.description,
        id,
        req.session!.user_id,
      ]
    );

    // Insert journal lines
    for (const line of journalDraft.lines) {
      await tx.query(
        `INSERT INTO journal_lines (
          id, journal_id, line_number, account_id, debit_amount, credit_amount, currency, fx_rate, base_debit, base_credit, description
        ) VALUES ($1, $2, $3, $4, $5, $6, 'PKR', '1.000000000000', $7, $8, $9)`,
        [
          crypto.randomUUID(),
          journalId,
          line.line_number,
          line.account_id,
          line.debit_amount,
          line.credit_amount,
          line.base_debit,
          line.base_credit,
          line.description,
        ]
      );
    }

    // Insert depreciation entry
    await tx.query(
      `INSERT INTO asset_depreciation_entries (
        id, asset_id, period_id, entry_date, depreciation_amount, accumulated_depreciation_after, book_value_after, journal_id, organization_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        entryId,
        id,
        period_id || null,
        today,
        calc.depreciation_amount,
        calc.accumulated_depreciation_after,
        calc.book_value_after,
        journalId,
        req.session!.organization_id,
      ]
    );

    // Update fixed asset
    const newStatus = new Money(calc.book_value_after).equals(new Money(asset.salvage_value)) ? 'FULLY_DEPRECIATED' : 'ACTIVE';
    await tx.query(
      `UPDATE fixed_assets 
       SET accumulated_depreciation = $1, current_book_value = $2, status = $3, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $4`,
      [calc.accumulated_depreciation_after, calc.book_value_after, newStatus, id]
    );
  });

  return res.json({
    success: true,
    data: {
      id,
      depreciation_amount: calc.depreciation_amount,
      accumulated_depreciation: calc.accumulated_depreciation_after,
      current_book_value: calc.book_value_after,
      journal_id: journalId,
    },
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

// Fixed Asset Disposal / Retirement
app.post('/api/assets/:id/dispose', authenticate, requirePermission(Permission.ASSET_DISPOSE), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { proceeds, disposal_date } = req.body;

  const assetRes = await db.query(
    `SELECT fa.*, ac.asset_cost_account_id, ac.accumulated_deprec_account_id 
     FROM fixed_assets fa 
     JOIN asset_categories ac ON ac.id = fa.category_id 
     WHERE fa.id = $1 AND fa.organization_id = $2`,
    [id, req.session!.organization_id]
  );

  if (assetRes.rows.length === 0) {
    return res.status(404).json({
      success: false,
      error: { code: ErrorCode.RESOURCE_NOT_FOUND, message: 'Fixed asset not found', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const asset = assetRes.rows[0];
  if (asset.status === 'DISPOSED' || asset.status === 'WRITTEN_OFF') {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.ASSET_ALREADY_DISPOSED, message: 'Asset is already disposed or written off', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  // Look up accounts:
  const accRes = await db.query(
    `SELECT id, code FROM accounts WHERE organization_id = $1 AND code IN ('121001', '121002', '111002', '411002', '511001')`,
    [req.session!.organization_id]
  );
  const map = new Map<string, string>(accRes.rows.map((r) => [r.code, r.id]));

  const costAcc = asset.asset_cost_account_id || map.get('121001');
  const accumAcc = asset.accumulated_deprec_account_id || map.get('121002');
  const bankAcc = map.get('111002');
  const gainAcc = map.get('411002');
  const lossAcc = map.get('511001');

  if (!costAcc || !accumAcc || !bankAcc || !gainAcc || !lossAcc) {
    return res.status(422).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED, message: 'Required COA accounts not found for disposal settlement', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const today = disposal_date || new Date().toISOString().slice(0, 10);
  const proceedsStr = new Money(proceeds || '0').toFixed(8);

  const journalDraft = FixedAssetsEngine.generateDisposalJournal({
    organization_id: req.session!.organization_id,
    legal_entity_id: req.session!.legal_entity_id,
    period_id: '',
    posting_date: today,
    asset_number: asset.asset_number,
    asset_name: asset.name,
    acquisition_cost: asset.acquisition_cost,
    accumulated_depreciation: asset.accumulated_depreciation,
    proceeds: proceedsStr,
    asset_cost_account_id: costAcc,
    accumulated_deprec_account_id: accumAcc,
    bank_account_id: bankAcc,
    gain_account_id: gainAcc,
    loss_account_id: lossAcc,
  });

  const journalId = crypto.randomUUID();

  await db.transaction(async (tx) => {
    let totalDebit = Money.zero();
    let totalCredit = Money.zero();
    for (const l of journalDraft.lines) {
      totalDebit = totalDebit.add(new Money(l.base_debit));
      totalCredit = totalCredit.add(new Money(l.base_credit));
    }

    // Insert journal
    await tx.query(
      `INSERT INTO journals (
        id, organization_id, legal_entity_id, journal_number, posting_date, document_date,
        accounting_purpose, status, base_currency, total_base_debit, total_base_credit,
        description, source_type, source_id, created_by, posted_by, posted_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'POSTED', 'PKR', $8, $9, $10, 'FIXED_ASSET', $11, $12, $12, CURRENT_TIMESTAMP)`,
      [
        journalId,
        req.session!.organization_id,
        req.session!.legal_entity_id,
        journalDraft.journal_number,
        today,
        today,
        journalDraft.accounting_purpose,
        totalDebit.format(),
        totalCredit.format(),
        journalDraft.description,
        id,
        req.session!.user_id,
      ]
    );

    // Insert journal lines
    for (const line of journalDraft.lines) {
      await tx.query(
        `INSERT INTO journal_lines (
          id, journal_id, line_number, account_id, debit_amount, credit_amount, currency, fx_rate, base_debit, base_credit, description
        ) VALUES ($1, $2, $3, $4, $5, $6, 'PKR', '1.000000000000', $7, $8, $9)`,
        [
          crypto.randomUUID(),
          journalId,
          line.line_number,
          line.account_id,
          line.debit_amount,
          line.credit_amount,
          line.base_debit,
          line.base_credit,
          line.description,
        ]
      );
    }

    // Update fixed asset
    await tx.query(
      `UPDATE fixed_assets 
       SET status = 'DISPOSED', disposal_date = $1, disposal_proceeds = $2, disposal_journal_id = $3, current_book_value = '0.00000000', updated_at = CURRENT_TIMESTAMP 
       WHERE id = $4`,
      [today, proceedsStr, journalId, id]
    );
  });

  return res.json({
    success: true,
    data: { id, status: 'DISPOSED', disposal_proceeds: proceedsStr, journal_id: journalId },
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

// ==========================================
// 22. Point of Sale (POS) Module
// ==========================================

// POS Registers
app.get('/api/pos/registers', authenticate, requirePermission(Permission.POS_TERMINAL), async (req: Request, res: Response) => {
  const result = await db.query(
    `SELECT pr.*, w.name as warehouse_name 
     FROM pos_registers pr 
     LEFT JOIN warehouses w ON w.id = pr.warehouse_id 
     WHERE pr.organization_id = $1 
     ORDER BY pr.register_code ASC`,
    [req.session!.organization_id]
  );
  return res.json({
    success: true,
    data: result.rows,
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/pos/registers', authenticate, requirePermission(Permission.POS_REGISTER_MANAGE), async (req: Request, res: Response) => {
  const { register_code, name, warehouse_id, cash_account_id, card_clearing_account_id } = req.body;

  if (!register_code || !name) {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED, message: 'Register code and name are required', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO pos_registers (id, register_code, name, warehouse_id, cash_account_id, card_clearing_account_id, organization_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      register_code,
      name,
      warehouse_id || null,
      cash_account_id || null,
      card_clearing_account_id || null,
      req.session!.organization_id,
    ]
  );

  return res.status(201).json({
    success: true,
    data: { id, register_code, name },
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

// POS Sessions (Cashier Shifts)
app.get('/api/pos/sessions/active', authenticate, requirePermission(Permission.POS_TERMINAL), async (req: Request, res: Response) => {
  const result = await db.query(
    `SELECT ps.*, pr.register_code, pr.name as register_name 
     FROM pos_sessions ps 
     JOIN pos_registers pr ON pr.id = ps.register_id 
     WHERE ps.organization_id = $1 AND ps.status = 'OPEN' 
     ORDER BY ps.opened_at DESC LIMIT 1`,
    [req.session!.organization_id]
  );

  return res.json({
    success: true,
    data: result.rows[0] || null,
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

app.post('/api/pos/sessions/open', authenticate, requirePermission(Permission.POS_TERMINAL), async (req: Request, res: Response) => {
  const { register_id, opening_float } = req.body;

  if (!register_id) {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED, message: 'register_id is required', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  // Check if register already has open session
  const openRes = await db.query(
    `SELECT id FROM pos_sessions WHERE register_id = $1 AND status = 'OPEN'`,
    [register_id]
  );
  if (openRes.rows.length > 0) {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.POS_SESSION_ALREADY_OPEN, message: 'Register already has an active open session', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const id = crypto.randomUUID();
  const floatStr = new Money(opening_float || '0').toFixed(8);

  await db.query(
    `INSERT INTO pos_sessions (
      id, register_id, cashier_id, cashier_name, opened_at, opening_float,
      cash_sales_total, card_sales_total, expected_cash_drawer, cash_difference, status, organization_id
    ) VALUES ($1, $2, $3, $4, NOW(), $5, '0.00000000', '0.00000000', $5, '0.00000000', 'OPEN', $6)`,
    [
      id,
      register_id,
      req.session!.user_id,
      req.session!.name || req.session!.email,
      floatStr,
      req.session!.organization_id,
    ]
  );

  return res.status(201).json({
    success: true,
    data: { id, register_id, opening_float: floatStr, status: 'OPEN' },
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

// Process POS Order
app.post('/api/pos/orders', authenticate, requirePermission(Permission.POS_TERMINAL), async (req: Request, res: Response) => {
  const {
    session_id,
    order_number,
    customer_id,
    items,
    discount_amount,
    tax_percentage,
    payment_method,
    cash_tendered,
  } = req.body;

  if (!session_id || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED, message: 'session_id and items are required', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  // Verify session is OPEN
  const sessionRes = await db.query(
    `SELECT ps.*, pr.warehouse_id 
     FROM pos_sessions ps 
     JOIN pos_registers pr ON pr.id = ps.register_id 
     WHERE ps.id = $1 AND ps.organization_id = $2`,
    [session_id, req.session!.organization_id]
  );
  if (sessionRes.rows.length === 0) {
    return res.status(404).json({
      success: false,
      error: { code: ErrorCode.RESOURCE_NOT_FOUND, message: 'POS session not found', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const session = sessionRes.rows[0];
  if (session.status !== 'OPEN') {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.POS_SESSION_CLOSED, message: 'Session is already closed', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const calculated = POSEngine.calculateOrder(
    items,
    discount_amount || '0.00',
    tax_percentage || '0.00',
    cash_tendered || '0.00'
  );

  const method = payment_method || 'CASH';
  if (method === 'CASH' && new Money(cash_tendered || '0').lt(new Money(calculated.total_amount))) {
    return res.status(422).json({
      success: false,
      error: { code: ErrorCode.INSUFFICIENT_PAYMENT_TENDER, message: 'Cash tendered is less than order total', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const orderId = crypto.randomUUID();
  const orderNum = order_number || `POS-${Date.now().toString().slice(-6)}`;

  await db.transaction(async (tx) => {
    // 1. Insert order
    await tx.query(
      `INSERT INTO pos_orders (
        id, session_id, order_number, customer_id, subtotal, discount_amount,
        tax_amount, total_amount, payment_method, cash_tendered, change_due, status, organization_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'COMPLETED', $12)`,
      [
        orderId,
        session_id,
        orderNum,
        customer_id || null,
        calculated.subtotal,
        calculated.discount_amount,
        calculated.tax_amount,
        calculated.total_amount,
        method,
        calculated.cash_tendered,
        calculated.change_due,
        req.session!.organization_id,
      ]
    );

    // 2. Insert order lines & record inventory stock movements
    for (const l of calculated.lines) {
      await tx.query(
        `INSERT INTO pos_order_lines (
          id, order_id, item_id, item_code, item_name, quantity, unit_price, line_total, tax_amount
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          crypto.randomUUID(),
          orderId,
          l.item_id,
          l.item_code,
          l.item_name,
          l.quantity,
          l.unit_price,
          l.line_total,
          l.tax_amount,
        ]
      );

      // Decrement stock from register warehouse if set
      if (session.warehouse_id) {
        await tx.query(
          `INSERT INTO stock_movements (
            id, organization_id, legal_entity_id, item_id, warehouse_id, movement_type,
            movement_date, quantity, unit_cost, total_value, reference_type, reference_id, description
          ) VALUES ($1, $2, $3, $4, $5, 'SHIPMENT', CURRENT_DATE, $6, $7, $8, 'POS_ORDER', $9, 'POS Sale Decrement')`,
          [
            crypto.randomUUID(),
            req.session!.organization_id,
            req.session!.legal_entity_id,
            l.item_id,
            session.warehouse_id,
            -parseFloat(l.quantity),
            l.unit_price,
            -parseFloat(l.line_total),
            orderId,
          ]
        );
      }
    }

    // 3. Update session sales totals
    if (method === 'CASH') {
      await tx.query(
        `UPDATE pos_sessions 
         SET cash_sales_total = cash_sales_total + $1, expected_cash_drawer = expected_cash_drawer + $1 
         WHERE id = $2`,
        [calculated.total_amount, session_id]
      );
    } else {
      await tx.query(
        `UPDATE pos_sessions 
         SET card_sales_total = card_sales_total + $1 
         WHERE id = $2`,
        [calculated.total_amount, session_id]
      );
    }
  });

  return res.status(201).json({
    success: true,
    data: {
      id: orderId,
      order_number: orderNum,
      subtotal: calculated.subtotal,
      discount_amount: calculated.discount_amount,
      tax_amount: calculated.tax_amount,
      total_amount: calculated.total_amount,
      change_due: calculated.change_due,
      status: 'COMPLETED',
    },
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

// Close POS Session & Post Settlement Journal
app.post('/api/pos/sessions/:id/close', authenticate, requirePermission(Permission.POS_SESSION_CLOSE), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { actual_cash_drawer } = req.body;

  const sessionRes = await db.query(
    `SELECT ps.*, pr.register_code, pr.cash_account_id, pr.card_clearing_account_id 
     FROM pos_sessions ps 
     JOIN pos_registers pr ON pr.id = ps.register_id 
     WHERE ps.id = $1 AND ps.organization_id = $2`,
    [id, req.session!.organization_id]
  );
  if (sessionRes.rows.length === 0) {
    return res.status(404).json({
      success: false,
      error: { code: ErrorCode.RESOURCE_NOT_FOUND, message: 'POS session not found', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const session = sessionRes.rows[0];
  if (session.status !== 'OPEN') {
    return res.status(400).json({
      success: false,
      error: { code: ErrorCode.POS_SESSION_CLOSED, message: 'Session is already closed', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const reconciled = POSEngine.reconcileSession(
    session.opening_float,
    session.cash_sales_total,
    session.card_sales_total,
    actual_cash_drawer !== undefined ? actual_cash_drawer.toString() : session.expected_cash_drawer
  );

  // Look up COA accounts
  const accRes = await db.query(
    `SELECT id, code FROM accounts WHERE organization_id = $1 AND code IN ('111001', '111002', '411001', '212001', '511002')`,
    [req.session!.organization_id]
  );
  const map = new Map<string, string>(accRes.rows.map((r) => [r.code, r.id]));

  const cashAcc = session.cash_account_id || map.get('111001');
  const cardAcc = session.card_clearing_account_id || map.get('111002');
  const salesAcc = map.get('411001');
  const taxAcc = map.get('212001');
  const varAcc = map.get('511002');

  if (!cashAcc || !cardAcc || !salesAcc || !taxAcc || !varAcc) {
    return res.status(422).json({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED, message: 'Required accounts not configured for POS settlement', correlation_id: req.correlationId },
    } satisfies StandardErrorResponse);
  }

  const today = new Date().toISOString().slice(0, 10);
  const journalDraft = POSEngine.generateSessionClosingJournal({
    organization_id: req.session!.organization_id,
    legal_entity_id: req.session!.legal_entity_id,
    period_id: '',
    posting_date: today,
    session_id: id,
    register_code: session.register_code,
    cash_sales: session.cash_sales_total,
    card_sales: session.card_sales_total,
    tax_amount: '0.00000000',
    cash_difference: reconciled.cash_difference,
    cash_account_id: cashAcc,
    card_clearing_account_id: cardAcc,
    sales_account_id: salesAcc,
    tax_payable_account_id: taxAcc,
    cash_variance_expense_account_id: varAcc,
  });

  const journalId = crypto.randomUUID();

  await db.transaction(async (tx) => {
    let totalDebit = Money.zero();
    let totalCredit = Money.zero();
    for (const l of journalDraft.lines) {
      totalDebit = totalDebit.add(new Money(l.base_debit));
      totalCredit = totalCredit.add(new Money(l.base_credit));
    }

    if (!totalDebit.isZero()) {
      // Insert journal
      await tx.query(
        `INSERT INTO journals (
          id, organization_id, legal_entity_id, journal_number, posting_date, document_date,
          accounting_purpose, status, base_currency, total_base_debit, total_base_credit,
          description, source_type, source_id, created_by, posted_by, posted_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'POSTED', 'PKR', $8, $9, $10, 'POS_SESSION', $11, $12, $12, CURRENT_TIMESTAMP)`,
        [
          journalId,
          req.session!.organization_id,
          req.session!.legal_entity_id,
          journalDraft.journal_number,
          today,
          today,
          journalDraft.accounting_purpose,
          totalDebit.format(),
          totalCredit.format(),
          journalDraft.description,
          id,
          req.session!.user_id,
        ]
      );

      // Insert journal lines
      for (const line of journalDraft.lines) {
        await tx.query(
          `INSERT INTO journal_lines (
            id, journal_id, line_number, account_id, debit_amount, credit_amount, currency, fx_rate, base_debit, base_credit, description
          ) VALUES ($1, $2, $3, $4, $5, $6, 'PKR', '1.000000000000', $7, $8, $9)`,
          [
            crypto.randomUUID(),
            journalId,
            line.line_number,
            line.account_id,
            line.debit_amount,
            line.credit_amount,
            line.base_debit,
            line.base_credit,
            line.description,
          ]
        );
      }
    }

    // Update POS session
    await tx.query(
      `UPDATE pos_sessions 
       SET status = 'CLOSED', closed_at = NOW(), actual_cash_drawer = $1, cash_difference = $2, closing_journal_id = $3 
       WHERE id = $4`,
      [reconciled.actual_cash_drawer, reconciled.cash_difference, totalDebit.isZero() ? null : journalId, id]
    );
  });

  return res.json({
    success: true,
    data: {
      id,
      status: 'CLOSED',
      expected_cash_drawer: reconciled.expected_cash_drawer,
      actual_cash_drawer: reconciled.actual_cash_drawer,
      cash_difference: reconciled.cash_difference,
      closing_journal_id: journalId,
    },
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
  } satisfies StandardSuccessResponse<any>);
});

// ==========================================
// 23. Admin & Seed Execution
// ==========================================
app.post('/api/admin/seed', async (req: Request, res: Response) => {
  const seeder = new SyntheticSeedRunner(db);
  const result = await seeder.runSeed();

  return res.json({
    success: true,
    data: result,
    meta: {
      correlation_id: req.correlationId,
      timestamp: new Date().toISOString(),
    },
  } satisfies StandardSuccessResponse<any>);
});


// Start server after ensuring migrations run and seed is ready
export async function startServer() {
  await migrator.runMigrations();
  const seeder = new SyntheticSeedRunner(db);
  await seeder.runSeed();

  return app.listen(PORT, () => {
    console.log(`[Omnysync Modular Monolith API] Listening on http://localhost:${PORT}`);
  });
}

if (process.env.NODE_ENV !== 'test') {
  startServer();
}

export { app, db };
