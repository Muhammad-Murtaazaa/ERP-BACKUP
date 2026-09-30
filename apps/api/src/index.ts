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
// 8. Admin & Seed Execution
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
