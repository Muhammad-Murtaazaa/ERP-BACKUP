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
// 17. Admin & Seed Execution
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
