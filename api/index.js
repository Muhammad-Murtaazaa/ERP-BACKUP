var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// apps/api/dist/lib/errors.js
import { ErrorCode } from "@omnysync/contracts";
var ApiError, validationError, notFound, invalidState, sodViolation;
var init_errors = __esm({
  "apps/api/dist/lib/errors.js"() {
    "use strict";
    ApiError = class extends Error {
      status;
      code;
      details;
      constructor(status, code, message, details) {
        super(message);
        this.name = "ApiError";
        this.status = status;
        this.code = code;
        this.details = details;
      }
    };
    validationError = (message, details) => new ApiError(400, ErrorCode.VALIDATION_FAILED, message, details);
    notFound = (what) => new ApiError(404, ErrorCode.RESOURCE_NOT_FOUND, `${what} not found`);
    invalidState = (message, details) => new ApiError(409, ErrorCode.INVALID_STATE, message, details);
    sodViolation = (message) => new ApiError(403, ErrorCode.SEGREGATION_OF_DUTIES, message);
  }
});

// apps/api/dist/lib/http.js
import { ErrorCode as ErrorCode2 } from "@omnysync/contracts";
function ok(req, res, data, status = 200, meta = {}) {
  return res.status(status).json({
    success: true,
    data,
    meta: { correlation_id: req.correlationId, timestamp: (/* @__PURE__ */ new Date()).toISOString(), ...meta }
  });
}
function mapDbError(err) {
  const code = err?.code;
  const msg = String(err?.message || "");
  if (msg.startsWith("POSTED_FACT_IMMUTABLE"))
    return new ApiError(409, ErrorCode2.POSTED_FACT_IMMUTABLE, msg);
  if (msg.startsWith("JOURNAL_UNBALANCED"))
    return new ApiError(400, ErrorCode2.JOURNAL_UNBALANCED, msg);
  if (msg.startsWith("AUDIT_APPEND_ONLY"))
    return new ApiError(409, ErrorCode2.POSTED_FACT_IMMUTABLE, msg);
  switch (code) {
    case "23505":
      return new ApiError(409, ErrorCode2.DUPLICATE_RESOURCE, "A record with the same unique identifier already exists", {
        constraint: err?.constraint
      });
    case "23503":
      return new ApiError(400, ErrorCode2.VALIDATION_FAILED, "A referenced record does not exist", { constraint: err?.constraint });
    case "23514":
    case "23502":
    case "22P02":
    case "22003":
    case "22007":
    case "22008":
      return new ApiError(400, ErrorCode2.VALIDATION_FAILED, "Input violates a data constraint", { constraint: err?.constraint });
    case "40001":
    case "40P01":
    case "55P03":
      return new ApiError(409, ErrorCode2.STALE_REVISION, "Concurrent update detected; retry the command");
    default:
      return null;
  }
}
function errorHandler(err, req, res, _next) {
  let apiErr = err instanceof ApiError ? err : mapDbError(err);
  if (!apiErr && err?.type === "entity.parse.failed") {
    apiErr = new ApiError(400, ErrorCode2.VALIDATION_FAILED, "Malformed JSON body");
  }
  if (!apiErr && err?.type === "entity.too.large") {
    apiErr = new ApiError(413, ErrorCode2.VALIDATION_FAILED, "Request body too large");
  }
  if (!apiErr && /Invalid decimal string format for Money|Invalid numeric input for Money|Division by zero/.test(String(err?.message))) {
    apiErr = new ApiError(400, ErrorCode2.VALIDATION_FAILED, String(err.message));
  }
  if (!apiErr) {
    console.error(`[${req.correlationId}] Unhandled error:`, err?.message || err);
    apiErr = new ApiError(500, ErrorCode2.INTERNAL_ERROR, "An unexpected error occurred. Quote the correlation id to support.");
  }
  if (res.headersSent)
    return;
  const body = {
    success: false,
    error: { code: apiErr.code, message: apiErr.message, correlation_id: req.correlationId, details: apiErr.details }
  };
  res.status(apiErr.status).json(body);
}
function wrapAsyncRoutes(app) {
  for (const method of ["get", "post", "put", "patch", "delete"]) {
    const original = app[method].bind(app);
    app[method] = (path2, ...handlers) => {
      if (handlers.length === 0)
        return original(path2);
      const wrapped = handlers.map((h) => typeof h === "function" ? (req, res, next) => {
        try {
          const out = h(req, res, next);
          if (out && typeof out.then === "function")
            out.catch(next);
        } catch (e) {
          next(e);
        }
      } : h);
      return original(path2, ...wrapped);
    };
  }
}
var init_http = __esm({
  "apps/api/dist/lib/http.js"() {
    "use strict";
    init_errors();
  }
});

// apps/api/dist/lib/idempotency.js
import crypto from "node:crypto";
import { ErrorCode as ErrorCode3 } from "@omnysync/contracts";
function idempotency(db2) {
  return async (req, res, next) => {
    const key = req.headers["idempotency-key"];
    if (req.method !== "POST" || typeof key !== "string" || !key || !req.session)
      return next();
    if (key.length > 128) {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode3.VALIDATION_FAILED, message: "Idempotency-Key too long", correlation_id: req.correlationId }
      });
    }
    const hash = crypto.createHash("sha256").update(`${req.method} ${req.originalUrl}
${JSON.stringify(req.body ?? {})}`).digest("hex");
    const org = req.session.organization_id;
    const user = req.session.user_id;
    try {
      const claimed = await db2.query(`INSERT INTO idempotency_keys (organization_id, user_id, idem_key, request_hash, method, path)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING RETURNING idem_key`, [org, user, key, hash, req.method, req.originalUrl.slice(0, 512)]);
      if (claimed.rows.length === 0) {
        const existing = await db2.query("SELECT * FROM idempotency_keys WHERE organization_id = $1 AND user_id = $2 AND idem_key = $3", [org, user, key]);
        const row = existing.rows[0];
        if (!row || row.request_hash !== hash) {
          return res.status(409).json({
            success: false,
            error: {
              code: ErrorCode3.IDEMPOTENCY_CONFLICT,
              message: "Idempotency-Key was already used with a different request",
              correlation_id: req.correlationId
            }
          });
        }
        if (row.state !== "COMPLETED") {
          return res.status(409).json({
            success: false,
            error: {
              code: ErrorCode3.IDEMPOTENCY_CONFLICT,
              message: "An identical request is still being processed",
              correlation_id: req.correlationId
            }
          });
        }
        res.setHeader("idempotent-replay", "true");
        const body = typeof row.response_body === "string" ? JSON.parse(row.response_body) : row.response_body;
        return res.status(row.response_status).json(body);
      }
    } catch (err) {
      return next(err);
    }
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      const status = res.statusCode;
      const persist = status < 500 ? db2.query(`UPDATE idempotency_keys SET state = 'COMPLETED', response_status = $4, response_body = $5
               WHERE organization_id = $1 AND user_id = $2 AND idem_key = $3`, [org, user, key, status, JSON.stringify(body)]) : db2.query("DELETE FROM idempotency_keys WHERE organization_id = $1 AND user_id = $2 AND idem_key = $3", [org, user, key]);
      persist.catch(() => void 0).finally(() => originalJson(body));
      return res;
    };
    next();
  };
}
var init_idempotency = __esm({
  "apps/api/dist/lib/idempotency.js"() {
    "use strict";
  }
});

// apps/api/dist/context.js
import { PGliteAdapter, PgPoolAdapter, AuthService, AuditLogger, OutboxService } from "@omnysync/platform";
import { ErrorCode as ErrorCode4 } from "@omnysync/contracts";
function deny(req, res, status, code, message) {
  return res.status(status).json({
    success: false,
    error: { code, message, correlation_id: req.correlationId }
  });
}
var db, authService, auditLogger, outboxService, idempotencyGuard, authenticate, requirePermission, requireAnyPermission;
var init_context = __esm({
  "apps/api/dist/context.js"() {
    "use strict";
    init_idempotency();
    db = process.env.DATABASE_URL || process.env.POSTGRES_URL ? new PgPoolAdapter(process.env.DATABASE_URL || process.env.POSTGRES_URL) : new PGliteAdapter(process.env.PGDATA_DIR || (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME ? "/tmp/omnysync.db" : process.env.NODE_ENV === "test" ? void 0 : "./data/omnysync.db"));
    authService = new AuthService(db);
    auditLogger = new AuditLogger(db);
    outboxService = new OutboxService(db);
    idempotencyGuard = idempotency(db);
    authenticate = async (req, res, next) => {
      try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
          return deny(req, res, 401, ErrorCode4.UNAUTHENTICATED, "Missing or invalid Bearer authentication token");
        }
        const token = authHeader.substring(7);
        const claims = authService.verifySessionToken(token);
        if (!claims) {
          return deny(req, res, 401, ErrorCode4.UNAUTHENTICATED, "Invalid or expired session token");
        }
        const membership = await db.query(`SELECT m.roles, m.legal_entity_id, u.name, u.email
       FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.user_id = $1 AND m.organization_id = $2 AND m.is_active = true AND u.is_active = true`, [claims.user_id, claims.organization_id]);
        if (membership.rows.length === 0) {
          return deny(req, res, 401, ErrorCode4.UNAUTHENTICATED, "Membership is no longer active");
        }
        const row = membership.rows[0];
        const roles = typeof row.roles === "string" ? JSON.parse(row.roles) : row.roles;
        req.session = {
          ...claims,
          name: row.name,
          email: row.email,
          legal_entity_id: row.legal_entity_id || claims.legal_entity_id,
          roles,
          permissions: AuthService.resolvePermissions(roles)
        };
        return idempotencyGuard(req, res, next);
      } catch (err) {
        next(err);
      }
    };
    requirePermission = (permission) => {
      return (req, res, next) => {
        if (!req.session) {
          return deny(req, res, 401, ErrorCode4.UNAUTHENTICATED, "Authentication required");
        }
        if (!AuthService.hasPermission(req.session, permission)) {
          return deny(req, res, 403, ErrorCode4.UNAUTHORIZED, `Forbidden: Missing required permission "${permission}"`);
        }
        next();
      };
    };
    requireAnyPermission = (...permissions) => {
      return (req, res, next) => {
        if (!req.session) {
          return deny(req, res, 401, ErrorCode4.UNAUTHENTICATED, "Authentication required");
        }
        if (!permissions.some((p) => AuthService.hasPermission(req.session, p))) {
          return deny(req, res, 403, ErrorCode4.UNAUTHORIZED, `Forbidden: requires one of ${permissions.join(", ")}`);
        }
        next();
      };
    };
  }
});

// apps/api/dist/lib/validate.js
function toDecimalText(value) {
  if (typeof value === "string")
    return value.trim();
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      return null;
    const text = String(value);
    if (/e/i.test(text))
      return null;
    return text;
  }
  return null;
}
function decimal(value, field, opts = {}) {
  const { sign = "nonNegative", scale = 8, integerDigits = 16, required = true, defaultValue } = opts;
  if (value === void 0 || value === null || value === "") {
    if (defaultValue !== void 0)
      return defaultValue;
    if (!required)
      return "0";
    throw validationError(`${field} is required`, { field });
  }
  const text = toDecimalText(value);
  if (text === null || !DECIMAL_RE.test(text)) {
    throw validationError(`${field} must be an exact decimal string (e.g. "1250.50")`, { field, value });
  }
  const [intPartRaw, frac = ""] = text.replace("-", "").split(".");
  const intPart = intPartRaw.replace(/^0+(?=\d)/, "");
  if (frac.length > scale) {
    throw validationError(`${field} supports at most ${scale} decimal places`, { field, value });
  }
  if (intPart.length > integerDigits) {
    throw validationError(`${field} exceeds the supported magnitude`, { field, value });
  }
  const isZero = /^0*$/.test(intPart + frac);
  const negative = text.startsWith("-") && !isZero;
  if (sign === "nonNegative" && negative) {
    throw validationError(`${field} cannot be negative`, { field, value });
  }
  if (sign === "positive" && (negative || isZero)) {
    throw validationError(`${field} must be greater than zero`, { field, value });
  }
  return isZero ? "0" : text;
}
function dateOnly(value, field, opts = {}) {
  const { required = true, defaultValue } = opts;
  if (value === void 0 || value === null || value === "") {
    if (defaultValue !== void 0)
      return defaultValue;
    if (!required)
      return "";
    throw validationError(`${field} is required`, { field });
  }
  if (typeof value !== "string")
    throw validationError(`${field} must be a date string YYYY-MM-DD`, { field });
  const m = DATE_RE.exec(value.trim().slice(0, 10));
  if (!m || value.trim().length !== 10)
    throw validationError(`${field} must be a date string YYYY-MM-DD`, { field, value });
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d || y < 1900 || y > 2999) {
    throw validationError(`${field} is not a valid calendar date`, { field, value });
  }
  return value.trim();
}
function optionalDate(value, field) {
  if (value === void 0 || value === null || value === "")
    return null;
  return dateOnly(value, field);
}
function str(value, field, opts = {}) {
  const { required = true, max = 255, min = 1, pattern } = opts;
  if (value === void 0 || value === null || typeof value === "string" && value.trim() === "") {
    if (!required)
      return "";
    throw validationError(`${field} is required`, { field });
  }
  if (typeof value !== "string" && typeof value !== "number") {
    throw validationError(`${field} must be text`, { field });
  }
  const text = String(value).trim();
  if (text.length < min)
    throw validationError(`${field} must be at least ${min} characters`, { field });
  if (text.length > max)
    throw validationError(`${field} must be at most ${max} characters`, { field });
  if (pattern && !pattern.test(text))
    throw validationError(`${field} has an invalid format`, { field });
  return text;
}
function optionalStr(value, field, max = 2e3) {
  if (value === void 0 || value === null || typeof value === "string" && value.trim() === "")
    return null;
  return str(value, field, { max });
}
function oneOf(value, field, allowed, defaultValue) {
  if ((value === void 0 || value === null || value === "") && defaultValue !== void 0)
    return defaultValue;
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw validationError(`${field} must be one of: ${allowed.join(", ")}`, { field, value });
  }
  return value;
}
function uuid(value, field) {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw validationError(`${field} must be a valid identifier`, { field });
  }
  return value;
}
function optionalUuid(value, field) {
  if (value === void 0 || value === null || value === "")
    return null;
  return uuid(value, field);
}
function arrayOf(value, field, opts = {}) {
  const { min = 1, max = 500 } = opts;
  if (!Array.isArray(value))
    throw validationError(`${field} must be a list`, { field });
  if (value.length < min)
    throw validationError(`${field} requires at least ${min} entr${min === 1 ? "y" : "ies"}`, { field });
  if (value.length > max)
    throw validationError(`${field} allows at most ${max} entries`, { field });
  return value;
}
function int(value, field, opts = {}) {
  const { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, defaultValue } = opts;
  if ((value === void 0 || value === null || value === "") && defaultValue !== void 0)
    return defaultValue;
  const n = typeof value === "string" && /^-?\d+$/.test(value.trim()) ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n))
    throw validationError(`${field} must be a whole number`, { field });
  if (n < min || n > max)
    throw validationError(`${field} must be between ${min} and ${max}`, { field });
  return n;
}
function bool(value, defaultValue = false) {
  if (value === void 0 || value === null || value === "")
    return defaultValue;
  if (typeof value === "boolean")
    return value;
  if (value === "true")
    return true;
  if (value === "false")
    return false;
  throw validationError("Expected a boolean value");
}
function pagination(query, defaults = { limit: 100, max: 500 }) {
  const limit = int(query.limit, "limit", { min: 1, max: defaults.max, defaultValue: defaults.limit });
  const offset = int(query.offset, "offset", { min: 0, max: 1e6, defaultValue: 0 });
  return { limit, offset };
}
function todayIso() {
  const d = /* @__PURE__ */ new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function toIsoDate(v) {
  if (v instanceof Date)
    return v.toISOString().slice(0, 10);
  return String(v ?? "").slice(0, 10);
}
var DECIMAL_RE, DATE_RE, UUID_RE;
var init_validate = __esm({
  "apps/api/dist/lib/validate.js"() {
    "use strict";
    init_errors();
    DECIMAL_RE = /^-?\d+(\.\d+)?$/;
    DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
    UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  }
});

// apps/api/dist/lib/state.js
async function transition(q, input) {
  const statusColumn = input.statusColumn || "status";
  if (!IDENT_RE.test(input.table) || !IDENT_RE.test(statusColumn))
    throw new Error("Illegal identifier");
  const params = [input.to, input.id, input.organizationId, input.from];
  const sets = [`${statusColumn} = $1`];
  for (const [col, val] of Object.entries(input.set || {})) {
    if (!IDENT_RE.test(col))
      throw new Error("Illegal identifier");
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  }
  const res = await q.query(`UPDATE ${input.table} SET ${sets.join(", ")}
     WHERE id::text = $2 AND organization_id = $3 AND ${statusColumn} = ANY($4::text[])
     RETURNING *`, params);
  if (res.rows.length > 0)
    return res.rows[0];
  const cur = await q.query(`SELECT ${statusColumn} AS s FROM ${input.table} WHERE id::text = $1 AND organization_id = $2`, [input.id, input.organizationId]);
  if (cur.rows.length === 0)
    throw notFound(input.label);
  throw invalidState(`${input.label} cannot move to ${input.to} from ${String(cur.rows[0].s)} (allowed from: ${input.from.join(", ")})`, { current: cur.rows[0].s, requested: input.to, allowed_from: input.from });
}
var IDENT_RE;
var init_state = __esm({
  "apps/api/dist/lib/state.js"() {
    "use strict";
    init_errors();
    IDENT_RE = /^[a-z_][a-z0-9_]*$/;
  }
});

// apps/api/dist/lib/scope.js
import { ErrorCode as ErrorCode6 } from "@omnysync/contracts";
async function requireOrgRow(q, table, id, organizationId, label, opts = {}) {
  if (!IDENT_RE2.test(table))
    throw new Error(`Illegal table identifier ${table}`);
  if (typeof id !== "string" || id.length === 0 || id.length > 64)
    throw notFound(label);
  const res = await q.query(`SELECT * FROM ${table} WHERE id::text = $1 AND organization_id = $2${opts.forUpdate ? " FOR UPDATE" : ""}`, [id, organizationId]);
  if (res.rows.length === 0)
    throw notFound(label);
  return res.rows[0];
}
async function assertOrgRef(q, table, id, organizationId, label) {
  if (id === void 0 || id === null || id === "")
    return;
  if (!IDENT_RE2.test(table))
    throw new Error(`Illegal table identifier ${table}`);
  const res = await q.query(`SELECT 1 FROM ${table} WHERE id::text = $1 AND organization_id = $2`, [String(id), organizationId]);
  if (res.rows.length === 0) {
    throw new ApiError(400, ErrorCode6.FORBIDDEN_SCOPE, `${label} does not exist in this organization`, { field: label });
  }
}
var IDENT_RE2;
var init_scope = __esm({
  "apps/api/dist/lib/scope.js"() {
    "use strict";
    init_errors();
    IDENT_RE2 = /^[a-z_][a-z0-9_]*$/;
  }
});

// apps/api/dist/lib/numbering.js
var numbering_exports = {};
__export(numbering_exports, {
  nextDocumentNumber: () => nextDocumentNumber
});
async function nextDocumentNumber(q, organizationId, prefix, businessDate, width = 5) {
  const year = businessDate && /^\d{4}/.test(businessDate) ? businessDate.slice(0, 4) : String((/* @__PURE__ */ new Date()).getFullYear());
  const res = await q.query(`INSERT INTO document_sequences (organization_id, prefix, period_key, last_value)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (organization_id, prefix, period_key)
     DO UPDATE SET last_value = document_sequences.last_value + 1, updated_at = CURRENT_TIMESTAMP
     RETURNING last_value`, [organizationId, prefix, year]);
  const n = String(res.rows[0].last_value).padStart(width, "0");
  return `${prefix}-${year}-${n}`;
}
var init_numbering = __esm({
  "apps/api/dist/lib/numbering.js"() {
    "use strict";
  }
});

// apps/api/dist/lib/posting.js
import crypto2 from "node:crypto";
import { JournalValidator, PeriodManager, PostingEngine } from "@omnysync/financial-engine";
import { ErrorCode as ErrorCode7 } from "@omnysync/contracts";
async function postJournal(q, audit6, outbox, input) {
  let normalized;
  try {
    normalized = PostingEngine.normalize(input.lines);
  } catch (err) {
    throw new ApiError(400, ErrorCode7.VALIDATION_FAILED, err.message);
  }
  if (normalized.lines.length === 0)
    return null;
  const accountsRes = await q.query("SELECT * FROM accounts WHERE organization_id = $1", [input.organizationId]);
  const byId = new Map(accountsRes.rows.map((a) => [a.id, a]));
  const byCode = new Map(accountsRes.rows.map((a) => [a.code, a]));
  const resolved = normalized.lines.map((l, idx) => {
    const acc = l.account_id && byId.get(l.account_id) || l.account_code && byCode.get(l.account_code) || null;
    if (!acc) {
      throw new ApiError(400, ErrorCode7.MAPPING_MISSING, `Account mapping missing for posting line ${idx + 1} (${l.account_code || l.account_id || "unspecified"})`, { account_code: l.account_code, account_id: l.account_id });
    }
    return {
      line_number: idx + 1,
      account_id: acc.id,
      debit_amount: l.debit,
      credit_amount: l.credit,
      base_debit: l.debit,
      base_credit: l.credit,
      currency: input.currency || "PKR",
      fx_rate: "1",
      description: l.description,
      party_id: l.party_id,
      dimension_project_id: l.project_id,
      dimension_cost_center_id: l.cost_center_id,
      dimension_branch_id: l.branch_id
    };
  });
  const accountMap = new Map(accountsRes.rows.map((a) => [a.id, a]));
  const validation = JournalValidator.validate(resolved, accountMap);
  if (!validation.isValid) {
    throw new ApiError(400, ErrorCode7.JOURNAL_UNBALANCED, validation.errors.join("; "), validation.errors);
  }
  const periodRes = await q.query(`SELECT * FROM fiscal_periods
     WHERE organization_id = $1 AND legal_entity_id = $2 AND start_date <= $3::date AND end_date >= $3::date
     FOR UPDATE`, [input.organizationId, input.legalEntityId, input.postingDate]);
  const period = PeriodManager.findPeriodForDate(periodRes.rows, input.postingDate);
  const check = PeriodManager.assertPostingAllowed(period, input.postingDate, input.isClosingAdjustment === true);
  if (!check.allowed) {
    throw new ApiError(400, period ? ErrorCode7.PERIOD_CLOSED : ErrorCode7.PERIOD_NOT_FOUND, check.error || "Period closed");
  }
  if (input.sourceKey) {
    const existing = await q.query("SELECT id, journal_number, total_base_debit FROM journals WHERE organization_id = $1 AND source_key = $2", [input.organizationId, input.sourceKey]);
    if (existing.rows.length > 0) {
      const ex = existing.rows[0];
      if (validation.totalDebit.eq(ex.total_base_debit)) {
        return { journalId: ex.id, journalNumber: ex.journal_number, totalDebit: validation.totalDebit.toFixed(8), replayed: true };
      }
      throw new ApiError(409, ErrorCode7.DUPLICATE_SOURCE_PURPOSE, `Source ${input.sourceKey} was already posted with a different amount`);
    }
  }
  const journalId = crypto2.randomUUID();
  const journalNumber = input.journalNumber || await nextDocumentNumber(q, input.organizationId, input.numberPrefix || "JV", input.postingDate, 6);
  const total = validation.totalDebit.toFixed(8);
  await q.query(`INSERT INTO journals (
      id, organization_id, legal_entity_id, journal_number, posting_date, document_date,
      accounting_purpose, status, base_currency, total_base_debit, total_base_credit,
      description, source_type, source_id, source_key, reversal_of_journal_id,
      created_by, approved_by, posted_by, posted_at, revision
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,'POSTED',$8,$9,$9,$10,$11,$12,$13,$14,$15,$16,$15,CURRENT_TIMESTAMP,1)`, [
    journalId,
    input.organizationId,
    input.legalEntityId,
    journalNumber,
    input.postingDate,
    input.documentDate || input.postingDate,
    input.purpose,
    input.currency || "PKR",
    total,
    input.description,
    input.sourceType || null,
    input.sourceId || null,
    input.sourceKey || null,
    input.reversalOfJournalId || null,
    input.userId,
    input.approvedBy || null
  ]);
  for (const l of resolved) {
    await q.query(`INSERT INTO journal_lines (
        id, journal_id, line_number, account_id, debit_amount, credit_amount, currency, fx_rate,
        base_debit, base_credit, description, party_id, dimension_branch_id, dimension_project_id, dimension_cost_center_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,1,$5,$6,$8,$9,$10,$11,$12)`, [
      crypto2.randomUUID(),
      journalId,
      l.line_number,
      l.account_id,
      l.base_debit,
      l.base_credit,
      input.currency || "PKR",
      l.description || null,
      l.party_id || null,
      l.dimension_branch_id || null,
      l.dimension_project_id || null,
      l.dimension_cost_center_id || null
    ]);
  }
  await audit6.record({
    organization_id: input.organizationId,
    user_id: input.userId,
    action: "JOURNAL_POSTED",
    entity_type: "JOURNAL",
    entity_id: journalId,
    after_state: {
      journal_number: journalNumber,
      purpose: input.purpose,
      source_type: input.sourceType,
      source_id: input.sourceId,
      total_base_debit: total
    },
    correlation_id: input.correlationId
  }, q);
  await outbox.emit({
    organization_id: input.organizationId,
    event_type: "JOURNAL_POSTED",
    payload: { journal_id: journalId, journal_number: journalNumber, purpose: input.purpose, source_type: input.sourceType, source_id: input.sourceId, total_base_debit: total }
  }, q);
  return { journalId, journalNumber, totalDebit: total, replayed: false };
}
var init_posting = __esm({
  "apps/api/dist/lib/posting.js"() {
    "use strict";
    init_errors();
    init_numbering();
  }
});

// apps/api/dist/lib/stock.js
import crypto5 from "node:crypto";
import { Money as Money2 } from "@omnysync/financial-engine";
import { ErrorCode as ErrorCode9 } from "@omnysync/contracts";
function fifoConsume(layers, qty, fallbackCost) {
  let need = new Money2(qty);
  let value = Money2.zero();
  const takes = [];
  for (const l of layers) {
    if (!need.isPositive())
      break;
    const avail = new Money2(l.qty_remaining);
    if (!avail.isPositive())
      continue;
    const take = avail.lt(need) ? avail : need;
    takes.push({ id: l.id, quantity: take.toFixed(8), unit_cost: new Money2(l.unit_cost).toFixed(8) });
    value = value.add(take.mul(l.unit_cost));
    need = need.sub(take);
  }
  if (need.isPositive()) {
    takes.push({ id: null, quantity: need.toFixed(8), unit_cost: new Money2(fallbackCost).toFixed(8) });
    value = value.add(need.mul(fallbackCost));
  }
  const unit = new Money2(qty).isZero() ? new Money2(fallbackCost) : value.div(qty).round(8);
  return { value: value.round(8).toFixed(8), unit_cost: unit.toFixed(8), takes };
}
function movingAverage(qtyBefore, oldCost, qtyIn, receiptCost) {
  const qb = new Money2(qtyBefore);
  if (!qb.isPositive())
    return new Money2(receiptCost).toFixed(8);
  const total = qb.add(qtyIn);
  return qb.mul(oldCost).add(new Money2(qtyIn).mul(receiptCost)).div(total).round(8).toFixed(8);
}
async function costingMethod(q, organizationId) {
  const r = await q.query(`SELECT value FROM org_settings WHERE organization_id = $1 AND setting_key = 'inventory.costing_method'`, [organizationId]);
  const v = r.rows[0]?.value;
  return typeof v === "string" ? v : "STANDARD";
}
async function lockItems(q, organizationId, itemIds) {
  const unique = [...new Set(itemIds)].sort();
  const out = /* @__PURE__ */ new Map();
  for (const id of unique) {
    const r = await q.query(`SELECT * FROM items WHERE id::text = $1 AND organization_id = $2 FOR UPDATE`, [id, organizationId]);
    if (r.rows.length === 0)
      throw validationError(`Item ${id} not found`, { field: "item_id" });
    out.set(id, r.rows[0]);
  }
  return out;
}
async function defaultWarehouseId(q, organizationId) {
  const r = await q.query(`SELECT id FROM warehouses WHERE organization_id = $1 AND is_active = true ORDER BY is_default DESC, code ASC LIMIT 1`, [organizationId]);
  return r.rows[0]?.id ?? null;
}
async function onHand(q, organizationId, itemId, warehouseId) {
  if (!warehouseId) {
    const r2 = await q.query(`SELECT COALESCE(SUM(quantity), 0)::text AS q FROM stock_movements WHERE organization_id = $1 AND item_id = $2`, [
      organizationId,
      itemId
    ]);
    return new Money2(r2.rows[0].q).toFixed(8);
  }
  const r = await q.query(`SELECT COALESCE(SUM(sm.quantity), 0)::text AS q
     FROM stock_movements sm
     WHERE sm.organization_id = $1 AND sm.item_id = $2
       AND (sm.location_id = $3 OR (sm.location_id IS NULL AND EXISTS (
            SELECT 1 FROM warehouses w WHERE w.id = $3 AND w.is_default = true)))`, [organizationId, itemId, warehouseId]);
  return new Money2(r.rows[0].q).toFixed(8);
}
async function postStockMovement(q, input) {
  const qty = new Money2(input.quantity);
  if (qty.isZero())
    throw validationError("Stock movement quantity cannot be zero");
  const before = await onHand(q, input.organizationId, input.itemId, input.warehouseId);
  const after = new Money2(before).add(qty);
  if (qty.isNegative() && after.isNegative() && !input.allowNegative) {
    throw new ApiError(409, ErrorCode9.INSUFFICIENT_STOCK, `Insufficient stock: on hand ${new Money2(before).format(4)}, requested ${qty.abs().format(4)}`, {
      item_id: input.itemId,
      warehouse_id: input.warehouseId,
      on_hand: before,
      requested: qty.abs().toFixed(8)
    });
  }
  const id = crypto5.randomUUID();
  const method = await costingMethod(q, input.organizationId);
  const fifo = method === "FIFO" && !LAYER_NEUTRAL.has(input.movementType);
  let unitCost = new Money2(input.unitCost).toFixed(8);
  let totalValue = qty.mul(input.unitCost).toFixed(8);
  let takes = [];
  if (fifo && qty.isNegative()) {
    const layers = (await q.query(`SELECT id, qty_remaining::text, unit_cost::text FROM stock_cost_layers WHERE organization_id = $1 AND item_id = $2 AND qty_remaining > 0
           AND ($3::uuid IS NULL OR warehouse_id = $3::uuid OR warehouse_id IS NULL)
         ORDER BY received_date, seq FOR UPDATE`, [input.organizationId, input.itemId, input.warehouseId ?? null])).rows;
    const r = fifoConsume(layers, qty.abs().toFixed(8), input.unitCost);
    unitCost = r.unit_cost;
    totalValue = new Money2(r.value).negated().toFixed(8);
    takes = r.takes;
  }
  await q.query(`INSERT INTO stock_movements (
      id, organization_id, legal_entity_id, item_id, warehouse_id, location_id, movement_type, movement_date,
      quantity, unit_cost, total_value, reference_type, reference_id, description
    ) VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8, $9, $10, $11, $12, $13)`, [
    id,
    input.organizationId,
    input.legalEntityId,
    input.itemId,
    input.warehouseId,
    input.movementType,
    input.movementDate,
    qty.toFixed(8),
    unitCost,
    totalValue,
    input.referenceType,
    input.referenceId,
    input.description
  ]);
  if (fifo && qty.isPositive()) {
    await q.query(`INSERT INTO stock_cost_layers (organization_id, item_id, stock_movement_id, received_date, qty_original, qty_remaining, unit_cost, warehouse_id) VALUES ($1,$2,$3,$4,$5,$5,$6,$7)`, [input.organizationId, input.itemId, id, input.movementDate, qty.toFixed(8), unitCost, input.warehouseId ?? null]);
  }
  for (const t of takes) {
    if (t.id)
      await q.query(`UPDATE stock_cost_layers SET qty_remaining = qty_remaining - $1 WHERE id = $2`, [t.quantity, t.id]);
    await q.query(`INSERT INTO stock_layer_consumptions (organization_id, layer_id, stock_movement_id, quantity, unit_cost) VALUES ($1,$2,$3,$4,$5)`, [
      input.organizationId,
      t.id,
      id,
      t.quantity,
      t.unit_cost
    ]);
  }
  if (input.revalue && qty.isPositive() && method === "MOVING_AVERAGE") {
    const item = (await q.query(`SELECT unit_cost::text AS c FROM items WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [input.itemId, input.organizationId])).rows[0];
    const qtyBefore = new Money2(await onHand(q, input.organizationId, input.itemId)).sub(qty).toFixed(8);
    const newCost = movingAverage(qtyBefore, item.c, qty.toFixed(8), input.unitCost);
    if (!new Money2(newCost).sub(item.c).isZero()) {
      await q.query(`UPDATE items SET unit_cost = $1, updated_at = NOW() WHERE id = $2`, [newCost, input.itemId]);
    }
    await q.query(`INSERT INTO item_cost_changes (organization_id, item_id, stock_movement_id, method, qty_before, qty_in, old_cost, receipt_cost, new_cost) VALUES ($1,$2,$3,'MOVING_AVERAGE',$4,$5,$6,$7,$8)`, [input.organizationId, input.itemId, id, qtyBefore, qty.toFixed(8), item.c, new Money2(input.unitCost).toFixed(8), newCost]);
  }
  return { id, total_value: totalValue, unit_cost: unitCost, on_hand_after: after.toFixed(8) };
}
async function reconcileFifoLayers(q, organizationId, asOf) {
  const rows = (await q.query(`SELECT i.id, i.code, COALESCE(i.unit_cost, 0)::text AS unit_cost,
              COALESCE((SELECT SUM(quantity) FROM stock_movements sm WHERE sm.organization_id = $1 AND sm.item_id = i.id), 0)::text AS on_hand,
              COALESCE((SELECT SUM(qty_remaining) FROM stock_cost_layers l WHERE l.organization_id = $1 AND l.item_id = i.id), 0)::text AS layered,
              (SELECT MIN(received_date) FROM stock_cost_layers l WHERE l.organization_id = $1 AND l.item_id = i.id AND l.qty_remaining > 0) AS oldest,
              (SELECT MIN(movement_date) FROM stock_movements sm WHERE sm.organization_id = $1 AND sm.item_id = i.id) AS first_movement
       FROM items i WHERE i.organization_id = $1
         AND (EXISTS (SELECT 1 FROM stock_movements sm WHERE sm.organization_id = $1 AND sm.item_id = i.id) OR EXISTS (SELECT 1 FROM stock_cost_layers l WHERE l.organization_id = $1 AND l.item_id = i.id AND l.qty_remaining > 0))
       ORDER BY i.code FOR UPDATE OF i`, [organizationId])).rows;
  const opened = [];
  const trimmed = [];
  for (const r of rows) {
    const onHandQty = Money2.max(new Money2(r.on_hand), Money2.zero());
    const gap = onHandQty.sub(r.layered);
    if (gap.isPositive()) {
      const cands = [asOf];
      if (r.first_movement)
        cands.push(toIsoDate(r.first_movement));
      if (r.oldest)
        cands.push(new Date(Date.parse(toIsoDate(r.oldest)) - 864e5).toISOString().slice(0, 10));
      const d = cands.sort()[0];
      await q.query(`INSERT INTO stock_cost_layers (organization_id, item_id, stock_movement_id, received_date, qty_original, qty_remaining, unit_cost, layer_source) VALUES ($1,$2,$3,$4,$5,$5,$6,'OPENING')`, [organizationId, r.id, crypto5.randomUUID(), d, gap.toFixed(8), new Money2(r.unit_cost).toFixed(8)]);
      opened.push({ item: r.code, quantity: gap.toFixed(4), unit_cost: new Money2(r.unit_cost).toFixed(4) });
    } else if (gap.isNegative()) {
      let excess = gap.abs();
      const layers = (await q.query(`SELECT id, qty_remaining::text FROM stock_cost_layers WHERE organization_id = $1 AND item_id = $2 AND qty_remaining > 0 ORDER BY received_date, seq FOR UPDATE`, [organizationId, r.id])).rows;
      for (const l of layers) {
        if (!excess.isPositive())
          break;
        const take = Money2.min(excess, new Money2(l.qty_remaining));
        await q.query(`UPDATE stock_cost_layers SET qty_remaining = qty_remaining - $1 WHERE id = $2`, [take.toFixed(8), l.id]);
        excess = excess.sub(take);
      }
      trimmed.push({ item: r.code, quantity: gap.abs().toFixed(4) });
    }
  }
  return { opened, trimmed };
}
var LAYER_NEUTRAL;
var init_stock = __esm({
  "apps/api/dist/lib/stock.js"() {
    "use strict";
    init_errors();
    init_validate();
    LAYER_NEUTRAL = /* @__PURE__ */ new Set([]);
  }
});

// apps/api/dist/lib/modules.js
import { ErrorCode as ErrorCode12 } from "@omnysync/contracts";
async function moduleStates(q, org) {
  const r = await q.query(`SELECT module_code, state FROM module_states WHERE organization_id = $1`, [org]);
  const m = new Map(MODULES.map((x) => [x.code, "enabled"]));
  for (const row of r.rows)
    m.set(row.module_code, row.state);
  return m;
}
function validateModuleTransition(code, to, states) {
  const m = MODULE_BY_CODE.get(code);
  if (!m)
    return `Unknown module ${code}`;
  const from = states.get(code) || "enabled";
  const allowed = {
    available: ["enabled"],
    enabled: ["draining"],
    draining: ["enabled", "read_only"],
    read_only: ["enabled", "disabled"],
    disabled: ["enabled"]
  };
  if (!allowed[from]?.includes(to))
    return `${code} cannot move from ${from} to ${to} (allowed: ${(allowed[from] || []).join(", ")})`;
  if (m.core && to !== "enabled")
    return `${code} is a core module and cannot be disabled`;
  if (to === "enabled") {
    const missing = m.depends.filter((d) => states.get(d) !== "enabled");
    if (missing.length)
      return `Enable dependencies first: ${missing.join(", ")}`;
  } else {
    const dependents = MODULES.filter((x) => x.depends.includes(code) && (states.get(x.code) || "enabled") === "enabled").map((x) => x.code);
    if (dependents.length)
      return `Modules depending on ${code} are still enabled: ${dependents.join(", ")}`;
  }
  return null;
}
function requireModule(code, kind = "command") {
  return async (req, res, next) => {
    try {
      const r = await db.query(`SELECT state FROM module_states WHERE organization_id = $1 AND module_code = $2`, [req.session.organization_id, code]);
      const state = r.rows[0]?.state || "enabled";
      if (state === "enabled" || state === "draining" && kind === "command")
        return next();
      return res.status(409).json({
        success: false,
        error: { code: ErrorCode12.MODULE_DISABLED, message: `Module ${code} is ${state}; ${state === "draining" ? "new records are blocked while it drains" : "it is read-only"}`, correlation_id: req.correlationId }
      });
    } catch (e) {
      next(e);
    }
  };
}
var MODULES, MODULE_BY_CODE;
var init_modules = __esm({
  "apps/api/dist/lib/modules.js"() {
    "use strict";
    init_context();
    MODULES = [
      { code: "PLT", name: "Platform, security & audit", depends: [], readiness: "verified", core: true },
      { code: "ADM", name: "Client administration", depends: ["PLT"], readiness: "implemented", core: true },
      { code: "CFG", name: "Configuration & settings", depends: ["PLT"], readiness: "implemented", core: true },
      { code: "GL", name: "General ledger", depends: ["PLT"], readiness: "verified", core: true },
      { code: "AR", name: "Receivables & billing", depends: ["GL"], readiness: "verified" },
      { code: "AP", name: "Payables & expenses", depends: ["GL"], readiness: "verified" },
      { code: "TRY", name: "Treasury & bank", depends: ["GL"], readiness: "verified" },
      { code: "TAX", name: "Tax compliance", depends: ["GL"], readiness: "implemented" },
      { code: "SAL", name: "Sales orders", depends: ["AR"], readiness: "verified" },
      { code: "PUR", name: "Procurement", depends: ["AP"], readiness: "verified" },
      { code: "INV", name: "Inventory", depends: ["GL"], readiness: "verified" },
      { code: "WMS", name: "Warehouse execution", depends: ["INV"], readiness: "implemented" },
      { code: "MFG", name: "Manufacturing", depends: ["INV"], readiness: "verified" },
      { code: "QLT", name: "Quality & PLM", depends: ["INV"], readiness: "verified" },
      { code: "AST", name: "Assets & maintenance", depends: ["GL"], readiness: "verified" },
      { code: "PRJ", name: "Projects & BOQ", depends: ["GL"], readiness: "verified" },
      { code: "HR", name: "HR core", depends: ["PLT"], readiness: "verified" },
      { code: "PAY", name: "Payroll & benefits", depends: ["HR", "GL"], readiness: "verified" },
      { code: "POS", name: "POS & retail", depends: ["INV", "AR"], readiness: "verified" },
      { code: "AUT", name: "Automation", depends: ["PLT"], readiness: "implemented" },
      { code: "SRV", name: "Service & field operations", depends: ["SAL", "INV", "AR"], readiness: "implemented" },
      { code: "CRM", name: "CRM", depends: ["PLT"], readiness: "implemented" },
      { code: "TIM", name: "Time & workforce", depends: ["HR"], readiness: "implemented" },
      { code: "SUP", name: "Supplier management", depends: ["PUR"], readiness: "implemented" },
      { code: "LOG", name: "Logistics & trade", depends: ["SAL"], readiness: "implemented" },
      { code: "BI", name: "Reporting & analytics", depends: ["PLT"], readiness: "implemented" },
      { code: "DOC", name: "Documents & collaboration", depends: ["PLT"], readiness: "implemented" },
      { code: "FLT", name: "Fleet & rental", depends: ["GL"], readiness: "implemented" },
      { code: "GRC", name: "Governance, risk & compliance", depends: ["PLT"], readiness: "implemented" },
      { code: "LND", name: "Lending & servicing", depends: ["GL"], readiness: "implemented" },
      { code: "EPM", name: "Planning & budgeting", depends: ["GL"], readiness: "implemented" },
      { code: "TAL", name: "Recruitment & talent", depends: ["HR"], readiness: "implemented" },
      { code: "COM", name: "Subscription commerce", depends: ["AR"], readiness: "implemented" }
    ];
    MODULE_BY_CODE = new Map(MODULES.map((m) => [m.code, m]));
  }
});

// apps/api/dist/lib/resource.js
import { ErrorCode as ErrorCode13 } from "@omnysync/contracts";
function parseField(name, spec, raw, partial = false) {
  const missing = raw === void 0 || raw === null || raw === "";
  if (partial && raw === void 0)
    return void 0;
  switch (spec.type) {
    case "string":
      return str(raw, name, { required: !!spec.required, max: spec.max ?? 255, pattern: spec.pattern }) || null;
    case "text":
      return str(raw, name, { required: !!spec.required, max: spec.max ?? 5e3 }) || null;
    case "decimal":
      if (missing && !spec.required)
        return spec.default ?? null;
      return decimal(raw, name, { sign: spec.sign ?? "nonNegative", scale: spec.scale ?? 8 });
    case "int":
      if (missing && !spec.required)
        return spec.default ?? null;
      return int(raw, name, { min: spec.min, max: spec.max });
    case "bool":
      return bool(raw, spec.default ?? false);
    case "date":
      if (missing && !spec.required)
        return spec.defaultToday ? todayIso() : null;
      return dateOnly(raw, name);
    case "datetime": {
      if (missing) {
        if (spec.required)
          throw validationError(`${name} is required`, { field: name });
        return null;
      }
      const d = new Date(String(raw));
      if (typeof raw !== "string" || Number.isNaN(d.getTime()))
        throw validationError(`${name} must be an ISO date-time`, { field: name });
      return d.toISOString();
    }
    case "enum":
      if (missing && !spec.required)
        return spec.default ?? null;
      return oneOf(raw, name, spec.values);
    case "ref":
      if (missing) {
        if (spec.required)
          throw validationError(`${name} is required`, { field: name });
        return null;
      }
      if (typeof raw !== "string" || raw.length > 64)
        throw validationError(`${name} must be an identifier`, { field: name });
      return raw;
    case "json":
      if (missing) {
        if (spec.required)
          throw validationError(`${name} is required`, { field: name });
        return null;
      }
      if (typeof raw !== "object")
        throw validationError(`${name} must be an object or list`, { field: name });
      if (JSON.stringify(raw).length > 2e4)
        throw validationError(`${name} is too large`, { field: name });
      return JSON.stringify(raw);
  }
}
async function parseFields(q, org, fields, body, partial = false) {
  const out = {};
  for (const [name, spec] of Object.entries(fields)) {
    if (!IDENT.test(name))
      throw new Error(`Illegal field ${name}`);
    const v = parseField(name, spec, body?.[name], partial);
    if (v === void 0)
      continue;
    if (spec.type === "ref" && v)
      await assertOrgRef(q, spec.table, v, org, spec.label || name);
    out[name] = v;
  }
  return out;
}
async function audit2(ctx, action, type, id, before, after) {
  await auditLogger.record({ organization_id: ctx.org, user_id: ctx.user, action, entity_type: type, entity_id: id, before_state: before, after_state: after, correlation_id: ctx.req.correlationId }, ctx.tx);
}
async function emit(ctx, eventType, payload) {
  await outboxService.emit({ organization_id: ctx.org, event_type: eventType, payload }, ctx.tx);
}
function ctxOf(req, tx) {
  return { req, tx, org: req.session.organization_id, le: req.session.legal_entity_id, user: req.session.user_id };
}
function unitOfWork(req, fn) {
  return db.transaction((tx) => fn(ctxOf(req, tx)));
}
async function loadRow(q, table, id, org, label, forUpdate = false) {
  if (!IDENT.test(table))
    throw new Error("Illegal table");
  if (typeof id !== "string" || !id || id.length > 64)
    throw notFound(label);
  const r = await q.query(`SELECT * FROM ${table} WHERE id::text = $1 AND organization_id = $2${forUpdate ? " FOR UPDATE" : ""}`, [id, org]);
  if (!r.rows[0])
    throw notFound(label);
  return r.rows[0];
}
async function assertInScope(spec, ctx, id) {
  const sc = spec.rowScope?.(ctx.req);
  if (!sc)
    return;
  const r = await ctx.tx.query(`SELECT 1 FROM ${spec.table} t WHERE t.organization_id = $1 AND t.id::text = $2 AND (${sc.sql.replace(/\$SCOPE/g, "$3")})`, [ctx.org, id, sc.value]);
  if (!r.rows[0])
    throw notFound(spec.label);
}
function defineResource(app, spec) {
  if (!IDENT.test(spec.table))
    throw new Error("Illegal table");
  const statusCol = spec.statusColumn === false ? null : spec.statusColumn || "status";
  const select = spec.select || "t.*";
  const joins = spec.joins || "";
  const searchCols = spec.search || [];
  const filterCols = [...spec.filters || [], ...statusCol ? [statusCol] : []];
  const orderBy = spec.orderBy || "t.created_at DESC";
  const passthrough = (_req, _res, next) => next();
  const modCreate = spec.module ? requireModule(spec.module, "create") : passthrough;
  const modCmd = spec.module ? requireModule(spec.module, "command") : passthrough;
  app.get(spec.path, authenticate, guard(spec.view), async (req, res) => {
    const org = req.session.organization_id;
    const { limit, offset } = pagination(req.query);
    const params = [org];
    const where = ["t.organization_id = $1"];
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
    if (q && searchCols.length) {
      params.push(`%${q.replace(/[%_\\]/g, (m) => "\\" + m)}%`);
      where.push(`(${searchCols.map((c) => `${c.includes(".") ? c : "t." + c}::text ILIKE $${params.length}`).join(" OR ")})`);
    }
    for (const f of filterCols) {
      const v = req.query[f];
      if (typeof v === "string" && v) {
        if (!IDENT.test(f))
          continue;
        const values = v.split(",").slice(0, 20);
        params.push(values);
        where.push(`t.${f}::text = ANY($${params.length}::text[])`);
      }
    }
    const sc = spec.rowScope?.(req);
    if (sc) {
      params.push(sc.value);
      where.push(`(${sc.sql.replace(/\$SCOPE/g, `$${params.length}`)})`);
    }
    const base = `FROM ${spec.table} t ${joins} WHERE ${where.join(" AND ")}`;
    const count = await db.query(`SELECT COUNT(*)::int AS n ${base}`, params);
    const rows = await db.query(`SELECT ${select} ${base} ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${offset}`, params);
    return ok(req, res, rows.rows, 200, { total_count: count.rows[0].n, limit, offset });
  });
  app.get(`${spec.path}/:id`, authenticate, guard(spec.view), async (req, res) => {
    const org = req.session.organization_id;
    const sc = spec.rowScope?.(req);
    const r = await db.query(`SELECT ${select} FROM ${spec.table} t ${joins} WHERE t.organization_id = $1 AND t.id::text = $2${sc ? ` AND (${sc.sql.replace(/\$SCOPE/g, "$3")})` : ""}`, sc ? [org, req.params.id, sc.value] : [org, req.params.id]);
    if (!r.rows[0])
      throw notFound(spec.label);
    const extra = spec.detail ? await spec.detail(db, r.rows[0], org) : {};
    return ok(req, res, { ...r.rows[0], ...extra });
  });
  if (spec.create !== false) {
    app.post(spec.path, authenticate, guard(spec.create || spec.view), modCreate, async (req, res) => {
      const out = await unitOfWork(req, async (ctx) => {
        const values = await parseFields(ctx.tx, ctx.org, spec.fields, req.body);
        if (spec.beforeCreate)
          await spec.beforeCreate(ctx, values);
        if (spec.numbering && !values[spec.numbering.column]) {
          const d = spec.numbering.dateField ? values[spec.numbering.dateField] : void 0;
          values[spec.numbering.column] = await nextDocumentNumber(ctx.tx, ctx.org, spec.numbering.prefix, d || todayIso());
        }
        if (statusCol && spec.initialStatus && values[statusCol] === void 0)
          values[statusCol] = spec.initialStatus;
        const cols = ["organization_id", "legal_entity_id", "created_by", ...Object.keys(values)];
        const vals = [ctx.org, ctx.le, ctx.user, ...Object.values(values)];
        for (const c of cols)
          if (!IDENT.test(c))
            throw new Error("Illegal column");
        const r = await ctx.tx.query(`INSERT INTO ${spec.table} (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`, vals);
        const row = r.rows[0];
        if (spec.afterCreate)
          await spec.afterCreate(ctx, row);
        await audit2(ctx, `${spec.event}_CREATED`, spec.event, row.id, void 0, values);
        await emit(ctx, `${spec.event}_CREATED`, { id: row.id, ...pickScalars(row) });
        return row;
      });
      return ok(req, res, out, 201);
    });
  }
  if (spec.update !== false) {
    app.post(`${spec.path}/:id/update`, authenticate, guard(spec.update || spec.create || spec.view), modCmd, async (req, res) => {
      const out = await unitOfWork(req, async (ctx) => {
        const row = await loadRow(ctx.tx, spec.table, req.params.id, ctx.org, spec.label, true);
        await assertInScope(spec, ctx, row.id);
        const rev = int(req.body?.revision, "revision", { min: 1 });
        if (Number(row.revision) !== rev) {
          throw new ApiError(409, ErrorCode13.STALE_REVISION, `${spec.label} was changed by someone else (revision ${row.revision}); reload and retry`, { current_revision: row.revision });
        }
        if (statusCol && spec.editableIn && !spec.editableIn.includes(row[statusCol])) {
          throw new ApiError(409, ErrorCode13.INVALID_STATE, `${spec.label} cannot be edited in status ${row[statusCol]}`);
        }
        const editable = spec.editable || Object.keys(spec.fields);
        const fields = Object.fromEntries(Object.entries(spec.fields).filter(([k]) => editable.includes(k)));
        const values = await parseFields(ctx.tx, ctx.org, fields, req.body, true);
        if (spec.beforeUpdate)
          await spec.beforeUpdate(ctx, row, values);
        const sets = Object.keys(values).map((k, i) => `${k} = $${i + 3}`);
        const r = await ctx.tx.query(`UPDATE ${spec.table} SET ${[...sets, "revision = revision + 1", "updated_at = NOW()"].join(", ")} WHERE id = $1 AND organization_id = $2 RETURNING *`, [row.id, ctx.org, ...Object.values(values)]);
        await audit2(ctx, `${spec.event}_UPDATED`, spec.event, row.id, pickScalars(row), values);
        await emit(ctx, `${spec.event}_UPDATED`, { id: row.id, ...pickScalars(r.rows[0]) });
        return r.rows[0];
      });
      return ok(req, res, out);
    });
  }
  for (const [name, cmd] of Object.entries(spec.commands || {})) {
    const action = name.toUpperCase().replace(/-/g, "_");
    app.post(`${spec.path}/:id/${name}`, authenticate, guard(cmd.permission || spec.update || spec.create || spec.view), modCmd, async (req, res) => {
      const out = await unitOfWork(req, async (ctx) => {
        const row = await loadRow(ctx.tx, spec.table, req.params.id, ctx.org, spec.label, true);
        await assertInScope(spec, ctx, row.id);
        if (statusCol && cmd.from.length && !cmd.from.includes(row[statusCol])) {
          throw new ApiError(409, ErrorCode13.INVALID_STATE, `${spec.label} cannot ${name} from ${row[statusCol]} (allowed from: ${cmd.from.join(", ")})`, {
            current: row[statusCol],
            allowed_from: cmd.from
          });
        }
        if (cmd.sodColumn && row[cmd.sodColumn] && row[cmd.sodColumn] === ctx.user) {
          throw new ApiError(403, ErrorCode13.SEGREGATION_OF_DUTIES, `Segregation of duties: you cannot ${name} a ${spec.label.toLowerCase()} you ${cmd.sodColumn.replace(/_by$/, "")}`);
        }
        const input = cmd.fields ? await parseFields(ctx.tx, ctx.org, cmd.fields, req.body) : {};
        const r = cmd.run ? await cmd.run(ctx, row, input) || {} : {};
        let updated = row;
        const set = { ...r.set || {}, updated_at: (/* @__PURE__ */ new Date()).toISOString() };
        if (statusCol && cmd.to) {
          updated = await transition(ctx.tx, { table: spec.table, id: row.id, organizationId: ctx.org, from: cmd.from, to: cmd.to, label: spec.label, statusColumn: statusCol, set: { ...set, revision: Number(row.revision) + 1 } });
        } else if (Object.keys(r.set || {}).length) {
          const keys = Object.keys(set);
          for (const k of keys)
            if (!IDENT.test(k))
              throw new Error("Illegal column");
          updated = (await ctx.tx.query(`UPDATE ${spec.table} SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, revision = revision + 1 WHERE id = $1 RETURNING *`, [row.id, ...Object.values(set)])).rows[0];
        }
        await audit2(ctx, `${spec.event}_${action}`, spec.event, row.id, pickScalars(row), { ...input, ...r.set || {}, status: statusCol ? updated[statusCol] : void 0 });
        await emit(ctx, `${spec.event}_${action}`, { id: row.id, ...pickScalars(updated) });
        return r.data !== void 0 ? { ...updated, result: r.data } : updated;
      });
      return ok(req, res, out);
    });
  }
}
function pickScalars(row) {
  const out = {};
  for (const [k, v] of Object.entries(row || {})) {
    if (k === "content" || k === "content_base64" || k === "pin_hash" || k === "password_hash")
      continue;
    if (v === null || ["string", "number", "boolean"].includes(typeof v))
      out[k] = v;
    else if (v instanceof Date)
      out[k] = v.toISOString();
  }
  return out;
}
var IDENT, perms, guard;
var init_resource = __esm({
  "apps/api/dist/lib/resource.js"() {
    "use strict";
    init_context();
    init_http();
    init_errors();
    init_scope();
    init_state();
    init_numbering();
    init_modules();
    init_validate();
    IDENT = /^[a-z_][a-z0-9_]*$/;
    perms = (p) => Array.isArray(p) ? p : [p];
    guard = (p) => requireAnyPermission(...perms(p));
  }
});

// apps/api/dist/routes/config.js
import { Permission as Permission6, UserRole, ErrorCode as ErrorCode15 } from "@omnysync/contracts";
import { AuthService as AuthService3, ROLE_PERMISSIONS } from "@omnysync/platform";
function parseSetting(key, raw) {
  const def = SETTINGS[key];
  if (!def)
    throw notFound(`Setting ${key}`);
  const t = def.type;
  switch (t.kind) {
    case "int":
      return int(raw, "value", { min: t.min, max: t.max });
    case "decimal": {
      const v = String(raw ?? "").trim();
      if (!/^\d+(\.\d{1,4})?$/.test(v))
        throw validationError("value must be a decimal with at most 4 places", { field: "value" });
      const n = Number(v);
      if (n < Number(t.min) || n > Number(t.max))
        throw validationError(`value must be between ${t.min} and ${t.max}`, { field: "value" });
      return v;
    }
    case "enum":
      return oneOf(raw, "value", t.values);
    case "bool":
      if (typeof raw !== "boolean")
        throw validationError("value must be true or false", { field: "value" });
      return raw;
    case "text":
      return str(raw, "value", { max: t.max });
    case "hours": {
      const v = raw;
      const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
      if (!v || !hhmm.test(v.start) || !hhmm.test(v.end) || v.start >= v.end)
        throw validationError("value needs start < end in HH:MM", { field: "value" });
      if (!Array.isArray(v.days) || v.days.length === 0 || v.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6))
        throw validationError("days must list weekdays 0-6", { field: "value" });
      return { start: v.start, end: v.end, days: [...new Set(v.days)].sort() };
    }
  }
}
async function getSetting(q, org, key) {
  const r = await q.query(`SELECT value FROM org_settings WHERE organization_id = $1 AND setting_key = $2`, [org, key]);
  const v = r.rows[0]?.value;
  if (v === void 0)
    return SETTINGS[key]?.default;
  return v;
}
function registerConfigRoutes(app) {
  app.get("/api/admin/users", authenticate, requirePermission(Permission6.USER_MANAGE), async (req, res) => {
    const r = await db.query(`SELECT u.id, u.email, u.name, u.is_active AS user_active, m.roles, m.is_active, m.created_at
       FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.organization_id = $1 ORDER BY u.name`, [req.session.organization_id]);
    return ok(req, res, r.rows.map((x) => ({ ...x, roles: typeof x.roles === "string" ? JSON.parse(x.roles) : x.roles, status: x.is_active && x.user_active ? "ACTIVE" : "SUSPENDED" })));
  });
  app.get("/api/admin/roles", authenticate, requireAnyPermission(Permission6.USER_MANAGE, Permission6.CONFIG_VIEW), async (req, res) => {
    return ok(req, res, ROLE_NAMES.map((r) => ({ id: r, code: r, name: r.replace(/_/g, " "), permissions: ROLE_PERMISSIONS[r] || [], permission_count: (ROLE_PERMISSIONS[r] || []).length })));
  });
  app.post("/api/admin/users", authenticate, requirePermission(Permission6.USER_MANAGE), async (req, res) => {
    const email = str(req.body?.email, "email", { max: 255, pattern: /^[^@\s]+@[^@\s]+\.[^@\s]+$/ }).toLowerCase();
    const name = str(req.body?.name, "name", { max: 200 });
    const password = str(req.body?.initial_password, "initial_password", { min: 12, max: 128 });
    const roles = arrayOf(req.body?.roles, "roles", { min: 1, max: 5 }).map((r) => oneOf(r, "roles", ROLE_NAMES));
    const out = await unitOfWork(req, async (ctx) => {
      const exists = await ctx.tx.query(`SELECT id FROM users WHERE email = $1`, [email]);
      let userId = exists.rows[0]?.id;
      if (userId) {
        const mem = await ctx.tx.query(`SELECT 1 FROM memberships WHERE user_id = $1 AND organization_id = $2`, [userId, ctx.org]);
        if (mem.rows.length)
          throw new ApiError(409, ErrorCode15.DUPLICATE_RESOURCE, "This user is already a member of the organization", { field: "email" });
      } else {
        userId = (await ctx.tx.query(`INSERT INTO users (id, email, name, password_hash, is_active) VALUES (gen_random_uuid(), $1, $2, $3, true) RETURNING id`, [email, name, AuthService3.hashPassword(password)])).rows[0].id;
      }
      await ctx.tx.query(`INSERT INTO memberships (id, organization_id, legal_entity_id, user_id, roles, is_active) VALUES (gen_random_uuid(), $1, $2, $3, $4, true)`, [ctx.org, ctx.le, userId, JSON.stringify(roles)]);
      await audit2(ctx, "USER_INVITED", "USER", userId, void 0, { email, roles });
      return { id: userId, email, name, roles, status: "ACTIVE" };
    });
    return ok(req, res, out, 201);
  });
  const activeAdmins = async (q, org, excludeUser) => (await q.query(`SELECT COUNT(*)::int AS n FROM memberships m JOIN users u ON u.id = m.user_id
         WHERE m.organization_id = $1 AND m.is_active AND u.is_active AND m.roles::jsonb ? 'ADMIN' AND ($2::uuid IS NULL OR m.user_id <> $2::uuid)`, [org, excludeUser ?? null])).rows[0].n;
  app.post("/api/admin/users/:id/roles", authenticate, requirePermission(Permission6.USER_MANAGE), async (req, res) => {
    const roles = arrayOf(req.body?.roles, "roles", { min: 1, max: 5 }).map((r) => oneOf(r, "roles", ROLE_NAMES));
    const reason = optionalStr(req.body?.reason, "reason", 500);
    const out = await unitOfWork(req, async (ctx) => {
      const m = (await ctx.tx.query(`SELECT * FROM memberships WHERE user_id::text = $1 AND organization_id = $2 FOR UPDATE`, [req.params.id, ctx.org])).rows[0];
      if (!m)
        throw notFound("User");
      const before = typeof m.roles === "string" ? JSON.parse(m.roles) : m.roles;
      if (m.user_id === ctx.user && before.includes("ADMIN") && !roles.includes("ADMIN")) {
        throw new ApiError(409, ErrorCode15.INVALID_STATE, "You cannot remove your own administrator role (self-lockout guard)");
      }
      if (before.includes("ADMIN") && !roles.includes("ADMIN") && await activeAdmins(ctx.tx, ctx.org, m.user_id) === 0) {
        throw new ApiError(409, ErrorCode15.INVALID_STATE, "At least one active administrator must remain");
      }
      await ctx.tx.query(`UPDATE memberships SET roles = $1 WHERE id = $2`, [JSON.stringify([...new Set(roles)]), m.id]);
      await audit2(ctx, "USER_ROLES_CHANGED", "USER", m.user_id, { roles: before }, { roles, reason });
      return { id: m.user_id, roles };
    });
    return ok(req, res, out);
  });
  for (const [action, active] of [["suspend", false], ["reactivate", true]]) {
    app.post(`/api/admin/users/:id/${action}`, authenticate, requirePermission(Permission6.USER_MANAGE), async (req, res) => {
      const out = await unitOfWork(req, async (ctx) => {
        const m = (await ctx.tx.query(`SELECT * FROM memberships WHERE user_id::text = $1 AND organization_id = $2 FOR UPDATE`, [req.params.id, ctx.org])).rows[0];
        if (!m)
          throw notFound("User");
        if (!active && m.user_id === ctx.user)
          throw new ApiError(409, ErrorCode15.INVALID_STATE, "You cannot suspend your own account");
        const roles = typeof m.roles === "string" ? JSON.parse(m.roles) : m.roles;
        if (!active && roles.includes("ADMIN") && await activeAdmins(ctx.tx, ctx.org, m.user_id) === 0)
          throw new ApiError(409, ErrorCode15.INVALID_STATE, "At least one active administrator must remain");
        await ctx.tx.query(`UPDATE memberships SET is_active = $1 WHERE id = $2`, [active, m.id]);
        await audit2(ctx, active ? "USER_REACTIVATED" : "USER_SUSPENDED", "USER", m.user_id, { is_active: m.is_active }, { is_active: active });
        return { id: m.user_id, status: active ? "ACTIVE" : "SUSPENDED" };
      });
      return ok(req, res, out);
    });
  }
  app.get("/api/config/settings", authenticate, requireAnyPermission(Permission6.CONFIG_VIEW, Permission6.CONFIG_MANAGE), async (req, res) => {
    const org = req.session.organization_id;
    const r = await db.query(`SELECT * FROM org_settings WHERE organization_id = $1`, [org]);
    const byKey = new Map(r.rows.map((x) => [x.setting_key, x]));
    return ok(req, res, Object.entries(SETTINGS).map(([key, d]) => {
      const row = byKey.get(key);
      const v = row ? row.value : d.default;
      return { id: key, key, label: d.label, group: d.group, kind: d.type.kind, options: d.type.values, help: d.help, value: v, is_default: !row, version: row?.version ?? 0, updated_at: row?.updated_at ?? null };
    }));
  });
  app.get("/api/config/settings/:key/history", authenticate, requireAnyPermission(Permission6.CONFIG_VIEW, Permission6.CONFIG_MANAGE), async (req, res) => {
    const r = await db.query(`SELECT h.*, u.name AS changed_by_name FROM org_setting_history h LEFT JOIN users u ON u.id = h.changed_by WHERE h.organization_id = $1 AND h.setting_key = $2 ORDER BY h.version DESC LIMIT 50`, [req.session.organization_id, req.params.key]);
    return ok(req, res, r.rows);
  });
  app.post("/api/config/settings/:key", authenticate, requirePermission(Permission6.CONFIG_MANAGE), async (req, res) => {
    const key = req.params.key;
    const value = parseSetting(key, req.body?.value);
    const expected = int(req.body?.version, "version", { min: 0 });
    const reason = optionalStr(req.body?.reason, "reason", 500);
    const out = await unitOfWork(req, async (ctx) => {
      const cur = (await ctx.tx.query(`SELECT * FROM org_settings WHERE organization_id = $1 AND setting_key = $2 FOR UPDATE`, [ctx.org, key])).rows[0];
      const curVersion = cur?.version ?? 0;
      if (curVersion !== expected)
        throw new ApiError(409, ErrorCode15.STALE_REVISION, `Setting changed meanwhile (now version ${curVersion}); reload and retry`, { current_version: curVersion });
      const next = curVersion + 1;
      await ctx.tx.query(`INSERT INTO org_settings (organization_id, setting_key, value, version, updated_by, updated_at) VALUES ($1,$2,$3,$4,$5,NOW())
         ON CONFLICT (organization_id, setting_key) DO UPDATE SET value = EXCLUDED.value, version = EXCLUDED.version, updated_by = EXCLUDED.updated_by, updated_at = NOW()`, [ctx.org, key, JSON.stringify(value), next, ctx.user]);
      await ctx.tx.query(`INSERT INTO org_setting_history (organization_id, setting_key, version, old_value, new_value, reason, changed_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
        ctx.org,
        key,
        next,
        cur ? JSON.stringify(cur.value) : null,
        JSON.stringify(value),
        reason,
        ctx.user
      ]);
      await audit2(ctx, "SETTING_CHANGED", "SETTING", ctx.org, { key, value: cur?.value ?? SETTINGS[key].default }, { key, value, version: next, reason });
      if (key === "inventory.costing_method" && value === "FIFO") {
        const fifo_layers = await reconcileFifoLayers(ctx.tx, ctx.org, new Date(Date.now() + 5 * 36e5).toISOString().slice(0, 10));
        if (fifo_layers.opened.length || fifo_layers.trimmed.length)
          await audit2(ctx, "FIFO_LAYERS_RECONCILED", "SETTING", ctx.org, void 0, fifo_layers);
        return { key, value, version: next, fifo_layers };
      }
      return { key, value, version: next };
    });
    return ok(req, res, out);
  });
  app.get("/api/config/modules", authenticate, requireAnyPermission(Permission6.CONFIG_VIEW, Permission6.CONFIG_MANAGE, Permission6.ORG_MANAGE), async (req, res) => {
    const states = await moduleStates(db, req.session.organization_id);
    return ok(req, res, MODULES.map((m) => ({ id: m.code, ...m, state: states.get(m.code), dependents: MODULES.filter((x) => x.depends.includes(m.code)).map((x) => x.code) })));
  });
  app.post("/api/config/modules/:code/state", authenticate, requirePermission(Permission6.ORG_MANAGE), async (req, res) => {
    const code = String(req.params.code).toUpperCase();
    const to = oneOf(req.body?.state, "state", ["enabled", "draining", "read_only", "disabled"]);
    const reason = str(req.body?.reason, "reason", { max: 500 });
    const out = await unitOfWork(req, async (ctx) => {
      await ctx.tx.query(`SELECT 1 FROM organizations WHERE id = $1 FOR UPDATE`, [ctx.org]);
      const states = await moduleStates(ctx.tx, ctx.org);
      const err = validateModuleTransition(code, to, states);
      if (err)
        throw new ApiError(409, ErrorCode15.INVALID_STATE, err);
      const from = states.get(code);
      await ctx.tx.query(`INSERT INTO module_states (organization_id, module_code, state, reason, changed_by, changed_at) VALUES ($1,$2,$3,$4,$5,NOW())
         ON CONFLICT (organization_id, module_code) DO UPDATE SET state = EXCLUDED.state, reason = EXCLUDED.reason, changed_by = EXCLUDED.changed_by, changed_at = NOW()`, [ctx.org, code, to, reason, ctx.user]);
      await audit2(ctx, "MODULE_STATE_CHANGED", "MODULE", ctx.org, { module: code, state: from }, { module: code, state: to, reason });
      return { code, from, state: to };
    });
    return ok(req, res, out);
  });
  app.get("/api/config/branding", authenticate, async (req, res) => {
    const org = req.session.organization_id;
    const r = await db.query(`SELECT setting_key, value FROM org_settings WHERE organization_id = $1 AND setting_key IN ('org.company_name', 'org.legal_entity_name', 'org.tagline', 'org.logo_url', 'org.primary_color')`, [org]);
    const map = new Map(r.rows.map((x) => [x.setting_key, x.value]));
    return ok(req, res, {
      company_name: map.get("org.company_name") || "OMNYSYNC ERP",
      legal_entity_name: map.get("org.legal_entity_name") || "Omnysync Pakistan Pvt Ltd",
      tagline: map.get("org.tagline") || "Modular Enterprise Platform",
      logo_url: map.get("org.logo_url") || "",
      primary_color: map.get("org.primary_color") || "#5940B8"
    });
  });
  app.post("/api/config/branding", authenticate, requirePermission(Permission6.CONFIG_MANAGE), async (req, res) => {
    const company_name = str(req.body?.company_name || "OMNYSYNC ERP", "company_name", { max: 200 });
    const legal_entity_name = str(req.body?.legal_entity_name || "Omnysync Pakistan Pvt Ltd", "legal_entity_name", { max: 200 });
    const tagline = str(req.body?.tagline || "Modular Enterprise Platform", "tagline", { max: 200 });
    const logo_url = String(req.body?.logo_url || "");
    const primary_color = str(req.body?.primary_color || "#5940B8", "primary_color", { max: 32 });
    const brandingItems = [
      { key: "org.company_name", val: company_name },
      { key: "org.legal_entity_name", val: legal_entity_name },
      { key: "org.tagline", val: tagline },
      { key: "org.logo_url", val: logo_url },
      { key: "org.primary_color", val: primary_color }
    ];
    const out = await unitOfWork(req, async (ctx) => {
      for (const item of brandingItems) {
        await ctx.tx.query(`INSERT INTO org_settings (organization_id, setting_key, value, version, updated_by, updated_at)
           VALUES ($1, $2, $3, 1, $4, NOW())
           ON CONFLICT (organization_id, setting_key) DO UPDATE SET value = EXCLUDED.value, version = org_settings.version + 1, updated_by = EXCLUDED.updated_by, updated_at = NOW()`, [ctx.org, item.key, JSON.stringify(item.val), ctx.user]);
      }
      await audit2(ctx, "BRANDING_UPDATED", "ORGANIZATION", ctx.org, void 0, {
        company_name,
        legal_entity_name,
        tagline,
        primary_color,
        has_logo: Boolean(logo_url)
      });
      return { company_name, legal_entity_name, tagline, logo_url, primary_color };
    });
    return ok(req, res, out);
  });
}
var SETTINGS, ROLE_NAMES;
var init_config = __esm({
  "apps/api/dist/routes/config.js"() {
    "use strict";
    init_context();
    init_http();
    init_errors();
    init_resource();
    init_validate();
    init_modules();
    init_stock();
    SETTINGS = {
      "sales.payment_terms_days": { label: "Default payment terms (days)", group: "Sales & AR", type: { kind: "int", min: 0, max: 365 }, default: 30, help: "Used for due dates on new invoices." },
      "sales.credit_check": { label: "Enforce credit limits", group: "Sales & AR", type: { kind: "bool" }, default: true, help: "Block order confirmation beyond the customer limit." },
      "pos.max_cashier_discount_pct": { label: "Cashier discount limit (%)", group: "POS", type: { kind: "decimal", min: "0", max: "100" }, default: "10", help: "Above this a manager PIN is required." },
      "inventory.costing_method": { label: "Inventory costing method", group: "Inventory", type: { kind: "enum", values: ["STANDARD", "MOVING_AVERAGE", "FIFO"] }, default: "STANDARD", help: "MOVING_AVERAGE re-computes unit cost on each receipt; FIFO values issues at the oldest receipt layers (ADR-016)." },
      "inventory.allow_negative_stock": { label: "Allow negative stock", group: "Inventory", type: { kind: "bool" }, default: false, help: "Never recommended; issues are blocked when off." },
      "service.business_hours": { label: "Service SLA business hours", group: "Service", type: { kind: "hours" }, default: { start: "09:00", end: "18:00", days: [1, 2, 3, 4, 5, 6] }, help: "SLA clocks only run inside these hours, in the organisation time zone." },
      "service.default_labour_rate": { label: "Default technician labour rate (PKR/h)", group: "Service", type: { kind: "decimal", min: "0", max: "1000000" }, default: "2500", help: "Used when billing approved service time." },
      "time.daily_overtime_after_hours": { label: "Overtime after (hours/day)", group: "Time", type: { kind: "decimal", min: "1", max: "24" }, default: "8", help: "Hours beyond this are overtime." },
      "tax.default_output_code": { label: "Default output tax code", group: "Tax", type: { kind: "text", max: 32 }, default: "GST18", help: "Applied when an item has no tax rate." },
      "grc.risk_appetite": { label: "Risk appetite (max acceptable residual score)", group: "Risk", type: { kind: "int", min: 1, max: 25 }, default: 8, help: "Risks above this residual score (likelihood \xD7 impact) cannot be accepted without escalation." },
      "epm.po_budget_control": { label: "PO budget control", group: "Budgets", type: { kind: "enum", values: ["OFF", "WARN", "BLOCK"] }, default: "WARN", help: "On PO approval, expense lines are checked against the approved annual budget (actuals + open commitments). BLOCK refuses; WARN approves and flags." },
      "lnd.late_fee_flat": { label: "Loan late fee (PKR per overdue instalment)", group: "Lending", type: { kind: "decimal", min: "0", max: "1000000" }, default: "500", help: "Charged once per instalment still unpaid after the grace period; collected first, income on collection." },
      "lnd.interest_basis": { label: "Loan interest recognition", group: "Lending", type: { kind: "enum", values: ["CASH", "ACCRUAL"] }, default: "CASH", help: "ACCRUAL accrues each instalment\u2019s interest on its due date (DR 112005 / CR 411006, LND-LATE-FEES job or the Accrue action); collections then clear the receivable." },
      "lnd.grace_days": { label: "Loan grace period (days)", group: "Lending", type: { kind: "int", min: 0, max: 60 }, default: 5, help: "Days after the due date before a late fee applies." },
      "org.timezone": { label: "Organisation time zone", group: "Organisation", type: { kind: "enum", values: ["Asia/Karachi", "Asia/Dubai", "Asia/Riyadh", "Asia/Kolkata", "Europe/London", "UTC", "America/New_York"] }, default: "Asia/Karachi", help: "Local day and business-hour SLA clocks (SRV) use this zone." },
      "org.company_name": { label: "Company / Organization Name", group: "Branding & Customization", type: { kind: "text", max: 200 }, default: "OMNYSYNC ERP", help: "Display name across the top bar, sidebar, invoices, and reports." },
      "org.legal_entity_name": { label: "Legal Entity Name", group: "Branding & Customization", type: { kind: "text", max: 200 }, default: "Omnysync Pakistan Pvt Ltd", help: "Legal entity printed on official documents, invoices and receipts." },
      "org.tagline": { label: "Brand Tagline / Subtitle", group: "Branding & Customization", type: { kind: "text", max: 200 }, default: "Modular Enterprise Platform", help: "Subtitle shown under company name in the sidebar." },
      "org.logo_url": { label: "Custom Logo (PNG/SVG URL or Data URI)", group: "Branding & Customization", type: { kind: "text", max: 5e5 }, default: "", help: "Custom PNG/SVG image or Base64 data URI for branding." },
      "org.primary_color": { label: "Primary Brand Color", group: "Branding & Customization", type: { kind: "text", max: 32 }, default: "#5940B8", help: "Hex color code for theme highlights and primary logo badge." },
      "finance.require_journal_approval": { label: "Manual journals need approval", group: "Finance", type: { kind: "bool" }, default: true, help: "Maker-checker on manual vouchers." }
    };
    ROLE_NAMES = Object.values(UserRole);
  }
});

// apps/api/dist/domain/tax.js
import { Money as Money16 } from "@omnysync/financial-engine";
function computeTax(line, scale = 2) {
  const amt = new Money16(line.amount);
  const r = new Money16(line.rate).div(100);
  if (line.inclusive) {
    const gross = amt.round(scale);
    const net2 = gross.div(r.add(1)).round(scale);
    const tax2 = gross.sub(net2);
    return { net: net2.toFixed(scale), tax: tax2.toFixed(scale), gross: gross.toFixed(scale) };
  }
  const net = amt.round(scale);
  const tax = net.mul(r).round(scale);
  return { net: net.toFixed(scale), tax: tax.toFixed(scale), gross: net.add(tax).toFixed(scale) };
}
function effectiveCode(versions, date) {
  const d = date.slice(0, 10);
  const hits = versions.filter((v) => v.status !== "RETIRED" && String(v.effective_from).slice(0, 10) <= d && (!v.effective_to || String(v.effective_to).slice(0, 10) >= d)).sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)));
  return hits[0] || null;
}
function windowsOverlap(aFrom, aTo, bFrom, bTo) {
  const aEnd = aTo || "9999-12-31";
  const bEnd = bTo || "9999-12-31";
  return aFrom.slice(0, 10) <= bEnd.slice(0, 10) && bFrom.slice(0, 10) <= aEnd.slice(0, 10);
}
var init_tax = __esm({
  "apps/api/dist/domain/tax.js"() {
    "use strict";
  }
});

// apps/api/dist/lib/ar-invoice.js
import crypto15 from "node:crypto";
import { AccountingPurpose as AccountingPurpose11, ErrorCode as ErrorCode27 } from "@omnysync/contracts";
import { Money as Money17 } from "@omnysync/financial-engine";
async function createPostedSourceInvoice(ctx, input) {
  const dup = await ctx.tx.query(`SELECT id FROM journals WHERE organization_id = $1 AND source_key = $2`, [ctx.org, input.sourceKey]);
  if (dup.rows.length)
    throw new ApiError(409, ErrorCode27.ALREADY_BILLED, `Source ${input.sourceKey} has already been invoiced`);
  const priced = input.lines.map((l) => {
    const net = new Money17(l.quantity).mul(l.unit_price).round(2).toFixed(2);
    const t = computeTax({ amount: net, rate: l.tax_rate });
    return { ...l, line_total: t.net, tax_amount: t.tax };
  });
  const subtotal = priced.reduce((a, l) => a.add(l.line_total), Money17.zero());
  const tax = priced.reduce((a, l) => a.add(l.tax_amount), Money17.zero());
  const total = subtotal.add(tax);
  if (!total.isPositive())
    return null;
  const id = crypto15.randomUUID();
  const number = await nextDocumentNumber(ctx.tx, ctx.org, input.prefix || "INV", input.invoice_date);
  const due = new Date(Date.parse(input.invoice_date) + (input.due_days ?? 30) * 864e5).toISOString().slice(0, 10);
  await ctx.tx.query(`INSERT INTO ar_invoices (id, organization_id, legal_entity_id, party_id, invoice_number, invoice_date, due_date, status, subtotal, tax_amount, total_amount, outstanding_amount, notes, created_by, posted_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'POSTED',$8,$9,$10,$10,$11,$12,$12)`, [id, ctx.org, ctx.le, input.party_id, number, input.invoice_date, due, subtotal.toFixed(8), tax.toFixed(8), total.toFixed(8), input.notes || null, ctx.user]);
  let n = 1;
  const revenue = /* @__PURE__ */ new Map();
  for (const l of priced) {
    await ctx.tx.query(`INSERT INTO ar_invoice_lines (id, invoice_id, line_number, item_id, quantity, unit_price, line_total, tax_amount, description) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [crypto15.randomUUID(), id, n++, l.item_id, l.quantity, l.unit_price, l.line_total, l.tax_amount, l.description]);
    const acc = l.revenue_account_code || "411002";
    revenue.set(acc, (revenue.get(acc) || Money17.zero()).add(l.line_total));
  }
  const jLines = [{ account_code: "112001", debit: total.toFixed(8), party_id: input.party_id, description: `AR ${number}` }];
  for (const [code, amt] of revenue)
    if (amt.isPositive())
      jLines.push({ account_code: code, credit: amt.toFixed(8), description: `Revenue ${number}` });
  if (tax.isPositive())
    jLines.push({ account_code: "212001", credit: tax.toFixed(8), description: `Output tax ${number}` });
  const posted = await postJournal(ctx.tx, auditLogger, outboxService, {
    organizationId: ctx.org,
    legalEntityId: ctx.le,
    userId: ctx.user,
    postingDate: input.invoice_date,
    purpose: input.purpose || AccountingPurpose11.SALES_INVOICE,
    description: `Customer invoice ${number}`,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    sourceKey: input.sourceKey,
    numberPrefix: "JV-AR",
    correlationId: ctx.req.correlationId,
    lines: jLines
  });
  await ctx.tx.query(`UPDATE ar_invoices SET posted_journal_id = $1 WHERE id = $2`, [posted?.journalId ?? null, id]);
  return { id, invoice_number: number, subtotal: subtotal.toFixed(2), tax_amount: tax.toFixed(2), total_amount: total.toFixed(2), journal_number: posted?.journalNumber ?? null };
}
var init_ar_invoice = __esm({
  "apps/api/dist/lib/ar-invoice.js"() {
    "use strict";
    init_context();
    init_posting();
    init_numbering();
    init_errors();
    init_tax();
  }
});

// apps/api/dist/domain/sla.js
function localParts2(t, off) {
  const d = new Date(t + off * 6e4);
  return { date: d.toISOString().slice(0, 10), dow: d.getUTCDay(), minute: d.getUTCHours() * 60 + d.getUTCMinutes(), dayStartUtc: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - off * 6e4 };
}
function isWorkingDay(h, date, dow2) {
  return h.days.includes(dow2) && !(h.holidays || []).includes(date);
}
function addBusinessMinutes(from, minutes, h) {
  const off = h.offsetMinutes ?? 300;
  const open = toMin(h.start);
  const close = toMin(h.end);
  if (close <= open)
    throw new Error("Business hours must close after they open");
  if (!h.days.length)
    throw new Error("At least one working day is required");
  let t = from.getTime();
  let left = Math.max(0, Math.round(minutes));
  for (let guard2 = 0; guard2 < 3700; guard2++) {
    const p = localParts2(t, off);
    const working = isWorkingDay(h, p.date, p.dow);
    if (!working || p.minute >= close) {
      t = p.dayStartUtc + 864e5 + open * 6e4;
      continue;
    }
    if (p.minute < open) {
      t = p.dayStartUtc + open * 6e4;
      continue;
    }
    const avail = close - p.minute;
    if (left <= avail)
      return new Date(t + left * 6e4);
    left -= avail;
    t = p.dayStartUtc + 864e5 + open * 6e4;
  }
  throw new Error("SLA horizon exceeded (check business hours / holidays)");
}
function businessMinutesBetween(a, b, h) {
  if (b.getTime() <= a.getTime())
    return 0;
  const off = h.offsetMinutes ?? 300;
  const open = toMin(h.start);
  const close = toMin(h.end);
  let total = 0;
  let t = a.getTime();
  const end = b.getTime();
  for (let guard2 = 0; guard2 < 3700 && t < end; guard2++) {
    const p = localParts2(t, off);
    const dayOpen = p.dayStartUtc + open * 6e4;
    const dayClose = p.dayStartUtc + close * 6e4;
    if (isWorkingDay(h, p.date, p.dow)) {
      const s = Math.max(t, dayOpen);
      const e = Math.min(end, dayClose);
      if (e > s)
        total += (e - s) / 6e4;
    }
    t = p.dayStartUtc + 864e5;
  }
  return Math.round(total);
}
function slaState(opts) {
  if (opts.doneAt)
    return opts.doneAt.getTime() <= opts.due.getTime() ? "MET" : "BREACHED";
  if (opts.paused)
    return "PAUSED";
  if (opts.now.getTime() > opts.due.getTime())
    return "BREACHED";
  const window2 = opts.due.getTime() - opts.start.getTime();
  return opts.due.getTime() - opts.now.getTime() <= window2 * 0.2 ? "AT_RISK" : "ON_TRACK";
}
var toMin, overlaps;
var init_sla = __esm({
  "apps/api/dist/domain/sla.js"() {
    "use strict";
    toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
    overlaps = (aStart, aEnd, bStart, bEnd) => aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
  }
});

// apps/api/dist/routes/service.js
var service_exports = {};
__export(service_exports, {
  assertEntitlement: () => assertEntitlement,
  generatePreventive: () => generatePreventive,
  registerServiceRoutes: () => registerServiceRoutes,
  signoffHash: () => signoffHash,
  utcOffsetMinutes: () => utcOffsetMinutes
});
import crypto16 from "node:crypto";
import { Permission as Permission20, ErrorCode as ErrorCode30, AccountingPurpose as AccountingPurpose14 } from "@omnysync/contracts";
import { Money as Money20 } from "@omnysync/financial-engine";
function utcOffsetMinutes(timeZone, at = /* @__PURE__ */ new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at).map((p) => [p.type, p.value]));
  const local = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return Math.round((local - Math.floor(at.getTime() / 1e3) * 1e3) / 6e4);
}
async function orgOffset(q, org) {
  return utcOffsetMinutes(await getSetting(q, org, "org.timezone"));
}
async function businessHours(q, org) {
  const h = await getSetting(q, org, "service.business_hours");
  return { start: h.start, end: h.end, days: h.days, holidays: Array.isArray(h.holidays) ? h.holidays : [], offsetMinutes: await orgOffset(q, org) };
}
function assertEntitlement(contract, partyId, onDate) {
  if (!contract)
    return;
  if (contract.party_id !== partyId)
    throw new ApiError(400, ErrorCode30.ENTITLEMENT_INVALID, "Contract belongs to a different customer", { field: "contract_id" });
  if (contract.status !== "ACTIVE")
    throw new ApiError(409, ErrorCode30.ENTITLEMENT_INVALID, `Contract ${contract.number} is ${contract.status}`, { field: "contract_id" });
  if (onDate < toIsoDate(contract.start_date) || onDate > toIsoDate(contract.end_date)) {
    throw new ApiError(409, ErrorCode30.ENTITLEMENT_INVALID, `Contract ${contract.number} does not cover ${onDate} (valid ${toIsoDate(contract.start_date)} \u2013 ${toIsoDate(contract.end_date)})`, { field: "contract_id" });
  }
}
async function computeDue(q, org, priority, contract, from) {
  const h = await businessHours(q, org);
  const respH = contract ? Math.min(contract.response_hours, DEFAULT_RESPONSE_H[priority] ?? 8) : DEFAULT_RESPONSE_H[priority] ?? 8;
  const resH = contract ? contract.resolution_hours : Math.ceil(24 * (PRIORITY_FACTOR[priority] ?? 1) * 2);
  return { response_due_at: addBusinessMinutes(from, respH * 60, h).toISOString(), resolution_due_at: addBusinessMinutes(from, resH * 60, h).toISOString() };
}
function signoffHash(wo, parts, time, extras) {
  const canon = JSON.stringify({
    wo: wo.id,
    checklist: (typeof wo.checklist === "string" ? JSON.parse(wo.checklist) : wo.checklist) || [],
    parts: parts.map((p) => [p.item_id, new Money20(p.quantity).toFixed(4)]).sort(),
    time: time.filter((t) => t.status !== "REJECTED").map((t) => [new Date(t.start_at).toISOString(), new Date(t.end_at).toISOString()]).sort(),
    extras: extras.filter((e) => e.status === "ACCEPTED").map((e) => [e.description, new Money20(e.amount).toFixed(2)]).sort()
  });
  return crypto16.createHash("sha256").update(canon).digest("hex");
}
async function woChildren(q, woId) {
  const [parts, time, extras] = await Promise.all([
    q.query(`SELECT p.*, i.code AS item_code, i.name AS item_name FROM srv_work_order_parts p JOIN items i ON i.id = p.item_id WHERE p.work_order_id = $1 ORDER BY p.created_at`, [woId]),
    q.query(`SELECT te.*, t.name AS technician_name FROM srv_time_entries te JOIN srv_technicians t ON t.id = te.technician_id WHERE te.work_order_id = $1 ORDER BY te.start_at`, [woId]),
    q.query(`SELECT * FROM srv_extra_work WHERE work_order_id = $1 ORDER BY created_at`, [woId])
  ]);
  return { parts: parts.rows, time: time.rows, extras: extras.rows };
}
async function assertMember(ctx, userId, field) {
  const r = await ctx.tx.query(`SELECT 1 FROM memberships WHERE organization_id = $1 AND user_id::text = $2`, [ctx.org, userId]);
  if (!r.rows.length)
    throw validationError(`${field} is not a user of this organization`, { field });
}
async function assertTechScope(ctx, wo) {
  const s = ctx.req.session;
  if (s.permissions.includes(Permission20.SERVICE_MANAGE))
    return;
  const t = (await ctx.tx.query(`SELECT id FROM srv_technicians WHERE organization_id = $1 AND user_id = $2`, [ctx.org, ctx.user])).rows[0];
  if (!t || t.id !== wo.technician_id)
    throw new ApiError(403, ErrorCode30.FORBIDDEN_SCOPE, "This work order is not assigned to you");
}
function registerServiceRoutes(app) {
  defineResource(app, {
    path: "/api/srv/technicians",
    table: "srv_technicians",
    label: "Technician",
    event: "SERVICE_TECHNICIAN",
    module: "SRV",
    view: VIEW5,
    create: Permission20.SERVICE_MANAGE,
    update: Permission20.SERVICE_MANAGE,
    fields: {
      code: { type: "string", required: true, max: 32, pattern: /^[A-Z0-9-]+$/ },
      name: { type: "string", required: true },
      user_id: { type: "string", max: 64 },
      skills: { type: "string", max: 500 },
      zone: { type: "string", max: 64 },
      phone: { type: "string", max: 40 },
      hourly_cost: { type: "decimal", default: "0" }
    },
    editable: ["name", "skills", "zone", "phone", "hourly_cost"],
    initialStatus: "ACTIVE",
    beforeCreate: async (ctx, v) => {
      if (v.user_id)
        await assertMember(ctx, v.user_id, "user_id");
    },
    search: ["code", "name", "skills", "zone"],
    orderBy: "t.code",
    commands: { deactivate: { from: ["ACTIVE"], to: "INACTIVE", permission: Permission20.SERVICE_MANAGE }, activate: { from: ["INACTIVE"], to: "ACTIVE", permission: Permission20.SERVICE_MANAGE } }
  });
  defineResource(app, {
    path: "/api/srv/contracts",
    table: "srv_contracts",
    label: "Service contract",
    event: "SERVICE_CONTRACT",
    module: "SRV",
    view: VIEW5,
    create: Permission20.SERVICE_MANAGE,
    update: Permission20.SERVICE_MANAGE,
    fields: {
      party_id: { type: "ref", table: "parties", required: true, label: "party_id" },
      contract_type: { type: "enum", values: ["WARRANTY", "AMC", "SLA_ONLY"], required: true },
      title: { type: "string", required: true },
      site_address: { type: "text" },
      equipment: { type: "text" },
      start_date: { type: "date", required: true },
      end_date: { type: "date", required: true },
      response_hours: { type: "int", min: 1, max: 720, default: 4 },
      resolution_hours: { type: "int", min: 1, max: 2160, default: 24 },
      covers_labour: { type: "bool" },
      covers_parts: { type: "bool" },
      visits_included: { type: "int", min: 0, max: 365, default: 0 },
      pm_interval_months: { type: "int", min: 1, max: 24 },
      next_pm_date: { type: "date" },
      contract_value: { type: "decimal", default: "0" }
    },
    editable: ["title", "site_address", "equipment", "end_date", "response_hours", "resolution_hours", "pm_interval_months", "next_pm_date"],
    editableIn: ["DRAFT", "ACTIVE"],
    numbering: { column: "number", prefix: "SVC", dateField: "start_date" },
    initialStatus: "DRAFT",
    select: "t.*, p.name AS party_name",
    joins: "JOIN parties p ON p.id = t.party_id",
    search: ["number", "title", "p.name"],
    filters: ["contract_type", "party_id"],
    beforeCreate: async (_ctx, v) => {
      if (v.end_date < v.start_date)
        throw validationError("end_date must be on or after start_date", { field: "end_date" });
      if (v.pm_interval_months && !v.next_pm_date)
        v.next_pm_date = v.start_date;
    },
    commands: {
      activate: { from: ["DRAFT"], to: "ACTIVE", permission: Permission20.SERVICE_MANAGE },
      expire: { from: ["ACTIVE"], to: "EXPIRED", permission: Permission20.SERVICE_MANAGE },
      cancel: { from: ["DRAFT", "ACTIVE"], to: "CANCELLED", permission: Permission20.SERVICE_MANAGE }
    }
  });
  defineResource(app, {
    path: "/api/srv/cases",
    table: "srv_cases",
    label: "Service case",
    event: "SERVICE_CASE",
    module: "SRV",
    view: VIEW5,
    create: Permission20.SERVICE_MANAGE,
    update: Permission20.SERVICE_MANAGE,
    fields: {
      party_id: { type: "ref", table: "parties", required: true, label: "party_id" },
      contract_id: { type: "ref", table: "srv_contracts", label: "contract_id" },
      channel: { type: "enum", values: ["PHONE", "EMAIL", "WHATSAPP", "PORTAL", "WALK_IN"], default: "PHONE" },
      external_ref: { type: "string", max: 120 },
      title: { type: "string", required: true },
      description: { type: "text" },
      category: { type: "enum", values: ["REPAIR", "INSTALLATION", "MAINTENANCE", "INSPECTION", "COMPLAINT", "OTHER"], default: "REPAIR" },
      priority: { type: "enum", values: ["LOW", "MEDIUM", "HIGH", "CRITICAL"], default: "MEDIUM" },
      site_address: { type: "text" }
    },
    editable: ["title", "description", "site_address", "category"],
    editableIn: ["NEW", "TRIAGED", "SCHEDULED", "IN_PROGRESS", "ON_HOLD"],
    numbering: { column: "number", prefix: "SRV" },
    initialStatus: "NEW",
    select: `t.*, p.name AS party_name, c.number AS contract_number, c.contract_type,
      (SELECT COUNT(*)::int FROM srv_work_orders w WHERE w.case_id = t.id AND w.status <> 'CANCELLED') AS work_order_count`,
    joins: "JOIN parties p ON p.id = t.party_id LEFT JOIN srv_contracts c ON c.id = t.contract_id",
    search: ["number", "title", "p.name", "site_address"],
    filters: ["priority", "party_id", "category"],
    orderBy: `CASE t.priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END, t.created_at DESC`,
    detail: async (q, row) => {
      const h = await businessHours(q, row.organization_id);
      const now = /* @__PURE__ */ new Date();
      const res = row.resolution_due_at ? slaState({ start: new Date(row.created_at), due: new Date(new Date(row.resolution_due_at).getTime() + row.paused_minutes * 6e4), now, doneAt: row.resolved_at ? new Date(row.resolved_at) : null, paused: !!row.paused_at }) : null;
      const resp = row.response_due_at ? slaState({ start: new Date(row.created_at), due: new Date(row.response_due_at), now, doneAt: row.first_response_at ? new Date(row.first_response_at) : null }) : null;
      const wos = await q.query(`SELECT w.*, t.name AS technician_name FROM srv_work_orders w LEFT JOIN srv_technicians t ON t.id = w.technician_id WHERE w.case_id = $1 ORDER BY w.created_at`, [row.id]);
      return { response_sla: resp, resolution_sla: res, business_minutes_open: businessMinutesBetween(new Date(row.created_at), row.resolved_at ? new Date(row.resolved_at) : now, h), work_orders: wos.rows };
    },
    beforeCreate: async (ctx, v) => {
      if (v.external_ref) {
        const ex = await ctx.tx.query(`SELECT id, number FROM srv_cases WHERE organization_id = $1 AND channel = $2 AND external_ref = $3`, [ctx.org, v.channel, v.external_ref]);
        if (ex.rows[0])
          throw new ApiError(409, ErrorCode30.DUPLICATE_RESOURCE, `Request already logged as ${ex.rows[0].number}`, { existing_id: ex.rows[0].id, existing_number: ex.rows[0].number });
      }
      let contract = null;
      if (v.contract_id) {
        contract = await loadRow(ctx.tx, "srv_contracts", v.contract_id, ctx.org, "Contract");
        assertEntitlement(contract, v.party_id, todayIso());
      }
      Object.assign(v, await computeDue(ctx.tx, ctx.org, v.priority || "MEDIUM", contract, /* @__PURE__ */ new Date()));
    },
    commands: {
      triage: {
        from: ["NEW", "TRIAGED"],
        to: "TRIAGED",
        permission: Permission20.SERVICE_MANAGE,
        fields: { priority: { type: "enum", values: ["LOW", "MEDIUM", "HIGH", "CRITICAL"], required: true }, owner_user_id: { type: "string", max: 64 }, triage_reason: { type: "text", required: true } },
        run: async (ctx, row, input) => {
          if (input.owner_user_id)
            await assertMember(ctx, input.owner_user_id, "owner_user_id");
          const contract = row.contract_id ? await loadRow(ctx.tx, "srv_contracts", row.contract_id, ctx.org, "Contract") : null;
          const set = { priority: input.priority, triage_reason: input.triage_reason, owner_user_id: input.owner_user_id || ctx.user, first_response_at: row.first_response_at ? new Date(row.first_response_at).toISOString() : (/* @__PURE__ */ new Date()).toISOString() };
          if (input.priority !== row.priority)
            Object.assign(set, await computeDue(ctx.tx, ctx.org, input.priority, contract, new Date(row.created_at)));
          return { set };
        }
      },
      hold: { from: ["TRIAGED", "SCHEDULED", "IN_PROGRESS"], to: "ON_HOLD", permission: [Permission20.SERVICE_MANAGE], fields: { triage_reason: { type: "text", required: true } }, run: async (_c, _r, i) => ({ set: { paused_at: (/* @__PURE__ */ new Date()).toISOString(), triage_reason: i.triage_reason } }) },
      resume: {
        from: ["ON_HOLD"],
        to: "TRIAGED",
        permission: Permission20.SERVICE_MANAGE,
        run: async (ctx, row) => {
          const h = await businessHours(ctx.tx, ctx.org);
          const paused = businessMinutesBetween(new Date(row.paused_at), /* @__PURE__ */ new Date(), h);
          return { set: { paused_at: null, paused_minutes: Number(row.paused_minutes) + paused } };
        }
      },
      resolve: {
        from: ["SCHEDULED", "IN_PROGRESS", "TRIAGED"],
        to: "RESOLVED",
        permission: Permission20.SERVICE_MANAGE,
        fields: { resolution_summary: { type: "text", required: true } },
        run: async (ctx, row, i) => {
          const open = (await ctx.tx.query(`SELECT COUNT(*)::int n FROM srv_work_orders WHERE case_id = $1 AND status IN ('SCHEDULED','DISPATCHED','IN_PROGRESS')`, [row.id])).rows[0].n;
          if (open)
            throw new ApiError(409, ErrorCode30.INVALID_STATE, `${open} work order(s) are still open`);
          return { set: { resolution_summary: i.resolution_summary, resolved_at: (/* @__PURE__ */ new Date()).toISOString() } };
        }
      },
      close: {
        from: ["RESOLVED"],
        to: "CLOSED",
        permission: Permission20.SERVICE_MANAGE,
        run: async (ctx, row) => {
          const unbilled = (await ctx.tx.query(`SELECT COUNT(*)::int n FROM srv_work_orders WHERE case_id = $1 AND status = 'COMPLETED'`, [row.id])).rows[0].n;
          if (unbilled)
            throw new ApiError(409, ErrorCode30.INVALID_STATE, `${unbilled} completed work order(s) are not billed yet`);
        }
      },
      cancel: { from: ["NEW", "TRIAGED", "ON_HOLD"], to: "CANCELLED", permission: Permission20.SERVICE_MANAGE, fields: { triage_reason: { type: "text", required: true } }, run: async (_c, _r, i) => ({ set: { triage_reason: i.triage_reason } }) }
    }
  });
  defineResource(app, {
    path: "/api/srv/work-orders",
    table: "srv_work_orders",
    label: "Work order",
    event: "SERVICE_WORK_ORDER",
    module: "SRV",
    view: VIEW5,
    create: Permission20.SERVICE_DISPATCH,
    update: Permission20.SERVICE_DISPATCH,
    fields: {
      case_id: { type: "ref", table: "srv_cases", required: true, label: "case_id" },
      instructions: { type: "text" },
      checklist: { type: "json" }
    },
    editable: ["instructions", "checklist"],
    editableIn: ["SCHEDULED", "DISPATCHED"],
    numbering: { column: "number", prefix: "SWO" },
    initialStatus: "SCHEDULED",
    select: `t.*, c.number AS case_number, c.title AS case_title, c.priority, c.site_address, p.name AS party_name, tech.name AS technician_name`,
    joins: "JOIN srv_cases c ON c.id = t.case_id JOIN parties p ON p.id = c.party_id LEFT JOIN srv_technicians tech ON tech.id = t.technician_id",
    search: ["number", "c.number", "c.title", "p.name", "tech.name"],
    filters: ["technician_id", "case_id"],
    orderBy: "t.scheduled_start NULLS LAST, t.created_at DESC",
    detail: async (q, row) => {
      const ch = await woChildren(q, row.id);
      const pending_hash = signoffHash(row, ch.parts, ch.time, ch.extras);
      return { ...ch, signoff_valid: row.signoff_hash ? row.signoff_hash === pending_hash : null };
    },
    beforeCreate: async (ctx, v) => {
      const c = await loadRow(ctx.tx, "srv_cases", v.case_id, ctx.org, "Case", true);
      if (["RESOLVED", "CLOSED", "CANCELLED"].includes(c.status))
        throw new ApiError(409, ErrorCode30.INVALID_STATE, `Case ${c.number} is ${c.status}`);
      const checklist = v.checklist ? JSON.parse(v.checklist) : [
        { item: "Isolate power / confirm safe work area", mandatory: true, done: false },
        { item: "Check refrigerant pressure & leaks", mandatory: true, done: false },
        { item: "Clean filters and coils", mandatory: false, done: false },
        { item: "Test run & record supply air temperature", mandatory: true, done: false }
      ];
      if (!Array.isArray(checklist) || checklist.some((x) => !x || typeof x.item !== "string"))
        throw validationError("checklist must be a list of {item, mandatory}", { field: "checklist" });
      v.checklist = JSON.stringify(checklist.map((x) => ({ item: String(x.item).slice(0, 200), mandatory: !!x.mandatory, done: false })));
      if (c.contract_id) {
        const k = await loadRow(ctx.tx, "srv_contracts", c.contract_id, ctx.org, "Contract");
        v.warranty_covered = k.status === "ACTIVE" && todayIso() <= toIsoDate(k.end_date) && (k.covers_labour || k.covers_parts);
      }
      if (c.status === "NEW" || c.status === "TRIAGED")
        await ctx.tx.query(`UPDATE srv_cases SET status = 'SCHEDULED', first_response_at = COALESCE(first_response_at, NOW()), updated_at = NOW() WHERE id = $1`, [c.id]);
    },
    commands: {
      // SRV-005: hard capacity conflict — a technician cannot hold two overlapping jobs.
      dispatch: {
        from: ["SCHEDULED", "DISPATCHED"],
        to: "DISPATCHED",
        permission: Permission20.SERVICE_DISPATCH,
        fields: { technician_id: { type: "ref", table: "srv_technicians", required: true, label: "technician_id" }, scheduled_start: { type: "datetime", required: true }, scheduled_end: { type: "datetime", required: true } },
        run: async (ctx, row, i) => {
          const start = new Date(i.scheduled_start);
          const end = new Date(i.scheduled_end);
          if (end <= start)
            throw validationError("scheduled_end must be after scheduled_start", { field: "scheduled_end" });
          if (end.getTime() - start.getTime() > 12 * 36e5)
            throw validationError("A visit window cannot exceed 12 hours", { field: "scheduled_end" });
          const tech = (await ctx.tx.query(`SELECT * FROM srv_technicians WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [i.technician_id, ctx.org])).rows[0];
          if (tech.status !== "ACTIVE")
            throw new ApiError(409, ErrorCode30.INVALID_STATE, `${tech.name} is inactive`);
          const others = await ctx.tx.query(`SELECT number, scheduled_start, scheduled_end FROM srv_work_orders WHERE organization_id = $1 AND technician_id = $2 AND id <> $3 AND status IN ('DISPATCHED','IN_PROGRESS') AND scheduled_start IS NOT NULL`, [ctx.org, tech.id, row.id]);
          const clash = others.rows.find((o) => overlaps(start, end, new Date(o.scheduled_start), new Date(o.scheduled_end)));
          if (clash)
            throw new ApiError(409, ErrorCode30.CAPACITY_CONFLICT, `${tech.name} is already booked on ${clash.number} in that window`, { conflicting_work_order: clash.number });
          return { set: { technician_id: tech.id, scheduled_start: start.toISOString(), scheduled_end: end.toISOString() } };
        }
      },
      start: {
        from: ["DISPATCHED"],
        to: "IN_PROGRESS",
        permission: [Permission20.SERVICE_EXECUTE, Permission20.SERVICE_MANAGE],
        run: async (ctx, row) => {
          await assertTechScope(ctx, row);
          await ctx.tx.query(`UPDATE srv_cases SET status = 'IN_PROGRESS', updated_at = NOW() WHERE id = $1 AND status IN ('SCHEDULED','TRIAGED')`, [row.case_id]);
          return { set: { started_at: (/* @__PURE__ */ new Date()).toISOString() } };
        }
      },
      checklist: {
        from: ["IN_PROGRESS"],
        permission: [Permission20.SERVICE_EXECUTE, Permission20.SERVICE_MANAGE],
        fields: { index: { type: "int", required: true, min: 0, max: 100 }, done: { type: "bool" } },
        run: async (ctx, row, i) => {
          await assertTechScope(ctx, row);
          const list = (typeof row.checklist === "string" ? JSON.parse(row.checklist) : row.checklist) || [];
          if (!list[i.index])
            throw validationError("No such checklist item", { field: "index" });
          list[i.index].done = i.done;
          return { set: { checklist: JSON.stringify(list), signoff_hash: null, signed_at: null, customer_signoff_name: null } };
        }
      },
      signoff: {
        from: ["IN_PROGRESS"],
        permission: [Permission20.SERVICE_EXECUTE, Permission20.SERVICE_MANAGE],
        fields: { customer_signoff_name: { type: "string", required: true, max: 255 } },
        run: async (ctx, row, i) => {
          await assertTechScope(ctx, row);
          const ch = await woChildren(ctx.tx, row.id);
          return { set: { customer_signoff_name: i.customer_signoff_name, signed_at: (/* @__PURE__ */ new Date()).toISOString(), signoff_hash: signoffHash(row, ch.parts, ch.time, ch.extras) } };
        }
      },
      complete: {
        from: ["IN_PROGRESS"],
        to: "COMPLETED",
        permission: [Permission20.SERVICE_EXECUTE, Permission20.SERVICE_MANAGE],
        fields: { resolution_notes: { type: "text", required: true } },
        run: async (ctx, row, i) => {
          await assertTechScope(ctx, row);
          const list = (typeof row.checklist === "string" ? JSON.parse(row.checklist) : row.checklist) || [];
          const missing = list.filter((x) => x.mandatory && !x.done).map((x) => x.item);
          if (missing.length)
            throw new ApiError(409, ErrorCode30.CHECKLIST_INCOMPLETE, `Mandatory checks not done: ${missing.join("; ")}`, { missing });
          const ch = await woChildren(ctx.tx, row.id);
          if (!row.signoff_hash)
            throw new ApiError(409, ErrorCode30.INVALID_STATE, "Customer sign-off is required before completion");
          if (row.signoff_hash !== signoffHash(row, ch.parts, ch.time, ch.extras))
            throw new ApiError(409, ErrorCode30.STALE_REVISION, "Work changed after the customer signed; capture sign-off again");
          if (!ch.time.some((t) => t.status !== "REJECTED"))
            throw new ApiError(409, ErrorCode30.INVALID_STATE, "Log the time spent before completing");
          return { set: { resolution_notes: i.resolution_notes, completed_at: (/* @__PURE__ */ new Date()).toISOString() } };
        }
      },
      cancel: { from: ["SCHEDULED", "DISPATCHED"], to: "CANCELLED", permission: Permission20.SERVICE_DISPATCH },
      // SRV-017 / SRV-012: bill approved labour, chargeable parts and accepted extras once.
      bill: {
        from: ["COMPLETED"],
        to: "BILLED",
        permission: Permission20.SERVICE_BILL,
        fields: { invoice_date: { type: "date", required: true } },
        run: async (ctx, row, i) => {
          const c = await loadRow(ctx.tx, "srv_cases", row.case_id, ctx.org, "Case");
          const contract = c.contract_id ? await loadRow(ctx.tx, "srv_contracts", c.contract_id, ctx.org, "Contract") : null;
          const coveredOn = (d) => !!contract && contract.status === "ACTIVE" && d >= toIsoDate(contract.start_date) && d <= toIsoDate(contract.end_date);
          const workDate = toIsoDate(row.completed_at || /* @__PURE__ */ new Date());
          const labourCovered = coveredOn(workDate) && contract.covers_labour;
          const partsCovered = coveredOn(workDate) && contract.covers_parts;
          const ch = await woChildren(ctx.tx, row.id);
          const pendingTime = ch.time.filter((t) => t.status === "LOGGED");
          if (pendingTime.length)
            throw new ApiError(409, ErrorCode30.INVALID_STATE, `${pendingTime.length} time entr${pendingTime.length === 1 ? "y" : "ies"} still awaiting approval`);
          const rate = String(await getSetting(ctx.tx, ctx.org, "service.default_labour_rate"));
          const taxRate = "18";
          const labourItem = (await ctx.tx.query(`SELECT id FROM items WHERE organization_id = $1 AND code = 'SRV-LABOUR'`, [ctx.org])).rows[0];
          if (!labourItem)
            throw new ApiError(400, ErrorCode30.MAPPING_MISSING, "Service labour item SRV-LABOUR is not configured");
          const lines = [];
          const billableMin = ch.time.filter((t) => t.status === "APPROVED" && t.billable).reduce((a, t) => a + Number(t.minutes), 0);
          if (billableMin > 0 && !labourCovered)
            lines.push({ item_id: labourItem.id, description: `Labour ${row.number} (${(billableMin / 60).toFixed(2)} h)`, quantity: new Money20(billableMin).div(60).round(4).toFixed(4), unit_price: rate, tax_rate: taxRate, revenue_account_code: "411002" });
          for (const p of ch.parts)
            if (p.chargeable && !partsCovered)
              lines.push({ item_id: p.item_id, description: `${p.item_code} ${p.item_name}`, quantity: new Money20(p.quantity).toFixed(4), unit_price: new Money20(p.unit_price).toFixed(2), tax_rate: taxRate, revenue_account_code: "411001" });
          for (const e of ch.extras)
            if (e.status === "ACCEPTED")
              lines.push({ item_id: labourItem.id, description: `Additional work: ${e.description}`, quantity: "1", unit_price: new Money20(e.amount).toFixed(2), tax_rate: taxRate, revenue_account_code: "411002" });
          const inv = lines.length ? await createPostedSourceInvoice(ctx, { party_id: c.party_id, invoice_date: i.invoice_date, lines, sourceType: "SERVICE_WORK_ORDER", sourceId: row.id, sourceKey: `SRV_WO_BILL:${row.id}`, notes: `Service ${c.number} / ${row.number}`, purpose: AccountingPurpose14.SERVICE_INVOICE }) : null;
          if (contract && coveredOn(workDate))
            await ctx.tx.query(`UPDATE srv_contracts SET visits_used = visits_used + 1 WHERE id = $1`, [contract.id]);
          return { set: { ar_invoice_id: inv?.id ?? null, billed_amount: inv?.total_amount ?? "0" }, data: inv || { invoice_number: null, total_amount: "0.00", note: "Fully covered by warranty/contract \u2014 nothing to invoice" } };
        }
      }
    }
  });
  app.post("/api/srv/work-orders/:id/parts", authenticate, requireAnyPermission(Permission20.SERVICE_EXECUTE, Permission20.SERVICE_MANAGE), requireModule("SRV"), async (req, res) => {
    const out = await unitOfWork(req, async (ctx) => {
      const wo = await loadRow(ctx.tx, "srv_work_orders", req.params.id, ctx.org, "Work order", true);
      await assertTechScope(ctx, wo);
      if (wo.status !== "IN_PROGRESS")
        throw new ApiError(409, ErrorCode30.INVALID_STATE, `Parts can only be issued while the job is in progress (status ${wo.status})`);
      const issueKey = str(req.body?.issue_key, "issue_key", { max: 120 });
      const existing = (await ctx.tx.query(`SELECT * FROM srv_work_order_parts WHERE organization_id = $1 AND issue_key = $2`, [ctx.org, issueKey])).rows[0];
      if (existing) {
        if (existing.work_order_id !== wo.id)
          throw new ApiError(409, ErrorCode30.IDEMPOTENCY_CONFLICT, "issue_key already used on another work order");
        return { ...existing, replayed: true };
      }
      const qty = decimal(req.body?.quantity, "quantity", { sign: "positive", scale: 4 });
      const items = await lockItems(ctx.tx, ctx.org, [String(req.body?.item_id)]);
      const item = items.get(String(req.body?.item_id));
      if (item.item_type !== "INVENTORY")
        throw validationError("Only stocked items can be issued as parts", { field: "item_id" });
      const wh = typeof req.body?.warehouse_id === "string" && (await loadRow(ctx.tx, "warehouses", req.body.warehouse_id, ctx.org, "Warehouse")).id || await defaultWarehouseId(ctx.tx, ctx.org);
      const date = todayIso();
      const mv = await postStockMovement(ctx.tx, { organizationId: ctx.org, legalEntityId: ctx.le, itemId: item.id, warehouseId: wh, movementType: "SERVICE_ISSUE", movementDate: date, quantity: new Money20(qty).negated().toFixed(8), unitCost: String(item.unit_cost), referenceType: "SERVICE_WORK_ORDER", referenceId: wo.id, description: `Parts for ${wo.number}` });
      const value = new Money20(mv.total_value).abs().round(2);
      const chargeable = req.body?.chargeable === void 0 ? true : bool(req.body.chargeable);
      const cost = value.isPositive() ? await postJournal(ctx.tx, auditLogger, outboxService, {
        organizationId: ctx.org,
        legalEntityId: ctx.le,
        userId: ctx.user,
        postingDate: date,
        purpose: AccountingPurpose14.SERVICE_PARTS_ISSUE,
        description: `Service parts ${wo.number} ${item.code}`,
        sourceType: "SERVICE_PART",
        sourceId: wo.id,
        sourceKey: `SRV_PART:${issueKey}`,
        numberPrefix: "JV-SRV",
        correlationId: ctx.req.correlationId,
        lines: [
          { account_code: wo.warranty_covered ? "521013" : "511001", debit: value.toFixed(8), description: `${wo.warranty_covered ? "Warranty" : "Service"} parts ${item.code}` },
          { account_code: "113001", credit: value.toFixed(8), description: `Stock issued ${item.code}` }
        ]
      }) : null;
      const part = (await ctx.tx.query(`INSERT INTO srv_work_order_parts (organization_id, work_order_id, item_id, quantity, unit_cost, unit_price, chargeable, issue_key, stock_movement_id, journal_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [ctx.org, wo.id, item.id, qty, mv.unit_cost, item.unit_price, chargeable, issueKey, mv.id, cost?.journalId ?? null, ctx.user])).rows[0];
      await ctx.tx.query(`UPDATE srv_work_orders SET signoff_hash = NULL, signed_at = NULL, customer_signoff_name = NULL, revision = revision + 1 WHERE id = $1`, [wo.id]);
      await audit2(ctx, "SERVICE_PARTS_ISSUED", "SERVICE_WORK_ORDER", wo.id, void 0, { item: item.code, quantity: qty, issue_key: issueKey });
      await emit(ctx, "SERVICE_PARTS_ISSUED", { id: wo.id, number: wo.number, item_code: item.code, quantity: qty });
      return { ...part, on_hand_after: mv.on_hand_after, replayed: false };
    });
    return ok(req, res, out, out.replayed ? 200 : 201);
  });
  app.post("/api/srv/work-orders/:id/time", authenticate, requireAnyPermission(Permission20.SERVICE_EXECUTE, Permission20.SERVICE_MANAGE), requireModule("SRV"), async (req, res) => {
    const out = await unitOfWork(req, async (ctx) => {
      const wo = await loadRow(ctx.tx, "srv_work_orders", req.params.id, ctx.org, "Work order", true);
      await assertTechScope(ctx, wo);
      if (!["IN_PROGRESS", "COMPLETED"].includes(wo.status))
        throw new ApiError(409, ErrorCode30.INVALID_STATE, `Time can only be logged on started jobs (status ${wo.status})`);
      if (!wo.technician_id)
        throw validationError("Dispatch a technician first");
      const start = new Date(String(req.body?.start_at));
      const end = new Date(String(req.body?.end_at));
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()))
        throw validationError("start_at and end_at must be ISO date-times", { field: "start_at" });
      if (end <= start)
        throw validationError("end_at must be after start_at", { field: "end_at" });
      if (end.getTime() - start.getTime() > 16 * 36e5)
        throw validationError("A single entry cannot exceed 16 hours", { field: "end_at" });
      if (end.getTime() > Date.now() + 5 * 6e4)
        throw validationError("Time cannot be logged in the future", { field: "end_at" });
      await ctx.tx.query(`SELECT 1 FROM srv_technicians WHERE id = $1 FOR UPDATE`, [wo.technician_id]);
      const clash = (await ctx.tx.query(`SELECT te.id, w.number FROM srv_time_entries te JOIN srv_work_orders w ON w.id = te.work_order_id WHERE te.technician_id = $1 AND te.status <> 'REJECTED' AND te.start_at < $3 AND te.end_at > $2`, [wo.technician_id, start.toISOString(), end.toISOString()])).rows[0];
      if (clash)
        throw new ApiError(409, ErrorCode30.OVERLAP_DETECTED, `Overlaps time already logged on ${clash.number}`, { field: "start_at" });
      const minutes = Math.round((end.getTime() - start.getTime()) / 6e4);
      const row = (await ctx.tx.query(`INSERT INTO srv_time_entries (organization_id, work_order_id, technician_id, start_at, end_at, minutes, billable, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [
        ctx.org,
        wo.id,
        wo.technician_id,
        start.toISOString(),
        end.toISOString(),
        minutes,
        req.body?.billable === void 0 ? true : bool(req.body.billable),
        ctx.user
      ])).rows[0];
      if (wo.status === "IN_PROGRESS")
        await ctx.tx.query(`UPDATE srv_work_orders SET signoff_hash = NULL, signed_at = NULL, customer_signoff_name = NULL WHERE id = $1`, [wo.id]);
      await audit2(ctx, "SERVICE_TIME_LOGGED", "SERVICE_WORK_ORDER", wo.id, void 0, { minutes });
      return row;
    });
    return ok(req, res, out, 201);
  });
  for (const [action, status] of [["approve", "APPROVED"], ["reject", "REJECTED"]]) {
    app.post(`/api/srv/time/:id/${action}`, authenticate, requireAnyPermission(Permission20.SERVICE_MANAGE), requireModule("SRV"), async (req, res) => {
      const out = await unitOfWork(req, async (ctx) => {
        const te = (await ctx.tx.query(`SELECT * FROM srv_time_entries WHERE id::text = $1 AND organization_id = $2 FOR UPDATE`, [req.params.id, ctx.org])).rows[0];
        if (!te)
          throw notFound("Time entry");
        if (te.status !== "LOGGED")
          throw new ApiError(409, ErrorCode30.INVALID_STATE, `Time entry is already ${te.status}`);
        if (te.created_by === ctx.user)
          throw new ApiError(403, ErrorCode30.SEGREGATION_OF_DUTIES, "You cannot approve time you logged yourself");
        const r = (await ctx.tx.query(`UPDATE srv_time_entries SET status = $2, approved_by = $3 WHERE id = $1 RETURNING *`, [te.id, status, ctx.user])).rows[0];
        await audit2(ctx, `SERVICE_TIME_${status}`, "SERVICE_TIME", te.id, { status: "LOGGED" }, { status });
        return r;
      });
      return ok(req, res, out);
    });
  }
  app.post("/api/srv/work-orders/:id/extras", authenticate, requireAnyPermission(Permission20.SERVICE_EXECUTE, Permission20.SERVICE_MANAGE), requireModule("SRV"), async (req, res) => {
    const out = await unitOfWork(req, async (ctx) => {
      const wo = await loadRow(ctx.tx, "srv_work_orders", req.params.id, ctx.org, "Work order", true);
      await assertTechScope(ctx, wo);
      if (wo.status !== "IN_PROGRESS")
        throw new ApiError(409, ErrorCode30.INVALID_STATE, "Extra work can only be proposed on a job in progress");
      const r = (await ctx.tx.query(`INSERT INTO srv_extra_work (organization_id, work_order_id, description, amount, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [ctx.org, wo.id, str(req.body?.description, "description", { max: 500 }), decimal(req.body?.amount, "amount", { sign: "positive", scale: 2 }), ctx.user])).rows[0];
      await audit2(ctx, "SERVICE_EXTRA_PROPOSED", "SERVICE_WORK_ORDER", wo.id, void 0, { description: r.description, amount: r.amount });
      return r;
    });
    return ok(req, res, out, 201);
  });
  app.post("/api/srv/extras/:id/decide", authenticate, requireAnyPermission(Permission20.SERVICE_EXECUTE, Permission20.SERVICE_MANAGE), requireModule("SRV"), async (req, res) => {
    const out = await unitOfWork(req, async (ctx) => {
      const ex = (await ctx.tx.query(`SELECT * FROM srv_extra_work WHERE id::text = $1 AND organization_id = $2 FOR UPDATE`, [req.params.id, ctx.org])).rows[0];
      if (!ex)
        throw notFound("Extra work");
      const wo = await loadRow(ctx.tx, "srv_work_orders", ex.work_order_id, ctx.org, "Work order", true);
      await assertTechScope(ctx, wo);
      if (ex.status !== "PROPOSED")
        throw new ApiError(409, ErrorCode30.INVALID_STATE, `Already ${ex.status}`);
      const accept = bool(req.body?.accept);
      const name = accept ? str(req.body?.accepted_by_name, "accepted_by_name", { max: 255 }) : null;
      const r = (await ctx.tx.query(`UPDATE srv_extra_work SET status = $2, accepted_by_name = $3, decided_at = NOW() WHERE id = $1 RETURNING *`, [ex.id, accept ? "ACCEPTED" : "DECLINED", name])).rows[0];
      await ctx.tx.query(`UPDATE srv_work_orders SET signoff_hash = NULL, signed_at = NULL, customer_signoff_name = NULL WHERE id = $1`, [wo.id]);
      await audit2(ctx, accept ? "SERVICE_EXTRA_ACCEPTED" : "SERVICE_EXTRA_DECLINED", "SERVICE_WORK_ORDER", wo.id, void 0, { extra: ex.id, by: name });
      return r;
    });
    return ok(req, res, out);
  });
  app.get("/api/srv/time", authenticate, requireAnyPermission(...VIEW5), async (req, res) => {
    const status = typeof req.query.status === "string" && req.query.status ? req.query.status : null;
    const r = await db.query(`SELECT te.*, w.number AS work_order_number, t.name AS technician_name, u.name AS logged_by FROM srv_time_entries te JOIN srv_work_orders w ON w.id = te.work_order_id JOIN srv_technicians t ON t.id = te.technician_id LEFT JOIN users u ON u.id = te.created_by
       WHERE te.organization_id = $1 AND ($2::text IS NULL OR te.status = $2) ORDER BY te.start_at DESC LIMIT 300`, [req.session.organization_id, status]);
    return ok(req, res, r.rows.map((x) => ({ ...x, hours: (x.minutes / 60).toFixed(2) })));
  });
  app.get("/api/srv/board", authenticate, requireAnyPermission(...VIEW5), async (req, res) => {
    const org = req.session.organization_id;
    const off = await orgOffset(db, org);
    const localToday = new Date(Date.now() + off * 6e4).toISOString().slice(0, 10);
    const day = typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : localToday;
    const from = new Date(Date.parse(`${day}T00:00:00${fmtOffset(off)}`)).toISOString();
    const to = new Date(Date.parse(`${day}T00:00:00${fmtOffset(off)}`) + 864e5).toISOString();
    const techs = (await db.query(`SELECT id, code, name, skills, zone FROM srv_technicians WHERE organization_id = $1 AND status = 'ACTIVE' ORDER BY name`, [org])).rows;
    const jobs = (await db.query(`SELECT w.id, w.number, w.status, w.technician_id, w.scheduled_start, w.scheduled_end, c.number AS case_number, c.title, c.priority, p.name AS party_name, c.site_address
         FROM srv_work_orders w JOIN srv_cases c ON c.id = w.case_id JOIN parties p ON p.id = c.party_id
         WHERE w.organization_id = $1 AND w.status <> 'CANCELLED' AND w.scheduled_start < $3 AND w.scheduled_end > $2 ORDER BY w.scheduled_start`, [org, from, to])).rows;
    const unassigned = (await db.query(`SELECT w.id, w.number, w.status, c.number AS case_number, c.title, c.priority, p.name AS party_name FROM srv_work_orders w JOIN srv_cases c ON c.id = w.case_id JOIN parties p ON p.id = c.party_id
         WHERE w.organization_id = $1 AND w.status = 'SCHEDULED' AND w.technician_id IS NULL ORDER BY c.priority, w.created_at`, [org])).rows;
    return ok(req, res, { date: day, technicians: techs.map((t) => ({ ...t, jobs: jobs.filter((j) => j.technician_id === t.id) })), unassigned });
  });
  app.get("/api/srv/summary", authenticate, requireAnyPermission(...VIEW5), async (req, res) => {
    const org = req.session.organization_id;
    const r = (await db.query(`SELECT
          COUNT(*) FILTER (WHERE status NOT IN ('RESOLVED','CLOSED','CANCELLED'))::int AS open_cases,
          COUNT(*) FILTER (WHERE status NOT IN ('RESOLVED','CLOSED','CANCELLED') AND paused_at IS NULL AND resolution_due_at + (paused_minutes || ' minutes')::interval < NOW())::int AS breached,
          COUNT(*) FILTER (WHERE resolved_at IS NOT NULL)::int AS resolved,
          COUNT(*) FILTER (WHERE resolved_at IS NOT NULL AND resolved_at <= resolution_due_at + (paused_minutes || ' minutes')::interval)::int AS resolved_in_sla,
          COUNT(*) FILTER (WHERE priority = 'CRITICAL' AND status NOT IN ('RESOLVED','CLOSED','CANCELLED'))::int AS critical_open
         FROM srv_cases WHERE organization_id = $1`, [org])).rows[0];
    const ftf = (await db.query(`SELECT COUNT(*)::int AS cases, COUNT(*) FILTER (WHERE n = 1)::int AS first_time FROM (SELECT c.id, COUNT(w.id) n FROM srv_cases c JOIN srv_work_orders w ON w.case_id = c.id AND w.status IN ('COMPLETED','BILLED') WHERE c.organization_id = $1 AND c.resolved_at IS NOT NULL GROUP BY c.id) x`, [org])).rows[0];
    const unbilled = (await db.query(`SELECT COUNT(*)::int n FROM srv_work_orders WHERE organization_id = $1 AND status = 'COMPLETED'`, [org])).rows[0].n;
    return ok(req, res, {
      ...r,
      sla_attainment_pct: r.resolved ? (r.resolved_in_sla / r.resolved * 100).toFixed(1) : null,
      first_time_fix_pct: ftf.cases ? (ftf.first_time / ftf.cases * 100).toFixed(1) : null,
      first_time_fix_basis: `${ftf.first_time} of ${ftf.cases} resolved cases fixed in one visit`,
      unbilled_work_orders: unbilled
    });
  });
  app.post("/api/srv/contracts/generate-pm", authenticate, requireAnyPermission(Permission20.SERVICE_MANAGE), requireModule("SRV", "create"), async (req, res) => {
    const asOf = typeof req.body?.as_of === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.body.as_of) ? req.body.as_of : todayIso();
    const out = await unitOfWork(req, (ctx) => generatePreventive(ctx.tx, ctx.org, ctx.le, ctx.user, asOf));
    return ok(req, res, out);
  });
}
async function generatePreventive(q, org, le, userId, asOf) {
  const { nextDocumentNumber: nextDocumentNumber2 } = await Promise.resolve().then(() => (init_numbering(), numbering_exports));
  const due = await q.query(`SELECT * FROM srv_contracts WHERE organization_id = $1 AND status = 'ACTIVE' AND pm_interval_months IS NOT NULL AND next_pm_date IS NOT NULL AND next_pm_date <= $2 AND next_pm_date <= end_date FOR UPDATE`, [org, asOf]);
  const created = [];
  let skipped = 0;
  for (const c of due.rows) {
    const pmDate = toIsoDate(c.next_pm_date);
    const exists = await q.query(`SELECT 1 FROM srv_cases WHERE contract_id = $1 AND pm_due_date = $2`, [c.id, pmDate]);
    const d = /* @__PURE__ */ new Date(`${pmDate}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + c.pm_interval_months);
    await q.query(`UPDATE srv_contracts SET next_pm_date = $2, updated_at = NOW() WHERE id = $1`, [c.id, d.toISOString().slice(0, 10)]);
    if (exists.rows.length) {
      skipped++;
      continue;
    }
    const number = await nextDocumentNumber2(q, org, "SRV");
    const h = await businessHours(q, org);
    const start = /* @__PURE__ */ new Date(`${pmDate}T04:00:00Z`);
    await q.query(`INSERT INTO srv_cases (organization_id, legal_entity_id, number, party_id, contract_id, channel, title, category, priority, site_address, status, response_due_at, resolution_due_at, pm_due_date, created_by)
       VALUES ($1,$2,$3,$4,$5,'PREVENTIVE',$6,'MAINTENANCE','MEDIUM',$7,'NEW',$8,$9,$10,$11)`, [org, le, number, c.party_id, c.id, `Preventive maintenance \u2014 ${c.title}`, c.site_address, addBusinessMinutes(start, c.response_hours * 60, h).toISOString(), addBusinessMinutes(start, c.resolution_hours * 60, h).toISOString(), pmDate, userId]);
    await outboxService.emit({ organization_id: org, event_type: "SERVICE_CASE_CREATED", payload: { number, channel: "PREVENTIVE", priority: "MEDIUM", contract: c.number } }, q);
    created.push(number);
  }
  return { as_of: asOf, created, skipped_duplicates: skipped };
}
var VIEW5, PRIORITY_FACTOR, DEFAULT_RESPONSE_H, fmtOffset;
var init_service = __esm({
  "apps/api/dist/routes/service.js"() {
    "use strict";
    init_context();
    init_http();
    init_errors();
    init_resource();
    init_validate();
    init_modules();
    init_stock();
    init_posting();
    init_ar_invoice();
    init_config();
    init_sla();
    VIEW5 = [Permission20.SERVICE_VIEW, Permission20.SERVICE_MANAGE, Permission20.SERVICE_EXECUTE];
    PRIORITY_FACTOR = { CRITICAL: 0.25, HIGH: 0.5, MEDIUM: 1, LOW: 2 };
    DEFAULT_RESPONSE_H = { CRITICAL: 2, HIGH: 4, MEDIUM: 8, LOW: 24 };
    fmtOffset = (m) => `${m < 0 ? "-" : "+"}${String(Math.floor(Math.abs(m) / 60)).padStart(2, "0")}:${String(Math.abs(m) % 60).padStart(2, "0")}`;
  }
});

// apps/api/dist/routes/crm.js
var crm_exports = {};
__export(crm_exports, {
  STAGES: () => STAGES,
  STAGE_PROBABILITY: () => STAGE_PROBABILITY,
  normEmail: () => normEmail,
  normPhone: () => normPhone,
  registerCrmRoutes: () => registerCrmRoutes,
  weightedForecast: () => weightedForecast
});
import crypto21 from "node:crypto";
import { Permission as Permission24, ErrorCode as ErrorCode33 } from "@omnysync/contracts";
import { Money as Money25 } from "@omnysync/financial-engine";
function normPhone(p) {
  if (!p)
    return null;
  let d = p.replace(/\D/g, "");
  if (d.startsWith("0092"))
    d = d.slice(4);
  else if (d.startsWith("92") && d.length === 12)
    d = d.slice(2);
  else if (d.startsWith("0"))
    d = d.slice(1);
  return d.length >= 7 ? d : null;
}
function weightedForecast(rows) {
  return rows.reduce((a, r) => a.add(new Money25(r.amount).mul(r.probability).div(100)), Money25.zero()).round(2).toFixed(2);
}
async function findDuplicate(ctx, email, phone, excludeId) {
  if (!email && !phone)
    return null;
  const r = await ctx.tx.query(`SELECT id, number, name, status FROM crm_leads WHERE organization_id = $1 AND status <> 'DISQUALIFIED' AND ($4::uuid IS NULL OR id <> $4)
       AND ((email_norm IS NOT NULL AND email_norm = $2) OR (phone_norm IS NOT NULL AND phone_norm = $3)) LIMIT 1`, [ctx.org, email, phone, excludeId ?? null]);
  return r.rows[0] || null;
}
function registerCrmRoutes(app) {
  defineResource(app, {
    path: "/api/crm/leads",
    table: "crm_leads",
    label: "Lead",
    event: "CRM_LEAD",
    module: "CRM",
    view: VIEW6,
    create: Permission24.CRM_MANAGE,
    update: Permission24.CRM_MANAGE,
    fields: {
      name: { type: "string", required: true },
      company: { type: "string" },
      email: { type: "string", pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
      phone: { type: "string", max: 40 },
      source: { type: "enum", values: ["WEBSITE", "REFERRAL", "WALK_IN", "PHONE", "SOCIAL", "PARTNER", "EVENT", "OTHER"], default: "WEBSITE" },
      interest: { type: "text" },
      city: { type: "string", max: 80 },
      estimated_value: { type: "decimal", default: "0", scale: 2 }
    },
    editable: ["name", "company", "email", "phone", "interest", "city", "estimated_value"],
    editableIn: ["NEW", "CONTACTED", "QUALIFIED"],
    numbering: { column: "number", prefix: "LEAD" },
    initialStatus: "NEW",
    search: ["number", "name", "company", "email", "phone", "city"],
    filters: ["source"],
    beforeCreate: async (ctx, v) => {
      v.email_norm = normEmail(v.email);
      v.phone_norm = normPhone(v.phone);
      if (!v.email_norm && !v.phone_norm)
        throw validationError("Provide an email or a phone number so the lead can be contacted", { field: "email" });
      const dup = await findDuplicate(ctx, v.email_norm, v.phone_norm);
      if (dup && !ctx.req.body?.allow_duplicate) {
        throw new ApiError(409, ErrorCode33.DUPLICATE_RESOURCE, `Possible duplicate of ${dup.number} (${dup.name}, ${dup.status})`, { existing_id: dup.id, existing_number: dup.number });
      }
      v.owner_user_id = ctx.user;
    },
    beforeUpdate: async (ctx, row, v) => {
      if (v.email !== void 0)
        v.email_norm = normEmail(v.email);
      if (v.phone !== void 0)
        v.phone_norm = normPhone(v.phone);
      const dup = await findDuplicate(ctx, v.email_norm ?? row.email_norm, v.phone_norm ?? row.phone_norm, row.id);
      if (dup)
        throw new ApiError(409, ErrorCode33.DUPLICATE_RESOURCE, `Would duplicate ${dup.number} (${dup.name})`, { existing_id: dup.id });
    },
    commands: {
      contact: { from: ["NEW"], to: "CONTACTED", permission: Permission24.CRM_MANAGE },
      qualify: { from: ["NEW", "CONTACTED"], to: "QUALIFIED", permission: Permission24.CRM_MANAGE },
      disqualify: { from: ["NEW", "CONTACTED", "QUALIFIED"], to: "DISQUALIFIED", permission: Permission24.CRM_MANAGE, fields: { disqualify_reason: { type: "text", required: true } }, run: async (_c, _r, i) => ({ set: { disqualify_reason: i.disqualify_reason } }) },
      // Conversion is atomic: customer (reused when email/phone match an existing party) + opportunity.
      convert: {
        from: ["QUALIFIED"],
        to: "CONVERTED",
        permission: Permission24.CRM_MANAGE,
        fields: { opportunity_name: { type: "string", required: true }, amount: { type: "decimal", scale: 2 }, expected_close_date: { type: "date" }, party_id: { type: "ref", table: "parties", label: "party_id" } },
        run: async (ctx, lead, i) => {
          let partyId = i.party_id;
          let reused = !!partyId;
          if (!partyId) {
            const match = await ctx.tx.query(`SELECT id FROM parties WHERE organization_id = $1 AND party_type IN ('CUSTOMER','BOTH') AND ((email IS NOT NULL AND lower(email) = $2) OR (phone IS NOT NULL AND regexp_replace(phone, '\\D', '', 'g') LIKE '%' || $3)) LIMIT 1`, [ctx.org, lead.email_norm, lead.phone_norm || "__none__"]);
            partyId = match.rows[0]?.id ?? null;
            reused = !!partyId;
          }
          if (!partyId) {
            partyId = crypto21.randomUUID();
            const code = await nextDocumentNumber(ctx.tx, ctx.org, "CUST");
            await ctx.tx.query(`INSERT INTO parties (id, organization_id, legal_entity_id, code, name, party_type, email, phone, address) VALUES ($1,$2,$3,$4,$5,'CUSTOMER',$6,$7,$8)`, [
              partyId,
              ctx.org,
              ctx.le,
              code,
              lead.company || lead.name,
              lead.email,
              lead.phone,
              lead.city
            ]);
          }
          const oppId = crypto21.randomUUID();
          const num = await nextDocumentNumber(ctx.tx, ctx.org, "OPP");
          await ctx.tx.query(`INSERT INTO crm_opportunities (id, organization_id, legal_entity_id, number, name, party_id, lead_id, amount, stage, probability, expected_close_date, owner_user_id, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'QUALIFICATION',25,$9,$10,$10)`, [oppId, ctx.org, ctx.le, num, i.opportunity_name, partyId, lead.id, i.amount || lead.estimated_value || "0", i.expected_close_date || null, ctx.user]);
          await ctx.tx.query(`UPDATE crm_activities SET party_id = COALESCE(party_id, $2), opportunity_id = COALESCE(opportunity_id, $3) WHERE lead_id = $1`, [lead.id, partyId, oppId]);
          return { set: { party_id: partyId, opportunity_id: oppId }, data: { party_id: partyId, customer_reused: reused, opportunity_id: oppId, opportunity_number: num } };
        }
      }
    }
  });
  defineResource(app, {
    path: "/api/crm/opportunities",
    table: "crm_opportunities",
    label: "Opportunity",
    event: "CRM_OPPORTUNITY",
    module: "CRM",
    view: VIEW6,
    create: Permission24.CRM_MANAGE,
    update: Permission24.CRM_MANAGE,
    fields: {
      name: { type: "string", required: true },
      party_id: { type: "ref", table: "parties", required: true, label: "party_id" },
      amount: { type: "decimal", default: "0", scale: 2 },
      expected_close_date: { type: "date" }
    },
    editable: ["name", "amount", "expected_close_date"],
    editableIn: ["OPEN"],
    numbering: { column: "number", prefix: "OPP" },
    initialStatus: "OPEN",
    select: `t.*, p.name AS party_name, ROUND(t.amount * t.probability / 100, 2) AS weighted_amount,
      (SELECT COUNT(*)::int FROM crm_activities a WHERE a.opportunity_id = t.id AND a.status = 'OPEN') AS open_activities`,
    joins: "JOIN parties p ON p.id = t.party_id",
    search: ["number", "name", "p.name"],
    filters: ["stage", "party_id"],
    orderBy: "t.expected_close_date NULLS LAST, t.created_at DESC",
    beforeCreate: async (ctx, v) => {
      v.owner_user_id = ctx.user;
    },
    detail: async (q, row) => ({
      activities: (await q.query(`SELECT * FROM crm_activities WHERE opportunity_id = $1 ORDER BY COALESCE(due_at, created_at) DESC`, [row.id])).rows
    }),
    commands: {
      stage: {
        from: ["OPEN"],
        permission: Permission24.CRM_MANAGE,
        fields: { stage: { type: "enum", values: STAGES, required: true }, probability: { type: "int", min: 1, max: 99 } },
        run: async (_c, row, i) => {
          if (i.stage === row.stage && !i.probability)
            throw new ApiError(409, ErrorCode33.INVALID_STATE, `Already in ${row.stage}`);
          return { set: { stage: i.stage, probability: i.probability ?? STAGE_PROBABILITY[i.stage] } };
        }
      },
      win: {
        from: ["OPEN"],
        to: "WON",
        permission: Permission24.CRM_MANAGE,
        fields: { create_install_case: { type: "bool" }, site_address: { type: "text" } },
        run: async (ctx, row, i) => {
          if (!new Money25(row.amount).isPositive())
            throw validationError("Set the deal amount before marking it won", { field: "amount" });
          const set = { stage: "WON", probability: 100, closed_at: (/* @__PURE__ */ new Date()).toISOString() };
          let caseNumber = null;
          if (i.create_install_case) {
            const id = crypto21.randomUUID();
            caseNumber = await nextDocumentNumber(ctx.tx, ctx.org, "SRV");
            await ctx.tx.query(`INSERT INTO srv_cases (id, organization_id, legal_entity_id, number, party_id, channel, title, category, priority, site_address, status, created_by)
               VALUES ($1,$2,$3,$4,$5,'PORTAL',$6,'INSTALLATION','MEDIUM',$7,'NEW',$8)`, [id, ctx.org, ctx.le, caseNumber, row.party_id, `Installation \u2014 ${row.name}`, i.site_address || null, ctx.user]);
            set.service_case_id = id;
          }
          return { set, data: { service_case_number: caseNumber } };
        }
      },
      lose: {
        from: ["OPEN"],
        to: "LOST",
        permission: Permission24.CRM_MANAGE,
        fields: { lost_reason: { type: "enum", values: ["PRICE", "COMPETITOR", "NO_BUDGET", "TIMING", "NO_RESPONSE", "SCOPE", "OTHER"], required: true }, lost_notes: { type: "text" } },
        run: async (_c, _r, i) => {
          if (i.lost_reason === "OTHER" && !i.lost_notes)
            throw validationError("Explain the loss when the reason is OTHER", { field: "lost_notes" });
          return { set: { stage: "LOST", probability: 0, lost_reason: i.lost_reason, lost_notes: i.lost_notes, closed_at: (/* @__PURE__ */ new Date()).toISOString() } };
        }
      },
      reopen: { from: ["LOST"], to: "OPEN", permission: Permission24.CRM_MANAGE, run: async () => ({ set: { stage: "QUALIFICATION", probability: 25, lost_reason: null, lost_notes: null, closed_at: null } }) }
    }
  });
  defineResource(app, {
    path: "/api/crm/activities",
    table: "crm_activities",
    label: "Activity",
    event: "CRM_ACTIVITY",
    module: "CRM",
    view: VIEW6,
    create: Permission24.CRM_MANAGE,
    update: Permission24.CRM_MANAGE,
    fields: {
      activity_type: { type: "enum", values: ["CALL", "MEETING", "EMAIL", "SITE_VISIT", "TASK", "WHATSAPP"], required: true },
      subject: { type: "string", required: true },
      notes: { type: "text" },
      due_at: { type: "datetime" },
      lead_id: { type: "ref", table: "crm_leads", label: "lead_id" },
      opportunity_id: { type: "ref", table: "crm_opportunities", label: "opportunity_id" },
      party_id: { type: "ref", table: "parties", label: "party_id" }
    },
    editable: ["subject", "notes", "due_at"],
    editableIn: ["OPEN"],
    initialStatus: "OPEN",
    select: `t.*, l.name AS lead_name, o.number AS opportunity_number, o.name AS opportunity_name, p.name AS party_name,
      (t.status = 'OPEN' AND t.due_at < NOW()) AS overdue`,
    joins: "LEFT JOIN crm_leads l ON l.id = t.lead_id LEFT JOIN crm_opportunities o ON o.id = t.opportunity_id LEFT JOIN parties p ON p.id = t.party_id",
    search: ["subject", "l.name", "o.name", "p.name"],
    filters: ["activity_type", "lead_id", "opportunity_id"],
    orderBy: `t.status = 'OPEN' DESC, t.due_at NULLS LAST`,
    beforeCreate: async (ctx, v) => {
      if (!v.lead_id && !v.opportunity_id && !v.party_id)
        throw validationError("Link the activity to a lead, opportunity or customer", { field: "lead_id" });
      if (v.opportunity_id) {
        const o = await loadRow(ctx.tx, "crm_opportunities", v.opportunity_id, ctx.org, "Opportunity");
        v.party_id = v.party_id || o.party_id;
      }
    },
    commands: {
      complete: { from: ["OPEN"], to: "DONE", permission: Permission24.CRM_MANAGE, fields: { outcome: { type: "text", required: true } }, run: async (_c, _r, i) => ({ set: { outcome: i.outcome, completed_at: (/* @__PURE__ */ new Date()).toISOString() } }) },
      cancel: { from: ["OPEN"], to: "CANCELLED", permission: Permission24.CRM_MANAGE }
    }
  });
  app.get("/api/crm/summary", authenticate, requireAnyPermission(...VIEW6), async (req, res) => {
    const org = req.session.organization_id;
    const open = (await db.query(`SELECT stage, amount::text, probability FROM crm_opportunities WHERE organization_id = $1 AND status = 'OPEN'`, [org])).rows;
    const byStage = STAGES.map((s) => {
      const rows = open.filter((o) => o.stage === s);
      return { stage: s, count: rows.length, amount: rows.reduce((a, r) => a.add(r.amount), Money25.zero()).toFixed(2), weighted: weightedForecast(rows) };
    });
    const closed = (await db.query(`SELECT COUNT(*) FILTER (WHERE status='WON')::int won, COUNT(*) FILTER (WHERE status='LOST')::int lost, COALESCE(SUM(amount) FILTER (WHERE status='WON' AND closed_at >= date_trunc('month', NOW())),0)::text won_mtd FROM crm_opportunities WHERE organization_id = $1`, [org])).rows[0];
    const leads = (await db.query(`SELECT COUNT(*) FILTER (WHERE status IN ('NEW','CONTACTED','QUALIFIED'))::int open, COUNT(*) FILTER (WHERE status='CONVERTED')::int converted, COUNT(*)::int total FROM crm_leads WHERE organization_id = $1`, [org])).rows[0];
    const overdue = (await db.query(`SELECT COUNT(*)::int n FROM crm_activities WHERE organization_id = $1 AND status = 'OPEN' AND due_at < NOW()`, [org])).rows[0].n;
    const lossReasons = (await db.query(`SELECT lost_reason, COUNT(*)::int n FROM crm_opportunities WHERE organization_id = $1 AND status = 'LOST' GROUP BY lost_reason ORDER BY n DESC`, [org])).rows;
    return ok(req, res, {
      pipeline: byStage,
      pipeline_total: open.reduce((a, r) => a.add(r.amount), Money25.zero()).toFixed(2),
      weighted_forecast: weightedForecast(open),
      win_rate_pct: closed.won + closed.lost ? (closed.won / (closed.won + closed.lost) * 100).toFixed(1) : null,
      won_mtd: new Money25(closed.won_mtd).toFixed(2),
      leads,
      lead_conversion_pct: leads.total ? (leads.converted / leads.total * 100).toFixed(1) : null,
      overdue_activities: overdue,
      loss_reasons: lossReasons
    });
  });
}
var VIEW6, STAGES, STAGE_PROBABILITY, normEmail;
var init_crm = __esm({
  "apps/api/dist/routes/crm.js"() {
    "use strict";
    init_context();
    init_http();
    init_errors();
    init_resource();
    init_numbering();
    VIEW6 = [Permission24.CRM_VIEW, Permission24.CRM_MANAGE];
    STAGES = ["PROSPECTING", "QUALIFICATION", "SITE_SURVEY", "PROPOSAL", "NEGOTIATION"];
    STAGE_PROBABILITY = { PROSPECTING: 10, QUALIFICATION: 25, SITE_SURVEY: 40, PROPOSAL: 60, NEGOTIATION: 80, WON: 100, LOST: 0 };
    normEmail = (e) => e ? e.trim().toLowerCase() : null;
  }
});

// apps/api/dist/app.js
init_http();
import express from "express";
import cors from "cors";
import crypto24 from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// apps/api/dist/automation/keep-alive.js
import http from "node:http";
import https from "node:https";
var lastPingTime = null;
var lastPingStatus = "IDLE";
var lastPingMessage = "Keep-alive service initialized";
var pingCount = 0;
function resolveKeepAliveUrl() {
  const url = process.env.KEEP_ALIVE_URL || process.env.RENDER_EXTERNAL_URL || process.env.APP_URL;
  if (!url)
    return void 0;
  return url.replace(/\/+$/, "");
}
async function sendPing(targetUrl) {
  return new Promise((resolve) => {
    try {
      const pingEndpoint = `${targetUrl}/health`;
      const client = pingEndpoint.startsWith("https") ? https : http;
      const req = client.get(pingEndpoint, {
        headers: {
          "User-Agent": "Omnysync-KeepAlive-Agent/1.0",
          "Accept": "application/json, text/plain, */*"
        },
        timeout: 15e3
      }, (res) => {
        let rawData = "";
        res.on("data", (chunk) => {
          rawData += chunk;
        });
        res.on("end", () => {
          const success = (res.statusCode ?? 500) < 400;
          resolve({
            success,
            statusCode: res.statusCode,
            message: success ? `Keep-alive ping successful (Status: ${res.statusCode})` : `Keep-alive received HTTP ${res.statusCode}: ${rawData.substring(0, 100)}`
          });
        });
      });
      req.on("error", (err) => {
        resolve({
          success: false,
          message: `Keep-alive network error: ${err.message}`
        });
      });
      req.on("timeout", () => {
        req.destroy();
        resolve({
          success: false,
          message: "Keep-alive request timed out after 15s"
        });
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      resolve({ success: false, message: `Failed to dispatch ping: ${msg}` });
    }
  });
}
function getKeepAliveStatus() {
  const targetUrl = resolveKeepAliveUrl();
  return {
    enabled: process.env.KEEP_ALIVE_ENABLED !== "false",
    targetUrl: targetUrl ? `${targetUrl}/health` : null,
    intervalMinutes: Number(process.env.KEEP_ALIVE_INTERVAL_MINUTES || "10"),
    pingCount,
    lastPingTime,
    lastPingStatus,
    lastPingMessage,
    environmentDetected: process.env.RENDER === "true" ? "Render" : "Custom/Local"
  };
}

// apps/api/dist/routes/platform.js
init_context();
init_http();
init_errors();
init_validate();
import { AuthService as AuthService2 } from "@omnysync/platform";
import { ErrorCode as ErrorCode5, Permission } from "@omnysync/contracts";
var LOGIN_WINDOW_MS = 15 * 60 * 1e3;
var LOGIN_MAX_FAILURES = 10;
var loginFailures = /* @__PURE__ */ new Map();
function throttleKey(req, email) {
  let addr = "local";
  try {
    addr = req.ip || req.socket?.remoteAddress || "local";
  } catch {
  }
  return `${email}|${addr}`;
}
function isThrottled(key, now = Date.now()) {
  const rec = loginFailures.get(key);
  if (!rec)
    return false;
  if (now - rec.first > LOGIN_WINDOW_MS) {
    loginFailures.delete(key);
    return false;
  }
  return rec.count >= LOGIN_MAX_FAILURES;
}
function recordFailure(key, now = Date.now()) {
  const rec = loginFailures.get(key);
  if (!rec || now - rec.first > LOGIN_WINDOW_MS)
    loginFailures.set(key, { count: 1, first: now });
  else
    rec.count += 1;
}
function registerPlatformRoutes(app) {
  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password || typeof email !== "string" || typeof password !== "string") {
      throw new ApiError(400, ErrorCode5.VALIDATION_FAILED, "Email and password are required");
    }
    if (email.length > 255 || password.length > 1024) {
      throw new ApiError(400, ErrorCode5.VALIDATION_FAILED, "Email or password too long");
    }
    const normalizedEmail = email.toLowerCase().trim();
    const key = throttleKey(req, normalizedEmail);
    if (isThrottled(key)) {
      throw new ApiError(429, ErrorCode5.RATE_LIMITED, "Too many failed sign-in attempts. Try again later.");
    }
    const userQuery = await db.query(`SELECT u.id, u.email, u.name, u.password_hash, m.organization_id, m.legal_entity_id, m.roles
       FROM users u
       JOIN memberships m ON m.user_id = u.id
       WHERE u.email = $1 AND u.is_active = true AND m.is_active = true
       ORDER BY m.created_at ASC`, [normalizedEmail]);
    const userRow = userQuery.rows[0];
    const valid = userRow ? AuthService2.verifyPassword(password, userRow.password_hash) : (AuthService2.dummyVerify(password), false);
    if (!valid) {
      recordFailure(key);
      throw new ApiError(401, ErrorCode5.UNAUTHENTICATED, "Invalid email or credentials");
    }
    loginFailures.delete(key);
    const roles = typeof userRow.roles === "string" ? JSON.parse(userRow.roles) : userRow.roles;
    const session = {
      user_id: userRow.id,
      email: userRow.email,
      name: userRow.name,
      organization_id: userRow.organization_id,
      legal_entity_id: userRow.legal_entity_id,
      roles,
      permissions: AuthService2.resolvePermissions(roles)
    };
    const token = authService.generateSessionToken(session);
    const claims = authService.verifySessionToken(token);
    await auditLogger.record({
      organization_id: session.organization_id,
      user_id: session.user_id,
      action: "USER_SIGNED_IN",
      entity_type: "USER",
      entity_id: session.user_id,
      correlation_id: req.correlationId
    });
    return ok(req, res, { token, user: session, expires_at: claims?.exp ? new Date(claims.exp * 1e3).toISOString() : null });
  });
  app.get("/api/auth/me", authenticate, (req, res) => {
    return ok(req, res, req.session);
  });
  app.get("/api/orgs/context", authenticate, async (req, res) => {
    const org = req.session.organization_id;
    const orgRes = await db.query("SELECT id, name, code, is_active FROM organizations WHERE id = $1", [org]);
    const leRes = await db.query("SELECT id, name, code, functional_currency, tax_identifier, is_active FROM legal_entities WHERE organization_id = $1", [org]);
    const branchRes = await db.query("SELECT id, name, code, legal_entity_id, is_active FROM branches WHERE organization_id = $1", [org]);
    return ok(req, res, {
      organization: orgRes.rows[0] || null,
      legalEntities: leRes.rows,
      branches: branchRes.rows,
      environment: {
        demo_mode: process.env.NODE_ENV !== "production" || process.env.OMNYSYNC_DEMO_MODE === "true",
        version: "0.2.0"
      }
    });
  });
  app.get("/api/audit/logs", authenticate, requirePermission(Permission.AUDIT_VIEW), async (req, res) => {
    const { limit, offset } = pagination(req.query, { limit: 100, max: 500 });
    const entityType = optionalStr(req.query.entity_type, "entity_type", 100);
    const action = optionalStr(req.query.action, "action", 100);
    const search = optionalStr(req.query.search, "search", 100);
    const params = [req.session.organization_id];
    let where = "a.organization_id = $1";
    if (entityType) {
      params.push(entityType);
      where += ` AND a.entity_type = $${params.length}`;
    }
    if (action) {
      params.push(action);
      where += ` AND a.action = $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      where += ` AND (a.action ILIKE $${params.length} OR a.entity_type ILIKE $${params.length} OR a.entity_id::text ILIKE $${params.length})`;
    }
    const countRes = await db.query(`SELECT COUNT(*)::int AS n FROM audit_logs a WHERE ${where}`, params);
    params.push(limit, offset);
    const logs = await db.query(`SELECT a.*, u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
       WHERE ${where} ORDER BY a.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return ok(req, res, logs.rows, 200, { total_count: countRes.rows[0].n, limit, offset });
  });
}

// apps/api/dist/routes/finance.js
init_context();
init_http();
init_errors();
init_validate();
init_state();
init_scope();
init_numbering();
init_posting();
import crypto3 from "node:crypto";
import { JournalValidator as JournalValidator2, CoaHierarchyValidator, LedgerEngine, JournalReversalEngine, Money } from "@omnysync/financial-engine";
import { ErrorCode as ErrorCode8, Permission as Permission2, JournalStatus, AccountingPurpose } from "@omnysync/contracts";
var PERIOD_TRANSITIONS = {
  OPEN: ["SOFT_CLOSED", "HARD_CLOSED"],
  SOFT_CLOSED: ["OPEN", "HARD_CLOSED"],
  HARD_CLOSED: ["OPEN", "SOFT_CLOSED"]
};
var MANUAL_PURPOSES = [
  AccountingPurpose.MANUAL_JOURNAL,
  AccountingPurpose.OPENING_BALANCE,
  AccountingPurpose.BANK_CHARGE,
  AccountingPurpose.FX_REVALUATION
];
function registerFinanceRoutes(app) {
  app.get("/api/coa/accounts", authenticate, async (req, res) => {
    const accountsRes = await db.query("SELECT * FROM accounts WHERE organization_id = $1 ORDER BY code ASC", [
      req.session.organization_id
    ]);
    return ok(req, res, accountsRes.rows, 200, { total_count: accountsRes.rows.length });
  });
  app.get("/api/coa/tree", authenticate, async (req, res) => {
    const accountsRes = await db.query("SELECT * FROM accounts WHERE organization_id = $1 ORDER BY code ASC", [
      req.session.organization_id
    ]);
    return ok(req, res, CoaHierarchyValidator.buildTree(accountsRes.rows));
  });
  app.post("/api/coa/accounts", authenticate, requirePermission(Permission2.FINANCE_COA_MANAGE), async (req, res) => {
    const body = req.body || {};
    const code = str(body.code, "code", { max: 32, pattern: /^[A-Za-z0-9._-]+$/ });
    const name = str(body.name, "name", { max: 255 });
    const level = int(body.level, "level", { min: 1, max: 4 });
    const statement_class = oneOf(body.statement_class, "statement_class", ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]);
    const normal_balance = oneOf(body.normal_balance, "normal_balance", ["DEBIT", "CREDIT"]);
    const posting_allowed = body.posting_allowed === true;
    const parent_id = optionalUuid(body.parent_id, "parent_id");
    const control_type = optionalStr(body.control_type, "control_type", 32) || "GENERAL";
    const currency_restriction = optionalStr(body.currency_restriction, "currency_restriction", 3);
    let parent = null;
    if (parent_id) {
      const parentQuery = await db.query("SELECT * FROM accounts WHERE id = $1 AND organization_id = $2", [
        parent_id,
        req.session.organization_id
      ]);
      parent = parentQuery.rows[0] || null;
      if (!parent)
        throw validationError("Parent account not found in this organization", { field: "parent_id" });
    }
    const validation = CoaHierarchyValidator.validateAccount({ level, parent_id, statement_class, normal_balance, posting_allowed }, parent);
    if (!validation.valid)
      throw validationError(validation.error || "Invalid account hierarchy parameters");
    const accountId2 = crypto3.randomUUID();
    await db.transaction(async (tx) => {
      await tx.query(`INSERT INTO accounts (
          id, organization_id, legal_entity_id, code, name, parent_id, level,
          statement_class, normal_balance, posting_allowed, control_type, currency_restriction, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true)`, [
        accountId2,
        req.session.organization_id,
        req.session.legal_entity_id,
        code,
        name,
        parent_id,
        level,
        statement_class,
        normal_balance,
        posting_allowed,
        control_type,
        currency_restriction
      ]);
      await auditLogger.record({
        organization_id: req.session.organization_id,
        user_id: req.session.user_id,
        action: "COA_ACCOUNT_CREATED",
        entity_type: "ACCOUNT",
        entity_id: accountId2,
        after_state: { code, name, level, parent_id, statement_class, normal_balance, posting_allowed, control_type },
        correlation_id: req.correlationId
      }, tx);
    });
    return ok(req, res, { id: accountId2, code, name, level }, 201);
  });
  app.get("/api/periods", authenticate, async (req, res) => {
    const periodsRes = await db.query("SELECT * FROM fiscal_periods WHERE organization_id = $1 ORDER BY fiscal_year ASC, period_number ASC", [req.session.organization_id]);
    return ok(req, res, periodsRes.rows);
  });
  app.post("/api/periods/:id/status", authenticate, requirePermission(Permission2.FINANCE_PERIOD_MANAGE), async (req, res) => {
    const { id } = req.params;
    const status = oneOf(req.body?.status, "status", ["OPEN", "SOFT_CLOSED", "HARD_CLOSED"]);
    const reason = optionalStr(req.body?.reason, "reason", 500);
    const result = await db.transaction(async (tx) => {
      const period = await requireOrgRow(tx, "fiscal_periods", id, req.session.organization_id, "Fiscal period", { forUpdate: true });
      if (period.status === status)
        return { id, status, unchanged: true };
      const allowed = PERIOD_TRANSITIONS[period.status] || [];
      if (!allowed.includes(status)) {
        throw new ApiError(409, ErrorCode8.INVALID_STATE, `Period cannot move from ${period.status} to ${status}`);
      }
      const reopening = period.status === "HARD_CLOSED" || period.status === "SOFT_CLOSED" && status === "OPEN";
      if (reopening && !reason) {
        throw validationError("A reason is required to reopen a closed period", { field: "reason" });
      }
      await tx.query("UPDATE fiscal_periods SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND organization_id = $3", [
        status,
        id,
        req.session.organization_id
      ]);
      await auditLogger.record({
        organization_id: req.session.organization_id,
        user_id: req.session.user_id,
        action: reopening ? "PERIOD_REOPENED" : "PERIOD_STATUS_CHANGED",
        entity_type: "FISCAL_PERIOD",
        entity_id: id,
        before_state: { status: period.status },
        after_state: { status, reason },
        correlation_id: req.correlationId
      }, tx);
      await outboxService.emit({ organization_id: req.session.organization_id, event_type: "PERIOD_STATUS_CHANGED", payload: { period_id: id, from: period.status, to: status } }, tx);
      return { id, status };
    });
    return ok(req, res, result);
  });
  app.get("/api/journals", authenticate, requireAnyPermission(Permission2.FINANCE_REPORTS_VIEW, Permission2.FINANCE_JOURNAL_CREATE), async (req, res) => {
    const status = optionalStr(req.query.status, "status", 20);
    const search = optionalStr(req.query.search, "search", 100);
    const purpose = optionalStr(req.query.purpose, "purpose", 64);
    const { limit, offset } = pagination(req.query, { limit: 100, max: 500 });
    let where = "j.organization_id = $1";
    const params = [req.session.organization_id];
    if (status) {
      params.push(status);
      where += ` AND j.status = $${params.length}`;
    }
    if (purpose) {
      params.push(purpose);
      where += ` AND j.accounting_purpose = $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      where += ` AND (j.journal_number ILIKE $${params.length} OR j.description ILIKE $${params.length})`;
    }
    const count = await db.query(`SELECT COUNT(*)::int AS n FROM journals j WHERE ${where}`, params);
    params.push(limit, offset);
    const journalsRes = await db.query(`SELECT j.*, u.name as creator_name
         FROM journals j LEFT JOIN users u ON u.id = j.created_by
         WHERE ${where}
         ORDER BY j.posting_date DESC, j.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return ok(req, res, journalsRes.rows, 200, { total_count: count.rows[0].n, limit, offset });
  });
  app.get("/api/journals/:id", authenticate, requireAnyPermission(Permission2.FINANCE_REPORTS_VIEW, Permission2.FINANCE_JOURNAL_CREATE), async (req, res) => {
    const journal = await requireOrgRow(db, "journals", req.params.id, req.session.organization_id, "Journal entry");
    const linesRes = await db.query(`SELECT jl.*, a.code as account_code, a.name as account_name, a.level as account_level
         FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
         WHERE jl.journal_id = $1 ORDER BY jl.line_number ASC`, [journal.id]);
    return ok(req, res, { ...journal, lines: linesRes.rows });
  });
  app.post("/api/journals/draft", authenticate, requirePermission(Permission2.FINANCE_JOURNAL_CREATE), async (req, res) => {
    const body = req.body || {};
    const posting_date = dateOnly(body.posting_date, "posting_date");
    const document_date = dateOnly(body.document_date, "document_date", { defaultValue: posting_date });
    const description = str(body.description, "description", { max: 1e3 });
    const accounting_purpose = oneOf(body.accounting_purpose, "accounting_purpose", MANUAL_PURPOSES, AccountingPurpose.MANUAL_JOURNAL);
    const rawLines = arrayOf(body.lines, "lines", { min: 0, max: 500 });
    const lines = rawLines.map((l, i) => {
      const debit = decimal(l?.debit_amount, `lines[${i}].debit_amount`, { required: false, sign: "any", scale: 2 });
      const credit = decimal(l?.credit_amount, `lines[${i}].credit_amount`, { required: false, sign: "any", scale: 2 });
      return {
        line_number: i + 1,
        account_id: String(l?.account_id || ""),
        debit_amount: debit,
        credit_amount: credit,
        base_debit: debit,
        base_credit: credit,
        description: optionalStr(l?.description, `lines[${i}].description`, 500)
      };
    });
    const accountsRes = await db.query("SELECT * FROM accounts WHERE organization_id = $1", [req.session.organization_id]);
    const accountMap = new Map(accountsRes.rows.map((a) => [a.id, a]));
    const validation = JournalValidator2.validate(lines, accountMap);
    if (!validation.isValid) {
      throw new ApiError(400, ErrorCode8.JOURNAL_UNBALANCED, validation.errors.join("; "), validation.errors);
    }
    const journalId = crypto3.randomUUID();
    const journalNumber = await db.transaction(async (tx) => {
      const number = await nextDocumentNumber(tx, req.session.organization_id, "JV", posting_date, 6);
      await tx.query(`INSERT INTO journals (
          id, organization_id, legal_entity_id, journal_number, posting_date, document_date,
          accounting_purpose, status, base_currency, total_base_debit, total_base_credit,
          description, created_by, revision
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'DRAFT', 'PKR', $8, $9, $10, $11, 1)`, [
        journalId,
        req.session.organization_id,
        req.session.legal_entity_id,
        number,
        posting_date,
        document_date,
        accounting_purpose,
        validation.totalDebit.toFixed(8),
        validation.totalCredit.toFixed(8),
        description,
        req.session.user_id
      ]);
      for (const l of lines) {
        await tx.query(`INSERT INTO journal_lines (
            id, journal_id, line_number, account_id, debit_amount, credit_amount,
            currency, fx_rate, base_debit, base_credit, description
          ) VALUES ($1, $2, $3, $4, $5, $6, 'PKR', 1.0, $5, $6, $7)`, [crypto3.randomUUID(), journalId, l.line_number, l.account_id, l.debit_amount, l.credit_amount, l.description || null]);
      }
      await auditLogger.record({
        organization_id: req.session.organization_id,
        user_id: req.session.user_id,
        action: "JOURNAL_DRAFT_CREATED",
        entity_type: "JOURNAL",
        entity_id: journalId,
        after_state: { journal_number: number, lines: lines.length, total: validation.totalDebit.toFixed(2) },
        correlation_id: req.correlationId
      }, tx);
      return number;
    });
    return ok(req, res, { id: journalId, journal_number: journalNumber, status: "DRAFT", revision: 1 }, 201);
  });
  function expectedRevision(req) {
    const v = req.body?.expected_revision;
    return v === void 0 || v === null ? null : int(v, "expected_revision", { min: 1 });
  }
  async function journalTransition(req, from, to, action, extra = {}) {
    return db.transaction(async (tx) => {
      const j = await requireOrgRow(tx, "journals", req.params.id, req.session.organization_id, "Journal entry", { forUpdate: true });
      const rev = expectedRevision(req);
      if (rev !== null && Number(j.revision) !== rev) {
        throw new ApiError(409, ErrorCode8.STALE_REVISION, `Journal was changed (revision ${j.revision}); reload before continuing`, {
          current_revision: j.revision
        });
      }
      if (to === JournalStatus.APPROVED && j.created_by === req.session.user_id) {
        throw sodViolation("Segregation of duties: the journal creator cannot approve their own journal");
      }
      const updated = await transition(tx, {
        table: "journals",
        id: j.id,
        organizationId: req.session.organization_id,
        from,
        to,
        label: "Journal",
        set: { revision: Number(j.revision) + 1, updated_at: (/* @__PURE__ */ new Date()).toISOString(), ...extra }
      });
      await auditLogger.record({
        organization_id: req.session.organization_id,
        user_id: req.session.user_id,
        action,
        entity_type: "JOURNAL",
        entity_id: j.id,
        before_state: { status: j.status, revision: j.revision },
        after_state: { status: to, revision: updated.revision, reason: req.body?.reason || null },
        correlation_id: req.correlationId
      }, tx);
      return updated;
    });
  }
  app.post("/api/journals/:id/submit", authenticate, requirePermission(Permission2.FINANCE_JOURNAL_SUBMIT), async (req, res) => {
    const j = await journalTransition(req, [JournalStatus.DRAFT], JournalStatus.SUBMITTED, "JOURNAL_SUBMITTED");
    return ok(req, res, { id: j.id, status: JournalStatus.SUBMITTED, revision: j.revision });
  });
  app.post("/api/journals/:id/approve", authenticate, requirePermission(Permission2.FINANCE_JOURNAL_APPROVE), async (req, res) => {
    const j = await journalTransition(req, [JournalStatus.SUBMITTED], JournalStatus.APPROVED, "JOURNAL_APPROVED", {
      approved_by: req.session.user_id
    });
    return ok(req, res, { id: j.id, status: JournalStatus.APPROVED, revision: j.revision });
  });
  app.post("/api/journals/:id/reject", authenticate, requirePermission(Permission2.FINANCE_JOURNAL_APPROVE), async (req, res) => {
    str(req.body?.reason, "reason", { max: 500 });
    const j = await journalTransition(req, [JournalStatus.SUBMITTED, JournalStatus.APPROVED], JournalStatus.DRAFT, "JOURNAL_REJECTED", {
      approved_by: null
    });
    return ok(req, res, { id: j.id, status: JournalStatus.DRAFT, revision: j.revision });
  });
  app.post("/api/journals/:id/post", authenticate, requirePermission(Permission2.FINANCE_JOURNAL_POST), async (req, res) => {
    const result = await db.transaction(async (tx) => {
      const j = await requireOrgRow(tx, "journals", req.params.id, req.session.organization_id, "Journal entry", { forUpdate: true });
      if (j.status === JournalStatus.POSTED || j.status === JournalStatus.REVERSED) {
        throw new ApiError(400, ErrorCode8.ALREADY_POSTED, "This journal is already POSTED");
      }
      if (j.status !== JournalStatus.APPROVED) {
        throw new ApiError(409, ErrorCode8.INVALID_STATE, `Only APPROVED journals can be posted (current status ${j.status})`);
      }
      const rev = expectedRevision(req);
      if (rev !== null && Number(j.revision) !== rev) {
        throw new ApiError(409, ErrorCode8.STALE_REVISION, "Journal was changed; reload before posting");
      }
      const postingDate = toIsoDate(j.posting_date);
      const periodRes = await tx.query(`SELECT * FROM fiscal_periods WHERE organization_id = $1 AND legal_entity_id = $2 AND start_date <= $3::date AND end_date >= $3::date FOR UPDATE`, [req.session.organization_id, j.legal_entity_id, postingDate]);
      const period = periodRes.rows[0] || null;
      if (!period)
        throw new ApiError(400, ErrorCode8.PERIOD_CLOSED, `No defined fiscal period found for business posting date ${postingDate}`);
      if (period.status !== "OPEN") {
        throw new ApiError(400, ErrorCode8.PERIOD_CLOSED, `Posting rejected: Fiscal period ${period.period_name} is ${period.status}`);
      }
      const linesRes = await tx.query("SELECT * FROM journal_lines WHERE journal_id = $1", [j.id]);
      const accountsRes = await tx.query("SELECT * FROM accounts WHERE organization_id = $1", [req.session.organization_id]);
      const validation = JournalValidator2.validate(linesRes.rows, new Map(accountsRes.rows.map((a) => [a.id, a])));
      if (!validation.isValid) {
        throw new ApiError(400, ErrorCode8.JOURNAL_UNBALANCED, validation.errors.join("; "), validation.errors);
      }
      await tx.query(`UPDATE journals SET status = 'POSTED', posted_by = $1, posted_at = CURRENT_TIMESTAMP, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND organization_id = $3 AND status = 'APPROVED'`, [req.session.user_id, j.id, req.session.organization_id]);
      await outboxService.emit({
        organization_id: req.session.organization_id,
        event_type: "JOURNAL_POSTED",
        payload: { journal_id: j.id, journal_number: j.journal_number, total_base_debit: j.total_base_debit, posted_by: req.session.user_id }
      }, tx);
      await auditLogger.record({
        organization_id: req.session.organization_id,
        user_id: req.session.user_id,
        action: "JOURNAL_POSTED",
        entity_type: "JOURNAL",
        entity_id: j.id,
        before_state: { status: j.status },
        after_state: { status: JournalStatus.POSTED, posted_by: req.session.user_id },
        correlation_id: req.correlationId
      }, tx);
      return j;
    });
    return ok(req, res, { id: result.id, status: JournalStatus.POSTED, journal_number: result.journal_number });
  });
  app.post("/api/journals/:id/reverse", authenticate, requirePermission(Permission2.FINANCE_JOURNAL_REVERSE), async (req, res) => {
    const reversal_posting_date = dateOnly(req.body?.reversal_posting_date, "reversal_posting_date");
    const reason = str(req.body?.reason, "reason", { max: 500 });
    const out = await db.transaction(async (tx) => {
      const originalJournal = await requireOrgRow(tx, "journals", req.params.id, req.session.organization_id, "Journal", {
        forUpdate: true
      });
      const linesRes = await tx.query("SELECT * FROM journal_lines WHERE journal_id = $1 ORDER BY line_number", [originalJournal.id]);
      originalJournal.lines = linesRes.rows;
      const origDate = toIsoDate(originalJournal.posting_date);
      if (reversal_posting_date < origDate) {
        throw validationError("Reversal date cannot be earlier than the original posting date", { field: "reversal_posting_date" });
      }
      let reversalData;
      try {
        reversalData = JournalReversalEngine.createLinkedReversal({
          originalJournal,
          reversalPostingDate: reversal_posting_date,
          reversalDocumentDate: reversal_posting_date,
          reason,
          reversingUserId: req.session.user_id
        });
      } catch (err) {
        throw new ApiError(400, ErrorCode8.ALREADY_REVERSED, err.message);
      }
      const rev = reversalData.reversalJournal;
      const posted = await postJournal(tx, auditLogger, outboxService, {
        organizationId: req.session.organization_id,
        legalEntityId: originalJournal.legal_entity_id,
        userId: req.session.user_id,
        postingDate: reversal_posting_date,
        purpose: AccountingPurpose.REVERSAL,
        description: rev.description,
        sourceType: "JOURNAL",
        sourceId: originalJournal.id,
        sourceKey: `REVERSAL:${originalJournal.id}`,
        journalNumber: rev.journal_number,
        reversalOfJournalId: originalJournal.id,
        correlationId: req.correlationId,
        lines: rev.lines.map((l) => ({
          account_id: l.account_id,
          debit: String(l.base_debit),
          credit: String(l.base_credit),
          description: l.description,
          party_id: l.party_id,
          project_id: l.dimension_project_id,
          cost_center_id: l.dimension_cost_center_id,
          branch_id: l.dimension_branch_id
        }))
      });
      if (!posted)
        throw validationError("Journal has no non-zero lines to reverse");
      await tx.query(`UPDATE journals SET reversed_by_journal_id = $1, status = 'REVERSED', updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND organization_id = $3`, [posted.journalId, originalJournal.id, req.session.organization_id]);
      await auditLogger.record({
        organization_id: req.session.organization_id,
        user_id: req.session.user_id,
        action: "JOURNAL_REVERSED",
        entity_type: "JOURNAL",
        entity_id: originalJournal.id,
        after_state: { reversalJournalId: posted.journalId, reason },
        correlation_id: req.correlationId
      }, tx);
      return { original_journal_id: originalJournal.id, reversal_journal_id: posted.journalId };
    });
    return ok(req, res, { ...out, status: JournalStatus.REVERSED }, 201);
  });
  app.get("/api/ledger/trial-balance", authenticate, requirePermission(Permission2.FINANCE_REPORTS_VIEW), async (req, res) => {
    const asOfDate = dateOnly(req.query.as_of_date, "as_of_date", { defaultValue: todayIso() });
    const accountsRes = await db.query("SELECT * FROM accounts WHERE organization_id = $1 ORDER BY code ASC", [
      req.session.organization_id
    ]);
    const postedLinesRes = await db.query(`SELECT jl.* FROM journal_lines jl JOIN journals j ON j.id = jl.journal_id
       WHERE j.organization_id = $1 AND j.status IN ('POSTED', 'REVERSED') AND j.posting_date <= $2`, [req.session.organization_id, asOfDate]);
    const report = LedgerEngine.computeTrialBalance(accountsRes.rows, postedLinesRes.rows, asOfDate, req.session.legal_entity_id, "PKR");
    return ok(req, res, report);
  });
  app.get("/api/ledger/accounts/:id", authenticate, requirePermission(Permission2.FINANCE_REPORTS_VIEW), async (req, res) => {
    const account = await requireOrgRow(db, "accounts", req.params.id, req.session.organization_id, "Account");
    const from = dateOnly(req.query.from, "from", { defaultValue: "1900-01-01" });
    const to = dateOnly(req.query.to, "to", { defaultValue: todayIso() });
    const lines = await db.query(`SELECT j.id AS journal_id, j.journal_number, j.posting_date, j.accounting_purpose, j.description AS journal_description,
              jl.line_number, jl.base_debit, jl.base_credit, jl.description
       FROM journal_lines jl JOIN journals j ON j.id = jl.journal_id
       WHERE j.organization_id = $1 AND jl.account_id = $2 AND j.status IN ('POSTED','REVERSED')
         AND j.posting_date BETWEEN $3 AND $4
       ORDER BY j.posting_date ASC, j.created_at ASC, jl.line_number ASC
       LIMIT 5000`, [req.session.organization_id, account.id, from, to]);
    let running = Money.zero();
    const debitNormal = account.normal_balance === "DEBIT";
    const rows = lines.rows.map((l) => {
      const delta = new Money(l.base_debit).sub(l.base_credit);
      running = running.add(debitNormal ? delta : delta.negated());
      return { ...l, running_balance: running.toFixed(2) };
    });
    return ok(req, res, { account, from, to, lines: rows, closing_balance: running.toFixed(2) });
  });
}

// apps/api/dist/routes/masters.js
init_context();
init_http();
init_errors();
init_validate();
init_scope();
import crypto4 from "node:crypto";
import { Permission as Permission3 } from "@omnysync/contracts";
var PARTY_TYPES = ["CUSTOMER", "VENDOR", "BOTH"];
var ITEM_TYPES = ["INVENTORY", "SERVICE", "NON_INVENTORY"];
var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
async function leafAccount(org, id, field) {
  if (!id)
    return null;
  const r = await db.query(`SELECT id FROM accounts WHERE id = $1 AND organization_id = $2 AND level = 4 AND is_active = true`, [id, org]);
  if (r.rows.length === 0)
    throw validationError(`${field} must be an active posting (leaf) account in this organisation`, { field });
  return id;
}
function partyInput(b, partial = false) {
  const email = optionalStr(b.email, "email", 255);
  if (email && !EMAIL_RE.test(email))
    throw validationError("email is not valid", { field: "email" });
  return {
    name: partial && b.name === void 0 ? void 0 : str(b.name, "name", { max: 255 }),
    party_type: partial && b.party_type === void 0 ? void 0 : oneOf(b.party_type, "party_type", PARTY_TYPES),
    tax_identifier: optionalStr(b.tax_identifier, "tax_identifier", 64),
    email,
    phone: optionalStr(b.phone, "phone", 64),
    address: optionalStr(b.address, "address", 2e3),
    credit_limit: decimal(b.credit_limit, "credit_limit", { required: false, defaultValue: "0", scale: 2 })
  };
}
function registerMastersRoutes(app) {
  app.get("/api/parties", authenticate, async (req, res) => {
    const params = [req.session.organization_id];
    let sql = "SELECT * FROM parties WHERE organization_id = $1 AND is_active = true";
    if (req.query.type) {
      params.push(oneOf(req.query.type, "type", PARTY_TYPES));
      sql += ` AND (party_type = $${params.length} OR party_type = 'BOTH')`;
    }
    if (req.query.search) {
      params.push(`%${String(req.query.search).slice(0, 100)}%`);
      sql += ` AND (name ILIKE $${params.length} OR code ILIKE $${params.length} OR COALESCE(phone,'') ILIKE $${params.length})`;
    }
    const r = await db.query(`${sql} ORDER BY name ASC LIMIT 1000`, params);
    return ok(req, res, r.rows, 200, { total_count: r.rows.length });
  });
  app.post("/api/parties", authenticate, requirePermission(Permission3.PARTIES_MANAGE), async (req, res) => {
    const b = req.body || {};
    const code = str(b.code, "code", { max: 64 });
    const p = partyInput(b);
    const id = crypto4.randomUUID();
    await db.transaction(async (tx) => {
      await tx.query(`INSERT INTO parties (id, organization_id, legal_entity_id, code, name, party_type, tax_identifier, email, phone, address, credit_limit, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)`, [id, req.session.organization_id, req.session.legal_entity_id, code, p.name, p.party_type, p.tax_identifier, p.email, p.phone, p.address, p.credit_limit]);
      await auditLogger.record({ organization_id: req.session.organization_id, user_id: req.session.user_id, action: "PARTY_CREATED", entity_type: "PARTY", entity_id: id, after_state: { code, name: p.name, party_type: p.party_type, credit_limit: p.credit_limit }, correlation_id: req.correlationId }, tx);
    });
    return ok(req, res, { id, code, name: p.name, party_type: p.party_type }, 201);
  });
  app.post("/api/parties/:id", authenticate, requirePermission(Permission3.PARTIES_MANAGE), async (req, res) => {
    const out = await db.transaction(async (tx) => {
      const before = await requireOrgRow(tx, "parties", req.params.id, req.session.organization_id, "Party", { forUpdate: true });
      const p = partyInput({ ...before, ...req.body });
      const is_active = req.body?.is_active === void 0 ? before.is_active : bool(req.body.is_active);
      const r = await tx.query(`UPDATE parties SET name = $1, party_type = $2, tax_identifier = $3, email = $4, phone = $5, address = $6, credit_limit = $7, is_active = $8, updated_at = CURRENT_TIMESTAMP
         WHERE id = $9 RETURNING *`, [p.name, p.party_type, p.tax_identifier, p.email, p.phone, p.address, p.credit_limit, is_active, before.id]);
      await auditLogger.record({ organization_id: req.session.organization_id, user_id: req.session.user_id, action: "PARTY_UPDATED", entity_type: "PARTY", entity_id: before.id, before_state: { name: before.name, credit_limit: before.credit_limit, is_active: before.is_active }, after_state: { name: p.name, credit_limit: p.credit_limit, is_active }, correlation_id: req.correlationId }, tx);
      return r.rows[0];
    });
    return ok(req, res, out);
  });
  app.get("/api/items", authenticate, async (req, res) => {
    const params = [req.session.organization_id];
    let where = "i.organization_id = $1 AND i.is_active = true";
    if (req.query.search) {
      params.push(`%${String(req.query.search).slice(0, 100)}%`);
      where += ` AND (i.name ILIKE $${params.length} OR i.code ILIKE $${params.length} OR COALESCE(i.barcode,'') ILIKE $${params.length})`;
    }
    const r = await db.query(`SELECT i.*, COALESCE((SELECT SUM(quantity) FROM stock_movements sm WHERE sm.item_id = i.id), 0) as on_hand_qty
       FROM items i WHERE ${where} ORDER BY i.name ASC LIMIT 2000`, params);
    return ok(req, res, r.rows, 200, { total_count: r.rows.length });
  });
  app.post("/api/items", authenticate, requirePermission(Permission3.ITEMS_MANAGE), async (req, res) => {
    const b = req.body || {};
    const org = req.session.organization_id;
    const code = str(b.code, "code", { max: 64 });
    const name = str(b.name, "name", { max: 255 });
    const item_type = oneOf(b.item_type, "item_type", ITEM_TYPES, "INVENTORY");
    const uom = optionalStr(b.uom, "uom", 32) || "UNIT";
    const unit_price = decimal(b.unit_price, "unit_price", { required: false, defaultValue: "0" });
    const unit_cost = decimal(b.unit_cost, "unit_cost", { required: false, defaultValue: "0" });
    const sales_account_id = await leafAccount(org, optionalUuid(b.sales_account_id, "sales_account_id"), "sales_account_id");
    const cogs_account_id = await leafAccount(org, optionalUuid(b.cogs_account_id, "cogs_account_id"), "cogs_account_id");
    const inventory_account_id = await leafAccount(org, optionalUuid(b.inventory_account_id, "inventory_account_id"), "inventory_account_id");
    const barcode = optionalStr(b.barcode, "barcode", 64);
    const tax_rate = decimal(b.tax_rate, "tax_rate", { required: false, defaultValue: "0", scale: 4 });
    const is_weighed = bool(b.is_weighed, false);
    const reorder_point = decimal(b.reorder_point, "reorder_point", { required: false, defaultValue: "0" });
    const reorder_qty = decimal(b.reorder_qty, "reorder_qty", { required: false, defaultValue: "0" });
    const id = crypto4.randomUUID();
    await db.transaction(async (tx) => {
      await tx.query(`INSERT INTO items (id, organization_id, legal_entity_id, code, name, item_type, uom, unit_price, unit_cost,
           sales_account_id, cogs_account_id, inventory_account_id, is_active, barcode, tax_rate, is_weighed, reorder_point, reorder_qty)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true, $13, $14, $15, $16, $17)`, [id, org, req.session.legal_entity_id, code, name, item_type, uom, unit_price, unit_cost, sales_account_id, cogs_account_id, inventory_account_id, barcode, tax_rate, is_weighed, reorder_point, reorder_qty]);
      await auditLogger.record({ organization_id: org, user_id: req.session.user_id, action: "ITEM_CREATED", entity_type: "ITEM", entity_id: id, after_state: { code, name, item_type, unit_price, unit_cost }, correlation_id: req.correlationId }, tx);
    });
    return ok(req, res, { id, code, name }, 201);
  });
  app.post("/api/items/:id", authenticate, requirePermission(Permission3.ITEMS_MANAGE), async (req, res) => {
    const org = req.session.organization_id;
    const out = await db.transaction(async (tx) => {
      const before = await requireOrgRow(tx, "items", req.params.id, org, "Item", { forUpdate: true });
      const b = { ...before, ...req.body };
      const name = str(b.name, "name", { max: 255 });
      const unit_price = decimal(String(b.unit_price), "unit_price");
      const unit_cost = decimal(String(b.unit_cost), "unit_cost");
      const barcode = optionalStr(b.barcode, "barcode", 64);
      const tax_rate = decimal(String(b.tax_rate ?? "0"), "tax_rate", { scale: 4 });
      const reorder_point = decimal(String(b.reorder_point ?? "0"), "reorder_point");
      const reorder_qty = decimal(String(b.reorder_qty ?? "0"), "reorder_qty");
      const is_weighed = bool(b.is_weighed, false);
      const is_active = bool(b.is_active, true);
      const r = await tx.query(`UPDATE items SET name = $1, unit_price = $2, unit_cost = $3, barcode = $4, tax_rate = $5, reorder_point = $6, reorder_qty = $7,
           is_weighed = $8, is_active = $9, updated_at = CURRENT_TIMESTAMP WHERE id = $10 RETURNING *`, [name, unit_price, unit_cost, barcode, tax_rate, reorder_point, reorder_qty, is_weighed, is_active, before.id]);
      await auditLogger.record({ organization_id: org, user_id: req.session.user_id, action: "ITEM_UPDATED", entity_type: "ITEM", entity_id: before.id, before_state: { unit_price: before.unit_price, unit_cost: before.unit_cost, is_active: before.is_active }, after_state: { unit_price, unit_cost, is_active }, correlation_id: req.correlationId }, tx);
      return r.rows[0];
    });
    return ok(req, res, out);
  });
}

// apps/api/dist/routes/sales.js
init_context();
init_http();
init_errors();
init_validate();
init_scope();
init_state();
init_posting();
init_numbering();
init_stock();
import crypto6 from "node:crypto";
import { Money as Money4 } from "@omnysync/financial-engine";
import { AccountingPurpose as AccountingPurpose2, ErrorCode as ErrorCode11, Permission as Permission4 } from "@omnysync/contracts";

// apps/api/dist/lib/trading.js
init_errors();
init_validate();
import { Money as Money3 } from "@omnysync/financial-engine";
import { ErrorCode as ErrorCode10 } from "@omnysync/contracts";
function parseLines(raw, field = "lines") {
  return arrayOf(raw, field, { min: 1, max: 500 }).map((l, i) => ({
    item_id: uuid(l?.item_id, `${field}[${i}].item_id`),
    quantity: decimal(l?.quantity, `${field}[${i}].quantity`, { sign: "positive" }),
    unit_price: decimal(l?.unit_price, `${field}[${i}].unit_price`, { sign: "nonNegative" }),
    description: optionalStr(l?.description, `${field}[${i}].description`, 1e3),
    source_line_id: l?.source_line_id ?? l?.line_id ?? null
  }));
}
async function priceLines(q, organizationId, lines) {
  const priced = [];
  let subtotal = Money3.zero();
  let tax = Money3.zero();
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const r = await q.query(`SELECT * FROM items WHERE id = $1 AND organization_id = $2`, [l.item_id, organizationId]);
    const item = r.rows[0];
    if (!item)
      throw validationError(`Item ${l.item_id} not found`, { field: `lines[${i}].item_id` });
    if (!item.is_active)
      throw validationError(`Item ${item.code} is inactive`, { field: `lines[${i}].item_id` });
    const lineTotal = new Money3(l.quantity).mul(l.unit_price).roundToCurrency();
    const rate = new Money3(item.tax_rate ?? "0");
    const lineTax = lineTotal.mul(rate).div(100).roundToCurrency();
    subtotal = subtotal.add(lineTotal);
    tax = tax.add(lineTax);
    priced.push({ ...l, line_number: i + 1, line_total: lineTotal.toFixed(8), tax_rate: rate.toFixed(4), tax_amount: lineTax.toFixed(8), item });
  }
  return { lines: priced, subtotal: subtotal.toFixed(8), tax_amount: tax.toFixed(8), total_amount: subtotal.add(tax).toFixed(8) };
}
async function requireParty(q, organizationId, partyId, role) {
  const r = await q.query(`SELECT * FROM parties WHERE id = $1 AND organization_id = $2`, [partyId, organizationId]);
  const p = r.rows[0];
  if (!p)
    throw validationError("Party not found", { field: "party_id" });
  if (!p.is_active)
    throw validationError(`Party ${p.code} is inactive`, { field: "party_id" });
  if (p.party_type !== role && p.party_type !== "BOTH") {
    throw validationError(`Party ${p.code} is not a ${role.toLowerCase()}`, { field: "party_id" });
  }
  return p;
}
async function assertCreditLimit(q, organizationId, party, additional, excludeOrderId) {
  const limit = new Money3(party.credit_limit || "0");
  if (!limit.isPositive())
    return;
  const ar = await q.query(`SELECT COALESCE(SUM(outstanding_amount), 0)::text AS t FROM ar_invoices
     WHERE organization_id = $1 AND party_id = $2 AND status IN ('POSTED', 'PARTIALLY_PAID')`, [organizationId, party.id]);
  const so = await q.query(`SELECT COALESCE(SUM(total_amount), 0)::text AS t FROM sales_orders
     WHERE organization_id = $1 AND party_id = $2 AND status IN ('CONFIRMED', 'FULFILLED') AND id::text <> $3`, [organizationId, party.id, excludeOrderId || ""]);
  const exposure = new Money3(ar.rows[0].t).add(so.rows[0].t).add(additional);
  if (exposure.gt(limit)) {
    throw new ApiError(409, ErrorCode10.CREDIT_LIMIT_EXCEEDED, `Credit limit exceeded for ${party.code}: exposure ${exposure.format()} > limit ${limit.format()}`, {
      exposure: exposure.format(),
      credit_limit: limit.format()
    });
  }
}
async function accountByCode(q, organizationId, code) {
  const r = await q.query(`SELECT id FROM accounts WHERE organization_id = $1 AND code = $2`, [organizationId, code]);
  if (!r.rows[0])
    throw new ApiError(400, ErrorCode10.MAPPING_MISSING, `Required GL account ${code} is not configured`);
  return r.rows[0].id;
}

// apps/api/dist/routes/sales.js
var SALES_READ = [Permission4.SALES_ORDER_MANAGE, Permission4.AR_INVOICE_MANAGE, Permission4.PAYMENT_MANAGE, Permission4.INVENTORY_MANAGE, Permission4.FINANCE_REPORTS_VIEW];
var AR_READ = [Permission4.AR_INVOICE_MANAGE, Permission4.PAYMENT_MANAGE, Permission4.SALES_ORDER_MANAGE, Permission4.FINANCE_REPORTS_VIEW];
async function audit(req, tx, action, type, id, before, after) {
  await auditLogger.record({ organization_id: req.session.organization_id, user_id: req.session.user_id, action, entity_type: type, entity_id: id, before_state: before, after_state: after, correlation_id: req.correlationId }, tx);
}
function registerSalesRoutes(app) {
  const salesRead = requireAnyPermission(...SALES_READ);
  const arRead = requireAnyPermission(...AR_READ);
  app.get("/api/sales/orders", authenticate, salesRead, async (req, res) => {
    const { limit, offset } = pagination(req.query);
    const params = [req.session.organization_id];
    let where = "so.organization_id = $1";
    if (req.query.status) {
      params.push(String(req.query.status));
      where += ` AND so.status = $${params.length}`;
    }
    const r = await db.query(`SELECT so.*, p.name as party_name, p.code as party_code FROM sales_orders so JOIN parties p ON p.id = so.party_id
       WHERE ${where} ORDER BY so.order_date DESC, so.created_at DESC LIMIT ${limit} OFFSET ${offset}`, params);
    return ok(req, res, r.rows, 200, { total_count: r.rows.length, limit, offset });
  });
  app.get("/api/sales/orders/:id", authenticate, salesRead, async (req, res) => {
    const r = await db.query(`SELECT so.*, p.name as party_name, p.code as party_code FROM sales_orders so JOIN parties p ON p.id = so.party_id
       WHERE so.id::text = $1 AND so.organization_id = $2`, [req.params.id, req.session.organization_id]);
    if (!r.rows[0])
      throw new ApiError(404, ErrorCode11.RESOURCE_NOT_FOUND, "Sales order not found");
    const lines = await db.query(`SELECT sol.*, i.code as item_code, i.name as item_name, i.uom FROM sales_order_lines sol JOIN items i ON i.id = sol.item_id
       WHERE sol.sales_order_id = $1 ORDER BY sol.line_number ASC`, [r.rows[0].id]);
    return ok(req, res, { ...r.rows[0], lines: lines.rows });
  });
  app.post("/api/sales/orders", authenticate, requirePermission(Permission4.SALES_ORDER_MANAGE), async (req, res) => {
    const org = req.session.organization_id;
    const party_id = uuid(req.body?.party_id, "party_id");
    const order_date = dateOnly(req.body?.order_date, "order_date", { defaultValue: todayIso() });
    const delivery_date = optionalDate(req.body?.delivery_date, "delivery_date");
    if (delivery_date && delivery_date < order_date)
      throw validationError("delivery_date cannot be before order_date", { field: "delivery_date" });
    const warehouse_id = optionalUuid(req.body?.warehouse_id, "warehouse_id");
    await assertOrgRef(db, "warehouses", warehouse_id, org, "warehouse_id");
    await requireParty(db, org, party_id, "CUSTOMER");
    const priced = await priceLines(db, org, parseLines(req.body?.lines));
    const orderId = crypto6.randomUUID();
    const out = await db.transaction(async (tx) => {
      const orderNumber = optionalStr(req.body?.order_number, "order_number", 64) || await nextDocumentNumber(tx, org, "SO", order_date);
      await tx.query(`INSERT INTO sales_orders (id, organization_id, legal_entity_id, party_id, order_number, order_date, delivery_date, status,
           subtotal, tax_amount, total_amount, notes, created_by, warehouse_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'DRAFT', $8, $9, $10, $11, $12, $13)`, [orderId, org, req.session.legal_entity_id, party_id, orderNumber, order_date, delivery_date, priced.subtotal, priced.tax_amount, priced.total_amount, optionalStr(req.body?.notes, "notes"), req.session.user_id, warehouse_id]);
      for (const l of priced.lines) {
        await tx.query(`INSERT INTO sales_order_lines (id, sales_order_id, line_number, item_id, quantity, unit_price, line_total, tax_amount, description)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [crypto6.randomUUID(), orderId, l.line_number, l.item_id, l.quantity, l.unit_price, l.line_total, l.tax_amount, l.description]);
      }
      await audit(req, tx, "SALES_ORDER_CREATED", "SALES_ORDER", orderId, void 0, { order_number: orderNumber, total_amount: priced.total_amount });
      return { id: orderId, order_number: orderNumber, status: "DRAFT", subtotal: new Money4(priced.subtotal).format(), tax_amount: new Money4(priced.tax_amount).format(), total_amount: new Money4(priced.total_amount).format() };
    });
    return ok(req, res, out, 201);
  });
  app.post("/api/sales/orders/:id/confirm", authenticate, requirePermission(Permission4.SALES_ORDER_MANAGE), async (req, res) => {
    const org = req.session.organization_id;
    const out = await db.transaction(async (tx) => {
      const so = await requireOrgRow(tx, "sales_orders", req.params.id, org, "Sales order", { forUpdate: true });
      const party = await requireParty(tx, org, so.party_id, "CUSTOMER");
      await assertCreditLimit(tx, org, party, so.total_amount, so.id);
      await transition(tx, { table: "sales_orders", id: so.id, organizationId: org, from: ["DRAFT"], to: "CONFIRMED", label: "Sales order", set: { confirmed_by: req.session.user_id, updated_at: (/* @__PURE__ */ new Date()).toISOString() } });
      await audit(req, tx, "SALES_ORDER_CONFIRMED", "SALES_ORDER", so.id, { status: so.status }, { status: "CONFIRMED" });
      return { id: so.id, status: "CONFIRMED" };
    });
    return ok(req, res, out);
  });
  app.post("/api/sales/orders/:id/cancel", authenticate, requirePermission(Permission4.SALES_ORDER_MANAGE), async (req, res) => {
    const reason = str(req.body?.reason, "reason", { max: 500 });
    const out = await db.transaction(async (tx) => {
      const so = await transition(tx, { table: "sales_orders", id: req.params.id, organizationId: req.session.organization_id, from: ["DRAFT", "CONFIRMED"], to: "CANCELLED", label: "Sales order", set: { updated_at: (/* @__PURE__ */ new Date()).toISOString() } });
      await audit(req, tx, "SALES_ORDER_CANCELLED", "SALES_ORDER", so.id, void 0, { reason });
      return { id: so.id, status: "CANCELLED" };
    });
    return ok(req, res, out);
  });
  app.post("/api/sales/orders/:id/fulfill", authenticate, requirePermission(Permission4.INVENTORY_MANAGE), async (req, res) => {
    const org = req.session.organization_id;
    const shipment_date = dateOnly(req.body?.shipment_date, "shipment_date", { defaultValue: todayIso() });
    const bodyWarehouse = optionalUuid(req.body?.warehouse_id, "warehouse_id");
    await assertOrgRef(db, "warehouses", bodyWarehouse, org, "warehouse_id");
    const out = await db.transaction(async (tx) => {
      const so = await transition(tx, { table: "sales_orders", id: req.params.id, organizationId: org, from: ["CONFIRMED"], to: "FULFILLED", label: "Sales order", set: { updated_at: (/* @__PURE__ */ new Date()).toISOString() } });
      if (shipment_date < toIsoDate(so.order_date))
        throw validationError("shipment_date cannot be before order_date", { field: "shipment_date" });
      const warehouseId = bodyWarehouse || so.warehouse_id || await defaultWarehouseId(tx, org);
      const lines = (await tx.query(`SELECT * FROM sales_order_lines WHERE sales_order_id = $1 ORDER BY line_number`, [so.id])).rows;
      const items = await lockItems(tx, org, lines.map((l) => l.item_id));
      const cogsByAccount = /* @__PURE__ */ new Map();
      const defaultCogs = await accountByCode(tx, org, "511001");
      const defaultInv = await accountByCode(tx, org, "113001");
      for (const l of lines) {
        const item = items.get(l.item_id);
        if (item.item_type === "INVENTORY") {
          const cost = new Money4(item.unit_cost || "0");
          const mv = await postStockMovement(tx, {
            organizationId: org,
            legalEntityId: so.legal_entity_id,
            itemId: l.item_id,
            warehouseId,
            movementType: "SHIPMENT",
            movementDate: shipment_date,
            quantity: new Money4(l.quantity).negated().toFixed(8),
            unitCost: cost.toFixed(8),
            referenceType: "SALES_ORDER",
            referenceId: so.id,
            description: `Shipment for ${so.order_number}`
          });
          const value = new Money4(mv.total_value).abs();
          const cogsAcc = item.cogs_account_id || defaultCogs;
          const invAcc = item.inventory_account_id || defaultInv;
          const key = `${cogsAcc}|${invAcc}`;
          const cur = cogsByAccount.get(key) || { cogs: cogsAcc, inv: invAcc, amount: Money4.zero() };
          cur.amount = cur.amount.add(value);
          cogsByAccount.set(key, cur);
        }
        await tx.query("UPDATE sales_order_lines SET fulfilled_quantity = quantity WHERE id = $1", [l.id]);
      }
      const jLines = [];
      for (const v of cogsByAccount.values()) {
        const amt = v.amount.round(2).toFixed(8);
        jLines.push({ account_id: v.cogs, debit: amt, description: "Cost of goods sold" });
        jLines.push({ account_id: v.inv, credit: amt, description: "Inventory issued" });
      }
      const posted = jLines.length ? await postJournal(tx, auditLogger, outboxService, {
        organizationId: org,
        legalEntityId: so.legal_entity_id,
        userId: req.session.user_id,
        postingDate: shipment_date,
        purpose: AccountingPurpose2.INVENTORY_ISSUE,
        description: `COGS for order ${so.order_number}`,
        sourceType: "SALES_ORDER",
        sourceId: so.id,
        sourceKey: `SO_FULFILLMENT:${so.id}`,
        numberPrefix: "JV-COGS",
        correlationId: req.correlationId,
        lines: jLines
      }) : null;
      await tx.query(`UPDATE sales_orders SET warehouse_id = $1, cogs_journal_id = $2 WHERE id = $3`, [warehouseId, posted?.journalId ?? null, so.id]);
      await audit(req, tx, "SALES_ORDER_FULFILLED", "SALES_ORDER", so.id, { status: "CONFIRMED" }, { status: "FULFILLED", warehouse_id: warehouseId, cogs_journal_id: posted?.journalId ?? null });
      return { id: so.id, status: "FULFILLED", cogs_journal_id: posted?.journalId ?? null };
    });
    return ok(req, res, out);
  });
  app.get("/api/ar/invoices", authenticate, arRead, async (req, res) => {
    const { limit, offset } = pagination(req.query);
    const r = await db.query(`SELECT ai.*, p.name as party_name, p.code as party_code FROM ar_invoices ai JOIN parties p ON p.id = ai.party_id
       WHERE ai.organization_id = $1 ORDER BY ai.invoice_date DESC, ai.created_at DESC LIMIT ${limit} OFFSET ${offset}`, [req.session.organization_id]);
    return ok(req, res, r.rows, 200, { total_count: r.rows.length, limit, offset });
  });
  app.get("/api/ar/invoices/:id", authenticate, arRead, async (req, res) => {
    const r = await db.query(`SELECT ai.*, p.name as party_name, p.code as party_code FROM ar_invoices ai JOIN parties p ON p.id = ai.party_id
       WHERE ai.id::text = $1 AND ai.organization_id = $2`, [req.params.id, req.session.organization_id]);
    if (!r.rows[0])
      throw new ApiError(404, ErrorCode11.RESOURCE_NOT_FOUND, "AR invoice not found");
    const lines = await db.query(`SELECT ail.*, i.code as item_code, i.name as item_name FROM ar_invoice_lines ail JOIN items i ON i.id = ail.item_id
       WHERE ail.invoice_id = $1 ORDER BY ail.line_number ASC`, [r.rows[0].id]);
    const allocations = await db.query(`SELECT a.*, pm.payment_number FROM allocations a JOIN payments pm ON pm.id = a.payment_id
       WHERE a.invoice_id = $1 AND a.invoice_type = 'AR' AND a.reversed_at IS NULL ORDER BY a.allocated_date`, [r.rows[0].id]);
    return ok(req, res, { ...r.rows[0], lines: lines.rows, allocations: allocations.rows });
  });
  app.post("/api/ar/invoices", authenticate, requirePermission(Permission4.AR_INVOICE_MANAGE), async (req, res) => {
    const org = req.session.organization_id;
    const party_id = uuid(req.body?.party_id, "party_id");
    const sales_order_id = optionalUuid(req.body?.sales_order_id, "sales_order_id");
    const invoice_date = dateOnly(req.body?.invoice_date, "invoice_date", { defaultValue: todayIso() });
    const due_date = dateOnly(req.body?.due_date, "due_date", {
      defaultValue: new Date(Date.parse(`${invoice_date}T00:00:00Z`) + 30 * 864e5).toISOString().slice(0, 10)
    });
    if (due_date < invoice_date)
      throw validationError("due_date cannot be before invoice_date", { field: "due_date" });
    await requireParty(db, org, party_id, "CUSTOMER");
    const inputLines = parseLines(req.body?.lines);
    const invoiceId = crypto6.randomUUID();
    const out = await db.transaction(async (tx) => {
      if (sales_order_id) {
        const so = await requireOrgRow(tx, "sales_orders", sales_order_id, org, "Sales order", { forUpdate: true });
        if (so.party_id !== party_id)
          throw validationError("Invoice customer must match the sales order customer", { field: "party_id" });
        if (!["CONFIRMED", "FULFILLED"].includes(so.status))
          throw new ApiError(409, ErrorCode11.INVALID_STATE, `Sales order ${so.order_number} is ${so.status} and cannot be invoiced`);
        const soLines = (await tx.query(`SELECT * FROM sales_order_lines WHERE sales_order_id = $1 ORDER BY line_number FOR UPDATE`, [so.id])).rows;
        for (const l of inputLines) {
          const match = soLines.find((s) => s.id === l.source_line_id) || soLines.find((s) => s.item_id === l.item_id && new Money4(s.quantity).sub(s.invoiced_quantity).gte(l.quantity));
          if (!match)
            throw new ApiError(409, ErrorCode11.OVER_ALLOCATION, `Line for item ${l.item_id} exceeds the un-invoiced quantity on ${so.order_number}`);
          const remaining = new Money4(match.quantity).sub(match.invoiced_quantity);
          if (new Money4(l.quantity).gt(remaining))
            throw new ApiError(409, ErrorCode11.OVER_ALLOCATION, `Invoiced quantity exceeds remaining order quantity (${remaining.format(4)})`);
          match.invoiced_quantity = new Money4(match.invoiced_quantity).add(l.quantity).toFixed(8);
          l.source_line_id = match.id;
          await tx.query(`UPDATE sales_order_lines SET invoiced_quantity = $1 WHERE id = $2`, [match.invoiced_quantity, match.id]);
        }
        if (soLines.every((s) => new Money4(s.invoiced_quantity).gte(s.quantity)) && so.status === "FULFILLED") {
          await tx.query(`UPDATE sales_orders SET status = 'INVOICED', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [so.id]);
        }
      }
      const priced = await priceLines(tx, org, inputLines);
      const invoiceNumber = optionalStr(req.body?.invoice_number, "invoice_number", 64) || await nextDocumentNumber(tx, org, "INV", invoice_date);
      await tx.query(`INSERT INTO ar_invoices (id, organization_id, legal_entity_id, party_id, sales_order_id, invoice_number, invoice_date, due_date, status,
           subtotal, tax_amount, total_amount, outstanding_amount, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'DRAFT', $9, $10, $11, $11, $12, $13)`, [invoiceId, org, req.session.legal_entity_id, party_id, sales_order_id, invoiceNumber, invoice_date, due_date, priced.subtotal, priced.tax_amount, priced.total_amount, optionalStr(req.body?.notes, "notes"), req.session.user_id]);
      for (const l of priced.lines) {
        await tx.query(`INSERT INTO ar_invoice_lines (id, invoice_id, line_number, item_id, quantity, unit_price, line_total, tax_amount, description, sales_order_line_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [crypto6.randomUUID(), invoiceId, l.line_number, l.item_id, l.quantity, l.unit_price, l.line_total, l.tax_amount, l.description, l.source_line_id || null]);
      }
      await audit(req, tx, "AR_INVOICE_CREATED", "AR_INVOICE", invoiceId, void 0, { invoice_number: invoiceNumber, total_amount: priced.total_amount });
      return { id: invoiceId, invoice_number: invoiceNumber, status: "DRAFT", subtotal: new Money4(priced.subtotal).format(), tax_amount: new Money4(priced.tax_amount).format(), total_amount: new Money4(priced.total_amount).format() };
    });
    return ok(req, res, out, 201);
  });
  app.post("/api/ar/invoices/:id/post", authenticate, requirePermission(Permission4.AR_INVOICE_MANAGE), async (req, res) => {
    const org = req.session.organization_id;
    const out = await db.transaction(async (tx) => {
      const inv = await transition(tx, { table: "ar_invoices", id: req.params.id, organizationId: org, from: ["DRAFT"], to: "POSTED", label: "AR invoice", set: { posted_by: req.session.user_id, updated_at: (/* @__PURE__ */ new Date()).toISOString() } });
      const lines = (await tx.query(`SELECT ail.*, i.sales_account_id FROM ar_invoice_lines ail JOIN items i ON i.id = ail.item_id WHERE ail.invoice_id = $1`, [inv.id])).rows;
      const defaultRevenue = await accountByCode(tx, org, "411001");
      const revenueByAccount = /* @__PURE__ */ new Map();
      let lineSum = Money4.zero();
      let taxSum = Money4.zero();
      for (const l of lines) {
        const acc = l.sales_account_id || defaultRevenue;
        revenueByAccount.set(acc, (revenueByAccount.get(acc) || Money4.zero()).add(l.line_total));
        lineSum = lineSum.add(l.line_total);
        taxSum = taxSum.add(l.tax_amount || "0");
      }
      if (!lineSum.eq(inv.subtotal) || !taxSum.eq(inv.tax_amount) || !lineSum.add(taxSum).eq(inv.total_amount)) {
        throw new ApiError(409, ErrorCode11.JOURNAL_UNBALANCED, "Invoice header totals do not match its lines");
      }
      const jLines = [{ account_code: "112001", debit: new Money4(inv.total_amount).toFixed(8), description: `AR ${inv.invoice_number}` }];
      for (const [acc, amt] of revenueByAccount)
        jLines.push({ account_id: acc, credit: amt.toFixed(8), description: `Revenue ${inv.invoice_number}` });
      if (taxSum.isPositive())
        jLines.push({ account_code: "212001", credit: taxSum.toFixed(8), description: `Output tax ${inv.invoice_number}` });
      const posted = await postJournal(tx, auditLogger, outboxService, {
        organizationId: org,
        legalEntityId: inv.legal_entity_id,
        userId: req.session.user_id,
        postingDate: toIsoDate(inv.invoice_date),
        purpose: AccountingPurpose2.SALES_INVOICE,
        description: `Customer invoice ${inv.invoice_number}`,
        sourceType: "AR_INVOICE",
        sourceId: inv.id,
        sourceKey: `AR_INVOICE:${inv.id}`,
        numberPrefix: "JV-AR",
        correlationId: req.correlationId,
        lines: jLines
      });
      await tx.query(`UPDATE ar_invoices SET posted_journal_id = $1, outstanding_amount = total_amount WHERE id = $2`, [posted?.journalId ?? null, inv.id]);
      return { id: inv.id, status: "POSTED", posted_journal_id: posted?.journalId ?? null };
    });
    return ok(req, res, out);
  });
  app.post("/api/ar/invoices/:id/cancel", authenticate, requirePermission(Permission4.AR_INVOICE_MANAGE), async (req, res) => {
    const org = req.session.organization_id;
    const out = await db.transaction(async (tx) => {
      const inv = await transition(tx, { table: "ar_invoices", id: req.params.id, organizationId: org, from: ["DRAFT"], to: "CANCELLED", label: "AR invoice", set: { updated_at: (/* @__PURE__ */ new Date()).toISOString() } });
      const lines = (await tx.query(`SELECT * FROM ar_invoice_lines WHERE invoice_id = $1 AND sales_order_line_id IS NOT NULL`, [inv.id])).rows;
      for (const l of lines)
        await tx.query(`UPDATE sales_order_lines SET invoiced_quantity = invoiced_quantity - $1 WHERE id = $2`, [l.quantity, l.sales_order_line_id]);
      if (inv.sales_order_id)
        await tx.query(`UPDATE sales_orders SET status = 'FULFILLED' WHERE id = $1 AND status = 'INVOICED'`, [inv.sales_order_id]);
      await audit(req, tx, "AR_INVOICE_CANCELLED", "AR_INVOICE", inv.id);
      return { id: inv.id, status: "CANCELLED" };
    });
    return ok(req, res, out);
  });
  app.get("/api/ar/aging", authenticate, arRead, async (req, res) => {
    const asOf = dateOnly(req.query.as_of_date, "as_of_date", { defaultValue: todayIso() });
    const r = await db.query(`SELECT ai.id, ai.invoice_number, ai.due_date, ai.outstanding_amount, p.id as party_id, p.name as party_name
       FROM ar_invoices ai JOIN parties p ON p.id = ai.party_id
       WHERE ai.organization_id = $1 AND ai.status IN ('POSTED','PARTIALLY_PAID') AND ai.invoice_date <= $2`, [req.session.organization_id, asOf]);
    const buckets = ["current", "d1_30", "d31_60", "d61_90", "d90_plus"];
    const byParty = /* @__PURE__ */ new Map();
    for (const row of r.rows) {
      const days = Math.floor((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${toIsoDate(row.due_date)}T00:00:00Z`)) / 864e5);
      const b = days <= 0 ? "current" : days <= 30 ? "d1_30" : days <= 60 ? "d31_60" : days <= 90 ? "d61_90" : "d90_plus";
      const p = byParty.get(row.party_id) || { party_id: row.party_id, party_name: row.party_name, total: Money4.zero(), ...Object.fromEntries(buckets.map((k) => [k, Money4.zero()])) };
      p[b] = p[b].add(row.outstanding_amount);
      p.total = p.total.add(row.outstanding_amount);
      byParty.set(row.party_id, p);
    }
    const rows = [...byParty.values()].map((p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v instanceof Money4 ? v.format() : v])));
    return ok(req, res, rows, 200, { as_of_date: asOf });
  });
}

// apps/api/dist/routes/budgets.js
init_context();
init_http();
init_errors();
init_resource();
init_modules();
init_validate();
import { Permission as Permission5, ErrorCode as ErrorCode14 } from "@omnysync/contracts";
import { Money as Money5 } from "@omnysync/financial-engine";
var VIEW = [Permission5.BUDGET_VIEW, Permission5.BUDGET_MANAGE, Permission5.BUDGET_APPROVE];
async function poBudgetCheck(q, org, poId) {
  const po = (await q.query(`SELECT id, po_date FROM purchase_orders WHERE id = $1 AND organization_id = $2`, [poId, org])).rows[0];
  if (!po)
    return [];
  const year = new Date(po.po_date).getUTCFullYear();
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const expenseAcct = `COALESCE(i.cogs_account_id, (SELECT id FROM accounts WHERE organization_id = $1 AND code = '511001'))`;
  const mine = (await q.query(`SELECT ${expenseAcct} AS account_id, SUM(l.quantity * l.unit_price)::text amount FROM purchase_order_lines l JOIN items i ON i.id = l.item_id
       WHERE l.purchase_order_id = $2 AND i.item_type <> 'INVENTORY' GROUP BY 1`, [org, poId])).rows.filter((r) => r.account_id);
  const over = [];
  for (const m of mine) {
    const b = (await q.query(`SELECT COALESCE(SUM(bl.amount), 0)::text total, COUNT(*)::int n FROM epm_budget_lines bl JOIN epm_budgets b ON b.id = bl.budget_id
         WHERE b.organization_id = $1 AND b.status = 'APPROVED' AND b.scenario = 'BUDGET' AND b.fiscal_year = $2 AND bl.account_id = $3`, [org, year, m.account_id])).rows[0];
    if (!b.n)
      continue;
    const actual = (await q.query(`SELECT COALESCE(SUM(jl.base_debit - jl.base_credit), 0)::text v FROM journal_lines jl JOIN journals j ON j.id = jl.journal_id
         WHERE j.organization_id = $1 AND j.status = 'POSTED' AND j.posting_date BETWEEN $2 AND $3 AND jl.account_id = $4`, [org, from, to, m.account_id])).rows[0].v;
    const committed = (await q.query(`SELECT COALESCE(SUM((l.quantity - l.received_quantity) * l.unit_price), 0)::text v FROM purchase_order_lines l JOIN purchase_orders po ON po.id = l.purchase_order_id JOIN items i ON i.id = l.item_id
         WHERE po.organization_id = $1 AND po.status = 'APPROVED' AND po.id <> $2 AND i.item_type <> 'INVENTORY' AND po.po_date BETWEEN $3 AND $4 AND ${expenseAcct} = $5`, [org, poId, from, to, m.account_id])).rows[0].v;
    const available = new Money5(b.total).sub(actual).sub(committed);
    if (new Money5(m.amount).gt(available)) {
      const a = (await q.query(`SELECT code, name FROM accounts WHERE id = $1`, [m.account_id])).rows[0];
      over.push({ account_id: m.account_id, code: a.code, name: a.name, budget: new Money5(b.total).toFixed(2), actual: new Money5(actual).toFixed(2), committed: new Money5(committed).toFixed(2), this_po: new Money5(m.amount).toFixed(2), available: available.toFixed(2), excess: new Money5(m.amount).sub(available).toFixed(2) });
    }
  }
  return over;
}
function spreadEven(annual) {
  const total = new Money5(annual).round(2);
  const m = total.div(12).round(2);
  const out = Array.from({ length: 11 }, () => m.toFixed(2));
  out.push(total.sub(m.mul(11)).toFixed(2));
  return out;
}
function variance(cls, budget, actual) {
  const v = new Money5(actual).sub(budget);
  const fav = cls === "REVENUE" ? v : v.negated();
  const pct = new Money5(budget).isZero() ? null : fav.div(budget).mul(100).round(1).toFixed(1);
  return { variance: fav.toFixed(2), variance_pct: pct, favourable: !fav.isNegative() };
}
async function copyLines(q, from, to, org) {
  await q.query(`INSERT INTO epm_budget_lines (organization_id, budget_id, account_id, period_month, amount) SELECT organization_id, $2, account_id, period_month, amount FROM epm_budget_lines WHERE budget_id = $1 AND organization_id = $3`, [from, to, org]);
}
function registerBudgetRoutes(app) {
  defineResource(app, {
    path: "/api/epm/budgets",
    table: "epm_budgets",
    label: "Budget",
    event: "BUDGET",
    module: "EPM",
    view: VIEW,
    create: Permission5.BUDGET_MANAGE,
    update: Permission5.BUDGET_MANAGE,
    fields: {
      code: { type: "string", required: true, max: 32, pattern: /^[A-Z0-9-]+$/ },
      name: { type: "string", required: true },
      fiscal_year: { type: "int", required: true, min: 2e3, max: 2100 },
      scenario: { type: "enum", values: ["BUDGET", "FORECAST"], default: "BUDGET" },
      notes: { type: "text" },
      copy_from_id: { type: "ref", table: "epm_budgets", label: "copy_from_id" }
    },
    editable: ["name", "notes"],
    editableIn: ["DRAFT"],
    initialStatus: "DRAFT",
    select: `t.*, (SELECT COALESCE(SUM(amount),0) FROM epm_budget_lines l WHERE l.budget_id = t.id) AS total_amount,
      (SELECT COUNT(DISTINCT account_id)::int FROM epm_budget_lines l WHERE l.budget_id = t.id) AS accounts`,
    search: ["code", "t.name"],
    filters: ["fiscal_year"],
    orderBy: "t.fiscal_year DESC, t.code, t.version DESC",
    beforeCreate: async (ctx, v) => {
      const dup = await ctx.tx.query(`SELECT 1 FROM epm_budgets WHERE organization_id = $1 AND code = $2`, [ctx.org, v.code]);
      if (dup.rows.length)
        throw new ApiError(409, ErrorCode14.DUPLICATE_RESOURCE, `Budget ${v.code} exists \u2014 revise it to create a new version`);
      ctx._copyFrom = v.copy_from_id;
      delete v.copy_from_id;
    },
    afterCreate: async (ctx, row) => {
      if (ctx._copyFrom)
        await copyLines(ctx.tx, ctx._copyFrom, row.id, ctx.org);
    },
    detail: async (q, row) => ({
      lines: (await q.query(`SELECT l.account_id, a.code AS account_code, a.name AS account_name, a.statement_class, l.period_month, l.amount FROM epm_budget_lines l JOIN accounts a ON a.id = l.account_id WHERE l.budget_id = $1 ORDER BY a.code, l.period_month`, [row.id])).rows,
      versions: (await q.query(`SELECT id, version, status, approved_at FROM epm_budgets WHERE organization_id = $1 AND code = $2 ORDER BY version DESC`, [row.organization_id, row.code])).rows
    }),
    commands: {
      submit: {
        from: ["DRAFT"],
        to: "SUBMITTED",
        permission: Permission5.BUDGET_MANAGE,
        run: async (ctx, row) => {
          const n = (await ctx.tx.query(`SELECT COUNT(*)::int n FROM epm_budget_lines WHERE budget_id = $1`, [row.id])).rows[0].n;
          if (!n)
            throw validationError("Add at least one budget line before submitting");
          return { set: { submitted_by: ctx.user, submitted_at: (/* @__PURE__ */ new Date()).toISOString() } };
        }
      },
      reject: { from: ["SUBMITTED"], to: "DRAFT", permission: Permission5.BUDGET_APPROVE, fields: { notes: { type: "text", required: true } }, run: async (_c, _r, i) => ({ set: { notes: i.notes, submitted_by: null, submitted_at: null } }) },
      approve: {
        from: ["SUBMITTED"],
        to: "APPROVED",
        permission: Permission5.BUDGET_APPROVE,
        sodColumn: "submitted_by",
        run: async (ctx, row) => {
          await ctx.tx.query(`UPDATE epm_budgets SET status = 'SUPERSEDED', updated_at = NOW() WHERE organization_id = $1 AND code = $2 AND id <> $3 AND status = 'APPROVED'`, [ctx.org, row.code, row.id]);
          return { set: { approved_by: ctx.user, approved_at: (/* @__PURE__ */ new Date()).toISOString() } };
        }
      },
      archive: { from: ["DRAFT", "SUPERSEDED"], to: "ARCHIVED", permission: Permission5.BUDGET_MANAGE }
    }
  });
  app.post("/api/epm/budgets/:id/revise", authenticate, requireAnyPermission(Permission5.BUDGET_MANAGE), requireModule("EPM", "command"), async (req, res) => {
    const out = await unitOfWork(req, async (ctx) => {
      const b = await loadRow(ctx.tx, "epm_budgets", req.params.id, ctx.org, "Budget", true);
      if (b.status !== "APPROVED")
        throw new ApiError(409, ErrorCode14.INVALID_STATE, "Only the approved version can be revised");
      const open = await ctx.tx.query(`SELECT version FROM epm_budgets WHERE organization_id = $1 AND code = $2 AND status IN ('DRAFT','SUBMITTED')`, [ctx.org, b.code]);
      if (open.rows.length)
        throw new ApiError(409, ErrorCode14.INVALID_STATE, `Version ${open.rows[0].version} is already open for revision`);
      const v = (await ctx.tx.query(`SELECT MAX(version)::int m FROM epm_budgets WHERE organization_id = $1 AND code = $2`, [ctx.org, b.code])).rows[0].m + 1;
      const r = await ctx.tx.query(`INSERT INTO epm_budgets (organization_id, legal_entity_id, code, name, fiscal_year, scenario, version, supersedes_id, notes, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'DRAFT',$10) RETURNING *`, [ctx.org, b.legal_entity_id, b.code, b.name, b.fiscal_year, b.scenario, v, b.id, req.body?.notes ?? null, ctx.user]);
      await copyLines(ctx.tx, b.id, r.rows[0].id, ctx.org);
      await audit2(ctx, "REVISE", "BUDGET", r.rows[0].id, { from: b.id }, { version: v });
      await emit(ctx, "BUDGET_REVISED", { budget_id: r.rows[0].id, code: b.code, version: v });
      return r.rows[0];
    });
    return ok(req, res, out, 201);
  });
  app.post("/api/epm/budgets/:id/lines", authenticate, requireAnyPermission(Permission5.BUDGET_MANAGE), requireModule("EPM", "command"), async (req, res) => {
    const lines = req.body?.lines;
    if (!Array.isArray(lines) || !lines.length || lines.length > 500)
      throw validationError("lines must be a non-empty array (\u2264 500)", { field: "lines" });
    const out = await unitOfWork(req, async (ctx) => {
      const b = await loadRow(ctx.tx, "epm_budgets", req.params.id, ctx.org, "Budget", true);
      if (b.status !== "DRAFT")
        throw new ApiError(409, ErrorCode14.BUDGET_LOCKED, `Budget ${b.code} v${b.version} is ${b.status.toLowerCase()} \u2014 revise it to change figures`);
      let n = 0;
      for (const [idx, l] of lines.entries()) {
        const acc = (await ctx.tx.query(`SELECT id, code, statement_class, posting_allowed FROM accounts WHERE id = $1 AND organization_id = $2`, [l?.account_id, ctx.org])).rows[0];
        if (!acc)
          throw validationError(`lines[${idx}].account_id not found`, { field: `lines[${idx}].account_id` });
        if (!acc.posting_allowed || !["REVENUE", "EXPENSE"].includes(acc.statement_class))
          throw validationError(`Account ${acc.code} must be a posting revenue or expense account`, { field: `lines[${idx}].account_id` });
        let months;
        if (Array.isArray(l.months)) {
          if (l.months.length !== 12)
            throw validationError(`lines[${idx}].months needs 12 values`, { field: `lines[${idx}].months` });
          months = l.months.map((m, k) => {
            if (!/^\d+(\.\d{1,2})?$/.test(String(m ?? "")))
              throw validationError(`lines[${idx}].months[${k}] must be a non-negative amount`, { field: `lines[${idx}].months` });
            return new Money5(String(m)).toFixed(2);
          });
        } else if (l.annual !== void 0) {
          if (!/^\d+(\.\d{1,2})?$/.test(String(l.annual)))
            throw validationError(`lines[${idx}].annual must be a non-negative amount`, { field: `lines[${idx}].annual` });
          months = spreadEven(String(l.annual));
        } else
          throw validationError(`lines[${idx}] needs months or annual`, { field: `lines[${idx}]` });
        for (let m = 0; m < 12; m++) {
          await ctx.tx.query(`INSERT INTO epm_budget_lines (organization_id, budget_id, account_id, period_month, amount) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (budget_id, account_id, period_month) DO UPDATE SET amount = EXCLUDED.amount`, [ctx.org, b.id, acc.id, m + 1, months[m]]);
        }
        n++;
      }
      await ctx.tx.query(`UPDATE epm_budgets SET revision = revision + 1, updated_at = NOW() WHERE id = $1`, [b.id]);
      await audit2(ctx, "UPDATE_LINES", "BUDGET", b.id, void 0, { accounts: n });
      return { budget_id: b.id, accounts_updated: n };
    });
    return ok(req, res, out);
  });
  app.get("/api/epm/budgets/:id/variance", authenticate, requireAnyPermission(...VIEW), async (req, res) => {
    const org = req.session.organization_id;
    const b = await loadRow(db, "epm_budgets", req.params.id, org, "Budget");
    const through = req.query.through_month ? int(req.query.through_month, "through_month", { min: 1, max: 12 }) : 12;
    const from = `${b.fiscal_year}-01-01`;
    const to = new Date(Date.UTC(b.fiscal_year, through, 0)).toISOString().slice(0, 10);
    const budget = (await db.query(`SELECT a.id, a.code, a.name, a.statement_class, SUM(l.amount)::text amt FROM epm_budget_lines l JOIN accounts a ON a.id = l.account_id WHERE l.budget_id = $1 AND l.period_month <= $2 GROUP BY a.id, a.code, a.name, a.statement_class`, [b.id, through])).rows;
    const actual = (await db.query(`SELECT a.id, a.code, a.name, a.statement_class, SUM(jl.base_debit)::text d, SUM(jl.base_credit)::text c FROM journal_lines jl JOIN journals j ON j.id = jl.journal_id JOIN accounts a ON a.id = jl.account_id
       WHERE j.organization_id = $1 AND j.status = 'POSTED' AND j.posting_date BETWEEN $2 AND $3 AND a.statement_class IN ('REVENUE','EXPENSE') GROUP BY a.id, a.code, a.name, a.statement_class`, [org, from, to])).rows;
    const map = /* @__PURE__ */ new Map();
    for (const r of budget)
      map.set(r.id, { account_id: r.id, code: r.code, name: r.name, statement_class: r.statement_class, budget: r.amt, actual: "0" });
    for (const r of actual) {
      const amt = r.statement_class === "REVENUE" ? new Money5(r.c).sub(r.d) : new Money5(r.d).sub(r.c);
      const e = map.get(r.id) || { account_id: r.id, code: r.code, name: r.name, statement_class: r.statement_class, budget: "0" };
      e.actual = amt.toFixed(2);
      map.set(r.id, e);
    }
    const rows = [...map.values()].map((e) => ({ ...e, budget: new Money5(e.budget).toFixed(2), ...variance(e.statement_class, e.budget, e.actual), unbudgeted: new Money5(e.budget).isZero() && !new Money5(e.actual).isZero() })).sort((a, b2) => a.code.localeCompare(b2.code));
    const tot = (cls, k) => rows.filter((r) => r.statement_class === cls).reduce((a, r) => a.add(r[k]), Money5.zero());
    const totals = {
      revenue_budget: tot("REVENUE", "budget").toFixed(2),
      revenue_actual: tot("REVENUE", "actual").toFixed(2),
      expense_budget: tot("EXPENSE", "budget").toFixed(2),
      expense_actual: tot("EXPENSE", "actual").toFixed(2),
      profit_budget: tot("REVENUE", "budget").sub(tot("EXPENSE", "budget")).toFixed(2),
      profit_actual: tot("REVENUE", "actual").sub(tot("EXPENSE", "actual")).toFixed(2)
    };
    return ok(req, res, { budget: { id: b.id, code: b.code, version: b.version, status: b.status, fiscal_year: b.fiscal_year }, through_month: through, period: { from, to }, rows, totals });
  });
  app.get("/api/epm/summary", authenticate, requireAnyPermission(...VIEW), async (req, res) => {
    const org = req.session.organization_id;
    const r = (await db.query(`SELECT status, COUNT(*)::int n FROM epm_budgets WHERE organization_id = $1 GROUP BY status`, [org])).rows;
    const by = Object.fromEntries(r.map((x) => [x.status, x.n]));
    const live = (await db.query(`SELECT COALESCE(SUM(l.amount),0)::text t FROM epm_budget_lines l JOIN epm_budgets b ON b.id = l.budget_id JOIN accounts a ON a.id = l.account_id WHERE b.organization_id = $1 AND b.status = 'APPROVED' AND b.fiscal_year = EXTRACT(YEAR FROM CURRENT_DATE) AND a.statement_class = 'EXPENSE'`, [org])).rows[0].t;
    return ok(req, res, { draft: by.DRAFT || 0, submitted: by.SUBMITTED || 0, approved: by.APPROVED || 0, approved_expense_budget: new Money5(live).toFixed(2) });
  });
}

// apps/api/dist/routes/procurement.js
init_config();

// apps/api/dist/routes/supplier.js
init_context();
init_http();
init_errors();
init_resource();
init_validate();
import { Permission as Permission7, ErrorCode as ErrorCode16 } from "@omnysync/contracts";
var VIEW2 = [Permission7.SUPPLIER_VIEW, Permission7.SUPPLIER_MANAGE, Permission7.SUPPLIER_APPROVE];
var WEIGHTS = { quality: 40, delivery: 30, price: 20, service: 10 };
function weightedScore(s) {
  const v = (s.quality * WEIGHTS.quality + s.delivery * WEIGHTS.delivery + s.price * WEIGHTS.price + s.service * WEIGHTS.service) / 100;
  const score2 = Math.round(v * 100) / 100;
  const grade = score2 >= 85 ? "A" : score2 >= 70 ? "B" : score2 >= 50 ? "C" : "D";
  return { weighted_score: score2.toFixed(2), grade };
}
async function assertSupplierUsable(q, org, partyId) {
  const r = await q.query(`SELECT status, status_reason FROM sup_profiles WHERE organization_id = $1 AND party_id = $2`, [org, partyId]);
  const p = r.rows[0];
  if (p && ["BLOCKED", "SUSPENDED", "REJECTED"].includes(p.status)) {
    throw new ApiError(409, ErrorCode16.INVALID_STATE, `Supplier is ${p.status.toLowerCase()}${p.status_reason ? `: ${p.status_reason}` : ""} \u2014 purchase orders are not allowed`, { field: "party_id", supplier_status: p.status });
  }
}
async function missingCertificates(q, profile, onDate) {
  const required = (typeof profile.required_certificates === "string" ? JSON.parse(profile.required_certificates) : profile.required_certificates) || [];
  const have = (await q.query(`SELECT cert_type FROM sup_certificates WHERE profile_id = $1 AND status = 'ACTIVE' AND (expires_on IS NULL OR expires_on >= $2)`, [profile.id, onDate])).rows.map((r) => r.cert_type);
  return required.filter((c) => !have.includes(c));
}
async function deliveryPerformance(q, org, partyId, period) {
  const r = await q.query(`SELECT po.id, po.expected_date, MIN(sm.movement_date) AS first_receipt
     FROM purchase_orders po JOIN stock_movements sm ON sm.reference_id = po.id AND sm.reference_type = 'PURCHASE_ORDER' AND sm.movement_type = 'RECEIPT'
     WHERE po.organization_id = $1 AND po.party_id = $2 AND po.expected_date IS NOT NULL AND to_char(po.expected_date, 'YYYY-MM') = $3
     GROUP BY po.id, po.expected_date`, [org, partyId, period]);
  const total = r.rows.length;
  const onTime = r.rows.filter((x) => toIsoDate(x.first_receipt) <= toIsoDate(x.expected_date)).length;
  return { total, onTime, score: total ? Math.round(onTime / total * 100) : null };
}
async function qualityPerformance(q, org, partyId, period) {
  const r = await q.query(`SELECT status, quantity::text FROM quality_inspection_lots
     WHERE organization_id = $1 AND party_id = $2 AND status IN ('ACCEPTED','CONDITIONALLY_ACCEPTED','REJECTED')
       AND inspected_at IS NOT NULL AND to_char(inspected_at AT TIME ZONE 'Asia/Karachi', 'YYYY-MM') = $3`, [org, partyId, period]);
  let total = 0;
  let good = 0;
  for (const l of r.rows) {
    const qn = Number(l.quantity);
    total += qn;
    good += l.status === "ACCEPTED" ? qn : l.status === "CONDITIONALLY_ACCEPTED" ? qn / 2 : 0;
  }
  return { lots: r.rows.length, rejected: r.rows.filter((l) => l.status === "REJECTED").length, score: total > 0 ? Math.round(good / total * 100) : null };
}
function priceScoreFromIndex(index) {
  return Math.max(0, Math.min(100, Math.round(100 - (index - 1) * 200)));
}
async function pricePerformance(q, org, partyId, period) {
  const end = `${period}-01`;
  const r = await q.query(`WITH mine AS (
       SELECT l.item_id, SUM(l.quantity) qty, SUM(l.quantity * l.unit_price) val
       FROM purchase_order_lines l JOIN purchase_orders po ON po.id = l.purchase_order_id
       WHERE po.organization_id = $1 AND po.party_id = $2 AND po.status NOT IN ('DRAFT','CANCELLED') AND to_char(po.po_date, 'YYYY-MM') = $3
       GROUP BY l.item_id),
     market AS (
       SELECT l.item_id, SUM(l.quantity * l.unit_price) / NULLIF(SUM(l.quantity), 0) avg_price
       FROM purchase_order_lines l JOIN purchase_orders po ON po.id = l.purchase_order_id
       WHERE po.organization_id = $1 AND po.status NOT IN ('DRAFT','CANCELLED')
         AND po.po_date >= ($4::date - INTERVAL '11 months') AND po.po_date < ($4::date + INTERVAL '1 month')
       GROUP BY l.item_id)
     SELECT COALESCE(SUM(m.val), 0)::text paid, COALESCE(SUM(m.qty * k.avg_price), 0)::text benchmark, COUNT(*)::int items
     FROM mine m JOIN market k ON k.item_id = m.item_id`, [org, partyId, period, end]);
  const row = r.rows[0];
  const bench = Number(row.benchmark);
  if (!row.items || !(bench > 0))
    return { index: null, score: null, items: 0 };
  const index = Math.round(Number(row.paid) / bench * 1e4) / 1e4;
  return { index, score: priceScoreFromIndex(index), items: row.items };
}
function registerSupplierRoutes(app) {
  defineResource(app, {
    path: "/api/sup/profiles",
    table: "sup_profiles",
    label: "Supplier profile",
    event: "SUPPLIER",
    module: "SUP",
    view: VIEW2,
    create: Permission7.SUPPLIER_MANAGE,
    update: Permission7.SUPPLIER_MANAGE,
    fields: {
      party_id: { type: "ref", table: "parties", required: true, label: "party_id" },
      category: { type: "enum", values: ["EQUIPMENT", "SPARE_PARTS", "REFRIGERANT", "SUBCONTRACTOR", "LOGISTICS", "SERVICES", "OTHER"], required: true },
      risk_level: { type: "enum", values: ["LOW", "MEDIUM", "HIGH"], default: "MEDIUM" },
      required_certificates: { type: "json" },
      contact_name: { type: "string" },
      notes: { type: "text" }
    },
    editable: ["risk_level", "required_certificates", "contact_name", "notes", "category"],
    initialStatus: "PROSPECT",
    select: `t.*, p.code AS party_code, p.name AS party_name,
      (SELECT COUNT(*)::int FROM sup_certificates c WHERE c.profile_id = t.id AND c.status = 'ACTIVE' AND c.expires_on < CURRENT_DATE + 30) AS certs_expiring,
      (SELECT s.weighted_score FROM sup_scorecards s WHERE s.profile_id = t.id AND s.status = 'FINAL' ORDER BY s.period DESC LIMIT 1) AS latest_score,
      (SELECT s.grade FROM sup_scorecards s WHERE s.profile_id = t.id AND s.status = 'FINAL' ORDER BY s.period DESC LIMIT 1) AS latest_grade`,
    joins: "JOIN parties p ON p.id = t.party_id",
    search: ["p.name", "p.code", "contact_name"],
    filters: ["category", "risk_level"],
    orderBy: "p.name",
    detail: async (q, row) => ({
      certificates: (await q.query(`SELECT *, (expires_on IS NOT NULL AND expires_on < CURRENT_DATE) AS expired FROM sup_certificates WHERE profile_id = $1 ORDER BY cert_type`, [row.id])).rows,
      scorecards: (await q.query(`SELECT * FROM sup_scorecards WHERE profile_id = $1 ORDER BY period DESC`, [row.id])).rows,
      missing_certificates: await missingCertificates(q, row, todayIso())
    }),
    beforeCreate: async (ctx, v) => {
      const p = await loadRow(ctx.tx, "parties", v.party_id, ctx.org, "Party");
      if (!["VENDOR", "BOTH"].includes(p.party_type))
        throw validationError("Party is not a vendor", { field: "party_id" });
      const ex = await ctx.tx.query(`SELECT id FROM sup_profiles WHERE organization_id = $1 AND party_id = $2`, [ctx.org, v.party_id]);
      if (ex.rows[0])
        throw new ApiError(409, ErrorCode16.DUPLICATE_RESOURCE, "This vendor already has a supplier profile", { existing_id: ex.rows[0].id });
      if (v.required_certificates) {
        const list = JSON.parse(v.required_certificates);
        const allowed = ["NTN", "STRN", "ISO9001", "ISO14001", "OEM_AUTHORISATION", "INSURANCE", "SAFETY", "BANK_LETTER", "OTHER"];
        if (!Array.isArray(list) || list.some((c) => typeof c !== "string" || !allowed.includes(c)))
          throw validationError(`required_certificates must be a list of ${allowed.join(", ")}`, { field: "required_certificates" });
      }
    },
    commands: {
      submit: { from: ["PROSPECT", "REJECTED"], to: "UNDER_REVIEW", permission: Permission7.SUPPLIER_MANAGE, run: async (ctx) => ({ set: { submitted_by: ctx.user, status_reason: null } }) },
      approve: {
        from: ["UNDER_REVIEW"],
        to: "APPROVED",
        permission: Permission7.SUPPLIER_APPROVE,
        sodColumn: "submitted_by",
        run: async (ctx, row) => {
          const missing = await missingCertificates(ctx.tx, row, todayIso());
          if (missing.length)
            throw new ApiError(409, ErrorCode16.CHECKLIST_INCOMPLETE, `Missing or expired certificates: ${missing.join(", ")}`, { missing });
          return { set: { approved_by: ctx.user, approved_at: (/* @__PURE__ */ new Date()).toISOString() } };
        }
      },
      reject: { from: ["UNDER_REVIEW"], to: "REJECTED", permission: Permission7.SUPPLIER_APPROVE, fields: { status_reason: { type: "text", required: true } }, run: async (_c, _r, i) => ({ set: { status_reason: i.status_reason } }) },
      suspend: { from: ["APPROVED"], to: "SUSPENDED", permission: Permission7.SUPPLIER_APPROVE, fields: { status_reason: { type: "text", required: true } }, run: async (_c, _r, i) => ({ set: { status_reason: i.status_reason } }) },
      block: { from: ["PROSPECT", "UNDER_REVIEW", "APPROVED", "SUSPENDED"], to: "BLOCKED", permission: Permission7.SUPPLIER_APPROVE, fields: { status_reason: { type: "text", required: true } }, run: async (_c, _r, i) => ({ set: { status_reason: i.status_reason } }) },
      reinstate: {
        from: ["SUSPENDED", "BLOCKED"],
        to: "UNDER_REVIEW",
        permission: Permission7.SUPPLIER_APPROVE,
        fields: { status_reason: { type: "text", required: true } },
        run: async (ctx, _r, i) => ({ set: { status_reason: i.status_reason, submitted_by: ctx.user } })
      }
    }
  });
  defineResource(app, {
    path: "/api/sup/certificates",
    table: "sup_certificates",
    label: "Certificate",
    event: "SUPPLIER_CERT",
    module: "SUP",
    view: VIEW2,
    create: Permission7.SUPPLIER_MANAGE,
    update: Permission7.SUPPLIER_MANAGE,
    fields: {
      profile_id: { type: "ref", table: "sup_profiles", required: true, label: "profile_id" },
      cert_type: { type: "enum", values: ["NTN", "STRN", "ISO9001", "ISO14001", "OEM_AUTHORISATION", "INSURANCE", "SAFETY", "BANK_LETTER", "OTHER"], required: true },
      reference: { type: "string", required: true, max: 120 },
      issued_on: { type: "date" },
      expires_on: { type: "date" }
    },
    editable: ["reference", "expires_on"],
    editableIn: ["ACTIVE"],
    initialStatus: "ACTIVE",
    select: `t.*, p.name AS supplier_name, (t.expires_on IS NOT NULL AND t.expires_on < CURRENT_DATE) AS expired, (t.expires_on - CURRENT_DATE) AS days_to_expiry`,
    joins: "JOIN sup_profiles sp ON sp.id = t.profile_id JOIN parties p ON p.id = sp.party_id",
    search: ["reference", "p.name"],
    filters: ["profile_id", "cert_type"],
    orderBy: "t.expires_on NULLS LAST",
    beforeCreate: async (_ctx, v) => {
      if (v.issued_on && v.expires_on && v.expires_on < v.issued_on)
        throw validationError("expires_on must be on or after issued_on", { field: "expires_on" });
    },
    commands: { revoke: { from: ["ACTIVE"], to: "REVOKED", permission: Permission7.SUPPLIER_MANAGE } }
  });
  defineResource(app, {
    path: "/api/sup/scorecards",
    table: "sup_scorecards",
    label: "Scorecard",
    event: "SUPPLIER_SCORECARD",
    module: "SUP",
    view: VIEW2,
    create: Permission7.SUPPLIER_MANAGE,
    update: Permission7.SUPPLIER_MANAGE,
    fields: {
      profile_id: { type: "ref", table: "sup_profiles", required: true, label: "profile_id" },
      period: { type: "string", required: true, max: 7, pattern: /^\d{4}-(0[1-9]|1[0-2])$/ },
      quality_score: { type: "int", min: 0, max: 100 },
      delivery_score: { type: "int", min: 0, max: 100 },
      price_score: { type: "int", min: 0, max: 100 },
      service_score: { type: "int", required: true, min: 0, max: 100 },
      comments: { type: "text" }
    },
    editable: ["quality_score", "delivery_score", "price_score", "service_score", "comments"],
    editableIn: ["DRAFT"],
    initialStatus: "DRAFT",
    select: `t.*, p.name AS supplier_name`,
    joins: "JOIN sup_profiles sp ON sp.id = t.profile_id JOIN parties p ON p.id = sp.party_id",
    search: ["p.name", "period"],
    filters: ["profile_id", "grade"],
    orderBy: "t.period DESC, t.weighted_score DESC",
    beforeCreate: async (ctx, v) => {
      const prof = await loadRow(ctx.tx, "sup_profiles", v.profile_id, ctx.org, "Supplier profile");
      const dup = await ctx.tx.query(`SELECT id FROM sup_scorecards WHERE profile_id = $1 AND period = $2`, [v.profile_id, v.period]);
      if (dup.rows[0])
        throw new ApiError(409, ErrorCode16.DUPLICATE_RESOURCE, `A scorecard for ${v.period} already exists`, { existing_id: dup.rows[0].id });
      const perf = await deliveryPerformance(ctx.tx, ctx.org, prof.party_id, v.period);
      if (v.delivery_score == null) {
        if (perf.score == null)
          throw validationError("No receipts against POs due in this period \u2014 enter a delivery score", { field: "delivery_score" });
        v.delivery_score = perf.score;
      }
      const qual = await qualityPerformance(ctx.tx, ctx.org, prof.party_id, v.period);
      if (v.quality_score == null) {
        if (qual.score == null)
          throw validationError("No receiving inspections decided for this supplier in this period \u2014 enter a quality score", { field: "quality_score" });
        v.quality_score = qual.score;
      }
      v.inspected_lots = qual.lots;
      v.rejected_lots = qual.rejected;
      const price = await pricePerformance(ctx.tx, ctx.org, prof.party_id, v.period);
      if (v.price_score == null) {
        if (price.score == null)
          throw validationError("No purchase orders in this period to benchmark \u2014 enter a price score", { field: "price_score" });
        v.price_score = price.score;
      }
      v.price_index = price.index == null ? null : price.index.toFixed(4);
      v.on_time_receipts = perf.onTime;
      v.total_receipts = perf.total;
      Object.assign(v, weightedScore({ quality: v.quality_score, delivery: v.delivery_score, price: v.price_score, service: v.service_score }));
    },
    beforeUpdate: async (_ctx, row, v) => {
      Object.assign(v, weightedScore({ quality: v.quality_score ?? row.quality_score, delivery: v.delivery_score ?? row.delivery_score, price: v.price_score ?? row.price_score, service: v.service_score ?? row.service_score }));
    },
    commands: { finalise: { from: ["DRAFT"], to: "FINAL", permission: Permission7.SUPPLIER_MANAGE } }
  });
  app.get("/api/sup/summary", authenticate, requireAnyPermission(...VIEW2), async (req, res) => {
    const org = req.session.organization_id;
    const s = (await db.query(`SELECT status, COUNT(*)::int n FROM sup_profiles WHERE organization_id = $1 GROUP BY status`, [org])).rows;
    const exp = (await db.query(`SELECT COUNT(*) FILTER (WHERE expires_on < CURRENT_DATE)::int expired, COUNT(*) FILTER (WHERE expires_on >= CURRENT_DATE AND expires_on < CURRENT_DATE + 30)::int expiring FROM sup_certificates WHERE organization_id = $1 AND status = 'ACTIVE'`, [org])).rows[0];
    const avg = (await db.query(`SELECT ROUND(AVG(weighted_score), 1)::text avg FROM sup_scorecards WHERE organization_id = $1 AND status = 'FINAL'`, [org])).rows[0].avg;
    return ok(req, res, { by_status: Object.fromEntries(s.map((r) => [r.status, r.n])), certificates: exp, average_score: avg });
  });
}

// apps/api/dist/routes/procurement.js
init_context();
init_http();
init_errors();
init_validate();
init_scope();
init_state();
init_posting();
init_numbering();
init_stock();
import crypto7 from "node:crypto";
import { Money as Money6 } from "@omnysync/financial-engine";
import { AccountingPurpose as AccountingPurpose3, ErrorCode as ErrorCode17, Permission as Permission8 } from "@omnysync/contracts";
var PO_READ = [Permission8.PURCHASE_ORDER_MANAGE, Permission8.AP_INVOICE_MANAGE, Permission8.INVENTORY_MANAGE, Permission8.PAYMENT_MANAGE, Permission8.FINANCE_REPORTS_VIEW];
var AP_READ = [Permission8.AP_INVOICE_MANAGE, Permission8.PAYMENT_MANAGE, Permission8.PURCHASE_ORDER_MANAGE, Permission8.FINANCE_REPORTS_VIEW];
async function audit3(req, tx, action, type, id, before, after) {
  await auditLogger.record({ organization_id: req.session.organization_id, user_id: req.session.user_id, action, entity_type: type, entity_id: id, before_state: before, after_state: after, correlation_id: req.correlationId }, tx);
}
function registerProcurementRoutes(app) {
  const poRead = requireAnyPermission(...PO_READ);
  const apRead = requireAnyPermission(...AP_READ);
  app.get("/api/procurement/orders", authenticate, poRead, async (req, res) => {
    const { limit, offset } = pagination(req.query);
    const r = await db.query(`SELECT po.*, p.name as party_name, p.code as party_code FROM purchase_orders po JOIN parties p ON p.id = po.party_id
       WHERE po.organization_id = $1 ORDER BY po.po_date DESC, po.created_at DESC LIMIT ${limit} OFFSET ${offset}`, [req.session.organization_id]);
    for (const po of r.rows) {
      po.lines = (await db.query(`SELECT pol.*, i.code as item_code, i.name as item_name FROM purchase_order_lines pol JOIN items i ON i.id = pol.item_id WHERE pol.purchase_order_id = $1 ORDER BY line_number`, [po.id])).rows;
    }
    return ok(req, res, r.rows, 200, { total_count: r.rows.length, limit, offset });
  });
  app.post("/api/procurement/orders", authenticate, requirePermission(Permission8.PURCHASE_ORDER_MANAGE), async (req, res) => {
    const org = req.session.organization_id;
    const party_id = uuid(req.body?.party_id, "party_id");
    const po_date = dateOnly(req.body?.po_date, "po_date", { defaultValue: todayIso() });
    const expected_date = optionalDate(req.body?.expected_date, "expected_date");
    if (expected_date && expected_date < po_date)
      throw validationError("expected_date cannot be before po_date", { field: "expected_date" });
    const warehouse_id = optionalUuid(req.body?.warehouse_id, "warehouse_id");
    await assertOrgRef(db, "warehouses", warehouse_id, org, "warehouse_id");
    await requireParty(db, org, party_id, "VENDOR");
    await assertSupplierUsable(db, org, party_id);
    const priced = await priceLines(db, org, parseLines(req.body?.lines));
    const poId = crypto7.randomUUID();
    const out = await db.transaction(async (tx) => {
      const poNumber = optionalStr(req.body?.po_number, "po_number", 64) || await nextDocumentNumber(tx, org, "PO", po_date);
      await tx.query(`INSERT INTO purchase_orders (id, organization_id, legal_entity_id, party_id, po_number, po_date, expected_date, status, subtotal, tax_amount, total_amount, notes, created_by, warehouse_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'DRAFT', $8, $9, $10, $11, $12, $13)`, [poId, org, req.session.legal_entity_id, party_id, poNumber, po_date, expected_date, priced.subtotal, priced.tax_amount, priced.total_amount, optionalStr(req.body?.notes, "notes"), req.session.user_id, warehouse_id]);
      for (const l of priced.lines) {
        await tx.query(`INSERT INTO purchase_order_lines (id, purchase_order_id, line_number, item_id, quantity, unit_price, line_total, tax_amount, description)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [crypto7.randomUUID(), poId, l.line_number, l.item_id, l.quantity, l.unit_price, l.line_total, l.tax_amount, l.description]);
      }
      await audit3(req, tx, "PURCHASE_ORDER_CREATED", "PURCHASE_ORDER", poId, void 0, { po_number: poNumber, total_amount: priced.total_amount });
      return { id: poId, po_number: poNumber, status: "DRAFT", subtotal: new Money6(priced.subtotal).format(), total_amount: new Money6(priced.total_amount).format() };
    });
    return ok(req, res, out, 201);
  });
  app.post("/api/procurement/orders/:id/approve", authenticate, requirePermission(Permission8.PURCHASE_ORDER_MANAGE), async (req, res) => {
    const org = req.session.organization_id;
    const out = await db.transaction(async (tx) => {
      const po = await requireOrgRow(tx, "purchase_orders", req.params.id, org, "Purchase order", { forUpdate: true });
      if (po.created_by === req.session.user_id)
        throw sodViolation("Segregation of duties: the requester cannot approve their own purchase order");
      const control = await getSetting(tx, org, "epm.po_budget_control");
      const overBudget = control === "OFF" ? [] : await poBudgetCheck(tx, org, po.id);
      if (overBudget.length && control === "BLOCK") {
        const o = overBudget[0];
        throw new ApiError(409, ErrorCode17.BUDGET_EXCEEDED, `Over budget on ${o.code} ${o.name}: available ${o.available}, this PO ${o.this_po}`, { over_budget: overBudget });
      }
      await transition(tx, { table: "purchase_orders", id: po.id, organizationId: org, from: ["DRAFT"], to: "APPROVED", label: "Purchase order", set: { approved_by: req.session.user_id, updated_at: (/* @__PURE__ */ new Date()).toISOString() } });
      await audit3(req, tx, "PURCHASE_ORDER_APPROVED", "PURCHASE_ORDER", po.id, { status: po.status }, { status: "APPROVED", ...overBudget.length ? { over_budget: overBudget } : {} });
      return { id: po.id, status: "APPROVED", budget_warnings: overBudget };
    });
    return ok(req, res, out);
  });
  app.post("/api/procurement/orders/:id/cancel", authenticate, requirePermission(Permission8.PURCHASE_ORDER_MANAGE), async (req, res) => {
    const reason = str(req.body?.reason, "reason", { max: 500 });
    const out = await db.transaction(async (tx) => {
      const po = await requireOrgRow(tx, "purchase_orders", req.params.id, req.session.organization_id, "Purchase order", { forUpdate: true });
      const received = await tx.query(`SELECT 1 FROM purchase_order_lines WHERE purchase_order_id = $1 AND received_quantity > 0 LIMIT 1`, [po.id]);
      if (received.rows.length)
        throw new ApiError(409, ErrorCode17.INVALID_STATE, "Purchase orders with receipts cannot be cancelled");
      await transition(tx, { table: "purchase_orders", id: po.id, organizationId: req.session.organization_id, from: ["DRAFT", "APPROVED"], to: "CANCELLED", label: "Purchase order" });
      await audit3(req, tx, "PURCHASE_ORDER_CANCELLED", "PURCHASE_ORDER", po.id, void 0, { reason });
      return { id: po.id, status: "CANCELLED" };
    });
    return ok(req, res, out);
  });
  app.post("/api/procurement/orders/:id/receive", authenticate, requirePermission(Permission8.INVENTORY_MANAGE), async (req, res) => {
    const org = req.session.organization_id;
    const receipt_date = dateOnly(req.body?.receipt_date, "receipt_date", { defaultValue: todayIso() });
    const bodyWarehouse = optionalUuid(req.body?.warehouse_id, "warehouse_id");
    await assertOrgRef(db, "warehouses", bodyWarehouse, org, "warehouse_id");
    const requested = req.body?.lines ? arrayOf(req.body.lines, "lines", { min: 1, max: 500 }).map((l, i) => ({ line_id: uuid(l?.line_id, `lines[${i}].line_id`), quantity: decimal(l?.quantity, `lines[${i}].quantity`, { sign: "positive" }) })) : null;
    const out = await db.transaction(async (tx) => {
      const po = await requireOrgRow(tx, "purchase_orders", req.params.id, org, "Purchase order", { forUpdate: true });
      if (po.status !== "APPROVED")
        throw new ApiError(409, ErrorCode17.INVALID_STATE, `Only APPROVED purchase orders can be received (current: ${po.status})`);
      if (receipt_date < toIsoDate(po.po_date))
        throw validationError("receipt_date cannot be before po_date", { field: "receipt_date" });
      const lines = (await tx.query(`SELECT * FROM purchase_order_lines WHERE purchase_order_id = $1 ORDER BY line_number FOR UPDATE`, [po.id])).rows;
      const items = await lockItems(tx, org, lines.map((l) => l.item_id));
      const warehouseId = bodyWarehouse || po.warehouse_id || await defaultWarehouseId(tx, org);
      const receiptId = crypto7.randomUUID();
      const defaultInv = await accountByCode(tx, org, "113001");
      const byAccount = /* @__PURE__ */ new Map();
      let received = 0;
      for (const l of lines) {
        const remaining = new Money6(l.quantity).sub(l.received_quantity);
        const want = requested ? requested.find((r) => r.line_id === l.id)?.quantity : remaining.isPositive() ? remaining.toFixed(8) : null;
        if (!want)
          continue;
        if (new Money6(want).gt(remaining))
          throw new ApiError(409, ErrorCode17.OVER_ALLOCATION, `Over-receipt on line ${l.line_number}: remaining ${remaining.format(4)}`);
        const item = items.get(l.item_id);
        const value = new Money6(want).mul(l.unit_price).round(2);
        if (item.item_type === "INVENTORY") {
          await postStockMovement(tx, {
            organizationId: org,
            legalEntityId: po.legal_entity_id,
            itemId: l.item_id,
            warehouseId,
            movementType: "RECEIPT",
            movementDate: receipt_date,
            quantity: new Money6(want).toFixed(8),
            unitCost: new Money6(l.unit_price).toFixed(8),
            referenceType: "PURCHASE_ORDER",
            referenceId: po.id,
            description: `Goods receipt for ${po.po_number}`,
            revalue: true
          });
          const acc = item.inventory_account_id || defaultInv;
          byAccount.set(acc, (byAccount.get(acc) || Money6.zero()).add(value));
        } else {
          const acc = item.cogs_account_id || await accountByCode(tx, org, "511001");
          byAccount.set(acc, (byAccount.get(acc) || Money6.zero()).add(value));
        }
        await tx.query(`UPDATE purchase_order_lines SET received_quantity = received_quantity + $1 WHERE id = $2`, [want, l.id]);
        received++;
      }
      if (received === 0)
        throw new ApiError(409, ErrorCode17.INVALID_STATE, "Nothing left to receive on this purchase order");
      if (requested && requested.some((r) => !lines.find((l) => l.id === r.line_id)))
        throw validationError("Unknown purchase order line", { field: "lines" });
      let total = Money6.zero();
      const jLines = [];
      for (const [acc, amt] of byAccount) {
        total = total.add(amt);
        jLines.push({ account_id: acc, debit: amt.toFixed(8), description: `Receipt ${po.po_number}` });
      }
      jLines.push({ account_code: "211002", credit: total.toFixed(8), description: `GRNI accrual ${po.po_number}` });
      const posted = await postJournal(tx, auditLogger, outboxService, {
        organizationId: org,
        legalEntityId: po.legal_entity_id,
        userId: req.session.user_id,
        postingDate: receipt_date,
        purpose: AccountingPurpose3.PURCHASE_RECEIPT,
        description: `Goods received for ${po.po_number}`,
        sourceType: "GOODS_RECEIPT",
        sourceId: receiptId,
        sourceKey: `GOODS_RECEIPT:${receiptId}`,
        numberPrefix: "JV-GRN",
        correlationId: req.correlationId,
        lines: jLines
      });
      const after = (await tx.query(`SELECT BOOL_AND(received_quantity >= quantity) AS full FROM purchase_order_lines WHERE purchase_order_id = $1`, [po.id])).rows[0];
      const status = after.full ? "RECEIVED" : "APPROVED";
      await tx.query(`UPDATE purchase_orders SET status = $1, warehouse_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`, [status, warehouseId, po.id]);
      await audit3(req, tx, "GOODS_RECEIVED", "PURCHASE_ORDER", po.id, { status: po.status }, { status, receipt_id: receiptId, value: total.format() });
      return { id: po.id, status, receipt_id: receiptId, journal_id: posted?.journalId ?? null, received_value: total.format() };
    });
    return ok(req, res, out);
  });
  app.get("/api/ap/invoices", authenticate, apRead, async (req, res) => {
    const { limit, offset } = pagination(req.query);
    const r = await db.query(`SELECT ai.*, p.name as party_name, p.code as party_code FROM ap_invoices ai JOIN parties p ON p.id = ai.party_id
       WHERE ai.organization_id = $1 ORDER BY ai.invoice_date DESC, ai.created_at DESC LIMIT ${limit} OFFSET ${offset}`, [req.session.organization_id]);
    return ok(req, res, r.rows, 200, { total_count: r.rows.length, limit, offset });
  });
  app.post("/api/ap/invoices", authenticate, requirePermission(Permission8.AP_INVOICE_MANAGE), async (req, res) => {
    const org = req.session.organization_id;
    const party_id = uuid(req.body?.party_id, "party_id");
    const purchase_order_id = optionalUuid(req.body?.purchase_order_id, "purchase_order_id");
    const invoice_number = str(req.body?.invoice_number, "invoice_number", { max: 64 });
    const invoice_date = dateOnly(req.body?.invoice_date, "invoice_date", { defaultValue: todayIso() });
    const due_date = dateOnly(req.body?.due_date, "due_date", { defaultValue: new Date(Date.parse(`${invoice_date}T00:00:00Z`) + 30 * 864e5).toISOString().slice(0, 10) });
    if (due_date < invoice_date)
      throw validationError("due_date cannot be before invoice_date", { field: "due_date" });
    await requireParty(db, org, party_id, "VENDOR");
    const inputLines = parseLines(req.body?.lines);
    const invoiceId = crypto7.randomUUID();
    const out = await db.transaction(async (tx) => {
      const dup = await tx.query(`SELECT id FROM ap_invoices WHERE organization_id = $1 AND party_id = $2 AND invoice_number = $3 AND status <> 'CANCELLED'`, [org, party_id, invoice_number]);
      if (dup.rows.length)
        throw new ApiError(409, ErrorCode17.DUPLICATE_RESOURCE, `Supplier invoice ${invoice_number} was already recorded for this vendor`);
      let priceVariance = Money6.zero();
      if (purchase_order_id) {
        const po = await requireOrgRow(tx, "purchase_orders", purchase_order_id, org, "Purchase order", { forUpdate: true });
        if (po.party_id !== party_id)
          throw validationError("Bill vendor must match the purchase order vendor", { field: "party_id" });
        if (!["APPROVED", "RECEIVED"].includes(po.status))
          throw new ApiError(409, ErrorCode17.INVALID_STATE, `Purchase order ${po.po_number} is ${po.status} and cannot be billed`);
        const poLines = (await tx.query(`SELECT * FROM purchase_order_lines WHERE purchase_order_id = $1 ORDER BY line_number FOR UPDATE`, [po.id])).rows;
        for (const l of inputLines) {
          const match = poLines.find((p) => p.id === l.source_line_id) || poLines.find((p) => p.item_id === l.item_id && new Money6(p.received_quantity).sub(p.billed_quantity).gte(l.quantity));
          if (!match)
            throw new ApiError(409, ErrorCode17.OVER_ALLOCATION, `Billed quantity for item ${l.item_id} exceeds received-not-billed quantity on ${po.po_number}`);
          const open = new Money6(match.received_quantity).sub(match.billed_quantity);
          if (new Money6(l.quantity).gt(open))
            throw new ApiError(409, ErrorCode17.OVER_ALLOCATION, `Billed quantity exceeds received-not-billed quantity (${open.format(4)})`);
          match.billed_quantity = new Money6(match.billed_quantity).add(l.quantity).toFixed(8);
          l.source_line_id = match.id;
          priceVariance = priceVariance.add(new Money6(l.unit_price).sub(match.unit_price).mul(l.quantity).round(2));
          await tx.query(`UPDATE purchase_order_lines SET billed_quantity = $1 WHERE id = $2`, [match.billed_quantity, match.id]);
        }
        if (poLines.every((p) => new Money6(p.billed_quantity).gte(p.quantity)))
          await tx.query(`UPDATE purchase_orders SET status = 'BILLED' WHERE id = $1`, [po.id]);
      }
      const priced = await priceLines(tx, org, inputLines);
      if (!purchase_order_id) {
        for (const l of priced.lines) {
          if (l.item.item_type === "INVENTORY")
            throw validationError(`Inventory item ${l.item.code} must be billed against a purchase order receipt`, { field: "purchase_order_id" });
        }
      }
      await tx.query(`INSERT INTO ap_invoices (id, organization_id, legal_entity_id, party_id, purchase_order_id, invoice_number, invoice_date, due_date, status,
           subtotal, tax_amount, total_amount, outstanding_amount, notes, created_by, price_variance)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'DRAFT', $9, $10, $11, $11, $12, $13, $14)`, [invoiceId, org, req.session.legal_entity_id, party_id, purchase_order_id, invoice_number, invoice_date, due_date, priced.subtotal, priced.tax_amount, priced.total_amount, optionalStr(req.body?.notes, "notes"), req.session.user_id, priceVariance.toFixed(8)]);
      for (const l of priced.lines) {
        await tx.query(`INSERT INTO ap_invoice_lines (id, invoice_id, line_number, item_id, quantity, unit_price, line_total, tax_amount, description, purchase_order_line_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [crypto7.randomUUID(), invoiceId, l.line_number, l.item_id, l.quantity, l.unit_price, l.line_total, l.tax_amount, l.description, l.source_line_id || null]);
      }
      await audit3(req, tx, "AP_INVOICE_CREATED", "AP_INVOICE", invoiceId, void 0, { invoice_number, total_amount: priced.total_amount, price_variance: priceVariance.format() });
      return { id: invoiceId, invoice_number, status: "DRAFT", total_amount: new Money6(priced.total_amount).format(), price_variance: priceVariance.format() };
    });
    return ok(req, res, out, 201);
  });
  app.post("/api/ap/invoices/:id/post", authenticate, requirePermission(Permission8.AP_INVOICE_MANAGE), async (req, res) => {
    const org = req.session.organization_id;
    const out = await db.transaction(async (tx) => {
      const inv = await transition(tx, { table: "ap_invoices", id: req.params.id, organizationId: org, from: ["DRAFT"], to: "POSTED", label: "AP invoice", set: { posted_by: req.session.user_id, updated_at: (/* @__PURE__ */ new Date()).toISOString() } });
      const lines = (await tx.query(`SELECT ail.*, i.cogs_account_id, i.item_type, pol.unit_price AS po_price FROM ap_invoice_lines ail JOIN items i ON i.id = ail.item_id
           LEFT JOIN purchase_order_lines pol ON pol.id = ail.purchase_order_line_id WHERE ail.invoice_id = $1`, [inv.id])).rows;
      const jLines = [];
      let lineSum = Money6.zero();
      let taxSum = Money6.zero();
      for (const l of lines) {
        lineSum = lineSum.add(l.line_total);
        taxSum = taxSum.add(l.tax_amount || "0");
        if (l.purchase_order_line_id) {
          const grni = new Money6(l.po_price).mul(l.quantity).round(2);
          jLines.push({ account_code: "211002", debit: grni.toFixed(8), description: "GRNI clearing" });
          const variance2 = new Money6(l.line_total).sub(grni);
          if (!variance2.isZero())
            jLines.push({ account_code: "511002", debit: variance2.toFixed(8), description: "Purchase price variance" });
        } else {
          if (!l.cogs_account_id)
            throw new ApiError(400, ErrorCode17.MAPPING_MISSING, "Non-PO bill lines need an expense (COGS) account on the item");
          jLines.push({ account_id: l.cogs_account_id, debit: new Money6(l.line_total).toFixed(8), description: "Direct expense" });
        }
      }
      if (!lineSum.eq(inv.subtotal) || !lineSum.add(taxSum).eq(inv.total_amount))
        throw new ApiError(409, ErrorCode17.JOURNAL_UNBALANCED, "Bill header totals do not match its lines");
      if (taxSum.isPositive())
        jLines.push({ account_code: "114001", debit: taxSum.toFixed(8), description: "Input tax" });
      jLines.push({ account_code: "211001", credit: new Money6(inv.total_amount).toFixed(8), description: `AP ${inv.invoice_number}` });
      const posted = await postJournal(tx, auditLogger, outboxService, {
        organizationId: org,
        legalEntityId: inv.legal_entity_id,
        userId: req.session.user_id,
        postingDate: toIsoDate(inv.invoice_date),
        purpose: AccountingPurpose3.PURCHASE_INVOICE,
        description: `Supplier bill ${inv.invoice_number}`,
        sourceType: "AP_INVOICE",
        sourceId: inv.id,
        sourceKey: `AP_INVOICE:${inv.id}`,
        numberPrefix: "JV-AP",
        correlationId: req.correlationId,
        lines: jLines
      });
      await tx.query(`UPDATE ap_invoices SET posted_journal_id = $1 WHERE id = $2`, [posted?.journalId ?? null, inv.id]);
      return { id: inv.id, status: "POSTED", posted_journal_id: posted?.journalId ?? null };
    });
    return ok(req, res, out);
  });
  app.post("/api/ap/invoices/:id/cancel", authenticate, requirePermission(Permission8.AP_INVOICE_MANAGE), async (req, res) => {
    const out = await db.transaction(async (tx) => {
      const inv = await transition(tx, { table: "ap_invoices", id: req.params.id, organizationId: req.session.organization_id, from: ["DRAFT"], to: "CANCELLED", label: "AP invoice" });
      const lines = (await tx.query(`SELECT * FROM ap_invoice_lines WHERE invoice_id = $1 AND purchase_order_line_id IS NOT NULL`, [inv.id])).rows;
      for (const l of lines)
        await tx.query(`UPDATE purchase_order_lines SET billed_quantity = billed_quantity - $1 WHERE id = $2`, [l.quantity, l.purchase_order_line_id]);
      if (inv.purchase_order_id)
        await tx.query(`UPDATE purchase_orders SET status = 'RECEIVED' WHERE id = $1 AND status = 'BILLED'`, [inv.purchase_order_id]);
      await audit3(req, tx, "AP_INVOICE_CANCELLED", "AP_INVOICE", inv.id);
      return { id: inv.id, status: "CANCELLED" };
    });
    return ok(req, res, out);
  });
}

// apps/api/dist/routes/payments.js
init_context();
init_http();
init_errors();
init_validate();
init_scope();
init_state();
init_posting();
init_numbering();
import crypto8 from "node:crypto";
import { Money as Money7 } from "@omnysync/financial-engine";
import { AccountingPurpose as AccountingPurpose4, ErrorCode as ErrorCode18, Permission as Permission9 } from "@omnysync/contracts";
async function requireCashAccount(q, org, id) {
  const r = await q.query(`SELECT * FROM accounts WHERE id = $1 AND organization_id = $2`, [id, org]);
  const a = r.rows[0];
  if (!a || Number(a.level) !== 4 || !a.is_active || !(a.control_type === "BANK" || String(a.code).startsWith("1110"))) {
    throw validationError("bank_account_id must be an active bank/cash posting account", { field: "bank_account_id" });
  }
  return a;
}
async function recordPayment(req, kind) {
  const org = req.session.organization_id;
  const party_id = uuid(req.body?.party_id, "party_id");
  const amount = decimal(req.body?.amount, "amount", { sign: "positive", scale: 2 });
  const bank_account_id = uuid(req.body?.bank_account_id, "bank_account_id");
  const payment_date = dateOnly(req.body?.payment_date, "payment_date", { defaultValue: todayIso() });
  const reference = optionalStr(req.body?.reference, "reference", 255);
  const allocations = arrayOf(req.body?.allocations ?? [], "allocations", { min: 0, max: 500 }).map((a, i) => ({
    invoice_id: uuid(a?.invoice_id, `allocations[${i}].invoice_id`),
    amount: decimal(a?.amount, `allocations[${i}].amount`, { sign: "positive", scale: 2 })
  }));
  if (new Set(allocations.map((a) => a.invoice_id)).size !== allocations.length)
    throw validationError("Each invoice may appear only once in allocations", { field: "allocations" });
  await requireParty(db, org, party_id, kind === "RECEIPT" ? "CUSTOMER" : "VENDOR");
  await requireCashAccount(db, org, bank_account_id);
  const invoiceTable = kind === "RECEIPT" ? "ar_invoices" : "ap_invoices";
  const invoiceType = kind === "RECEIPT" ? "AR" : "AP";
  let allocTotal = Money7.zero();
  for (const a of allocations)
    allocTotal = allocTotal.add(a.amount);
  if (allocTotal.gt(amount))
    throw new ApiError(409, ErrorCode18.OVER_ALLOCATION, `Allocations (${allocTotal.format()}) exceed payment amount (${new Money7(amount).format()})`);
  return db.transaction(async (tx) => {
    const paymentId = crypto8.randomUUID();
    const paymentNumber = optionalStr(req.body?.payment_number, "payment_number", 64) || await nextDocumentNumber(tx, org, kind === "RECEIPT" ? "RCPT" : "PAY", payment_date);
    const sorted = [...allocations].sort((a, b) => a.invoice_id.localeCompare(b.invoice_id));
    const invoices = [];
    for (const a of sorted) {
      const inv = (await tx.query(`SELECT * FROM ${invoiceTable} WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [a.invoice_id, org])).rows[0];
      if (!inv)
        throw validationError(`Invoice ${a.invoice_id} not found`, { field: "allocations" });
      if (inv.party_id !== party_id)
        throw validationError(`Invoice ${inv.invoice_number} belongs to a different party`, { field: "allocations" });
      if (!["POSTED", "PARTIALLY_PAID"].includes(inv.status))
        throw new ApiError(409, ErrorCode18.INVALID_STATE, `Invoice ${inv.invoice_number} is ${inv.status} and cannot receive allocations`);
      if (toIsoDate(inv.invoice_date) > payment_date)
        throw validationError(`Payment date is before invoice ${inv.invoice_number} date`, { field: "payment_date" });
      if (new Money7(a.amount).gt(inv.outstanding_amount)) {
        throw new ApiError(409, ErrorCode18.OVER_ALLOCATION, `Allocation ${new Money7(a.amount).format()} exceeds outstanding ${new Money7(inv.outstanding_amount).format()} on ${inv.invoice_number}`);
      }
      invoices.push({ inv, amount: a.amount });
    }
    const unallocated = new Money7(amount).sub(allocTotal);
    await tx.query(`INSERT INTO payments (id, organization_id, legal_entity_id, party_id, payment_type, payment_number, payment_date, bank_account_id, amount, currency, reference, status, created_by, unallocated_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PKR', $10, 'POSTED', $11, $12)`, [paymentId, org, req.session.legal_entity_id, party_id, kind, paymentNumber, payment_date, bank_account_id, amount, reference, req.session.user_id, unallocated.toFixed(8)]);
    for (const { inv, amount: amt } of invoices) {
      const outstanding = new Money7(inv.outstanding_amount).sub(amt);
      await tx.query(`INSERT INTO allocations (id, organization_id, payment_id, invoice_id, invoice_type, allocated_amount, allocated_date) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
        crypto8.randomUUID(),
        org,
        paymentId,
        inv.id,
        invoiceType,
        amt,
        payment_date
      ]);
      await tx.query(`UPDATE ${invoiceTable} SET outstanding_amount = $1, status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`, [
        outstanding.toFixed(8),
        outstanding.isZero() ? "PAID" : "PARTIALLY_PAID",
        inv.id
      ]);
    }
    const lines = kind === "RECEIPT" ? [
      { account_id: bank_account_id, debit: amount, description: `Receipt ${paymentNumber}` },
      { account_code: "112001", credit: amount, description: `AR settlement ${paymentNumber}` }
    ] : [
      { account_code: "211001", debit: amount, description: `AP settlement ${paymentNumber}` },
      { account_id: bank_account_id, credit: amount, description: `Payment ${paymentNumber}` }
    ];
    const posted = await postJournal(tx, auditLogger, outboxService, {
      organizationId: org,
      legalEntityId: req.session.legal_entity_id,
      userId: req.session.user_id,
      postingDate: payment_date,
      purpose: kind === "RECEIPT" ? AccountingPurpose4.CUSTOMER_PAYMENT : AccountingPurpose4.SUPPLIER_PAYMENT,
      description: `${kind === "RECEIPT" ? "Customer receipt" : "Supplier payment"} ${paymentNumber}${reference ? ` (${reference})` : ""}`,
      sourceType: "PAYMENT",
      sourceId: paymentId,
      sourceKey: `PAYMENT:${paymentId}`,
      numberPrefix: kind === "RECEIPT" ? "JV-RCPT" : "JV-PAY",
      correlationId: req.correlationId,
      lines
    });
    await tx.query(`UPDATE payments SET posted_journal_id = $1 WHERE id = $2`, [posted?.journalId ?? null, paymentId]);
    await auditLogger.record({ organization_id: org, user_id: req.session.user_id, action: `PAYMENT_${kind}_POSTED`, entity_type: "PAYMENT", entity_id: paymentId, after_state: { payment_number: paymentNumber, amount, allocated: allocTotal.format(), unallocated: unallocated.format() }, correlation_id: req.correlationId }, tx);
    return { id: paymentId, payment_number: paymentNumber, status: "POSTED", amount: new Money7(amount).format(), allocated_amount: allocTotal.format(), unallocated_amount: unallocated.format(), posted_journal_id: posted?.journalId ?? null };
  });
}
function registerPaymentsRoutes(app) {
  const payRead = requireAnyPermission(Permission9.PAYMENT_MANAGE, Permission9.AR_INVOICE_MANAGE, Permission9.AP_INVOICE_MANAGE, Permission9.FINANCE_REPORTS_VIEW, Permission9.TREASURY_BANK_RECONCILE);
  app.get("/api/payments", authenticate, payRead, async (req, res) => {
    const { limit, offset } = pagination(req.query);
    const r = await db.query(`SELECT pm.*, p.name as party_name, p.code as party_code, a.name as bank_account_name
       FROM payments pm JOIN parties p ON p.id = pm.party_id LEFT JOIN accounts a ON a.id = pm.bank_account_id
       WHERE pm.organization_id = $1 ORDER BY pm.payment_date DESC, pm.created_at DESC LIMIT ${limit} OFFSET ${offset}`, [req.session.organization_id]);
    return ok(req, res, r.rows, 200, { total_count: r.rows.length, limit, offset });
  });
  app.post("/api/payments/receipt", authenticate, requirePermission(Permission9.PAYMENT_MANAGE), async (req, res) => ok(req, res, await recordPayment(req, "RECEIPT"), 201));
  app.post("/api/payments/disbursement", authenticate, requirePermission(Permission9.PAYMENT_MANAGE), async (req, res) => ok(req, res, await recordPayment(req, "DISBURSEMENT"), 201));
  app.post("/api/payments/:id/cancel", authenticate, requirePermission(Permission9.PAYMENT_MANAGE), async (req, res) => {
    const org = req.session.organization_id;
    const reason = str(req.body?.reason, "reason", { max: 500 });
    const reversal_date = dateOnly(req.body?.reversal_date, "reversal_date", { defaultValue: todayIso() });
    const out = await db.transaction(async (tx) => {
      const pm = await requireOrgRow(tx, "payments", req.params.id, org, "Payment", { forUpdate: true });
      if (reversal_date < toIsoDate(pm.payment_date))
        throw validationError("reversal_date cannot be before the payment date", { field: "reversal_date" });
      await transition(tx, { table: "payments", id: pm.id, organizationId: org, from: ["POSTED"], to: "CANCELLED", label: "Payment", set: { cancelled_by: req.session.user_id } });
      const table = pm.payment_type === "RECEIPT" ? "ar_invoices" : "ap_invoices";
      const allocs = (await tx.query(`SELECT * FROM allocations WHERE payment_id = $1 AND reversed_at IS NULL ORDER BY invoice_id`, [pm.id])).rows;
      for (const a of allocs) {
        const inv = (await tx.query(`SELECT * FROM ${table} WHERE id = $1 FOR UPDATE`, [a.invoice_id])).rows[0];
        const outstanding = new Money7(inv.outstanding_amount).add(a.allocated_amount);
        const status = outstanding.gte(inv.total_amount) ? "POSTED" : "PARTIALLY_PAID";
        await tx.query(`UPDATE ${table} SET outstanding_amount = $1, status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`, [outstanding.toFixed(8), status, inv.id]);
        await tx.query(`UPDATE allocations SET reversed_at = CURRENT_TIMESTAMP WHERE id = $1`, [a.id]);
      }
      let reversalId = null;
      if (pm.posted_journal_id) {
        const lines = (await tx.query(`SELECT * FROM journal_lines WHERE journal_id = $1 ORDER BY line_number`, [pm.posted_journal_id])).rows;
        const posted = await postJournal(tx, auditLogger, outboxService, {
          organizationId: org,
          legalEntityId: pm.legal_entity_id,
          userId: req.session.user_id,
          postingDate: reversal_date,
          purpose: AccountingPurpose4.REVERSAL,
          description: `Reversal of payment ${pm.payment_number}: ${reason}`,
          sourceType: "PAYMENT",
          sourceId: pm.id,
          sourceKey: `PAYMENT_REVERSAL:${pm.id}`,
          numberPrefix: "JV-REV",
          reversalOfJournalId: pm.posted_journal_id,
          correlationId: req.correlationId,
          lines: lines.map((l) => ({ account_id: l.account_id, debit: l.base_credit, credit: l.base_debit, description: `Reversal: ${l.description || ""}` }))
        });
        reversalId = posted?.journalId ?? null;
        if (reversalId) {
          await tx.query(`UPDATE journals SET status = 'REVERSED', reversed_by_journal_id = $1 WHERE id = $2 AND status = 'POSTED'`, [reversalId, pm.posted_journal_id]);
        }
      }
      await tx.query(`UPDATE payments SET reversal_journal_id = $1 WHERE id = $2`, [reversalId, pm.id]);
      await auditLogger.record({ organization_id: org, user_id: req.session.user_id, action: "PAYMENT_CANCELLED", entity_type: "PAYMENT", entity_id: pm.id, after_state: { reason, reversal_journal_id: reversalId }, correlation_id: req.correlationId }, tx);
      return { id: pm.id, status: "CANCELLED", reversal_journal_id: reversalId };
    });
    return ok(req, res, out);
  });
}

// apps/api/dist/routes/treasury.js
init_context();
init_http();
init_errors();
init_validate();
init_scope();
import crypto9 from "node:crypto";
import { Money as Money8, BankReconciliationEngine } from "@omnysync/financial-engine";
import { ErrorCode as ErrorCode19, Permission as Permission10 } from "@omnysync/contracts";
var CCY = /^[A-Z]{3}$/;
async function bankGlLines(q, org, accountId2, asOf) {
  return (await q.query(`SELECT jl.id, jl.base_debit, jl.base_credit, jl.description, j.journal_number, j.posting_date, j.description AS journal_description,
              (SELECT bsl.id FROM bank_statement_lines bsl WHERE bsl.matched_journal_line_id = jl.id LIMIT 1) AS matched_statement_line_id
       FROM journal_lines jl JOIN journals j ON j.id = jl.journal_id
       WHERE jl.account_id = $1 AND j.organization_id = $2 AND j.status IN ('POSTED','REVERSED') AND j.posting_date <= $3
       ORDER BY j.posting_date ASC, j.journal_number ASC`, [accountId2, org, asOf])).rows;
}
async function lockStatementLine(q, org, lineId) {
  const r = await q.query(`SELECT bsl.*, bs.bank_account_id, bs.status AS statement_status, bs.id AS stmt_id FROM bank_statement_lines bsl
     JOIN bank_statements bs ON bs.id = bsl.statement_id WHERE bsl.id::text = $1 AND bs.organization_id = $2 FOR UPDATE OF bsl`, [lineId, org]);
  if (!r.rows[0])
    throw new ApiError(404, ErrorCode19.RESOURCE_NOT_FOUND, "Statement line not found");
  if (r.rows[0].statement_status === "RECONCILED")
    throw new ApiError(409, ErrorCode19.STATEMENT_ALREADY_RECONCILED, "Statement is already reconciled");
  return r.rows[0];
}
function registerTreasuryRoutes(app) {
  const treasuryRead = requireAnyPermission(Permission10.TREASURY_BANK_RECONCILE, Permission10.TREASURY_FX_MANAGE, Permission10.FINANCE_REPORTS_VIEW, Permission10.PAYMENT_MANAGE);
  app.get("/api/fx/rates", authenticate, treasuryRead, async (req, res) => {
    const r = await db.query("SELECT * FROM exchange_rates WHERE organization_id = $1 ORDER BY effective_date DESC, from_currency ASC", [req.session.organization_id]);
    return ok(req, res, r.rows, 200, { total_count: r.rows.length });
  });
  app.post("/api/fx/rates", authenticate, requirePermission(Permission10.TREASURY_FX_MANAGE), async (req, res) => {
    const from = str(req.body?.from_currency, "from_currency", { max: 3 }).toUpperCase();
    const to = str(req.body?.to_currency, "to_currency", { max: 3 }).toUpperCase();
    if (!CCY.test(from) || !CCY.test(to))
      throw validationError("Currencies must be ISO 4217 3-letter codes");
    if (from === to)
      throw validationError("from_currency and to_currency must differ");
    const rate = decimal(req.body?.rate == null ? void 0 : String(req.body.rate), "rate", { sign: "positive", scale: 12 });
    const effective_date = dateOnly(req.body?.effective_date, "effective_date");
    const source = optionalStr(req.body?.source, "source", 32) || "MANUAL";
    const out = await db.transaction(async (tx) => {
      const before = (await tx.query(`SELECT * FROM exchange_rates WHERE organization_id = $1 AND from_currency = $2 AND to_currency = $3 AND effective_date = $4 FOR UPDATE`, [req.session.organization_id, from, to, effective_date])).rows[0];
      const id = before?.id || crypto9.randomUUID();
      await tx.query(`INSERT INTO exchange_rates (id, organization_id, from_currency, to_currency, rate, effective_date, source) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (organization_id, from_currency, to_currency, effective_date) DO UPDATE SET rate = EXCLUDED.rate, source = EXCLUDED.source`, [id, req.session.organization_id, from, to, rate, effective_date, source]);
      await auditLogger.record({ organization_id: req.session.organization_id, user_id: req.session.user_id, action: before ? "FX_RATE_CORRECTED" : "FX_RATE_CREATED", entity_type: "EXCHANGE_RATE", entity_id: id, before_state: before ? { rate: before.rate } : void 0, after_state: { from, to, rate, effective_date, source }, correlation_id: req.correlationId }, tx);
      return { id, from_currency: from, to_currency: to, rate, effective_date };
    });
    return ok(req, res, out, 201);
  });
  app.get("/api/treasury/statements", authenticate, treasuryRead, async (req, res) => {
    const r = await db.query(`SELECT bs.*, a.name as bank_account_name, a.code as bank_account_code,
              (SELECT COUNT(*) FROM bank_statement_lines l WHERE l.statement_id = bs.id) AS line_count,
              (SELECT COUNT(*) FROM bank_statement_lines l WHERE l.statement_id = bs.id AND l.is_matched) AS matched_count
       FROM bank_statements bs JOIN accounts a ON a.id = bs.bank_account_id WHERE bs.organization_id = $1 ORDER BY bs.statement_date DESC`, [req.session.organization_id]);
    return ok(req, res, r.rows, 200, { total_count: r.rows.length });
  });
  app.get("/api/treasury/statements/:id", authenticate, treasuryRead, async (req, res) => {
    const org = req.session.organization_id;
    const st = (await db.query(`SELECT bs.*, a.name as bank_account_name, a.code as bank_account_code FROM bank_statements bs JOIN accounts a ON a.id = bs.bank_account_id WHERE bs.id::text = $1 AND bs.organization_id = $2`, [req.params.id, org])).rows[0];
    if (!st)
      throw new ApiError(404, ErrorCode19.RESOURCE_NOT_FOUND, "Bank statement not found");
    const lines = (await db.query("SELECT * FROM bank_statement_lines WHERE statement_id = $1 ORDER BY line_number ASC", [st.id])).rows;
    const asOf = toIsoDate(st.statement_date);
    const gl = await bankGlLines(db, org, st.bank_account_id, asOf);
    let glBalance = Money8.zero();
    for (const l of gl)
      glBalance = glBalance.add(l.base_debit).sub(l.base_credit);
    const summary = BankReconciliationEngine.computeReconciliation({ statementOpeningBalance: st.opening_balance, statementClosingBalance: st.closing_balance, glBalanceAsOfDate: glBalance.toFixed(8), statementLines: lines });
    return ok(req, res, { ...st, lines, summary, gl_balance: glBalance.format(), unreconciled_gl_lines: gl.filter((l) => !l.matched_statement_line_id) });
  });
  app.post("/api/treasury/statements/upload", authenticate, requirePermission(Permission10.TREASURY_BANK_RECONCILE), async (req, res) => {
    const org = req.session.organization_id;
    const bank_account_id = uuid(req.body?.bank_account_id, "bank_account_id");
    const bank = (await db.query(`SELECT * FROM accounts WHERE id = $1 AND organization_id = $2 AND level = 4`, [bank_account_id, org])).rows[0];
    if (!bank || !(bank.control_type === "BANK" || String(bank.code).startsWith("1110")))
      throw validationError("bank_account_id must be a bank/cash posting account", { field: "bank_account_id" });
    const statement_reference = str(req.body?.statement_reference, "statement_reference", { max: 64 });
    const statement_date = dateOnly(req.body?.statement_date, "statement_date");
    const opening = decimal(req.body?.opening_balance, "opening_balance", { sign: "any", required: false, defaultValue: "0" });
    const closing = decimal(req.body?.closing_balance, "closing_balance", { sign: "any", required: false, defaultValue: "0" });
    const lines = arrayOf(req.body?.lines, "lines", { min: 1, max: 1e4 }).map((l, i) => {
      const transaction_date = dateOnly(l?.transaction_date, `lines[${i}].transaction_date`);
      if (transaction_date > statement_date)
        throw validationError(`lines[${i}].transaction_date is after the statement date`);
      const amount = decimal(l?.amount, `lines[${i}].amount`, { sign: "any" });
      if (new Money8(amount).isZero())
        throw validationError(`lines[${i}].amount cannot be zero`);
      return { transaction_date, value_date: optionalDate(l?.value_date, `lines[${i}].value_date`) || transaction_date, amount, reference: optionalStr(l?.reference, "reference", 255), description: optionalStr(l?.description, "description", 1e3) };
    });
    let movement = Money8.zero();
    for (const l of lines)
      movement = movement.add(l.amount);
    if (!new Money8(opening).add(movement).eq(closing)) {
      throw validationError(`Statement does not foot: opening ${new Money8(opening).format()} + lines ${movement.format()} != closing ${new Money8(closing).format()}`, { field: "closing_balance" });
    }
    const statementId = crypto9.randomUUID();
    await db.transaction(async (tx) => {
      await tx.query(`INSERT INTO bank_statements (id, organization_id, legal_entity_id, bank_account_id, statement_reference, statement_date, opening_balance, closing_balance, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'UPLOADED', $9)`, [statementId, org, req.session.legal_entity_id, bank_account_id, statement_reference, statement_date, opening, closing, req.session.user_id]);
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        await tx.query(`INSERT INTO bank_statement_lines (id, statement_id, line_number, transaction_date, value_date, amount, reference, description, is_matched) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false)`, [crypto9.randomUUID(), statementId, i + 1, l.transaction_date, l.value_date, l.amount, l.reference, l.description]);
      }
      await auditLogger.record({ organization_id: org, user_id: req.session.user_id, action: "BANK_STATEMENT_UPLOADED", entity_type: "BANK_STATEMENT", entity_id: statementId, after_state: { statement_reference, lines: lines.length, closing }, correlation_id: req.correlationId }, tx);
    });
    return ok(req, res, { id: statementId, statement_reference, status: "UPLOADED", line_count: lines.length }, 201);
  });
  app.post("/api/treasury/reconciliation/match", authenticate, requirePermission(Permission10.TREASURY_BANK_RECONCILE), async (req, res) => {
    const org = req.session.organization_id;
    const statement_line_id = uuid(req.body?.statement_line_id, "statement_line_id");
    const journal_line_id = optionalUuid(req.body?.journal_line_id, "journal_line_id");
    const is_matched = req.body?.is_matched === void 0 ? true : bool(req.body.is_matched);
    const out = await db.transaction(async (tx) => {
      const line = await lockStatementLine(tx, org, statement_line_id);
      if (is_matched && journal_line_id) {
        const jl = (await tx.query(`SELECT jl.*, j.posting_date FROM journal_lines jl JOIN journals j ON j.id = jl.journal_id WHERE jl.id = $1 AND j.organization_id = $2 AND j.status IN ('POSTED','REVERSED')`, [journal_line_id, org])).rows[0];
        if (!jl)
          throw validationError("Journal line not found", { field: "journal_line_id" });
        if (jl.account_id !== line.bank_account_id)
          throw validationError("Journal line is not on the statement bank account", { field: "journal_line_id" });
        const net = new Money8(jl.base_debit).sub(jl.base_credit);
        if (!net.eq(line.amount))
          throw new ApiError(409, ErrorCode19.RECONCILIATION_MISMATCH, `Amounts differ: statement ${new Money8(line.amount).format()} vs GL ${net.format()}`);
        const taken = await tx.query(`SELECT id FROM bank_statement_lines WHERE matched_journal_line_id = $1 AND id <> $2`, [journal_line_id, line.id]);
        if (taken.rows.length)
          throw new ApiError(409, ErrorCode19.RECONCILIATION_MISMATCH, "Journal line is already matched to another statement line");
      }
      await tx.query(`UPDATE bank_statement_lines SET is_matched = $1, matched_journal_line_id = $2 WHERE id = $3`, [is_matched, is_matched ? journal_line_id : null, line.id]);
      await tx.query(`UPDATE bank_statements SET status = 'RECONCILING', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'UPLOADED'`, [line.stmt_id]);
      await auditLogger.record({ organization_id: org, user_id: req.session.user_id, action: is_matched ? "BANK_LINE_MATCHED" : "BANK_LINE_UNMATCHED", entity_type: "BANK_STATEMENT_LINE", entity_id: line.id, after_state: { journal_line_id, manual_clear: is_matched && !journal_line_id }, correlation_id: req.correlationId }, tx);
      return { statement_line_id: line.id, is_matched, journal_line_id };
    });
    return ok(req, res, out);
  });
  app.post("/api/treasury/statements/:id/auto-match", authenticate, requirePermission(Permission10.TREASURY_BANK_RECONCILE), async (req, res) => {
    const org = req.session.organization_id;
    const toleranceDays = int(req.body?.date_tolerance_days, "date_tolerance_days", { min: 0, max: 31, defaultValue: 5 });
    const out = await db.transaction(async (tx) => {
      const st = await requireOrgRow(tx, "bank_statements", req.params.id, org, "Bank statement", { forUpdate: true });
      if (st.status === "RECONCILED")
        throw new ApiError(409, ErrorCode19.STATEMENT_ALREADY_RECONCILED, "Statement is already reconciled");
      const lines = (await tx.query(`SELECT * FROM bank_statement_lines WHERE statement_id = $1 AND is_matched = false ORDER BY line_number`, [st.id])).rows;
      const gl = (await bankGlLines(tx, org, st.bank_account_id, toIsoDate(st.statement_date))).filter((l) => !l.matched_statement_line_id);
      const suggestions = BankReconciliationEngine.suggestMatches(lines.map((l) => ({ id: l.id, date: toIsoDate(l.transaction_date), amount: l.amount, reference: l.reference || "", description: l.description || "" })), gl.map((g) => ({ id: g.id, date: toIsoDate(g.posting_date), amount: new Money8(g.base_debit).sub(g.base_credit).toFixed(8), text: `${g.journal_number} ${g.journal_description || ""} ${g.description || ""}` })), toleranceDays);
      for (const m of suggestions) {
        await tx.query(`UPDATE bank_statement_lines SET is_matched = true, matched_journal_line_id = $1 WHERE id = $2`, [m.journalLineId, m.statementLineId]);
      }
      if (suggestions.length)
        await tx.query(`UPDATE bank_statements SET status = 'RECONCILING', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'UPLOADED'`, [st.id]);
      await auditLogger.record({ organization_id: org, user_id: req.session.user_id, action: "BANK_AUTO_MATCH", entity_type: "BANK_STATEMENT", entity_id: st.id, after_state: { matched: suggestions.length, remaining: lines.length - suggestions.length }, correlation_id: req.correlationId }, tx);
      return { statement_id: st.id, matched: suggestions.length, remaining_unmatched: lines.length - suggestions.length, matches: suggestions };
    });
    return ok(req, res, out);
  });
  app.post("/api/treasury/reconciliation/sign-off", authenticate, requirePermission(Permission10.TREASURY_BANK_RECONCILE), async (req, res) => {
    const org = req.session.organization_id;
    const statement_id = uuid(req.body?.statement_id, "statement_id");
    const notes = optionalStr(req.body?.notes, "notes", 2e3);
    const out = await db.transaction(async (tx) => {
      const st = await requireOrgRow(tx, "bank_statements", statement_id, org, "Bank statement", { forUpdate: true });
      if (st.status === "RECONCILED")
        throw new ApiError(409, ErrorCode19.STATEMENT_ALREADY_RECONCILED, "Statement is already reconciled");
      if (st.created_by && st.created_by === req.session.user_id)
        throw sodViolation("Segregation of duties: the statement uploader cannot sign off the reconciliation");
      const lines = (await tx.query("SELECT * FROM bank_statement_lines WHERE statement_id = $1", [st.id])).rows;
      const unmatched = lines.filter((l) => !l.is_matched);
      if (unmatched.length > 0)
        throw new ApiError(400, ErrorCode19.RECONCILIATION_MISMATCH, `Cannot sign off: ${unmatched.length} statement line(s) remain unmatched`);
      const gl = await bankGlLines(tx, org, st.bank_account_id, toIsoDate(st.statement_date));
      let glBalance = Money8.zero();
      let outstanding = Money8.zero();
      for (const l of gl) {
        const net = new Money8(l.base_debit).sub(l.base_credit);
        glBalance = glBalance.add(net);
        if (!l.matched_statement_line_id)
          outstanding = outstanding.add(net);
      }
      let manualCleared = Money8.zero();
      for (const l of lines)
        if (l.is_matched && !l.matched_journal_line_id)
          manualCleared = manualCleared.add(l.amount);
      const difference = new Money8(st.closing_balance).sub(glBalance.sub(outstanding).add(manualCleared));
      if (!difference.isZero() && !notes)
        throw validationError("A non-zero unreconciled difference requires sign-off notes", { field: "notes", difference: difference.format() });
      const reconId = crypto9.randomUUID();
      await tx.query("UPDATE bank_statements SET status = 'RECONCILED', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [st.id]);
      await tx.query(`INSERT INTO bank_reconciliations (id, statement_id, reconciled_date, statement_closing_balance, gl_closing_balance, unreconciled_difference, status, reconciled_by, notes)
         VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, 'COMPLETED', $6, $7)`, [reconId, st.id, st.closing_balance, glBalance.toFixed(8), difference.toFixed(8), req.session.user_id, notes]);
      await auditLogger.record({ organization_id: org, user_id: req.session.user_id, action: "BANK_STATEMENT_RECONCILED", entity_type: "BANK_STATEMENT", entity_id: st.id, after_state: { status: "RECONCILED", statement_reference: st.statement_reference, gl_balance: glBalance.format(), outstanding_items: outstanding.format(), difference: difference.format() }, correlation_id: req.correlationId }, tx);
      return { statement_id: st.id, status: "RECONCILED", reconciliation_id: reconId, gl_balance: glBalance.format(), outstanding_items: outstanding.format(), unreconciled_difference: difference.format() };
    });
    return ok(req, res, out);
  });
  app.get("/api/onboarding/profile", authenticate, requireAnyPermission(Permission10.ONBOARDING_MANAGE, Permission10.ORG_MANAGE, Permission10.FINANCE_REPORTS_VIEW), async (req, res) => {
    const profileRes = await db.query("SELECT * FROM onboarding_profiles WHERE organization_id = $1 LIMIT 1", [
      req.session.organization_id
    ]);
    return res.json({
      success: true,
      data: profileRes.rows[0] || {
        organization_id: req.session.organization_id,
        industry_template: "WHOLESALE_DISTRIBUTION",
        setup_step: "COMPLETED",
        is_completed: true
      },
      meta: {
        correlation_id: req.correlationId,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      }
    });
  });
  app.post("/api/onboarding/provision", authenticate, requirePermission(Permission10.ONBOARDING_MANAGE), async (req, res) => {
    const { industry_template } = req.body;
    const validTemplates = ["WHOLESALE_DISTRIBUTION", "SERVICES_CONSULTING", "LIGHT_MANUFACTURING", "CUSTOM"];
    if (!validTemplates.includes(industry_template)) {
      return res.status(400).json({
        success: false,
        error: {
          code: ErrorCode19.VALIDATION_FAILED,
          message: `industry_template must be one of: ${validTemplates.join(", ")}`,
          correlation_id: req.correlationId
        }
      });
    }
    const profileId = crypto9.randomUUID();
    await db.query(`
      INSERT INTO onboarding_profiles (id, organization_id, industry_template, setup_step, is_completed, completed_at)
      VALUES ($1, $2, $3, 'COMPLETED', true, CURRENT_TIMESTAMP)
    `, [profileId, req.session.organization_id, industry_template]);
    return res.status(201).json({
      success: true,
      data: { id: profileId, industry_template, is_completed: true },
      meta: {
        correlation_id: req.correlationId,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      }
    });
  });
}

// apps/api/dist/routes/hrm.js
init_context();
init_http();
init_errors();
init_validate();
init_scope();
init_state();
init_posting();
init_numbering();
import crypto10 from "node:crypto";
import { Money as Money9, PayrollEngine } from "@omnysync/financial-engine";
import { AccountingPurpose as AccountingPurpose5, ErrorCode as ErrorCode20, Permission as Permission11 } from "@omnysync/contracts";
var EMPLOYMENT_TYPES = ["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN"];
var EMPLOYEE_STATUSES = ["ACTIVE", "ON_LEAVE", "SUSPENDED", "TERMINATED"];
function mask(value) {
  if (!value)
    return null;
  const v = String(value);
  if (v.length <= 4)
    return "****";
  return `${"*".repeat(Math.min(8, v.length - 4))}${v.slice(-4)}`;
}
function canSeeSensitive(req) {
  const p = req.session.permissions;
  return p.includes(Permission11.HRM_MANAGE) || p.includes(Permission11.PAYROLL_MANAGE);
}
async function loadPayrollInputs(legalEntityId, organizationId) {
  const employeesRes = await db.query(`SELECT e.id as employee_id, e.employee_number, e.first_name, e.last_name,
            ss.basic_salary, ss.house_rent_allowance, ss.utility_allowance, ss.medical_allowance, ss.other_allowances
     FROM employees e
     JOIN employee_salary_assignments esa ON esa.employee_id = e.id AND esa.is_current = true
     JOIN salary_structures ss ON ss.id = esa.salary_structure_id
     WHERE e.legal_entity_id = $1 AND e.organization_id = $2 AND e.status = 'ACTIVE'
     ORDER BY e.employee_number ASC`, [legalEntityId, organizationId]);
  if (employeesRes.rows.length === 0) {
    throw validationError("No active employees with assigned salary structures found");
  }
  const items = employeesRes.rows.map((emp) => {
    let calc;
    try {
      calc = PayrollEngine.computeEmployeePayroll(emp.employee_id, {
        basic_salary: emp.basic_salary,
        house_rent_allowance: emp.house_rent_allowance,
        utility_allowance: emp.utility_allowance,
        medical_allowance: emp.medical_allowance,
        other_allowances: emp.other_allowances
      });
    } catch (err) {
      throw validationError(err.message);
    }
    return { ...calc, employee_number: emp.employee_number, employee_name: `${emp.first_name} ${emp.last_name}`, payment_status: "PENDING" };
  });
  return { items, totals: PayrollEngine.aggregatePayrollRun(items) };
}
async function requirePayrollPeriod(periodId, monthYear, organizationId) {
  const period = await requireOrgRow(db, "fiscal_periods", periodId, organizationId, "Fiscal period");
  const start = toIsoDate(period.start_date);
  if (start.slice(0, 7) !== monthYear) {
    throw validationError(`month_year ${monthYear} does not match fiscal period ${period.period_name} (${start.slice(0, 7)})`, {
      field: "month_year"
    });
  }
  return period;
}
function registerHrmRoutes(app) {
  const hrRead = requireAnyPermission(Permission11.HRM_MANAGE, Permission11.PAYROLL_MANAGE, Permission11.FINANCE_REPORTS_VIEW);
  app.get("/api/hrm/departments", authenticate, hrRead, async (req, res) => {
    const result = await db.query(`SELECT * FROM departments WHERE organization_id = $1 AND legal_entity_id = $2 ORDER BY code ASC`, [
      req.session.organization_id,
      req.session.legal_entity_id
    ]);
    return ok(req, res, result.rows, 200, { total_count: result.rows.length });
  });
  app.post("/api/hrm/departments", authenticate, requirePermission(Permission11.HRM_MANAGE), async (req, res) => {
    const code = str(req.body?.code, "code", { max: 32 });
    const name = str(req.body?.name, "name", { max: 255 });
    const cost_center_code = optionalStr(req.body?.cost_center_code, "cost_center_code", 64);
    const deptId = crypto10.randomUUID();
    await db.query(`INSERT INTO departments (id, organization_id, legal_entity_id, code, name, cost_center_code, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true)`, [deptId, req.session.organization_id, req.session.legal_entity_id, code, name, cost_center_code]);
    const dept = (await db.query(`SELECT * FROM departments WHERE id = $1`, [deptId])).rows[0];
    return ok(req, res, dept, 201);
  });
  app.get("/api/hrm/designations", authenticate, hrRead, async (req, res) => {
    const result = await db.query(`SELECT d.*, dept.name as department_name
       FROM designations d LEFT JOIN departments dept ON dept.id = d.department_id
       WHERE d.organization_id = $1 AND d.legal_entity_id = $2 ORDER BY d.code ASC`, [req.session.organization_id, req.session.legal_entity_id]);
    return ok(req, res, result.rows, 200, { total_count: result.rows.length });
  });
  app.post("/api/hrm/designations", authenticate, requirePermission(Permission11.HRM_MANAGE), async (req, res) => {
    const code = str(req.body?.code, "code", { max: 32 });
    const title = str(req.body?.title, "title", { max: 255 });
    const department_id = optionalUuid(req.body?.department_id, "department_id");
    await assertOrgRef(db, "departments", department_id, req.session.organization_id, "department_id");
    const desigId = crypto10.randomUUID();
    await db.query(`INSERT INTO designations (id, organization_id, legal_entity_id, code, title, department_id, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true)`, [desigId, req.session.organization_id, req.session.legal_entity_id, code, title, department_id]);
    const desig = (await db.query(`SELECT * FROM designations WHERE id = $1`, [desigId])).rows[0];
    return ok(req, res, desig, 201);
  });
  app.get("/api/hrm/salary-structures", authenticate, requireAnyPermission(Permission11.HRM_MANAGE, Permission11.PAYROLL_MANAGE), async (req, res) => {
    const result = await db.query(`SELECT * FROM salary_structures WHERE organization_id = $1 AND legal_entity_id = $2 ORDER BY name ASC`, [
      req.session.organization_id,
      req.session.legal_entity_id
    ]);
    return ok(req, res, result.rows, 200, { total_count: result.rows.length });
  });
  app.post("/api/hrm/salary-structures", authenticate, requirePermission(Permission11.HRM_MANAGE), async (req, res) => {
    const b = req.body || {};
    const name = str(b.name, "name", { max: 255 });
    const currency = optionalStr(b.currency, "currency", 3) || "PKR";
    const basic_salary = decimal(b.basic_salary, "basic_salary", { sign: "positive", scale: 2 });
    const house_rent_allowance = decimal(b.house_rent_allowance, "house_rent_allowance", { required: false, scale: 2 });
    const utility_allowance = decimal(b.utility_allowance, "utility_allowance", { required: false, scale: 2 });
    const medical_allowance = decimal(b.medical_allowance, "medical_allowance", { required: false, scale: 2 });
    const other_allowances = decimal(b.other_allowances, "other_allowances", { required: false, scale: 2 });
    const { gross } = PayrollEngine.computeGross({ basic_salary, house_rent_allowance, utility_allowance, medical_allowance, other_allowances });
    const structId = crypto10.randomUUID();
    await db.query(`INSERT INTO salary_structures (
        id, organization_id, legal_entity_id, name, currency,
        basic_salary, house_rent_allowance, utility_allowance, medical_allowance, other_allowances, gross_salary, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)`, [
      structId,
      req.session.organization_id,
      req.session.legal_entity_id,
      name,
      currency,
      new Money9(basic_salary).format(),
      new Money9(house_rent_allowance).format(),
      new Money9(utility_allowance).format(),
      new Money9(medical_allowance).format(),
      new Money9(other_allowances).format(),
      gross.format()
    ]);
    const struct = (await db.query(`SELECT * FROM salary_structures WHERE id = $1`, [structId])).rows[0];
    return ok(req, res, struct, 201);
  });
  app.get("/api/hrm/employees", authenticate, hrRead, async (req, res) => {
    const result = await db.query(`SELECT e.*, dept.name as department_name, desig.title as designation_title,
              ss.id as salary_structure_id, ss.name as salary_structure_name, ss.basic_salary, ss.gross_salary
       FROM employees e
       LEFT JOIN departments dept ON dept.id = e.department_id
       LEFT JOIN designations desig ON desig.id = e.designation_id
       LEFT JOIN employee_salary_assignments esa ON esa.employee_id = e.id AND esa.is_current = true
       LEFT JOIN salary_structures ss ON ss.id = esa.salary_structure_id
       WHERE e.organization_id = $1 AND e.legal_entity_id = $2
       ORDER BY e.employee_number ASC`, [req.session.organization_id, req.session.legal_entity_id]);
    const sensitive = canSeeSensitive(req);
    const formatted = result.rows.map((r) => ({
      id: r.id,
      organization_id: r.organization_id,
      legal_entity_id: r.legal_entity_id,
      employee_number: r.employee_number,
      first_name: r.first_name,
      last_name: r.last_name,
      email: r.email,
      phone: r.phone,
      national_id: sensitive ? r.national_id : mask(r.national_id),
      department_id: r.department_id,
      department_name: r.department_name,
      designation_id: r.designation_id,
      designation_title: r.designation_title,
      employment_type: r.employment_type,
      joining_date: r.joining_date,
      status: r.status,
      bank_name: r.bank_name,
      bank_account_number: sensitive ? r.bank_account_number : mask(r.bank_account_number),
      salary_structure: r.salary_structure_id ? {
        id: r.salary_structure_id,
        name: r.salary_structure_name,
        basic_salary: sensitive ? r.basic_salary : null,
        gross_salary: sensitive ? r.gross_salary : null
      } : null,
      created_at: r.created_at,
      updated_at: r.updated_at
    }));
    return ok(req, res, formatted, 200, { total_count: formatted.length, sensitive_fields: sensitive ? "visible" : "masked" });
  });
  app.post("/api/hrm/employees", authenticate, requirePermission(Permission11.HRM_MANAGE), async (req, res) => {
    const b = req.body || {};
    const org = req.session.organization_id;
    const joining_date = dateOnly(b.joining_date, "joining_date");
    const first_name = str(b.first_name, "first_name", { max: 100 });
    const last_name = str(b.last_name, "last_name", { max: 100 });
    const email = optionalStr(b.email, "email", 255);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw validationError("email is not valid", { field: "email" });
    const department_id = optionalUuid(b.department_id, "department_id");
    const designation_id = optionalUuid(b.designation_id, "designation_id");
    const salary_structure_id = optionalUuid(b.salary_structure_id, "salary_structure_id");
    await assertOrgRef(db, "departments", department_id, org, "department_id");
    await assertOrgRef(db, "designations", designation_id, org, "designation_id");
    await assertOrgRef(db, "salary_structures", salary_structure_id, org, "salary_structure_id");
    const employment_type = oneOf(b.employment_type, "employment_type", EMPLOYMENT_TYPES, "FULL_TIME");
    const empId = crypto10.randomUUID();
    const emp = await db.transaction(async (tx) => {
      const employee_number = optionalStr(b.employee_number, "employee_number", 32) || await nextDocumentNumber(tx, org, "EMP", joining_date, 4);
      await tx.query(`INSERT INTO employees (
          id, organization_id, legal_entity_id, employee_number, first_name, last_name,
          email, phone, national_id, department_id, designation_id, employment_type, joining_date,
          status, bank_name, bank_account_number
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'ACTIVE', $14, $15)`, [
        empId,
        org,
        req.session.legal_entity_id,
        employee_number,
        first_name,
        last_name,
        email,
        optionalStr(b.phone, "phone", 32),
        optionalStr(b.national_id, "national_id", 32),
        department_id,
        designation_id,
        employment_type,
        joining_date,
        optionalStr(b.bank_name, "bank_name", 100),
        optionalStr(b.bank_account_number, "bank_account_number", 64)
      ]);
      if (salary_structure_id) {
        await tx.query(`INSERT INTO employee_salary_assignments (id, employee_id, salary_structure_id, effective_from, is_current)
           VALUES ($1, $2, $3, $4, true)`, [crypto10.randomUUID(), empId, salary_structure_id, joining_date]);
      }
      await auditLogger.record({
        organization_id: org,
        user_id: req.session.user_id,
        action: "EMPLOYEE_CREATED",
        entity_type: "EMPLOYEE",
        entity_id: empId,
        after_state: { employee_number, department_id, designation_id, employment_type, joining_date },
        correlation_id: req.correlationId
      }, tx);
      return (await tx.query(`SELECT * FROM employees WHERE id = $1`, [empId])).rows[0];
    });
    return ok(req, res, emp, 201);
  });
  app.post("/api/hrm/employees/:id/status", authenticate, requirePermission(Permission11.HRM_MANAGE), async (req, res) => {
    const status = oneOf(req.body?.status, "status", EMPLOYEE_STATUSES);
    const effective_date = dateOnly(req.body?.effective_date, "effective_date");
    const reason = str(req.body?.reason, "reason", { max: 500 });
    const out = await db.transaction(async (tx) => {
      const emp = await requireOrgRow(tx, "employees", req.params.id, req.session.organization_id, "Employee", { forUpdate: true });
      if (emp.status === "TERMINATED")
        throw new ApiError(409, ErrorCode20.INVALID_STATE, "Terminated employees must be rehired as a new employment record");
      await tx.query("UPDATE employees SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2", [status, emp.id]);
      await auditLogger.record({
        organization_id: req.session.organization_id,
        user_id: req.session.user_id,
        action: "EMPLOYEE_STATUS_CHANGED",
        entity_type: "EMPLOYEE",
        entity_id: emp.id,
        before_state: { status: emp.status },
        after_state: { status, effective_date, reason },
        correlation_id: req.correlationId
      }, tx);
      return { id: emp.id, status };
    });
    return ok(req, res, out);
  });
  app.post("/api/hrm/payroll/calculate", authenticate, requirePermission(Permission11.PAYROLL_MANAGE), async (req, res) => {
    const period_id = str(req.body?.period_id, "period_id", { max: 64 });
    const month_year = str(req.body?.month_year, "month_year", { pattern: /^\d{4}-\d{2}$/, max: 7 });
    await requirePayrollPeriod(period_id, month_year, req.session.organization_id);
    const { items, totals } = await loadPayrollInputs(req.session.legal_entity_id, req.session.organization_id);
    return ok(req, res, { period_id, month_year, totals, items });
  });
  app.get("/api/hrm/payroll-runs", authenticate, requireAnyPermission(Permission11.PAYROLL_MANAGE, Permission11.PAYROLL_APPROVE), async (req, res) => {
    const runsRes = await db.query(`SELECT pr.*, fp.period_name as period_name
       FROM payroll_runs pr LEFT JOIN fiscal_periods fp ON fp.id = pr.period_id
       WHERE pr.organization_id = $1 AND pr.legal_entity_id = $2
       ORDER BY pr.created_at DESC`, [req.session.organization_id, req.session.legal_entity_id]);
    const runsWithItems = [];
    for (const run of runsRes.rows) {
      const itemsRes = await db.query(`SELECT pri.*, e.employee_number, e.first_name, e.last_name
         FROM payroll_run_items pri JOIN employees e ON e.id = pri.employee_id
         WHERE pri.payroll_run_id = $1 ORDER BY e.employee_number ASC`, [run.id]);
      runsWithItems.push({ ...run, items: itemsRes.rows.map((it) => ({ ...it, employee_name: `${it.first_name} ${it.last_name}` })) });
    }
    return ok(req, res, runsWithItems, 200, { total_count: runsWithItems.length });
  });
  app.post("/api/hrm/payroll-runs", authenticate, requirePermission(Permission11.PAYROLL_MANAGE), async (req, res) => {
    const org = req.session.organization_id;
    const period_id = str(req.body?.period_id, "period_id", { max: 64 });
    const month_year = str(req.body?.month_year, "month_year", { pattern: /^\d{4}-\d{2}$/, max: 7 });
    const off_cycle = bool(req.body?.off_cycle, false);
    const period = await requirePayrollPeriod(period_id, month_year, org);
    if (period.status === "HARD_CLOSED")
      throw new ApiError(400, ErrorCode20.PERIOD_CLOSED, "Cannot create a pay run for a hard-closed period");
    const { items, totals } = await loadPayrollInputs(req.session.legal_entity_id, org);
    const runId = crypto10.randomUUID();
    const run = await db.transaction(async (tx) => {
      if (!off_cycle) {
        const dup = await tx.query(`SELECT run_number FROM payroll_runs WHERE organization_id = $1 AND legal_entity_id = $2 AND month_year = $3 AND run_type = 'REGULAR' AND status <> 'CANCELLED'`, [org, req.session.legal_entity_id, month_year]);
        if (dup.rows.length > 0) {
          throw new ApiError(409, ErrorCode20.DUPLICATE_RESOURCE, `A regular pay run (${dup.rows[0].run_number}) already exists for ${month_year}; use an off-cycle run for corrections`);
        }
      }
      const run_number = optionalStr(req.body?.run_number, "run_number", 64) || await nextDocumentNumber(tx, org, "PR", `${month_year}-01`, 3);
      await tx.query(`INSERT INTO payroll_runs (
          id, organization_id, legal_entity_id, period_id, run_number, month_year,
          total_gross, total_tax, total_eobi, total_provident_fund, total_other_deductions,
          total_deductions, total_net, status, created_by, run_type
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'DRAFT', $14, $15)`, [
        runId,
        org,
        req.session.legal_entity_id,
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
        req.session.user_id,
        off_cycle ? "OFF_CYCLE" : "REGULAR"
      ]);
      for (const item of items) {
        await tx.query(`INSERT INTO payroll_run_items (
            id, payroll_run_id, employee_id, basic_salary, allowances_total, gross_salary,
            tax_deduction, eobi_deduction, provident_fund_deduction, other_deductions,
            total_deductions, net_salary, payment_status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'PENDING')`, [
          crypto10.randomUUID(),
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
          item.net_salary
        ]);
      }
      await auditLogger.record({
        organization_id: org,
        user_id: req.session.user_id,
        action: "PAYROLL_RUN_CALCULATED",
        entity_type: "PAYROLL_RUN",
        entity_id: runId,
        after_state: { run_number, month_year, employees: items.length },
        correlation_id: req.correlationId
      }, tx);
      return (await tx.query(`SELECT * FROM payroll_runs WHERE id = $1`, [runId])).rows[0];
    });
    return ok(req, res, { ...run, totals, items }, 201);
  });
  app.post("/api/hrm/payroll-runs/:id/approve", authenticate, requirePermission(Permission11.PAYROLL_APPROVE), async (req, res) => {
    const out = await db.transaction(async (tx) => {
      const run = await requireOrgRow(tx, "payroll_runs", req.params.id, req.session.organization_id, "Payroll run", { forUpdate: true });
      if (run.created_by === req.session.user_id) {
        throw sodViolation("Segregation of duties: the payroll preparer cannot approve the same pay run");
      }
      await transition(tx, {
        table: "payroll_runs",
        id: run.id,
        organizationId: req.session.organization_id,
        from: ["DRAFT"],
        to: "APPROVED",
        label: "Payroll run",
        set: { approved_by: req.session.user_id, approved_at: (/* @__PURE__ */ new Date()).toISOString(), updated_at: (/* @__PURE__ */ new Date()).toISOString() }
      });
      await auditLogger.record({ organization_id: req.session.organization_id, user_id: req.session.user_id, action: "PAYROLL_RUN_APPROVED", entity_type: "PAYROLL_RUN", entity_id: run.id, before_state: { status: run.status }, after_state: { status: "APPROVED" }, correlation_id: req.correlationId }, tx);
      return { id: run.id, status: "APPROVED" };
    });
    return ok(req, res, out);
  });
  app.post("/api/hrm/payroll-runs/:id/post", authenticate, requirePermission(Permission11.PAYROLL_POST), async (req, res) => {
    const out = await db.transaction(async (tx) => {
      const run = await requireOrgRow(tx, "payroll_runs", req.params.id, req.session.organization_id, "Payroll run", { forUpdate: true });
      if (run.status !== "APPROVED") {
        throw new ApiError(409, ErrorCode20.INVALID_STATE, `Only APPROVED payroll runs can be posted (current: ${run.status})`);
      }
      const period = await requireOrgRow(tx, "fiscal_periods", run.period_id, req.session.organization_id, "Fiscal period");
      const accounts = await tx.query(`SELECT id, code FROM accounts WHERE organization_id = $1 AND code IN ('521002','212002','212003','212004','211004','211009')`, [
        req.session.organization_id
      ]);
      const map = new Map(accounts.rows.map((a) => [a.code, a.id]));
      if (!map.get("521002") || !map.get("212002") || !map.get("212003") || !map.get("211004")) {
        throw new ApiError(400, ErrorCode20.MAPPING_MISSING, "Required payroll GL accounts (521002, 212002, 212003, 211004) are missing in COA");
      }
      let lines;
      try {
        lines = PayrollEngine.generatePayrollJournalLines({
          totals: run,
          salariesExpenseAccountId: map.get("521002"),
          taxPayableAccountId: map.get("212002"),
          eobiPayableAccountId: map.get("212003"),
          providentFundPayableAccountId: map.get("212004"),
          otherDeductionsPayableAccountId: map.get("211009"),
          salariesPayableAccountId: map.get("211004")
        });
      } catch (err) {
        throw new ApiError(400, ErrorCode20.MAPPING_MISSING, err.message);
      }
      const posted = await postJournal(tx, auditLogger, outboxService, {
        organizationId: req.session.organization_id,
        legalEntityId: run.legal_entity_id,
        userId: req.session.user_id,
        postingDate: toIsoDate(period.end_date),
        purpose: AccountingPurpose5.PAYROLL_RUN,
        description: `Payroll expense and liabilities accrual for ${run.month_year} (${run.run_number})`,
        sourceType: "PAYROLL_RUN",
        sourceId: run.id,
        sourceKey: `PAYROLL_RUN:${run.id}`,
        numberPrefix: "JV-PAY",
        approvedBy: run.approved_by,
        correlationId: req.correlationId,
        lines: lines.map((l) => ({ account_id: l.account_id, debit: l.base_debit, credit: l.base_credit, description: l.description }))
      });
      await transition(tx, {
        table: "payroll_runs",
        id: run.id,
        organizationId: req.session.organization_id,
        from: ["APPROVED"],
        to: "POSTED",
        label: "Payroll run",
        set: { posted_journal_id: posted?.journalId ?? null, posted_by: req.session.user_id, updated_at: (/* @__PURE__ */ new Date()).toISOString() }
      });
      return { id: run.id, status: "POSTED", posted_journal_id: posted?.journalId ?? null };
    });
    return ok(req, res, out);
  });
  app.post("/api/hrm/payroll-runs/:id/disburse", authenticate, requirePermission(Permission11.PAYROLL_DISBURSE), async (req, res) => {
    const bank_account_id = optionalUuid(req.body?.bank_account_id, "bank_account_id");
    const payment_date = dateOnly(req.body?.payment_date, "payment_date", { required: false });
    const out = await db.transaction(async (tx) => {
      const run = await requireOrgRow(tx, "payroll_runs", req.params.id, req.session.organization_id, "Payroll run", { forUpdate: true });
      if (run.status !== "POSTED") {
        throw new ApiError(409, ErrorCode20.INVALID_STATE, `Only POSTED payroll runs can be disbursed (current: ${run.status})`);
      }
      if (run.created_by === req.session.user_id) {
        throw sodViolation("Segregation of duties: the payroll preparer cannot release the disbursement");
      }
      const period = await requireOrgRow(tx, "fiscal_periods", run.period_id, req.session.organization_id, "Fiscal period");
      let bankId = bank_account_id;
      if (bankId) {
        const bank = await tx.query(`SELECT id, control_type FROM accounts WHERE id = $1 AND organization_id = $2 AND level = 4`, [bankId, req.session.organization_id]);
        if (bank.rows.length === 0)
          throw validationError("Bank account not found", { field: "bank_account_id" });
      } else {
        const bankRes = await tx.query(`SELECT id FROM accounts WHERE organization_id = $1 AND code = '111002'`, [req.session.organization_id]);
        if (bankRes.rows.length === 0)
          throw new ApiError(400, ErrorCode20.MAPPING_MISSING, "Bank account not found for disbursement");
        bankId = bankRes.rows[0].id;
      }
      const postingDate = payment_date || toIsoDate(period.end_date);
      const posted = await postJournal(tx, auditLogger, outboxService, {
        organizationId: req.session.organization_id,
        legalEntityId: run.legal_entity_id,
        userId: req.session.user_id,
        postingDate,
        purpose: AccountingPurpose5.PAYROLL_DISBURSEMENT,
        description: `Bank disbursement of net salaries for ${run.month_year} (${run.run_number})`,
        sourceType: "PAYROLL_RUN",
        sourceId: run.id,
        sourceKey: `PAYROLL_DISBURSEMENT:${run.id}`,
        numberPrefix: "JV-PAYD",
        correlationId: req.correlationId,
        lines: [
          { account_code: "211004", debit: run.total_net, description: "Disbursement clearing for net salaries" },
          { account_id: bankId, credit: run.total_net, description: "Bank transfer payment for net salaries" }
        ]
      });
      await transition(tx, {
        table: "payroll_runs",
        id: run.id,
        organizationId: req.session.organization_id,
        from: ["POSTED"],
        to: "DISBURSED",
        label: "Payroll run",
        set: { disbursement_journal_id: posted?.journalId ?? null, disbursed_by: req.session.user_id, updated_at: (/* @__PURE__ */ new Date()).toISOString() }
      });
      await tx.query(`UPDATE payroll_run_items SET payment_status = 'PAID' WHERE payroll_run_id = $1`, [run.id]);
      return { id: run.id, status: "DISBURSED", disbursement_journal_id: posted?.journalId ?? null };
    });
    return ok(req, res, out);
  });
  app.post("/api/hrm/payroll-runs/:id/cancel", authenticate, requirePermission(Permission11.PAYROLL_MANAGE), async (req, res) => {
    const reason = str(req.body?.reason, "reason", { max: 500 });
    const out = await db.transaction(async (tx) => {
      const run = await transition(tx, {
        table: "payroll_runs",
        id: req.params.id,
        organizationId: req.session.organization_id,
        from: ["DRAFT", "APPROVED"],
        to: "CANCELLED",
        label: "Payroll run",
        set: { updated_at: (/* @__PURE__ */ new Date()).toISOString() }
      });
      await auditLogger.record({ organization_id: req.session.organization_id, user_id: req.session.user_id, action: "PAYROLL_RUN_CANCELLED", entity_type: "PAYROLL_RUN", entity_id: run.id, after_state: { reason }, correlation_id: req.correlationId }, tx);
      return { id: run.id, status: "CANCELLED" };
    });
    return ok(req, res, out);
  });
  app.get("/api/hrm/advances", authenticate, hrRead, async (req, res) => {
    const result = await db.query(`SELECT a.*, e.employee_number, e.first_name || ' ' || e.last_name AS employee_name
       FROM hrm_advances a
       JOIN employees e ON e.id = a.employee_id
       WHERE a.organization_id = $1
       ORDER BY a.created_at DESC`, [req.session.organization_id]);
    return ok(req, res, result.rows, 200, { total_count: result.rows.length });
  });
  app.post("/api/hrm/advances", authenticate, requirePermission(Permission11.HRM_MANAGE), async (req, res) => {
    const employee_id = str(req.body?.employee_id, "employee_id");
    const advance_type = oneOf(req.body?.advance_type, "advance_type", ["CASH", "TRAVEL", "PARTS_FLOAT", "EMERGENCY_LOAN"]);
    const amount = decimal(req.body?.amount, "amount", { sign: "positive" });
    const purpose = str(req.body?.purpose, "purpose", { max: 1e3 });
    const repayment_months = Math.max(1, Number(req.body?.repayment_months || 1));
    const monthly_deduction = new Money9(amount).div(repayment_months).toFixed(8);
    await assertOrgRef(db, "employees", employee_id, req.session.organization_id, "employee_id");
    const docNumber = await nextDocumentNumber(db, req.session.organization_id, "ADV");
    const advId = crypto10.randomUUID();
    await db.query(`INSERT INTO hrm_advances (id, organization_id, legal_entity_id, number, employee_id, advance_type, amount, purpose, repayment_months, monthly_deduction, balance_amount, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'DRAFT', $12)`, [advId, req.session.organization_id, req.session.legal_entity_id, docNumber, employee_id, advance_type, amount, purpose, repayment_months, monthly_deduction, amount, req.session.user_id]);
    const row = (await db.query(`SELECT * FROM hrm_advances WHERE id = $1`, [advId])).rows[0];
    return ok(req, res, row, 201);
  });
  app.post("/api/hrm/advances/:id/approve", authenticate, requirePermission(Permission11.HRM_MANAGE), async (req, res) => {
    const out = await db.transaction(async (tx) => {
      const adv = await requireOrgRow(tx, "hrm_advances", req.params.id, req.session.organization_id, "Staff advance", { forUpdate: true });
      if (adv.status !== "DRAFT" && adv.status !== "SUBMITTED") {
        throw new ApiError(409, ErrorCode20.INVALID_STATE, `Only DRAFT or SUBMITTED advances can be approved (current: ${adv.status})`);
      }
      if (adv.created_by === req.session.user_id) {
        throw sodViolation("Segregation of duties: preparer cannot approve staff advance");
      }
      await tx.query(`UPDATE hrm_advances SET status = 'APPROVED', approved_by = $2, updated_at = NOW() WHERE id = $1`, [adv.id, req.session.user_id]);
      return { id: adv.id, status: "APPROVED" };
    });
    return ok(req, res, out);
  });
  app.post("/api/hrm/advances/:id/disburse", authenticate, requirePermission(Permission11.PAYROLL_DISBURSE), async (req, res) => {
    const payment_date = dateOnly(req.body?.payment_date, "payment_date", { required: false }) || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const out = await db.transaction(async (tx) => {
      const adv = await requireOrgRow(tx, "hrm_advances", req.params.id, req.session.organization_id, "Staff advance", { forUpdate: true });
      if (adv.status !== "APPROVED") {
        throw new ApiError(409, ErrorCode20.INVALID_STATE, `Only APPROVED advances can be disbursed (current: ${adv.status})`);
      }
      const bankRes = await tx.query(`SELECT id FROM accounts WHERE organization_id = $1 AND code = '111002'`, [req.session.organization_id]);
      if (bankRes.rows.length === 0)
        throw new ApiError(400, ErrorCode20.MAPPING_MISSING, "Operating bank account not found");
      const bankId = bankRes.rows[0].id;
      const advanceAcc = (await tx.query(`SELECT id FROM accounts WHERE organization_id = $1 AND code IN ('112006', '112004', '113005') ORDER BY code ASC LIMIT 1`, [req.session.organization_id])).rows[0]?.id;
      const posted = await postJournal(tx, auditLogger, outboxService, {
        organizationId: req.session.organization_id,
        legalEntityId: adv.legal_entity_id,
        userId: req.session.user_id,
        postingDate: payment_date,
        purpose: AccountingPurpose5.PAYROLL_DISBURSEMENT,
        description: `Disbursement of staff advance ${adv.number} - ${adv.advance_type}`,
        sourceType: "HRM_ADVANCE",
        sourceId: adv.id,
        sourceKey: `HRM_ADVANCE:${adv.id}`,
        numberPrefix: "JV-ADV",
        correlationId: req.correlationId,
        lines: [
          advanceAcc ? { account_id: advanceAcc, debit: adv.amount, description: `Staff advance receivable ${adv.number}` } : { account_code: "112006", debit: adv.amount, description: `Staff advance receivable ${adv.number}` },
          { account_id: bankId, credit: adv.amount, description: `Bank disbursement for advance ${adv.number}` }
        ]
      });
      const months = Number(adv.repayment_months);
      const monthlyAmt = new Money9(adv.amount).div(months).toFixed(8);
      for (let i = 1; i <= months; i++) {
        const dueDate = /* @__PURE__ */ new Date();
        dueDate.setMonth(dueDate.getMonth() + i);
        await tx.query(`INSERT INTO hrm_advance_installments (id, advance_id, installment_number, due_date, amount, status)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, 'PENDING')`, [adv.id, i, dueDate.toISOString().slice(0, 10), monthlyAmt]);
      }
      await tx.query(`UPDATE hrm_advances SET status = 'DISBURSED', disbursement_journal_id = $2, disbursed_at = NOW(), updated_at = NOW() WHERE id = $1`, [adv.id, posted?.journalId ?? null]);
      return { id: adv.id, status: "DISBURSED", journal_id: posted?.journalId };
    });
    return ok(req, res, out);
  });
  app.get("/api/hrm/geofences", authenticate, hrRead, async (req, res) => {
    const result = await db.query(`SELECT * FROM hrm_geofence_zones WHERE organization_id = $1 ORDER BY code ASC`, [req.session.organization_id]);
    return ok(req, res, result.rows, 200, { total_count: result.rows.length });
  });
  app.post("/api/hrm/geofences", authenticate, requirePermission(Permission11.HRM_MANAGE), async (req, res) => {
    const code = str(req.body?.code, "code", { max: 32 });
    const name = str(req.body?.name, "name", { max: 255 });
    const latitude = Number(req.body?.latitude);
    const longitude = Number(req.body?.longitude);
    const radius_meters = Number(req.body?.radius_meters || 100);
    const geoId = crypto10.randomUUID();
    await db.query(`INSERT INTO hrm_geofence_zones (id, organization_id, code, name, latitude, longitude, radius_meters, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)
       ON CONFLICT (organization_id, code) DO UPDATE SET name = EXCLUDED.name, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude, radius_meters = EXCLUDED.radius_meters`, [geoId, req.session.organization_id, code, name, latitude, longitude, radius_meters]);
    const row = (await db.query(`SELECT * FROM hrm_geofence_zones WHERE id = $1`, [geoId])).rows[0];
    return ok(req, res, row, 201);
  });
  app.get("/api/hrm/shifts", authenticate, hrRead, async (req, res) => {
    const result = await db.query(`SELECT * FROM hrm_shifts WHERE organization_id = $1 ORDER BY code ASC`, [req.session.organization_id]);
    return ok(req, res, result.rows, 200, { total_count: result.rows.length });
  });
  app.post("/api/hrm/shifts", authenticate, requirePermission(Permission11.HRM_MANAGE), async (req, res) => {
    const code = str(req.body?.code, "code", { max: 32 });
    const name = str(req.body?.name, "name", { max: 255 });
    const start_time = str(req.body?.start_time, "start_time", { max: 5 });
    const end_time = str(req.body?.end_time, "end_time", { max: 5 });
    const grace_period_minutes = Number(req.body?.grace_period_minutes || 15);
    const half_day_hours = Number(req.body?.half_day_hours || 4.5);
    const shiftId = crypto10.randomUUID();
    await db.query(`INSERT INTO hrm_shifts (id, organization_id, code, name, start_time, end_time, grace_period_minutes, half_day_hours, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
       ON CONFLICT (organization_id, code) DO UPDATE SET name = EXCLUDED.name, start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time`, [shiftId, req.session.organization_id, code, name, start_time, end_time, grace_period_minutes, half_day_hours]);
    const row = (await db.query(`SELECT * FROM hrm_shifts WHERE id = $1`, [shiftId])).rows[0];
    return ok(req, res, row, 201);
  });
  app.get("/api/hrm/attendance", authenticate, hrRead, async (req, res) => {
    const date = req.query?.date ? String(req.query.date) : null;
    const params = [req.session.organization_id];
    let query = `
      SELECT a.*, e.employee_number, e.first_name || ' ' || e.last_name AS employee_name,
             s.name AS shift_name, g.name AS geofence_zone_name
      FROM hrm_attendance_logs a
      JOIN employees e ON e.id = a.employee_id
      LEFT JOIN hrm_shifts s ON s.id = a.shift_id
      LEFT JOIN hrm_geofence_zones g ON g.id = a.geofence_zone_id
      WHERE a.organization_id = $1
    `;
    if (date) {
      params.push(date);
      query += ` AND a.work_date = $2`;
    }
    query += ` ORDER BY a.work_date DESC, a.created_at DESC`;
    const result = await db.query(query, params);
    return ok(req, res, result.rows, 200, { total_count: result.rows.length });
  });
  app.post("/api/hrm/attendance/check-in", authenticate, async (req, res) => {
    const employee_id = str(req.body?.employee_id, "employee_id");
    const work_date = dateOnly(req.body?.work_date, "work_date", { required: false }) || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const shift_id = optionalUuid(req.body?.shift_id, "shift_id");
    const latitude = Number(req.body?.latitude || 0);
    const longitude = Number(req.body?.longitude || 0);
    const verification_method = oneOf(req.body?.verification_method, "verification_method", ["GEOFENCE", "FACE_VERIFIED", "BIOMETRIC", "MANUAL"]);
    const notes = optionalStr(req.body?.notes, "notes", 500);
    await assertOrgRef(db, "employees", employee_id, req.session.organization_id, "employee_id");
    const zones = (await db.query(`SELECT * FROM hrm_geofence_zones WHERE organization_id = $1 AND is_active = true`, [req.session.organization_id])).rows;
    let insideZoneId = null;
    let geofence_status = "OUTSIDE_GEOFENCE";
    for (const z of zones) {
      const d = Math.hypot((Number(z.latitude) - latitude) * 111320, (Number(z.longitude) - longitude) * 111320 * Math.cos(latitude * Math.PI / 180));
      if (d <= Number(z.radius_meters)) {
        insideZoneId = z.id;
        geofence_status = "INSIDE_GEOFENCE";
        break;
      }
    }
    const logId = crypto10.randomUUID();
    await db.query(`INSERT INTO hrm_attendance_logs (id, organization_id, employee_id, work_date, shift_id, check_in_time, check_in_lat, check_in_lng, geofence_zone_id, geofence_status, verification_method, status, notes)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8, $9, $10, 'PRESENT', $11)
       ON CONFLICT (employee_id, work_date) DO UPDATE SET
         check_in_time = NOW(), check_in_lat = EXCLUDED.check_in_lat, check_in_lng = EXCLUDED.check_in_lng, geofence_zone_id = EXCLUDED.geofence_zone_id, geofence_status = EXCLUDED.geofence_status`, [logId, req.session.organization_id, employee_id, work_date, shift_id, latitude, longitude, insideZoneId, geofence_status, verification_method, notes]);
    const row = (await db.query(`SELECT * FROM hrm_attendance_logs WHERE employee_id = $1 AND work_date = $2`, [employee_id, work_date])).rows[0];
    return ok(req, res, row, 201);
  });
  app.post("/api/hrm/attendance/check-out", authenticate, async (req, res) => {
    const employee_id = str(req.body?.employee_id, "employee_id");
    const work_date = dateOnly(req.body?.work_date, "work_date", { required: false }) || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const log = (await db.query(`SELECT * FROM hrm_attendance_logs WHERE employee_id = $1 AND work_date = $2 AND organization_id = $3`, [employee_id, work_date, req.session.organization_id])).rows[0];
    if (!log)
      throw new ApiError(404, ErrorCode20.RESOURCE_NOT_FOUND, "Check-in record not found for this date");
    const checkIn = new Date(log.check_in_time);
    const now = /* @__PURE__ */ new Date();
    const hours = Math.max(0, (now.getTime() - checkIn.getTime()) / (1e3 * 60 * 60));
    await db.query(`UPDATE hrm_attendance_logs SET check_out_time = NOW(), total_hours = $3 WHERE employee_id = $1 AND work_date = $2`, [employee_id, work_date, hours.toFixed(2)]);
    const row = (await db.query(`SELECT * FROM hrm_attendance_logs WHERE employee_id = $1 AND work_date = $2`, [employee_id, work_date])).rows[0];
    return ok(req, res, row);
  });
  app.get("/api/hrm/leave-types", authenticate, hrRead, async (req, res) => {
    const result = await db.query(`SELECT * FROM hrm_leave_types WHERE organization_id = $1 ORDER BY code ASC`, [req.session.organization_id]);
    return ok(req, res, result.rows, 200, { total_count: result.rows.length });
  });
  app.post("/api/hrm/leave-types", authenticate, requirePermission(Permission11.HRM_MANAGE), async (req, res) => {
    const code = str(req.body?.code, "code", { max: 32 });
    const name = str(req.body?.name, "name", { max: 255 });
    const annual_quota = Number(req.body?.annual_quota || 0);
    const is_paid = bool(req.body?.is_paid, true);
    const typeId = crypto10.randomUUID();
    await db.query(`INSERT INTO hrm_leave_types (id, organization_id, code, name, annual_quota, is_paid, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       ON CONFLICT (organization_id, code) DO UPDATE SET name = EXCLUDED.name, annual_quota = EXCLUDED.annual_quota, is_paid = EXCLUDED.is_paid`, [typeId, req.session.organization_id, code, name, annual_quota, is_paid]);
    const row = (await db.query(`SELECT * FROM hrm_leave_types WHERE id = $1`, [typeId])).rows[0];
    return ok(req, res, row, 201);
  });
  app.get("/api/hrm/leave-allocations", authenticate, hrRead, async (req, res) => {
    const year = Number(req.query?.year || (/* @__PURE__ */ new Date()).getFullYear());
    const result = await db.query(`SELECT la.*, e.employee_number, e.first_name || ' ' || e.last_name AS employee_name, lt.name AS leave_type_name, lt.code AS leave_type_code
       FROM hrm_leave_allocations la
       JOIN employees e ON e.id = la.employee_id
       JOIN hrm_leave_types lt ON lt.id = la.leave_type_id
       WHERE la.organization_id = $1 AND la.year = $2
       ORDER BY e.employee_number ASC`, [req.session.organization_id, year]);
    return ok(req, res, result.rows, 200, { total_count: result.rows.length });
  });
  app.post("/api/hrm/leave-allocations", authenticate, requirePermission(Permission11.HRM_MANAGE), async (req, res) => {
    const employee_id = str(req.body?.employee_id, "employee_id");
    const leave_type_id = str(req.body?.leave_type_id, "leave_type_id");
    const year = Number(req.body?.year || (/* @__PURE__ */ new Date()).getFullYear());
    const allocated_days = Number(req.body?.allocated_days || 0);
    const allocId = crypto10.randomUUID();
    await db.query(`INSERT INTO hrm_leave_allocations (id, organization_id, employee_id, leave_type_id, year, allocated_days, used_days, remaining_days)
       VALUES ($1, $2, $3, $4, $5, $6, 0, $6)
       ON CONFLICT (employee_id, leave_type_id, year) DO UPDATE SET allocated_days = EXCLUDED.allocated_days, remaining_days = EXCLUDED.allocated_days - hrm_leave_allocations.used_days`, [allocId, req.session.organization_id, employee_id, leave_type_id, year, allocated_days]);
    const row = (await db.query(`SELECT * FROM hrm_leave_allocations WHERE id = $1`, [allocId])).rows[0];
    return ok(req, res, row, 201);
  });
  app.get("/api/hrm/expenses", authenticate, hrRead, async (req, res) => {
    const result = await db.query(`SELECT exp.*, e.employee_number, e.first_name || ' ' || e.last_name AS employee_name
       FROM hrm_expense_claims exp
       JOIN employees e ON e.id = exp.employee_id
       WHERE exp.organization_id = $1
       ORDER BY exp.claim_date DESC, exp.created_at DESC`, [req.session.organization_id]);
    return ok(req, res, result.rows, 200, { total_count: result.rows.length });
  });
  app.post("/api/hrm/expenses", authenticate, async (req, res) => {
    const employee_id = str(req.body?.employee_id, "employee_id");
    const claim_date = dateOnly(req.body?.claim_date, "claim_date", { required: false }) || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const category = oneOf(req.body?.category, "category", ["TRAVEL", "FUEL", "TOOLS", "PARTS", "FOOD", "OTHER"]);
    const amount = decimal(req.body?.amount, "amount", { sign: "positive" });
    const description = str(req.body?.description, "description", { max: 1e3 });
    const receipt_reference = optionalStr(req.body?.receipt_reference, "receipt_reference", 255);
    await assertOrgRef(db, "employees", employee_id, req.session.organization_id, "employee_id");
    const docNumber = await nextDocumentNumber(db, req.session.organization_id, "EXP");
    const expId = crypto10.randomUUID();
    await db.query(`INSERT INTO hrm_expense_claims (id, organization_id, legal_entity_id, number, employee_id, claim_date, category, amount, description, receipt_reference, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'SUBMITTED', $11)`, [expId, req.session.organization_id, req.session.legal_entity_id, docNumber, employee_id, claim_date, category, amount, description, receipt_reference, req.session.user_id]);
    const row = (await db.query(`SELECT * FROM hrm_expense_claims WHERE id = $1`, [expId])).rows[0];
    return ok(req, res, row, 201);
  });
  app.post("/api/hrm/expenses/:id/approve", authenticate, requirePermission(Permission11.HRM_MANAGE), async (req, res) => {
    const out = await db.transaction(async (tx) => {
      const exp = await requireOrgRow(tx, "hrm_expense_claims", req.params.id, req.session.organization_id, "Expense claim", { forUpdate: true });
      if (exp.status !== "SUBMITTED") {
        throw new ApiError(409, ErrorCode20.INVALID_STATE, `Only SUBMITTED expense claims can be approved (current: ${exp.status})`);
      }
      if (exp.created_by === req.session.user_id) {
        throw sodViolation("Segregation of duties: claim submitter cannot approve expense");
      }
      await tx.query(`UPDATE hrm_expense_claims SET status = 'APPROVED', approved_by = $2, approved_at = NOW() WHERE id = $1`, [exp.id, req.session.user_id]);
      return { id: exp.id, status: "APPROVED" };
    });
    return ok(req, res, out);
  });
  app.post("/api/hrm/expenses/:id/settle", authenticate, requirePermission(Permission11.PAYROLL_DISBURSE), async (req, res) => {
    const payment_date = dateOnly(req.body?.payment_date, "payment_date", { required: false }) || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const out = await db.transaction(async (tx) => {
      const exp = await requireOrgRow(tx, "hrm_expense_claims", req.params.id, req.session.organization_id, "Expense claim", { forUpdate: true });
      if (exp.status !== "APPROVED") {
        throw new ApiError(409, ErrorCode20.INVALID_STATE, `Only APPROVED expense claims can be settled (current: ${exp.status})`);
      }
      const bankRes = await tx.query(`SELECT id FROM accounts WHERE organization_id = $1 AND code = '111002'`, [req.session.organization_id]);
      if (bankRes.rows.length === 0)
        throw new ApiError(400, ErrorCode20.MAPPING_MISSING, "Operating bank account not found");
      const bankId = bankRes.rows[0].id;
      const expAcc = (await tx.query(`SELECT id FROM accounts WHERE organization_id = $1 AND code IN ('521014', '521010', '521013') ORDER BY code ASC LIMIT 1`, [req.session.organization_id])).rows[0]?.id;
      const posted = await postJournal(tx, auditLogger, outboxService, {
        organizationId: req.session.organization_id,
        legalEntityId: exp.legal_entity_id,
        userId: req.session.user_id,
        postingDate: payment_date,
        purpose: AccountingPurpose5.PAYROLL_DISBURSEMENT,
        description: `Cash reimbursement for expense claim ${exp.number} (${exp.category})`,
        sourceType: "HRM_EXPENSE_CLAIM",
        sourceId: exp.id,
        sourceKey: `HRM_EXPENSE_CLAIM:${exp.id}`,
        numberPrefix: "JV-EXP",
        correlationId: req.correlationId,
        lines: [
          expAcc ? { account_id: expAcc, debit: exp.amount, description: `Field expense ${exp.number}` } : { account_code: "521014", debit: exp.amount, description: `Field expense ${exp.number}` },
          { account_id: bankId, credit: exp.amount, description: `Cash reimbursement for ${exp.number}` }
        ]
      });
      await tx.query(`UPDATE hrm_expense_claims SET status = 'SETTLED_CASH', settlement_journal_id = $2 WHERE id = $1`, [exp.id, posted?.journalId ?? null]);
      return { id: exp.id, status: "SETTLED_CASH", journal_id: posted?.journalId };
    });
    return ok(req, res, out);
  });
}

// apps/api/dist/routes/inventory.js
init_context();
init_http();
init_errors();
init_validate();
init_scope();
init_state();
init_posting();
init_numbering();
init_stock();
import { Money as Money10, InventoryReconciliationEngine } from "@omnysync/financial-engine";
import { AccountingPurpose as AccountingPurpose6, ErrorCode as ErrorCode21, Permission as Permission12 } from "@omnysync/contracts";
var INVENTORY_READ = [
  Permission12.INVENTORY_MANAGE,
  Permission12.WAREHOUSE_MANAGE,
  Permission12.INVENTORY_TRANSFER,
  Permission12.INVENTORY_COUNT,
  Permission12.INVENTORY_ADJUST,
  Permission12.ITEMS_MANAGE,
  Permission12.SALES_ORDER_MANAGE,
  Permission12.PURCHASE_ORDER_MANAGE,
  Permission12.WORK_ORDER_MANAGE,
  Permission12.POS_TERMINAL,
  Permission12.FINANCE_REPORTS_VIEW
];
async function audit4(req, tx, action, entityType, entityId, before, after) {
  await auditLogger.record({
    organization_id: req.session.organization_id,
    user_id: req.session.user_id,
    action,
    entity_type: entityType,
    entity_id: entityId,
    before_state: before,
    after_state: after,
    correlation_id: req.correlationId
  }, tx);
}
function registerInventoryRoutes(app) {
  const invRead = requireAnyPermission(...INVENTORY_READ);
  app.get("/api/inventory/warehouses", authenticate, invRead, async (req, res) => {
    const warehouses = (await db.query(`SELECT * FROM warehouses WHERE organization_id = $1 ORDER BY is_default DESC, name ASC`, [req.session.organization_id])).rows;
    for (const wh of warehouses) {
      wh.zones = (await db.query(`SELECT * FROM warehouse_zones WHERE warehouse_id = $1 ORDER BY code ASC`, [wh.id])).rows;
      wh.bins = (await db.query(`SELECT b.*, z.name as zone_name FROM warehouse_bins b LEFT JOIN warehouse_zones z ON b.zone_id = z.id WHERE b.warehouse_id = $1 ORDER BY b.bin_code ASC`, [wh.id])).rows;
    }
    return ok(req, res, warehouses, 200, { total_count: warehouses.length });
  });
  app.post("/api/inventory/warehouses", authenticate, requirePermission(Permission12.WAREHOUSE_MANAGE), async (req, res) => {
    const code = str(req.body?.code, "code", { max: 32 });
    const name = str(req.body?.name, "name", { max: 255 });
    const address = optionalStr(req.body?.address, "address", 1e3);
    const is_default = bool(req.body?.is_default, false);
    const wh = await db.transaction(async (tx) => {
      if (is_default)
        await tx.query(`UPDATE warehouses SET is_default = false WHERE organization_id = $1`, [req.session.organization_id]);
      const r = await tx.query(`INSERT INTO warehouses (code, name, address, is_default, organization_id) VALUES ($1, $2, $3, $4, $5) RETURNING *`, [
        code,
        name,
        address,
        is_default,
        req.session.organization_id
      ]);
      await audit4(req, tx, "WAREHOUSE_CREATED", "WAREHOUSE", r.rows[0].id, void 0, { code, name, is_default });
      return r.rows[0];
    });
    return ok(req, res, wh, 201);
  });
  app.post("/api/inventory/warehouses/:id/zones", authenticate, requirePermission(Permission12.WAREHOUSE_MANAGE), async (req, res) => {
    await requireOrgRow(db, "warehouses", req.params.id, req.session.organization_id, "Warehouse");
    const code = str(req.body?.code, "code", { max: 32 });
    const name = str(req.body?.name, "name", { max: 255 });
    const zone_type = oneOf(req.body?.zone_type, "zone_type", ["STORAGE", "RECEIVING", "SHIPPING", "QUARANTINE", "PRODUCTION", "RETURNS"], "STORAGE");
    const r = await db.query(`INSERT INTO warehouse_zones (warehouse_id, code, name, zone_type) VALUES ($1, $2, $3, $4) RETURNING *`, [req.params.id, code, name, zone_type]);
    return ok(req, res, r.rows[0], 201);
  });
  app.post("/api/inventory/warehouses/:id/bins", authenticate, requirePermission(Permission12.WAREHOUSE_MANAGE), async (req, res) => {
    await requireOrgRow(db, "warehouses", req.params.id, req.session.organization_id, "Warehouse");
    const bin_code = str(req.body?.bin_code, "bin_code", { max: 64 });
    const zone_id = optionalUuid(req.body?.zone_id, "zone_id");
    if (zone_id) {
      const z = await db.query(`SELECT 1 FROM warehouse_zones WHERE id = $1 AND warehouse_id = $2`, [zone_id, req.params.id]);
      if (z.rows.length === 0)
        throw validationError("Zone does not belong to this warehouse", { field: "zone_id" });
    }
    const cap = req.body?.max_weight_capacity == null || req.body?.max_weight_capacity === "" ? null : decimal(req.body.max_weight_capacity, "max_weight_capacity", { sign: "nonNegative" });
    const r = await db.query(`INSERT INTO warehouse_bins (warehouse_id, zone_id, bin_code, max_weight_capacity) VALUES ($1, $2, $3, $4) RETURNING *`, [
      req.params.id,
      zone_id,
      bin_code,
      cap
    ]);
    return ok(req, res, r.rows[0], 201);
  });
  app.get("/api/inventory/fifo/layers", authenticate, invRead, async (req, res) => {
    const itemId = optionalUuid(req.query.item_id, "item_id");
    const r = await db.query(`SELECT l.id, l.item_id, i.code AS item_code, i.name AS item_name, l.received_date, l.layer_source, l.qty_original::text, l.qty_remaining::text, l.unit_cost::text,
              (l.qty_remaining * l.unit_cost)::text AS remaining_value, w.code AS warehouse_code
       FROM stock_cost_layers l JOIN items i ON i.id = l.item_id LEFT JOIN warehouses w ON w.id = l.warehouse_id
       WHERE l.organization_id = $1 AND l.qty_remaining > 0 AND ($2::uuid IS NULL OR l.item_id = $2::uuid)
       ORDER BY i.code, l.received_date, l.seq LIMIT 500`, [req.session.organization_id, itemId ?? null]);
    return ok(req, res, r.rows);
  });
  app.post("/api/inventory/fifo/reconcile-layers", authenticate, requirePermission(Permission12.INVENTORY_MANAGE), async (req, res) => {
    const org = req.session.organization_id;
    const out = await db.transaction(async (tx) => {
      if (await costingMethod(tx, org) !== "FIFO")
        throw new ApiError(409, ErrorCode21.INVALID_STATE, "Costing method is not FIFO; layers are only maintained under FIFO");
      const r = await reconcileFifoLayers(tx, org, todayIso());
      if (r.opened.length || r.trimmed.length)
        await audit4(req, tx, "FIFO_LAYERS_RECONCILED", "INVENTORY", org, void 0, r);
      return r;
    });
    return ok(req, res, out);
  });
  app.get("/api/inventory/stock", authenticate, invRead, async (req, res) => {
    const org = req.session.organization_id;
    const warehouse_id = optionalUuid(req.query.warehouse_id, "warehouse_id");
    await assertOrgRef(db, "warehouses", warehouse_id, org, "warehouse_id");
    const params = [org];
    let locFilter = "";
    if (warehouse_id) {
      params.push(warehouse_id);
      locFilter = ` AND (sm.location_id = $2 OR (sm.location_id IS NULL AND EXISTS (SELECT 1 FROM warehouses w WHERE w.id = $2 AND w.is_default = true)))`;
    }
    const r = await db.query(`SELECT i.id as item_id, i.code as item_code, i.name as item_name, i.uom, i.unit_cost, i.unit_price, i.barcode,
              i.reorder_point, i.reorder_qty,
              COALESCE(SUM(sm.quantity), 0) as on_hand_qty, COALESCE(SUM(sm.total_value), 0) as total_valuation
       FROM items i LEFT JOIN stock_movements sm ON sm.item_id = i.id AND sm.organization_id = i.organization_id${locFilter}
       WHERE i.organization_id = $1 AND i.item_type = 'INVENTORY'
       GROUP BY i.id ORDER BY i.name ASC`, params);
    const rows = r.rows.map((x) => ({
      ...x,
      below_reorder_point: new Money10(x.reorder_point || "0").isPositive() && new Money10(x.on_hand_qty).lte(x.reorder_point)
    }));
    return ok(req, res, rows, 200, { total_count: rows.length, warehouse_id });
  });
  app.get("/api/inventory/items/:id/movements", authenticate, invRead, async (req, res) => {
    await requireOrgRow(db, "items", req.params.id, req.session.organization_id, "Item");
    const r = await db.query(`SELECT sm.*, w.code as warehouse_code FROM stock_movements sm LEFT JOIN warehouses w ON w.id = sm.location_id
       WHERE sm.organization_id = $1 AND sm.item_id = $2 ORDER BY sm.movement_date ASC, sm.created_at ASC LIMIT 5000`, [req.session.organization_id, req.params.id]);
    let running = new Money10(0);
    const rows = r.rows.map((m) => {
      running = running.add(m.quantity);
      return { ...m, running_qty: running.toFixed(8) };
    });
    return ok(req, res, rows, 200, { total_count: rows.length });
  });
  app.get("/api/inventory/lots", authenticate, invRead, async (req, res) => {
    const r = await db.query(`SELECT l.*, i.code as item_code, i.name as item_name FROM item_lots l JOIN items i ON l.item_id = i.id
       WHERE l.organization_id = $1 ORDER BY l.created_at DESC`, [req.session.organization_id]);
    return ok(req, res, r.rows, 200, { total_count: r.rows.length });
  });
  app.post("/api/inventory/lots", authenticate, requirePermission(Permission12.INVENTORY_MANAGE), async (req, res) => {
    const item_id = uuid(req.body?.item_id, "item_id");
    await assertOrgRef(db, "items", item_id, req.session.organization_id, "item_id");
    const lot_number = str(req.body?.lot_number, "lot_number", { max: 64 });
    const manufacture_date = optionalDate(req.body?.manufacture_date, "manufacture_date");
    const expiry_date = optionalDate(req.body?.expiry_date, "expiry_date");
    if (manufacture_date && expiry_date && expiry_date < manufacture_date)
      throw validationError("expiry_date cannot be before manufacture_date", { field: "expiry_date" });
    const status = oneOf(req.body?.status, "status", ["AVAILABLE", "QUARANTINE", "EXPIRED", "DEPLETED", "REJECTED"], "AVAILABLE");
    const r = await db.query(`INSERT INTO item_lots (item_id, lot_number, manufacture_date, expiry_date, status, organization_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`, [item_id, lot_number, manufacture_date, expiry_date, status, req.session.organization_id]);
    return ok(req, res, r.rows[0], 201);
  });
  app.get("/api/inventory/serials", authenticate, invRead, async (req, res) => {
    const r = await db.query(`SELECT s.*, i.code as item_code, i.name as item_name, w.name as warehouse_name, b.bin_code
       FROM item_serials s JOIN items i ON s.item_id = i.id
       LEFT JOIN warehouses w ON s.warehouse_id = w.id LEFT JOIN warehouse_bins b ON s.bin_id = b.id
       WHERE s.organization_id = $1 ORDER BY s.created_at DESC`, [req.session.organization_id]);
    return ok(req, res, r.rows, 200, { total_count: r.rows.length });
  });
  app.post("/api/inventory/serials", authenticate, requirePermission(Permission12.INVENTORY_MANAGE), async (req, res) => {
    const org = req.session.organization_id;
    const item_id = uuid(req.body?.item_id, "item_id");
    const serial_number = str(req.body?.serial_number, "serial_number", { max: 128 });
    const warehouse_id = optionalUuid(req.body?.warehouse_id, "warehouse_id");
    const bin_id = optionalUuid(req.body?.bin_id, "bin_id");
    await assertOrgRef(db, "items", item_id, org, "item_id");
    await assertOrgRef(db, "warehouses", warehouse_id, org, "warehouse_id");
    if (bin_id) {
      const b = await db.query(`SELECT 1 FROM warehouse_bins b JOIN warehouses w ON w.id = b.warehouse_id WHERE b.id = $1 AND w.organization_id = $2`, [bin_id, org]);
      if (b.rows.length === 0)
        throw validationError("Bin not found", { field: "bin_id" });
    }
    const status = oneOf(req.body?.status, "status", ["IN_STOCK", "RESERVED", "SOLD", "RETURNED", "SCRAPPED"], "IN_STOCK");
    const r = await db.query(`INSERT INTO item_serials (item_id, serial_number, warehouse_id, bin_id, status, organization_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`, [item_id, serial_number, warehouse_id, bin_id, status, org]);
    return ok(req, res, r.rows[0], 201);
  });
  app.get("/api/inventory/transfers", authenticate, invRead, async (req, res) => {
    const transfers = (await db.query(`SELECT t.*, sw.name as source_warehouse_name, dw.name as destination_warehouse_name
         FROM stock_transfers t JOIN warehouses sw ON t.source_warehouse_id = sw.id JOIN warehouses dw ON t.destination_warehouse_id = dw.id
         WHERE t.organization_id = $1 ORDER BY t.created_at DESC`, [req.session.organization_id])).rows;
    for (const t of transfers) {
      t.items = (await db.query(`SELECT ti.*, i.code as item_code, i.name as item_name FROM stock_transfer_items ti JOIN items i ON ti.item_id = i.id WHERE ti.transfer_id = $1`, [t.id])).rows;
    }
    return ok(req, res, transfers, 200, { total_count: transfers.length });
  });
  app.post("/api/inventory/transfers", authenticate, requirePermission(Permission12.INVENTORY_TRANSFER), async (req, res) => {
    const org = req.session.organization_id;
    const source_warehouse_id = uuid(req.body?.source_warehouse_id, "source_warehouse_id");
    const destination_warehouse_id = uuid(req.body?.destination_warehouse_id, "destination_warehouse_id");
    if (source_warehouse_id === destination_warehouse_id)
      throw validationError("Source and destination warehouses must differ", { field: "destination_warehouse_id" });
    await assertOrgRef(db, "warehouses", source_warehouse_id, org, "source_warehouse_id");
    await assertOrgRef(db, "warehouses", destination_warehouse_id, org, "destination_warehouse_id");
    const transfer_date = dateOnly(req.body?.transfer_date, "transfer_date", { defaultValue: todayIso() });
    const items = arrayOf(req.body?.items, "items", { min: 1, max: 500 }).map((it, i) => ({
      item_id: uuid(it?.item_id, `items[${i}].item_id`),
      requested_qty: decimal(it?.requested_qty, `items[${i}].requested_qty`, { sign: "positive" }),
      lot_id: optionalUuid(it?.lot_id, `items[${i}].lot_id`)
    }));
    for (const it of items)
      await assertOrgRef(db, "items", it.item_id, org, "item_id");
    const transfer = await db.transaction(async (tx) => {
      const num = optionalStr(req.body?.transfer_number, "transfer_number", 64) || await nextDocumentNumber(tx, org, "TRF", transfer_date);
      const t = (await tx.query(`INSERT INTO stock_transfers (transfer_number, source_warehouse_id, destination_warehouse_id, transfer_date, notes, status, organization_id)
           VALUES ($1, $2, $3, $4, $5, 'DRAFT', $6) RETURNING *`, [num, source_warehouse_id, destination_warehouse_id, transfer_date, optionalStr(req.body?.notes, "notes"), org])).rows[0];
      t.items = [];
      for (const it of items) {
        t.items.push((await tx.query(`INSERT INTO stock_transfer_items (transfer_id, item_id, requested_qty, shipped_qty, received_qty, lot_id) VALUES ($1, $2, $3, 0, 0, $4) RETURNING *`, [t.id, it.item_id, it.requested_qty, it.lot_id])).rows[0]);
      }
      await audit4(req, tx, "TRANSFER_CREATED", "STOCK_TRANSFER", t.id, void 0, { transfer_number: num, lines: items.length });
      return t;
    });
    return ok(req, res, transfer, 201);
  });
  app.post("/api/inventory/transfers/:id/ship", authenticate, requirePermission(Permission12.INVENTORY_TRANSFER), async (req, res) => {
    const org = req.session.organization_id;
    const out = await db.transaction(async (tx) => {
      const t = await transition(tx, {
        table: "stock_transfers",
        id: req.params.id,
        organizationId: org,
        from: ["DRAFT"],
        to: "IN_TRANSIT",
        label: "Transfer",
        set: { shipped_by: req.session.user_id, updated_at: (/* @__PURE__ */ new Date()).toISOString() }
      });
      const lines = (await tx.query(`SELECT * FROM stock_transfer_items WHERE transfer_id = $1`, [t.id])).rows;
      const itemRows = await lockItems(tx, org, lines.map((l) => l.item_id));
      for (const l of lines) {
        const mv = await postStockMovement(tx, {
          organizationId: org,
          legalEntityId: req.session.legal_entity_id,
          itemId: l.item_id,
          warehouseId: t.source_warehouse_id,
          movementType: "TRANSFER_OUT",
          movementDate: toIsoDate(t.transfer_date),
          quantity: new Money10(l.requested_qty).negated().toFixed(8),
          unitCost: itemRows.get(l.item_id).unit_cost,
          referenceType: "STOCK_TRANSFER",
          referenceId: t.id,
          description: `Transfer ${t.transfer_number} shipped`
        });
        await tx.query(`UPDATE stock_transfer_items SET unit_cost_out = $2 WHERE id = $1`, [l.id, mv.unit_cost]);
      }
      await tx.query(`UPDATE stock_transfer_items SET shipped_qty = requested_qty WHERE transfer_id = $1`, [t.id]);
      await audit4(req, tx, "TRANSFER_SHIPPED", "STOCK_TRANSFER", t.id, { status: "DRAFT" }, { status: "IN_TRANSIT" });
      return { id: t.id, status: "IN_TRANSIT" };
    });
    return ok(req, res, out);
  });
  app.post("/api/inventory/transfers/:id/receive", authenticate, requirePermission(Permission12.INVENTORY_TRANSFER), async (req, res) => {
    const org = req.session.organization_id;
    const out = await db.transaction(async (tx) => {
      const t = await transition(tx, {
        table: "stock_transfers",
        id: req.params.id,
        organizationId: org,
        from: ["IN_TRANSIT"],
        to: "COMPLETED",
        label: "Transfer",
        set: { received_by: req.session.user_id, updated_at: (/* @__PURE__ */ new Date()).toISOString() }
      });
      const lines = (await tx.query(`SELECT * FROM stock_transfer_items WHERE transfer_id = $1`, [t.id])).rows;
      const itemRows = await lockItems(tx, org, lines.map((l) => l.item_id));
      for (const l of lines) {
        await postStockMovement(tx, {
          organizationId: org,
          legalEntityId: req.session.legal_entity_id,
          itemId: l.item_id,
          warehouseId: t.destination_warehouse_id,
          movementType: "TRANSFER_IN",
          movementDate: toIsoDate(t.transfer_date),
          quantity: new Money10(l.shipped_qty).toFixed(8),
          unitCost: l.unit_cost_out ?? itemRows.get(l.item_id).unit_cost,
          referenceType: "STOCK_TRANSFER",
          referenceId: t.id,
          description: `Transfer ${t.transfer_number} received`
        });
      }
      await tx.query(`UPDATE stock_transfer_items SET received_qty = shipped_qty WHERE transfer_id = $1`, [t.id]);
      await audit4(req, tx, "TRANSFER_RECEIVED", "STOCK_TRANSFER", t.id, { status: "IN_TRANSIT" }, { status: "COMPLETED" });
      return { id: t.id, status: "COMPLETED" };
    });
    return ok(req, res, out);
  });
  app.get("/api/inventory/counts", authenticate, invRead, async (req, res) => {
    const counts = (await db.query(`SELECT c.*, w.name as warehouse_name FROM inventory_counts c JOIN warehouses w ON c.warehouse_id = w.id
         WHERE c.organization_id = $1 ORDER BY c.created_at DESC`, [req.session.organization_id])).rows;
    for (const c of counts) {
      c.items = (await db.query(`SELECT ci.*, i.code as item_code, i.name as item_name FROM inventory_count_items ci JOIN items i ON ci.item_id = i.id WHERE ci.count_id = $1`, [c.id])).rows;
    }
    return ok(req, res, counts, 200, { total_count: counts.length });
  });
  app.post("/api/inventory/counts", authenticate, requirePermission(Permission12.INVENTORY_COUNT), async (req, res) => {
    const org = req.session.organization_id;
    const warehouse_id = uuid(req.body?.warehouse_id, "warehouse_id");
    const period_id = str(req.body?.period_id, "period_id", { max: 64 });
    await assertOrgRef(db, "warehouses", warehouse_id, org, "warehouse_id");
    const period = await requireOrgRow(db, "fiscal_periods", period_id, org, "Fiscal period");
    const count_date = dateOnly(req.body?.count_date, "count_date", { defaultValue: todayIso() });
    if (count_date < toIsoDate(period.start_date) || count_date > toIsoDate(period.end_date)) {
      throw validationError("count_date must fall within the selected fiscal period", { field: "count_date" });
    }
    const count = await db.transaction(async (tx) => {
      const num = optionalStr(req.body?.count_number, "count_number", 64) || await nextDocumentNumber(tx, org, "CNT", count_date);
      const c = (await tx.query(`INSERT INTO inventory_counts (count_number, warehouse_id, period_id, count_date, status, organization_id)
           VALUES ($1, $2, $3, $4, 'PLANNED', $5) RETURNING *`, [num, warehouse_id, period_id, count_date, org])).rows[0];
      const items = (await tx.query(`SELECT id, unit_cost FROM items WHERE organization_id = $1 AND item_type = 'INVENTORY' ORDER BY code`, [org])).rows;
      c.items = [];
      for (const it of items) {
        const systemQty = await onHand(tx, org, it.id, warehouse_id);
        c.items.push((await tx.query(`INSERT INTO inventory_count_items (count_id, item_id, system_qty, counted_qty, variance_qty, unit_cost, variance_value)
               VALUES ($1, $2, $3, $3, 0, $4, 0) RETURNING *`, [c.id, it.id, systemQty, it.unit_cost])).rows[0]);
      }
      return c;
    });
    return ok(req, res, count, 201);
  });
  app.post("/api/inventory/counts/:id/record", authenticate, requirePermission(Permission12.INVENTORY_COUNT), async (req, res) => {
    const org = req.session.organization_id;
    const counts = arrayOf(req.body?.counts, "counts", { min: 1, max: 5e3 }).map((c, i) => ({
      item_id: uuid(c?.item_id, `counts[${i}].item_id`),
      counted_qty: decimal(c?.counted_qty, `counts[${i}].counted_qty`, { sign: "nonNegative" })
    }));
    const out = await db.transaction(async (tx) => {
      const count = await requireOrgRow(tx, "inventory_counts", req.params.id, org, "Count sheet", { forUpdate: true });
      if (!["PLANNED", "COUNTING", "RECONCILED"].includes(count.status)) {
        throw new ApiError(409, ErrorCode21.POSTED_FACT_IMMUTABLE, `Count is ${count.status} and can no longer be recorded`);
      }
      const existing = (await tx.query(`SELECT * FROM inventory_count_items WHERE count_id = $1`, [count.id])).rows;
      const known = new Set(existing.map((r) => r.item_id));
      for (const c of counts)
        if (!known.has(c.item_id))
          throw validationError(`Item ${c.item_id} is not on this count sheet`, { field: "counts" });
      const countMap = new Map(counts.map((c) => [c.item_id, c.counted_qty]));
      const result = InventoryReconciliationEngine.calculateVariances(existing.map((row) => ({
        item_id: row.item_id,
        system_qty: row.system_qty,
        counted_qty: countMap.get(row.item_id) ?? row.counted_qty,
        unit_cost: row.unit_cost
      })));
      for (const item of result.items) {
        await tx.query(`UPDATE inventory_count_items SET counted_qty = $1, variance_qty = $2, variance_value = $3 WHERE count_id = $4 AND item_id = $5`, [
          item.counted_qty,
          item.variance_qty,
          item.variance_value,
          count.id,
          item.item_id
        ]);
      }
      await tx.query(`UPDATE inventory_counts SET status = 'RECONCILED', total_variance_value = $1, recorded_by = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`, [result.total_variance_value, req.session.user_id, count.id]);
      await audit4(req, tx, "COUNT_RECORDED", "INVENTORY_COUNT", count.id, { status: count.status }, { status: "RECONCILED", total_variance_value: result.total_variance_value });
      return { id: count.id, status: "RECONCILED", total_variance_value: result.total_variance_value };
    });
    return ok(req, res, out);
  });
  app.post("/api/inventory/counts/:id/reconcile-and-post", authenticate, requirePermission(Permission12.INVENTORY_ADJUST), async (req, res) => {
    const org = req.session.organization_id;
    const out = await db.transaction(async (tx) => {
      const count = await requireOrgRow(tx, "inventory_counts", req.params.id, org, "Count sheet", { forUpdate: true });
      if (count.status === "POSTED")
        throw new ApiError(409, ErrorCode21.ALREADY_POSTED, "Count already posted to GL");
      if (count.status !== "RECONCILED")
        throw new ApiError(409, ErrorCode21.COUNT_NOT_RECONCILED, "Record the count before posting adjustments");
      if (count.recorded_by && count.recorded_by === req.session.user_id) {
        throw sodViolation("Segregation of duties: the count recorder cannot approve the stock adjustment");
      }
      const lines = (await tx.query(`SELECT * FROM inventory_count_items WHERE count_id = $1`, [count.id])).rows;
      const variances = lines.filter((l) => !new Money10(l.variance_qty).isZero());
      await lockItems(tx, org, variances.map((l) => l.item_id));
      const countDate = toIsoDate(count.count_date);
      let movedValue = new Money10(0);
      for (const l of variances) {
        const mv = await postStockMovement(tx, {
          organizationId: org,
          legalEntityId: req.session.legal_entity_id,
          itemId: l.item_id,
          warehouseId: count.warehouse_id,
          movementType: "COUNT_ADJUSTMENT",
          movementDate: countDate,
          quantity: new Money10(l.variance_qty).toFixed(8),
          unitCost: l.unit_cost,
          referenceType: "INVENTORY_COUNT",
          referenceId: count.id,
          description: `Cycle count ${count.count_number} variance`,
          allowNegative: false
        });
        movedValue = movedValue.add(mv.total_value);
      }
      let journalId = null;
      const varianceVal = movedValue.round(2);
      if (!varianceVal.eq(new Money10(count.total_variance_value).round(2))) {
        await tx.query(`UPDATE inventory_counts SET total_variance_value = $2 WHERE id = $1`, [count.id, varianceVal.toFixed(8)]);
        count.total_variance_value = varianceVal.toFixed(8);
      }
      if (!varianceVal.isZero()) {
        const inv = await tx.query(`SELECT id FROM accounts WHERE organization_id = $1 AND code = '113001'`, [org]);
        const adj = await tx.query(`SELECT id FROM accounts WHERE organization_id = $1 AND code = '511002'`, [org]);
        if (!inv.rows[0] || !adj.rows[0])
          throw new ApiError(400, ErrorCode21.MAPPING_MISSING, "Required GL accounts (113001 or 511002) not found in COA");
        const draft = InventoryReconciliationEngine.generateAdjustmentJournal({
          inventoryCount: count,
          organizationId: org,
          legalEntityId: req.session.legal_entity_id,
          inventoryAccountId: inv.rows[0].id,
          adjustmentExpenseAccountId: adj.rows[0].id,
          postingDate: countDate,
          documentDate: countDate
        });
        const posted = await postJournal(tx, auditLogger, outboxService, {
          organizationId: org,
          legalEntityId: req.session.legal_entity_id,
          userId: req.session.user_id,
          postingDate: countDate,
          purpose: AccountingPurpose6.INVENTORY_ADJUSTMENT,
          description: draft.description,
          sourceType: "INVENTORY_COUNT",
          sourceId: count.id,
          sourceKey: `INVENTORY_COUNT:${count.id}`,
          numberPrefix: "JV-ADJ",
          correlationId: req.correlationId,
          lines: draft.lines.map((l) => ({ account_id: l.account_id, debit: l.base_debit, credit: l.base_credit, description: l.description }))
        });
        journalId = posted?.journalId ?? null;
      }
      await transition(tx, {
        table: "inventory_counts",
        id: count.id,
        organizationId: org,
        from: ["RECONCILED"],
        to: "POSTED",
        label: "Count",
        set: { journal_id: journalId, posted_by: req.session.user_id, updated_at: (/* @__PURE__ */ new Date()).toISOString() }
      });
      await audit4(req, tx, "COUNT_POSTED", "INVENTORY_COUNT", count.id, { status: "RECONCILED" }, { status: "POSTED", journal_id: journalId });
      return { id: count.id, status: "POSTED", journal_id: journalId, total_variance_value: count.total_variance_value };
    });
    return ok(req, res, out);
  });
}

// apps/api/dist/routes/manufacturing.js
init_context();
init_http();
init_errors();
init_validate();
init_scope();
init_state();
init_posting();
init_numbering();
init_stock();
import { Money as Money11, ManufacturingEngine } from "@omnysync/financial-engine";
import { AccountingPurpose as AccountingPurpose7, ErrorCode as ErrorCode22, Permission as Permission13 } from "@omnysync/contracts";
var MFG_READ = [
  Permission13.BOM_MANAGE,
  Permission13.WORK_ORDER_MANAGE,
  Permission13.WORK_ORDER_RELEASE,
  Permission13.WORK_ORDER_CONSUME,
  Permission13.WORK_ORDER_COMPLETE,
  Permission13.INVENTORY_MANAGE,
  Permission13.FINANCE_REPORTS_VIEW
];
async function accountId(q, org, code) {
  const r = await q.query(`SELECT id FROM accounts WHERE organization_id = $1 AND code = $2`, [org, code]);
  if (!r.rows[0])
    throw new ApiError(400, ErrorCode22.MAPPING_MISSING, `Required GL account ${code} not found in COA`);
  return r.rows[0].id;
}
function registerManufacturingRoutes(app) {
  const mfgRead = requireAnyPermission(...MFG_READ);
  app.get("/api/manufacturing/boms", authenticate, mfgRead, async (req, res) => {
    const boms = (await db.query(`SELECT b.*, i.code as finished_item_code, i.name as finished_item_name FROM bill_of_materials b
         JOIN items i ON b.finished_item_id = i.id WHERE b.organization_id = $1 ORDER BY b.created_at DESC`, [req.session.organization_id])).rows;
    for (const b of boms) {
      b.items = (await db.query(`SELECT bi.*, i.code as component_code, i.name as component_name, i.uom as component_uom FROM bom_items bi
           JOIN items i ON bi.component_item_id = i.id WHERE bi.bom_id = $1`, [b.id])).rows;
    }
    return ok(req, res, boms, 200, { total_count: boms.length });
  });
  app.post("/api/manufacturing/boms", authenticate, requirePermission(Permission13.BOM_MANAGE), async (req, res) => {
    const org = req.session.organization_id;
    const finished_item_id = uuid(req.body?.finished_item_id, "finished_item_id");
    const name = str(req.body?.name, "name", { max: 255 });
    const version = optionalStr(req.body?.version, "version", 32) || "1.0";
    const yieldQty = decimal(req.body?.yield_quantity, "yield_quantity", { sign: "positive", required: false, defaultValue: "1" });
    await assertOrgRef(db, "items", finished_item_id, org, "finished_item_id");
    const items = arrayOf(req.body?.items, "items", { min: 1, max: 500 }).map((it, i) => {
      const scrap = decimal(it?.scrap_percentage, `items[${i}].scrap_percentage`, { required: false, defaultValue: "0" });
      if (new Money11(scrap).gt(100))
        throw validationError("scrap_percentage cannot exceed 100", { field: `items[${i}].scrap_percentage` });
      return {
        component_item_id: uuid(it?.component_item_id, `items[${i}].component_item_id`),
        quantity: decimal(it?.quantity, `items[${i}].quantity`, { sign: "positive" }),
        scrap_percentage: scrap,
        notes: optionalStr(it?.notes, "notes", 500)
      };
    });
    const seen = /* @__PURE__ */ new Set();
    for (const it of items) {
      if (it.component_item_id === finished_item_id)
        throw validationError("A BOM cannot consume its own finished item", { field: "items" });
      if (seen.has(it.component_item_id))
        throw validationError("Duplicate component in BOM", { field: "items" });
      seen.add(it.component_item_id);
      await assertOrgRef(db, "items", it.component_item_id, org, "component_item_id");
    }
    const bom = await db.transaction(async (tx) => {
      const num = optionalStr(req.body?.bom_number, "bom_number", 64) || await nextDocumentNumber(tx, org, "BOM", todayIso());
      const b = (await tx.query(`INSERT INTO bill_of_materials (bom_number, finished_item_id, name, version, yield_quantity, status, organization_id)
           VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6) RETURNING *`, [num, finished_item_id, name, version, yieldQty, org])).rows[0];
      b.items = [];
      for (const it of items) {
        b.items.push((await tx.query(`INSERT INTO bom_items (bom_id, component_item_id, quantity, scrap_percentage, notes) VALUES ($1, $2, $3, $4, $5) RETURNING *`, [
          b.id,
          it.component_item_id,
          it.quantity,
          it.scrap_percentage,
          it.notes
        ])).rows[0]);
      }
      return b;
    });
    return ok(req, res, bom, 201);
  });
  app.get("/api/manufacturing/work-orders", authenticate, mfgRead, async (req, res) => {
    const wos = (await db.query(`SELECT wo.*, b.name as bom_name, i.code as finished_item_code, i.name as finished_item_name, w.name as warehouse_name
         FROM work_orders wo JOIN bill_of_materials b ON wo.bom_id = b.id JOIN items i ON wo.finished_item_id = i.id
         JOIN warehouses w ON wo.warehouse_id = w.id WHERE wo.organization_id = $1 ORDER BY wo.created_at DESC`, [req.session.organization_id])).rows;
    for (const wo of wos) {
      wo.consumptions = (await db.query(`SELECT c.*, i.code as component_code, i.name as component_name FROM work_order_consumptions c
           JOIN items i ON c.component_item_id = i.id WHERE c.work_order_id = $1`, [wo.id])).rows;
    }
    return ok(req, res, wos, 200, { total_count: wos.length });
  });
  app.get("/api/manufacturing/work-orders/:id/requirements", authenticate, mfgRead, async (req, res) => {
    const wo = await requireOrgRow(db, "work_orders", req.params.id, req.session.organization_id, "Work order");
    const bom = await requireOrgRow(db, "bill_of_materials", wo.bom_id, req.session.organization_id, "BOM");
    const bomItems = (await db.query(`SELECT bi.*, i.unit_cost FROM bom_items bi JOIN items i ON i.id = bi.component_item_id WHERE bi.bom_id = $1`, [bom.id])).rows;
    const exploded = ManufacturingEngine.explodeBOM({ ...bom, items: bomItems }, wo.target_qty, Object.fromEntries(bomItems.map((b) => [b.component_item_id, b.unit_cost])));
    return ok(req, res, exploded);
  });
  app.post("/api/manufacturing/work-orders", authenticate, requirePermission(Permission13.WORK_ORDER_MANAGE), async (req, res) => {
    const org = req.session.organization_id;
    const bom_id = uuid(req.body?.bom_id, "bom_id");
    const warehouse_id = uuid(req.body?.warehouse_id, "warehouse_id");
    const target_qty = decimal(req.body?.target_qty, "target_qty", { sign: "positive" });
    const start_date = dateOnly(req.body?.start_date, "start_date", { defaultValue: todayIso() });
    const due_date = dateOnly(req.body?.due_date, "due_date", {
      required: false,
      defaultValue: new Date(Date.parse(`${start_date}T00:00:00Z`) + 7 * 864e5).toISOString().slice(0, 10)
    });
    if (due_date < start_date)
      throw validationError("due_date cannot be before start_date", { field: "due_date" });
    const bom = await requireOrgRow(db, "bill_of_materials", bom_id, org, "BOM");
    if (bom.status !== "ACTIVE")
      throw new ApiError(409, ErrorCode22.INVALID_STATE, "Only ACTIVE BOMs can be used for work orders");
    await assertOrgRef(db, "warehouses", warehouse_id, org, "warehouse_id");
    const wo = await db.transaction(async (tx) => {
      const num = optionalStr(req.body?.work_order_number, "work_order_number", 64) || await nextDocumentNumber(tx, org, "WO", start_date);
      const r = await tx.query(`INSERT INTO work_orders (work_order_number, bom_id, finished_item_id, warehouse_id, target_qty, status, start_date, due_date, organization_id)
         VALUES ($1, $2, $3, $4, $5, 'PLANNED', $6, $7, $8) RETURNING *`, [num, bom_id, bom.finished_item_id, warehouse_id, target_qty, start_date, due_date, org]);
      return r.rows[0];
    });
    return ok(req, res, wo, 201);
  });
  app.post("/api/manufacturing/work-orders/:id/release", authenticate, requirePermission(Permission13.WORK_ORDER_RELEASE), async (req, res) => {
    const wo = await transition(db, {
      table: "work_orders",
      id: req.params.id,
      organizationId: req.session.organization_id,
      from: ["PLANNED"],
      to: "RELEASED",
      label: "Work order",
      set: { updated_at: (/* @__PURE__ */ new Date()).toISOString() }
    });
    return ok(req, res, { id: wo.id, status: "RELEASED" });
  });
  app.post("/api/manufacturing/work-orders/:id/cancel", authenticate, requirePermission(Permission13.WORK_ORDER_MANAGE), async (req, res) => {
    const out = await db.transaction(async (tx) => {
      const wo = await requireOrgRow(tx, "work_orders", req.params.id, req.session.organization_id, "Work order", { forUpdate: true });
      const cons = await tx.query(`SELECT 1 FROM work_order_consumptions WHERE work_order_id = $1 LIMIT 1`, [wo.id]);
      if (cons.rows.length > 0)
        throw new ApiError(409, ErrorCode22.INVALID_STATE, "Work orders with material issues must be completed (or scrapped), not cancelled");
      await transition(tx, { table: "work_orders", id: wo.id, organizationId: req.session.organization_id, from: ["PLANNED", "RELEASED"], to: "CANCELLED", label: "Work order" });
      return { id: wo.id, status: "CANCELLED" };
    });
    return ok(req, res, out);
  });
  app.post("/api/manufacturing/work-orders/:id/consume", authenticate, requirePermission(Permission13.WORK_ORDER_CONSUME), async (req, res) => {
    const org = req.session.organization_id;
    const component_item_id = uuid(req.body?.component_item_id, "component_item_id");
    const consumed_qty = decimal(req.body?.consumed_qty, "consumed_qty", { sign: "positive" });
    const lot_id = optionalUuid(req.body?.lot_id, "lot_id");
    const posting_date = dateOnly(req.body?.posting_date, "posting_date", { defaultValue: todayIso() });
    const out = await db.transaction(async (tx) => {
      const wo = await requireOrgRow(tx, "work_orders", req.params.id, org, "Work order", { forUpdate: true });
      if (!["RELEASED", "IN_PROGRESS"].includes(wo.status)) {
        throw new ApiError(409, ErrorCode22.WORK_ORDER_NOT_RELEASED, `Materials can only be issued to RELEASED/IN_PROGRESS work orders (current: ${wo.status})`);
      }
      const inBom = await tx.query(`SELECT 1 FROM bom_items WHERE bom_id = $1 AND component_item_id = $2`, [wo.bom_id, component_item_id]);
      if (inBom.rows.length === 0)
        throw validationError("Component is not part of the work order BOM", { field: "component_item_id" });
      if (lot_id)
        await assertOrgRef(tx, "item_lots", lot_id, org, "lot_id");
      const items = await lockItems(tx, org, [component_item_id]);
      const item = items.get(component_item_id);
      const mv = await postStockMovement(tx, {
        organizationId: org,
        legalEntityId: req.session.legal_entity_id,
        itemId: component_item_id,
        warehouseId: wo.warehouse_id,
        movementType: "PRODUCTION_ISSUE",
        movementDate: posting_date,
        quantity: new Money11(consumed_qty).negated().toFixed(8),
        unitCost: new Money11(item.unit_cost || "0").toFixed(8),
        referenceType: "WORK_ORDER",
        referenceId: wo.id,
        description: `Material issue to ${wo.work_order_number}`
      });
      const unitCost = mv.unit_cost;
      const totalCost = new Money11(mv.total_value).abs().toFixed(8);
      const cons = (await tx.query(`INSERT INTO work_order_consumptions (work_order_id, component_item_id, consumed_qty, unit_cost, total_cost, lot_id)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`, [wo.id, component_item_id, consumed_qty, unitCost, totalCost, lot_id])).rows[0];
      const invAccount = item.inventory_account_id || await accountId(tx, org, "113001");
      await postJournal(tx, auditLogger, outboxService, {
        organizationId: org,
        legalEntityId: req.session.legal_entity_id,
        userId: req.session.user_id,
        postingDate: posting_date,
        purpose: AccountingPurpose7.MANUFACTURING_WIP_ISSUE,
        description: `Material issue to WIP: ${wo.work_order_number}`,
        sourceType: "WORK_ORDER_CONSUMPTION",
        sourceId: cons.id,
        sourceKey: `WO_CONSUMPTION:${cons.id}`,
        numberPrefix: "JV-MFI",
        correlationId: req.correlationId,
        lines: [
          { account_code: "113003", debit: new Money11(totalCost).toFixed(8), description: `WIP ${wo.work_order_number}` },
          { account_id: invAccount, credit: new Money11(totalCost).toFixed(8), description: `Component issue ${item.code}` }
        ]
      });
      const agg = await tx.query(`SELECT COALESCE(SUM(total_cost), 0)::text AS t FROM work_order_consumptions WHERE work_order_id = $1`, [wo.id]);
      await tx.query(`UPDATE work_orders SET status = 'IN_PROGRESS', total_material_cost = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [agg.rows[0].t, wo.id]);
      return cons;
    });
    return ok(req, res, out, 201);
  });
  app.post("/api/manufacturing/work-orders/:id/complete", authenticate, requirePermission(Permission13.WORK_ORDER_COMPLETE), async (req, res) => {
    const org = req.session.organization_id;
    const posting_date = dateOnly(req.body?.posting_date, "posting_date", { defaultValue: todayIso() });
    const out = await db.transaction(async (tx) => {
      const wo = await requireOrgRow(tx, "work_orders", req.params.id, org, "Work order", { forUpdate: true });
      if (wo.status === "COMPLETED" || wo.status === "CLOSED")
        throw new ApiError(409, ErrorCode22.WORK_ORDER_ALREADY_COMPLETED, "Work order already completed");
      if (wo.status !== "IN_PROGRESS")
        throw new ApiError(409, ErrorCode22.INVALID_STATE, `Work order must be IN_PROGRESS to complete (current: ${wo.status})`);
      const completed_qty = decimal(req.body?.completed_qty, "completed_qty", { sign: "nonNegative", required: false, defaultValue: wo.target_qty });
      const scrapped_qty = decimal(req.body?.scrapped_qty, "scrapped_qty", { sign: "nonNegative", required: false, defaultValue: "0" });
      if (new Money11(completed_qty).add(scrapped_qty).isZero())
        throw validationError("completed_qty + scrapped_qty must be greater than zero");
      const consumptions = (await tx.query(`SELECT * FROM work_order_consumptions WHERE work_order_id = $1`, [wo.id])).rows;
      if (consumptions.length === 0)
        throw new ApiError(400, ErrorCode22.INSUFFICIENT_RAW_MATERIALS, "No materials recorded as consumed for this work order");
      const woForCalc = { ...wo, completed_qty, scrapped_qty };
      const fgItem = (await lockItems(tx, org, [wo.finished_item_id])).get(wo.finished_item_id);
      const fgAccount = fgItem.inventory_account_id || await accountId(tx, org, "113004");
      const draft = ManufacturingEngine.generateCompletionJournal({
        workOrder: woForCalc,
        organizationId: org,
        legalEntityId: req.session.legal_entity_id,
        finishedGoodsAccountId: fgAccount,
        wipAccountId: await accountId(tx, org, "113003"),
        scrapExpenseAccountId: await accountId(tx, org, "511003"),
        postingDate: posting_date,
        documentDate: posting_date,
        consumptions
      });
      const costs = ManufacturingEngine.calculateWorkOrderCost(consumptions, completed_qty, scrapped_qty);
      const posted = await postJournal(tx, auditLogger, outboxService, {
        organizationId: org,
        legalEntityId: req.session.legal_entity_id,
        userId: req.session.user_id,
        postingDate: posting_date,
        purpose: AccountingPurpose7.MANUFACTURING_ASSEMBLY_RECEIPT,
        description: draft.description,
        sourceType: "WORK_ORDER",
        sourceId: wo.id,
        sourceKey: `WO_COMPLETION:${wo.id}`,
        numberPrefix: "JV-MFG",
        correlationId: req.correlationId,
        lines: draft.lines.map((l) => ({ account_id: l.account_id, debit: l.base_debit, credit: l.base_credit, description: l.description }))
      });
      if (new Money11(completed_qty).isPositive()) {
        await postStockMovement(tx, {
          organizationId: org,
          legalEntityId: req.session.legal_entity_id,
          itemId: wo.finished_item_id,
          warehouseId: wo.warehouse_id,
          movementType: "PRODUCTION_RECEIPT",
          movementDate: posting_date,
          quantity: new Money11(completed_qty).toFixed(8),
          unitCost: costs.finished_unit_cost,
          referenceType: "WORK_ORDER",
          referenceId: wo.id,
          description: `Finished goods receipt from ${wo.work_order_number}`
        });
      }
      await transition(tx, {
        table: "work_orders",
        id: wo.id,
        organizationId: org,
        from: ["IN_PROGRESS"],
        to: "COMPLETED",
        label: "Work order",
        set: { completed_qty, scrapped_qty, completion_journal_id: posted?.journalId ?? null, updated_at: (/* @__PURE__ */ new Date()).toISOString() }
      });
      await auditLogger.record({ organization_id: org, user_id: req.session.user_id, action: "WORK_ORDER_COMPLETED", entity_type: "WORK_ORDER", entity_id: wo.id, after_state: { completed_qty, scrapped_qty, ...costs }, correlation_id: req.correlationId }, tx);
      return { id: wo.id, status: "COMPLETED", completion_journal_id: posted?.journalId ?? null, completed_qty, finished_unit_cost: costs.finished_unit_cost };
    });
    return ok(req, res, out);
  });
}

// apps/api/dist/routes/projects.js
init_context();
init_errors();
init_state();
init_posting();
init_validate();
import crypto11 from "node:crypto";
import { Money as Money12, ProjectsEngine } from "@omnysync/financial-engine";
import { ErrorCode as ErrorCode23, Permission as Permission14, AccountingPurpose as AccountingPurpose8 } from "@omnysync/contracts";
function registerProjectsRoutes(app) {
  app.get("/api/projects/cost-centers", authenticate, requirePermission(Permission14.FINANCE_COA_VIEW), async (req, res) => {
    const result = await db.query("SELECT * FROM cost_centers WHERE organization_id = $1 ORDER BY code ASC", [req.session.organization_id]);
    return res.json({
      success: true,
      data: result.rows,
      meta: { correlation_id: req.correlationId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    });
  });
  app.post("/api/projects/cost-centers", authenticate, requirePermission(Permission14.PROJECT_MANAGE), async (req, res) => {
    const { code, name, cost_center_type, manager_name } = req.body;
    if (!code || !name) {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode23.VALIDATION_FAILED, message: "Code and name are required", correlation_id: req.correlationId }
      });
    }
    const id = crypto11.randomUUID();
    await db.query(`INSERT INTO cost_centers (id, code, name, cost_center_type, manager_name, organization_id)
       VALUES ($1, $2, $3, $4, $5, $6)`, [id, code, name, cost_center_type || "OPERATIONAL", manager_name || null, req.session.organization_id]);
    return res.status(201).json({
      success: true,
      data: { id, code, name, cost_center_type: cost_center_type || "OPERATIONAL", manager_name },
      meta: { correlation_id: req.correlationId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    });
  });
  app.get("/api/projects", authenticate, requirePermission(Permission14.FINANCE_REPORTS_VIEW), async (req, res) => {
    const result = await db.query(`SELECT p.*, c.name as customer_name, cc.name as cost_center_name 
       FROM projects p 
       LEFT JOIN parties c ON c.id = p.customer_id 
       LEFT JOIN cost_centers cc ON cc.id = p.cost_center_id 
       WHERE p.organization_id = $1 
       ORDER BY p.code ASC`, [req.session.organization_id]);
    return res.json({
      success: true,
      data: result.rows,
      meta: { correlation_id: req.correlationId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    });
  });
  app.post("/api/projects", authenticate, requirePermission(Permission14.PROJECT_MANAGE), async (req, res) => {
    const { code, name, customer_id, manager_name, project_type, contract_value, budgeted_cost, retention_percentage, start_date, end_date, cost_center_id } = req.body;
    if (!code || !name || !start_date) {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode23.VALIDATION_FAILED, message: "Code, name, and start_date are required", correlation_id: req.correlationId }
      });
    }
    const id = crypto11.randomUUID();
    await db.query(`INSERT INTO projects (
        id, code, name, customer_id, manager_name, project_type,
        contract_value, budgeted_cost, retention_percentage, status,
        start_date, end_date, cost_center_id, organization_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'APPROVED', $10, $11, $12, $13)`, [
      id,
      code,
      name,
      customer_id || null,
      manager_name || null,
      project_type || "CONSTRUCTION",
      new Money12(contract_value || "0").toFixed(8),
      new Money12(budgeted_cost || "0").toFixed(8),
      retention_percentage || 5,
      start_date,
      end_date || null,
      cost_center_id || null,
      req.session.organization_id
    ]);
    return res.status(201).json({
      success: true,
      data: { id, code, name, status: "APPROVED" },
      meta: { correlation_id: req.correlationId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    });
  });
  app.get("/api/projects/:id/wbs", authenticate, requirePermission(Permission14.PROJECT_MANAGE), async (req, res) => {
    const { id } = req.params;
    const result = await db.query("SELECT * FROM project_wbs_nodes WHERE project_id = $1 ORDER BY wbs_code ASC", [id]);
    return res.json({
      success: true,
      data: result.rows,
      meta: { correlation_id: req.correlationId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    });
  });
  app.post("/api/projects/:id/wbs", authenticate, requirePermission(Permission14.PROJECT_MANAGE), async (req, res) => {
    const { id } = req.params;
    const { wbs_code, name, parent_id, budget_cost, progress_percentage, status } = req.body;
    if (!wbs_code || !name) {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode23.VALIDATION_FAILED, message: "WBS code and name are required", correlation_id: req.correlationId }
      });
    }
    const nodeId = crypto11.randomUUID();
    await db.query(`INSERT INTO project_wbs_nodes (id, project_id, wbs_code, name, parent_id, budget_cost, progress_percentage, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [
      nodeId,
      id,
      wbs_code,
      name,
      parent_id || null,
      new Money12(budget_cost || "0").toFixed(8),
      progress_percentage || 0,
      status || "NOT_STARTED"
    ]);
    return res.status(201).json({
      success: true,
      data: { id: nodeId, project_id: id, wbs_code, name },
      meta: { correlation_id: req.correlationId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    });
  });
  app.get("/api/projects/:id/boq", authenticate, requirePermission(Permission14.BOQ_MANAGE), async (req, res) => {
    const { id } = req.params;
    const boqRes = await db.query(`SELECT b.*, p.code as project_code, p.name as project_name 
       FROM bill_of_quantities b
       JOIN projects p ON p.id = b.project_id
       WHERE b.project_id = $1 AND b.organization_id = $2
       ORDER BY b.created_at DESC`, [id, req.session.organization_id]);
    const boqs = [];
    for (const boq of boqRes.rows) {
      const itemsRes = await db.query(`SELECT bi.*, w.wbs_code 
         FROM boq_items bi 
         LEFT JOIN project_wbs_nodes w ON w.id = bi.wbs_node_id 
         WHERE bi.boq_id = $1 
         ORDER BY bi.item_code ASC`, [boq.id]);
      boqs.push({
        ...boq,
        items: itemsRes.rows
      });
    }
    return res.json({
      success: true,
      data: boqs,
      meta: { correlation_id: req.correlationId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    });
  });
  app.post("/api/projects/:id/boq", authenticate, requirePermission(Permission14.BOQ_MANAGE), async (req, res) => {
    const { id } = req.params;
    const { boq_number, title, version, items } = req.body;
    if (!boq_number || !title || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode23.VALIDATION_FAILED, message: "boq_number, title, and at least one item are required", correlation_id: req.correlationId }
      });
    }
    let totalAmount = Money12.zero();
    const calculatedItems = items.map((it) => {
      const qty = new Money12(it.contract_quantity || "0");
      const rate = new Money12(it.unit_rate || "0");
      const lineTotal = qty.mul(rate);
      totalAmount = totalAmount.add(lineTotal);
      return {
        ...it,
        contract_quantity: qty.toFixed(8),
        unit_rate: rate.toFixed(8),
        total_amount: lineTotal.toFixed(8)
      };
    });
    const boqId = crypto11.randomUUID();
    await db.transaction(async (tx) => {
      await tx.query(`INSERT INTO bill_of_quantities (id, project_id, boq_number, title, version, total_amount, status, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'APPROVED', $7)`, [boqId, id, boq_number, title, version || "1.0", totalAmount.toFixed(8), req.session.organization_id]);
      for (const item of calculatedItems) {
        await tx.query(`INSERT INTO boq_items (id, boq_id, wbs_node_id, item_code, description, uom, contract_quantity, unit_rate, total_amount, certified_quantity)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '0.00000000')`, [
          crypto11.randomUUID(),
          boqId,
          item.wbs_node_id || null,
          item.item_code,
          item.description,
          item.uom || "UNIT",
          item.contract_quantity,
          item.unit_rate,
          item.total_amount
        ]);
      }
    });
    return res.status(201).json({
      success: true,
      data: { id: boqId, boq_number, title, total_amount: totalAmount.toFixed(8), status: "APPROVED" },
      meta: { correlation_id: req.correlationId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    });
  });
  app.get("/api/projects/:id/certificates", authenticate, requirePermission(Permission14.PROGRESS_CERTIFY), async (req, res) => {
    const { id } = req.params;
    const certRes = await db.query(`SELECT pc.*, p.name as project_name 
       FROM progress_certificates pc 
       JOIN projects p ON p.id = pc.project_id 
       WHERE pc.project_id = $1 AND pc.organization_id = $2 
       ORDER BY pc.certificate_date DESC, pc.certificate_number DESC`, [id, req.session.organization_id]);
    const certs = [];
    for (const cert of certRes.rows) {
      const itemsRes = await db.query(`SELECT pci.*, bi.item_code, bi.description 
         FROM progress_certificate_items pci 
         JOIN boq_items bi ON bi.id = pci.boq_item_id 
         WHERE pci.certificate_id = $1`, [cert.id]);
      certs.push({
        ...cert,
        items: itemsRes.rows
      });
    }
    return res.json({
      success: true,
      data: certs,
      meta: { correlation_id: req.correlationId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    });
  });
  app.post("/api/projects/:id/certificates", authenticate, requirePermission(Permission14.PROGRESS_CERTIFY), async (req, res) => {
    const { id } = req.params;
    const { certificate_number, boq_id, period_id, certificate_date, items } = req.body;
    if (!certificate_number || !boq_id || !period_id || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode23.VALIDATION_FAILED, message: "certificate_number, boq_id, period_id, and items are required", correlation_id: req.correlationId }
      });
    }
    const prjRes = await db.query("SELECT * FROM projects WHERE id = $1 AND organization_id = $2", [id, req.session.organization_id]);
    if (prjRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: ErrorCode23.RESOURCE_NOT_FOUND, message: "Project not found", correlation_id: req.correlationId }
      });
    }
    const project = prjRes.rows[0];
    const boqOwner = await db.query("SELECT 1 FROM bill_of_quantities WHERE id = $1 AND project_id = $2", [boq_id, id]);
    if (boqOwner.rows.length === 0)
      throw validationError("BOQ does not belong to this project", { field: "boq_id" });
    const boqItemsRes = await db.query("SELECT * FROM boq_items WHERE boq_id = $1", [boq_id]);
    const boqItems = boqItemsRes.rows;
    const validation = ProjectsEngine.validateBoqQuantities(boqItems, items);
    if (!validation.valid) {
      return res.status(422).json({
        success: false,
        error: {
          code: ErrorCode23.OVER_CERTIFICATION,
          message: `Certification quantity exceeds contract quantity for item ${validation.exceededItemCode} by ${validation.exceededQty}`,
          correlation_id: req.correlationId
        }
      });
    }
    const itemsForCalc = items.map((it) => {
      const boqItem = boqItems.find((b) => b.id === it.boq_item_id);
      if (!boqItem) {
        throw new Error(`BOQ item ${it.boq_item_id} not found`);
      }
      return {
        boq_item_id: it.boq_item_id,
        previous_quantity: boqItem.certified_quantity || "0.00000000",
        current_quantity: new Money12(it.current_quantity || "0").toFixed(8),
        unit_rate: boqItem.unit_rate
      };
    });
    const calculated = ProjectsEngine.calculateProgressCertificate(itemsForCalc, project.retention_percentage.toString());
    const certId = crypto11.randomUUID();
    await db.transaction(async (tx) => {
      await tx.query(`INSERT INTO progress_certificates (
          id, certificate_number, project_id, boq_id, period_id,
          certificate_date, gross_certified_amount, retention_amount, net_certified_amount,
          status, organization_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'DRAFT', $10)`, [
        certId,
        certificate_number,
        id,
        boq_id,
        period_id,
        certificate_date || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
        calculated.gross_certified_amount,
        calculated.retention_amount,
        calculated.net_certified_amount,
        req.session.organization_id
      ]);
      for (const item of calculated.items) {
        await tx.query(`INSERT INTO progress_certificate_items (
            id, certificate_id, boq_item_id, previous_quantity, current_quantity, cumulative_quantity, unit_rate, current_amount
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [
          crypto11.randomUUID(),
          certId,
          item.boq_item_id,
          item.previous_quantity,
          item.current_quantity,
          item.cumulative_quantity,
          item.unit_rate,
          item.current_amount
        ]);
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
        status: "DRAFT"
      },
      meta: { correlation_id: req.correlationId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    });
  });
  app.post("/api/projects/:id/certificates/:certId/certify", authenticate, requirePermission(Permission14.PROGRESS_CERTIFY), async (req, res) => {
    const { id, certId } = req.params;
    const certRes = await db.query("SELECT * FROM progress_certificates WHERE id = $1 AND project_id = $2 AND organization_id = $3", [certId, id, req.session.organization_id]);
    if (certRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: ErrorCode23.RESOURCE_NOT_FOUND, message: "Progress certificate not found", correlation_id: req.correlationId }
      });
    }
    const cert = certRes.rows[0];
    if (cert.status !== "DRAFT") {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode23.VALIDATION_FAILED, message: `Certificate cannot be certified from status ${cert.status}`, correlation_id: req.correlationId }
      });
    }
    await db.transaction(async (tx) => {
      await transition(tx, { table: "progress_certificates", id: certId, organizationId: req.session.organization_id, from: ["DRAFT"], to: "CERTIFIED", label: "Progress certificate", set: { updated_at: (/* @__PURE__ */ new Date()).toISOString() } });
      const items = (await tx.query("SELECT * FROM progress_certificate_items WHERE certificate_id = $1 ORDER BY boq_item_id", [certId])).rows;
      for (const item of items) {
        const boq = (await tx.query("SELECT * FROM boq_items WHERE id = $1 FOR UPDATE", [item.boq_item_id])).rows[0];
        const cumulative = new Money12(boq.certified_quantity || "0").add(item.current_quantity);
        if (cumulative.gt(boq.contract_quantity)) {
          throw new ApiError(422, ErrorCode23.OVER_CERTIFICATION, `Certification for BOQ item ${boq.item_code} would exceed contract quantity (${new Money12(boq.contract_quantity).format(4)})`);
        }
        await tx.query("UPDATE boq_items SET certified_quantity = $1 WHERE id = $2", [cumulative.toFixed(8), boq.id]);
        await tx.query("UPDATE progress_certificate_items SET previous_quantity = $1, cumulative_quantity = $2 WHERE id = $3", [boq.certified_quantity || "0", cumulative.toFixed(8), item.id]);
      }
      await auditLogger.record({ organization_id: req.session.organization_id, user_id: req.session.user_id, action: "PROGRESS_CERTIFIED", entity_type: "PROGRESS_CERTIFICATE", entity_id: certId, correlation_id: req.correlationId }, tx);
    });
    return res.json({
      success: true,
      data: { id: certId, status: "CERTIFIED" },
      meta: { correlation_id: req.correlationId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    });
  });
  app.post("/api/projects/:id/certificates/:certId/generate-invoice", authenticate, requirePermission(Permission14.PROGRESS_INVOICE), async (req, res) => {
    const { id, certId } = req.params;
    const certRes = await db.query(`SELECT pc.*, p.code as project_code, p.cost_center_id 
       FROM progress_certificates pc 
       JOIN projects p ON p.id = pc.project_id 
       WHERE pc.id = $1 AND pc.project_id = $2 AND pc.organization_id = $3`, [certId, id, req.session.organization_id]);
    if (certRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: ErrorCode23.RESOURCE_NOT_FOUND, message: "Progress certificate not found", correlation_id: req.correlationId }
      });
    }
    const cert = certRes.rows[0];
    if (cert.status !== "CERTIFIED") {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode23.VALIDATION_FAILED, message: `Cannot generate invoice for certificate in status ${cert.status}. Must be CERTIFIED.`, correlation_id: req.correlationId }
      });
    }
    const accRes = await db.query(`SELECT id, code FROM accounts WHERE organization_id = $1 AND code IN ('112001', '112003', '411003')`, [req.session.organization_id]);
    const accountsMap = new Map(accRes.rows.map((r) => [r.code, r.id]));
    const arAccountId = accountsMap.get("112001");
    const retentionAccountId = accountsMap.get("112003");
    const revenueAccountId = accountsMap.get("411003");
    if (!arAccountId || !retentionAccountId || !revenueAccountId) {
      return res.status(422).json({
        success: false,
        error: {
          code: ErrorCode23.VALIDATION_FAILED,
          message: "Required accounts (112001, 112003, 411003) not found in COA",
          correlation_id: req.correlationId
        }
      });
    }
    const journalDraft = ProjectsEngine.generateProgressInvoiceJournal({
      organization_id: req.session.organization_id,
      legal_entity_id: req.session.legal_entity_id,
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
      user_id: req.session.user_id
    });
    const journalId = await db.transaction(async (tx) => {
      await transition(tx, { table: "progress_certificates", id: certId, organizationId: req.session.organization_id, from: ["CERTIFIED"], to: "INVOICED", label: "Progress certificate", set: { updated_at: (/* @__PURE__ */ new Date()).toISOString() } });
      const posted = await postJournal(tx, auditLogger, outboxService, {
        organizationId: req.session.organization_id,
        legalEntityId: req.session.legal_entity_id,
        userId: req.session.user_id,
        postingDate: toIsoDate(cert.certificate_date),
        purpose: AccountingPurpose8.PROJECT_PROGRESS_INVOICE,
        description: journalDraft.description,
        sourceType: "PROGRESS_CERTIFICATE",
        sourceId: certId,
        sourceKey: `PROGRESS_INVOICE:${certId}`,
        numberPrefix: "JV-IPC",
        correlationId: req.correlationId,
        lines: journalDraft.lines.map((l) => ({ account_id: l.account_id, debit: l.base_debit, credit: l.base_credit, description: l.description, cost_center_id: l.cost_center_id }))
      });
      await tx.query("UPDATE progress_certificates SET journal_id = $1 WHERE id = $2", [posted?.journalId ?? null, certId]);
      return posted?.journalId ?? null;
    });
    return res.json({
      success: true,
      data: {
        id: certId,
        status: "INVOICED",
        journal_id: journalId,
        gross_amount: cert.gross_certified_amount,
        retention_amount: cert.retention_amount,
        net_amount: cert.net_certified_amount
      },
      meta: { correlation_id: req.correlationId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    });
  });
}

// apps/api/dist/routes/assets.js
init_context();
init_http();
init_errors();
init_validate();
init_scope();
init_posting();
init_numbering();
import crypto12 from "node:crypto";
import { Money as Money13, FixedAssetsEngine } from "@omnysync/financial-engine";
import { AccountingPurpose as AccountingPurpose9, ErrorCode as ErrorCode24, Permission as Permission15 } from "@omnysync/contracts";
var METHODS = ["STRAIGHT_LINE", "DECLINING_BALANCE"];
async function leafOrNull(org, id, field) {
  if (!id)
    return null;
  const r = await db.query(`SELECT id FROM accounts WHERE id = $1 AND organization_id = $2 AND level = 4 AND is_active = true`, [id, org]);
  if (!r.rows[0])
    throw validationError(`${field} must be an active posting account`, { field });
  return id;
}
async function depreciateAsset(tx, ctx, assetId, periodId, periodMonths = 1) {
  const org = ctx.organizationId;
  const asset = (await tx.query(`SELECT fa.*, ac.deprec_expense_account_id, ac.accumulated_deprec_account_id FROM fixed_assets fa
       JOIN asset_categories ac ON ac.id = fa.category_id WHERE fa.id::text = $1 AND fa.organization_id = $2 FOR UPDATE OF fa`, [assetId, org])).rows[0];
  if (!asset)
    throw new ApiError(404, ErrorCode24.RESOURCE_NOT_FOUND, "Fixed asset not found");
  if (asset.status !== "ACTIVE")
    throw new ApiError(409, ErrorCode24.ASSET_NOT_ACTIVE, `Asset is ${asset.status}, not eligible for depreciation`);
  const period = await requireOrgRow(tx, "fiscal_periods", periodId, org, "Fiscal period");
  const periodEnd = toIsoDate(period.end_date);
  if (periodEnd < toIsoDate(asset.acquisition_date))
    throw validationError("Cannot depreciate for a period ending before the acquisition date", { field: "period_id" });
  const dup = await tx.query(`SELECT id FROM asset_depreciation_entries WHERE asset_id = $1 AND period_id = $2`, [asset.id, period.id]);
  if (dup.rows.length)
    throw new ApiError(409, ErrorCode24.ALREADY_POSTED, `Asset ${asset.asset_number} is already depreciated for ${period.period_name}`);
  const expenseAccountId = asset.deprec_expense_account_id || await accountByCode(tx, org, "521004");
  const accumulatedAccountId = asset.accumulated_deprec_account_id || await accountByCode(tx, org, "121002");
  const calc = FixedAssetsEngine.calculateDepreciation(asset.acquisition_cost, asset.accumulated_depreciation, asset.salvage_value, asset.useful_life_months, asset.depreciation_method, periodMonths);
  const bookValue = new Money13(asset.acquisition_cost).sub(asset.accumulated_depreciation);
  const headroom = bookValue.sub(asset.salvage_value);
  let amount = new Money13(calc.depreciation_amount).round(2);
  if (amount.gt(headroom))
    amount = headroom;
  if (!amount.isPositive())
    throw new ApiError(409, ErrorCode24.VALIDATION_FAILED, "Asset is already fully depreciated down to salvage value");
  const accumulatedAfter = new Money13(asset.accumulated_depreciation).add(amount);
  const bookAfter = new Money13(asset.acquisition_cost).sub(accumulatedAfter);
  const posted = await postJournal(tx, auditLogger, outboxService, {
    organizationId: org,
    legalEntityId: ctx.legalEntityId,
    userId: ctx.userId,
    postingDate: periodEnd,
    purpose: AccountingPurpose9.FIXED_ASSET_DEPRECIATION,
    description: `Depreciation ${asset.asset_number} ${asset.name} \u2014 ${period.period_name}`,
    sourceType: "FIXED_ASSET",
    sourceId: asset.id,
    sourceKey: `DEPRECIATION:${asset.id}:${period.id}`,
    numberPrefix: "JV-DEP",
    correlationId: ctx.correlationId,
    lines: [
      { account_id: expenseAccountId, debit: amount.toFixed(8), description: `Depreciation expense ${asset.asset_number}` },
      { account_id: accumulatedAccountId, credit: amount.toFixed(8), description: `Accumulated depreciation ${asset.asset_number}` }
    ]
  });
  await tx.query(`INSERT INTO asset_depreciation_entries (id, asset_id, period_id, entry_date, depreciation_amount, accumulated_depreciation_after, book_value_after, journal_id, organization_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [crypto12.randomUUID(), asset.id, period.id, periodEnd, amount.toFixed(8), accumulatedAfter.toFixed(8), bookAfter.toFixed(8), posted?.journalId ?? null, org]);
  const newStatus = bookAfter.lte(asset.salvage_value) ? "FULLY_DEPRECIATED" : "ACTIVE";
  await tx.query(`UPDATE fixed_assets SET accumulated_depreciation = $1, current_book_value = $2, status = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4`, [
    accumulatedAfter.toFixed(8),
    bookAfter.toFixed(8),
    newStatus,
    asset.id
  ]);
  return { id: asset.id, asset_number: asset.asset_number, depreciation_amount: amount.format(), accumulated_depreciation: accumulatedAfter.format(), current_book_value: bookAfter.format(), status: newStatus, journal_id: posted?.journalId ?? null };
}
function registerAssetsRoutes(app) {
  const assetRead = requireAnyPermission(Permission15.ASSET_MANAGE, Permission15.ASSET_DEPRECIATE, Permission15.ASSET_DISPOSE, Permission15.FINANCE_REPORTS_VIEW, Permission15.FINANCE_COA_VIEW);
  app.get("/api/assets/categories", authenticate, assetRead, async (req, res) => {
    const r = await db.query("SELECT * FROM asset_categories WHERE organization_id = $1 ORDER BY code ASC", [req.session.organization_id]);
    return ok(req, res, r.rows, 200, { total_count: r.rows.length });
  });
  app.post("/api/assets/categories", authenticate, requirePermission(Permission15.ASSET_MANAGE), async (req, res) => {
    const org = req.session.organization_id;
    const b = req.body || {};
    const code = str(b.code, "code", { max: 32 });
    const name = str(b.name, "name", { max: 255 });
    const method = oneOf(b.depreciation_method, "depreciation_method", METHODS, "STRAIGHT_LINE");
    const life = int(b.useful_life_months, "useful_life_months", { min: 1, max: 1200, defaultValue: 60 });
    const salvagePct = decimal(b.salvage_value_percentage == null ? void 0 : String(b.salvage_value_percentage), "salvage_value_percentage", { required: false, defaultValue: "0", scale: 4 });
    if (new Money13(salvagePct).gt(100))
      throw validationError("salvage_value_percentage cannot exceed 100", { field: "salvage_value_percentage" });
    const id = crypto12.randomUUID();
    await db.query(`INSERT INTO asset_categories (id, code, name, depreciation_method, useful_life_months, salvage_value_percentage, asset_cost_account_id, accumulated_deprec_account_id, deprec_expense_account_id, organization_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [
      id,
      code,
      name,
      method,
      life,
      salvagePct,
      await leafOrNull(org, optionalUuid(b.asset_cost_account_id, "asset_cost_account_id"), "asset_cost_account_id"),
      await leafOrNull(org, optionalUuid(b.accumulated_deprec_account_id, "accumulated_deprec_account_id"), "accumulated_deprec_account_id"),
      await leafOrNull(org, optionalUuid(b.deprec_expense_account_id, "deprec_expense_account_id"), "deprec_expense_account_id"),
      org
    ]);
    return ok(req, res, { id, code, name }, 201);
  });
  app.get("/api/assets", authenticate, assetRead, async (req, res) => {
    const r = await db.query(`SELECT fa.*, ac.name as category_name FROM fixed_assets fa JOIN asset_categories ac ON ac.id = fa.category_id
       WHERE fa.organization_id = $1 ORDER BY fa.asset_number ASC`, [req.session.organization_id]);
    return ok(req, res, r.rows, 200, { total_count: r.rows.length });
  });
  app.get("/api/assets/:id/schedule", authenticate, assetRead, async (req, res) => {
    const asset = await requireOrgRow(db, "fixed_assets", req.params.id, req.session.organization_id, "Fixed asset");
    const r = await db.query(`SELECT e.*, fp.period_name FROM asset_depreciation_entries e JOIN fiscal_periods fp ON fp.id = e.period_id WHERE e.asset_id = $1 ORDER BY e.entry_date`, [asset.id]);
    return ok(req, res, { asset, entries: r.rows });
  });
  app.post("/api/assets", authenticate, requirePermission(Permission15.ASSET_MANAGE), async (req, res) => {
    const org = req.session.organization_id;
    const b = req.body || {};
    const name = str(b.name, "name", { max: 255 });
    const category_id = uuid(b.category_id, "category_id");
    const category = await requireOrgRow(db, "asset_categories", category_id, org, "Asset category");
    const acquisition_date = dateOnly(b.acquisition_date, "acquisition_date", { defaultValue: todayIso() });
    const cost = decimal(b.acquisition_cost, "acquisition_cost", { sign: "positive", scale: 2 });
    const salvage = decimal(b.salvage_value, "salvage_value", {
      required: false,
      scale: 2,
      defaultValue: new Money13(cost).mul(category.salvage_value_percentage || "0").div(100).round(2).toFixed(2)
    });
    if (new Money13(salvage).gt(cost))
      throw validationError("salvage_value cannot exceed acquisition_cost", { field: "salvage_value" });
    const life = int(b.useful_life_months, "useful_life_months", { min: 1, max: 1200, defaultValue: Number(category.useful_life_months) || 60 });
    const method = oneOf(b.depreciation_method, "depreciation_method", METHODS, category.depreciation_method || "STRAIGHT_LINE");
    const postAcquisition = bool(b.post_acquisition, false);
    const fundingAccountId = optionalUuid(b.funding_account_id, "funding_account_id");
    const id = crypto12.randomUUID();
    const out = await db.transaction(async (tx) => {
      const asset_number = optionalStr(b.asset_number, "asset_number", 64) || await nextDocumentNumber(tx, org, "FA", acquisition_date);
      await tx.query(`INSERT INTO fixed_assets (id, asset_number, name, category_id, acquisition_date, acquisition_cost, salvage_value, useful_life_months, depreciation_method, status,
           location, custodian_name, serial_number, current_book_value, accumulated_depreciation, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ACTIVE', $10, $11, $12, $6, 0, $13)`, [id, asset_number, name, category_id, acquisition_date, cost, salvage, life, method, optionalStr(b.location, "location", 255), optionalStr(b.custodian_name, "custodian_name", 255), optionalStr(b.serial_number, "serial_number", 128), org]);
      let journalId = null;
      if (postAcquisition) {
        const costAcc = category.asset_cost_account_id || await accountByCode(tx, org, "121001");
        const funding = fundingAccountId ? await leafOrNull(org, fundingAccountId, "funding_account_id") : await accountByCode(tx, org, "211001");
        const posted = await postJournal(tx, auditLogger, outboxService, {
          organizationId: org,
          legalEntityId: req.session.legal_entity_id,
          userId: req.session.user_id,
          postingDate: acquisition_date,
          purpose: AccountingPurpose9.FIXED_ASSET_ACQUISITION,
          description: `Capitalisation of ${asset_number} ${name}`,
          sourceType: "FIXED_ASSET",
          sourceId: id,
          sourceKey: `ASSET_ACQUISITION:${id}`,
          numberPrefix: "JV-FA",
          correlationId: req.correlationId,
          lines: [
            { account_id: costAcc, debit: cost, description: `Asset cost ${asset_number}` },
            { account_id: funding, credit: cost, description: `Funding for ${asset_number}` }
          ]
        });
        journalId = posted?.journalId ?? null;
      }
      await auditLogger.record({ organization_id: org, user_id: req.session.user_id, action: "ASSET_REGISTERED", entity_type: "FIXED_ASSET", entity_id: id, after_state: { asset_number, cost, salvage, life, method, acquisition_journal_id: journalId }, correlation_id: req.correlationId }, tx);
      return { id, asset_number, name, acquisition_cost: cost, status: "ACTIVE", acquisition_journal_id: journalId };
    });
    return ok(req, res, out, 201);
  });
  app.post("/api/assets/:id/depreciate", authenticate, requirePermission(Permission15.ASSET_DEPRECIATE), async (req, res) => {
    const period_id = str(req.body?.period_id, "period_id", { max: 64 });
    const months = int(req.body?.period_months, "period_months", { min: 1, max: 12, defaultValue: 1 });
    const out = await db.transaction((tx) => depreciateAsset(tx, { organizationId: req.session.organization_id, legalEntityId: req.session.legal_entity_id, userId: req.session.user_id, correlationId: req.correlationId }, req.params.id, period_id, months));
    return ok(req, res, out);
  });
  app.post("/api/assets/depreciation-run", authenticate, requirePermission(Permission15.ASSET_DEPRECIATE), async (req, res) => {
    const period_id = str(req.body?.period_id, "period_id", { max: 64 });
    await requireOrgRow(db, "fiscal_periods", period_id, req.session.organization_id, "Fiscal period");
    const assets = (await db.query(`SELECT id FROM fixed_assets WHERE organization_id = $1 AND status = 'ACTIVE' ORDER BY asset_number`, [req.session.organization_id])).rows;
    const results = [];
    for (const a of assets) {
      try {
        results.push({ ...await db.transaction((tx) => depreciateAsset(tx, { organizationId: req.session.organization_id, legalEntityId: req.session.legal_entity_id, userId: req.session.user_id, correlationId: req.correlationId }, a.id, period_id)), outcome: "POSTED" });
      } catch (err) {
        results.push({ id: a.id, outcome: "SKIPPED", reason: err.message });
      }
    }
    return ok(req, res, results, 200, { posted: results.filter((r) => r.outcome === "POSTED").length, skipped: results.filter((r) => r.outcome === "SKIPPED").length });
  });
  app.post("/api/assets/:id/dispose", authenticate, requirePermission(Permission15.ASSET_DISPOSE), async (req, res) => {
    const org = req.session.organization_id;
    const proceeds = decimal(req.body?.proceeds, "proceeds", { required: false, defaultValue: "0", scale: 2 });
    const disposal_date = dateOnly(req.body?.disposal_date, "disposal_date", { defaultValue: todayIso() });
    const bankAccountId = optionalUuid(req.body?.bank_account_id, "bank_account_id");
    const out = await db.transaction(async (tx) => {
      const asset = (await tx.query(`SELECT fa.*, ac.asset_cost_account_id, ac.accumulated_deprec_account_id FROM fixed_assets fa JOIN asset_categories ac ON ac.id = fa.category_id
           WHERE fa.id::text = $1 AND fa.organization_id = $2 FOR UPDATE OF fa`, [req.params.id, org])).rows[0];
      if (!asset)
        throw new ApiError(404, ErrorCode24.RESOURCE_NOT_FOUND, "Fixed asset not found");
      if (asset.status === "DISPOSED" || asset.status === "WRITTEN_OFF")
        throw new ApiError(409, ErrorCode24.ASSET_ALREADY_DISPOSED, "Asset already disposed");
      if (disposal_date < toIsoDate(asset.acquisition_date))
        throw validationError("disposal_date cannot be before acquisition_date", { field: "disposal_date" });
      const draft = FixedAssetsEngine.generateDisposalJournal({
        organization_id: org,
        legal_entity_id: req.session.legal_entity_id,
        period_id: "",
        posting_date: disposal_date,
        asset_number: asset.asset_number,
        asset_name: asset.name,
        acquisition_cost: asset.acquisition_cost,
        accumulated_depreciation: asset.accumulated_depreciation,
        proceeds: new Money13(proceeds).toFixed(8),
        asset_cost_account_id: asset.asset_cost_account_id || await accountByCode(tx, org, "121001"),
        accumulated_deprec_account_id: asset.accumulated_deprec_account_id || await accountByCode(tx, org, "121002"),
        bank_account_id: bankAccountId ? await leafOrNull(org, bankAccountId, "bank_account_id") : await accountByCode(tx, org, "111002"),
        gain_account_id: await accountByCode(tx, org, "411005"),
        loss_account_id: await accountByCode(tx, org, "521007")
      });
      const posted = await postJournal(tx, auditLogger, outboxService, {
        organizationId: org,
        legalEntityId: req.session.legal_entity_id,
        userId: req.session.user_id,
        postingDate: disposal_date,
        purpose: AccountingPurpose9.FIXED_ASSET_DISPOSAL,
        description: draft.description,
        sourceType: "FIXED_ASSET",
        sourceId: asset.id,
        sourceKey: `ASSET_DISPOSAL:${asset.id}`,
        numberPrefix: "JV-DSP",
        correlationId: req.correlationId,
        lines: draft.lines.map((l) => ({ account_id: l.account_id, debit: l.base_debit, credit: l.base_credit, description: l.description }))
      });
      await tx.query(`UPDATE fixed_assets SET status = 'DISPOSED', disposal_date = $1, disposal_proceeds = $2, disposal_journal_id = $3, current_book_value = 0, updated_at = CURRENT_TIMESTAMP WHERE id = $4`, [disposal_date, proceeds, posted?.journalId ?? null, asset.id]);
      const nbv = new Money13(asset.acquisition_cost).sub(asset.accumulated_depreciation);
      await auditLogger.record({ organization_id: org, user_id: req.session.user_id, action: "ASSET_DISPOSED", entity_type: "FIXED_ASSET", entity_id: asset.id, before_state: { status: asset.status, book_value: nbv.format() }, after_state: { proceeds, gain_loss: new Money13(proceeds).sub(nbv).format() }, correlation_id: req.correlationId }, tx);
      return { id: asset.id, status: "DISPOSED", journal_id: posted?.journalId ?? null, gain_loss: new Money13(proceeds).sub(nbv).format() };
    });
    return ok(req, res, out);
  });
}

// apps/api/dist/routes/pos.js
init_context();
init_http();
init_errors();
init_validate();
init_scope();
init_state();
init_posting();
init_numbering();
init_stock();
import crypto14 from "node:crypto";
import { Money as Money15, parseScan, priceCart, settleTenders, computeLineRefund, allocateRefundToTenders, countDenominations, expectedDrawer, drawerVariance, pointsEarned, pointsForAmount, redemptionValue, DEFAULT_LOYALTY, DEFAULT_SCALE_CONFIG, TENDER_TYPES } from "@omnysync/financial-engine";
import { AccountingPurpose as AccountingPurpose10, ErrorCode as ErrorCode26, Permission as Permission17 } from "@omnysync/contracts";
import { AuthService as AuthService5 } from "@omnysync/platform";

// apps/api/dist/lib/pos-support.js
init_errors();
import crypto13 from "node:crypto";
import { AuthService as AuthService4 } from "@omnysync/platform";
import { Money as Money14 } from "@omnysync/financial-engine";
import { ErrorCode as ErrorCode25, Permission as Permission16 } from "@omnysync/contracts";
function isPosManager(req) {
  return AuthService4.hasPermission(req.session, Permission16.POS_REGISTER_MANAGE);
}
function engine(fn) {
  try {
    return fn();
  } catch (err) {
    if (err instanceof ApiError)
      throw err;
    const msg = String(err?.message || err);
    if (/Insufficient tender/.test(msg))
      throw new ApiError(422, ErrorCode25.INSUFFICIENT_PAYMENT_TENDER, msg);
    if (/Non-cash tenders cannot exceed/.test(msg))
      throw new ApiError(422, ErrorCode25.INSUFFICIENT_PAYMENT_TENDER, msg);
    if (/Refund exceeds|only .* remain returnable/.test(msg))
      throw new ApiError(422, ErrorCode25.RETURN_NOT_ALLOWED, msg);
    throw validationError(msg);
  }
}
var POS_ACTIONS = [
  "PRICE_OVERRIDE",
  "DISCOUNT",
  "VOID_LINE",
  "VOID_ORDER",
  "RETURN",
  "RETURN_NO_RECEIPT",
  "NO_SALE",
  "PAID_OUT",
  "CLOSE_VARIANCE",
  "NEGATIVE_STOCK"
];
async function posEvent(q, req, e) {
  await q.query(`INSERT INTO pos_audit_events (organization_id, register_id, session_id, user_id, event_type, reference_id, details)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`, [req.session.organization_id, e.registerId ?? null, e.sessionId ?? null, req.session.user_id, e.type, e.referenceId ?? null, e.details ? JSON.stringify(e.details) : null]);
}
async function requireApproval(q, req, action, sessionId, approvalId, consumedRef) {
  if (!approvalId && isPosManager(req))
    return req.session.user_id;
  if (!approvalId || typeof approvalId !== "string") {
    throw new ApiError(403, ErrorCode25.APPROVAL_REQUIRED, `Manager approval required: ${action}`, { action });
  }
  const r = await q.query(`UPDATE pos_approvals SET consumed_at = NOW(), consumed_ref = $5
     WHERE id::text = $1 AND organization_id = $2 AND session_id = $3 AND action = $4
       AND consumed_at IS NULL AND expires_at > NOW() AND requested_by = $6
     RETURNING approved_by`, [approvalId, req.session.organization_id, sessionId, action, consumedRef, req.session.user_id]);
  if (r.rows.length === 0) {
    throw new ApiError(403, ErrorCode25.APPROVAL_INVALID, `Approval is invalid, expired, already used or not for ${action}`, { action });
  }
  return r.rows[0].approved_by;
}
var MAX_PIN_FAILURES = 5;
var LOCK_MINUTES = 15;
async function verifyManagerPin(q, req, pin) {
  if (!/^\d{4,8}$/.test(pin))
    throw validationError("PIN must be 4-8 digits", { field: "pin" });
  const org = req.session.organization_id;
  const rows = await q.query(`SELECT mp.*, u.name, m.roles FROM pos_manager_pins mp
     JOIN users u ON u.id = mp.user_id AND u.is_active = true
     JOIN memberships m ON m.user_id = mp.user_id AND m.organization_id = mp.organization_id AND m.is_active = true
     WHERE mp.organization_id = $1
     ORDER BY mp.user_id
     FOR UPDATE OF mp`, [org]);
  let match = null;
  for (const row of rows.rows) {
    if (AuthService4.verifyPassword(pin, row.pin_hash)) {
      match = row;
      break;
    }
  }
  if (!match) {
    const fails = await q.query(`SELECT COUNT(*)::int AS n FROM pos_audit_events WHERE organization_id = $1 AND user_id = $2
       AND event_type = 'APPROVAL_PIN_FAILED' AND created_at > NOW() - ($3 || ' minutes')::interval`, [org, req.session.user_id, String(LOCK_MINUTES)]);
    if (fails.rows[0].n + 1 >= MAX_PIN_FAILURES) {
      throw new ApiError(423, ErrorCode25.PIN_LOCKED, `Too many invalid PIN attempts; approvals are locked for ${LOCK_MINUTES} minutes`);
    }
    throw new ApiError(403, ErrorCode25.APPROVAL_INVALID, "Invalid manager PIN");
  }
  if (match.locked_until && new Date(match.locked_until) > /* @__PURE__ */ new Date()) {
    throw new ApiError(423, ErrorCode25.PIN_LOCKED, "This manager PIN is temporarily locked");
  }
  const roles = typeof match.roles === "string" ? JSON.parse(match.roles) : match.roles;
  const perms2 = AuthService4.resolvePermissions(roles);
  if (!perms2.includes(Permission16.POS_REGISTER_MANAGE))
    throw new ApiError(403, ErrorCode25.APPROVAL_INVALID, "PIN holder is not a POS manager");
  if (match.user_id === req.session.user_id) {
    throw new ApiError(403, ErrorCode25.SEGREGATION_OF_DUTIES, "A cashier cannot approve their own override");
  }
  return { userId: match.user_id, name: match.name };
}
async function recentPinFailures(q, req) {
  const r = await q.query(`SELECT COUNT(*)::int AS n FROM pos_audit_events WHERE organization_id = $1 AND user_id = $2
     AND event_type = 'APPROVAL_PIN_FAILED' AND created_at > NOW() - ($3 || ' minutes')::interval`, [req.session.organization_id, req.session.user_id, String(LOCK_MINUTES)]);
  return r.rows[0].n;
}
async function activePromotions(q, organizationId, businessDate) {
  const r = await q.query(`SELECT * FROM pos_promotions WHERE organization_id = $1 AND is_active = true
       AND (starts_on IS NULL OR starts_on <= $2::date) AND (ends_on IS NULL OR ends_on >= $2::date)
     ORDER BY priority DESC, code ASC`, [organizationId, businessDate]);
  return r.rows.map((p) => {
    const rule = typeof p.rule === "string" ? JSON.parse(p.rule) : p.rule || {};
    return { ...rule, id: p.id, code: p.code, name: p.name, type: p.promo_type, priority: p.priority };
  });
}
function newCode(prefix) {
  return `${prefix}-${crypto13.randomBytes(5).toString("hex").toUpperCase()}`;
}
var W = 42;
var pad = (l, r) => {
  const space = Math.max(1, W - l.length - r.length);
  return l.slice(0, W - r.length - 1) + " ".repeat(space) + r;
};
var center = (s) => " ".repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s;
var esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function renderReceipt(order, lines, tenders, register, opts = {}) {
  const f = (v) => new Money14(String(v ?? "0")).format(2);
  const header = String(register?.receipt_header || "OMNYSYNC").split("\n");
  const footer = String(register?.receipt_footer || "Thank you!").split("\n");
  const text = [];
  header.forEach((h) => text.push(center(h)));
  if (opts.reprint)
    text.push(center("*** REPRINT ***"));
  if (order.status === "VOIDED")
    text.push(center("*** VOIDED ***"));
  text.push("-".repeat(W));
  text.push(pad(`Receipt ${order.order_number}`, String(order.business_date || "").slice(0, 10)));
  text.push(pad(`Register ${register?.register_code || ""}`, `Cashier ${order.cashier_name || ""}`.slice(0, 20)));
  if (order.customer_name)
    text.push(`Customer: ${order.customer_name}`);
  text.push("-".repeat(W));
  for (const l of lines) {
    text.push(String(l.item_name).slice(0, W));
    text.push(pad(`  ${new Money14(l.quantity).format(3).replace(/\.?0+$/, "")} x ${f(l.unit_price)}`, f(l.gross_amount || l.line_total)));
    if (new Money14(l.discount_amount || "0").isPositive())
      text.push(pad(`  Savings${l.applied_promotions?.length ? " (" + l.applied_promotions.join(",") + ")" : ""}`, `-${f(l.discount_amount)}`));
  }
  text.push("-".repeat(W));
  text.push(pad("Subtotal", f(order.subtotal)));
  if (new Money14(order.discount_amount || "0").isPositive())
    text.push(pad("You saved", `-${f(order.discount_amount)}`));
  text.push(pad("Tax", f(order.tax_amount)));
  if (!new Money14(order.cash_rounding || "0").isZero())
    text.push(pad("Cash rounding", f(order.cash_rounding)));
  text.push(pad("TOTAL", f(new Money14(order.total_amount).add(order.cash_rounding || "0"))));
  for (const t of tenders)
    text.push(pad(`  ${t.tender_type}${t.reference ? " " + String(t.reference).slice(-4) : ""}`, f(t.amount_tendered)));
  text.push(pad("Change", f(order.change_due)));
  if (order.loyalty_points_earned)
    text.push(`Points earned: ${order.loyalty_points_earned}`);
  text.push("-".repeat(W));
  footer.forEach((h) => text.push(center(h)));
  const row = (l, r, bold = false) => `<tr><td style="padding:2px 0;${bold ? "font-weight:600;" : ""}">${esc(l)}</td><td style="padding:2px 0;text-align:right;${bold ? "font-weight:600;" : ""}">${esc(r)}</td></tr>`;
  const html = `<!doctype html><html><body style="margin:0;background:#F7F8FC;font-family:Inter,Segoe UI,Arial,sans-serif;color:#182235;">
<table role="presentation" width="100%" style="max-width:420px;margin:24px auto;background:#FFFFFF;border:1px solid #D9DFEA;border-radius:10px;padding:24px;font-size:14px;">
<tr><td colspan="2" style="text-align:center;font-size:16px;font-weight:600;white-space:pre-line;">${esc(header.join("\n"))}</td></tr>
${opts.reprint ? '<tr><td colspan="2" style="text-align:center;color:#7A4700;">REPRINT</td></tr>' : ""}
${row(`Receipt ${order.order_number}`, String(order.business_date || "").slice(0, 10))}
${lines.map((l) => row(`${l.item_name} \xD7 ${new Money14(l.quantity).format(3).replace(/\.?0+$/, "")}`, f(l.net_amount || l.line_total))).join("\n")}
${row("Subtotal", f(order.subtotal))}
${row("You saved", f(order.discount_amount))}
${row("Tax", f(order.tax_amount))}
${row("Total", f(new Money14(order.total_amount).add(order.cash_rounding || "0")), true)}
${tenders.map((t) => row(t.tender_type, f(t.amount_tendered))).join("\n")}
${row("Change", f(order.change_due))}
<tr><td colspan="2" style="text-align:center;color:#46536B;padding-top:12px;white-space:pre-line;">${esc(footer.join("\n"))}</td></tr>
</table></body></html>`;
  return {
    text: text.join("\n"),
    html,
    email: { subject: `Your receipt ${order.order_number}`, html, text: text.join("\n") }
  };
}

// apps/api/dist/routes/pos.js
var TENDER_ACCOUNT = {
  CASH: "111004",
  CARD: "111005",
  WALLET: "111005",
  GIFT_CARD: "211007",
  STORE_CREDIT: "211007",
  LOYALTY: "211008"
};
var signed = (code, amount, description) => amount.isNegative() ? { account_code: code, credit: amount.abs().toFixed(8), description } : { account_code: code, debit: amount.toFixed(8), description };
var f2 = (v) => new Money15(String(v ?? "0")).toFixed(2);
async function audit5(req, tx, action, type, id, after, before) {
  await auditLogger.record({
    organization_id: req.session.organization_id,
    user_id: req.session.user_id,
    action,
    entity_type: type,
    entity_id: id,
    before_state: before,
    after_state: after,
    correlation_id: req.correlationId
  }, tx);
}
async function loadSession(q, req, id, opts = {}) {
  const s = await requireOrgRow(q, "pos_sessions", id, req.session.organization_id, "POS session", { forUpdate: opts.forUpdate });
  if (opts.mustBeOpen !== false && s.status !== "OPEN")
    throw new ApiError(409, ErrorCode26.POS_SESSION_CLOSED, "POS session is closed");
  if (s.cashier_id !== req.session.user_id && !isPosManager(req)) {
    throw new ApiError(403, ErrorCode26.UNAUTHORIZED, "This shift belongs to another cashier");
  }
  const reg = await requireOrgRow(q, "pos_registers", s.register_id, req.session.organization_id, "POS register");
  return { session: s, register: reg, businessDate: toIsoDate(s.business_date) || todayIso() };
}
async function stockWarehouse(q, org, register) {
  return register.warehouse_id || await defaultWarehouseId(q, org);
}
function drawerOf(s) {
  return expectedDrawer({
    opening_float: s.opening_float,
    cash_sales: s.cash_sales_total,
    cash_refunds: s.cash_refunds_total,
    paid_in: s.paid_in_total,
    paid_out: s.paid_out_total,
    safe_drops: s.safe_drop_total
  });
}
async function sessionTotals(q, sessionId) {
  const s = (await q.query(`SELECT * FROM pos_sessions WHERE id = $1`, [sessionId])).rows[0];
  const byTender = await q.query(`SELECT t.tender_type, COALESCE(SUM(t.applied_amount),0)::text AS amount, COUNT(*)::int AS n
     FROM pos_tenders t JOIN pos_orders o ON o.id = t.order_id
     WHERE o.session_id = $1 AND o.status <> 'VOIDED' GROUP BY t.tender_type ORDER BY t.tender_type`, [sessionId]);
  const orders = await q.query(`SELECT COUNT(*) FILTER (WHERE status <> 'VOIDED')::int AS sales_count,
            COUNT(*) FILTER (WHERE status = 'VOIDED')::int AS void_count,
            COALESCE(SUM(subtotal) FILTER (WHERE status <> 'VOIDED'),0)::text AS gross,
            COALESCE(SUM(discount_amount) FILTER (WHERE status <> 'VOIDED'),0)::text AS discounts,
            COALESCE(SUM(tax_amount) FILTER (WHERE status <> 'VOIDED'),0)::text AS tax,
            COALESCE(SUM(total_amount + cash_rounding) FILTER (WHERE status <> 'VOIDED'),0)::text AS total
     FROM pos_orders WHERE session_id = $1`, [sessionId]);
  const returns = await q.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(total_amount),0)::text AS total FROM pos_returns WHERE session_id = $1`, [sessionId]);
  const events = await q.query(`SELECT event_type, COUNT(*)::int AS n FROM pos_audit_events WHERE session_id = $1 GROUP BY event_type ORDER BY event_type`, [sessionId]);
  const o = orders.rows[0];
  return {
    session_id: sessionId,
    status: s.status,
    business_date: toIsoDate(s.business_date),
    cashier_name: s.cashier_name,
    opened_at: s.opened_at,
    closed_at: s.closed_at,
    sales_count: o.sales_count,
    void_count: o.void_count,
    gross_sales: f2(o.gross),
    discounts: f2(o.discounts),
    tax: f2(o.tax),
    net_sales_incl_tax: f2(o.total),
    returns_count: returns.rows[0].n,
    returns_total: f2(returns.rows[0].total),
    tenders: byTender.rows.map((r) => ({ type: r.tender_type, amount: f2(r.amount), count: r.n })),
    drawer: {
      opening_float: f2(s.opening_float),
      cash_sales: f2(s.cash_sales_total),
      cash_refunds: f2(s.cash_refunds_total),
      paid_in: f2(s.paid_in_total),
      paid_out: f2(s.paid_out_total),
      safe_drops: f2(s.safe_drop_total),
      expected_cash: drawerOf(s)
    },
    events: Object.fromEntries(events.rows.map((e) => [e.event_type, e.n]))
  };
}
var present = (v) => v !== void 0 && v !== null && v !== "";
function parseDiscount(v, field) {
  if (!v || !present(v.value))
    return null;
  const type = oneOf(v.type, `${field}.type`, ["PERCENT", "AMOUNT"], "AMOUNT");
  const value = decimal(v.value, `${field}.value`, { sign: "nonNegative" });
  if (type === "PERCENT" && new Money15(value).gt(100))
    throw validationError("Percent discount cannot exceed 100", { field });
  return { type, value };
}
function normalizeLines(body) {
  const raw = arrayOf(body.lines ?? body.items, "lines", { min: 1, max: 500 });
  return raw.map((l, i) => ({
    item_id: uuid(l.item_id, `lines[${i}].item_id`),
    quantity: decimal(l.quantity, `lines[${i}].quantity`, { sign: "positive", scale: 3 }),
    unit_price: present(l.unit_price) ? decimal(l.unit_price, `lines[${i}].unit_price`, { sign: "nonNegative" }) : null,
    override_price: present(l.override_price) ? decimal(l.override_price, `lines[${i}].override_price`, { sign: "nonNegative" }) : null,
    approval_id: optionalUuid(l.approval_id, `lines[${i}].approval_id`),
    line_discount: parseDiscount(l.line_discount, `lines[${i}].line_discount`),
    scanned_code: optionalStr(l.scanned_code, `lines[${i}].scanned_code`, 64),
    fixed_line_total: present(l.fixed_line_total) ? decimal(l.fixed_line_total, `lines[${i}].fixed_line_total`, { sign: "positive" }) : null
  }));
}
function normalizeTenders(body, grandTotal) {
  if (Array.isArray(body.tenders) && body.tenders.length > 0) {
    return body.tenders.slice(0, 10).map((t, i) => ({
      type: oneOf(t.type, `tenders[${i}].type`, TENDER_TYPES),
      amount: decimal(t.amount, `tenders[${i}].amount`, { sign: "positive" }),
      reference: optionalStr(t.reference, `tenders[${i}].reference`, 128)
    }));
  }
  const method = oneOf(body.payment_method, "payment_method", ["CASH", "CARD", "WALLET"], "CASH");
  if (new Money15(grandTotal).isZero())
    return [];
  if (method === "CASH") {
    const cash = present(body.cash_tendered) ? decimal(body.cash_tendered, "cash_tendered", { sign: "nonNegative" }) : grandTotal;
    if (new Money15(cash).isZero())
      throw new ApiError(422, ErrorCode26.INSUFFICIENT_PAYMENT_TENDER, "Cash tendered is less than order total");
    return [{ type: "CASH", amount: cash }];
  }
  return [{ type: method, amount: grandTotal, reference: optionalStr(body.card_reference, "card_reference", 128) }];
}
async function lockStoredValue(q, org, kind, code) {
  if (!code)
    throw validationError(`${kind} tender requires the card/credit code as reference`, { field: "reference" });
  const r = await q.query(`SELECT * FROM pos_stored_value_accounts WHERE organization_id = $1 AND kind = $2 AND code = $3 FOR UPDATE`, [org, kind, code.trim().toUpperCase()]);
  if (r.rows.length === 0 || !r.rows[0].is_active)
    throw notFound(kind === "GIFT_CARD" ? "Gift card" : "Store credit");
  return r.rows[0];
}
async function storedValueMove(q, req, account, amount, refType, refId) {
  const upd = await q.query(`UPDATE pos_stored_value_accounts SET balance = balance + $1 WHERE id = $2 AND balance + $1 >= 0 RETURNING balance`, [amount.toFixed(8), account.id]);
  if (upd.rows.length === 0)
    throw new ApiError(422, ErrorCode26.INSUFFICIENT_BALANCE, `Insufficient ${account.kind === "GIFT_CARD" ? "gift card" : "store credit"} balance`);
  await q.query(`INSERT INTO pos_stored_value_ledger (account_id, amount, reference_type, reference_id, created_by) VALUES ($1,$2,$3,$4,$5)`, [
    account.id,
    amount.toFixed(8),
    refType,
    refId,
    req.session.user_id
  ]);
  return f2(upd.rows[0].balance);
}
async function loyaltyMove(q, org, customerId, points, refType, refId) {
  if (points === 0)
    return;
  await q.query(`INSERT INTO pos_loyalty_accounts (organization_id, customer_id, points_balance, lifetime_points) VALUES ($1,$2,0,0) ON CONFLICT (organization_id, customer_id) DO NOTHING`, [org, customerId]);
  const upd = await q.query(`UPDATE pos_loyalty_accounts SET points_balance = points_balance + $1, lifetime_points = lifetime_points + GREATEST($1, 0)
     WHERE organization_id = $2 AND customer_id = $3 AND points_balance + $1 >= 0 RETURNING points_balance`, [points, org, customerId]);
  if (upd.rows.length === 0)
    throw new ApiError(422, ErrorCode26.INSUFFICIENT_BALANCE, "Insufficient loyalty points");
  await q.query(`INSERT INTO pos_loyalty_ledger (organization_id, customer_id, points, reference_type, reference_id) VALUES ($1,$2,$3,$4,$5)`, [org, customerId, points, refType, refId]);
}
async function loadOrderBundle(q, org, orderId) {
  const o = await q.query(`SELECT o.*, p.name AS customer_name, s.cashier_name FROM pos_orders o
     JOIN pos_sessions s ON s.id = o.session_id LEFT JOIN parties p ON p.id = o.customer_id
     WHERE o.id::text = $1 AND o.organization_id = $2`, [orderId, org]);
  if (o.rows.length === 0)
    throw notFound("POS order");
  const lines = await q.query(`SELECT * FROM pos_order_lines WHERE order_id = $1 ORDER BY line_number NULLS LAST, created_at`, [o.rows[0].id]);
  const tenders = await q.query(`SELECT * FROM pos_tenders WHERE order_id = $1 ORDER BY created_at, id`, [o.rows[0].id]);
  const register = (await q.query(`SELECT r.* FROM pos_registers r JOIN pos_sessions s ON s.register_id = r.id WHERE s.id = $1`, [o.rows[0].session_id])).rows[0];
  return { order: o.rows[0], lines: lines.rows, tenders: tenders.rows, register };
}
function registerPosRoutes(app) {
  const terminal = requirePermission(Permission17.POS_TERMINAL);
  const manage = requirePermission(Permission17.POS_REGISTER_MANAGE);
  const org = (req) => req.session.organization_id;
  app.get("/api/pos/registers", authenticate, terminal, async (req, res) => {
    let r = await db.query(`SELECT pr.*, w.name AS warehouse_name,
         (SELECT row_to_json(x) FROM (SELECT ps.id, ps.cashier_id, ps.cashier_name, ps.opened_at FROM pos_sessions ps
            WHERE ps.register_id = pr.id AND ps.status = 'OPEN' LIMIT 1) x) AS open_session
       FROM pos_registers pr LEFT JOIN warehouses w ON w.id = pr.warehouse_id
       WHERE pr.organization_id = $1 ORDER BY pr.register_code ASC`, [org(req)]);
    if (r.rows.length === 0) {
      const whRes = await db.query(`SELECT id FROM warehouses WHERE organization_id = $1 ORDER BY is_default DESC, created_at ASC LIMIT 1`, [org(req)]);
      const whId = whRes.rows[0]?.id || null;
      const regId = "72000000-0000-0000-0000-000000000001";
      await db.query(`INSERT INTO pos_registers (id, register_code, name, warehouse_id, is_active, organization_id, default_tax_rate, max_cashier_discount_percent, receipt_header, receipt_footer)
         VALUES ($1, 'POS-01', 'Main Counter Register 1', $2, true, $3, '18', '10', 'OMNYSYNC RETAIL MART
Main Counter Terminal', 'Thank you for shopping!
Exchange within 14 days with receipt.')
         ON CONFLICT (organization_id, register_code) DO NOTHING`, [regId, whId, org(req)]);
      r = await db.query(`SELECT pr.*, w.name AS warehouse_name,
           (SELECT row_to_json(x) FROM (SELECT ps.id, ps.cashier_id, ps.cashier_name, ps.opened_at FROM pos_sessions ps
              WHERE ps.register_id = pr.id AND ps.status = 'OPEN' LIMIT 1) x) AS open_session
         FROM pos_registers pr LEFT JOIN warehouses w ON w.id = pr.warehouse_id
         WHERE pr.organization_id = $1 ORDER BY pr.register_code ASC`, [org(req)]);
    }
    return ok(req, res, r.rows);
  });
  const registerFields = async (req, body) => {
    await assertOrgRef(db, "warehouses", body.warehouse_id, org(req), "warehouse_id");
    const pct = (v, field, dflt) => {
      const d = present(v) ? decimal(v, field, { sign: "nonNegative" }) : dflt;
      if (new Money15(d).gt(100))
        throw validationError(`${field} cannot exceed 100`, { field });
      return new Money15(d).toFixed(4);
    };
    return {
      warehouse_id: optionalUuid(body.warehouse_id, "warehouse_id"),
      default_tax_rate: pct(body.default_tax_rate, "default_tax_rate", "0"),
      allow_negative_stock: bool(body.allow_negative_stock, false),
      cash_rounding_increment: new Money15(present(body.cash_rounding_increment) ? decimal(body.cash_rounding_increment, "cash_rounding_increment", { sign: "nonNegative" }) : "0").toFixed(2),
      max_cashier_discount_percent: pct(body.max_cashier_discount_percent, "max_cashier_discount_percent", "10"),
      receipt_header: optionalStr(body.receipt_header, "receipt_header", 500),
      receipt_footer: optionalStr(body.receipt_footer, "receipt_footer", 500)
    };
  };
  app.post("/api/pos/registers", authenticate, manage, async (req, res) => {
    const register_code = str(req.body.register_code, "register_code", { max: 32 });
    const name = str(req.body.name, "name", { max: 255 });
    const f = await registerFields(req, req.body);
    await assertOrgRef(db, "accounts", req.body.cash_account_id, org(req), "cash_account_id");
    await assertOrgRef(db, "accounts", req.body.card_clearing_account_id, org(req), "card_clearing_account_id");
    const id = crypto14.randomUUID();
    await db.transaction(async (tx) => {
      await tx.query(`INSERT INTO pos_registers (id, register_code, name, warehouse_id, cash_account_id, card_clearing_account_id, organization_id,
           default_tax_rate, allow_negative_stock, cash_rounding_increment, max_cashier_discount_percent, receipt_header, receipt_footer)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [
        id,
        register_code,
        name,
        f.warehouse_id,
        req.body.cash_account_id || null,
        req.body.card_clearing_account_id || null,
        org(req),
        f.default_tax_rate,
        f.allow_negative_stock,
        f.cash_rounding_increment,
        f.max_cashier_discount_percent,
        f.receipt_header,
        f.receipt_footer
      ]);
      await audit5(req, tx, "POS_REGISTER_CREATED", "POS_REGISTER", id, { register_code, name, ...f });
    });
    return ok(req, res, { id, register_code, name, ...f }, 201);
  });
  app.post("/api/pos/registers/:id", authenticate, manage, async (req, res) => {
    const before = await requireOrgRow(db, "pos_registers", req.params.id, org(req), "POS register");
    const f = await registerFields(req, { ...before, ...req.body });
    const name = present(req.body.name) ? str(req.body.name, "name", { max: 255 }) : before.name;
    const is_active = req.body.is_active !== void 0 ? bool(req.body.is_active, true) : before.is_active;
    await db.transaction(async (tx) => {
      await tx.query(`UPDATE pos_registers SET name=$1, warehouse_id=$2, default_tax_rate=$3, allow_negative_stock=$4, cash_rounding_increment=$5,
           max_cashier_discount_percent=$6, receipt_header=$7, receipt_footer=$8, is_active=$9 WHERE id=$10`, [name, f.warehouse_id, f.default_tax_rate, f.allow_negative_stock, f.cash_rounding_increment, f.max_cashier_discount_percent, f.receipt_header, f.receipt_footer, is_active, before.id]);
      await audit5(req, tx, "POS_REGISTER_UPDATED", "POS_REGISTER", before.id, { name, is_active, ...f }, before);
    });
    return ok(req, res, { id: before.id, name, is_active, ...f });
  });
  app.get("/api/pos/catalog", authenticate, terminal, async (req, res) => {
    const register = req.query.register_id ? await requireOrgRow(db, "pos_registers", String(req.query.register_id), org(req), "POS register") : null;
    const wh = register ? await stockWarehouse(db, org(req), register) : await defaultWarehouseId(db, org(req));
    const items = await db.query(`SELECT i.id, i.code, i.name, i.item_type, i.uom, i.unit_price::text, i.tax_rate::text, i.barcode, i.plu_code, i.is_weighed, i.category,
         COALESCE((SELECT SUM(sm.quantity) FROM stock_movements sm WHERE sm.item_id = i.id AND sm.organization_id = i.organization_id
           AND (sm.location_id = $2 OR (sm.location_id IS NULL AND EXISTS (SELECT 1 FROM warehouses w WHERE w.id = $2 AND w.is_default)))), 0)::text AS on_hand
       FROM items i WHERE i.organization_id = $1 AND i.is_active = true AND i.item_type <> 'NON_INVENTORY'
       ORDER BY i.name ASC`, [org(req), wh]);
    const promotions = await activePromotions(db, org(req), todayIso());
    return ok(req, res, { items: items.rows, promotions, loyalty: DEFAULT_LOYALTY, scale_barcodes: DEFAULT_SCALE_CONFIG, register, generated_at: (/* @__PURE__ */ new Date()).toISOString() });
  });
  app.get("/api/pos/lookup", authenticate, terminal, async (req, res) => {
    const code = str(req.query.code, "code", { max: 64 }).trim();
    const parsed = parseScan(code);
    const sel = `SELECT id, code, name, item_type, uom, unit_price::text, tax_rate::text, barcode, plu_code, is_weighed, category FROM items WHERE organization_id = $1 AND is_active = true`;
    if (parsed.kind === "EMBEDDED_PRICE" || parsed.kind === "EMBEDDED_WEIGHT") {
      const r2 = await db.query(`${sel} AND plu_code = $2`, [org(req), parsed.plu]);
      if (r2.rows.length === 0)
        throw notFound(`Item for PLU ${parsed.plu}`);
      const item = r2.rows[0];
      if (parsed.kind === "EMBEDDED_WEIGHT")
        return ok(req, res, { item, quantity: parsed.quantity, scan: parsed });
      const qty = new Money15(item.unit_price).isPositive() ? new Money15(parsed.price).div(item.unit_price).round(3).toFixed(3) : "1.000";
      return ok(req, res, { item, quantity: qty, fixed_line_total: parsed.price, scan: parsed });
    }
    const r = await db.query(`${sel} AND (barcode = $2 OR upper(code) = upper($2) OR plu_code = $2) ORDER BY (barcode = $2) DESC LIMIT 1`, [org(req), code]);
    if (r.rows.length === 0)
      throw notFound(`Item for code ${code}`);
    return ok(req, res, { item: r.rows[0], quantity: "1", scan: parsed });
  });
  app.get("/api/pos/customers", authenticate, terminal, async (req, res) => {
    const q = String(req.query.q || "").trim().slice(0, 64);
    const r = await db.query(`SELECT p.id, p.code, p.name, p.phone, p.email, COALESCE(la.points_balance,0) AS points_balance, COALESCE(la.tier,'STANDARD') AS tier,
         COALESCE((SELECT SUM(balance) FROM pos_stored_value_accounts sv WHERE sv.customer_id = p.id AND sv.kind = 'STORE_CREDIT'),0)::text AS store_credit
       FROM parties p LEFT JOIN pos_loyalty_accounts la ON la.customer_id = p.id AND la.organization_id = p.organization_id
       WHERE p.organization_id = $1 AND p.party_type IN ('CUSTOMER','BOTH') AND p.is_active = true
         AND ($2 = '' OR p.name ILIKE '%' || $2 || '%' OR p.code ILIKE '%' || $2 || '%' OR p.phone ILIKE '%' || $2 || '%')
       ORDER BY p.name LIMIT 25`, [org(req), q]);
    return ok(req, res, r.rows);
  });
  app.post("/api/pos/customers", authenticate, terminal, async (req, res) => {
    const name = str(req.body.name, "name", { max: 255 });
    const phone = str(req.body.phone, "phone", { max: 32, pattern: /^[0-9+\-\s()]{7,32}$/ });
    const email = optionalStr(req.body.email, "email", 255);
    const dup = await db.query(`SELECT id FROM parties WHERE organization_id = $1 AND phone = $2`, [org(req), phone]);
    if (dup.rows.length > 0)
      throw new ApiError(409, ErrorCode26.DUPLICATE_RESOURCE, "A customer with this phone already exists", { id: dup.rows[0].id });
    const id = crypto14.randomUUID();
    await db.transaction(async (tx) => {
      const code = await nextDocumentNumber(tx, org(req), "CUST-POS", todayIso());
      await tx.query(`INSERT INTO parties (id, organization_id, legal_entity_id, code, name, party_type, phone, email, credit_limit) VALUES ($1,$2,$3,$4,$5,'CUSTOMER',$6,$7,0)`, [id, org(req), req.session.legal_entity_id, code, name, phone, email]);
      await tx.query(`INSERT INTO pos_loyalty_accounts (organization_id, customer_id) VALUES ($1,$2)`, [org(req), id]);
      await audit5(req, tx, "POS_CUSTOMER_CREATED", "PARTY", id, { code, name, phone });
    });
    return ok(req, res, { id, name, phone, points_balance: 0 }, 201);
  });
  app.get("/api/pos/promotions", authenticate, terminal, async (req, res) => {
    const r = await db.query(`SELECT * FROM pos_promotions WHERE organization_id = $1 ORDER BY is_active DESC, priority DESC, code`, [org(req)]);
    return ok(req, res, r.rows);
  });
  app.post("/api/pos/promotions", authenticate, manage, async (req, res) => {
    const code = str(req.body.code, "code", { max: 32, pattern: /^[A-Z0-9_-]+$/i }).toUpperCase();
    const name = str(req.body.name, "name", { max: 255 });
    const type = oneOf(req.body.promo_type, "promo_type", ["BOGO", "MIX_MATCH", "BUNDLE", "TIERED", "COUPON", "CART_PERCENT"]);
    const rule = req.body.rule && typeof req.body.rule === "object" && !Array.isArray(req.body.rule) ? req.body.rule : null;
    if (!rule)
      throw validationError("rule is required", { field: "rule" });
    engine(() => priceCart([{ line_id: "x", item_id: "dry-run", sku: "X", name: "x", quantity: "1", unit_price: "1", tax_rate: "0" }], { promotions: [{ ...rule, id: "dry", code, name, type }], couponCodes: [code] }));
    const starts_on = present(req.body.starts_on) ? dateOnly(req.body.starts_on, "starts_on") : null;
    const ends_on = present(req.body.ends_on) ? dateOnly(req.body.ends_on, "ends_on") : null;
    if (starts_on && ends_on && ends_on < starts_on)
      throw validationError("ends_on must be on or after starts_on", { field: "ends_on" });
    const id = crypto14.randomUUID();
    await db.transaction(async (tx) => {
      await tx.query(`INSERT INTO pos_promotions (id, organization_id, code, name, promo_type, rule, priority, starts_on, ends_on, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [id, org(req), code, name, type, JSON.stringify(rule), Number.parseInt(String(req.body.priority ?? 0), 10) || 0, starts_on, ends_on, req.session.user_id]);
      await audit5(req, tx, "POS_PROMOTION_CREATED", "POS_PROMOTION", id, { code, type, rule });
    });
    return ok(req, res, { id, code, name, promo_type: type }, 201);
  });
  app.post("/api/pos/promotions/:id/toggle", authenticate, manage, async (req, res) => {
    const p = await requireOrgRow(db, "pos_promotions", req.params.id, org(req), "Promotion");
    await db.transaction(async (tx) => {
      await tx.query(`UPDATE pos_promotions SET is_active = NOT is_active WHERE id = $1`, [p.id]);
      await audit5(req, tx, "POS_PROMOTION_TOGGLED", "POS_PROMOTION", p.id, { is_active: !p.is_active });
    });
    return ok(req, res, { id: p.id, is_active: !p.is_active });
  });
  app.post("/api/pos/manager-pin", authenticate, manage, async (req, res) => {
    const pin = str(req.body.pin, "pin", { max: 8, pattern: /^\d{4,8}$/ });
    const password = str(req.body.current_password, "current_password", { max: 200 });
    const u = await db.query(`SELECT password_hash FROM users WHERE id = $1`, [req.session.user_id]);
    if (!u.rows[0] || !AuthService5.verifyPassword(password, u.rows[0].password_hash))
      throw new ApiError(403, ErrorCode26.UNAUTHORIZED, "Current password is incorrect");
    if (/^(\d)\1+$/.test(pin) || "0123456789".includes(pin) || "9876543210".includes(pin))
      throw validationError("PIN is too easy to guess", { field: "pin" });
    const others = await db.query(`SELECT pin_hash FROM pos_manager_pins WHERE organization_id = $1 AND user_id <> $2`, [org(req), req.session.user_id]);
    if (others.rows.some((o) => AuthService5.verifyPassword(pin, o.pin_hash)))
      throw validationError("PIN already in use; choose another", { field: "pin" });
    await db.transaction(async (tx) => {
      await tx.query(`INSERT INTO pos_manager_pins (user_id, organization_id, pin_hash) VALUES ($1,$2,$3)
         ON CONFLICT (organization_id, user_id) DO UPDATE SET pin_hash = EXCLUDED.pin_hash, failed_attempts = 0, locked_until = NULL, updated_at = NOW()`, [req.session.user_id, org(req), AuthService5.hashPassword(pin)]);
      await audit5(req, tx, "POS_MANAGER_PIN_SET", "USER", req.session.user_id, { set: true });
    });
    return ok(req, res, { updated: true });
  });
  app.post("/api/pos/approvals", authenticate, terminal, async (req, res) => {
    const { session, register } = await loadSession(db, req, req.body.session_id);
    const action = oneOf(req.body.action, "action", POS_ACTIONS);
    const pin = str(req.body.pin, "pin", { max: 8 });
    if (await recentPinFailures(db, req) >= MAX_PIN_FAILURES) {
      throw new ApiError(423, ErrorCode26.PIN_LOCKED, `Too many invalid PIN attempts; approvals are locked for ${LOCK_MINUTES} minutes`);
    }
    let approver;
    try {
      approver = await verifyManagerPin(db, req, pin);
    } catch (err) {
      await posEvent(db, req, { registerId: register.id, sessionId: session.id, type: "APPROVAL_PIN_FAILED", details: { action } });
      throw err;
    }
    const id = crypto14.randomUUID();
    const context = req.body.context && typeof req.body.context === "object" ? req.body.context : null;
    await db.transaction(async (tx) => {
      await tx.query(`INSERT INTO pos_approvals (id, organization_id, session_id, action, requested_by, approved_by, context, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, NOW() + interval '5 minutes')`, [id, org(req), session.id, action, req.session.user_id, approver.userId, context ? JSON.stringify(context) : null]);
      await posEvent(tx, req, { registerId: register.id, sessionId: session.id, type: "APPROVAL_GRANTED", referenceId: id, details: { action, approved_by: approver.userId, context } });
    });
    return ok(req, res, { approval_id: id, action, approved_by: approver.userId, approver_name: approver.name, expires_in_seconds: 300 }, 201);
  });
  app.get("/api/pos/sessions/active", authenticate, terminal, async (req, res) => {
    const params = [org(req), req.session.user_id];
    let where = `ps.organization_id = $1 AND ps.status = 'OPEN'`;
    if (req.query.register_id) {
      params.push(String(req.query.register_id));
      where += ` AND ps.register_id::text = $3`;
    } else if (!isPosManager(req)) {
      where += ` AND ps.cashier_id = $2`;
    }
    const r = await db.query(`SELECT ps.*, pr.register_code, pr.name AS register_name FROM pos_sessions ps JOIN pos_registers pr ON pr.id = ps.register_id
       WHERE ${where} ORDER BY (ps.cashier_id = $2) DESC, ps.opened_at DESC LIMIT 1`, params);
    return ok(req, res, r.rows[0] || null);
  });
  app.post("/api/pos/sessions/open", authenticate, terminal, async (req, res) => {
    const register = await requireOrgRow(db, "pos_registers", req.body.register_id, org(req), "POS register");
    if (!register.is_active)
      throw invalidState("Register is inactive");
    let opening = present(req.body.opening_float) ? decimal(req.body.opening_float, "opening_float", { sign: "nonNegative" }) : "0.00";
    let count = null;
    if (Array.isArray(req.body.opening_count)) {
      count = req.body.opening_count;
      const counted = engine(() => countDenominations(count));
      if (present(req.body.opening_float) && !new Money15(counted).eq(opening))
        throw validationError("opening_float does not match the denomination count");
      opening = counted;
    }
    const businessDate = isPosManager(req) && present(req.body.business_date) ? dateOnly(req.body.business_date, "business_date") : todayIso();
    const id = crypto14.randomUUID();
    const floatStr = new Money15(opening).toFixed(8);
    try {
      await db.transaction(async (tx) => {
        await tx.query(`INSERT INTO pos_sessions (id, register_id, cashier_id, cashier_name, opened_at, opening_float, cash_sales_total, card_sales_total,
             expected_cash_drawer, cash_difference, status, organization_id, business_date, opening_count)
           VALUES ($1,$2,$3,$4,NOW(),$5,0,0,$5,0,'OPEN',$6,$7,$8)`, [id, register.id, req.session.user_id, req.session.name || req.session.email, floatStr, org(req), businessDate, count ? JSON.stringify(count) : null]);
        await posEvent(tx, req, { registerId: register.id, sessionId: id, type: "SHIFT_OPENED", details: { opening_float: floatStr, count } });
        await audit5(req, tx, "POS_SESSION_OPENED", "POS_SESSION", id, { register_id: register.id, opening_float: floatStr });
      });
    } catch (err) {
      if (err?.code === "23505")
        throw new ApiError(409, ErrorCode26.POS_SESSION_ALREADY_OPEN, "Register already has an active open session");
      throw err;
    }
    return ok(req, res, { id, register_id: register.id, opening_float: floatStr, status: "OPEN", business_date: businessDate }, 201);
  });
  app.get("/api/pos/sessions/:id/x-report", authenticate, terminal, async (req, res) => {
    const { session, register } = await loadSession(db, req, req.params.id, { mustBeOpen: false });
    const totals = await sessionTotals(db, session.id);
    return ok(req, res, { report_type: "X", register_code: register.register_code, generated_at: (/* @__PURE__ */ new Date()).toISOString(), ...totals });
  });
  app.get("/api/pos/sessions/:id/z-report", authenticate, terminal, async (req, res) => {
    const { session } = await loadSession(db, req, req.params.id, { mustBeOpen: false });
    if (!session.z_report)
      throw invalidState("The Z report is produced when the shift is closed");
    return ok(req, res, typeof session.z_report === "string" ? JSON.parse(session.z_report) : session.z_report);
  });
  app.get("/api/pos/sessions/:id/audit", authenticate, terminal, async (req, res) => {
    const { session } = await loadSession(db, req, req.params.id, { mustBeOpen: false });
    const r = await db.query(`SELECT e.*, u.name AS user_name FROM pos_audit_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.session_id = $1 ORDER BY e.created_at DESC, e.id LIMIT 500`, [session.id]);
    return ok(req, res, r.rows);
  });
  app.post("/api/pos/sessions/:id/cash-movements", authenticate, terminal, async (req, res) => {
    const type = oneOf(req.body.movement_type, "movement_type", ["PAID_IN", "PAID_OUT", "SAFE_DROP"]);
    const amount = decimal(req.body.amount, "amount", { sign: "positive" });
    const reason = str(req.body.reason, "reason", { max: 500 });
    const out = await db.transaction(async (tx) => {
      const { session, register, businessDate } = await loadSession(tx, req, req.params.id, { forUpdate: true });
      const id = crypto14.randomUUID();
      const approver = type === "PAID_OUT" ? await requireApproval(tx, req, "PAID_OUT", session.id, req.body.approval_id, id) : null;
      if (type !== "PAID_IN" && new Money15(amount).gt(drawerOf(session)))
        throw validationError(`Drawer only holds ${new Money15(drawerOf(session)).format()} expected cash`);
      const amt = new Money15(amount).toFixed(8);
      const desc = `${type} ${register.register_code}: ${reason}`;
      const [dr, cr] = type === "PAID_IN" ? ["111004", "111001"] : type === "SAFE_DROP" ? ["111001", "111004"] : ["521010", "111004"];
      const j = await postJournal(tx, auditLogger, outboxService, {
        organizationId: org(req),
        legalEntityId: req.session.legal_entity_id,
        userId: req.session.user_id,
        postingDate: businessDate,
        purpose: AccountingPurpose10.POS_CASH_MOVEMENT,
        description: desc,
        sourceType: "POS_CASH_MOVEMENT",
        sourceId: id,
        sourceKey: `POS_CASH_MOVEMENT:${id}`,
        numberPrefix: "JV-POS",
        approvedBy: approver,
        correlationId: req.correlationId,
        lines: [{ account_code: dr, debit: amt, description: desc }, { account_code: cr, credit: amt, description: desc }]
      });
      await tx.query(`INSERT INTO pos_cash_movements (id, organization_id, session_id, movement_type, amount, reason, approval_id, journal_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id, org(req), session.id, type, amt, reason, type === "PAID_OUT" && req.body.approval_id ? req.body.approval_id : null, j?.journalId || null, req.session.user_id]);
      const col = type === "PAID_IN" ? "paid_in_total" : type === "PAID_OUT" ? "paid_out_total" : "safe_drop_total";
      const sign = type === "PAID_IN" ? "+" : "-";
      await tx.query(`UPDATE pos_sessions SET ${col} = ${col} + $1, expected_cash_drawer = expected_cash_drawer ${sign} $1 WHERE id = $2`, [amt, session.id]);
      await posEvent(tx, req, { registerId: register.id, sessionId: session.id, type: `CASH_${type}`, referenceId: id, details: { amount, reason, approved_by: approver } });
      await posEvent(tx, req, { registerId: register.id, sessionId: session.id, type: "DRAWER_OPENED", referenceId: id, details: { reason: type } });
      return { id, movement_type: type, amount: f2(amt), journal_id: j?.journalId || null };
    });
    return ok(req, res, out, 201);
  });
  const CLIENT_EVENTS = ["LINE_VOIDED", "CART_VOIDED", "SCAN_NOT_FOUND", "PRICE_CHECK", "QTY_CHANGED"];
  app.post("/api/pos/sessions/:id/events", authenticate, terminal, async (req, res) => {
    const type = oneOf(req.body.event_type, "event_type", CLIENT_EVENTS);
    const raw = req.body.details && typeof req.body.details === "object" && !Array.isArray(req.body.details) ? req.body.details : {};
    const details = JSON.parse(JSON.stringify(raw, (_k, v) => typeof v === "string" ? v.slice(0, 200) : v));
    if (JSON.stringify(details).length > 2e3)
      throw validationError("details too large", { field: "details" });
    const { session, register } = await loadSession(db, req, req.params.id);
    await posEvent(db, req, { registerId: register.id, sessionId: session.id, type, details });
    return ok(req, res, { recorded: true, event_type: type }, 201);
  });
  app.post("/api/pos/sessions/:id/drawer-open", authenticate, terminal, async (req, res) => {
    const reason = str(req.body.reason, "reason", { max: 200 });
    const out = await db.transaction(async (tx) => {
      const { session, register } = await loadSession(tx, req, req.params.id);
      const ref = crypto14.randomUUID();
      const approver = await requireApproval(tx, req, "NO_SALE", session.id, req.body.approval_id, ref);
      await posEvent(tx, req, { registerId: register.id, sessionId: session.id, type: "NO_SALE", referenceId: ref, details: { reason, approved_by: approver } });
      await posEvent(tx, req, { registerId: register.id, sessionId: session.id, type: "DRAWER_OPENED", referenceId: ref, details: { reason: "NO_SALE" } });
      return { opened: true, reference: ref, approved_by: approver };
    });
    return ok(req, res, out);
  });
  app.post("/api/pos/sessions/:id/close", authenticate, requirePermission(Permission17.POS_SESSION_CLOSE), async (req, res) => {
    let counted = null;
    let count = null;
    if (Array.isArray(req.body.closing_count)) {
      count = req.body.closing_count;
      counted = engine(() => countDenominations(count));
    }
    if (present(req.body.actual_cash_drawer)) {
      const a = decimal(req.body.actual_cash_drawer, "actual_cash_drawer", { sign: "nonNegative" });
      if (counted !== null && !new Money15(counted).eq(a))
        throw validationError("actual_cash_drawer does not match the denomination count");
      counted = a;
    }
    if (counted === null)
      throw validationError("A blind cash count (actual_cash_drawer or closing_count) is required to close the shift", { field: "actual_cash_drawer" });
    const notes = optionalStr(req.body.variance_notes, "variance_notes", 1e3);
    const countedStr = counted;
    const out = await db.transaction(async (tx) => {
      const { session, register, businessDate } = await loadSession(tx, req, req.params.id, { forUpdate: true });
      const held = await tx.query(`SELECT COUNT(*)::int AS n FROM pos_held_carts WHERE session_id = $1 AND status = 'HELD'`, [session.id]);
      const expected = drawerOf(session);
      const v = drawerVariance(expected, countedStr);
      let approver = null;
      if (v.status !== "BALANCED") {
        if (!notes)
          throw validationError("A drawer variance requires variance_notes", { field: "variance_notes", variance: v.variance });
        const material = new Money15(v.variance).abs().gt(Money15.max(new Money15(expected).mul("0.01"), "500"));
        if (material)
          approver = await requireApproval(tx, req, "CLOSE_VARIANCE", session.id, req.body.approval_id, session.id);
      }
      const float = new Money15(session.opening_float);
      const j = await postJournal(tx, auditLogger, outboxService, {
        organizationId: org(req),
        legalEntityId: req.session.legal_entity_id,
        userId: req.session.user_id,
        postingDate: businessDate,
        purpose: AccountingPurpose10.POS_SESSION_CLOSE,
        description: `POS shift close ${register.register_code} (${businessDate})`,
        sourceType: "POS_SESSION",
        sourceId: session.id,
        sourceKey: `POS_SESSION_CLOSE:${session.id}`,
        numberPrefix: "JV-POS",
        approvedBy: approver,
        correlationId: req.correlationId,
        lines: [
          signed("111001", new Money15(countedStr).sub(float), `Shift ${register.register_code} cash banked to cash on hand`),
          signed("111004", new Money15(expected).sub(float).negated(), `Shift ${register.register_code} cash clearing settled`),
          signed("521008", new Money15(v.variance).negated(), `Shift ${register.register_code} cash ${v.status.toLowerCase()}`)
        ]
      });
      const z = await tx.query(`UPDATE pos_registers SET last_z_number = last_z_number + 1 WHERE id = $1 RETURNING last_z_number`, [register.id]);
      const zNumber = z.rows[0].last_z_number;
      await tx.query(`UPDATE pos_held_carts SET status = 'DISCARDED' WHERE session_id = $1 AND status = 'HELD'`, [session.id]);
      await transition(tx, {
        table: "pos_sessions",
        id: session.id,
        organizationId: org(req),
        from: ["OPEN"],
        to: "CLOSED",
        label: "POS session",
        set: {
          closed_at: (/* @__PURE__ */ new Date()).toISOString(),
          actual_cash_drawer: new Money15(countedStr).toFixed(8),
          cash_difference: new Money15(v.variance).toFixed(8),
          expected_cash_drawer: new Money15(expected).toFixed(8),
          closing_journal_id: j?.journalId || null,
          closing_count: count ? JSON.stringify(count) : null,
          z_number: zNumber,
          closed_by: req.session.user_id,
          variance_notes: notes
        }
      });
      const totals = await sessionTotals(tx, session.id);
      const zReport = {
        report_type: "Z",
        z_number: zNumber,
        register_code: register.register_code,
        ...totals,
        counted_cash: f2(countedStr),
        variance: v.variance,
        variance_status: v.status,
        held_carts_discarded: held.rows[0].n,
        closing_journal_id: j?.journalId || null
      };
      await tx.query(`UPDATE pos_sessions SET z_report = $1 WHERE id = $2`, [JSON.stringify(zReport), session.id]);
      await posEvent(tx, req, { registerId: register.id, sessionId: session.id, type: "SHIFT_CLOSED", details: { expected, counted: countedStr, variance: v.variance, z_number: zNumber, approved_by: approver } });
      await audit5(req, tx, "POS_SESSION_CLOSED", "POS_SESSION", session.id, { expected, counted: countedStr, variance: v.variance, z_number: zNumber });
      return {
        id: session.id,
        status: "CLOSED",
        expected_cash_drawer: expected,
        actual_cash_drawer: f2(countedStr),
        cash_difference: v.variance,
        variance_status: v.status,
        closing_journal_id: j?.journalId || null,
        z_number: zNumber,
        z_report: zReport
      };
    });
    return ok(req, res, out);
  });
  app.get("/api/pos/holds", authenticate, terminal, async (req, res) => {
    const params = [org(req)];
    let where = `h.organization_id = $1 AND h.status = 'HELD'`;
    if (req.query.register_id) {
      params.push(String(req.query.register_id));
      where += ` AND h.register_id::text = $2`;
    }
    const r = await db.query(`SELECT h.id, h.label, h.item_count::text, h.estimated_total::text, h.created_at, h.customer_id, u.name AS held_by_name, h.session_id
       FROM pos_held_carts h JOIN users u ON u.id = h.held_by WHERE ${where} ORDER BY h.created_at`, params);
    return ok(req, res, r.rows);
  });
  app.post("/api/pos/holds", authenticate, terminal, async (req, res) => {
    const cart = req.body.cart;
    if (!cart || typeof cart !== "object" || !Array.isArray(cart.lines) || cart.lines.length === 0)
      throw validationError("cart.lines is required", { field: "cart" });
    if (JSON.stringify(cart).length > 2e5)
      throw validationError("cart is too large");
    const label = optionalStr(req.body.label, "label", 128);
    const out = await db.transaction(async (tx) => {
      const { session, register } = await loadSession(tx, req, req.body.session_id);
      await assertOrgRef(tx, "parties", req.body.customer_id, org(req), "customer_id");
      const itemCount = cart.lines.reduce((s, l) => s.add(decimal(l.quantity, "cart.lines.quantity", { sign: "positive", scale: 3 })), Money15.zero());
      const estimated = present(req.body.estimated_total) ? decimal(req.body.estimated_total, "estimated_total", { sign: "nonNegative" }) : "0";
      const id = crypto14.randomUUID();
      const n = await tx.query(`SELECT COUNT(*)::int AS n FROM pos_held_carts WHERE session_id = $1`, [session.id]);
      const finalLabel = label || `Hold #${n.rows[0].n + 1}`;
      await tx.query(`INSERT INTO pos_held_carts (id, organization_id, session_id, register_id, label, customer_id, cart, item_count, estimated_total, held_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [id, org(req), session.id, register.id, finalLabel, req.body.customer_id || null, JSON.stringify(cart), itemCount.toFixed(8), estimated, req.session.user_id]);
      await posEvent(tx, req, { registerId: register.id, sessionId: session.id, type: "CART_HELD", referenceId: id, details: { label: finalLabel, lines: cart.lines.length } });
      return { id, label: finalLabel };
    });
    return ok(req, res, out, 201);
  });
  app.post("/api/pos/holds/:id/recall", authenticate, terminal, async (req, res) => {
    const out = await db.transaction(async (tx) => {
      const h = await requireOrgRow(tx, "pos_held_carts", req.params.id, org(req), "Held cart", { forUpdate: true });
      const { session, register } = await loadSession(tx, req, req.body.session_id || h.session_id);
      if (register.id !== h.register_id && !isPosManager(req))
        throw invalidState("Held carts can only be recalled on the register that parked them");
      const row = await transition(tx, {
        table: "pos_held_carts",
        id: h.id,
        organizationId: org(req),
        from: ["HELD"],
        to: "RECALLED",
        label: "Held cart",
        set: { recalled_by: req.session.user_id, recalled_at: (/* @__PURE__ */ new Date()).toISOString() }
      });
      await posEvent(tx, req, { registerId: register.id, sessionId: session.id, type: "CART_RECALLED", referenceId: h.id });
      return { id: h.id, label: row.label, customer_id: row.customer_id, cart: typeof row.cart === "string" ? JSON.parse(row.cart) : row.cart };
    });
    return ok(req, res, out);
  });
  app.post("/api/pos/holds/:id/discard", authenticate, terminal, async (req, res) => {
    const out = await db.transaction(async (tx) => {
      const h = await requireOrgRow(tx, "pos_held_carts", req.params.id, org(req), "Held cart", { forUpdate: true });
      await loadSession(tx, req, h.session_id, { mustBeOpen: false });
      await transition(tx, { table: "pos_held_carts", id: h.id, organizationId: org(req), from: ["HELD"], to: "DISCARDED", label: "Held cart" });
      await posEvent(tx, req, { registerId: h.register_id, sessionId: h.session_id, type: "CART_DISCARDED", referenceId: h.id });
      return { id: h.id, status: "DISCARDED" };
    });
    return ok(req, res, out);
  });
  app.post("/api/pos/price", authenticate, terminal, async (req, res) => {
    const lines = normalizeLines(req.body);
    const items = await db.query(`SELECT * FROM items WHERE organization_id = $1 AND id = ANY($2::uuid[])`, [org(req), [...new Set(lines.map((l) => l.item_id))]]);
    const byId = new Map(items.rows.map((i) => [i.id, i]));
    const cart = lines.map((l, i) => {
      const it = byId.get(l.item_id);
      if (!it)
        throw validationError(`Item ${l.item_id} not found`, { field: `lines[${i}].item_id` });
      return {
        line_id: String(i),
        item_id: it.id,
        sku: it.code,
        name: it.name,
        quantity: l.quantity,
        unit_price: f2(it.unit_price),
        override_price: l.override_price,
        tax_rate: new Money15(it.tax_rate || "0").toFixed(4),
        category: it.category,
        line_discount: l.line_discount,
        fixed_line_total: l.fixed_line_total
      };
    });
    const promotions = await activePromotions(db, org(req), todayIso());
    const coupons = Array.isArray(req.body.coupon_codes) ? req.body.coupon_codes.slice(0, 10).map((c) => String(c)) : [];
    const priced = engine(() => priceCart(cart, { promotions, couponCodes: coupons, cartDiscount: parseDiscount(req.body.cart_discount, "cart_discount") }));
    return ok(req, res, priced);
  });
  app.post("/api/pos/orders", authenticate, terminal, async (req, res) => {
    const lines = normalizeLines(req.body);
    const clientRef = optionalStr(req.body.client_ref, "client_ref", 64);
    const coupons = Array.isArray(req.body.coupon_codes) ? req.body.coupon_codes.slice(0, 10).map((c) => String(c).trim().toUpperCase()).filter(Boolean) : [];
    let cartDiscount = parseDiscount(req.body.cart_discount, "cart_discount");
    if (!cartDiscount && present(req.body.discount_amount)) {
      const d = decimal(req.body.discount_amount, "discount_amount", { sign: "nonNegative" });
      if (!new Money15(d).isZero())
        cartDiscount = { type: "AMOUNT", value: d };
    }
    const legacyTax = present(req.body.tax_percentage) ? decimal(req.body.tax_percentage, "tax_percentage", { sign: "nonNegative" }) : null;
    if (legacyTax && new Money15(legacyTax).gt(100))
      throw validationError("tax_percentage cannot exceed 100");
    const result = await db.transaction(async (tx) => {
      const { session, register, businessDate } = await loadSession(tx, req, req.body.session_id, { forUpdate: true });
      const orgId = org(req);
      if (clientRef) {
        const ex = await tx.query(`SELECT id FROM pos_orders WHERE organization_id = $1 AND client_ref = $2`, [orgId, clientRef]);
        if (ex.rows.length > 0)
          return { replayed: true, orderId: ex.rows[0].id };
      }
      if (req.body.customer_id)
        await assertOrgRef(tx, "parties", req.body.customer_id, orgId, "customer_id");
      const customerId = req.body.customer_id || null;
      const orderId = crypto14.randomUUID();
      if (legacyTax !== null && !isPosManager(req))
        throw new ApiError(403, ErrorCode26.APPROVAL_REQUIRED, "Tax rate overrides require a POS manager");
      const itemMap = await lockItems(tx, orgId, lines.map((l) => l.item_id));
      const approvals = {};
      const cart = [];
      for (const [i, l] of lines.entries()) {
        const it = itemMap.get(l.item_id);
        if (!it.is_active)
          throw validationError(`${it.name} is inactive`, { field: `lines[${i}].item_id` });
        if (it.item_type === "NON_INVENTORY")
          throw validationError(`${it.name} cannot be sold at POS`, { field: `lines[${i}].item_id` });
        if (!it.is_weighed && !l.fixed_line_total && !new Money15(l.quantity).eq(new Money15(l.quantity).floor(0))) {
          throw validationError(`${it.name} is sold in whole units`, { field: `lines[${i}].quantity` });
        }
        const listPrice = f2(it.unit_price);
        const override = l.override_price ?? (l.unit_price !== null && !new Money15(l.unit_price).eq(listPrice) ? l.unit_price : null);
        if (override !== null)
          approvals[`line${i + 1}`] = await requireApproval(tx, req, "PRICE_OVERRIDE", session.id, l.approval_id, orderId);
        if (l.fixed_line_total && override === null) {
          const expected = new Money15(l.quantity).mul(listPrice).round(2);
          if (new Money15(l.fixed_line_total).sub(expected).abs().gt(new Money15(listPrice).mul("0.001").add("0.01"))) {
            throw validationError(`Label price for ${it.name} does not match quantity x price`, { field: `lines[${i}].fixed_line_total` });
          }
        }
        cart.push({
          line_id: String(i),
          item_id: it.id,
          sku: it.code,
          name: it.name,
          quantity: l.quantity,
          unit_price: listPrice,
          override_price: override,
          tax_rate: legacyTax ?? new Money15(it.tax_rate || "0").toFixed(4),
          category: it.category,
          line_discount: l.line_discount,
          fixed_line_total: l.fixed_line_total
        });
      }
      const promotions = await activePromotions(tx, orgId, businessDate);
      const priced = engine(() => priceCart(cart, { promotions, couponCodes: coupons, cartDiscount }));
      if (priced.rejected_coupons.length > 0 && req.body.strict_coupons)
        throw validationError(`Coupon(s) not applicable: ${priced.rejected_coupons.join(", ")}`);
      const couponAmt = priced.applied_promotions.filter((p) => promotions.some((x) => x.id === p.id && (x.type === "COUPON" || x.type === "CART_PERCENT"))).reduce((s, p) => s.add(p.amount), Money15.zero());
      const manual = new Money15(priced.manual_discount_total).add(priced.cart_discount_total).sub(couponAmt);
      if (manual.isPositive()) {
        const base = new Money15(priced.subtotal).sub(priced.promo_discount_total);
        const pct = base.isZero() ? new Money15("100") : manual.div(base).mul(100);
        if (pct.gt(register.max_cashier_discount_percent)) {
          approvals.discount = await requireApproval(tx, req, "DISCOUNT", session.id, req.body.discount_approval_id, orderId);
        }
      }
      const tenders = normalizeTenders(req.body, priced.grand_total);
      const rounding = new Money15(register.cash_rounding_increment || "0").isPositive() ? f2(register.cash_rounding_increment) : void 0;
      const settled = engine(() => settleTenders(priced.grand_total, tenders, { cashRoundingIncrement: rounding }));
      const orderNumber = present(req.body.order_number) ? str(req.body.order_number, "order_number", { max: 64 }) : await nextDocumentNumber(tx, orgId, /^POS/i.test(register.register_code) ? register.register_code : `POS-${register.register_code}`, businessDate, 6);
      const tenderTotals = {};
      for (const t of settled.tenders)
        tenderTotals[t.type] = (tenderTotals[t.type] || Money15.zero()).add(t.applied_amount);
      const methods = Object.keys(tenderTotals);
      const paymentMethod = methods.length === 0 ? "CASH" : methods.length === 1 ? methods[0] : "SPLIT";
      const cashApplied = tenderTotals.CASH || Money15.zero();
      const loyaltyPaid = tenderTotals.LOYALTY || Money15.zero();
      if (loyaltyPaid.isPositive() && !customerId)
        throw validationError("Loyalty redemption requires a customer on the sale");
      const earned = customerId ? pointsEarned(Money15.max(new Money15(priced.net_total).sub(loyaltyPaid), "0").toFixed(2)) : 0;
      const cashTendered = settled.tenders.filter((t) => t.type === "CASH").reduce((s, t) => s.add(t.amount), Money15.zero());
      await tx.query(`INSERT INTO pos_orders (id, session_id, order_number, customer_id, subtotal, discount_amount, tax_amount, total_amount, payment_method,
           cash_tendered, change_due, status, organization_id, cashier_id, register_id, business_date, promo_discount, net_amount, cash_rounding,
           total_tendered, coupon_codes, applied_promotions, loyalty_points_earned, client_ref)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'COMPLETED',$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`, [
        orderId,
        session.id,
        orderNumber,
        customerId,
        priced.subtotal,
        priced.discount_total,
        priced.tax_total,
        priced.grand_total,
        paymentMethod,
        cashTendered.toFixed(8),
        settled.change_due,
        orgId,
        req.session.user_id,
        register.id,
        businessDate,
        priced.promo_discount_total,
        priced.net_total,
        settled.cash_rounding,
        settled.total_tendered,
        coupons.length ? coupons : null,
        JSON.stringify(priced.applied_promotions),
        earned,
        clientRef
      ]);
      const wh = await stockWarehouse(tx, orgId, register);
      const salesByAccount = /* @__PURE__ */ new Map();
      const cogsLines = [];
      for (const [i, pl] of priced.lines.entries()) {
        const it = itemMap.get(pl.item_id);
        const discount = new Money15(pl.promo_discount).add(pl.manual_discount).add(pl.cart_discount);
        const lineId = crypto14.randomUUID();
        await tx.query(`INSERT INTO pos_order_lines (id, order_id, item_id, item_code, item_name, quantity, unit_price, line_total, tax_amount, line_number, list_price,
             gross_amount, discount_amount, net_amount, tax_rate, unit_cost, applied_promotions, scanned_code, override_approval_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`, [
          lineId,
          orderId,
          it.id,
          it.code,
          it.name,
          pl.quantity,
          pl.effective_unit_price,
          pl.total_amount,
          pl.tax_amount,
          i + 1,
          it.unit_price,
          pl.gross_amount,
          discount.toFixed(8),
          pl.net_amount,
          pl.tax_rate,
          it.unit_cost,
          pl.applied_promotions.length ? pl.applied_promotions : null,
          lines[i].scanned_code,
          lines[i].approval_id
        ]);
        const key = it.sales_account_id ? `id:${it.sales_account_id}` : "code:411001";
        salesByAccount.set(key, (salesByAccount.get(key) || Money15.zero()).add(pl.gross_amount));
        if (it.item_type === "INVENTORY") {
          let allowNegative = !!register.allow_negative_stock;
          if (!allowNegative && req.body.negative_stock_approval_id) {
            const avail = await onHand(tx, orgId, it.id, wh);
            if (new Money15(avail).lt(pl.quantity)) {
              approvals[`stock${i + 1}`] = await requireApproval(tx, req, "NEGATIVE_STOCK", session.id, req.body.negative_stock_approval_id, orderId);
              allowNegative = true;
            }
          }
          const mv = await postStockMovement(tx, {
            organizationId: orgId,
            legalEntityId: req.session.legal_entity_id,
            itemId: it.id,
            warehouseId: wh,
            movementType: "POS_SALE",
            movementDate: businessDate,
            quantity: new Money15(pl.quantity).negated().toFixed(8),
            unitCost: it.unit_cost,
            referenceType: "POS_ORDER",
            referenceId: orderId,
            description: `POS sale ${orderNumber}`,
            allowNegative
          });
          if (!new Money15(mv.unit_cost).sub(it.unit_cost || "0").isZero())
            await tx.query(`UPDATE pos_order_lines SET unit_cost = $1 WHERE id = $2`, [mv.unit_cost, lineId]);
          const cost = new Money15(mv.total_value).abs().round(2);
          if (cost.isPositive()) {
            cogsLines.push(it.cogs_account_id ? { account_id: it.cogs_account_id, debit: cost.toFixed(8), description: `COGS ${it.code}` } : { account_code: "511001", debit: cost.toFixed(8), description: `COGS ${it.code}` });
            cogsLines.push(it.inventory_account_id ? { account_id: it.inventory_account_id, credit: cost.toFixed(8), description: `Inventory ${it.code}` } : { account_code: "113001", credit: cost.toFixed(8), description: `Inventory ${it.code}` });
          }
        }
      }
      for (const t of settled.tenders) {
        let reference = t.reference || null;
        if (t.type === "GIFT_CARD" || t.type === "STORE_CREDIT") {
          const acct = await lockStoredValue(tx, orgId, t.type, t.reference);
          reference = acct.code;
          await storedValueMove(tx, req, acct, new Money15(t.applied_amount).negated(), "POS_SALE", orderId);
        }
        if (t.type === "LOYALTY") {
          const pts = pointsForAmount(t.applied_amount);
          if (!new Money15(redemptionValue(pts)).eq(t.applied_amount))
            throw validationError("Loyalty tender must be a whole number of points");
          await loyaltyMove(tx, orgId, customerId, -pts, "POS_REDEEM", orderId);
          reference = `${pts} pts`;
        }
        await tx.query(`INSERT INTO pos_tenders (organization_id, order_id, tender_type, amount_tendered, applied_amount, reference) VALUES ($1,$2,$3,$4,$5,$6)`, [orgId, orderId, t.type, new Money15(t.amount).toFixed(8), new Money15(t.applied_amount).toFixed(8), reference]);
      }
      if (earned > 0)
        await loyaltyMove(tx, orgId, customerId, earned, "POS_EARN", orderId);
      const desc = `POS sale ${orderNumber}`;
      const jl = [];
      for (const [type, amt] of Object.entries(tenderTotals))
        jl.push({ account_code: TENDER_ACCOUNT[type], debit: amt.toFixed(8), description: `${desc} ${type}` });
      if (new Money15(priced.discount_total).isPositive())
        jl.push({ account_code: "411004", debit: new Money15(priced.discount_total).toFixed(8), description: `${desc} discounts & promotions` });
      for (const [key, amt] of salesByAccount) {
        jl.push(key.startsWith("code:") ? { account_code: key.slice(5), credit: amt.toFixed(8), description: desc } : { account_id: key.slice(3), credit: amt.toFixed(8), description: desc });
      }
      if (new Money15(priced.tax_total).isPositive())
        jl.push({ account_code: "212001", credit: new Money15(priced.tax_total).toFixed(8), description: `${desc} output tax` });
      if (!new Money15(settled.cash_rounding).isZero())
        jl.push(signed("911002", new Money15(settled.cash_rounding).negated(), `${desc} cash rounding`));
      if (earned > 0) {
        const v = new Money15(redemptionValue(earned)).toFixed(8);
        jl.push({ account_code: "411004", debit: v, description: `${desc} loyalty points deferred` });
        jl.push({ account_code: "211008", credit: v, description: `${desc} loyalty points liability` });
      }
      jl.push(...cogsLines);
      const j = await postJournal(tx, auditLogger, outboxService, {
        organizationId: orgId,
        legalEntityId: req.session.legal_entity_id,
        userId: req.session.user_id,
        postingDate: businessDate,
        purpose: AccountingPurpose10.POS_SALE,
        description: desc,
        sourceType: "POS_ORDER",
        sourceId: orderId,
        sourceKey: `POS_SALE:${orderId}`,
        numberPrefix: "JV-POS",
        lines: jl,
        correlationId: req.correlationId
      });
      await tx.query(`UPDATE pos_orders SET journal_id = $1 WHERE id = $2`, [j?.journalId || null, orderId]);
      const electronic = (tenderTotals.CARD || Money15.zero()).add(tenderTotals.WALLET || Money15.zero());
      await tx.query(`UPDATE pos_sessions SET cash_sales_total = cash_sales_total + $1, expected_cash_drawer = expected_cash_drawer + $1, card_sales_total = card_sales_total + $2 WHERE id = $3`, [cashApplied.toFixed(8), electronic.toFixed(8), session.id]);
      await posEvent(tx, req, {
        registerId: register.id,
        sessionId: session.id,
        type: "SALE",
        referenceId: orderId,
        details: { order_number: orderNumber, total: priced.grand_total, tenders: settled.tenders.map((t) => ({ type: t.type, amount: t.applied_amount })), approvals }
      });
      for (const [target, by] of Object.entries(approvals)) {
        const type = target === "discount" ? "DISCOUNT_APPROVED" : target.startsWith("stock") ? "NEGATIVE_STOCK_APPROVED" : "PRICE_OVERRIDE";
        await posEvent(tx, req, { registerId: register.id, sessionId: session.id, type, referenceId: orderId, details: { approved_by: by, target } });
      }
      if (cashApplied.isPositive())
        await posEvent(tx, req, { registerId: register.id, sessionId: session.id, type: "DRAWER_OPENED", referenceId: orderId, details: { reason: "SALE" } });
      await audit5(req, tx, "POS_SALE_COMPLETED", "POS_ORDER", orderId, { order_number: orderNumber, total: priced.grand_total, journal_id: j?.journalId, approvals });
      return { replayed: false, orderId };
    });
    const b = await loadOrderBundle(db, org(req), result.orderId);
    const o = b.order;
    return ok(req, res, {
      id: o.id,
      order_number: o.order_number,
      status: o.status,
      subtotal: f2(o.subtotal),
      promo_discount: f2(o.promo_discount),
      discount_amount: f2(o.discount_amount),
      net_amount: f2(o.net_amount),
      tax_amount: f2(o.tax_amount),
      total_amount: f2(o.total_amount),
      cash_rounding: f2(o.cash_rounding),
      amount_due: f2(new Money15(o.total_amount).add(o.cash_rounding)),
      total_tendered: f2(o.total_tendered),
      change_due: f2(o.change_due),
      payment_method: o.payment_method,
      customer_id: o.customer_id,
      loyalty_points_earned: o.loyalty_points_earned,
      applied_promotions: typeof o.applied_promotions === "string" ? JSON.parse(o.applied_promotions) : o.applied_promotions,
      journal_id: o.journal_id,
      lines: b.lines,
      tenders: b.tenders,
      receipt: renderReceipt(o, b.lines, b.tenders, b.register),
      replayed: result.replayed
    }, result.replayed ? 200 : 201);
  });
  app.get("/api/pos/orders", authenticate, terminal, async (req, res) => {
    const params = [org(req)];
    let where = "o.organization_id = $1";
    if (req.query.session_id) {
      params.push(String(req.query.session_id));
      where += ` AND o.session_id::text = $${params.length}`;
    }
    if (req.query.q) {
      params.push(`%${String(req.query.q).slice(0, 64)}%`);
      where += ` AND (o.order_number ILIKE $${params.length} OR p.name ILIKE $${params.length})`;
    }
    const r = await db.query(`SELECT o.id, o.order_number, o.status, o.total_amount::text, o.refunded_amount::text, o.payment_method, o.created_at, o.business_date,
         p.name AS customer_name, s.cashier_name
       FROM pos_orders o JOIN pos_sessions s ON s.id = o.session_id LEFT JOIN parties p ON p.id = o.customer_id
       WHERE ${where} ORDER BY o.created_at DESC LIMIT 50`, params);
    return ok(req, res, r.rows);
  });
  const resolveOrderId = async (req) => {
    const key = String(req.params.id);
    if (/^[0-9a-f-]{36}$/i.test(key))
      return key;
    const r = await db.query(`SELECT id FROM pos_orders WHERE organization_id = $1 AND order_number = $2`, [org(req), key.slice(0, 64)]);
    if (r.rows.length === 0)
      throw notFound("POS order");
    return r.rows[0].id;
  };
  app.get("/api/pos/orders/:id", authenticate, terminal, async (req, res) => {
    const b = await loadOrderBundle(db, org(req), await resolveOrderId(req));
    const returns = await db.query(`SELECT * FROM pos_returns WHERE original_order_id = $1 ORDER BY created_at`, [b.order.id]);
    return ok(req, res, { ...b.order, lines: b.lines, tenders: b.tenders, returns: returns.rows });
  });
  app.get("/api/pos/orders/:id/receipt", authenticate, terminal, async (req, res) => {
    const b = await loadOrderBundle(db, org(req), await resolveOrderId(req));
    return ok(req, res, renderReceipt(b.order, b.lines, b.tenders, b.register));
  });
  app.post("/api/pos/orders/:id/reprint", authenticate, terminal, async (req, res) => {
    const id = await resolveOrderId(req);
    const out = await db.transaction(async (tx) => {
      const b = await loadOrderBundle(tx, org(req), id);
      const upd = await tx.query(`UPDATE pos_orders SET reprint_count = reprint_count + 1 WHERE id = $1 RETURNING reprint_count`, [b.order.id]);
      await posEvent(tx, req, { registerId: b.register?.id, sessionId: b.order.session_id, type: "RECEIPT_REPRINT", referenceId: b.order.id, details: { count: upd.rows[0].reprint_count } });
      return { reprint_count: upd.rows[0].reprint_count, ...renderReceipt(b.order, b.lines, b.tenders, b.register, { reprint: true }) };
    });
    return ok(req, res, out);
  });
  app.post("/api/pos/orders/:id/void", authenticate, terminal, async (req, res) => {
    const reason = str(req.body.reason, "reason", { max: 500 });
    const id = await resolveOrderId(req);
    const out = await db.transaction(async (tx) => {
      const order = await requireOrgRow(tx, "pos_orders", id, org(req), "POS order", { forUpdate: true });
      const { session, register, businessDate } = await loadSession(tx, req, order.session_id, { forUpdate: true });
      if (order.status !== "COMPLETED" || !new Money15(order.refunded_amount).isZero()) {
        throw invalidState(`Order ${order.order_number} cannot be voided from ${order.status}; process a return instead`);
      }
      const approver = await requireApproval(tx, req, "VOID_ORDER", session.id, req.body.approval_id, order.id);
      const lines = (await tx.query(`SELECT ol.*, i.item_type FROM pos_order_lines ol JOIN items i ON i.id = ol.item_id WHERE ol.order_id = $1`, [order.id])).rows;
      const tenders = (await tx.query(`SELECT * FROM pos_tenders WHERE order_id = $1`, [order.id])).rows;
      const wh = await stockWarehouse(tx, org(req), register);
      await lockItems(tx, org(req), lines.map((l) => l.item_id));
      for (const l of lines) {
        if (l.item_type !== "INVENTORY")
          continue;
        await postStockMovement(tx, {
          organizationId: org(req),
          legalEntityId: req.session.legal_entity_id,
          itemId: l.item_id,
          warehouseId: wh,
          movementType: "POS_RETURN",
          movementDate: businessDate,
          quantity: new Money15(l.quantity).toFixed(8),
          unitCost: l.unit_cost,
          referenceType: "POS_VOID",
          referenceId: order.id,
          description: `Void ${order.order_number}`
        });
      }
      for (const t of tenders) {
        if (t.tender_type === "GIFT_CARD" || t.tender_type === "STORE_CREDIT") {
          const acct = await lockStoredValue(tx, org(req), t.tender_type, t.reference);
          await storedValueMove(tx, req, acct, new Money15(t.applied_amount), "POS_VOID", order.id);
        }
        if (t.tender_type === "LOYALTY")
          await loyaltyMove(tx, org(req), order.customer_id, pointsForAmount(t.applied_amount), "POS_VOID", order.id);
      }
      if (order.customer_id && order.loyalty_points_earned > 0) {
        const bal = await tx.query(`SELECT points_balance FROM pos_loyalty_accounts WHERE organization_id = $1 AND customer_id = $2`, [org(req), order.customer_id]);
        if ((bal.rows[0]?.points_balance ?? 0) < order.loyalty_points_earned)
          throw invalidState("Points earned on this sale were already redeemed; process a return instead");
        await loyaltyMove(tx, org(req), order.customer_id, -order.loyalty_points_earned, "POS_VOID", order.id);
      }
      let voidJournalId = null;
      if (order.journal_id) {
        const orig = await tx.query(`SELECT account_id, base_debit::text AS dr, base_credit::text AS cr, description FROM journal_lines WHERE journal_id = $1 ORDER BY line_number`, [order.journal_id]);
        const rev = await postJournal(tx, auditLogger, outboxService, {
          organizationId: org(req),
          legalEntityId: req.session.legal_entity_id,
          userId: req.session.user_id,
          postingDate: businessDate,
          purpose: AccountingPurpose10.POS_SALE,
          description: `Void ${order.order_number}: ${reason}`,
          sourceType: "POS_ORDER_VOID",
          sourceId: order.id,
          sourceKey: `POS_VOID:${order.id}`,
          numberPrefix: "JV-POS",
          reversalOfJournalId: order.journal_id,
          approvedBy: approver,
          correlationId: req.correlationId,
          lines: orig.rows.map((l) => new Money15(l.dr).isPositive() ? { account_id: l.account_id, credit: l.dr, description: `VOID ${l.description || ""}` } : { account_id: l.account_id, debit: l.cr, description: `VOID ${l.description || ""}` })
        });
        voidJournalId = rev?.journalId || null;
        if (voidJournalId)
          await tx.query(`UPDATE journals SET status = 'REVERSED', reversed_by_journal_id = $1 WHERE id = $2 AND status = 'POSTED'`, [voidJournalId, order.journal_id]);
      }
      const sum = (types) => tenders.filter((t) => types.includes(t.tender_type)).reduce((s, t) => s.add(t.applied_amount), Money15.zero());
      const cash = sum(["CASH"]);
      const elec = sum(["CARD", "WALLET"]);
      await tx.query(`UPDATE pos_sessions SET cash_sales_total = cash_sales_total - $1, expected_cash_drawer = expected_cash_drawer - $1, card_sales_total = card_sales_total - $2 WHERE id = $3`, [cash.toFixed(8), elec.toFixed(8), session.id]);
      await transition(tx, {
        table: "pos_orders",
        id: order.id,
        organizationId: org(req),
        from: ["COMPLETED"],
        to: "VOIDED",
        label: "POS order",
        set: { voided_by: req.session.user_id, voided_at: (/* @__PURE__ */ new Date()).toISOString(), void_reason: reason, void_journal_id: voidJournalId }
      });
      await posEvent(tx, req, { registerId: register.id, sessionId: session.id, type: "ORDER_VOIDED", referenceId: order.id, details: { reason, approved_by: approver, cash_returned: cash.toFixed(2) } });
      if (cash.isPositive())
        await posEvent(tx, req, { registerId: register.id, sessionId: session.id, type: "DRAWER_OPENED", referenceId: order.id, details: { reason: "VOID" } });
      await audit5(req, tx, "POS_ORDER_VOIDED", "POS_ORDER", order.id, { reason, void_journal_id: voidJournalId, approved_by: approver }, { status: order.status });
      return { id: order.id, status: "VOIDED", void_journal_id: voidJournalId, cash_to_return: cash.toFixed(2), electronic_to_reverse: elec.toFixed(2), approved_by: approver };
    });
    return ok(req, res, out);
  });
  app.post("/api/pos/returns", authenticate, terminal, async (req, res) => {
    const reason = str(req.body.reason, "reason", { max: 500 });
    const restock = bool(req.body.restock, true);
    const refundTo = oneOf(req.body.refund_to, "refund_to", ["ORIGINAL", "STORE_CREDIT", "CASH"], "ORIGINAL");
    const rawLines = arrayOf(req.body.lines, "lines", { min: 1, max: 200 });
    const out = await db.transaction(async (tx) => {
      const { session, register, businessDate } = await loadSession(tx, req, req.body.session_id, { forUpdate: true });
      const orgId = org(req);
      const returnId = crypto14.randomUUID();
      let original = null;
      if (present(req.body.original_order_id) || present(req.body.order_number)) {
        const r = await tx.query(`SELECT * FROM pos_orders WHERE organization_id = $1 AND (id::text = $2 OR order_number = $3) FOR UPDATE`, [
          orgId,
          String(req.body.original_order_id || ""),
          String(req.body.order_number || "")
        ]);
        if (r.rows.length === 0)
          throw notFound("Original POS order");
        original = r.rows[0];
        if (original.status === "VOIDED" || original.status === "REFUNDED")
          throw new ApiError(422, ErrorCode26.RETURN_NOT_ALLOWED, `Order ${original.order_number} is ${original.status}`);
      }
      const withReceipt = !!original;
      let approver = null;
      if (!withReceipt)
        approver = await requireApproval(tx, req, "RETURN_NO_RECEIPT", session.id, req.body.approval_id, returnId);
      else if (present(req.body.approval_id))
        approver = await requireApproval(tx, req, "RETURN", session.id, req.body.approval_id, returnId);
      if (!withReceipt && refundTo === "ORIGINAL")
        throw validationError("Returns without a receipt refund to STORE_CREDIT or CASH", { field: "refund_to" });
      const customerId = original?.customer_id || (present(req.body.customer_id) ? String(req.body.customer_id) : null);
      if (customerId && !original)
        await assertOrgRef(tx, "parties", customerId, orgId, "customer_id");
      const rls = [];
      if (withReceipt) {
        for (const [i, l] of rawLines.entries()) {
          const lid = uuid(l.original_line_id, `lines[${i}].original_line_id`);
          const q = decimal(l.quantity, `lines[${i}].quantity`, { sign: "positive", scale: 3 });
          const ol = (await tx.query(`SELECT ol.*, i.item_type FROM pos_order_lines ol JOIN items i ON i.id = ol.item_id WHERE ol.id::text = $1 AND ol.order_id = $2 FOR UPDATE OF ol`, [lid, original.id])).rows[0];
          if (!ol)
            throw validationError(`Line ${lid} is not on order ${original.order_number}`, { field: `lines[${i}].original_line_id` });
          const refund = engine(() => computeLineRefund({ line_id: ol.id, quantity: ol.quantity, net_amount: ol.net_amount, tax_amount: ol.tax_amount, returned_quantity: ol.returned_quantity, refunded_net: ol.refunded_net, refunded_tax: ol.refunded_tax }, q));
          await tx.query(`UPDATE pos_order_lines SET returned_quantity = returned_quantity + $1, refunded_net = refunded_net + $2, refunded_tax = refunded_tax + $3 WHERE id = $4`, [q, refund.net, refund.tax, ol.id]);
          rls.push({ original_line_id: ol.id, item_id: ol.item_id, quantity: q, net: refund.net, tax: refund.tax, unit_cost: ol.unit_cost, item_type: ol.item_type, code: ol.item_code });
        }
      } else {
        const ids = rawLines.map((l, i) => uuid(l.item_id, `lines[${i}].item_id`));
        const itemMap = await lockItems(tx, orgId, ids);
        for (const [i, l] of rawLines.entries()) {
          const it = itemMap.get(ids[i]);
          const q = decimal(l.quantity, `lines[${i}].quantity`, { sign: "positive", scale: 3 });
          const shelf = new Money15(it.unit_price);
          const price = present(l.unit_price) ? Money15.min(decimal(l.unit_price, `lines[${i}].unit_price`, { sign: "nonNegative" }), shelf) : shelf;
          const net = new Money15(q).mul(price).round(2);
          const tax = net.mul(it.tax_rate || "0").div(100).round(2);
          rls.push({ original_line_id: null, item_id: it.id, quantity: q, net: net.toFixed(2), tax: tax.toFixed(2), unit_cost: it.unit_cost, item_type: it.item_type, code: it.code });
        }
      }
      const netT = rls.reduce((s, l) => s.add(l.net), Money15.zero());
      const taxT = rls.reduce((s, l) => s.add(l.tax), Money15.zero());
      const total = netT.add(taxT);
      if (!total.isPositive())
        throw validationError("Nothing to refund");
      let refunds;
      if (withReceipt && refundTo === "ORIGINAL") {
        const ot = (await tx.query(`SELECT * FROM pos_tenders WHERE order_id = $1 FOR UPDATE`, [original.id])).rows;
        refunds = engine(() => allocateRefundToTenders(total.toFixed(2), ot.map((t) => ({ tender_id: t.id, type: t.tender_type, applied_amount: t.applied_amount, refunded_amount: t.refunded_amount, reference: t.reference }))));
        for (const r of refunds)
          await tx.query(`UPDATE pos_tenders SET refunded_amount = refunded_amount + $1 WHERE id = $2`, [r.amount, r.tender_id]);
      } else if (refundTo === "CASH") {
        if (!withReceipt && !approver)
          throw new ApiError(403, ErrorCode26.APPROVAL_REQUIRED, "Cash refunds without a receipt need a manager");
        refunds = [{ type: "CASH", amount: total.toFixed(2) }];
      } else {
        refunds = [{ type: "STORE_CREDIT", amount: total.toFixed(2) }];
      }
      let storeCreditCode = null;
      for (const r of refunds) {
        if (r.type === "GIFT_CARD" || r.type === "STORE_CREDIT") {
          let acct;
          if (r.reference)
            acct = await lockStoredValue(tx, orgId, r.type, r.reference);
          else {
            const code = newCode("SC");
            const sid = crypto14.randomUUID();
            await tx.query(`INSERT INTO pos_stored_value_accounts (id, organization_id, kind, code, customer_id, balance) VALUES ($1,$2,'STORE_CREDIT',$3,$4,0)`, [sid, orgId, code, customerId]);
            acct = { id: sid, kind: "STORE_CREDIT", code };
            r.reference = code;
          }
          if (r.type === "STORE_CREDIT")
            storeCreditCode = acct.code;
          await storedValueMove(tx, req, acct, new Money15(r.amount), "POS_RETURN", returnId);
        }
        if (r.type === "LOYALTY" && customerId)
          await loyaltyMove(tx, orgId, customerId, pointsForAmount(r.amount), "POS_RETURN", returnId);
      }
      let clawback = 0;
      if (original?.customer_id && original.loyalty_points_earned > 0 && new Money15(original.net_amount).isPositive()) {
        clawback = Math.min(original.loyalty_points_earned, new Money15(original.loyalty_points_earned).mul(netT).div(original.net_amount).floor(0).toDecimal().toNumber());
        const bal = (await tx.query(`SELECT points_balance FROM pos_loyalty_accounts WHERE organization_id = $1 AND customer_id = $2`, [orgId, original.customer_id])).rows[0]?.points_balance ?? 0;
        clawback = Math.min(clawback, bal);
        if (clawback > 0)
          await loyaltyMove(tx, orgId, original.customer_id, -clawback, "POS_RETURN_CLAWBACK", returnId);
      }
      const wh = await stockWarehouse(tx, orgId, register);
      const number = await nextDocumentNumber(tx, orgId, `RTN-${register.register_code}`, businessDate, 6);
      const desc = `POS return ${number}${original ? " of " + original.order_number : " (no receipt)"}`;
      const jl = [{ account_code: "411004", debit: netT.toFixed(8), description: `${desc} sales returns` }];
      if (taxT.isPositive())
        jl.push({ account_code: "212001", debit: taxT.toFixed(8), description: `${desc} output tax reversed` });
      const refundByType = {};
      for (const r of refunds)
        refundByType[r.type] = (refundByType[r.type] || Money15.zero()).add(r.amount);
      for (const [type, amt] of Object.entries(refundByType))
        jl.push({ account_code: TENDER_ACCOUNT[type], credit: amt.toFixed(8), description: `${desc} refund ${type}` });
      if (clawback > 0) {
        const v = new Money15(redemptionValue(clawback)).toFixed(8);
        jl.push({ account_code: "211008", debit: v, description: `${desc} loyalty clawback` });
        jl.push({ account_code: "411004", credit: v, description: `${desc} loyalty clawback` });
      }
      await tx.query(`INSERT INTO pos_returns (id, organization_id, return_number, session_id, original_order_id, customer_id, with_receipt, net_amount, tax_amount, total_amount,
           refund_tenders, reason, restock, approval_id, journal_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`, [
        returnId,
        orgId,
        number,
        session.id,
        original?.id || null,
        customerId,
        withReceipt,
        netT.toFixed(8),
        taxT.toFixed(8),
        total.toFixed(8),
        JSON.stringify(refunds),
        reason,
        restock,
        present(req.body.approval_id) ? req.body.approval_id : null,
        null,
        req.session.user_id
      ]);
      for (const l of rls) {
        await tx.query(`INSERT INTO pos_return_lines (return_id, original_line_id, item_id, quantity, net_amount, tax_amount, unit_cost) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
          returnId,
          l.original_line_id,
          l.item_id,
          l.quantity,
          l.net,
          l.tax,
          l.unit_cost
        ]);
        if (restock && l.item_type === "INVENTORY") {
          await postStockMovement(tx, {
            organizationId: orgId,
            legalEntityId: req.session.legal_entity_id,
            itemId: l.item_id,
            warehouseId: wh,
            movementType: "POS_RETURN",
            movementDate: businessDate,
            quantity: new Money15(l.quantity).toFixed(8),
            unitCost: l.unit_cost,
            referenceType: "POS_RETURN",
            referenceId: returnId,
            description: desc
          });
          const cost = new Money15(l.quantity).mul(l.unit_cost).round(2);
          if (cost.isPositive()) {
            jl.push({ account_code: "113001", debit: cost.toFixed(8), description: `${desc} restock ${l.code}` });
            jl.push({ account_code: "511001", credit: cost.toFixed(8), description: `${desc} COGS reversal ${l.code}` });
          }
        }
      }
      const j = await postJournal(tx, auditLogger, outboxService, {
        organizationId: orgId,
        legalEntityId: req.session.legal_entity_id,
        userId: req.session.user_id,
        postingDate: businessDate,
        purpose: AccountingPurpose10.POS_RETURN,
        description: desc,
        sourceType: "POS_RETURN",
        sourceId: returnId,
        sourceKey: `POS_RETURN:${returnId}`,
        numberPrefix: "JV-POS",
        lines: jl,
        approvedBy: approver,
        correlationId: req.correlationId
      });
      await tx.query(`UPDATE pos_returns SET journal_id = $1 WHERE id = $2`, [j?.journalId || null, returnId]);
      if (original) {
        await tx.query(`UPDATE pos_orders SET refunded_amount = refunded_amount + $1 WHERE id = $2`, [total.toFixed(8), original.id]);
        const left = (await tx.query(`SELECT COALESCE(SUM(quantity - returned_quantity),0)::text AS left FROM pos_order_lines WHERE order_id = $1`, [original.id])).rows[0].left;
        await tx.query(`UPDATE pos_orders SET status = $1 WHERE id = $2`, [new Money15(left).isZero() ? "REFUNDED" : "PARTIALLY_REFUNDED", original.id]);
      }
      const cashOut = refundByType.CASH || Money15.zero();
      if (cashOut.isPositive()) {
        if (cashOut.gt(drawerOf(session)))
          throw validationError(`Drawer only holds ${new Money15(drawerOf(session)).format()}; refund to store credit instead`);
        await tx.query(`UPDATE pos_sessions SET cash_refunds_total = cash_refunds_total + $1, expected_cash_drawer = expected_cash_drawer - $1 WHERE id = $2`, [cashOut.toFixed(8), session.id]);
        await posEvent(tx, req, { registerId: register.id, sessionId: session.id, type: "DRAWER_OPENED", referenceId: returnId, details: { reason: "REFUND" } });
      }
      const elecOut = (refundByType.CARD || Money15.zero()).add(refundByType.WALLET || Money15.zero());
      if (elecOut.isPositive())
        await tx.query(`UPDATE pos_sessions SET card_sales_total = card_sales_total - $1 WHERE id = $2`, [elecOut.toFixed(8), session.id]);
      await posEvent(tx, req, { registerId: register.id, sessionId: session.id, type: withReceipt ? "RETURN" : "RETURN_NO_RECEIPT", referenceId: returnId, details: { number, total: total.toFixed(2), refunds, approved_by: approver } });
      await audit5(req, tx, "POS_RETURN_POSTED", "POS_RETURN", returnId, { number, total: total.toFixed(2), original: original?.order_number, journal_id: j?.journalId });
      return {
        id: returnId,
        return_number: number,
        with_receipt: withReceipt,
        net_amount: netT.toFixed(2),
        tax_amount: taxT.toFixed(2),
        total_amount: total.toFixed(2),
        refunds: refunds.map(({ tender_id: _t, ...r }) => r),
        store_credit_code: storeCreditCode,
        journal_id: j?.journalId || null,
        loyalty_clawback: clawback
      };
    });
    return ok(req, res, out, 201);
  });
  app.get("/api/pos/stored-value/:code", authenticate, terminal, async (req, res) => {
    const kind = oneOf(req.query.kind, "kind", ["GIFT_CARD", "STORE_CREDIT"], "GIFT_CARD");
    const r = await db.query(`SELECT id, kind, code, balance::text, is_active, customer_id FROM pos_stored_value_accounts WHERE organization_id = $1 AND kind = $2 AND code = $3`, [
      org(req),
      kind,
      String(req.params.code).toUpperCase().slice(0, 64)
    ]);
    if (r.rows.length === 0)
      throw notFound(kind === "GIFT_CARD" ? "Gift card" : "Store credit");
    return ok(req, res, r.rows[0]);
  });
  app.post("/api/pos/gift-cards", authenticate, terminal, async (req, res) => {
    const amount = decimal(req.body.amount, "amount", { sign: "positive" });
    if (new Money15(amount).gt("100000"))
      throw validationError("Gift card value cannot exceed 100,000", { field: "amount" });
    const tenderType = oneOf(req.body.tender_type, "tender_type", ["CASH", "CARD", "WALLET"], "CASH");
    const out = await db.transaction(async (tx) => {
      const { session, register, businessDate } = await loadSession(tx, req, req.body.session_id, { forUpdate: true });
      const code = present(req.body.code) ? str(req.body.code, "code", { max: 32, pattern: /^[A-Z0-9-]{6,32}$/i }).toUpperCase() : newCode("GC");
      if (req.body.customer_id)
        await assertOrgRef(tx, "parties", req.body.customer_id, org(req), "customer_id");
      const id = crypto14.randomUUID();
      await tx.query(`INSERT INTO pos_stored_value_accounts (id, organization_id, kind, code, customer_id, balance) VALUES ($1,$2,'GIFT_CARD',$3,$4,0)`, [id, org(req), code, req.body.customer_id || null]);
      await storedValueMove(tx, req, { id, kind: "GIFT_CARD" }, new Money15(amount), "GIFT_CARD_ISSUE", id);
      const amt = new Money15(amount).toFixed(8);
      const j = await postJournal(tx, auditLogger, outboxService, {
        organizationId: org(req),
        legalEntityId: req.session.legal_entity_id,
        userId: req.session.user_id,
        postingDate: businessDate,
        purpose: AccountingPurpose10.GIFT_CARD_ISSUE,
        description: `Gift card ${code} issued`,
        sourceType: "POS_GIFT_CARD",
        sourceId: id,
        sourceKey: `GIFT_CARD_ISSUE:${id}`,
        numberPrefix: "JV-POS",
        correlationId: req.correlationId,
        lines: [{ account_code: TENDER_ACCOUNT[tenderType], debit: amt, description: `Gift card ${code} ${tenderType}` }, { account_code: "211007", credit: amt, description: `Gift card ${code} liability` }]
      });
      if (tenderType === "CASH")
        await tx.query(`UPDATE pos_sessions SET cash_sales_total = cash_sales_total + $1, expected_cash_drawer = expected_cash_drawer + $1 WHERE id = $2`, [amt, session.id]);
      else
        await tx.query(`UPDATE pos_sessions SET card_sales_total = card_sales_total + $1 WHERE id = $2`, [amt, session.id]);
      await posEvent(tx, req, { registerId: register.id, sessionId: session.id, type: "GIFT_CARD_ISSUED", referenceId: id, details: { code, amount, tender_type: tenderType } });
      return { id, code, balance: f2(amount), journal_id: j?.journalId || null };
    });
    return ok(req, res, out, 201);
  });
}

// apps/api/dist/routes/automation.js
init_context();
init_http();
init_errors();
init_validate();
init_scope();
import crypto18 from "node:crypto";
import { Money as Money22 } from "@omnysync/financial-engine";
import { Permission as Permission21 } from "@omnysync/contracts";

// apps/api/dist/automation/engine.js
init_context();

// apps/api/dist/automation/schedule.js
var fmtCache = /* @__PURE__ */ new Map();
function formatter(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    fmtCache.set(tz, f);
  }
  return f;
}
function localParts(at, tz) {
  const p = Object.fromEntries(formatter(tz).formatToParts(at).map((x) => [x.type, x.value]));
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour % 24, minute: +p.minute };
}
function offsetMinutes(at, tz) {
  const p = localParts(at, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((asUtc - Math.floor(at.getTime() / 6e4) * 6e4) / 6e4);
}
function zonedToUtc(p, tz) {
  const guess = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  let t = guess - offsetMinutes(new Date(guess), tz) * 6e4;
  const o2 = offsetMinutes(new Date(t), tz);
  t = guess - o2 * 6e4;
  const back = localParts(new Date(t), tz);
  if (back.hour !== p.hour || back.minute !== p.minute) {
    for (let i = 1; i <= 120; i++) {
      const c = new Date(t + i * 6e4);
      const lp = localParts(c, tz);
      if (lp.day === p.day && (lp.hour > p.hour || lp.hour === p.hour && lp.minute >= p.minute))
        return c;
    }
  }
  const earlier = new Date(t - 60 * 6e4);
  const e = localParts(earlier, tz);
  if (e.hour === p.hour && e.minute === p.minute && e.day === p.day)
    return earlier;
  return new Date(t);
}
var pad2 = (n, w = 2) => String(n).padStart(w, "0");
function parseTime(s) {
  const m = /^(\d{1,2}):(\d{2})/.exec(s || "06:00");
  const hour = Math.min(23, Math.max(0, Number(m?.[1] ?? 6)));
  const minute = Math.min(59, Math.max(0, Number(m?.[2] ?? 0)));
  return { hour, minute };
}
function addDays(p, n) {
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + n));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}
function nextRun(spec, after) {
  const tz = spec.timezone || "Asia/Karachi";
  if (spec.schedule_kind === "INTERVAL") {
    const mins = Math.max(5, spec.interval_minutes || 60);
    const step = mins * 6e4;
    return new Date((Math.floor(after.getTime() / step) + 1) * step);
  }
  const { hour, minute } = parseTime(spec.run_at_local);
  const now = localParts(after, tz);
  if (spec.schedule_kind === "DAILY") {
    for (let i = 0; i < 3; i++) {
      const d = addDays(now, i);
      const t = zonedToUtc({ ...d, hour, minute }, tz);
      if (t.getTime() > after.getTime())
        return t;
    }
  }
  const dom = Math.min(28, Math.max(1, spec.day_of_month || 1));
  for (let i = 0; i < 3; i++) {
    const y = now.year + Math.floor((now.month - 1 + i) / 12);
    const mo = (now.month - 1 + i) % 12 + 1;
    const t = zonedToUtc({ year: y, month: mo, day: dom, hour, minute }, tz);
    if (t.getTime() > after.getTime())
      return t;
  }
  throw new Error("Unable to compute next run");
}
function occurrenceKey(spec, at) {
  const tz = spec.timezone || "Asia/Karachi";
  if (spec.schedule_kind === "INTERVAL") {
    const mins = Math.max(5, spec.interval_minutes || 60);
    return `I${mins}:${Math.floor(at.getTime() / (mins * 6e4))}`;
  }
  const p = localParts(at, tz);
  if (spec.schedule_kind === "DAILY")
    return `D:${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
  return `M:${p.year}-${pad2(p.month)}`;
}
function backoffMs(attempt) {
  return Math.min(60, 2 ** Math.max(0, attempt - 1)) * 6e4;
}
function localDate(at, tz = "Asia/Karachi") {
  const p = localParts(at, tz);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}
function addMonthsIso(iso, n, dayOfMonth) {
  const [y, m] = iso.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${pad2(total % 12 + 1)}-${pad2(Math.min(28, dayOfMonth))}`;
}

// apps/api/dist/automation/jobs.js
init_context();
init_posting();
init_numbering();
init_validate();
import crypto17 from "node:crypto";
import { AccountingPurpose as AccountingPurpose15 } from "@omnysync/contracts";
import { BankReconciliationEngine as BankReconciliationEngine2, Money as Money21 } from "@omnysync/financial-engine";

// apps/api/dist/routes/subscriptions.js
init_context();
init_http();
init_errors();
init_resource();
init_modules();
init_validate();
init_ar_invoice();
init_numbering();
init_posting();
init_context();
import { Permission as Permission18, ErrorCode as ErrorCode28, AccountingPurpose as AccountingPurpose12 } from "@omnysync/contracts";
import { Money as Money18 } from "@omnysync/financial-engine";
var VIEW3 = [Permission18.SUBSCRIPTION_VIEW, Permission18.SUBSCRIPTION_MANAGE, Permission18.SUBSCRIPTION_BILL];
var MONTHS = { MONTHLY: 1, QUARTERLY: 3, ANNUAL: 12 };
function addMonths(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}
var minusDay = (iso) => new Date(Date.parse(`${iso}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);
function periodNet(price, qty, discountPct) {
  return new Money18(price).mul(qty).mul(new Money18(100).sub(discountPct)).div(100).round(2);
}
function mrr(price, qty, discountPct, interval) {
  return periodNet(price, qty, discountPct).div(MONTHS[interval]).round(2);
}
function allocateByMonth(start, end, amount) {
  const day = 864e5;
  const s = Date.parse(`${start}T00:00:00Z`);
  const e = Date.parse(`${end}T00:00:00Z`);
  const total = Math.round((e - s) / day) + 1;
  const out = [];
  let cursor = s;
  let allocated = Money18.zero();
  while (cursor <= e) {
    const d = new Date(cursor);
    const mStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    const mEnd = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0);
    const segEnd = Math.min(mEnd, e);
    const days = Math.round((segEnd - cursor) / day) + 1;
    const last = segEnd === e;
    const amt = last ? new Money18(amount).sub(allocated) : new Money18(amount).mul(days).div(total).round(2);
    allocated = allocated.add(amt);
    out.push({ month_start: new Date(mStart).toISOString().slice(0, 10), month_end: new Date(mEnd).toISOString().slice(0, 10), amount: amt.toFixed(2) });
    cursor = segEnd + day;
  }
  return out;
}
async function recognizeRevenue(ctx, asOf, subscriptionId) {
  const due = (await ctx.tx.query(`SELECT r.*, s.number AS sub_number FROM com_revenue_schedule r JOIN com_subscriptions s ON s.id = r.subscription_id
       WHERE r.organization_id = $1 AND r.status = 'PENDING' AND r.recognize_on <= $2 AND ($3::uuid IS NULL OR r.subscription_id = $3::uuid)
       ORDER BY r.recognize_on, s.number FOR UPDATE OF r`, [ctx.org, asOf, subscriptionId ?? null])).rows;
  let total = Money18.zero();
  for (const r of due) {
    const amt = new Money18(r.amount).round(2);
    let journalId = null;
    if (amt.isPositive()) {
      const j = await postJournal(ctx.tx, auditLogger, outboxService, {
        organizationId: ctx.org,
        legalEntityId: ctx.le,
        userId: ctx.user,
        postingDate: toIsoDate(r.recognize_on),
        purpose: AccountingPurpose12.REVENUE_RECOGNITION,
        description: `Revenue recognised ${r.sub_number} ${toIsoDate(r.month_start).slice(0, 7)}`,
        sourceType: "COM_REVENUE",
        sourceId: r.id,
        sourceKey: `COM_REV:${r.id}`,
        numberPrefix: "JV-REV",
        correlationId: ctx.req.correlationId,
        lines: [
          { account_code: "211010", debit: amt.toFixed(8), description: `Deferred revenue released ${r.sub_number}` },
          { account_code: "411007", credit: amt.toFixed(8), description: `Subscription revenue ${r.sub_number}` }
        ]
      });
      journalId = j?.journalId ?? null;
      total = total.add(amt);
    }
    await ctx.tx.query(`UPDATE com_revenue_schedule SET status = 'RECOGNISED', journal_id = $2, recognised_at = NOW() WHERE id = $1`, [r.id, journalId]);
  }
  return { recognised_lines: due.length, recognised_amount: total.toFixed(2) };
}
async function releaseDeferredOnCancel(ctx, sub, asOf, treatment) {
  await recognizeRevenue(ctx, asOf, sub.id);
  const lines = (await ctx.tx.query(`SELECT r.id, r.amount::text, r.month_start, r.recognize_on, bp.period_start FROM com_revenue_schedule r JOIN com_billing_periods bp ON bp.id = r.billing_period_id
       WHERE r.subscription_id = $1 AND r.organization_id = $2 AND r.status = 'PENDING' ORDER BY r.month_start FOR UPDATE OF r`, [sub.id, ctx.org])).rows;
  let earned = Money18.zero();
  let unearned = Money18.zero();
  const day = 864e5;
  for (const l of lines) {
    const amt = new Money18(l.amount).round(2);
    const segStart = Math.max(Date.parse(toIsoDate(l.month_start)), Date.parse(toIsoDate(l.period_start)));
    const segEnd = Date.parse(toIsoDate(l.recognize_on));
    const t = Date.parse(asOf);
    let e = Money18.zero();
    if (t >= segStart)
      e = amt.mul(Math.round((Math.min(t, segEnd) - segStart) / day) + 1).div(Math.round((segEnd - segStart) / day) + 1).round(2);
    earned = earned.add(e);
    unearned = unearned.add(amt.sub(e));
    await ctx.tx.query(`UPDATE com_revenue_schedule SET status = 'RELEASED', released_amount = $2, recognised_at = NOW() WHERE id = $1`, [l.id, amt.sub(e).toFixed(8)]);
  }
  const total = earned.add(unearned);
  if (!total.isPositive())
    return { earned: "0.00", unearned: "0.00", treatment, journal_id: null };
  const jl = [{ account_code: "211010", debit: total.toFixed(8), description: `Deferred revenue settled on cancellation ${sub.number}` }];
  const toRevenue = treatment === "FORFEIT" ? earned.add(unearned) : earned;
  if (toRevenue.isPositive())
    jl.push({ account_code: "411007", credit: toRevenue.toFixed(8), description: `Subscription revenue ${sub.number} (${treatment === "FORFEIT" ? "earned + forfeited" : "earned to cancellation"})` });
  if (treatment === "REFUND" && unearned.isPositive())
    jl.push({ account_code: "211006", credit: unearned.toFixed(8), description: `Unearned subscription balance owed to customer ${sub.number}` });
  const j = await postJournal(ctx.tx, auditLogger, outboxService, {
    organizationId: ctx.org,
    legalEntityId: ctx.le,
    userId: ctx.user,
    postingDate: asOf,
    purpose: AccountingPurpose12.REVENUE_RECOGNITION,
    description: `Subscription ${sub.number} cancelled \u2014 deferred revenue settled (${treatment})`,
    sourceType: "COM_CANCEL",
    sourceId: sub.id,
    sourceKey: `COM_CANCEL:${sub.id}`,
    numberPrefix: "JV-REV",
    correlationId: ctx.req.correlationId,
    lines: jl
  });
  await ctx.tx.query(`UPDATE com_revenue_schedule SET journal_id = $2 WHERE subscription_id = $1 AND status = 'RELEASED' AND journal_id IS NULL`, [sub.id, j?.journalId ?? null]);
  return { earned: earned.toFixed(2), unearned: unearned.toFixed(2), treatment, journal_id: j?.journalId ?? null };
}
async function changePlan(ctx, sub, toPlanId, effective) {
  if (sub.status !== "ACTIVE")
    throw new ApiError(409, ErrorCode28.INVALID_STATE, `Only ACTIVE subscriptions can change plan (is ${sub.status})`);
  if (toPlanId === sub.plan_id)
    throw validationError("The subscription is already on that plan", { field: "plan_id" });
  const from = await loadRow(ctx.tx, "com_plans", sub.plan_id, ctx.org, "Plan");
  const to = await loadRow(ctx.tx, "com_plans", toPlanId, ctx.org, "Plan");
  if (to.status !== "ACTIVE")
    throw validationError("The target plan is retired", { field: "plan_id" });
  if (to.billing_interval !== from.billing_interval)
    throw validationError(`Plan changes must keep the billing cycle (${from.billing_interval})`, { field: "plan_id" });
  if (effective > todayIso())
    throw validationError("effective_date cannot be in the future", { field: "effective_date" });
  if (effective < toIsoDate(sub.start_date))
    throw validationError("effective_date is before the subscription start", { field: "effective_date" });
  const dup = await ctx.tx.query(`SELECT 1 FROM com_plan_changes WHERE subscription_id = $1 AND effective_date = $2`, [sub.id, effective]);
  if (dup.rows[0])
    throw new ApiError(409, ErrorCode28.DUPLICATE_RESOURCE, `The plan was already changed effective ${effective}`);
  const oldNet = periodNet(from.price, sub.quantity, sub.discount_pct);
  const newNet = periodNet(to.price, sub.quantity, sub.discount_pct);
  const direction = newNet.gt(oldNet) ? "UPGRADE" : newNet.lt(oldNet) ? "DOWNGRADE" : "LATERAL";
  let prorated = Money18.zero();
  let periodId = null;
  let invoice = null;
  if (direction === "DOWNGRADE") {
    await ctx.tx.query(`UPDATE com_subscriptions SET pending_plan_id = $2 WHERE id = $1`, [sub.id, to.id]);
  } else {
    const cur = (await ctx.tx.query(`SELECT id, period_start, period_end FROM com_billing_periods WHERE subscription_id = $1 AND kind = 'REGULAR' AND period_start <= $2 AND period_end >= $2 ORDER BY period_start DESC LIMIT 1`, [sub.id, effective])).rows[0];
    if (cur && direction === "UPGRADE") {
      const ps = toIsoDate(cur.period_start);
      const pe = toIsoDate(cur.period_end);
      const day = 864e5;
      const total = Math.round((Date.parse(pe) - Date.parse(ps)) / day) + 1;
      const remaining = Math.round((Date.parse(pe) - Date.parse(effective)) / day) + 1;
      prorated = newNet.sub(oldNet).mul(remaining).div(total).round(2);
      if (prorated.isPositive()) {
        const deferred = MONTHS[to.billing_interval] > 1;
        const ins = await ctx.tx.query(`INSERT INTO com_billing_periods (organization_id, subscription_id, period_start, period_end, net_amount, kind) VALUES ($1,$2,$3,$4,$5,'UPGRADE') RETURNING id`, [ctx.org, sub.id, effective, pe, prorated.toFixed(8)]);
        periodId = ins.rows[0].id;
        const inv = await createPostedSourceInvoice(ctx, {
          party_id: sub.party_id,
          invoice_date: effective,
          due_days: 15,
          lines: [{ item_id: to.item_id, description: `Upgrade ${from.name} \u2192 ${to.name}, ${effective} \u2013 ${pe} (${remaining}/${total} days)`, quantity: "1.0000", unit_price: prorated.toFixed(4), tax_rate: new Money18(to.tax_rate).toFixed(3), revenue_account_code: deferred ? "211010" : "411007" }],
          sourceType: "SUBSCRIPTION",
          sourceId: sub.id,
          sourceKey: `COM-UPG:${sub.id}:${effective}`,
          notes: `Subscription ${sub.number} plan upgrade`,
          purpose: AccountingPurpose12.SUBSCRIPTION_INVOICE,
          prefix: "INV"
        });
        await ctx.tx.query(`UPDATE com_billing_periods SET ar_invoice_id = $2 WHERE id = $1`, [periodId, inv?.id ?? null]);
        invoice = inv?.invoice_number ?? null;
        if (deferred && inv) {
          for (const m of allocateByMonth(effective, pe, prorated.toFixed(2))) {
            await ctx.tx.query(`INSERT INTO com_revenue_schedule (organization_id, subscription_id, billing_period_id, month_start, recognize_on, amount) VALUES ($1,$2,$3,$4,$5,$6)`, [ctx.org, sub.id, periodId, m.month_start, m.month_end, m.amount]);
          }
        }
      }
    }
    await ctx.tx.query(`UPDATE com_subscriptions SET plan_id = $2, pending_plan_id = NULL WHERE id = $1`, [sub.id, to.id]);
  }
  await ctx.tx.query(`INSERT INTO com_plan_changes (organization_id, subscription_id, from_plan_id, to_plan_id, direction, effective_date, prorated_net, billing_period_id, applied, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [ctx.org, sub.id, from.id, to.id, direction, effective, prorated.toFixed(8), periodId, direction !== "DOWNGRADE", ctx.user]);
  return { direction, from_plan: from.code, to_plan: to.code, effective_date: effective, prorated_net: prorated.toFixed(2), invoice, applies_from: direction === "DOWNGRADE" ? toIsoDate(sub.next_bill_date) : effective };
}
async function billSubscription(ctx, id, asOf, maxPeriods = 12) {
  const s = await loadRow(ctx.tx, "com_subscriptions", id, ctx.org, "Subscription", true);
  if (s.status !== "ACTIVE")
    return { subscription: s.number, skipped: s.status };
  if (s.pending_plan_id && s.next_bill_date && toIsoDate(s.next_bill_date) <= asOf) {
    await ctx.tx.query(`UPDATE com_subscriptions SET plan_id = pending_plan_id, pending_plan_id = NULL WHERE id = $1`, [s.id]);
    await ctx.tx.query(`UPDATE com_plan_changes SET applied = true WHERE subscription_id = $1 AND to_plan_id = $2 AND applied = false`, [s.id, s.pending_plan_id]);
    s.plan_id = s.pending_plan_id;
    s.pending_plan_id = null;
  }
  const plan = await loadRow(ctx.tx, "com_plans", s.plan_id, ctx.org, "Plan");
  const step = MONTHS[plan.billing_interval];
  const invoices = [];
  let next = toIsoDate(s.next_bill_date);
  let ended = false;
  for (let n = 0; n < maxPeriods && next <= asOf; n++) {
    const end = s.end_date ? toIsoDate(s.end_date) : null;
    if (end && next >= end) {
      ended = true;
      break;
    }
    let pEnd = minusDay(addMonths(next, step));
    let net = periodNet(plan.price, s.quantity, s.discount_pct);
    if (end && pEnd >= end) {
      const full = (Date.parse(pEnd) - Date.parse(next)) / 864e5 + 1;
      const used = (Date.parse(end) - Date.parse(next)) / 864e5;
      net = net.mul(used).div(full).round(2);
      pEnd = minusDay(end);
    }
    const ins = await ctx.tx.query(`INSERT INTO com_billing_periods (organization_id, subscription_id, period_start, period_end, net_amount) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (subscription_id, period_start) WHERE kind = 'REGULAR' DO NOTHING RETURNING id`, [ctx.org, s.id, next, pEnd, net.toFixed(8)]);
    if (ins.rows[0] && net.isPositive()) {
      const deferred = step > 1;
      const qty = new Money18(s.quantity).toFixed(4);
      const unit = net.div(s.quantity).round(4).toFixed(4);
      const inv = await createPostedSourceInvoice(ctx, {
        party_id: s.party_id,
        invoice_date: next <= asOf ? next : asOf,
        due_days: 15,
        lines: [{ item_id: plan.item_id, description: `${plan.name} ${next} \u2013 ${pEnd}`, quantity: qty, unit_price: unit, tax_rate: new Money18(plan.tax_rate).toFixed(3), revenue_account_code: deferred ? "211010" : "411007" }],
        sourceType: "SUBSCRIPTION",
        sourceId: s.id,
        sourceKey: `COM:${s.id}:${next}`,
        notes: `Subscription ${s.number}`,
        purpose: AccountingPurpose12.SUBSCRIPTION_INVOICE,
        prefix: "INV"
      });
      await ctx.tx.query(`UPDATE com_billing_periods SET ar_invoice_id = $2 WHERE id = $1`, [ins.rows[0].id, inv?.id ?? null]);
      if (deferred && inv) {
        const billedNet = new Money18(unit).mul(qty).round(2).toFixed(2);
        for (const m of allocateByMonth(next, pEnd, billedNet)) {
          await ctx.tx.query(`INSERT INTO com_revenue_schedule (organization_id, subscription_id, billing_period_id, month_start, recognize_on, amount) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (billing_period_id, month_start) DO NOTHING`, [ctx.org, s.id, ins.rows[0].id, m.month_start, m.month_end, m.amount]);
        }
      }
      if (inv)
        invoices.push(inv.invoice_number);
    }
    next = addMonths(next, step);
    if (end && next >= end) {
      ended = true;
      break;
    }
  }
  await ctx.tx.query(`UPDATE com_subscriptions SET next_bill_date = $2, status = $3, revision = revision + 1, updated_at = NOW() WHERE id = $1`, [s.id, ended ? null : next, ended ? "ENDED" : "ACTIVE"]);
  return { subscription: s.number, invoices, next_bill_date: ended ? null : next, ended };
}
function registerSubscriptionRoutes(app) {
  defineResource(app, {
    path: "/api/com/plans",
    table: "com_plans",
    label: "Plan",
    event: "SUBSCRIPTION_PLAN",
    module: "COM",
    view: VIEW3,
    create: Permission18.SUBSCRIPTION_MANAGE,
    update: Permission18.SUBSCRIPTION_MANAGE,
    fields: {
      code: { type: "string", required: true, max: 32, pattern: /^[A-Z0-9-]+$/ },
      name: { type: "string", required: true },
      description: { type: "text" },
      billing_interval: { type: "enum", values: ["MONTHLY", "QUARTERLY", "ANNUAL"], required: true },
      price: { type: "decimal", required: true, sign: "positive", scale: 2 },
      tax_rate: { type: "decimal", default: "18", scale: 3 },
      item_id: { type: "ref", table: "items", required: true, label: "item_id" },
      visits_per_year: { type: "int", min: 0, max: 52, default: 0 }
    },
    editable: ["name", "description", "visits_per_year"],
    initialStatus: "ACTIVE",
    select: `t.*, i.code AS item_code, (SELECT COUNT(*)::int FROM com_subscriptions s WHERE s.plan_id = t.id AND s.status = 'ACTIVE') AS active_subscriptions`,
    joins: "JOIN items i ON i.id = t.item_id",
    search: ["code", "t.name"],
    orderBy: "t.price",
    beforeCreate: async (_c, v) => {
      if (new Money18(v.tax_rate).gt(100))
        throw validationError("tax_rate must be \u2264 100", { field: "tax_rate" });
    },
    commands: { retire: { from: ["ACTIVE"], to: "RETIRED", permission: Permission18.SUBSCRIPTION_MANAGE } }
  });
  defineResource(app, {
    path: "/api/com/subscriptions",
    table: "com_subscriptions",
    label: "Subscription",
    event: "SUBSCRIPTION",
    module: "COM",
    view: VIEW3,
    create: Permission18.SUBSCRIPTION_MANAGE,
    update: Permission18.SUBSCRIPTION_MANAGE,
    fields: {
      party_id: { type: "ref", table: "parties", required: true, label: "party_id" },
      plan_id: { type: "ref", table: "com_plans", required: true, label: "plan_id" },
      quantity: { type: "int", min: 1, max: 1e3, default: 1 },
      discount_pct: { type: "decimal", default: "0", scale: 2 },
      start_date: { type: "date", required: true },
      end_date: { type: "date" }
    },
    editable: ["quantity", "discount_pct", "end_date"],
    editableIn: ["DRAFT", "ACTIVE", "PAUSED"],
    numbering: { column: "number", prefix: "SUB", dateField: "start_date" },
    initialStatus: "DRAFT",
    select: `t.*, p.name AS party_name, pl.code AS plan_code, pl.name AS plan_name, pl.billing_interval, pl.price AS plan_price,
      ROUND(pl.price * t.quantity * (100 - t.discount_pct) / 100, 2) AS period_amount,
      (SELECT COUNT(*)::int FROM com_billing_periods b WHERE b.subscription_id = t.id AND b.kind = 'REGULAR') AS periods_billed`,
    joins: "JOIN parties p ON p.id = t.party_id JOIN com_plans pl ON pl.id = t.plan_id",
    search: ["number", "p.name", "pl.name"],
    filters: ["plan_id", "party_id"],
    detail: async (q, row) => ({
      plan_changes: (await q.query(`SELECT c.direction, c.effective_date, c.prorated_net::text, c.applied, f.code AS from_plan, t2.code AS to_plan, c.created_at FROM com_plan_changes c JOIN com_plans f ON f.id = c.from_plan_id JOIN com_plans t2 ON t2.id = c.to_plan_id WHERE c.subscription_id = $1 ORDER BY c.created_at DESC`, [row.id])).rows,
      periods: (await q.query(`SELECT b.*, i.invoice_number FROM com_billing_periods b LEFT JOIN ar_invoices i ON i.id = b.ar_invoice_id WHERE b.subscription_id = $1 ORDER BY b.period_start DESC`, [row.id])).rows,
      revenue_schedule: (await q.query(`SELECT r.id, r.month_start, r.recognize_on, r.amount, r.status, j.journal_number FROM com_revenue_schedule r LEFT JOIN journals j ON j.id = r.journal_id WHERE r.subscription_id = $1 ORDER BY r.month_start`, [row.id])).rows
    }),
    beforeCreate: async (ctx, v) => {
      if (new Money18(v.discount_pct).gte(100))
        throw validationError("discount_pct must be below 100", { field: "discount_pct" });
      if (v.end_date && v.end_date <= v.start_date)
        throw validationError("end_date must be after start_date", { field: "end_date" });
      const plan = await loadRow(ctx.tx, "com_plans", v.plan_id, ctx.org, "Plan");
      if (plan.status !== "ACTIVE")
        throw new ApiError(409, ErrorCode28.INVALID_STATE, `Plan ${plan.code} is retired`);
    },
    beforeUpdate: async (_c, row, v) => {
      if (v.discount_pct !== void 0 && new Money18(v.discount_pct).gte(100))
        throw validationError("discount_pct must be below 100", { field: "discount_pct" });
      if (v.end_date && v.end_date <= toIsoDate(row.start_date))
        throw validationError("end_date must be after start_date", { field: "end_date" });
    },
    commands: {
      activate: {
        from: ["DRAFT"],
        to: "ACTIVE",
        permission: Permission18.SUBSCRIPTION_MANAGE,
        fields: { create_service_contract: { type: "bool" } },
        run: async (ctx, row, i) => {
          const set = { next_bill_date: toIsoDate(row.start_date) };
          if (i.create_service_contract) {
            const plan = await loadRow(ctx.tx, "com_plans", row.plan_id, ctx.org, "Plan");
            const start = toIsoDate(row.start_date);
            const end = row.end_date ? minusDay(toIsoDate(row.end_date)) : minusDay(addMonths(start, 12));
            const number = await nextDocumentNumber(ctx.tx, ctx.org, "SVC", start);
            const k = await ctx.tx.query(`INSERT INTO srv_contracts (organization_id, legal_entity_id, number, party_id, contract_type, title, start_date, end_date, covers_labour, covers_parts, visits_included, pm_interval_months, next_pm_date, contract_value, status, created_by)
               VALUES ($1,$2,$3,$4,'AMC',$5,$6,$7,true,false,$8,$9,$6,0,'ACTIVE',$10) RETURNING id`, [ctx.org, ctx.le, number, row.party_id, `${plan.name} (${row.number})`, start, end, plan.visits_per_year, plan.visits_per_year ? Math.max(1, Math.floor(12 / plan.visits_per_year)) : null, ctx.user]);
            set.service_contract_id = k.rows[0].id;
          }
          return { set };
        }
      },
      pause: { from: ["ACTIVE"], to: "PAUSED", permission: Permission18.SUBSCRIPTION_MANAGE },
      resume: {
        from: ["PAUSED"],
        to: "ACTIVE",
        permission: Permission18.SUBSCRIPTION_MANAGE,
        run: async (_c, row) => {
          const plan = await loadRow(_c.tx, "com_plans", row.plan_id, _c.org, "Plan");
          let next = toIsoDate(row.next_bill_date || row.start_date);
          for (let g = 0; next < todayIso() && g < 240; g++)
            next = addMonths(next, MONTHS[plan.billing_interval]);
          return { set: { next_bill_date: next } };
        }
      },
      "change-plan": {
        from: ["ACTIVE"],
        permission: Permission18.SUBSCRIPTION_MANAGE,
        fields: { plan_id: { type: "ref", table: "com_plans", required: true, label: "plan_id" }, effective_date: { type: "date" } },
        run: async (ctx, row, i) => {
          const effective = i.effective_date ? toIsoDate(i.effective_date) : todayIso();
          const plan_change = await changePlan(ctx, row, i.plan_id, effective);
          const now = (await ctx.tx.query(`SELECT plan_id, pending_plan_id FROM com_subscriptions WHERE id = $1`, [row.id])).rows[0];
          return { set: { plan_id: now.plan_id, pending_plan_id: now.pending_plan_id }, data: { plan_change } };
        }
      },
      cancel: {
        from: ["DRAFT", "ACTIVE", "PAUSED"],
        to: "CANCELLED",
        permission: Permission18.SUBSCRIPTION_MANAGE,
        fields: { cancel_reason: { type: "text", required: true }, unearned_treatment: { type: "enum", values: ["REFUND", "FORFEIT"] }, effective_date: { type: "date" } },
        run: async (ctx, row, i) => {
          if (row.service_contract_id)
            await ctx.tx.query(`UPDATE srv_contracts SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1 AND status IN ('DRAFT','ACTIVE')`, [row.service_contract_id]);
          const treatment = i.unearned_treatment || "REFUND";
          const asOf = i.effective_date ? toIsoDate(i.effective_date) : todayIso();
          if (asOf > todayIso())
            throw validationError("effective_date cannot be in the future", { field: "effective_date" });
          const deferred = await releaseDeferredOnCancel(ctx, row, asOf, treatment);
          return { set: { cancel_reason: i.cancel_reason, cancelled_at: (/* @__PURE__ */ new Date()).toISOString(), next_bill_date: null, unearned_treatment: treatment }, data: { deferred } };
        }
      }
    }
  });
  app.post("/api/com/billing-run", authenticate, requireAnyPermission(Permission18.SUBSCRIPTION_BILL), requireModule("COM", "command"), async (req, res) => {
    const asOf = req.body?.as_of ? dateOnly(req.body.as_of, "as_of") : todayIso();
    const maxPeriods = req.body?.max_periods ? int(req.body.max_periods, "max_periods", { min: 1, max: 24 }) : 12;
    const org = req.session.organization_id;
    const due = (await db.query(`SELECT id FROM com_subscriptions WHERE organization_id = $1 AND status = 'ACTIVE' AND next_bill_date IS NOT NULL AND next_bill_date <= $2 ORDER BY number`, [org, asOf])).rows;
    const results = [];
    for (const { id } of due) {
      try {
        results.push(await unitOfWork(req, (ctx) => billSubscription(ctx, id, asOf, maxPeriods)));
      } catch (e) {
        results.push({ subscription_id: id, error: e?.code || "ERROR", message: e?.message });
      }
    }
    return ok(req, res, { as_of: asOf, processed: results.length, invoices: results.reduce((a, r) => a + (r.invoices?.length || 0), 0), failed: results.filter((r) => r.error).length, results });
  });
  app.post("/api/com/revenue/recognize", authenticate, requireAnyPermission(Permission18.SUBSCRIPTION_BILL), requireModule("COM", "command"), async (req, res) => {
    const asOf = req.body?.as_of ? dateOnly(req.body.as_of, "as_of") : todayIso();
    const out = await unitOfWork(req, (ctx) => recognizeRevenue(ctx, asOf));
    return ok(req, res, { as_of: asOf, ...out });
  });
  app.get("/api/com/summary", authenticate, requireAnyPermission(...VIEW3), async (req, res) => {
    const org = req.session.organization_id;
    const subs = (await db.query(`SELECT s.status, s.quantity, s.discount_pct::text, s.cancelled_at, pl.price::text, pl.billing_interval FROM com_subscriptions s JOIN com_plans pl ON pl.id = s.plan_id WHERE s.organization_id = $1`, [org])).rows;
    const active = subs.filter((s) => s.status === "ACTIVE");
    const total = active.reduce((a, s) => a.add(mrr(s.price, s.quantity, s.discount_pct, s.billing_interval)), Money18.zero());
    const billed = (await db.query(`SELECT COALESCE(SUM(net_amount),0)::text t FROM com_billing_periods WHERE organization_id = $1 AND period_start >= date_trunc('month', CURRENT_DATE)`, [org])).rows[0].t;
    const month = new Date(Date.now() + 5 * 36e5).toISOString().slice(0, 7);
    const churned = subs.filter((s) => s.status === "CANCELLED" && s.cancelled_at && new Date(new Date(s.cancelled_at).getTime() + 5 * 36e5).toISOString().slice(0, 7) === month).length;
    return ok(req, res, { mrr: total.toFixed(2), arr: total.mul(12).toFixed(2), active: active.length, paused: subs.filter((s) => s.status === "PAUSED").length, churned_this_month: churned, billed_this_month: new Money18(billed).toFixed(2) });
  });
}

// apps/api/dist/routes/lending.js
init_config();
init_context();
init_http();
init_errors();
init_resource();
init_modules();
init_validate();
init_posting();
import { Permission as Permission19, ErrorCode as ErrorCode29, AccountingPurpose as AccountingPurpose13 } from "@omnysync/contracts";
import { Money as Money19 } from "@omnysync/financial-engine";
var VIEW4 = [Permission19.LOAN_VIEW, Permission19.LOAN_MANAGE, Permission19.LOAN_APPROVE, Permission19.LOAN_POST];
function amortise(principal, annualRate, months, firstDue, method = "ANNUITY") {
  const P = new Money19(principal).round(2);
  const r = Number(annualRate) / 1200;
  const pay = r === 0 ? P.div(months).round(2) : new Money19(Number(P.toFixed(2)) * r / (1 - Math.pow(1 + r, -months))).round(2);
  const flat = P.div(months).round(2);
  let bal = P;
  const out = [];
  for (let k = 1; k <= months; k++) {
    const interest = new Money19(bal.toFixed(2)).mul(String(r)).round(2);
    let prin = method === "ANNUITY" ? pay.sub(interest) : flat;
    if (k === months || prin.gt(bal))
      prin = bal;
    if (prin.isNegative())
      prin = Money19.zero();
    bal = bal.sub(prin);
    out.push({ seq: k, due_date: addMonths(firstDue, k - 1), principal: prin.toFixed(2), interest: interest.toFixed(2) });
  }
  return out;
}
function allocate(rows, amount) {
  let left = new Money19(amount);
  let interest = Money19.zero();
  let principal = Money19.zero();
  let fees = Money19.zero();
  const updates = [];
  for (const r of rows) {
    if (!left.isPositive())
      break;
    const fDue = new Money19(r.late_fee ?? "0").sub(r.paid_late_fee ?? "0");
    const fPay = fDue.lt(left) ? fDue : left;
    left = left.sub(fPay);
    const iDue = new Money19(r.interest).sub(r.paid_interest);
    const iPay = iDue.lt(left) ? iDue : left;
    left = left.sub(iPay);
    const pDue = new Money19(r.principal).sub(r.paid_principal);
    const pPay = pDue.lt(left) ? pDue : left;
    left = left.sub(pPay);
    if (fPay.isPositive() || iPay.isPositive() || pPay.isPositive())
      updates.push({ id: r.id, interest: iPay.toFixed(2), principal: pPay.toFixed(2), fee: fPay.toFixed(2) });
    interest = interest.add(iPay);
    principal = principal.add(pPay);
    fees = fees.add(fPay);
  }
  return { interest: interest.toFixed(2), principal: principal.toFixed(2), fees: fees.toFixed(2), unapplied: left.toFixed(2), updates };
}
async function accrueInterest(ctx, asOf) {
  if (await getSetting(ctx.tx, ctx.org, "lnd.interest_basis") !== "ACCRUAL")
    return { as_of: asOf, basis: "CASH", accrued: 0, amount: "0.00", instalments: [] };
  const due = (await ctx.tx.query(`SELECT s.id, s.seq, s.due_date, s.interest::text, l.number, l.party_id FROM lnd_schedule s JOIN lnd_loans l ON l.id = s.loan_id
       WHERE s.organization_id = $1 AND l.status = 'ACTIVE' AND s.interest_accrued_on IS NULL AND s.interest > 0 AND s.due_date <= $2::date
       ORDER BY l.number, s.seq FOR UPDATE OF s`, [ctx.org, asOf])).rows;
  let total = Money19.zero();
  for (const r of due) {
    const amt = new Money19(r.interest).round(2);
    const j = await postJournal(ctx.tx, auditLogger, outboxService, {
      organizationId: ctx.org,
      legalEntityId: ctx.le,
      userId: ctx.user,
      postingDate: toIsoDate(r.due_date),
      purpose: AccountingPurpose13.LOAN_REPAYMENT,
      description: `Interest accrued ${r.number} #${r.seq}`,
      sourceType: "LOAN_ACCRUAL",
      sourceId: r.id,
      sourceKey: `LND_ACCR:${r.id}`,
      numberPrefix: "JV-LND",
      correlationId: ctx.req.correlationId,
      lines: [
        { account_code: "112005", debit: amt.toFixed(8), party_id: r.party_id, description: `Accrued interest ${r.number} #${r.seq}` },
        { account_code: "411006", credit: amt.toFixed(8), description: `Interest income ${r.number} #${r.seq}` }
      ]
    });
    await ctx.tx.query(`UPDATE lnd_schedule SET interest_accrued_on = $2, accrual_journal_id = $3 WHERE id = $1`, [r.id, toIsoDate(r.due_date), j?.journalId ?? null]);
    total = total.add(amt);
  }
  if (due.length)
    await audit2(ctx, "LOAN_INTEREST_ACCRUED", "LOAN", ctx.org, void 0, { as_of: asOf, count: due.length, amount: total.toFixed(2) });
  return { as_of: asOf, basis: "ACCRUAL", accrued: due.length, amount: total.toFixed(2), instalments: due.map((r) => `${r.number}#${r.seq}`) };
}
async function assessLateFees(ctx, asOf) {
  const fee = new Money19(await getSetting(ctx.tx, ctx.org, "lnd.late_fee_flat"));
  const grace = Number(await getSetting(ctx.tx, ctx.org, "lnd.grace_days"));
  if (!fee.isPositive())
    return { as_of: asOf, assessed: 0, fees: "0.00", instalments: [] };
  const due = (await ctx.tx.query(`SELECT s.id, s.seq, s.due_date, l.number FROM lnd_schedule s JOIN lnd_loans l ON l.id = s.loan_id
       WHERE s.organization_id = $1 AND l.status = 'ACTIVE' AND s.late_fee_assessed_on IS NULL AND (s.paid_principal < s.principal OR s.paid_interest < s.interest)
         AND s.due_date + ($2::int) < $3::date ORDER BY l.number, s.seq FOR UPDATE OF s`, [ctx.org, grace, asOf])).rows;
  for (const r of due)
    await ctx.tx.query(`UPDATE lnd_schedule SET late_fee = $2, late_fee_assessed_on = $3 WHERE id = $1`, [r.id, fee.toFixed(8), asOf]);
  if (due.length)
    await audit2(ctx, "LATE_FEES_ASSESSED", "LOAN", ctx.org, void 0, { as_of: asOf, count: due.length, fee: fee.toFixed(2) });
  return { as_of: asOf, assessed: due.length, fees: fee.mul(due.length).toFixed(2), instalments: due.map((r) => `${r.number}#${r.seq}`) };
}
function registerLendingRoutes(app) {
  defineResource(app, {
    path: "/api/lnd/loans",
    table: "lnd_loans",
    label: "Loan",
    event: "LOAN",
    module: "LND",
    view: VIEW4,
    create: Permission19.LOAN_MANAGE,
    update: Permission19.LOAN_MANAGE,
    fields: {
      party_id: { type: "ref", table: "parties", required: true, label: "party_id" },
      purpose: { type: "text" },
      principal: { type: "decimal", required: true, sign: "positive", scale: 2 },
      annual_rate: { type: "decimal", required: true, scale: 4 },
      term_months: { type: "int", required: true, min: 1, max: 360 },
      method: { type: "enum", values: ["ANNUITY", "EQUAL_PRINCIPAL"], default: "ANNUITY" },
      application_date: { type: "date", defaultToday: true }
    },
    editable: ["purpose", "principal", "annual_rate", "term_months", "method"],
    editableIn: ["DRAFT"],
    numbering: { column: "number", prefix: "LN", dateField: "application_date" },
    initialStatus: "DRAFT",
    select: `t.*, p.name AS party_name,
      (SELECT COALESCE(SUM(principal - paid_principal + interest - paid_interest),0) FROM lnd_schedule s WHERE s.loan_id = t.id AND s.due_date < CURRENT_DATE) AS overdue_amount,
      (SELECT MIN(due_date) FROM lnd_schedule s WHERE s.loan_id = t.id AND (s.paid_principal < s.principal OR s.paid_interest < s.interest)) AS next_due_date`,
    joins: "JOIN parties p ON p.id = t.party_id",
    search: ["number", "p.name"],
    filters: ["party_id"],
    beforeCreate: async (_c, v) => {
      if (new Money19(v.annual_rate).isNegative() || new Money19(v.annual_rate).gt(100))
        throw validationError("annual_rate must be between 0 and 100", { field: "annual_rate" });
    },
    beforeUpdate: async (_c, _r, v) => {
      if (v.annual_rate !== void 0 && (new Money19(v.annual_rate).isNegative() || new Money19(v.annual_rate).gt(100)))
        throw validationError("annual_rate must be between 0 and 100", { field: "annual_rate" });
    },
    detail: async (q, row) => {
      const schedule = (await q.query(`SELECT * FROM lnd_schedule WHERE loan_id = $1 ORDER BY seq`, [row.id])).rows;
      return {
        schedule: schedule.length ? schedule : amortise(row.principal, row.annual_rate, row.term_months, addMonths(toIsoDate(row.application_date), 1), row.method).map((s) => ({ ...s, preview: true })),
        repayments: (await q.query(`SELECT r.*, j.journal_number FROM lnd_repayments r LEFT JOIN journals j ON j.id = r.journal_id WHERE r.loan_id = $1 ORDER BY r.payment_date DESC, r.created_at DESC`, [row.id])).rows
      };
    },
    commands: {
      submit: { from: ["DRAFT"], to: "SUBMITTED", permission: Permission19.LOAN_MANAGE, run: async (ctx) => ({ set: { submitted_by: ctx.user } }) },
      approve: { from: ["SUBMITTED"], to: "APPROVED", permission: Permission19.LOAN_APPROVE, sodColumn: "submitted_by", fields: { decision_note: { type: "text" } }, run: async (ctx, _r, i) => ({ set: { approved_by: ctx.user, decision_note: i.decision_note ?? null } }) },
      reject: { from: ["SUBMITTED"], to: "REJECTED", permission: Permission19.LOAN_APPROVE, fields: { decision_note: { type: "text", required: true } }, run: async (_c, _r, i) => ({ set: { decision_note: i.decision_note } }) },
      disburse: {
        from: ["APPROVED"],
        to: "ACTIVE",
        permission: Permission19.LOAN_POST,
        sodColumn: "approved_by",
        fields: { disbursement_date: { type: "date", defaultToday: true }, first_due_date: { type: "date" } },
        run: async (ctx, row, i) => {
          const d = String(i.disbursement_date || todayIso());
          const first = i.first_due_date ? String(i.first_due_date) : addMonths(d, 1);
          if (first <= d)
            throw validationError("first_due_date must be after the disbursement date", { field: "first_due_date" });
          const amt = new Money19(row.principal).toFixed(8);
          const j = await postJournal(ctx.tx, auditLogger, outboxService, {
            organizationId: ctx.org,
            legalEntityId: ctx.le,
            userId: ctx.user,
            postingDate: d,
            purpose: AccountingPurpose13.LOAN_DISBURSEMENT,
            description: `Loan ${row.number} disbursed`,
            sourceType: "LOAN",
            sourceId: row.id,
            sourceKey: `LND_DISB:${row.id}`,
            numberPrefix: "JV-LND",
            correlationId: ctx.req.correlationId,
            lines: [
              { account_code: "112004", debit: amt, party_id: row.party_id, description: `Loan receivable ${row.number}` },
              { account_code: "111002", credit: amt, description: `Disbursement ${row.number}` }
            ]
          });
          for (const s of amortise(row.principal, row.annual_rate, row.term_months, first, row.method)) {
            await ctx.tx.query(`INSERT INTO lnd_schedule (organization_id, loan_id, seq, due_date, principal, interest) VALUES ($1,$2,$3,$4,$5,$6)`, [ctx.org, row.id, s.seq, s.due_date, s.principal, s.interest]);
          }
          return { set: { disbursement_date: d, first_due_date: first, outstanding_principal: amt, disbursement_journal_id: j?.journalId ?? null }, data: j };
        }
      }
    }
  });
  app.post("/api/lnd/loans/:id/repayments", authenticate, requireAnyPermission(Permission19.LOAN_POST), requireModule("LND", "command"), async (req, res) => {
    const b = req.body || {};
    const paymentDate = b.payment_date ? dateOnly(b.payment_date, "payment_date") : todayIso();
    if (!/^\d+(\.\d{1,2})?$/.test(String(b.amount ?? "")) || !new Money19(String(b.amount)).isPositive())
      throw validationError("amount must be a positive amount", { field: "amount" });
    const reference = String(b.reference ?? "").trim();
    if (!reference || reference.length > 64)
      throw validationError("reference is required (receipt / bank ref)", { field: "reference" });
    const out = await unitOfWork(req, async (ctx) => {
      const loan = await loadRow(ctx.tx, "lnd_loans", req.params.id, ctx.org, "Loan", true);
      if (loan.status !== "ACTIVE")
        throw new ApiError(409, ErrorCode29.INVALID_STATE, `Loan ${loan.number} is ${loan.status.toLowerCase()}`);
      if (paymentDate < toIsoDate(loan.disbursement_date))
        throw validationError("payment_date is before disbursement", { field: "payment_date" });
      const dup = await ctx.tx.query(`SELECT id FROM lnd_repayments WHERE loan_id = $1 AND reference = $2`, [loan.id, reference]);
      if (dup.rows.length)
        throw new ApiError(409, ErrorCode29.DUPLICATE_RESOURCE, `Repayment ${reference} is already recorded`);
      const open = (await ctx.tx.query(`SELECT id, principal::text, interest::text, paid_principal::text, paid_interest::text, late_fee::text, paid_late_fee::text, interest_accrued_on FROM lnd_schedule WHERE loan_id = $1 AND (paid_principal < principal OR paid_interest < interest OR paid_late_fee < late_fee) ORDER BY seq FOR UPDATE`, [loan.id])).rows;
      const a = allocate(open, String(b.amount));
      if (new Money19(a.unapplied).isPositive())
        throw validationError(`Payment exceeds the remaining balance by ${a.unapplied}`, { field: "amount" });
      const rep = await ctx.tx.query(`INSERT INTO lnd_repayments (organization_id, loan_id, payment_date, amount, interest_part, principal_part, fee_part, reference, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [ctx.org, loan.id, paymentDate, String(b.amount), a.interest, a.principal, a.fees, reference, ctx.user]);
      const lines = [{ account_code: "111002", debit: new Money19(String(b.amount)).toFixed(8), description: `Repayment ${reference}` }];
      if (new Money19(a.fees).isPositive())
        lines.push({ account_code: "411005", credit: new Money19(a.fees).toFixed(8), description: `Late fees ${loan.number}` });
      const accruedIds = new Set(open.filter((o) => o.interest_accrued_on).map((o) => o.id));
      const fromAccrued = a.updates.filter((u) => accruedIds.has(u.id)).reduce((m, u) => m.add(u.interest), Money19.zero());
      const cashInterest = new Money19(a.interest).sub(fromAccrued);
      if (fromAccrued.isPositive())
        lines.push({ account_code: "112005", credit: fromAccrued.toFixed(8), party_id: loan.party_id, description: `Accrued interest collected ${loan.number}` });
      if (cashInterest.isPositive())
        lines.push({ account_code: "411006", credit: cashInterest.toFixed(8), description: `Interest ${loan.number}` });
      if (new Money19(a.principal).isPositive())
        lines.push({ account_code: "112004", credit: new Money19(a.principal).toFixed(8), party_id: loan.party_id, description: `Principal ${loan.number}` });
      const j = await postJournal(ctx.tx, auditLogger, outboxService, {
        organizationId: ctx.org,
        legalEntityId: ctx.le,
        userId: ctx.user,
        postingDate: paymentDate,
        purpose: AccountingPurpose13.LOAN_REPAYMENT,
        description: `Loan ${loan.number} repayment ${reference}`,
        sourceType: "LOAN_REPAYMENT",
        sourceId: rep.rows[0].id,
        sourceKey: `LND_REPAY:${rep.rows[0].id}`,
        numberPrefix: "JV-LND",
        correlationId: ctx.req.correlationId,
        lines
      });
      await ctx.tx.query(`UPDATE lnd_repayments SET journal_id = $2 WHERE id = $1`, [rep.rows[0].id, j?.journalId ?? null]);
      for (const u of a.updates)
        await ctx.tx.query(`UPDATE lnd_schedule SET paid_interest = paid_interest + $2, paid_principal = paid_principal + $3, paid_late_fee = paid_late_fee + $4 WHERE id = $1`, [u.id, u.interest, u.principal, u.fee]);
      const outstanding = new Money19(loan.outstanding_principal).sub(a.principal);
      const closed = !(await ctx.tx.query(`SELECT 1 FROM lnd_schedule WHERE loan_id = $1 AND (paid_principal < principal OR paid_interest < interest OR paid_late_fee < late_fee) LIMIT 1`, [loan.id])).rows.length;
      await ctx.tx.query(`UPDATE lnd_loans SET outstanding_principal = $2, status = $3, revision = revision + 1, updated_at = NOW() WHERE id = $1`, [loan.id, outstanding.toFixed(8), closed ? "CLOSED" : "ACTIVE"]);
      await audit2(ctx, "REPAYMENT", "LOAN", loan.id, void 0, { reference, amount: String(b.amount), fees: a.fees, interest: a.interest, principal: a.principal });
      await emit(ctx, closed ? "LOAN_CLOSED" : "LOAN_REPAYMENT", { loan_id: loan.id, number: loan.number, amount: String(b.amount) });
      return { ...rep.rows[0], journal_number: j?.journalNumber ?? null, outstanding_principal: outstanding.toFixed(2), loan_status: closed ? "CLOSED" : "ACTIVE" };
    });
    return ok(req, res, out, 201);
  });
  app.post("/api/lnd/interest/accrue", authenticate, requireAnyPermission(Permission19.LOAN_POST), requireModule("LND", "command"), async (req, res) => {
    const asOf = req.body?.as_of ? dateOnly(req.body.as_of, "as_of") : todayIso();
    return ok(req, res, await unitOfWork(req, (ctx) => accrueInterest(ctx, asOf)));
  });
  app.post("/api/lnd/late-fees/assess", authenticate, requireAnyPermission(Permission19.LOAN_POST), requireModule("LND", "command"), async (req, res) => {
    const asOf = req.body?.as_of ? dateOnly(req.body.as_of, "as_of") : todayIso();
    const out = await unitOfWork(req, (ctx) => assessLateFees(ctx, asOf));
    return ok(req, res, out);
  });
  app.get("/api/lnd/summary", authenticate, requireAnyPermission(...VIEW4), async (req, res) => {
    const org = req.session.organization_id;
    const l = (await db.query(`SELECT COUNT(*) FILTER (WHERE status='ACTIVE')::int active, COUNT(*) FILTER (WHERE status IN ('SUBMITTED','APPROVED'))::int pipeline, COALESCE(SUM(outstanding_principal) FILTER (WHERE status='ACTIVE'),0)::text outstanding FROM lnd_loans WHERE organization_id = $1`, [org])).rows[0];
    const o = (await db.query(`SELECT COALESCE(SUM(s.principal - s.paid_principal + s.interest - s.paid_interest + s.late_fee - s.paid_late_fee),0)::text overdue, COUNT(DISTINCT s.loan_id)::int overdue_loans FROM lnd_schedule s JOIN lnd_loans l ON l.id = s.loan_id WHERE l.organization_id = $1 AND l.status = 'ACTIVE' AND s.due_date < CURRENT_DATE AND (s.paid_principal < s.principal OR s.paid_interest < s.interest)`, [org])).rows[0];
    const i = (await db.query(`SELECT COALESCE(SUM(interest_part),0)::text interest_mtd FROM lnd_repayments WHERE organization_id = $1 AND payment_date >= date_trunc('month', CURRENT_DATE)`, [org])).rows[0];
    return ok(req, res, { ...l, ...o, ...i });
  });
}

// apps/api/dist/automation/jobs.js
var f22 = (v) => new Money21(String(v ?? "0")).toFixed(2);
var daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
var isoPlusDays = (iso, n) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10);
async function reorderAlerts({ q, orgId }) {
  const r = await q.query(`SELECT i.id, i.code, i.name, i.reorder_point::text, i.reorder_qty::text, COALESCE(SUM(sm.quantity),0)::text AS on_hand
     FROM items i LEFT JOIN stock_movements sm ON sm.item_id = i.id AND sm.organization_id = i.organization_id
     WHERE i.organization_id = $1 AND i.is_active = true AND i.item_type = 'INVENTORY' AND i.reorder_point > 0
     GROUP BY i.id HAVING COALESCE(SUM(sm.quantity),0) <= i.reorder_point ORDER BY i.code`, [orgId]);
  const alerts = r.rows.map((i) => {
    const onHand2 = new Money21(i.on_hand);
    const target = new Money21(i.reorder_point).add(i.reorder_qty || "0");
    const proposed = Money21.max(new Money21(i.reorder_qty || "0"), target.sub(onHand2)).round(3);
    return {
      dedupe_key: `REORDER:${i.id}`,
      category: "INVENTORY",
      severity: onHand2.isPositive() ? "WARNING" : "CRITICAL",
      title: `${i.code} ${i.name} at/below reorder point`,
      body: `On hand ${onHand2.toFixed(3)} \u2264 reorder point ${new Money21(i.reorder_point).toFixed(3)}. Proposed order: ${proposed.toFixed(3)}.`,
      entity_type: "ITEM",
      entity_id: i.id,
      data: { on_hand: onHand2.toFixed(3), reorder_point: new Money21(i.reorder_point).toFixed(3), proposed_qty: proposed.toFixed(3) }
    };
  });
  return { summary: { items_below_reorder_point: alerts.length }, alerts, resolveScope: "REORDER:" };
}
async function stockGlRecon({ q, orgId, config }) {
  const tolerance = new Money21(String(config.tolerance ?? "1.00"));
  const r = await q.query(`WITH inv AS (
       SELECT i.inventory_account_id AS account_id, COALESCE(SUM(sm.total_value),0) AS stock_value
       FROM items i JOIN stock_movements sm ON sm.item_id = i.id AND sm.organization_id = i.organization_id
       WHERE i.organization_id = $1 AND i.item_type = 'INVENTORY' AND i.inventory_account_id IS NOT NULL
       GROUP BY i.inventory_account_id)
     SELECT a.id, a.code, a.name, inv.stock_value::text,
       COALESCE((SELECT SUM(jl.base_debit - jl.base_credit) FROM journal_lines jl JOIN journals j ON j.id = jl.journal_id
                 WHERE jl.account_id = a.id AND j.organization_id = $1 AND j.status IN ('POSTED','REVERSED')),0)::text AS gl_balance
     FROM inv JOIN accounts a ON a.id = inv.account_id`, [orgId]);
  const alerts = [];
  const accounts = r.rows.map((a) => {
    const diff = new Money21(a.gl_balance).sub(a.stock_value);
    if (diff.abs().gt(tolerance)) {
      alerts.push({
        dedupe_key: `STOCK_GL:${a.id}`,
        category: "FINANCE",
        severity: "CRITICAL",
        title: `Stock ledger \u2260 GL for ${a.code} ${a.name}`,
        body: `Stock valuation ${f22(a.stock_value)} vs GL ${f22(a.gl_balance)} (difference ${f22(diff.toFixed(2))}). Investigate unposted or mis-posted inventory movements.`,
        entity_type: "ACCOUNT",
        entity_id: a.id,
        data: { stock_value: f22(a.stock_value), gl_balance: f22(a.gl_balance), difference: diff.toFixed(2) }
      });
    }
    return { account: a.code, stock_value: f22(a.stock_value), gl_balance: f22(a.gl_balance), difference: diff.toFixed(2) };
  });
  return { summary: { accounts_checked: accounts.length, out_of_balance: alerts.length, accounts }, alerts, resolveScope: "STOCK_GL:" };
}
async function arDunning({ q, orgId, today }) {
  const r = await q.query(`SELECT a.id, a.invoice_number, a.due_date, a.outstanding_amount::text, p.name AS customer
     FROM ar_invoices a JOIN parties p ON p.id = a.party_id
     WHERE a.organization_id = $1 AND a.status IN ('POSTED','PARTIALLY_PAID') AND a.outstanding_amount > 0 AND a.due_date < $2::date
     ORDER BY a.due_date`, [orgId, today]);
  let total = Money21.zero();
  const alerts = r.rows.map((a) => {
    const days = daysBetween(toIsoDate(a.due_date), today);
    const level = days > 60 ? 3 : days > 30 ? 2 : 1;
    total = total.add(a.outstanding_amount);
    return {
      dedupe_key: `AR_DUNNING:${a.id}`,
      category: "RECEIVABLES",
      severity: level === 3 ? "CRITICAL" : level === 2 ? "WARNING" : "INFO",
      title: `Dunning level ${level}: ${a.invoice_number} (${a.customer})`,
      body: `${f22(a.outstanding_amount)} overdue by ${days} day(s). ${level === 1 ? "Send friendly reminder." : level === 2 ? "Send second notice; review credit." : "Final notice; consider credit hold."}`,
      entity_type: "AR_INVOICE",
      entity_id: a.id,
      data: { level, days_overdue: days, outstanding: f22(a.outstanding_amount), customer: a.customer }
    };
  });
  return { summary: { overdue_invoices: alerts.length, overdue_total: total.toFixed(2) }, alerts, resolveScope: "AR_DUNNING:" };
}
async function apDueProposals({ q, orgId, today, config }) {
  const horizon = isoPlusDays(today, Number(config.days_ahead ?? 7));
  const r = await q.query(`SELECT a.id, a.invoice_number, a.due_date, a.outstanding_amount::text, p.name AS supplier
     FROM ap_invoices a JOIN parties p ON p.id = a.party_id
     WHERE a.organization_id = $1 AND a.status IN ('POSTED','PARTIALLY_PAID') AND a.outstanding_amount > 0 AND a.due_date <= $2::date
     ORDER BY a.due_date`, [orgId, horizon]);
  if (r.rows.length === 0)
    return { summary: { bills_due: 0 }, alerts: [], resolveScope: "AP_DUE:" };
  const total = r.rows.reduce((s, a) => s.add(a.outstanding_amount), Money21.zero());
  const overdue = r.rows.filter((a) => toIsoDate(a.due_date) < today).length;
  return {
    summary: { bills_due: r.rows.length, total: total.toFixed(2), overdue },
    alerts: [
      {
        dedupe_key: `AP_DUE:${today}`,
        category: "PAYABLES",
        severity: overdue > 0 ? "WARNING" : "INFO",
        title: `Payment proposal: ${r.rows.length} bill(s) due by ${horizon}`,
        body: `Total ${total.toFixed(2)}${overdue ? `, ${overdue} already overdue` : ""}. Proposal only: payment release stays a manual, approved action (tier A4 is never automated).`,
        data: { horizon, bills: r.rows.map((a) => ({ id: a.id, number: a.invoice_number, supplier: a.supplier, due: toIsoDate(a.due_date), amount: f22(a.outstanding_amount) })) }
      }
    ],
    resolveScope: "AP_DUE:"
  };
}
async function recurringJournals({ q, orgId, today, config }) {
  const maxCatchUp = Math.min(12, Number(config.max_catch_up ?? 3));
  const templates = await q.query(`SELECT * FROM recurring_journal_templates WHERE organization_id = $1 AND status = 'ACTIVE' AND approved_by IS NOT NULL AND next_run_date <= $2::date ORDER BY code FOR UPDATE`, [orgId, today]);
  const alerts = [];
  const posted = [];
  for (const t of templates.rows) {
    let next = toIsoDate(t.next_run_date);
    for (let i = 0; i < maxCatchUp && next <= today; i++) {
      if (t.end_date && next > toIsoDate(t.end_date))
        break;
      if (t.max_amount && new Money21(t.total_amount).gt(t.max_amount)) {
        alerts.push({ dedupe_key: `RECURRING_LIMIT:${t.id}`, category: "FINANCE", severity: "CRITICAL", title: `Recurring journal ${t.code} exceeds its approved limit`, body: "Not posted. Re-approve the template.", entity_type: "RECURRING_JOURNAL", entity_id: t.id });
        break;
      }
      const lines = typeof t.lines === "string" ? JSON.parse(t.lines) : t.lines;
      try {
        const j = await q.transaction(async (tx) => postJournal(tx, auditLogger, outboxService, {
          organizationId: orgId,
          legalEntityId: t.legal_entity_id,
          userId: t.created_by,
          postingDate: next,
          purpose: AccountingPurpose15.RECURRING_JOURNAL,
          description: `${t.name} (${next})`,
          sourceType: "RECURRING_JOURNAL",
          sourceId: t.id,
          sourceKey: `RECURRING:${t.id}:${next}`,
          numberPrefix: "JV-REC",
          lines: lines.map((l) => ({ account_code: l.account_code, debit: l.debit || void 0, credit: l.credit || void 0, description: l.description || t.name })),
          approvedBy: t.approved_by
        }));
        posted.push({ template: t.code, date: next, journal: j?.journalNumber, replayed: j?.replayed });
        const following = addMonthsIso(next, 1, t.day_of_month);
        const ended = t.end_date && following > toIsoDate(t.end_date);
        await q.query(`UPDATE recurring_journal_templates SET next_run_date = $1, last_journal_id = $2, occurrences_posted = occurrences_posted + $3, status = $4 WHERE id = $5`, [following, j?.journalId || t.last_journal_id, j && !j.replayed ? 1 : 0, ended ? "ENDED" : "ACTIVE", t.id]);
        next = following;
        if (ended)
          break;
      } catch (e) {
        alerts.push({
          dedupe_key: `RECURRING_FAIL:${t.id}:${next}`,
          category: "FINANCE",
          severity: "CRITICAL",
          title: `Recurring journal ${t.code} could not post for ${next}`,
          body: String(e?.message || e),
          entity_type: "RECURRING_JOURNAL",
          entity_id: t.id,
          data: { date: next }
        });
        break;
      }
    }
  }
  return { summary: { templates_due: templates.rows.length, posted }, alerts };
}
async function bankAutoMatch({ q, orgId, config }) {
  const tolerance = Math.min(31, Number(config.date_tolerance_days ?? 5));
  const autoApply = config.auto_apply !== false;
  const statements = await q.query(`SELECT * FROM bank_statements WHERE organization_id = $1 AND status <> 'RECONCILED' ORDER BY statement_date`, [orgId]);
  const alerts = [];
  let matchedTotal = 0;
  for (const st of statements.rows) {
    const lines = (await q.query(`SELECT * FROM bank_statement_lines WHERE statement_id = $1 AND is_matched = false ORDER BY line_number`, [st.id])).rows;
    if (lines.length === 0)
      continue;
    const gl = (await bankGlLines(q, orgId, st.bank_account_id, toIsoDate(st.statement_date))).filter((l) => !l.matched_statement_line_id);
    const suggestions = BankReconciliationEngine2.suggestMatches(lines.map((l) => ({ id: l.id, date: toIsoDate(l.transaction_date), amount: l.amount, reference: l.reference || "", description: l.description || "" })), gl.map((g) => ({ id: g.id, date: toIsoDate(g.posting_date), amount: new Money21(g.base_debit).sub(g.base_credit).toFixed(8), text: `${g.journal_number} ${g.journal_description || ""} ${g.description || ""}` })), tolerance);
    if (autoApply) {
      for (const m of suggestions)
        await q.query(`UPDATE bank_statement_lines SET is_matched = true, matched_journal_line_id = $1 WHERE id = $2 AND is_matched = false`, [m.journalLineId, m.statementLineId]);
      if (suggestions.length)
        await q.query(`UPDATE bank_statements SET status = 'RECONCILING', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'UPLOADED'`, [st.id]);
    }
    matchedTotal += suggestions.length;
    const remaining = lines.length - (autoApply ? suggestions.length : 0);
    if (remaining > 0 || !autoApply) {
      alerts.push({
        dedupe_key: `BANK_UNMATCHED:${st.id}`,
        category: "TREASURY",
        severity: "WARNING",
        title: `Bank statement ${toIsoDate(st.statement_date)}: ${remaining} line(s) need review`,
        body: autoApply ? `${suggestions.length} line(s) auto-matched (exact amount, date \xB1${tolerance}d, unique). Review the rest, then sign off.` : `${suggestions.length} match suggestion(s) ready for review.`,
        entity_type: "BANK_STATEMENT",
        entity_id: st.id,
        data: { suggested: suggestions.length, remaining }
      });
    }
  }
  return { summary: { statements: statements.rows.length, matched: matchedTotal, auto_apply: autoApply }, alerts, resolveScope: "BANK_UNMATCHED:" };
}
async function depreciationDue({ q, orgId, today }) {
  const r = await q.query(`SELECT fp.id, fp.period_name, fp.end_date,
       (SELECT COUNT(*)::int FROM fixed_assets fa WHERE fa.organization_id = $1 AND fa.status = 'ACTIVE' AND fa.acquisition_date <= fp.end_date
          AND NOT EXISTS (SELECT 1 FROM asset_depreciation_entries d WHERE d.asset_id = fa.id AND d.period_id = fp.id)) AS pending
     FROM fiscal_periods fp JOIN legal_entities le ON le.id = fp.legal_entity_id
     WHERE le.organization_id = $1 AND fp.end_date < $2::date AND fp.status = 'OPEN'
     ORDER BY fp.end_date DESC LIMIT 3`, [orgId, today]);
  const alerts = r.rows.filter((p) => p.pending > 0).map((p) => ({
    dedupe_key: `DEPRECIATION:${p.id}`,
    category: "ASSETS",
    severity: "WARNING",
    title: `Depreciation not run for ${p.period_name}`,
    body: `${p.pending} active asset(s) have no depreciation entry for the period ending ${toIsoDate(p.end_date)}. Run the depreciation batch before closing.`,
    entity_type: "FISCAL_PERIOD",
    entity_id: p.id,
    data: { pending_assets: p.pending }
  }));
  return { summary: { periods_checked: r.rows.length, periods_pending: alerts.length }, alerts, resolveScope: "DEPRECIATION:" };
}
async function periodCloseReminder({ q, orgId, today, config }) {
  const lead = Number(config.days_before_end ?? 3);
  const r = await q.query(`SELECT fp.id, fp.period_name, fp.start_date, fp.end_date, fp.status FROM fiscal_periods fp JOIN legal_entities le ON le.id = fp.legal_entity_id
     WHERE le.organization_id = $1 AND fp.status = 'OPEN' AND fp.end_date <= $2::date ORDER BY fp.end_date`, [orgId, isoPlusDays(today, lead)]);
  const alerts = r.rows.map((p) => {
    const end = toIsoDate(p.end_date);
    const late = end < today;
    return {
      dedupe_key: `PERIOD_CLOSE:${p.id}`,
      category: "FINANCE",
      severity: late && daysBetween(end, today) > 10 ? "CRITICAL" : late ? "WARNING" : "INFO",
      title: late ? `${p.period_name} ended ${daysBetween(end, today)} day(s) ago and is still open` : `${p.period_name} closes on ${end}`,
      body: "Close checklist: bank reconciliations signed off, depreciation run, accruals and recurring journals posted, stock-to-GL reconciled, then soft-close.",
      entity_type: "FISCAL_PERIOD",
      entity_id: p.id
    };
  });
  return { summary: { periods: alerts.length }, alerts, resolveScope: "PERIOD_CLOSE:" };
}
async function approvalAging({ q, orgId, today, config }) {
  const days = Number(config.max_age_days ?? 2);
  const cutoff = isoPlusDays(today, -days);
  const j = await q.query(`SELECT id, journal_number, created_at FROM journals WHERE organization_id = $1 AND status = 'SUBMITTED' AND created_at::date <= $2::date`, [orgId, cutoff]);
  const po = await q.query(`SELECT id, po_number, created_at FROM purchase_orders WHERE organization_id = $1 AND status = 'DRAFT' AND created_at::date <= $2::date`, [orgId, cutoff]);
  const alerts = [
    ...j.rows.map((r) => ({ dedupe_key: `APPROVAL:JOURNAL:${r.id}`, category: "APPROVALS", severity: "WARNING", title: `Journal ${r.journal_number} awaiting approval > ${days} day(s)`, entity_type: "JOURNAL", entity_id: r.id })),
    ...po.rows.map((r) => ({ dedupe_key: `APPROVAL:PO:${r.id}`, category: "APPROVALS", severity: "INFO", title: `Purchase order ${r.po_number} still in draft > ${days} day(s)`, entity_type: "PURCHASE_ORDER", entity_id: r.id }))
  ];
  return { summary: { journals: j.rows.length, purchase_orders: po.rows.length }, alerts, resolveScope: "APPROVAL:" };
}
async function pmWorkOrders({ q, orgId, today, config }) {
  const lead = Number(config.lead_days ?? 3);
  const due = await q.query(`SELECT s.*, e.legal_entity_id, e.name AS equipment_name FROM pm_schedules s JOIN maintenance_equipment e ON e.id = s.equipment_id
     WHERE s.organization_id = $1 AND s.status = 'ACTIVE' AND s.next_due_date <= $2::date
       AND NOT EXISTS (SELECT 1 FROM maintenance_work_orders w WHERE w.pm_schedule_id = s.id AND w.status NOT IN ('COMPLETED','CANCELLED'))
     ORDER BY s.next_due_date FOR UPDATE OF s`, [orgId, isoPlusDays(today, lead)]);
  const created = [];
  const alerts = [];
  for (const s of due.rows) {
    const id = crypto17.randomUUID();
    const number = await nextDocumentNumber(q, orgId, "PM-WO", today, 5);
    await q.query(`INSERT INTO maintenance_work_orders (id, organization_id, legal_entity_id, work_order_number, equipment_id, pm_schedule_id, order_type, priority, status, description, start_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'PREVENTIVE','MEDIUM','SCHEDULED',$7,$8,NULL)`, [id, orgId, s.legal_entity_id, number, s.equipment_id, s.id, `Preventive maintenance: ${s.schedule_name} (auto-generated, due ${toIsoDate(s.next_due_date)})`, toIsoDate(s.next_due_date)]);
    created.push({ work_order: number, schedule: s.schedule_name, due: toIsoDate(s.next_due_date) });
    alerts.push({
      dedupe_key: `PM_WO:${s.id}:${toIsoDate(s.next_due_date)}`,
      category: "MAINTENANCE",
      severity: toIsoDate(s.next_due_date) < today ? "WARNING" : "INFO",
      title: `Work order ${number} scheduled: ${s.schedule_name}`,
      body: `${s.equipment_name}, due ${toIsoDate(s.next_due_date)}.`,
      entity_type: "MAINT_WORK_ORDER",
      entity_id: id
    });
  }
  return { summary: { schedules_due: due.rows.length, created }, alerts };
}
async function posShiftMonitor({ q, orgId, now, config }) {
  const maxHours = Number(config.max_shift_hours ?? 14);
  const open = await q.query(`SELECT s.id, s.cashier_name, s.opened_at, r.register_code FROM pos_sessions s JOIN pos_registers r ON r.id = s.register_id
     WHERE s.organization_id = $1 AND s.status = 'OPEN' AND s.opened_at < $2`, [orgId, new Date(now.getTime() - maxHours * 36e5).toISOString()]);
  const variance2 = await q.query(`SELECT s.id, s.cashier_name, s.cash_difference::text, s.z_number, r.register_code FROM pos_sessions s JOIN pos_registers r ON r.id = s.register_id
     WHERE s.organization_id = $1 AND s.status = 'CLOSED' AND s.cash_difference <> 0 AND s.closed_at > $2`, [orgId, new Date(now.getTime() - 7 * 864e5).toISOString()]);
  const alerts = [
    ...open.rows.map((s) => ({ dedupe_key: `POS_OPEN:${s.id}`, category: "POS", severity: "WARNING", title: `${s.register_code}: shift open more than ${maxHours}h (${s.cashier_name})`, body: "Close the shift with a blind count so cash is accounted for.", entity_type: "POS_SESSION", entity_id: s.id })),
    ...variance2.rows.map((s) => ({
      dedupe_key: `POS_VARIANCE:${s.id}`,
      category: "POS",
      severity: new Money21(s.cash_difference).abs().gt(String(config.material_variance ?? "500")) ? "CRITICAL" : "INFO",
      title: `${s.register_code} Z#${s.z_number}: cash ${new Money21(s.cash_difference).isNegative() ? "short" : "over"} ${new Money21(s.cash_difference).abs().toFixed(2)}`,
      body: `Cashier ${s.cashier_name}. Review the variance notes and audit trail.`,
      entity_type: "POS_SESSION",
      entity_id: s.id
    }))
  ];
  return { summary: { long_open_shifts: open.rows.length, variances_7d: variance2.rows.length }, alerts, resolveScope: "POS_OPEN:" };
}
async function serviceSlaPm({ q, orgId, today, now, config }) {
  const { generatePreventive: generatePreventive2 } = await Promise.resolve().then(() => (init_service(), service_exports));
  const le = (await q.query(`SELECT id FROM legal_entities WHERE organization_id = $1 ORDER BY created_at LIMIT 1`, [orgId])).rows[0]?.id;
  const pm = le ? await generatePreventive2(q, orgId, le, null, today) : { created: [], skipped_duplicates: 0 };
  const riskMin = Number(config.at_risk_minutes ?? 60);
  const open = await q.query(`SELECT c.id, c.number, c.title, c.priority, c.resolution_due_at + (c.paused_minutes || ' minutes')::interval AS due, p.name AS party
     FROM srv_cases c JOIN parties p ON p.id = c.party_id
     WHERE c.organization_id = $1 AND c.status NOT IN ('RESOLVED','CLOSED','CANCELLED','ON_HOLD') AND c.resolution_due_at IS NOT NULL
       AND c.resolution_due_at + (c.paused_minutes || ' minutes')::interval < $2`, [orgId, new Date(now.getTime() + riskMin * 6e4).toISOString()]);
  const alerts = open.rows.map((c) => {
    const breached = new Date(c.due) <= now;
    return {
      dedupe_key: `SRV_SLA:${c.id}:${breached ? "BREACH" : "RISK"}`,
      category: "SERVICE",
      severity: breached ? "CRITICAL" : "WARNING",
      title: `${c.number} ${breached ? "breached" : "at risk of breaching"} its resolution SLA (${c.priority})`,
      body: `${c.party}: ${c.title}. Due ${new Date(c.due).toISOString()}.`,
      entity_type: "SERVICE_CASE",
      entity_id: c.id
    };
  });
  for (const n of pm.created)
    alerts.push({ dedupe_key: `SRV_PM:${n}`, category: "SERVICE", severity: "INFO", title: `Preventive case ${n} created`, entity_type: "SERVICE_CASE" });
  return { summary: { pm_cases_created: pm.created, pm_duplicates_skipped: pm.skipped_duplicates, sla_alerts: open.rows.length }, alerts, resolveScope: "SRV_SLA:" };
}
async function subscriptionBilling({ q, orgId, today, config, rule }) {
  const due = (await q.query(`SELECT id, number, legal_entity_id, created_by FROM com_subscriptions WHERE organization_id = $1 AND status = 'ACTIVE' AND next_bill_date IS NOT NULL AND next_bill_date <= $2::date ORDER BY number`, [orgId, today])).rows;
  const alerts = [];
  let invoices = 0;
  const billed = [];
  for (const s of due) {
    try {
      const r = await q.transaction((tx) => billSubscription({ req: { correlationId: crypto17.randomUUID() }, tx, org: orgId, le: s.legal_entity_id, user: s.created_by }, s.id, today, Math.min(12, Number(config.max_periods ?? 3))));
      invoices += r.invoices?.length || 0;
      billed.push({ subscription: s.number, invoices: r.invoices, next_bill_date: r.next_bill_date, ended: r.ended });
    } catch (e) {
      alerts.push({ dedupe_key: `COM_BILLING_FAIL:${s.id}`, category: "FINANCE", severity: "CRITICAL", title: `Subscription ${s.number} could not be billed`, body: String(e?.message || e), entity_type: "SUBSCRIPTION", entity_id: s.id });
    }
  }
  let revenue = null;
  const le = (await q.query(`SELECT legal_entity_id, created_by FROM com_subscriptions WHERE organization_id = $1 ORDER BY created_at LIMIT 1`, [orgId])).rows[0];
  if (le) {
    try {
      revenue = await q.transaction((tx) => recognizeRevenue({ req: { correlationId: crypto17.randomUUID() }, tx, org: orgId, le: le.legal_entity_id, user: le.created_by }, today));
    } catch (e) {
      alerts.push({ dedupe_key: "COM_BILLING_FAIL:REVENUE", category: "FINANCE", severity: "CRITICAL", title: "Deferred subscription revenue could not be recognised", body: String(e?.message || e), entity_type: "SUBSCRIPTION", entity_id: null });
    }
  }
  return { summary: { due: due.length, invoices, billed, revenue, rule: rule?.code }, alerts, resolveScope: "COM_BILLING_FAIL:" };
}
async function loanLateFees({ q, orgId, today }) {
  const owner = (await q.query(`SELECT legal_entity_id, created_by FROM lnd_loans WHERE organization_id = $1 ORDER BY created_at LIMIT 1`, [orgId])).rows[0];
  if (!owner)
    return { summary: { assessed: 0, reason: "no loans" }, alerts: [], resolveScope: "LND_LATE:" };
  const lctx = (tx) => ({ req: { correlationId: crypto17.randomUUID() }, tx, org: orgId, le: owner.legal_entity_id, user: owner.created_by });
  const accrual = await q.transaction((tx) => accrueInterest(lctx(tx), today));
  const r = { ...await q.transaction((tx) => assessLateFees(lctx(tx), today)), interest_accrual: accrual };
  const alerts = r.assessed ? [{ dedupe_key: `LND_LATE:${today}`, category: "FINANCE", severity: "WARNING", title: `${r.assessed} overdue loan instalment(s) charged a late fee`, body: `${r.instalments.join(", ")} \u2014 total ${r.fees}.`, entity_type: "LOAN", entity_id: null }] : [];
  return { summary: r, alerts, resolveScope: "LND_LATE:" };
}
var JOB_HANDLERS = {
  REORDER_ALERTS: reorderAlerts,
  STOCK_GL_RECON: stockGlRecon,
  AR_DUNNING: arDunning,
  AP_DUE_PROPOSALS: apDueProposals,
  RECURRING_JOURNALS: recurringJournals,
  BANK_AUTO_MATCH: bankAutoMatch,
  DEPRECIATION_DUE: depreciationDue,
  PERIOD_CLOSE_REMINDER: periodCloseReminder,
  APPROVAL_AGING: approvalAging,
  PM_WORK_ORDERS: pmWorkOrders,
  POS_SHIFT_MONITOR: posShiftMonitor,
  SERVICE_SLA_PM: serviceSlaPm,
  SUBSCRIPTION_BILLING: subscriptionBilling,
  LOAN_LATE_FEES: loanLateFees
};
var DEFAULT_RULES = [
  { code: "INV-REORDER", name: "Reorder point alerts", job_type: "REORDER_ALERTS", tier: "A0", schedule_kind: "INTERVAL", interval_minutes: 60, owner_role: "STORE_MANAGER", description: "Flags stocked items at or below their reorder point with a proposed order quantity." },
  { code: "INV-STOCK-GL", name: "Stock ledger vs GL reconciliation", job_type: "STOCK_GL_RECON", tier: "A0", schedule_kind: "DAILY", run_at_local: "05:30", owner_role: "CONTROLLER", description: "Compares perpetual stock valuation with inventory GL balances.", config: { tolerance: "1.00" } },
  { code: "AR-DUNNING", name: "AR overdue dunning", job_type: "AR_DUNNING", tier: "A0", schedule_kind: "DAILY", run_at_local: "08:00", owner_role: "ACCOUNTANT", description: "Levels overdue customer invoices (1\u201330, 31\u201360, 60+ days) for reminders." },
  { code: "AP-DUE", name: "AP payment proposal", job_type: "AP_DUE_PROPOSALS", tier: "A0", schedule_kind: "DAILY", run_at_local: "08:30", owner_role: "ACCOUNTANT", description: "Lists supplier bills due within the horizon. Never releases payments.", config: { days_ahead: 7 } },
  { code: "GL-RECURRING", name: "Recurring journals", job_type: "RECURRING_JOURNALS", tier: "A3", schedule_kind: "DAILY", run_at_local: "02:00", owner_role: "CONTROLLER", description: "Posts approved recurring journal templates on their due date (idempotent per occurrence).", config: { max_catch_up: 3 } },
  { code: "BANK-AUTOMATCH", name: "Bank statement auto-match", job_type: "BANK_AUTO_MATCH", tier: "A2", schedule_kind: "INTERVAL", interval_minutes: 120, owner_role: "ACCOUNTANT", description: "Matches statement lines to GL cash lines (exact amount, date tolerance, unique). Sign-off remains manual.", config: { date_tolerance_days: 5, auto_apply: true } },
  { code: "FA-DEPRECIATION", name: "Depreciation due check", job_type: "DEPRECIATION_DUE", tier: "A0", schedule_kind: "DAILY", run_at_local: "07:00", owner_role: "CONTROLLER", description: "Warns when ended open periods lack depreciation entries." },
  { code: "GL-CLOSE", name: "Period close reminders", job_type: "PERIOD_CLOSE_REMINDER", tier: "A0", schedule_kind: "DAILY", run_at_local: "09:00", owner_role: "CONTROLLER", description: "Reminds before period end and escalates periods left open.", config: { days_before_end: 3 } },
  { code: "WF-APPROVAL-AGING", name: "Approval queue aging", job_type: "APPROVAL_AGING", tier: "A0", schedule_kind: "DAILY", run_at_local: "09:30", owner_role: "CONTROLLER", description: "Escalates journals and purchase orders waiting too long.", config: { max_age_days: 2 } },
  { code: "PM-WORKORDERS", name: "Preventive maintenance work orders", job_type: "PM_WORK_ORDERS", tier: "A2", schedule_kind: "DAILY", run_at_local: "06:00", owner_role: "ADMIN", description: "Creates scheduled work orders for PM plans falling due.", config: { lead_days: 3 } },
  { code: "POS-MONITOR", name: "POS shift monitor", job_type: "POS_SHIFT_MONITOR", tier: "A0", schedule_kind: "INTERVAL", interval_minutes: 30, owner_role: "STORE_MANAGER", description: "Flags shifts left open too long and recent cash variances.", config: { max_shift_hours: 14, material_variance: "500" } },
  { code: "SRV-SLA-PM", name: "Service SLA escalation & preventive visits", job_type: "SERVICE_SLA_PM", tier: "A2", schedule_kind: "INTERVAL", interval_minutes: 15, owner_role: "SERVICE_MANAGER", description: "Escalates service cases at risk of / past their SLA and opens preventive-maintenance cases for contracts falling due (one per occurrence).", config: { at_risk_minutes: 60 } },
  { code: "COM-BILLING", name: "Subscription / AMC billing", job_type: "SUBSCRIPTION_BILLING", tier: "A3", schedule_kind: "DAILY", run_at_local: "03:00", owner_role: "ACCOUNTANT", description: "Invoices active subscriptions on their bill date (in advance, one invoice per period, period-guarded). Failures alert the owner.", config: { max_periods: 3 } },
  { code: "LND-LATE-FEES", name: "Loan late fees & interest accrual", job_type: "LOAN_LATE_FEES", tier: "A3", schedule_kind: "DAILY", run_at_local: "04:00", owner_role: "ACCOUNTANT", description: "Charges the flat late fee (lnd.late_fee_flat) once per instalment unpaid past lnd.grace_days. Fees are collected first and credited to fee income on receipt. With lnd.interest_basis = ACCRUAL it first accrues interest falling due (DR 112005 / CR 411006)." }
];

// apps/api/dist/automation/engine.js
var MAX_RULES_PER_TICK = 25;
var LEASE_MS = 5 * 6e4;
async function ensureDefaultRules(q, orgId, now = /* @__PURE__ */ new Date()) {
  for (const r of DEFAULT_RULES) {
    const spec = { schedule_kind: r.schedule_kind, interval_minutes: r.interval_minutes ?? null, run_at_local: r.run_at_local ?? "06:00", timezone: "Asia/Karachi" };
    await q.query(`INSERT INTO automation_rules (organization_id, code, name, description, job_type, tier, schedule_kind, interval_minutes, run_at_local, config, owner_role, next_run_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (organization_id, code) DO NOTHING`, [orgId, r.code, r.name, r.description, r.job_type, r.tier, r.schedule_kind, r.interval_minutes ?? null, spec.run_at_local, JSON.stringify(r.config || {}), r.owner_role, nextRun(spec, now).toISOString()]);
  }
}
async function upsertAlerts(q, orgId, ruleId, runId, ownerRole, alerts, resolveScope) {
  let opened = 0;
  let refreshed = 0;
  for (const a of alerts) {
    const existing = await q.query(`SELECT id FROM automation_alerts WHERE organization_id = $1 AND dedupe_key = $2 AND status <> 'RESOLVED' FOR UPDATE`, [orgId, a.dedupe_key]);
    if (existing.rows.length) {
      await q.query(`UPDATE automation_alerts SET occurrences = occurrences + 1, last_seen_at = NOW(), run_id = $2, severity = $3, title = $4, body = $5, data = $6 WHERE id = $1`, [existing.rows[0].id, runId, a.severity, a.title, a.body ?? null, a.data ? JSON.stringify(a.data) : null]);
      refreshed++;
    } else {
      await q.query(`INSERT INTO automation_alerts (organization_id, rule_id, run_id, category, severity, title, body, entity_type, entity_id, dedupe_key, data, assigned_role)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [orgId, ruleId, runId, a.category, a.severity, a.title, a.body ?? null, a.entity_type ?? null, a.entity_id ?? null, a.dedupe_key, a.data ? JSON.stringify(a.data) : null, ownerRole]);
      opened++;
    }
  }
  let resolved = 0;
  if (resolveScope) {
    const keys = alerts.map((a) => a.dedupe_key);
    const r = await q.query(`UPDATE automation_alerts SET status = 'RESOLVED', resolved_at = NOW(), body = COALESCE(body,'') || ' [auto-resolved: condition cleared]'
       WHERE organization_id = $1 AND status <> 'RESOLVED' AND dedupe_key LIKE $2 AND NOT (dedupe_key = ANY($3::text[])) RETURNING id`, [orgId, `${resolveScope}%`, keys]);
    resolved = r.rows.length;
  }
  return { opened, refreshed, resolved };
}
async function runRule(db2, rule, opts) {
  const now = opts.now || /* @__PURE__ */ new Date();
  const spec = { schedule_kind: rule.schedule_kind, interval_minutes: rule.interval_minutes, run_at_local: String(rule.run_at_local || "06:00"), day_of_month: rule.day_of_month, timezone: rule.timezone };
  const key = opts.occurrence || occurrenceKey(spec, now);
  const handler2 = JOB_HANDLERS[rule.job_type];
  const claim = await db2.transaction(async (tx) => {
    const ins = await tx.query(`INSERT INTO automation_runs (organization_id, rule_id, rule_version, occurrence_key, trigger, triggered_by, status, lease_until)
       VALUES ($1,$2,$3,$4,$5,$6,'RUNNING',$7) ON CONFLICT (rule_id, occurrence_key) DO NOTHING RETURNING id, attempts`, [rule.organization_id, rule.id, rule.version, key, opts.trigger, opts.userId ?? null, new Date(now.getTime() + LEASE_MS).toISOString()]);
    if (ins.rows.length)
      return { id: ins.rows[0].id, attempts: 1 };
    const ex = (await tx.query(`SELECT * FROM automation_runs WHERE rule_id = $1 AND occurrence_key = $2 FOR UPDATE`, [rule.id, key])).rows[0];
    if (ex.status === "SUCCEEDED" || ex.status === "DEAD")
      return { dup: true, id: ex.id };
    if (ex.status === "RUNNING" && new Date(ex.lease_until).getTime() > now.getTime())
      return { running: true, id: ex.id };
    const up = await tx.query(`UPDATE automation_runs SET status = 'RUNNING', attempts = attempts + 1, lease_until = $2, error = NULL, started_at = NOW() WHERE id = $1 RETURNING attempts`, [
      ex.id,
      new Date(now.getTime() + LEASE_MS).toISOString()
    ]);
    return { id: ex.id, attempts: up.rows[0].attempts };
  });
  if ("dup" in claim)
    return { run_id: claim.id, status: "SKIPPED_DUPLICATE" };
  if ("running" in claim)
    return { run_id: claim.id, status: "SKIPPED_RUNNING" };
  try {
    if (!handler2)
      throw new Error(`No handler for job type ${rule.job_type}`);
    const config = typeof rule.config === "string" ? JSON.parse(rule.config) : rule.config || {};
    const result = await db2.transaction(async (tx) => {
      const r = await handler2({ q: tx, orgId: rule.organization_id, rule, config, today: localDate(now, rule.timezone || "Asia/Karachi"), now });
      const alerts = await upsertAlerts(tx, rule.organization_id, rule.id, claim.id, rule.owner_role, r.alerts, r.resolveScope);
      const summary = { ...r.summary, alerts };
      await tx.query(`UPDATE automation_runs SET status = 'SUCCEEDED', finished_at = NOW(), lease_until = NULL, summary = $2 WHERE id = $1`, [claim.id, JSON.stringify(summary)]);
      await tx.query(`UPDATE automation_rules SET last_run_at = NOW(), last_status = 'SUCCEEDED' WHERE id = $1`, [rule.id]);
      await auditLogger.record({ organization_id: rule.organization_id, user_id: opts.userId ?? null, action: "AUTOMATION_RUN_SUCCEEDED", entity_type: "AUTOMATION_RULE", entity_id: rule.id, after_state: { run_id: claim.id, occurrence: key, trigger: opts.trigger, summary } }, tx);
      return summary;
    });
    return { run_id: claim.id, status: "SUCCEEDED", summary: result };
  } catch (e) {
    const msg = String(e?.message || e).slice(0, 2e3);
    const dead = claim.attempts >= (rule.max_attempts || 3);
    await db2.transaction(async (tx) => {
      await tx.query(`UPDATE automation_runs SET status = $2, finished_at = NOW(), lease_until = NULL, error = $3 WHERE id = $1`, [claim.id, dead ? "DEAD" : "FAILED", msg]);
      if (opts.trigger === "SCHEDULE") {
        await tx.query(`UPDATE automation_rules SET last_run_at = NOW(), last_status = $2, next_run_at = $3, pending_occurrence = $4 WHERE id = $1`, [
          rule.id,
          dead ? "DEAD" : "FAILED",
          dead ? nextRun(spec, now).toISOString() : new Date(now.getTime() + backoffMs(claim.attempts)).toISOString(),
          dead ? null : key
        ]);
      } else {
        await tx.query(`UPDATE automation_rules SET last_run_at = NOW(), last_status = $2 WHERE id = $1`, [rule.id, dead ? "DEAD" : "FAILED"]);
      }
      if (dead) {
        await upsertAlerts(tx, rule.organization_id, rule.id, claim.id, rule.owner_role, [
          { dedupe_key: `AUTOMATION_DEAD:${rule.id}:${key}`, category: "AUTOMATION", severity: "CRITICAL", title: `Automation \u201C${rule.name}\u201D failed ${claim.attempts} time(s)`, body: `Dead-lettered occurrence ${key}: ${msg}. Fix the cause, then run it manually.`, entity_type: "AUTOMATION_RULE", entity_id: rule.id }
        ]);
      }
    });
    return { run_id: claim.id, status: dead ? "DEAD" : "FAILED", error: msg };
  }
}
async function tick(db2, now = /* @__PURE__ */ new Date(), orgId) {
  const params = [now.toISOString()];
  let where = `is_active = true AND paused = false AND next_run_at IS NOT NULL AND next_run_at <= $1`;
  if (orgId) {
    params.push(orgId);
    where += ` AND organization_id = $2`;
  }
  const due = await db2.query(`SELECT * FROM automation_rules WHERE ${where} ORDER BY next_run_at LIMIT ${MAX_RULES_PER_TICK}`, params);
  const out = [];
  for (const rule of due.rows) {
    const spec = { schedule_kind: rule.schedule_kind, interval_minutes: rule.interval_minutes, run_at_local: String(rule.run_at_local || "06:00"), day_of_month: rule.day_of_month, timezone: rule.timezone };
    const slot = new Date(rule.next_run_at);
    const occurrence = rule.pending_occurrence || occurrenceKey(spec, slot);
    const outcome = await runRule(db2, rule, { trigger: "SCHEDULE", now, occurrence });
    if (outcome.status === "SUCCEEDED" || outcome.status === "SKIPPED_DUPLICATE") {
      await db2.query(`UPDATE automation_rules SET next_run_at = $2, pending_occurrence = NULL WHERE id = $1`, [rule.id, nextRun(spec, now).toISOString()]);
    }
    out.push({ rule: rule.code, outcome });
  }
  return out;
}

// apps/api/dist/routes/automation.js
var TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
function specOf(r) {
  return { schedule_kind: r.schedule_kind, interval_minutes: r.interval_minutes, run_at_local: String(r.run_at_local || "06:00").slice(0, 5), day_of_month: r.day_of_month, timezone: r.timezone || "Asia/Karachi" };
}
async function validateTemplateLines(orgId, raw) {
  const lines = arrayOf(raw, "lines", { min: 2, max: 50 }).map((l, i) => {
    const debit = decimal(l?.debit == null || l.debit === "" ? "0" : String(l.debit), `lines[${i}].debit`, { sign: "nonNegative", scale: 2 });
    const credit = decimal(l?.credit == null || l.credit === "" ? "0" : String(l.credit), `lines[${i}].credit`, { sign: "nonNegative", scale: 2 });
    if (Money22.from(debit).isZero() === Money22.from(credit).isZero())
      throw validationError(`Line ${i + 1} must have exactly one of debit or credit`);
    return { account_code: str(l?.account_code, `lines[${i}].account_code`, { max: 32 }), debit, credit, description: optionalStr(l?.description, `lines[${i}].description`, 200) || void 0 };
  });
  const dr = lines.reduce((s, l) => s.add(l.debit), Money22.zero());
  const cr = lines.reduce((s, l) => s.add(l.credit), Money22.zero());
  if (!dr.equals(cr))
    throw validationError(`Template is unbalanced: debits ${dr.toFixed(2)} \u2260 credits ${cr.toFixed(2)}`);
  const codes = [...new Set(lines.map((l) => l.account_code))];
  const acc = await db.query(`SELECT a.code FROM accounts a WHERE a.organization_id = $1 AND a.code = ANY($2::text[]) AND a.is_active AND a.posting_allowed
       AND NOT EXISTS (SELECT 1 FROM accounts c WHERE c.parent_id = a.id)`, [orgId, codes]);
  const found = new Set(acc.rows.map((r) => r.code));
  const missing = codes.filter((c) => !found.has(c));
  if (missing.length)
    throw validationError(`Accounts must be active posting (leaf) accounts: ${missing.join(", ")}`);
  return { lines, total: dr.toFixed(2) };
}
function registerAutomationRoutes(app) {
  const view = requirePermission(Permission21.AUTOMATION_VIEW);
  const manage = requirePermission(Permission21.AUTOMATION_MANAGE);
  const run = requirePermission(Permission21.AUTOMATION_RUN);
  const recurringRead = requireAnyPermission(Permission21.AUTOMATION_VIEW, Permission21.FINANCE_JOURNAL_CREATE, Permission21.FINANCE_JOURNAL_APPROVE);
  app.get("/api/automation/rules", authenticate, view, async (req, res) => {
    const org = req.session.organization_id;
    const r = await db.query(`SELECT r.*, (SELECT COUNT(*) FROM automation_alerts a WHERE a.rule_id = r.id AND a.status <> 'RESOLVED')::int AS open_alerts
         FROM automation_rules r WHERE r.organization_id = $1 ORDER BY r.code`, [org]);
    return ok(req, res, r.rows, 200, { total_count: r.rows.length });
  });
  app.post("/api/automation/rules/install-defaults", authenticate, manage, async (req, res) => {
    await ensureDefaultRules(db, req.session.organization_id);
    const r = await db.query(`SELECT COUNT(*)::int AS n FROM automation_rules WHERE organization_id = $1`, [req.session.organization_id]);
    return ok(req, res, { rules: r.rows[0].n });
  });
  app.post("/api/automation/rules/:id", authenticate, manage, async (req, res) => {
    const org = req.session.organization_id;
    const out = await db.transaction(async (tx) => {
      const before = await requireOrgRow(tx, "automation_rules", req.params.id, org, "Automation rule", { forUpdate: true });
      if (req.body?.version != null && Number(req.body.version) !== Number(before.version))
        throw invalidState("Rule was changed by someone else; reload and retry", { current_version: before.version });
      const next = { ...before };
      if (req.body?.schedule_kind !== void 0)
        next.schedule_kind = oneOf(req.body.schedule_kind, "schedule_kind", ["INTERVAL", "DAILY", "MONTHLY"]);
      if (req.body?.interval_minutes !== void 0)
        next.interval_minutes = int(req.body.interval_minutes, "interval_minutes", { min: 5, max: 10080 });
      if (req.body?.run_at_local !== void 0) {
        const t = str(req.body.run_at_local, "run_at_local", { max: 5 });
        if (!TIME_RE.test(t))
          throw validationError("run_at_local must be HH:MM (24h)");
        next.run_at_local = t;
      }
      if (req.body?.day_of_month !== void 0)
        next.day_of_month = req.body.day_of_month === null ? null : int(req.body.day_of_month, "day_of_month", { min: 1, max: 28 });
      if (req.body?.max_attempts !== void 0)
        next.max_attempts = int(req.body.max_attempts, "max_attempts", { min: 1, max: 10 });
      if (req.body?.is_active !== void 0)
        next.is_active = bool(req.body.is_active);
      if (req.body?.config !== void 0) {
        if (typeof req.body.config !== "object" || req.body.config === null || Array.isArray(req.body.config))
          throw validationError("config must be an object");
        if (JSON.stringify(req.body.config).length > 8e3)
          throw validationError("config too large");
        next.config = req.body.config;
      }
      if (next.schedule_kind === "INTERVAL" && !next.interval_minutes)
        throw validationError("interval_minutes is required for INTERVAL schedules");
      if (next.schedule_kind === "MONTHLY" && !next.day_of_month)
        next.day_of_month = 1;
      const nextAt = nextRun(specOf(next), /* @__PURE__ */ new Date()).toISOString();
      const r = await tx.query(`UPDATE automation_rules SET schedule_kind=$2, interval_minutes=$3, run_at_local=$4, day_of_month=$5, max_attempts=$6, is_active=$7, config=$8,
            next_run_at=$9, version = version + 1, updated_by=$10, updated_at=NOW() WHERE id=$1 RETURNING *`, [before.id, next.schedule_kind, next.interval_minutes, next.run_at_local, next.day_of_month, next.max_attempts, next.is_active, JSON.stringify(typeof next.config === "string" ? JSON.parse(next.config) : next.config || {}), nextAt, req.session.user_id]);
      await auditLogger.record({ organization_id: org, user_id: req.session.user_id, action: "AUTOMATION_RULE_UPDATED", entity_type: "AUTOMATION_RULE", entity_id: before.id, before_state: { version: before.version, schedule_kind: before.schedule_kind, interval_minutes: before.interval_minutes, run_at_local: before.run_at_local, config: before.config, is_active: before.is_active }, after_state: { version: r.rows[0].version, schedule_kind: next.schedule_kind, interval_minutes: next.interval_minutes, run_at_local: next.run_at_local, config: next.config, is_active: next.is_active }, correlation_id: req.correlationId }, tx);
      return r.rows[0];
    });
    return ok(req, res, out);
  });
  for (const action of ["pause", "resume"]) {
    app.post(`/api/automation/rules/:id/${action}`, authenticate, manage, async (req, res) => {
      const org = req.session.organization_id;
      const reason = optionalStr(req.body?.reason, "reason", 500);
      const out = await db.transaction(async (tx) => {
        const rule = await requireOrgRow(tx, "automation_rules", req.params.id, org, "Automation rule", { forUpdate: true });
        const paused = action === "pause";
        const nextAt = paused ? rule.next_run_at : nextRun(specOf(rule), /* @__PURE__ */ new Date()).toISOString();
        const r = await tx.query(`UPDATE automation_rules SET paused=$2, next_run_at=$3, version=version+1, updated_by=$4, updated_at=NOW() WHERE id=$1 RETURNING *`, [rule.id, paused, nextAt, req.session.user_id]);
        await auditLogger.record({ organization_id: org, user_id: req.session.user_id, action: paused ? "AUTOMATION_RULE_PAUSED" : "AUTOMATION_RULE_RESUMED", entity_type: "AUTOMATION_RULE", entity_id: rule.id, after_state: { reason }, correlation_id: req.correlationId }, tx);
        return r.rows[0];
      });
      return ok(req, res, out);
    });
  }
  app.post("/api/automation/rules/:id/run", authenticate, run, async (req, res) => {
    const org = req.session.organization_id;
    const rule = await requireOrgRow(db, "automation_rules", req.params.id, org, "Automation rule");
    if (!rule.is_active)
      throw invalidState("Rule is disabled");
    const outcome = await runRule(db, rule, { trigger: "MANUAL", userId: req.session.user_id, occurrence: `MANUAL:${crypto18.randomUUID()}` });
    return ok(req, res, outcome, outcome.status === "SUCCEEDED" ? 200 : 207);
  });
  app.post("/api/automation/tick", authenticate, run, async (req, res) => {
    await ensureDefaultRules(db, req.session.organization_id);
    const results = await tick(db, /* @__PURE__ */ new Date(), req.session.organization_id);
    return ok(req, res, results);
  });
  app.get("/api/automation/runs", authenticate, view, async (req, res) => {
    const org = req.session.organization_id;
    const params = [org];
    let where = "ar.organization_id = $1";
    if (typeof req.query.rule_id === "string" && req.query.rule_id) {
      params.push(uuid(req.query.rule_id, "rule_id"));
      where += ` AND ar.rule_id = $${params.length}`;
    }
    if (typeof req.query.status === "string" && req.query.status) {
      params.push(oneOf(req.query.status, "status", ["RUNNING", "SUCCEEDED", "FAILED", "DEAD"]));
      where += ` AND ar.status = $${params.length}`;
    }
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const r = await db.query(`SELECT ar.*, r.code AS rule_code, r.name AS rule_name FROM automation_runs ar JOIN automation_rules r ON r.id = ar.rule_id
        WHERE ${where} ORDER BY ar.started_at DESC LIMIT ${limit}`, params);
    return ok(req, res, r.rows, 200, { total_count: r.rows.length });
  });
  app.get("/api/automation/alerts", authenticate, view, async (req, res) => {
    const org = req.session.organization_id;
    const params = [org];
    let where = "a.organization_id = $1";
    const status = typeof req.query.status === "string" && req.query.status ? req.query.status : "ACTIVE";
    if (status === "ACTIVE")
      where += ` AND a.status <> 'RESOLVED'`;
    else if (status !== "ALL") {
      params.push(oneOf(status, "status", ["OPEN", "ACKNOWLEDGED", "RESOLVED"]));
      where += ` AND a.status = $${params.length}`;
    }
    if (typeof req.query.category === "string" && req.query.category) {
      params.push(str(req.query.category, "category", { max: 40 }));
      where += ` AND a.category = $${params.length}`;
    }
    const r = await db.query(`SELECT a.*, r.code AS rule_code FROM automation_alerts a LEFT JOIN automation_rules r ON r.id = a.rule_id WHERE ${where}
        ORDER BY CASE a.severity WHEN 'CRITICAL' THEN 0 WHEN 'WARNING' THEN 1 ELSE 2 END, a.last_seen_at DESC LIMIT 500`, params);
    const counts = await db.query(`SELECT severity, COUNT(*)::int AS n FROM automation_alerts WHERE organization_id = $1 AND status <> 'RESOLVED' GROUP BY severity`, [org]);
    return ok(req, res, r.rows, 200, { total_count: r.rows.length, open_by_severity: Object.fromEntries(counts.rows.map((c) => [c.severity, c.n])) });
  });
  for (const action of ["acknowledge", "resolve"]) {
    app.post(`/api/automation/alerts/:id/${action}`, authenticate, view, async (req, res) => {
      const org = req.session.organization_id;
      const note = optionalStr(req.body?.note, "note", 1e3);
      const out = await db.transaction(async (tx) => {
        const a = await requireOrgRow(tx, "automation_alerts", req.params.id, org, "Alert", { forUpdate: true });
        if (a.status === "RESOLVED")
          throw invalidState("Alert is already resolved");
        if (action === "acknowledge" && a.status === "ACKNOWLEDGED")
          return a;
        const r = action === "acknowledge" ? await tx.query(`UPDATE automation_alerts SET status='ACKNOWLEDGED', acknowledged_by=$2, acknowledged_at=NOW() WHERE id=$1 RETURNING *`, [a.id, req.session.user_id]) : await tx.query(`UPDATE automation_alerts SET status='RESOLVED', resolved_by=$2, resolved_at=NOW() WHERE id=$1 RETURNING *`, [a.id, req.session.user_id]);
        await auditLogger.record({ organization_id: org, user_id: req.session.user_id, action: action === "acknowledge" ? "ALERT_ACKNOWLEDGED" : "ALERT_RESOLVED", entity_type: "AUTOMATION_ALERT", entity_id: a.id, before_state: { status: a.status }, after_state: { status: r.rows[0].status, note }, correlation_id: req.correlationId }, tx);
        return r.rows[0];
      });
      return ok(req, res, out);
    });
  }
  app.get("/api/automation/recurring-journals", authenticate, recurringRead, async (req, res) => {
    const r = await db.query(`SELECT t.*, cu.name AS created_by_name, au.name AS approved_by_name, j.journal_number AS last_journal_number
         FROM recurring_journal_templates t LEFT JOIN users cu ON cu.id = t.created_by LEFT JOIN users au ON au.id = t.approved_by
         LEFT JOIN journals j ON j.id = t.last_journal_id WHERE t.organization_id = $1 ORDER BY t.code`, [req.session.organization_id]);
    return ok(req, res, r.rows, 200, { total_count: r.rows.length });
  });
  app.post("/api/automation/recurring-journals", authenticate, requirePermission(Permission21.FINANCE_JOURNAL_CREATE), async (req, res) => {
    const org = req.session.organization_id;
    const code = str(req.body?.code, "code", { max: 64 }).toUpperCase();
    const name = str(req.body?.name, "name", { max: 255 });
    const description = optionalStr(req.body?.description, "description", 2e3);
    const day = int(req.body?.day_of_month, "day_of_month", { min: 1, max: 28 });
    const start = dateOnly(req.body?.start_date, "start_date");
    const end = optionalDate(req.body?.end_date, "end_date");
    if (end && end < start)
      throw validationError("end_date must be on or after start_date");
    const { lines, total } = await validateTemplateLines(org, req.body?.lines);
    const maxAmount = req.body?.max_amount == null || req.body.max_amount === "" ? total : decimal(String(req.body.max_amount), "max_amount", { sign: "positive", scale: 2 });
    if (Money22.from(total).gt(maxAmount))
      throw validationError("Template total exceeds max_amount");
    const [y, m] = start.split("-").map(Number);
    let first = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (first < start) {
      const nm = m === 12 ? 1 : m + 1;
      first = `${m === 12 ? y + 1 : y}-${String(nm).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    if (end && first > end)
      throw validationError("No occurrence falls between start_date and end_date");
    const out = await db.transaction(async (tx) => {
      const dup = await tx.query(`SELECT 1 FROM recurring_journal_templates WHERE organization_id = $1 AND code = $2`, [org, code]);
      if (dup.rows.length)
        throw validationError(`Template code ${code} already exists`);
      const r = await tx.query(`INSERT INTO recurring_journal_templates (organization_id, legal_entity_id, code, name, description, lines, total_amount, day_of_month, start_date, end_date, next_run_date, max_amount, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`, [org, req.session.legal_entity_id, code, name, description, JSON.stringify(lines), total, day, start, end, first, maxAmount, req.session.user_id]);
      await auditLogger.record({ organization_id: org, user_id: req.session.user_id, action: "RECURRING_JOURNAL_CREATED", entity_type: "RECURRING_JOURNAL", entity_id: r.rows[0].id, after_state: { code, total, day_of_month: day, start, end }, correlation_id: req.correlationId }, tx);
      return r.rows[0];
    });
    return ok(req, res, out, 201);
  });
  app.post("/api/automation/recurring-journals/:id/approve", authenticate, requirePermission(Permission21.FINANCE_JOURNAL_APPROVE), async (req, res) => {
    const org = req.session.organization_id;
    const out = await db.transaction(async (tx) => {
      const t = await requireOrgRow(tx, "recurring_journal_templates", req.params.id, org, "Recurring journal template", { forUpdate: true });
      if (t.created_by === req.session.user_id)
        throw sodViolation("The author of a recurring journal cannot approve it");
      if (!["DRAFT", "PAUSED"].includes(t.status))
        throw invalidState(`Template is ${t.status}`);
      const r = await tx.query(`UPDATE recurring_journal_templates SET status='ACTIVE', approved_by=$2, approved_at=NOW(), version=version+1 WHERE id=$1 RETURNING *`, [t.id, req.session.user_id]);
      await auditLogger.record({ organization_id: org, user_id: req.session.user_id, action: "RECURRING_JOURNAL_APPROVED", entity_type: "RECURRING_JOURNAL", entity_id: t.id, before_state: { status: t.status }, after_state: { status: "ACTIVE" }, correlation_id: req.correlationId }, tx);
      return r.rows[0];
    });
    return ok(req, res, out);
  });
  for (const action of ["pause", "end"]) {
    app.post(`/api/automation/recurring-journals/:id/${action}`, authenticate, requireAnyPermission(Permission21.FINANCE_JOURNAL_APPROVE, Permission21.AUTOMATION_MANAGE), async (req, res) => {
      const org = req.session.organization_id;
      const out = await db.transaction(async (tx) => {
        const t = await requireOrgRow(tx, "recurring_journal_templates", req.params.id, org, "Recurring journal template", { forUpdate: true });
        if (t.status === "ENDED")
          throw invalidState("Template has ended");
        if (action === "pause" && t.status !== "ACTIVE")
          throw invalidState("Only active templates can be paused");
        const status = action === "pause" ? "PAUSED" : "ENDED";
        const r = await tx.query(`UPDATE recurring_journal_templates SET status=$2, version=version+1 WHERE id=$1 RETURNING *`, [t.id, status]);
        await auditLogger.record({ organization_id: org, user_id: req.session.user_id, action: action === "pause" ? "RECURRING_JOURNAL_PAUSED" : "RECURRING_JOURNAL_ENDED", entity_type: "RECURRING_JOURNAL", entity_id: t.id, before_state: { status: t.status }, after_state: { status }, correlation_id: req.correlationId }, tx);
        return r.rows[0];
      });
      return ok(req, res, out);
    });
  }
}

// apps/api/dist/routes/quality.js
init_context();
init_errors();
init_posting();
init_numbering();
init_validate();
init_stock();
import crypto19 from "node:crypto";
import { Money as Money23, QualityEngine } from "@omnysync/financial-engine";
import { ErrorCode as ErrorCode31, Permission as Permission22, AccountingPurpose as AccountingPurpose16 } from "@omnysync/contracts";
function registerQualityRoutes(app) {
  app.get("/api/quality/plans", authenticate, requirePermission(Permission22.QUALITY_PLAN_MANAGE), async (req, res) => {
    const plansRes = await db.query(`SELECT qp.*, i.name as item_name, i.code as item_code 
       FROM quality_inspection_plans qp 
       LEFT JOIN items i ON i.id = qp.item_id 
       WHERE qp.organization_id = $1 
       ORDER BY qp.plan_code ASC`, [req.session.organization_id]);
    const paramsRes = await db.query(`SELECT qpp.* 
       FROM quality_inspection_plan_params qpp 
       JOIN quality_inspection_plans qp ON qp.id = qpp.plan_id 
       WHERE qp.organization_id = $1 
       ORDER BY qpp.created_at ASC`, [req.session.organization_id]);
    const paramsByPlan = /* @__PURE__ */ new Map();
    for (const p of paramsRes.rows) {
      if (!paramsByPlan.has(p.plan_id))
        paramsByPlan.set(p.plan_id, []);
      paramsByPlan.get(p.plan_id).push(p);
    }
    const plans = plansRes.rows.map((plan) => ({
      ...plan,
      params: paramsByPlan.get(plan.id) || []
    }));
    return res.json({
      success: true,
      data: plans,
      meta: { correlation_id: req.correlationId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    });
  });
  app.post("/api/quality/plans", authenticate, requirePermission(Permission22.QUALITY_PLAN_MANAGE), async (req, res) => {
    const { plan_code, name, item_id, inspection_type, sample_size, params } = req.body;
    if (!plan_code || !name) {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode31.VALIDATION_FAILED, message: "plan_code and name are required", correlation_id: req.correlationId }
      });
    }
    const planId = crypto19.randomUUID();
    await db.transaction(async (tx) => {
      await tx.query(`INSERT INTO quality_inspection_plans (
          id, organization_id, plan_code, name, item_id, inspection_type, sample_size, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE')`, [
        planId,
        req.session.organization_id,
        plan_code,
        name,
        item_id || null,
        inspection_type || "RECEIVING",
        sample_size || "1.00000000"
      ]);
      if (Array.isArray(params)) {
        for (const p of params) {
          await tx.query(`INSERT INTO quality_inspection_plan_params (
              id, plan_id, param_name, data_type, target_value, min_tolerance, max_tolerance, uom, is_mandatory
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
            crypto19.randomUUID(),
            planId,
            p.param_name,
            p.data_type || "NUMERIC",
            p.target_value || null,
            p.min_tolerance !== void 0 ? p.min_tolerance : null,
            p.max_tolerance !== void 0 ? p.max_tolerance : null,
            p.uom || null,
            p.is_mandatory !== void 0 ? p.is_mandatory : true
          ]);
        }
      }
    });
    return res.status(201).json({
      success: true,
      data: { id: planId, plan_code, name, status: "ACTIVE" },
      meta: { correlation_id: req.correlationId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    });
  });
  app.get("/api/quality/lots", authenticate, requirePermission(Permission22.QUALITY_INSPECT), async (req, res) => {
    const lotsRes = await db.query(`SELECT ql.*, i.name as item_name, i.code as item_code, u.name as inspector_name, sp.name AS supplier_name, po.po_number
       FROM quality_inspection_lots ql 
       JOIN items i ON i.id = ql.item_id 
       LEFT JOIN users u ON u.id = ql.inspector_id 
       LEFT JOIN parties sp ON sp.id = ql.party_id
       LEFT JOIN purchase_orders po ON po.id = ql.purchase_order_id
       WHERE ql.organization_id = $1 
       ORDER BY ql.created_at DESC`, [req.session.organization_id]);
    const resultsRes = await db.query(`SELECT qr.* 
       FROM quality_inspection_results qr 
       JOIN quality_inspection_lots ql ON ql.id = qr.lot_id 
       WHERE ql.organization_id = $1`, [req.session.organization_id]);
    const resultsByLot = /* @__PURE__ */ new Map();
    for (const r of resultsRes.rows) {
      if (!resultsByLot.has(r.lot_id))
        resultsByLot.set(r.lot_id, []);
      resultsByLot.get(r.lot_id).push(r);
    }
    const lots = lotsRes.rows.map((lot) => ({
      ...lot,
      results: resultsByLot.get(lot.id) || []
    }));
    return res.json({
      success: true,
      data: lots,
      meta: { correlation_id: req.correlationId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    });
  });
  app.post("/api/quality/lots", authenticate, requirePermission(Permission22.QUALITY_INSPECT), async (req, res) => {
    const { lot_number, item_id, batch_number, quantity, purchase_order_id } = req.body;
    let { source_type, source_id } = req.body;
    if (!item_id || !quantity) {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode31.VALIDATION_FAILED, message: "item_id and quantity are required", correlation_id: req.correlationId }
      });
    }
    let partyId = null;
    if (purchase_order_id) {
      const po = (await db.query(`SELECT po.id, po.party_id, EXISTS (SELECT 1 FROM purchase_order_lines l WHERE l.purchase_order_id = po.id AND l.item_id = $3) AS has_item
           FROM purchase_orders po WHERE po.id = $1 AND po.organization_id = $2`, [purchase_order_id, req.session.organization_id, item_id])).rows[0];
      if (!po)
        return res.status(404).json({ success: false, error: { code: ErrorCode31.RESOURCE_NOT_FOUND, message: "Purchase order not found", correlation_id: req.correlationId } });
      if (!po.has_item)
        return res.status(400).json({ success: false, error: { code: ErrorCode31.VALIDATION_FAILED, message: "The item is not on that purchase order", correlation_id: req.correlationId, details: { field: "item_id" } } });
      partyId = po.party_id;
      source_type = "GRN";
      source_id = po.id;
    }
    const id = crypto19.randomUUID();
    const lotNum = lot_number || await nextDocumentNumber(db, req.session.organization_id, "LOT");
    const qtyStr = new Money23(quantity).toFixed(8);
    await db.query(`INSERT INTO quality_inspection_lots (
        id, organization_id, legal_entity_id, lot_number, source_type, source_id, item_id, batch_number, quantity, status, party_id, purchase_order_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING', $10, $11)`, [
      id,
      req.session.organization_id,
      req.session.legal_entity_id,
      lotNum,
      source_type || "MANUAL",
      source_id || null,
      item_id,
      batch_number || null,
      qtyStr,
      partyId,
      partyId ? source_id : null
    ]);
    return res.status(201).json({
      success: true,
      data: { id, lot_number: lotNum, item_id, quantity: qtyStr, status: "PENDING", party_id: partyId, purchase_order_id: partyId ? source_id : null },
      meta: { correlation_id: req.correlationId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    });
  });
  app.post("/api/quality/lots/:id/inspect", authenticate, requirePermission(Permission22.QUALITY_INSPECT), async (req, res) => {
    const { id } = req.params;
    const { results, usage_decision_notes } = req.body;
    const lotRes = await db.query(`SELECT * FROM quality_inspection_lots WHERE id = $1 AND organization_id = $2`, [id, req.session.organization_id]);
    if (lotRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: ErrorCode31.LOT_NOT_FOUND, message: "Inspection lot not found", correlation_id: req.correlationId }
      });
    }
    const lot = lotRes.rows[0];
    const planParamsRes = await db.query(`SELECT qpp.* 
       FROM quality_inspection_plan_params qpp 
       JOIN quality_inspection_plans qp ON qp.id = qpp.plan_id 
       WHERE qp.item_id = $1 AND qp.organization_id = $2 AND qp.status = 'ACTIVE'`, [lot.item_id, req.session.organization_id]);
    const evaluation = QualityEngine.evaluateLot(planParamsRes.rows, results || []);
    await db.transaction(async (tx) => {
      await tx.query(`DELETE FROM quality_inspection_results WHERE lot_id = $1`, [id]);
      for (const r of evaluation.evaluated_results) {
        await tx.query(`INSERT INTO quality_inspection_results (
            id, lot_id, param_name, measured_numeric_value, measured_text_value, is_pass, inspector_notes
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
          crypto19.randomUUID(),
          id,
          r.param_name,
          r.measured_numeric_value || null,
          r.measured_text_value || null,
          r.is_pass,
          r.inspector_notes || null
        ]);
      }
      await tx.query(`UPDATE quality_inspection_lots 
         SET status = $1, usage_decision_notes = $2, inspector_id = $3, inspected_at = NOW(), updated_at = NOW() 
         WHERE id = $4`, [evaluation.overall_status, usage_decision_notes || null, req.session.user_id, id]);
    });
    return res.json({
      success: true,
      data: {
        id,
        status: evaluation.overall_status,
        all_mandatory_passed: evaluation.all_mandatory_passed,
        results: evaluation.evaluated_results
      },
      meta: { correlation_id: req.correlationId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    });
  });
  app.get("/api/quality/ncr", authenticate, requirePermission(Permission22.QUALITY_NCR_MANAGE), async (req, res) => {
    const result = await db.query(`SELECT ncr.*, ql.lot_number, i.name as item_name, i.code as item_code 
       FROM quality_non_conformance_reports ncr 
       JOIN quality_inspection_lots ql ON ql.id = ncr.lot_id 
       JOIN items i ON i.id = ncr.item_id 
       WHERE ncr.organization_id = $1 
       ORDER BY ncr.created_at DESC`, [req.session.organization_id]);
    return res.json({
      success: true,
      data: result.rows,
      meta: { correlation_id: req.correlationId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    });
  });
  app.post("/api/quality/ncr", authenticate, requirePermission(Permission22.QUALITY_NCR_MANAGE), async (req, res) => {
    const { lot_id, defect_severity, root_cause, corrective_action, disposition } = req.body;
    if (!lot_id) {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode31.VALIDATION_FAILED, message: "lot_id is required", correlation_id: req.correlationId }
      });
    }
    const lotRes = await db.query(`SELECT item_id FROM quality_inspection_lots WHERE id = $1`, [lot_id]);
    if (lotRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: ErrorCode31.LOT_NOT_FOUND, message: "Inspection lot not found", correlation_id: req.correlationId }
      });
    }
    const id = crypto19.randomUUID();
    const ncrNum = await nextDocumentNumber(db, req.session.organization_id, "NCR");
    await db.query(`INSERT INTO quality_non_conformance_reports (
        id, organization_id, ncr_number, lot_id, item_id, defect_severity, root_cause, corrective_action, disposition, status, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'OPEN', $10)`, [
      id,
      req.session.organization_id,
      ncrNum,
      lot_id,
      lotRes.rows[0].item_id,
      defect_severity || "MAJOR",
      root_cause || null,
      corrective_action || null,
      disposition || "REWORK",
      req.session.user_id
    ]);
    return res.status(201).json({
      success: true,
      data: { id, ncr_number: ncrNum, status: "OPEN", disposition: disposition || "REWORK" },
      meta: { correlation_id: req.correlationId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    });
  });
  app.post("/api/quality/ncr/:id/scrap", authenticate, requirePermission(Permission22.QUALITY_NCR_MANAGE), async (req, res) => {
    const { id } = req.params;
    const ncrRes = await db.query(`SELECT ncr.*, ql.quantity, ql.lot_number, i.code as item_code, i.name as item_name, i.unit_cost 
       FROM quality_non_conformance_reports ncr 
       JOIN quality_inspection_lots ql ON ql.id = ncr.lot_id 
       JOIN items i ON i.id = ncr.item_id 
       WHERE ncr.id = $1 AND ncr.organization_id = $2`, [id, req.session.organization_id]);
    if (ncrRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: ErrorCode31.NCR_NOT_FOUND, message: "NCR not found", correlation_id: req.correlationId }
      });
    }
    const ncr = ncrRes.rows[0];
    if (ncr.status === "CLOSED") {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode31.NCR_ALREADY_CLOSED, message: "NCR is already closed", correlation_id: req.correlationId }
      });
    }
    const scrapDate = dateOnly(req.body?.scrap_date, "scrap_date", { defaultValue: todayIso() });
    const journalId = await db.transaction(async (tx) => {
      const locked = (await tx.query(`SELECT * FROM quality_non_conformance_reports WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [id, req.session.organization_id])).rows[0];
      if (locked.status === "CLOSED")
        throw new ApiError(409, ErrorCode31.NCR_ALREADY_CLOSED, "NCR is already closed");
      const item = (await lockItems(tx, req.session.organization_id, [ncr.item_id])).get(ncr.item_id);
      const unitCost = new Money23(item.unit_cost || "0");
      const invAcc = item.inventory_account_id || await accountByCode(tx, req.session.organization_id, "113001");
      const scrapAcc = await accountByCode(tx, req.session.organization_id, "511003");
      let stockAdjusted = false;
      let movedValue = null;
      if (item.item_type === "INVENTORY" && !new Money23(await onHand(tx, req.session.organization_id, ncr.item_id, null)).lt(ncr.quantity)) {
        stockAdjusted = true;
        const mv = await postStockMovement(tx, {
          organizationId: req.session.organization_id,
          legalEntityId: req.session.legal_entity_id,
          itemId: ncr.item_id,
          warehouseId: null,
          movementType: "ADJUSTMENT",
          movementDate: scrapDate,
          quantity: new Money23(ncr.quantity).negated().toFixed(8),
          unitCost: unitCost.toFixed(8),
          referenceType: "QUALITY_NCR",
          referenceId: id,
          description: `Scrap write-off ${ncr.ncr_number}`
        });
        movedValue = new Money23(mv.total_value).abs();
      }
      const value = (movedValue ?? unitCost.mul(ncr.quantity)).round(2);
      const posted = value.isPositive() ? await postJournal(tx, auditLogger, outboxService, {
        organizationId: req.session.organization_id,
        legalEntityId: req.session.legal_entity_id,
        userId: req.session.user_id,
        postingDate: scrapDate,
        purpose: AccountingPurpose16.QUALITY_SCRAP_WRITEOFF,
        description: `Quality scrap write-off ${ncr.ncr_number} (${ncr.item_code})`,
        sourceType: "QUALITY_NCR",
        sourceId: id,
        sourceKey: `NCR_SCRAP:${id}`,
        numberPrefix: "JV-QSC",
        correlationId: req.correlationId,
        lines: [
          { account_id: scrapAcc, debit: value.toFixed(8), description: `Scrap expense ${ncr.ncr_number}` },
          { account_id: invAcc, credit: value.toFixed(8), description: `Inventory write-off ${ncr.item_code}` }
        ]
      }) : null;
      await tx.query(`UPDATE quality_non_conformance_reports SET status = 'CLOSED', disposition = 'SCRAP', scrap_journal_id = $1, updated_at = NOW() WHERE id = $2`, [posted?.journalId ?? null, id]);
      await auditLogger.record({ organization_id: req.session.organization_id, user_id: req.session.user_id, action: "NCR_SCRAPPED", entity_type: "QUALITY_NCR", entity_id: id, after_state: { quantity: ncr.quantity, value: value.format(), stock_adjusted: stockAdjusted, reconciliation_exception: !stockAdjusted && item.item_type === "INVENTORY" }, correlation_id: req.correlationId }, tx);
      return posted?.journalId ?? null;
    });
    return res.json({
      success: true,
      data: { id, status: "CLOSED", disposition: "SCRAP", scrap_journal_id: journalId },
      meta: { correlation_id: req.correlationId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    });
  });
  app.get("/api/quality/coa", authenticate, requirePermission(Permission22.QUALITY_COA_MANAGE), async (req, res) => {
    const result = await db.query(`SELECT coa.*, ql.lot_number, i.name as item_name, i.code as item_code, p.name as customer_name 
       FROM quality_certificates_of_analysis coa 
       JOIN quality_inspection_lots ql ON ql.id = coa.lot_id 
       JOIN items i ON i.id = coa.item_id 
       LEFT JOIN parties p ON p.id = coa.customer_id 
       WHERE coa.organization_id = $1 
       ORDER BY coa.created_at DESC`, [req.session.organization_id]);
    return res.json({
      success: true,
      data: result.rows,
      meta: { correlation_id: req.correlationId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    });
  });
  app.post("/api/quality/coa", authenticate, requirePermission(Permission22.QUALITY_COA_MANAGE), async (req, res) => {
    const { lot_id, customer_id, issue_date, certified_by } = req.body;
    if (!lot_id) {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode31.VALIDATION_FAILED, message: "lot_id is required", correlation_id: req.correlationId }
      });
    }
    const lotRes = await db.query(`SELECT item_id FROM quality_inspection_lots WHERE id = $1`, [lot_id]);
    if (lotRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: ErrorCode31.LOT_NOT_FOUND, message: "Inspection lot not found", correlation_id: req.correlationId }
      });
    }
    const id = crypto19.randomUUID();
    const coaNum = await nextDocumentNumber(db, req.session.organization_id, "QCOA");
    const dateStr = issue_date || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    await db.query(`INSERT INTO quality_certificates_of_analysis (
        id, organization_id, coa_number, lot_id, item_id, customer_id, issue_date, certified_by, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ISSUED')`, [
      id,
      req.session.organization_id,
      coaNum,
      lot_id,
      lotRes.rows[0].item_id,
      customer_id || null,
      dateStr,
      certified_by || req.session.name || "Lead Quality Officer"
    ]);
    return res.status(201).json({
      success: true,
      data: { id, coa_number: coaNum, status: "ISSUED" },
      meta: { correlation_id: req.correlationId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    });
  });
}

// apps/api/dist/routes/maintenance.js
init_context();
init_posting();
init_state();
init_numbering();
init_validate();
init_stock();
import crypto20 from "node:crypto";
import { Money as Money24, MaintenanceEngine } from "@omnysync/financial-engine";
import { ErrorCode as ErrorCode32, Permission as Permission23, AccountingPurpose as AccountingPurpose17 } from "@omnysync/contracts";
function registerMaintenanceRoutes(app) {
  app.get("/api/maintenance/equipment", authenticate, requirePermission(Permission23.EQUIPMENT_MANAGE), async (req, res) => {
    const result = await db.query(`SELECT me.*, fa.name as fixed_asset_name 
       FROM maintenance_equipment me 
       LEFT JOIN fixed_assets fa ON fa.id = me.fixed_asset_id 
       WHERE me.organization_id = $1 
       ORDER BY me.equipment_code ASC`, [req.session.organization_id]);
    return res.json({
      success: true,
      data: result.rows,
      meta: { correlation_id: req.correlationId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    });
  });
  app.post("/api/maintenance/equipment", authenticate, requirePermission(Permission23.EQUIPMENT_MANAGE), async (req, res) => {
    const { equipment_code, name, fixed_asset_id, category, location, criticality, serial_number } = req.body;
    if (!equipment_code || !name) {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode32.VALIDATION_FAILED, message: "equipment_code and name are required", correlation_id: req.correlationId }
      });
    }
    const id = crypto20.randomUUID();
    await db.query(`INSERT INTO maintenance_equipment (
        id, organization_id, legal_entity_id, equipment_code, name, fixed_asset_id, category, location, criticality, status, operating_hours, serial_number
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'OPERATIONAL', '0.00000000', $10)`, [
      id,
      req.session.organization_id,
      req.session.legal_entity_id,
      equipment_code,
      name,
      fixed_asset_id || null,
      category || "MACHINERY",
      location || null,
      criticality || "MEDIUM",
      serial_number || null
    ]);
    return res.status(201).json({
      success: true,
      data: { id, equipment_code, name, status: "OPERATIONAL" },
      meta: { correlation_id: req.correlationId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    });
  });
  app.get("/api/maintenance/schedules", authenticate, requirePermission(Permission23.PM_SCHEDULE_MANAGE), async (req, res) => {
    const result = await db.query(`SELECT ps.*, me.name as equipment_name, me.equipment_code 
       FROM pm_schedules ps 
       JOIN maintenance_equipment me ON me.id = ps.equipment_id 
       WHERE ps.organization_id = $1 
       ORDER BY ps.next_due_date ASC`, [req.session.organization_id]);
    return res.json({
      success: true,
      data: result.rows,
      meta: { correlation_id: req.correlationId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    });
  });
  app.post("/api/maintenance/schedules", authenticate, requirePermission(Permission23.PM_SCHEDULE_MANAGE), async (req, res) => {
    const { equipment_id, schedule_name, frequency_type, frequency_interval, next_due_date } = req.body;
    if (!equipment_id || !schedule_name || !frequency_interval) {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode32.VALIDATION_FAILED, message: "equipment_id, schedule_name, and frequency_interval are required", correlation_id: req.correlationId }
      });
    }
    const id = crypto20.randomUUID();
    const dueDate = next_due_date || MaintenanceEngine.calculateNextDueDate((/* @__PURE__ */ new Date()).toISOString().slice(0, 10), parseInt(frequency_interval, 10));
    await db.query(`INSERT INTO pm_schedules (
        id, organization_id, equipment_id, schedule_name, frequency_type, frequency_interval, next_due_date, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE')`, [
      id,
      req.session.organization_id,
      equipment_id,
      schedule_name,
      frequency_type || "TIME_BASED_DAYS",
      frequency_interval,
      dueDate
    ]);
    return res.status(201).json({
      success: true,
      data: { id, schedule_name, next_due_date: dueDate, status: "ACTIVE" },
      meta: { correlation_id: req.correlationId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    });
  });
  app.get("/api/maintenance/work-orders", authenticate, requirePermission(Permission23.MAINT_WORK_ORDER_MANAGE), async (req, res) => {
    const woRes = await db.query(`SELECT wo.*, me.name as equipment_name, me.equipment_code 
       FROM maintenance_work_orders wo 
       JOIN maintenance_equipment me ON me.id = wo.equipment_id 
       WHERE wo.organization_id = $1 
       ORDER BY wo.created_at DESC`, [req.session.organization_id]);
    const partsRes = await db.query(`SELECT mop.*, i.name as item_name, i.code as item_code 
       FROM maint_order_parts mop 
       JOIN maintenance_work_orders wo ON wo.id = mop.work_order_id 
       JOIN items i ON i.id = mop.item_id 
       WHERE wo.organization_id = $1`, [req.session.organization_id]);
    const laborRes = await db.query(`SELECT mol.* 
       FROM maint_order_labor mol 
       JOIN maintenance_work_orders wo ON wo.id = mol.work_order_id 
       WHERE wo.organization_id = $1`, [req.session.organization_id]);
    const partsByWo = /* @__PURE__ */ new Map();
    for (const p of partsRes.rows) {
      if (!partsByWo.has(p.work_order_id))
        partsByWo.set(p.work_order_id, []);
      partsByWo.get(p.work_order_id).push(p);
    }
    const laborByWo = /* @__PURE__ */ new Map();
    for (const l of laborRes.rows) {
      if (!laborByWo.has(l.work_order_id))
        laborByWo.set(l.work_order_id, []);
      laborByWo.get(l.work_order_id).push(l);
    }
    const workOrders = woRes.rows.map((wo) => ({
      ...wo,
      parts: partsByWo.get(wo.id) || [],
      labor: laborByWo.get(wo.id) || []
    }));
    return res.json({
      success: true,
      data: workOrders,
      meta: { correlation_id: req.correlationId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    });
  });
  app.post("/api/maintenance/work-orders", authenticate, requirePermission(Permission23.MAINT_WORK_ORDER_MANAGE), async (req, res) => {
    const { equipment_id, pm_schedule_id, order_type, priority, description, failure_code, start_date, parts, labor } = req.body;
    if (!equipment_id || !description) {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode32.VALIDATION_FAILED, message: "equipment_id and description are required", correlation_id: req.correlationId }
      });
    }
    const costing = MaintenanceEngine.calculateWorkOrderCost(parts || [], labor || []);
    const woId = crypto20.randomUUID();
    const woNum = await nextDocumentNumber(db, req.session.organization_id, "WO");
    await db.transaction(async (tx) => {
      await tx.query(`INSERT INTO maintenance_work_orders (
          id, organization_id, legal_entity_id, work_order_number, equipment_id, pm_schedule_id,
          order_type, priority, status, description, failure_code, start_date,
          total_parts_cost, total_labor_cost, total_cost, downtime_hours, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'IN_PROGRESS', $9, $10, $11, $12, $13, $14, '0.00000000', $15)`, [
        woId,
        req.session.organization_id,
        req.session.legal_entity_id,
        woNum,
        equipment_id,
        pm_schedule_id || null,
        order_type || "PREVENTIVE",
        priority || "MEDIUM",
        description,
        failure_code || null,
        start_date || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
        costing.total_parts_cost,
        costing.total_labor_cost,
        costing.total_cost,
        req.session.user_id
      ]);
      if (Array.isArray(parts)) {
        for (const p of parts) {
          const lineCost = new Money24(p.quantity).mul(new Money24(p.unit_cost)).toFixed(8);
          await tx.query(`INSERT INTO maint_order_parts (id, work_order_id, item_id, quantity, unit_cost, total_cost)
             VALUES ($1, $2, $3, $4, $5, $6)`, [crypto20.randomUUID(), woId, p.item_id, p.quantity, p.unit_cost, lineCost]);
        }
      }
      if (Array.isArray(labor)) {
        for (const l of labor) {
          const lineCost = new Money24(l.labor_hours).mul(new Money24(l.hourly_rate)).toFixed(8);
          await tx.query(`INSERT INTO maint_order_labor (id, work_order_id, technician_name, labor_hours, hourly_rate, total_cost)
             VALUES ($1, $2, $3, $4, $5, $6)`, [crypto20.randomUUID(), woId, l.technician_name, l.labor_hours, l.hourly_rate, lineCost]);
        }
      }
      await tx.query(`UPDATE maintenance_equipment SET status = 'UNDER_MAINTENANCE' WHERE id = $1`, [equipment_id]);
    });
    return res.status(201).json({
      success: true,
      data: {
        id: woId,
        work_order_number: woNum,
        status: "IN_PROGRESS",
        total_cost: costing.total_cost
      },
      meta: { correlation_id: req.correlationId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    });
  });
  app.post("/api/maintenance/work-orders/:id/complete", authenticate, requirePermission(Permission23.MAINT_WORK_ORDER_MANAGE), async (req, res) => {
    const { id } = req.params;
    const { downtime_hours } = req.body;
    const woRes = await db.query(`SELECT wo.*, me.equipment_code, me.name as equipment_name 
       FROM maintenance_work_orders wo 
       JOIN maintenance_equipment me ON me.id = wo.equipment_id 
       WHERE wo.id = $1 AND wo.organization_id = $2`, [id, req.session.organization_id]);
    if (woRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: ErrorCode32.RESOURCE_NOT_FOUND, message: "Work order not found", correlation_id: req.correlationId }
      });
    }
    const wo = woRes.rows[0];
    if (wo.status === "COMPLETED") {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode32.WORK_ORDER_ALREADY_COMPLETED, message: "Work order is already completed", correlation_id: req.correlationId }
      });
    }
    const completionDate = dateOnly(req.body?.completion_date, "completion_date", { defaultValue: todayIso() });
    const downtime = decimal(downtime_hours == null ? void 0 : String(downtime_hours), "downtime_hours", { required: false, defaultValue: "0" });
    const journalId = await db.transaction(async (tx) => {
      await transition(tx, { table: "maintenance_work_orders", id, organizationId: req.session.organization_id, from: ["DRAFT", "SCHEDULED", "IN_PROGRESS"], to: "COMPLETED", label: "Maintenance work order", set: { completion_date: completionDate, downtime_hours: downtime } });
      const org = req.session.organization_id;
      const parts = (await tx.query(`SELECT * FROM maint_order_parts WHERE work_order_id = $1`, [id])).rows;
      const items = await lockItems(tx, org, parts.map((p) => p.item_id));
      const lines = [];
      let partsTotal = Money24.zero();
      for (const p of parts) {
        const item = items.get(p.item_id);
        let cost = new Money24(p.total_cost).round(2);
        if (item.item_type === "INVENTORY") {
          const mv = await postStockMovement(tx, { organizationId: org, legalEntityId: req.session.legal_entity_id, itemId: p.item_id, warehouseId: null, movementType: "ADJUSTMENT", movementDate: completionDate, quantity: new Money24(p.quantity).negated().toFixed(8), unitCost: p.unit_cost, referenceType: "MAINT_WORK_ORDER", referenceId: id, description: `Spare parts issued to ${wo.work_order_number}` });
          cost = new Money24(mv.total_value).abs().round(2);
        }
        partsTotal = partsTotal.add(cost);
        lines.push({ account_id: item.inventory_account_id || await accountByCode(tx, org, "113001"), credit: cost.toFixed(8), description: `Spare parts ${item.code}` });
      }
      const labor = new Money24(wo.total_labor_cost || "0").round(2);
      if (labor.isPositive())
        lines.push({ account_code: "521002", credit: labor.toFixed(8), description: `Labour absorbed by ${wo.work_order_number}` });
      const total = partsTotal.add(labor);
      let posted = null;
      if (total.isPositive()) {
        lines.unshift({ account_code: "521005", debit: total.toFixed(8), description: `Maintenance cost ${wo.equipment_code}` });
        posted = await postJournal(tx, auditLogger, outboxService, {
          organizationId: org,
          legalEntityId: req.session.legal_entity_id,
          userId: req.session.user_id,
          postingDate: completionDate,
          purpose: AccountingPurpose17.MAINTENANCE_EXPENSE_SETTLEMENT,
          description: `Maintenance settlement ${wo.work_order_number} \u2014 ${wo.equipment_name}`,
          sourceType: "MAINT_WORK_ORDER",
          sourceId: id,
          sourceKey: `MAINT_SETTLEMENT:${id}`,
          numberPrefix: "JV-MNT",
          correlationId: req.correlationId,
          lines
        });
      }
      await tx.query(`UPDATE maintenance_work_orders SET settlement_journal_id = $1, updated_at = NOW() WHERE id = $2`, [posted?.journalId ?? null, id]);
      await tx.query(`UPDATE maintenance_equipment SET status = 'OPERATIONAL' WHERE id = $1`, [wo.equipment_id]);
      if (wo.pm_schedule_id) {
        const sch = (await tx.query(`SELECT * FROM pm_schedules WHERE id = $1 FOR UPDATE`, [wo.pm_schedule_id])).rows[0];
        if (sch && sch.frequency_type === "TIME_BASED_DAYS") {
          const days = Math.max(1, Math.round(Number(sch.frequency_interval)));
          const next = new Date(Date.parse(`${completionDate}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);
          await tx.query(`UPDATE pm_schedules SET last_performed_date = $1, next_due_date = $2 WHERE id = $3`, [completionDate, next, sch.id]);
        } else if (sch) {
          await tx.query(`UPDATE pm_schedules SET last_performed_date = $1 WHERE id = $2`, [completionDate, sch.id]);
        }
      }
      await auditLogger.record({ organization_id: org, user_id: req.session.user_id, action: "MAINT_WORK_ORDER_COMPLETED", entity_type: "MAINT_WORK_ORDER", entity_id: id, after_state: { total: total.format(), downtime }, correlation_id: req.correlationId }, tx);
      return posted?.journalId ?? null;
    });
    return res.json({
      success: true,
      data: { id, status: "COMPLETED", settlement_journal_id: journalId, total_cost: wo.total_cost },
      meta: { correlation_id: req.correlationId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    });
  });
  app.get("/api/maintenance/calibrations", authenticate, requirePermission(Permission23.CALIBRATION_MANAGE), async (req, res) => {
    const result = await db.query(`SELECT ec.*, me.name as equipment_name, me.equipment_code 
       FROM equipment_calibrations ec 
       JOIN maintenance_equipment me ON me.id = ec.equipment_id 
       WHERE ec.organization_id = $1 
       ORDER BY ec.calibration_date DESC`, [req.session.organization_id]);
    return res.json({
      success: true,
      data: result.rows,
      meta: { correlation_id: req.correlationId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    });
  });
  app.post("/api/maintenance/calibrations", authenticate, requirePermission(Permission23.CALIBRATION_MANAGE), async (req, res) => {
    const { equipment_id, calibration_certificate_no, calibration_date, expiry_date, calibration_agency, result, notes } = req.body;
    if (!equipment_id || !calibration_certificate_no) {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode32.VALIDATION_FAILED, message: "equipment_id and calibration_certificate_no are required", correlation_id: req.correlationId }
      });
    }
    const id = crypto20.randomUUID();
    await db.query(`INSERT INTO equipment_calibrations (
        id, organization_id, equipment_id, calibration_certificate_no, calibration_date, expiry_date, calibration_agency, result, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
      id,
      req.session.organization_id,
      equipment_id,
      calibration_certificate_no,
      calibration_date || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
      expiry_date || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
      calibration_agency || "Certified Testing Bureau",
      result || "PASS",
      notes || null
    ]);
    return res.status(201).json({
      success: true,
      data: { id, calibration_certificate_no, result: result || "PASS" },
      meta: { correlation_id: req.correlationId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    });
  });
}

// apps/api/dist/routes/admin.js
init_context();
init_http();
init_errors();
import { SyntheticSeedRunner } from "@omnysync/platform";
import { Permission as Permission25, ErrorCode as ErrorCode34 } from "@omnysync/contracts";

// apps/api/dist/lib/module-seed.js
var ORG = "10000000-0000-0000-0000-000000000001";
var LE = "20000000-0000-0000-0000-000000000001";
var ADMIN = "40000000-0000-0000-0000-000000000001";
var seeders = [];
function registerSeeder(name, fn) {
  seeders.push({ name, fn });
}
async function seedModules(q) {
  const org = await q.query(`SELECT id FROM organizations WHERE id = $1`, [ORG]);
  if (!org.rows.length)
    return [];
  const done = [];
  for (const s of seeders) {
    await q.transaction(async (tx) => s.fn(tx, { org: ORG, le: LE, admin: ADMIN }));
    done.push(s.name);
  }
  return done;
}
registerSeeder("TAX", async (q, c) => {
  const codes = [
    ["GST18", "Sales tax 18% (output)", "OUTPUT", "18", "212001"],
    ["GST18-IN", "Sales tax 18% (input, recoverable)", "INPUT", "18", "114001"],
    ["WHT-S", "Withholding on services 4.5%", "WITHHOLDING", "4.5", "212002"],
    ["EXEMPT", "Exempt supply", "EXEMPT", "0", null]
  ];
  for (const [code, name, kind, rate, acc] of codes) {
    await q.query(`INSERT INTO tax_codes (organization_id, legal_entity_id, code, name, kind, rate, account_code, effective_from, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'2024-01-01',$8) ON CONFLICT (organization_id, code, effective_from) DO NOTHING`, [c.org, c.le, code, name, kind, rate, acc, c.admin]);
  }
});
registerSeeder("WMS", async (q, c) => {
  const wh = (await q.query(`SELECT id FROM warehouses WHERE organization_id = $1 ORDER BY is_default DESC, code LIMIT 1`, [c.org])).rows[0];
  if (!wh)
    return;
  for (const [code, type, cap] of [["A-01-01", "PICK", "500"], ["A-01-02", "PICK", "500"], ["B-BULK-01", "BULK", null], ["STG-01", "STAGING", null], ["QC-HOLD", "QUARANTINE", null]]) {
    await q.query(`INSERT INTO warehouse_bins (warehouse_id, bin_code, bin_type, capacity_qty) VALUES ($1,$2,$3,$4) ON CONFLICT (warehouse_id, bin_code) DO NOTHING`, [wh.id, code, type, cap]);
  }
});
registerSeeder("AUT", async (q, c) => {
  const rules = [
    {
      code: "EVT-HIGH-PRIORITY-CASE",
      name: "Critical service case \u2192 alert service manager",
      event_type: "SERVICE_CASE_CREATED",
      conditions: [{ field: "priority", op: "eq", value: "CRITICAL" }],
      actions: [{ type: "ALERT", severity: "CRITICAL", title: "Critical case {{number}}: {{title}}", assigned_role: "SERVICE_MANAGER" }]
    },
    {
      code: "EVT-BIG-DEAL-WON",
      name: "Won opportunity \u2265 1M \u2192 onboarding task",
      event_type: "CRM_OPPORTUNITY_WIN",
      conditions: [{ field: "amount", op: "gte", value: "1000000" }],
      actions: [{ type: "TASK", title: "Kick-off onboarding for {{name}}", assigned_role: "SERVICE_MANAGER", due_in_days: 2 }]
    }
  ];
  for (const r of rules) {
    const def = { event_type: r.event_type, conditions: r.conditions, actions: r.actions };
    await q.query(`INSERT INTO automation_event_rules (organization_id, legal_entity_id, code, name, event_type, conditions, actions, status, version, published_definition, published_at, published_by, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'PUBLISHED',1,$8,NOW(),$9,$9) ON CONFLICT (organization_id, code) DO NOTHING`, [c.org, c.le, r.code, r.name, r.event_type, JSON.stringify(r.conditions), JSON.stringify(r.actions), JSON.stringify(def), c.admin]);
  }
});
registerSeeder("SRV", async (q, c) => {
  const acc = (await q.query(`SELECT id FROM accounts WHERE organization_id = $1 AND code = '411002'`, [c.org])).rows[0];
  await q.query(`INSERT INTO items (id, organization_id, legal_entity_id, code, name, item_type, uom, unit_price, unit_cost, sales_account_id)
     VALUES (gen_random_uuid(), $1, $2, 'SRV-LABOUR', 'Service labour (per hour)', 'SERVICE', 'HOUR', 2500, 0, $3) ON CONFLICT (organization_id, code) DO NOTHING`, [c.org, c.le, acc?.id ?? null]);
  const techs = [
    ["T-001", "Bilal Ahmed", "40000000-0000-0000-0000-000000000009", "Split AC, VRF, refrigerant", "Lahore \u2013 Gulberg", "900"],
    ["T-002", "Usman Tariq", null, "Chillers, ducting, electrical", "Lahore \u2013 DHA", "1100"],
    ["T-003", "Hamza Riaz", null, "Installation, inverter AC", "Lahore \u2013 Johar Town", "800"]
  ];
  for (const [code, name, user, skills, zone, cost] of techs) {
    const userOk = user ? (await q.query(`SELECT 1 FROM users WHERE id = $1`, [user])).rows.length > 0 : false;
    await q.query(`INSERT INTO srv_technicians (organization_id, legal_entity_id, code, name, user_id, skills, zone, hourly_cost, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (organization_id, code) DO NOTHING`, [c.org, c.le, code, name, userOk ? user : null, skills, zone, cost, c.admin]);
  }
  const party = (await q.query(`SELECT id, name FROM parties WHERE organization_id = $1 AND party_type IN ('CUSTOMER','BOTH') ORDER BY code LIMIT 1`, [c.org])).rows[0];
  if (!party)
    return;
  const has = await q.query(`SELECT 1 FROM srv_contracts WHERE organization_id = $1 AND number = 'SVC-DEMO-001'`, [c.org]);
  if (!has.rows.length) {
    await q.query(`INSERT INTO srv_contracts (organization_id, legal_entity_id, number, party_id, contract_type, title, site_address, equipment, start_date, end_date, response_hours, resolution_hours, covers_labour, covers_parts, visits_included, pm_interval_months, next_pm_date, contract_value, status, created_by)
       VALUES ($1,$2,'SVC-DEMO-001',$3,'AMC','Annual maintenance \u2014 HQ HVAC plant','Plot 12, Main Boulevard, Gulberg III, Lahore','2 \xD7 10TR ducted split, 1 \xD7 VRF outdoor unit','2026-01-01','2026-12-31',4,24,true,false,4,3,'2026-10-01',480000,'ACTIVE',$4)`, [c.org, c.le, party.id, c.admin]);
  }
});
registerSeeder("CRM", async (q, c) => {
  const has = await q.query(`SELECT 1 FROM crm_leads WHERE organization_id = $1 LIMIT 1`, [c.org]);
  if (has.rows.length)
    return;
  const leads = [
    ["LEAD-DEMO-001", "Ayesha Malik", "Malik Residence", "ayesha.malik@example.pk", "0300-1234567", "REFERRAL", "3 \xD7 1.5-ton inverter split install", "Lahore", "420000", "QUALIFIED"],
    ["LEAD-DEMO-002", "Faisal Qureshi", "Qureshi Textiles", "faisal@qureshitex.example.pk", "0321-7654321", "WEBSITE", "Factory floor ducted cooling, ~60TR", "Faisalabad", "5800000", "CONTACTED"],
    ["LEAD-DEMO-003", "Sana Javed", null, "sana.j@example.pk", "0333-5550001", "SOCIAL", "AMC for 2 units", "Lahore", "36000", "NEW"]
  ];
  const { normPhone: normPhone2 } = await Promise.resolve().then(() => (init_crm(), crm_exports));
  for (const [num, name, company, email, phone, source, interest, city, val, status] of leads) {
    await q.query(`INSERT INTO crm_leads (organization_id, legal_entity_id, number, name, company, email, email_norm, phone, phone_norm, source, interest, city, estimated_value, status, owner_user_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$15,$7,$8,$9,$10,$11,$12,$13,$14,$14)`, [c.org, c.le, num, name, company, email, phone, normPhone2(phone), source, interest, city, val, status, c.admin, String(email).toLowerCase()]);
  }
  const party = (await q.query(`SELECT id FROM parties WHERE organization_id = $1 AND party_type IN ('CUSTOMER','BOTH') ORDER BY code LIMIT 1`, [c.org])).rows[0];
  if (!party)
    return;
  const opps = [
    ["OPP-DEMO-001", "Office tower VRF retrofit", "12500000", "PROPOSAL", 60, "2026-11-15"],
    ["OPP-DEMO-002", "Clinic chiller AMC renewal", "850000", "NEGOTIATION", 80, "2026-10-20"],
    ["OPP-DEMO-003", "Showroom split units (8)", "1640000", "SITE_SURVEY", 40, "2026-12-05"]
  ];
  for (const [num, name, amt, stage, prob, close] of opps) {
    await q.query(`INSERT INTO crm_opportunities (organization_id, legal_entity_id, number, name, party_id, amount, stage, probability, expected_close_date, owner_user_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`, [c.org, c.le, num, name, party.id, amt, stage, prob, close, c.admin]);
  }
});
registerSeeder("TIM", async (q, c) => {
  const emps = [
    ["EMP-101", "Bilal", "Ahmed", "bilal.ahmed@omnysync.internal", "2024-03-01"],
    ["EMP-102", "Usman", "Tariq", "usman.tariq@omnysync.internal", "2023-07-15"],
    ["EMP-103", "Hamza", "Riaz", "hamza.riaz@omnysync.internal", "2025-01-10"],
    ["EMP-104", "Mariam", "Siddiqui", "mariam.s@omnysync.internal", "2022-11-01"]
  ];
  for (const [num, first, last, email, joined] of emps) {
    await q.query(`INSERT INTO employees (id, organization_id, legal_entity_id, employee_number, first_name, last_name, email, employment_type, joining_date, status)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'FULL_TIME', $7, 'ACTIVE') ON CONFLICT (legal_entity_id, employee_number) DO NOTHING`, [c.org, c.le, num, first, last, email, joined]);
  }
  const tech = (await q.query(`SELECT u.id, u.name FROM users u JOIN memberships m ON m.user_id = u.id WHERE m.organization_id = $1 AND u.email = 'tech@omnysync.internal'`, [c.org])).rows[0];
  if (tech) {
    const [first, ...rest] = String(tech.name || "Field Technician").split(" ");
    await q.query(`INSERT INTO employees (id, organization_id, legal_entity_id, employee_number, first_name, last_name, email, employment_type, joining_date, status, user_id)
       VALUES (gen_random_uuid(), $1, $2, 'EMP-105', $3, $4, 'tech@omnysync.internal', 'FULL_TIME', '2024-06-01', 'ACTIVE', $5) ON CONFLICT (legal_entity_id, employee_number) DO NOTHING`, [c.org, c.le, first, rest.join(" ") || "-", tech.id]);
  }
});
registerSeeder("SUP", async (q, c) => {
  const vendors = (await q.query(`SELECT id, name FROM parties WHERE organization_id = $1 AND party_type IN ('VENDOR','BOTH') ORDER BY code LIMIT 2`, [c.org])).rows;
  const cats = ["EQUIPMENT", "SPARE_PARTS"];
  for (const [i, v] of vendors.entries()) {
    const r = await q.query(`INSERT INTO sup_profiles (organization_id, legal_entity_id, party_id, category, risk_level, contact_name, status, submitted_by, approved_by, approved_at, created_by)
       VALUES ($1,$2,$3,$4,'MEDIUM',$5,'APPROVED',$6,$6,NOW(),$6) ON CONFLICT (organization_id, party_id) DO NOTHING RETURNING id`, [c.org, c.le, v.id, cats[i], i === 0 ? "Procurement desk" : "Parts counter", c.admin]);
    if (!r.rows[0])
      continue;
    for (const [type, ref, exp] of [["NTN", `NTN-${441e4 + i}`, null], ["STRN", `STRN-32770${i}`, null], ["OEM_AUTHORISATION", `OEM-${i}-2026`, i === 0 ? "2026-10-20" : "2027-06-30"]]) {
      await q.query(`INSERT INTO sup_certificates (organization_id, legal_entity_id, profile_id, cert_type, reference, issued_on, expires_on, created_by) VALUES ($1,$2,$3,$4,$5,'2025-01-01',$6,$7)`, [c.org, c.le, r.rows[0].id, type, ref, exp, c.admin]);
    }
  }
});
registerSeeder("LOG", async (q, c) => {
  const vendor = (await q.query(`SELECT id FROM parties WHERE organization_id = $1 AND party_type IN ('VENDOR','BOTH') ORDER BY code LIMIT 1`, [c.org])).rows[0];
  const carriers = [
    ["TCS", "TCS Express", "COURIER", null, "https://www.tcsexpress.com/track/{tracking}"],
    ["LEOPARDS", "Leopards Courier", "COURIER", null, null],
    ["DAEWOO-CARGO", "Daewoo FastEx Cargo", "ROAD", vendor?.id ?? null, null],
    ["OWN", "OMNYSYNC service vans", "OWN_FLEET", null, null]
  ];
  for (const [code, name, mode, party, url] of carriers) {
    await q.query(`INSERT INTO log_carriers (organization_id, legal_entity_id, code, name, mode, party_id, tracking_url_template, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (organization_id, code) DO NOTHING`, [c.org, c.le, code, name, mode, party, url, c.admin]);
  }
});
registerSeeder("BI", async (q, c) => {
  const boards = [
    ["EXEC-OVERVIEW", "Executive overview", "Revenue trend, receivables risk, pipeline and field-service health.", [
      { dataset: "revenue_by_month", chart: "LINE", title: "Revenue by month", measure: "revenue" },
      { dataset: "ar_aging", chart: "BAR", title: "Receivables aging", measure: "outstanding" },
      { dataset: "pipeline_by_stage", chart: "BAR", title: "Weighted pipeline", measure: "weighted" },
      { dataset: "service_cases_by_status", chart: "BAR", title: "Service cases (YTD)", measure: "cases" },
      { dataset: "expense_by_account", chart: "TABLE", title: "Top expenses", measure: "amount" },
      { dataset: "stock_value_by_item", chart: "BAR", title: "Stock value (top items)", measure: "value" }
    ]],
    ["SERVICE-OPS", "Service operations", "SLA attainment and technician utilisation.", [
      { dataset: "service_sla_by_priority", chart: "BAR", title: "SLA attainment % by priority", measure: "attainment_pct" },
      { dataset: "technician_hours", chart: "BAR", title: "Approved hours per technician", measure: "hours" },
      { dataset: "service_cases_by_status", chart: "TABLE", title: "Cases by status", measure: "cases" }
    ]]
  ];
  for (const [code, name, desc, widgets] of boards) {
    await q.query(`INSERT INTO bi_dashboards (organization_id, legal_entity_id, code, name, description, widgets, visibility, created_by) VALUES ($1,$2,$3,$4,$5,$6,'SHARED',$7) ON CONFLICT (organization_id, code) DO NOTHING`, [c.org, c.le, code, name, desc, JSON.stringify(widgets), c.admin]);
  }
});
registerSeeder("FLT", async (q, c) => {
  const vans = [
    ["VAN-01", "LEB-21-4410", "Suzuki Every 660cc", 2022, "PETROL", "48210", "2027-03-31", "2026-10-15"],
    ["VAN-02", "LEC-23-1187", "Toyota Hiace 2.8", 2023, "DIESEL", "61540", "2026-12-31", "2027-01-31"],
    ["BIKE-01", "LEF-24-9022", "Honda CD 70", 2024, "PETROL", "12880", "2027-06-30", null]
  ];
  for (const [code, reg, mm, yr, fuel, odo, ins, fit] of vans) {
    await q.query(`INSERT INTO flt_vehicles (organization_id, legal_entity_id, code, registration, make_model, model_year, fuel_type, odometer_km, insurance_expiry, fitness_expiry, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (organization_id, code) DO NOTHING`, [c.org, c.le, code, reg, mm, yr, fuel, odo, ins, fit, c.admin]);
  }
});
registerSeeder("COM", async (q, c) => {
  const acc = (await q.query(`SELECT id FROM accounts WHERE organization_id = $1 AND code = '411007'`, [c.org])).rows[0];
  await q.query(`INSERT INTO items (id, organization_id, legal_entity_id, code, name, item_type, uom, unit_price, unit_cost, sales_account_id) VALUES (gen_random_uuid(), $1, $2, 'AMC-SUB', 'AMC subscription fee', 'SERVICE', 'PERIOD', 0, 0, $3) ON CONFLICT (organization_id, code) DO NOTHING`, [c.org, c.le, acc?.id ?? null]);
  const item = (await q.query(`SELECT id FROM items WHERE organization_id = $1 AND code = 'AMC-SUB'`, [c.org])).rows[0];
  const plans = [
    ["AMC-HOME", "Home AMC \u2014 up to 3 split units", "MONTHLY", "2500", 2, "Two preventive visits a year, priority response, labour included."],
    ["AMC-PLUS", "Home AMC Plus \u2014 up to 6 units", "QUARTERLY", "12000", 4, "Quarterly visits, gas top-up labour, 4-hour response."],
    ["AMC-COMM", "Commercial AMC \u2014 VRF / ducted", "ANNUAL", "180000", 12, "Monthly visits for commercial plant, 2-hour critical response."]
  ];
  for (const [code, name, interval, price, visits, desc] of plans) {
    await q.query(`INSERT INTO com_plans (organization_id, legal_entity_id, code, name, description, billing_interval, price, item_id, visits_per_year, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (organization_id, code) DO NOTHING`, [c.org, c.le, code, name, desc, interval, price, item.id, visits, c.admin]);
  }
});
registerSeeder("EPM", async (q, c) => {
  const b = await q.query(`INSERT INTO epm_budgets (organization_id, legal_entity_id, code, name, fiscal_year, scenario, version, notes, status, created_by) VALUES ($1,$2,'FY2026-OPS','FY2026 operating budget',2026,'BUDGET',1,'Demo budget \u2014 HVAC service revenue and core opex.','DRAFT',$3) ON CONFLICT (organization_id, code, version) DO NOTHING RETURNING id`, [c.org, c.le, c.admin]);
  if (!b.rows[0])
    return;
  const annual = { "411001": 36e6, "411002": 24e6, "411007": 6e6, "511001": 216e5, "521001": 36e5, "521002": 144e5, "521003": 18e5, "521011": 24e5, "521012": 9e5 };
  for (const [code, amt] of Object.entries(annual)) {
    const a = (await q.query(`SELECT id FROM accounts WHERE organization_id = $1 AND code = $2`, [c.org, code])).rows[0];
    if (!a)
      continue;
    for (let m = 1; m <= 12; m++) {
      const f = m >= 5 && m <= 8 ? 1.3 : m === 12 || m <= 2 ? 0.8 : 0.95;
      await q.query(`INSERT INTO epm_budget_lines (organization_id, budget_id, account_id, period_month, amount) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [c.org, b.rows[0].id, a.id, m, (amt / 12 * (code.startsWith("4") || code === "511001" ? f : 1)).toFixed(2)]);
    }
  }
});
registerSeeder("LND", async (q, c) => {
  const exists = (await q.query(`SELECT 1 FROM lnd_loans WHERE organization_id = $1 AND number = 'LN-DEMO-001'`, [c.org])).rows.length;
  if (exists)
    return;
  const party = (await q.query(`SELECT id FROM parties WHERE organization_id = $1 AND party_type IN ('CUSTOMER','BOTH') ORDER BY code LIMIT 1`, [c.org])).rows[0];
  if (!party)
    return;
  await q.query(`INSERT INTO lnd_loans (organization_id, legal_entity_id, number, party_id, purpose, principal, annual_rate, term_months, method, application_date, status, created_by) VALUES ($1,$2,'LN-DEMO-001',$3,'VRF upgrade financed over 12 months',850000,16,12,'ANNUITY',CURRENT_DATE,'DRAFT',$4)`, [c.org, c.le, party.id, c.admin]);
});
registerSeeder("GRC", async (q, c) => {
  const risks = [
    ["RSK-HVAC-01", "Refrigerant leak / gas handling injury on site", "SAFETY", 3, 5, 2, 4, "Service manager"],
    ["RSK-HVAC-02", "Fall from height during outdoor unit installation", "SAFETY", 3, 5, null, null, "Service manager"],
    ["RSK-FIN-01", "Technician cash collections not deposited", "FINANCIAL", 3, 3, 2, 2, "Controller"],
    ["RSK-OPS-01", "Warranty claims accepted outside coverage", "OPERATIONAL", 4, 2, null, null, "Service manager"],
    ["RSK-IT-01", "Customer data exposure from lost technician phone", "IT", 2, 4, null, null, "IT lead"]
  ];
  for (const [code, title, cat, l, i, rl, ri, owner] of risks) {
    await q.query(`INSERT INTO grc_risks (organization_id, legal_entity_id, code, title, category, owner, likelihood, impact, residual_likelihood, residual_impact, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'OPEN',$11) ON CONFLICT (organization_id, code) DO NOTHING`, [c.org, c.le, code, title, cat, owner, l, i, rl, ri, c.admin]);
  }
  const controls = [
    ["CTL-HVAC-01", "RSK-HVAC-01", "Leak detector + PPE checklist completed before charging", "PREVENTIVE", "MONTHLY"],
    ["CTL-FIN-01", "RSK-FIN-01", "Daily technician cash-up reconciled to job billing", "DETECTIVE", "MONTHLY"],
    ["CTL-OPS-01", "RSK-OPS-01", "Warranty eligibility check on case intake", "PREVENTIVE", "QUARTERLY"]
  ];
  for (const [code, risk, title, type, freq] of controls) {
    await q.query(`INSERT INTO grc_controls (organization_id, legal_entity_id, code, title, risk_id, control_type, frequency, owner, next_test_due, status, created_by) SELECT $1,$2,$3,$4,r.id,$5,$6,r.owner,CURRENT_DATE + 14,'OPERATING',$7 FROM grc_risks r WHERE r.organization_id = $1 AND r.code = $8 ON CONFLICT (organization_id, code) DO NOTHING`, [c.org, c.le, code, title, type, freq, c.admin, risk]);
  }
});
registerSeeder("TAL", async (q, c) => {
  const has = (await q.query(`SELECT 1 FROM tal_requisitions WHERE organization_id = $1 AND number = 'REQ-DEMO-001'`, [c.org])).rows.length;
  if (has)
    return;
  await q.query(`INSERT INTO tal_requisitions (organization_id, legal_entity_id, number, title, department, location, positions, salary_min, salary_max, justification, status, created_by) VALUES
     ($1,$2,'REQ-DEMO-001','HVAC Technician (split & VRF)','Field Service','Lahore',3,65000,95000,'Summer backlog: SLA breaches up; 3 extra technicians needed before May.','OPEN',$3),
     ($1,$2,'REQ-DEMO-002','Service Dispatcher','Field Service','Lahore',1,55000,75000,'Dispatch currently done by service manager.','DRAFT',$3)`, [c.org, c.le, c.admin]);
  const cands = [
    ["Ahmed Raza", "ahmed.raza@example.pk", "REFERRAL", "R-410A charging, VRF commissioning, brazing", 6],
    ["Bilal Hussain", "bilal.h@example.pk", "JOB_BOARD", "Split AC install, basic electrical", 2],
    ["Usman Tariq", "usman.tariq@example.pk", "WALK_IN", "Chiller maintenance, ducting", 9]
  ];
  for (const [n, e, s, sk, y] of cands) {
    await q.query(`INSERT INTO tal_candidates (organization_id, legal_entity_id, full_name, email, source, skills, years_experience, current_city, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,'Lahore',$8) ON CONFLICT DO NOTHING`, [c.org, c.le, n, e, s, sk, y, c.admin]);
  }
  await q.query(`INSERT INTO tal_applications (organization_id, legal_entity_id, requisition_id, candidate_id, status, created_by)
     SELECT $1, $2, r.id, k.id, CASE k.email WHEN 'ahmed.raza@example.pk' THEN 'INTERVIEW' WHEN 'usman.tariq@example.pk' THEN 'SCREENING' ELSE 'APPLIED' END, $3
     FROM tal_requisitions r, tal_candidates k WHERE r.organization_id = $1 AND r.number = 'REQ-DEMO-001' AND k.organization_id = $1 ON CONFLICT DO NOTHING`, [c.org, c.le, c.admin]);
});
registerSeeder("FX", async (q, c) => {
  const rates = [
    ["USD", "PKR", "278.500000000000", "2026-01-01"],
    ["USD", "PKR", "279.100000000000", "2026-02-01"],
    ["USD", "PKR", "278.850000000000", "2026-03-01"],
    ["EUR", "PKR", "302.200000000000", "2026-03-01"],
    ["GBP", "PKR", "355.800000000000", "2026-03-01"],
    ["AED", "PKR", "75.820000000000", "2026-03-01"],
    ["SAR", "PKR", "74.250000000000", "2026-03-01"]
  ];
  for (const [from, to, rate, dt] of rates) {
    await q.query(`INSERT INTO exchange_rates (id, organization_id, from_currency, to_currency, rate, effective_date, source)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'MANUAL')
       ON CONFLICT (organization_id, from_currency, to_currency, effective_date) DO NOTHING`, [c.org, from, to, rate, dt]);
  }
});
registerSeeder("TREASURY", async (q, c) => {
  const bankAcc = (await q.query(`SELECT id FROM accounts WHERE organization_id = $1 AND code = '111002'`, [c.org])).rows[0];
  if (!bankAcc)
    return;
  const stmtId = "80000000-0000-0000-0000-000000000001";
  await q.query(`INSERT INTO bank_statements (id, organization_id, legal_entity_id, bank_account_id, statement_reference, statement_date, opening_balance, closing_balance, status, created_by)
     VALUES ($1, $2, $3, $4, 'STMT-2026-03', '2026-03-31', 10000000, 11450000, 'RECONCILING', $5)
     ON CONFLICT (legal_entity_id, bank_account_id, statement_reference) DO NOTHING`, [stmtId, c.org, c.le, bankAcc.id, c.admin]);
  const lines = [
    [1, "2026-03-05", "450000.00", "CR-001", "Direct Customer Wire - Horizon Retail", false],
    [2, "2026-03-12", "-120000.00", "DR-002", "Utility Bill Direct Debit - K-Electric", false],
    [3, "2026-03-18", "1250000.00", "CR-003", "POS Daily Settlement - Merchant Batch 881", false],
    [4, "2026-03-25", "-130000.00", "DR-004", "Supplier Cheque Clearing - Apex Industrial", false]
  ];
  for (const [num, dt, amt, ref, desc, matched] of lines) {
    await q.query(`INSERT INTO bank_statement_lines (id, statement_id, line_number, transaction_date, amount, reference, description, is_matched)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (statement_id, line_number) DO NOTHING`, [stmtId, num, dt, amt, ref, desc, matched]);
  }
});
registerSeeder("RETAIL_EXTRA", async (q, c) => {
  const salesAcc = (await q.query(`SELECT id FROM accounts WHERE organization_id = $1 AND code = '411001'`, [c.org])).rows[0]?.id;
  const cogsAcc = (await q.query(`SELECT id FROM accounts WHERE organization_id = $1 AND code = '511001'`, [c.org])).rows[0]?.id;
  const invAcc = (await q.query(`SELECT id FROM accounts WHERE organization_id = $1 AND code = '113001'`, [c.org])).rows[0]?.id;
  const branch = (await q.query(`SELECT id FROM branches WHERE organization_id = $1 LIMIT 1`, [c.org])).rows[0]?.id;
  const wh = (await q.query(`SELECT id FROM warehouses WHERE organization_id = $1 ORDER BY is_default DESC LIMIT 1`, [c.org])).rows[0]?.id;
  const extraRetail = [
    { n: 20, code: "RTL-MILK-1L", name: "MilkPak Full Cream 1L", price: "290", cost: "240", qty: "120", tax: "0", cat: "DAIRY", barcode: "8961000000204" },
    { n: 21, code: "RTL-YOGURT-400", name: "Nestle Sweet Yogurt 400g", price: "160", cost: "125", qty: "80", tax: "0", cat: "DAIRY", barcode: "8961000000211" },
    { n: 22, code: "RTL-COKE-15", name: "Coca Cola 1.5L", price: "230", cost: "170", qty: "140", tax: "18", cat: "BEVERAGE", barcode: "8961000000228" },
    { n: 23, code: "RTL-SPRITE-15", name: "Sprite 1.5L", price: "230", cost: "170", qty: "100", tax: "18", cat: "BEVERAGE", barcode: "8961000000235" },
    { n: 24, code: "RTL-BISCUIT-LU", name: "LU Prince Chocolate Biscuits Half Roll", price: "60", cost: "42", qty: "250", tax: "18", cat: "SNACK", barcode: "8961000000242" },
    { n: 25, code: "RTL-SOAP-DOVE", name: "Dove Beauty Bar 100g", price: "240", cost: "185", qty: "110", tax: "18", cat: "HOUSEHOLD", barcode: "8961000000259" },
    { n: 26, code: "RTL-SHAMPOO-200", name: "Head & Shoulders Shampoo 200ml", price: "580", cost: "460", qty: "60", tax: "18", cat: "HOUSEHOLD", barcode: "8961000000266" },
    { n: 27, code: "RTL-RICE-BAS-5K", name: "Guard Super Basmati Rice 5kg", price: "2450", cost: "2100", qty: "45", tax: "0", cat: "GROCERY", barcode: "8961000000273" },
    { n: 28, code: "RTL-SUGAR-1K", name: "Refined White Sugar 1kg", price: "160", cost: "135", qty: "300", tax: "0", cat: "GROCERY", barcode: "8961000000280" },
    { n: 29, code: "RTL-FLOUR-10K", name: "Sunridge Chakki Atta 10kg", price: "1450", cost: "1280", qty: "50", tax: "0", cat: "GROCERY", barcode: "8961000000297" },
    { n: 30, code: "RTL-APPLE-KG", name: "Kala Kulla Apples (per kg)", price: "340", cost: "260", qty: "75", tax: "0", cat: "PRODUCE", plu: "00044", weighed: true },
    { n: 31, code: "RTL-POTATO-KG", name: "Fresh Potatoes (per kg)", price: "90", cost: "60", qty: "200", tax: "0", cat: "PRODUCE", plu: "00045", weighed: true },
    { n: 32, code: "RTL-CHICKEN-KG", name: "Fresh Whole Chicken (per kg)", price: "620", cost: "510", qty: "90", tax: "0", cat: "MEAT", plu: "00051", weighed: true },
    { n: 33, code: "RTL-USB-DRIVE", name: "SanDisk 64GB USB 3.0 Flash Drive", price: "1650", cost: "1150", qty: "35", tax: "18", cat: "ELECTRONICS", barcode: "8961000000334" },
    { n: 34, code: "RTL-HDMI-CBL", name: "High-Speed HDMI Cable 2.0 (2m)", price: "850", cost: "480", qty: "40", tax: "18", cat: "ELECTRONICS", barcode: "8961000000341" },
    { n: 35, code: "RTL-LED-12W", name: "Philips 12W Cool Daylight LED Bulb", price: "450", cost: "310", qty: "120", tax: "18", cat: "HOUSEHOLD", barcode: "8961000000358" }
  ];
  for (const r of extraRetail) {
    const id = `71000000-0000-0000-0000-${String(r.n).padStart(12, "0")}`;
    await q.query(`INSERT INTO items (id, organization_id, legal_entity_id, code, name, item_type, uom, unit_price, unit_cost,
         sales_account_id, cogs_account_id, inventory_account_id, is_active, barcode, plu_code, tax_rate, is_weighed, category, reorder_point, reorder_qty)
       VALUES ($1,$2,$3,$4,$5,'INVENTORY',$6,$7,$8,$9,$10,$11,true,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (organization_id, code) DO UPDATE SET name = EXCLUDED.name, unit_price = EXCLUDED.unit_price, barcode = EXCLUDED.barcode, plu_code = EXCLUDED.plu_code`, [
      id,
      c.org,
      c.le,
      r.code,
      r.name,
      r.weighed ? "KG" : "UNIT",
      r.price,
      r.cost,
      salesAcc,
      cogsAcc,
      invAcc,
      r.barcode ?? null,
      r.plu ?? null,
      r.tax,
      !!r.weighed,
      r.cat,
      r.weighed ? "10" : "20",
      r.weighed ? "50" : "100"
    ]);
    if (branch && wh) {
      await q.query(`INSERT INTO stock_movements (id, organization_id, legal_entity_id, item_id, warehouse_id, location_id,
           movement_type, movement_date, quantity, unit_cost, total_value, description)
         VALUES ($1,$2,$3,$4,$5,$6,'OPENING','2026-03-01',$7,$8,$9,'Retail extra stock')
         ON CONFLICT (id) DO NOTHING`, [`7b000000-0000-0000-0000-${String(r.n).padStart(12, "0")}`, c.org, c.le, id, branch, wh, r.qty, r.cost, (Number(r.cost) * Number(r.qty)).toFixed(8)]);
    }
  }
  const reg2 = "72000000-0000-0000-0000-000000000002";
  const reg3 = "72000000-0000-0000-0000-000000000003";
  if (wh) {
    await q.query(`INSERT INTO pos_registers (id, register_code, name, warehouse_id, is_active, organization_id, default_tax_rate, max_cashier_discount_percent, receipt_header, receipt_footer)
       VALUES ($1, 'POS-02', 'Express Checkout 2', $2, true, $3, '18', '10', 'OMNYSYNC MART - EXPRESS', 'Thank you for shopping!'),
              ($4, 'POS-03', 'Customer Service & Returns', $2, true, $3, '18', '15', 'OMNYSYNC MART - RETURNS DESK', 'Returns policy applies.')
       ON CONFLICT (organization_id, register_code) DO NOTHING`, [reg2, wh, c.org, reg3]);
  }
});
registerSeeder("TRADING", async (q, c) => {
  const cust = (await q.query(`SELECT id FROM parties WHERE organization_id = $1 AND code = 'CUST-001'`, [c.org])).rows[0];
  const cust2 = (await q.query(`SELECT id FROM parties WHERE organization_id = $1 AND code = 'CUST-002'`, [c.org])).rows[0];
  const vend = (await q.query(`SELECT id FROM parties WHERE organization_id = $1 AND code = 'VEND-001'`, [c.org])).rows[0];
  const itmSrv = (await q.query(`SELECT id FROM items WHERE organization_id = $1 AND code = 'ITEM-SRV-01'`, [c.org])).rows[0];
  const itmSw = (await q.query(`SELECT id FROM items WHERE organization_id = $1 AND code = 'ITEM-SW-48'`, [c.org])).rows[0];
  const itmCat6 = (await q.query(`SELECT id FROM items WHERE organization_id = $1 AND code = 'ITEM-CAT6-BOX'`, [c.org])).rows[0];
  const bankAcc = (await q.query(`SELECT id FROM accounts WHERE organization_id = $1 AND code = '111002'`, [c.org])).rows[0];
  if (cust && itmSrv && itmSw) {
    const soId = "90000000-0000-0000-0000-000000000001";
    await q.query(`INSERT INTO sales_orders (id, organization_id, legal_entity_id, party_id, order_number, order_date, delivery_date, status, subtotal, tax_amount, total_amount, notes, created_by)
       VALUES ($1, $2, $3, $4, 'SO-2026-0001', '2026-03-10', '2026-03-20', 'CONFIRMED', 1260000, 226800, 1486800, 'Data Center Server & Switch Supply', $5)
       ON CONFLICT (legal_entity_id, order_number) DO NOTHING`, [soId, c.org, c.le, cust.id, c.admin]);
    await q.query(`INSERT INTO sales_order_lines (id, sales_order_id, line_number, item_id, quantity, unit_price, line_total, description)
       VALUES (gen_random_uuid(), $1, 1, $2, 2, 450000, 900000, 'Server Rack Unit'),
              (gen_random_uuid(), $1, 2, $3, 2, 180000, 360000, 'Managed Switch 48-Port')
       ON CONFLICT (sales_order_id, line_number) DO NOTHING`, [soId, itmSrv.id, itmSw.id]);
    const invId = "91000000-0000-0000-0000-000000000001";
    await q.query(`INSERT INTO ar_invoices (id, organization_id, legal_entity_id, party_id, sales_order_id, invoice_number, invoice_date, due_date, status, subtotal, tax_amount, total_amount, outstanding_amount, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, 'INV-2026-0001', '2026-03-12', '2026-04-11', 'POSTED', 1260000, 226800, 1486800, 1486800, 'Invoice for SO-2026-0001', $6)
       ON CONFLICT (legal_entity_id, invoice_number) DO NOTHING`, [invId, c.org, c.le, cust.id, soId, c.admin]);
    await q.query(`INSERT INTO ar_invoice_lines (id, invoice_id, line_number, item_id, quantity, unit_price, line_total, description)
       VALUES (gen_random_uuid(), $1, 1, $2, 2, 450000, 900000, 'Server Rack Unit'),
              (gen_random_uuid(), $1, 2, $3, 2, 180000, 360000, 'Managed Switch 48-Port')
       ON CONFLICT (invoice_id, line_number) DO NOTHING`, [invId, itmSrv.id, itmSw.id]);
  }
  if (vend && itmCat6) {
    const poId = "92000000-0000-0000-0000-000000000001";
    await q.query(`INSERT INTO purchase_orders (id, organization_id, legal_entity_id, party_id, po_number, po_date, expected_date, status, subtotal, tax_amount, total_amount, notes, created_by)
       VALUES ($1, $2, $3, $4, 'PO-2026-0001', '2026-03-05', '2026-03-15', 'APPROVED', 200000, 36000, 236000, 'Bulk Cat6 Cable Procurement', $5)
       ON CONFLICT (legal_entity_id, po_number) DO NOTHING`, [poId, c.org, c.le, vend.id, c.admin]);
    await q.query(`INSERT INTO purchase_order_lines (id, purchase_order_id, line_number, item_id, quantity, unit_price, line_total, description)
       VALUES (gen_random_uuid(), $1, 1, $2, 40, 5000, 200000, 'Cat6 Cable Box')
       ON CONFLICT (purchase_order_id, line_number) DO NOTHING`, [poId, itmCat6.id]);
    const billId = "93000000-0000-0000-0000-000000000001";
    await q.query(`INSERT INTO ap_invoices (id, organization_id, legal_entity_id, party_id, purchase_order_id, invoice_number, invoice_date, due_date, status, subtotal, tax_amount, total_amount, outstanding_amount, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, 'BILL-2026-0001', '2026-03-08', '2026-04-07', 'POSTED', 200000, 36000, 236000, 236000, 'Apex Supplies Invoice for PO-2026-0001', $6)
       ON CONFLICT (legal_entity_id, invoice_number) DO NOTHING`, [billId, c.org, c.le, vend.id, poId, c.admin]);
    await q.query(`INSERT INTO ap_invoice_lines (id, invoice_id, line_number, item_id, quantity, unit_price, line_total, description)
       VALUES (gen_random_uuid(), $1, 1, $2, 40, 5000, 200000, 'Cat6 Cable Box')
       ON CONFLICT (invoice_id, line_number) DO NOTHING`, [billId, itmCat6.id]);
  }
});
registerSeeder("HRM_PAYROLL", async (q, c) => {
  const depts = [
    ["DEPT-EXEC", "Executive Management"],
    ["DEPT-FIN", "Finance & Accounting"],
    ["DEPT-ENG", "Engineering & Operations"],
    ["DEPT-SRV", "Field Service & HVAC"],
    ["DEPT-SALES", "Commercial & Sales"],
    ["DEPT-HR", "Human Resources"]
  ];
  for (const [code, name] of depts) {
    await q.query(`INSERT INTO departments (id, organization_id, legal_entity_id, code, name, is_active)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, true)
       ON CONFLICT (legal_entity_id, code) DO NOTHING`, [c.org, c.le, code, name]);
  }
  const desigs = [
    ["DESIG-CEO", "Chief Executive Officer"],
    ["DESIG-CFO", "Chief Financial Officer"],
    ["DESIG-ENG-SR", "Senior Systems Engineer"],
    ["DESIG-TECH-LEAD", "Lead HVAC Technician"],
    ["DESIG-ACC-SR", "Senior Accountant"],
    ["DESIG-SALES-MGR", "Commercial Sales Manager"]
  ];
  for (const [code, title] of desigs) {
    await q.query(`INSERT INTO designations (id, organization_id, legal_entity_id, code, title, is_active)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, true)
       ON CONFLICT (legal_entity_id, code) DO NOTHING`, [c.org, c.le, code, title]);
  }
  const salStructures = [
    ["Executive Grade E1", "PKR", 3e5, 1e5, 3e4, 2e4, 0, 45e4],
    ["Senior Professional P3", "PKR", 14e4, 5e4, 15e3, 15e3, 0, 22e4],
    ["Technical Specialist T2", "PKR", 6e4, 2e4, 5e3, 5e3, 0, 9e4]
  ];
  for (const [name, curr, basic, hra, util, med, other, gross] of salStructures) {
    await q.query(`INSERT INTO salary_structures (id, organization_id, legal_entity_id, name, currency, basic_salary, house_rent_allowance, utility_allowance, medical_allowance, other_allowances, gross_salary, is_active)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
       ON CONFLICT DO NOTHING`, [c.org, c.le, name, curr, basic, hra, util, med, other, gross]);
  }
});
registerSeeder("MANUFACTURING", async (q, c) => {
  const finished = (await q.query(`SELECT id FROM items WHERE organization_id = $1 AND code = 'ITEM-SRV-01'`, [c.org])).rows[0];
  const comp1 = (await q.query(`SELECT id FROM items WHERE organization_id = $1 AND code = 'ITEM-SW-48'`, [c.org])).rows[0];
  const comp2 = (await q.query(`SELECT id FROM items WHERE organization_id = $1 AND code = 'ITEM-CAT6-BOX'`, [c.org])).rows[0];
  const wh = (await q.query(`SELECT id FROM warehouses WHERE organization_id = $1 ORDER BY is_default ASC LIMIT 1`, [c.org])).rows[0];
  if (!finished || !comp1 || !comp2 || !wh)
    return;
  const bomId = "94000000-0000-0000-0000-000000000001";
  await q.query(`INSERT INTO bill_of_materials (id, organization_id, bom_number, finished_item_id, name, version, yield_quantity, status)
     VALUES ($1, $2, 'BOM-SRV-RACK', $3, 'Enterprise Server Rack Assembly BOM', '1.0', 1.0, 'ACTIVE')
     ON CONFLICT (organization_id, bom_number) DO NOTHING`, [bomId, c.org, finished.id]);
  await q.query(`INSERT INTO bom_items (id, bom_id, component_item_id, quantity, scrap_percentage, notes)
     VALUES (gen_random_uuid(), $1, $2, 2, 0, '2x Managed Switches'),
            (gen_random_uuid(), $1, $3, 4, 2.5, '4x Cat6 Cable Boxes')
     ON CONFLICT DO NOTHING`, [bomId, comp1.id, comp2.id]);
  await q.query(`INSERT INTO work_orders (id, organization_id, work_order_number, bom_id, finished_item_id, warehouse_id, target_qty, completed_qty, status, start_date, due_date)
     VALUES (gen_random_uuid(), $1, 'WO-2026-001', $2, $3, $4, 5, 0, 'IN_PROGRESS', '2026-03-15', '2026-03-30')
     ON CONFLICT (organization_id, work_order_number) DO NOTHING`, [c.org, bomId, finished.id, wh.id]);
});
registerSeeder("PROJECTS", async (q, c) => {
  const cust = (await q.query(`SELECT id FROM parties WHERE organization_id = $1 AND party_type IN ('CUSTOMER','BOTH') LIMIT 1`, [c.org])).rows[0];
  const ccId = "95000000-0000-0000-0000-000000000001";
  await q.query(`INSERT INTO cost_centers (id, organization_id, code, name, cost_center_type, manager_name)
     VALUES ($1, $2, 'CC-KHI-DC', 'Karachi Data Center Projects', 'PROJECT', 'Director Projects')
     ON CONFLICT (organization_id, code) DO NOTHING`, [ccId, c.org]);
  const prjId = "95000000-0000-0000-0000-000000000002";
  await q.query(`INSERT INTO projects (id, organization_id, code, name, customer_id, manager_name, project_type, contract_value, budgeted_cost, retention_percentage, status, start_date, end_date, cost_center_id)
     VALUES ($1, $2, 'PRJ-2026-001', 'Karachi Tier-3 Data Center Expansion', $3, 'Engr. Farhan Siddiqui', 'EPC', 35000000, 24000000, 5.0, 'IN_PROGRESS', '2026-01-15', '2026-12-31', $4)
     ON CONFLICT (organization_id, code) DO NOTHING`, [prjId, c.org, cust?.id ?? null, ccId]);
  await q.query(`INSERT INTO project_wbs_nodes (id, project_id, wbs_code, name, budget_cost, progress_percentage, status)
     VALUES (gen_random_uuid(), $1, '1.0', 'Civil & Raised Flooring', 6000000, 100, 'COMPLETED'),
            (gen_random_uuid(), $1, '2.0', 'HVAC Precision Cooling & Containment', 10000000, 65, 'IN_PROGRESS'),
            (gen_random_uuid(), $1, '3.0', 'Power Infrastructure & UPS Busways', 8000000, 40, 'IN_PROGRESS')
     ON CONFLICT (project_id, wbs_code) DO NOTHING`, [prjId]);
});
registerSeeder("FIXED_ASSETS", async (q, c) => {
  const assetCatId = "96000000-0000-0000-0000-000000000001";
  await q.query(`INSERT INTO asset_categories (id, organization_id, code, name, depreciation_method, useful_life_months, salvage_value_percentage)
     VALUES ($1, $2, 'CAT-MACHINERY', 'Heavy Plant Machinery & Equipment', 'STRAIGHT_LINE', 60, 5.0)
     ON CONFLICT (organization_id, code) DO NOTHING`, [assetCatId, c.org]);
  await q.query(`INSERT INTO fixed_assets (id, organization_id, asset_number, name, category_id, acquisition_date, acquisition_cost, salvage_value, useful_life_months, depreciation_method, status, location, custodian_name, current_book_value, accumulated_depreciation)
     VALUES (gen_random_uuid(), $1, 'AST-FL-001', 'Toyota 3-Ton Electric Forklift', $2, '2025-01-01', 4500000, 225000, 60, 'STRAIGHT_LINE', 'ACTIVE', 'Central Warehouse KHI', 'Warehouse Incharge', 3645000, 855000),
            (gen_random_uuid(), $1, 'AST-GEN-002', 'Perkins 150kVA Standby Generator', $2, '2024-06-01', 5800000, 290000, 60, 'STRAIGHT_LINE', 'ACTIVE', 'Karachi Plant Substation', 'Plant Maintenance Lead', 3866666, 1933334)
     ON CONFLICT (organization_id, asset_number) DO NOTHING`, [c.org, assetCatId]);
});
registerSeeder("QUALITY", async (q, c) => {
  const itm = (await q.query(`SELECT id FROM items WHERE organization_id = $1 AND code = 'ITEM-SW-48'`, [c.org])).rows[0];
  if (!itm)
    return;
  const planId = "97000000-0000-0000-0000-000000000001";
  await q.query(`INSERT INTO quality_inspection_plans (id, organization_id, plan_code, name, item_id, inspection_type, sample_size, status)
     VALUES ($1, $2, 'QP-SW-INCOMING', 'Managed Switch Receiving Quality Checklist', $3, 'RECEIVING', 2.0, 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`, [planId, c.org, itm.id]);
  await q.query(`INSERT INTO quality_inspection_plan_params (id, plan_id, param_name, data_type, target_value, min_tolerance, max_tolerance, uom, is_mandatory)
     VALUES (gen_random_uuid(), $1, 'PoE Output Voltage', 'NUMERIC', '48.0', 46.0, 52.0, 'V', true),
            (gen_random_uuid(), $1, 'Port Link Integrity Check', 'BOOLEAN', 'true', null, null, null, true)
     ON CONFLICT (id) DO NOTHING`, [planId]);
  const lotId = "97000000-0000-0000-0000-000000000002";
  await q.query(`INSERT INTO quality_inspection_lots (id, organization_id, legal_entity_id, lot_number, source_type, item_id, batch_number, quantity, status, usage_decision_notes)
     VALUES ($1, $2, $3, 'QLOT-2026-001', 'GRN', $4, 'BATCH-2026-Q1', 25, 'ACCEPTED', 'All 48 ports and PoE parameters verified compliant.')
     ON CONFLICT (id) DO NOTHING`, [lotId, c.org, c.le, itm.id]);
});
registerSeeder("MAINTENANCE", async (q, c) => {
  const eqId = "98000000-0000-0000-0000-000000000001";
  await q.query(`INSERT INTO maintenance_equipment (id, organization_id, legal_entity_id, equipment_code, name, category, location, criticality, status, operating_hours)
     VALUES ($1, $2, $3, 'EQ-CHILLER-HQ', 'Carrier 60TR Central Screw Chiller', 'HVAC', 'HQ Plant Room', 'HIGH', 'OPERATIONAL', 4200)
     ON CONFLICT (id) DO NOTHING`, [eqId, c.org, c.le]);
  const schedId = "98000000-0000-0000-0000-000000000002";
  await q.query(`INSERT INTO pm_schedules (id, organization_id, equipment_id, schedule_name, frequency_type, frequency_interval, next_due_date, status)
     VALUES ($1, $2, $3, 'Quarterly Oil & Filter Preventive Service', 'TIME_BASED_DAYS', 90, '2026-04-15', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`, [schedId, c.org, eqId]);
  await q.query(`INSERT INTO maintenance_work_orders (id, organization_id, legal_entity_id, work_order_number, equipment_id, pm_schedule_id, order_type, priority, status, description, total_cost)
     VALUES (gen_random_uuid(), $1, $2, 'MWO-2026-001', $3, $4, 'PREVENTIVE', 'HIGH', 'COMPLETED', 'Completed 90-day oil change, refrigerant pressure check and coil wash.', 45000)
     ON CONFLICT (id) DO NOTHING`, [c.org, c.le, eqId, schedId]);
});
registerSeeder("HRM_WORKMAN_EXTRA", async (q, c) => {
  const geo1 = "99000000-0000-0000-0000-000000000001";
  const geo2 = "99000000-0000-0000-0000-000000000002";
  await q.query(`INSERT INTO hrm_geofence_zones (id, organization_id, code, name, latitude, longitude, radius_meters, is_active)
     VALUES ($1, $2, 'GEO-KHI-HQ', 'Karachi Main Operations HQ', 24.8607000, 67.0011000, 150.0, true),
            ($3, $2, 'GEO-LHR-GUL', 'Lahore Service Center - Gulberg III', 31.5204000, 74.3587000, 200.0, true)
     ON CONFLICT (organization_id, code) DO NOTHING`, [geo1, c.org, geo2]);
  const shift1 = "99100000-0000-0000-0000-000000000001";
  const shift2 = "99100000-0000-0000-0000-000000000002";
  await q.query(`INSERT INTO hrm_shifts (id, organization_id, code, name, start_time, end_time, grace_period_minutes, half_day_hours, is_active)
     VALUES ($1, $2, 'SHIFT-STD-0918', 'Standard Office Shift (09:00 - 18:00)', '09:00', '18:00', 15, 4.5, true),
            ($3, $2, 'SHIFT-FIELD-0817', 'Field Technician Roster (08:00 - 17:00)', '08:00', '17:00', 20, 4.0, true)
     ON CONFLICT (organization_id, code) DO NOTHING`, [shift1, c.org, shift2]);
  const ltAnnual = "99200000-0000-0000-0000-000000000001";
  const ltSick = "99200000-0000-0000-0000-000000000002";
  const ltCasual = "99200000-0000-0000-0000-000000000003";
  await q.query(`INSERT INTO hrm_leave_types (id, organization_id, code, name, annual_quota, is_paid, is_active)
     VALUES ($1, $2, 'ANNUAL', 'Annual Paid Leave', 14, true, true),
            ($3, $2, 'SICK', 'Medical / Sick Leave', 8, true, true),
            ($4, $2, 'CASUAL', 'Casual / Personal Leave', 10, true, true)
     ON CONFLICT (organization_id, code) DO NOTHING`, [ltAnnual, c.org, ltSick, ltCasual]);
  const emps = (await q.query(`SELECT id FROM employees WHERE organization_id = $1 LIMIT 5`, [c.org])).rows;
  for (const emp of emps) {
    await q.query(`INSERT INTO hrm_leave_allocations (id, organization_id, employee_id, leave_type_id, year, allocated_days, used_days, remaining_days)
       VALUES (gen_random_uuid(), $1, $2, $3, 2026, 14, 2, 12),
              (gen_random_uuid(), $1, $2, $4, 2026, 8, 1, 7)
       ON CONFLICT (employee_id, leave_type_id, year) DO NOTHING`, [c.org, emp.id, ltAnnual, ltSick]);
  }
  if (emps[0]) {
    const advId = "99300000-0000-0000-0000-000000000001";
    await q.query(`INSERT INTO hrm_advances (id, organization_id, legal_entity_id, number, employee_id, advance_type, amount, purpose, repayment_months, monthly_deduction, recovered_amount, balance_amount, status, created_by)
       VALUES ($1, $2, $3, 'ADV-2026-001', $4, 'PARTS_FLOAT', 45000, 'Emergency site spare parts float (VRF valves)', 3, 15000, 15000, 30000, 'DISBURSED', $5)
       ON CONFLICT (organization_id, number) DO NOTHING`, [advId, c.org, c.le, emps[0].id, c.admin]);
    await q.query(`INSERT INTO hrm_advance_installments (id, advance_id, installment_number, due_date, amount, recovered_amount, status)
       VALUES (gen_random_uuid(), $1, 1, '2026-02-28', 15000, 15000, 'DEDUCTED_IN_PAYROLL'),
              (gen_random_uuid(), $1, 2, '2026-03-31', 15000, 0, 'PENDING'),
              (gen_random_uuid(), $1, 3, '2026-04-30', 15000, 0, 'PENDING')
       ON CONFLICT (advance_id, installment_number) DO NOTHING`, [advId]);
  }
  if (emps[0]) {
    await q.query(`INSERT INTO hrm_attendance_logs (id, organization_id, employee_id, work_date, shift_id, check_in_time, check_out_time, check_in_lat, check_in_lng, geofence_zone_id, geofence_status, verification_method, status, total_hours, notes)
       VALUES (gen_random_uuid(), $1, $2, '2026-03-30', $3, '2026-03-30 08:58:00+05', '2026-03-30 18:02:00+05', 24.8607100, 67.0011200, $4, 'INSIDE_GEOFENCE', 'FACE_VERIFIED', 'PRESENT', 9.06, 'On-time biometric + GPS check-in')
       ON CONFLICT (employee_id, work_date) DO NOTHING`, [c.org, emps[0].id, shift1, geo1]);
  }
  if (emps[0]) {
    await q.query(`INSERT INTO hrm_expense_claims (id, organization_id, legal_entity_id, number, employee_id, claim_date, category, amount, description, receipt_reference, status, created_by)
       VALUES (gen_random_uuid(), $1, $2, 'EXP-2026-001', $3, '2026-03-25', 'FUEL', 8500, 'Fuel refill for site survey van (LEB-21-4410)', 'PSO-RECEIPT-88912', 'APPROVED', $4),
              (gen_random_uuid(), $1, $2, 'EXP-2026-002', $3, '2026-03-28', 'TOOLS', 12500, 'Refrigerant manifold gauge set replacement', 'TOOL-INV-4419', 'SUBMITTED', $4)
       ON CONFLICT (organization_id, number) DO NOTHING`, [c.org, c.le, emps[0].id, c.admin]);
  }
});

// apps/api/dist/routes/admin.js
function registerAdminRoutes(app) {
  app.post("/api/admin/seed", authenticate, requirePermission(Permission25.ORG_MANAGE), async (req, res) => {
    if (process.env.NODE_ENV === "production" && process.env.OMNYSYNC_DEMO_MODE !== "true") {
      throw new ApiError(403, ErrorCode34.MODULE_NOT_READY, "Synthetic seeding is only available in demo/sandbox installations");
    }
    const seeder = new SyntheticSeedRunner(db);
    const result = await seeder.runSeed();
    await seedModules(db);
    await auditLogger.record({
      organization_id: req.session.organization_id,
      user_id: req.session.user_id,
      action: "DEMO_SEED_EXECUTED",
      entity_type: "ORGANIZATION",
      entity_id: req.session.organization_id,
      correlation_id: req.correlationId
    });
    return ok(req, res, result);
  });
}

// apps/api/dist/app.js
init_config();

// apps/api/dist/routes/tax.js
init_context();
init_http();
init_errors();
init_resource();
init_validate();
init_posting();
init_tax();
import { Permission as Permission26, ErrorCode as ErrorCode35, AccountingPurpose as AccountingPurpose18 } from "@omnysync/contracts";
import { Money as Money26 } from "@omnysync/financial-engine";
async function ledgerTax(q, org, from, to) {
  const r = await q.query(`SELECT a.code, COALESCE(SUM(jl.base_credit - jl.base_debit),0)::text AS net
     FROM journal_lines jl JOIN journals j ON j.id = jl.journal_id JOIN accounts a ON a.id = jl.account_id
     WHERE j.organization_id = $1 AND j.status = 'POSTED' AND j.posting_date BETWEEN $2 AND $3 AND a.code IN ('212001','114001')
       AND COALESCE(j.source_type,'') <> 'TAX_RETURN'
     GROUP BY a.code`, [org, from, to]);
  const by = new Map(r.rows.map((x) => [x.code, new Money26(x.net)]));
  const output = (by.get("212001") || Money26.zero()).round(2);
  const input = (by.get("114001") || Money26.zero()).negated().round(2);
  return { output: output.toFixed(2), input: input.toFixed(2), net: output.sub(input).toFixed(2) };
}
function registerTaxRoutes(app) {
  defineResource(app, {
    path: "/api/tax/codes",
    table: "tax_codes",
    label: "Tax code",
    event: "TAX_CODE",
    module: "TAX",
    view: [Permission26.TAX_VIEW, Permission26.TAX_MANAGE],
    create: Permission26.TAX_MANAGE,
    update: Permission26.TAX_MANAGE,
    fields: {
      code: { type: "string", required: true, max: 32, pattern: /^[A-Z0-9_-]+$/ },
      name: { type: "string", required: true },
      kind: { type: "enum", values: ["OUTPUT", "INPUT", "WITHHOLDING", "EXEMPT"], required: true },
      rate: { type: "decimal", required: true, scale: 4 },
      is_inclusive: { type: "bool" },
      account_code: { type: "string", max: 16 },
      effective_from: { type: "date", required: true },
      effective_to: { type: "date" }
    },
    editable: ["name", "effective_to", "account_code"],
    search: ["code", "name"],
    filters: ["kind"],
    orderBy: "t.code, t.effective_from DESC",
    beforeCreate: async (ctx, v) => {
      if (Number(v.rate) > 100)
        throw validationError("rate cannot exceed 100", { field: "rate" });
      if (v.effective_to && v.effective_to < v.effective_from)
        throw validationError("effective_to must be on or after effective_from", { field: "effective_to" });
      const existing = await ctx.tx.query(`SELECT * FROM tax_codes WHERE organization_id = $1 AND code = $2 AND status = 'ACTIVE' FOR UPDATE`, [ctx.org, v.code]);
      for (const e of existing.rows) {
        if (windowsOverlap(v.effective_from, v.effective_to, toIsoDate(e.effective_from), e.effective_to ? toIsoDate(e.effective_to) : null)) {
          throw new ApiError(409, ErrorCode35.DUPLICATE_RESOURCE, `Tax code ${v.code} already has a version effective ${toIsoDate(e.effective_from)}${e.effective_to ? ` \u2013 ${toIsoDate(e.effective_to)}` : " onwards"}; end-date it first`, { field: "effective_from" });
        }
      }
    },
    commands: { retire: { from: ["ACTIVE"], to: "RETIRED", permission: Permission26.TAX_MANAGE } }
  });
  app.post("/api/tax/calculate", authenticate, requireAnyPermission(Permission26.TAX_VIEW, Permission26.TAX_MANAGE), async (req, res) => {
    const org = req.session.organization_id;
    const lines = arrayOf(req.body?.lines, "lines", { min: 1, max: 200 });
    const codes = (await db.query(`SELECT * FROM tax_codes WHERE organization_id = $1`, [org])).rows;
    let net = Money26.zero();
    let tax = Money26.zero();
    const out = lines.map((l, i) => {
      const amount = decimal(l.amount, `lines[${i}].amount`, { sign: "nonNegative", scale: 4 });
      const date = dateOnly(l.date || todayIso(), `lines[${i}].date`);
      const code = str(l.tax_code, `lines[${i}].tax_code`, { max: 32 });
      const version = effectiveCode(codes.filter((c) => c.code === code).map((c) => ({ ...c, effective_from: toIsoDate(c.effective_from), effective_to: c.effective_to ? toIsoDate(c.effective_to) : null })), date);
      if (!version)
        throw new ApiError(400, ErrorCode35.MAPPING_MISSING, `No tax code ${code} effective on ${date}`, { field: `lines[${i}].tax_code` });
      const r = computeTax({ amount, rate: String(version.rate), inclusive: l.inclusive ?? version.is_inclusive });
      net = net.add(r.net);
      tax = tax.add(r.tax);
      return { ...r, tax_code: code, rate: new Money26(version.rate).toFixed(4), effective_from: version.effective_from };
    });
    return ok(req, res, { lines: out, total_net: net.toFixed(2), total_tax: tax.toFixed(2), total_gross: net.add(tax).toFixed(2) });
  });
  app.get("/api/tax/summary", authenticate, requireAnyPermission(Permission26.TAX_VIEW, Permission26.TAX_MANAGE), async (req, res) => {
    const org = req.session.organization_id;
    const y = todayIso().slice(0, 7);
    const t = await ledgerTax(db, org, `${y}-01`, todayIso());
    const counts = (await db.query(`SELECT status, COUNT(*)::int n FROM tax_returns WHERE organization_id = $1 GROUP BY status`, [org])).rows;
    const codes = (await db.query(`SELECT COUNT(*)::int n FROM tax_codes WHERE organization_id = $1 AND status = 'ACTIVE'`, [org])).rows[0].n;
    return ok(req, res, { month_to_date: t, returns: Object.fromEntries(counts.map((c) => [c.status, c.n])), active_codes: codes });
  });
  defineResource(app, {
    path: "/api/tax/returns",
    table: "tax_returns",
    label: "Tax return",
    event: "TAX_RETURN",
    module: "TAX",
    view: [Permission26.TAX_VIEW, Permission26.TAX_MANAGE],
    create: Permission26.TAX_MANAGE,
    update: false,
    fields: { period_start: { type: "date", required: true }, period_end: { type: "date", required: true }, notes: { type: "text" } },
    numbering: { column: "number", prefix: "TAXR", dateField: "period_end" },
    initialStatus: "DRAFT",
    search: ["number"],
    orderBy: "t.period_start DESC",
    beforeCreate: async (ctx, v) => {
      if (v.period_end < v.period_start)
        throw validationError("period_end must be on or after period_start", { field: "period_end" });
      const t = await ledgerTax(ctx.tx, ctx.org, v.period_start, v.period_end);
      v.output_tax = t.output;
      v.input_tax = t.input;
      v.net_payable = t.net;
    },
    commands: {
      recalculate: {
        from: ["DRAFT"],
        permission: Permission26.TAX_MANAGE,
        run: async (ctx, row) => {
          const t = await ledgerTax(ctx.tx, ctx.org, toIsoDate(row.period_start), toIsoDate(row.period_end));
          return { set: { output_tax: t.output, input_tax: t.input, net_payable: t.net } };
        }
      },
      file: {
        from: ["DRAFT"],
        to: "FILED",
        permission: Permission26.TAX_FILE,
        sodColumn: "created_by",
        fields: { filing_reference: { type: "string", required: true, max: 80 } },
        run: async (ctx, row, input) => {
          const t = await ledgerTax(ctx.tx, ctx.org, toIsoDate(row.period_start), toIsoDate(row.period_end));
          if (!new Money26(t.net).eq(row.net_payable)) {
            throw new ApiError(409, ErrorCode35.STALE_REVISION, `Ledger tax changed since preparation (now ${t.net}); recalculate before filing`);
          }
          return { set: { filing_reference: input.filing_reference, filed_by: ctx.user, filed_at: (/* @__PURE__ */ new Date()).toISOString() } };
        }
      },
      settle: {
        from: ["FILED"],
        to: "SETTLED",
        permission: Permission26.TAX_FILE,
        fields: { payment_date: { type: "date", required: true } },
        run: async (ctx, row, input) => {
          const out = new Money26(row.output_tax);
          const inp = new Money26(row.input_tax);
          const net = out.sub(inp);
          const lines = [];
          if (out.isPositive())
            lines.push({ account_code: "212001", debit: out.toFixed(8), description: `Clear output tax ${row.number}` });
          if (inp.isPositive())
            lines.push({ account_code: "114001", credit: inp.toFixed(8), description: `Clear input tax ${row.number}` });
          if (net.isPositive())
            lines.push({ account_code: "111002", credit: net.toFixed(8), description: `Tax paid ${row.number}` });
          else if (net.isNegative())
            lines.push({ account_code: "114002", debit: net.abs().toFixed(8), description: `Refundable tax carried forward ${row.number}` });
          const posted = await postJournal(ctx.tx, auditLogger, outboxService, {
            organizationId: ctx.org,
            legalEntityId: row.legal_entity_id || ctx.le,
            userId: ctx.user,
            postingDate: input.payment_date,
            purpose: AccountingPurpose18.TAX_SETTLEMENT,
            description: `Tax return settlement ${row.number}`,
            sourceType: "TAX_RETURN",
            sourceId: row.id,
            sourceKey: `TAX_RETURN:${row.id}`,
            numberPrefix: "JV-TAX",
            correlationId: ctx.req.correlationId,
            lines
          });
          return { set: { settlement_journal_id: posted?.journalId ?? null }, data: { journal_number: posted?.journalNumber ?? null } };
        }
      },
      cancel: { from: ["DRAFT"], to: "CANCELLED", permission: Permission26.TAX_MANAGE }
    }
  });
}

// apps/api/dist/routes/wms.js
init_context();
init_http();
init_errors();
init_resource();
init_validate();
init_stock();
init_numbering();
init_modules();
import { Permission as Permission27, ErrorCode as ErrorCode36 } from "@omnysync/contracts";
import { Money as Money28 } from "@omnysync/financial-engine";

// apps/api/dist/domain/wms.js
import { Money as Money27 } from "@omnysync/financial-engine";
function allocatePick(requested, bins) {
  let remaining = new Money27(requested);
  const rank = (t) => t === "PICK" ? 0 : t === "BULK" ? 1 : 2;
  const usable = bins.filter((b) => (b.bin_type === "PICK" || b.bin_type === "BULK") && new Money27(b.quantity).isPositive()).sort((a, b) => rank(a.bin_type) - rank(b.bin_type) || new Money27(b.quantity).toDecimal().comparedTo(new Money27(a.quantity).toDecimal()) || a.bin_code.localeCompare(b.bin_code));
  const allocations = [];
  for (const b of usable) {
    if (!remaining.isPositive())
      break;
    const take = Money27.min(remaining, b.quantity);
    allocations.push({ bin_id: b.bin_id, quantity: take.toFixed(8) });
    remaining = remaining.sub(take);
  }
  if (remaining.isPositive())
    allocations.push({ bin_id: null, quantity: remaining.toFixed(8) });
  return { allocations, shortage: remaining.isPositive() ? remaining.toFixed(8) : "0" };
}

// apps/api/dist/routes/wms.js
var WMS_READ = [Permission27.WMS_MANAGE, Permission27.WMS_PICK, Permission27.WAREHOUSE_MANAGE, Permission27.INVENTORY_MANAGE];
async function loadBin(q, org, binId) {
  if (typeof binId !== "string")
    throw validationError("bin_id is required", { field: "bin_id" });
  const r = await q.query(`SELECT b.*, w.organization_id FROM warehouse_bins b JOIN warehouses w ON w.id = b.warehouse_id WHERE b.id::text = $1 AND w.organization_id = $2 FOR UPDATE OF b`, [binId, org]);
  if (!r.rows[0])
    throw new ApiError(400, ErrorCode36.FORBIDDEN_SCOPE, "Bin does not exist in this organization", { field: "bin_id" });
  if (!r.rows[0].is_active)
    throw validationError("Bin is inactive", { field: "bin_id" });
  return r.rows[0];
}
async function binnedQty(q, org, warehouseId, itemId) {
  const r = await q.query(`SELECT COALESCE(SUM(bs.quantity),0)::text AS q FROM bin_stock bs JOIN warehouse_bins b ON b.id = bs.bin_id WHERE bs.organization_id = $1 AND b.warehouse_id = $2 AND bs.item_id = $3`, [org, warehouseId, itemId]);
  return new Money28(r.rows[0].q);
}
async function addBinQty(q, org, binId, itemId, delta, type, user, refType, refId) {
  if (delta.isNegative()) {
    const cur = await q.query(`SELECT quantity FROM bin_stock WHERE bin_id = $1 AND item_id = $2 FOR UPDATE`, [binId, itemId]);
    const have = new Money28(cur.rows[0]?.quantity ?? "0");
    if (have.add(delta).isNegative())
      throw new ApiError(409, ErrorCode36.INSUFFICIENT_STOCK, `Bin holds ${have.format(4)}, cannot remove ${delta.abs().format(4)}`);
  }
  if (delta.isNegative()) {
    await q.query(`UPDATE bin_stock SET quantity = quantity + $3, updated_at = NOW() WHERE bin_id = $1 AND item_id = $2`, [binId, itemId, delta.toFixed(8)]);
  } else {
    await q.query(`INSERT INTO bin_stock (organization_id, bin_id, item_id, quantity) VALUES ($1,$2,$3,$4)
       ON CONFLICT (bin_id, item_id) DO UPDATE SET quantity = bin_stock.quantity + EXCLUDED.quantity, updated_at = NOW()`, [org, binId, itemId, delta.toFixed(8)]);
  }
  await q.query(`INSERT INTO bin_movements (organization_id, bin_id, item_id, quantity, movement_type, reference_type, reference_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [
    org,
    binId,
    itemId,
    delta.toFixed(8),
    type,
    refType ?? null,
    refId ?? null,
    user
  ]);
}
function registerWmsRoutes(app) {
  app.get("/api/wms/bins", authenticate, requireAnyPermission(...WMS_READ), async (req, res) => {
    const r = await db.query(`SELECT b.id, b.bin_code, b.bin_type, b.capacity_qty, b.is_active, w.id AS warehouse_id, w.code AS warehouse_code, w.name AS warehouse_name,
              COALESCE((SELECT SUM(quantity) FROM bin_stock bs WHERE bs.bin_id = b.id),0)::text AS total_qty,
              (SELECT COUNT(*)::int FROM bin_stock bs WHERE bs.bin_id = b.id AND bs.quantity > 0) AS sku_count
       FROM warehouse_bins b JOIN warehouses w ON w.id = b.warehouse_id WHERE w.organization_id = $1 ORDER BY w.code, b.bin_code`, [req.session.organization_id]);
    return ok(req, res, r.rows.map((x) => ({ ...x, code: x.bin_code, status: x.is_active ? "ACTIVE" : "INACTIVE" })));
  });
  app.post("/api/wms/bins", authenticate, requirePermission(Permission27.WMS_MANAGE), requireModule("WMS", "create"), async (req, res) => {
    const out = await unitOfWork(req, async (ctx) => {
      const wh = await loadRow(ctx.tx, "warehouses", req.body?.warehouse_id, ctx.org, "Warehouse");
      const code = str(req.body?.bin_code, "bin_code", { max: 32, pattern: /^[A-Z0-9-]+$/ });
      const type = ["PICK", "BULK", "STAGING", "QUARANTINE"].includes(req.body?.bin_type) ? req.body.bin_type : "PICK";
      const cap = req.body?.capacity_qty ? decimal(req.body.capacity_qty, "capacity_qty", { sign: "positive" }) : null;
      const r = await ctx.tx.query(`INSERT INTO warehouse_bins (warehouse_id, bin_code, bin_type, capacity_qty) VALUES ($1,$2,$3,$4) RETURNING *`, [wh.id, code, type, cap]);
      await audit2(ctx, "BIN_CREATED", "BIN", r.rows[0].id, void 0, { warehouse: wh.code, code, type });
      return r.rows[0];
    });
    return ok(req, res, out, 201);
  });
  app.get("/api/wms/bin-stock", authenticate, requireAnyPermission(...WMS_READ), async (req, res) => {
    const org = req.session.organization_id;
    const r = await db.query(`SELECT bs.bin_id || ':' || bs.item_id AS id, bs.quantity, b.bin_code, b.bin_type, w.code AS warehouse_code, i.code AS item_code, i.name AS item_name, bs.updated_at
       FROM bin_stock bs JOIN warehouse_bins b ON b.id = bs.bin_id JOIN warehouses w ON w.id = b.warehouse_id JOIN items i ON i.id = bs.item_id
       WHERE bs.organization_id = $1 AND bs.quantity > 0 ORDER BY w.code, b.bin_code, i.code`, [org]);
    return ok(req, res, r.rows);
  });
  app.get("/api/wms/unbinned", authenticate, requireAnyPermission(...WMS_READ), async (req, res) => {
    const org = req.session.organization_id;
    const whs = (await db.query(`SELECT id, code FROM warehouses WHERE organization_id = $1 AND is_active`, [org])).rows;
    const items = (await db.query(`SELECT id, code, name FROM items WHERE organization_id = $1 AND item_type = 'INVENTORY' ORDER BY code`, [org])).rows;
    const out = [];
    for (const w of whs)
      for (const it of items) {
        const oh = new Money28(await onHand(db, org, it.id, w.id));
        if (!oh.isPositive())
          continue;
        const binned = await binnedQty(db, org, w.id, it.id);
        const un = oh.sub(binned);
        if (un.isPositive())
          out.push({ id: `${w.id}:${it.id}`, warehouse_id: w.id, warehouse_code: w.code, item_id: it.id, item_code: it.code, item_name: it.name, on_hand: oh.toFixed(4), binned: binned.toFixed(4), unbinned: un.toFixed(4) });
      }
    return ok(req, res, out);
  });
  app.post("/api/wms/putaway", authenticate, requireAnyPermission(Permission27.WMS_MANAGE, Permission27.WMS_PICK), requireModule("WMS"), async (req, res) => {
    const out = await unitOfWork(req, async (ctx) => {
      const bin = await loadBin(ctx.tx, ctx.org, req.body?.bin_id);
      const item = await loadRow(ctx.tx, "items", req.body?.item_id, ctx.org, "Item", true);
      const qty = new Money28(decimal(req.body?.quantity, "quantity", { sign: "positive", scale: 4 }));
      if (bin.bin_type === "QUARANTINE" && req.body?.quarantine !== true)
        throw validationError("Quarantine bins need an explicit quarantine putaway", { field: "bin_id" });
      const oh = new Money28(await onHand(ctx.tx, ctx.org, item.id, bin.warehouse_id));
      const binned = await binnedQty(ctx.tx, ctx.org, bin.warehouse_id, item.id);
      if (binned.add(qty).gt(oh))
        throw new ApiError(409, ErrorCode36.INSUFFICIENT_STOCK, `Only ${oh.sub(binned).format(4)} of ${item.code} is unbinned in this warehouse`, { field: "quantity" });
      if (bin.capacity_qty) {
        const inBin = new Money28((await ctx.tx.query(`SELECT COALESCE(SUM(quantity),0)::text q FROM bin_stock WHERE bin_id = $1`, [bin.id])).rows[0].q);
        if (inBin.add(qty).gt(bin.capacity_qty))
          throw new ApiError(409, ErrorCode36.CAPACITY_CONFLICT, `Bin ${bin.bin_code} capacity ${new Money28(bin.capacity_qty).format(0)} would be exceeded`, { field: "quantity" });
      }
      await addBinQty(ctx.tx, ctx.org, bin.id, item.id, qty, "PUTAWAY", ctx.user);
      await audit2(ctx, "BIN_PUTAWAY", "BIN", bin.id, void 0, { item: item.code, quantity: qty.toFixed(4) });
      await emit(ctx, "WMS_PUTAWAY", { bin_id: bin.id, item_id: item.id, quantity: qty.toFixed(4) });
      return { bin_code: bin.bin_code, item_code: item.code, quantity: qty.toFixed(4) };
    });
    return ok(req, res, out);
  });
  app.post("/api/wms/move", authenticate, requireAnyPermission(Permission27.WMS_MANAGE, Permission27.WMS_PICK), requireModule("WMS"), async (req, res) => {
    const out = await unitOfWork(req, async (ctx) => {
      const from = await loadBin(ctx.tx, ctx.org, req.body?.from_bin_id);
      const to = await loadBin(ctx.tx, ctx.org, req.body?.to_bin_id);
      if (from.id === to.id)
        throw validationError("Source and destination bins must differ", { field: "to_bin_id" });
      if (from.warehouse_id !== to.warehouse_id)
        throw validationError("Use a stock transfer to move between warehouses", { field: "to_bin_id" });
      const item = await loadRow(ctx.tx, "items", req.body?.item_id, ctx.org, "Item");
      const qty = new Money28(decimal(req.body?.quantity, "quantity", { sign: "positive", scale: 4 }));
      await addBinQty(ctx.tx, ctx.org, from.id, item.id, qty.negated(), "MOVE_OUT", ctx.user);
      await addBinQty(ctx.tx, ctx.org, to.id, item.id, qty, "MOVE_IN", ctx.user);
      await audit2(ctx, "BIN_MOVE", "BIN", from.id, void 0, { to: to.bin_code, item: item.code, quantity: qty.toFixed(4) });
      return { from: from.bin_code, to: to.bin_code, quantity: qty.toFixed(4) };
    });
    return ok(req, res, out);
  });
  defineResource(app, {
    path: "/api/wms/pick-lists",
    table: "pick_lists",
    label: "Pick list",
    event: "PICK_LIST",
    module: "WMS",
    view: WMS_READ,
    create: false,
    update: false,
    fields: {},
    select: `t.*, so.order_number, w.code AS warehouse_code, (SELECT COUNT(*)::int FROM pick_list_lines l WHERE l.pick_list_id = t.id) AS line_count`,
    joins: `JOIN sales_orders so ON so.id = t.sales_order_id JOIN warehouses w ON w.id = t.warehouse_id`,
    search: ["number", "so.order_number"],
    detail: async (q, row) => ({
      lines: (await q.query(`SELECT l.*, i.code AS item_code, i.name AS item_name, b.bin_code FROM pick_list_lines l JOIN items i ON i.id = l.item_id LEFT JOIN warehouse_bins b ON b.id = l.bin_id WHERE l.pick_list_id = $1 ORDER BY i.code, b.bin_code`, [row.id])).rows
    }),
    commands: {
      start: { from: ["OPEN"], to: "PICKING", permission: [Permission27.WMS_PICK, Permission27.WMS_MANAGE] },
      complete: {
        from: ["PICKING"],
        to: "PICKED",
        permission: [Permission27.WMS_PICK, Permission27.WMS_MANAGE],
        run: async (ctx, row) => {
          const open = (await ctx.tx.query(`SELECT COUNT(*)::int n FROM pick_list_lines WHERE pick_list_id = $1 AND bin_id IS NOT NULL AND qty_picked < qty_requested`, [row.id])).rows[0].n;
          if (open > 0)
            throw new ApiError(409, ErrorCode36.INVALID_STATE, `${open} line(s) are not fully picked`);
        }
      },
      cancel: { from: ["OPEN", "PICKING"], to: "CANCELLED", permission: Permission27.WMS_MANAGE }
    }
  });
  app.post("/api/wms/pick-lists/generate", authenticate, requireAnyPermission(Permission27.WMS_MANAGE, Permission27.WMS_PICK), requireModule("WMS", "create"), async (req, res) => {
    const out = await unitOfWork(req, async (ctx) => {
      const so = await loadRow(ctx.tx, "sales_orders", req.body?.sales_order_id, ctx.org, "Sales order", true);
      if (so.status !== "CONFIRMED")
        throw new ApiError(409, ErrorCode36.INVALID_STATE, `Sales order ${so.order_number} is ${so.status}; only CONFIRMED orders can be picked`);
      const existing = await ctx.tx.query(`SELECT number FROM pick_lists WHERE sales_order_id = $1 AND status <> 'CANCELLED'`, [so.id]);
      if (existing.rows[0])
        throw new ApiError(409, ErrorCode36.DUPLICATE_RESOURCE, `Pick list ${existing.rows[0].number} already exists for ${so.order_number}`);
      const whId = typeof req.body?.warehouse_id === "string" && (await loadRow(ctx.tx, "warehouses", req.body.warehouse_id, ctx.org, "Warehouse")).id || so.warehouse_id || await defaultWarehouseId(ctx.tx, ctx.org);
      if (!whId)
        throw validationError("No warehouse available", { field: "warehouse_id" });
      const lines = (await ctx.tx.query(`SELECT sol.item_id, SUM(sol.quantity - sol.fulfilled_quantity)::text AS qty FROM sales_order_lines sol JOIN items i ON i.id = sol.item_id WHERE sol.sales_order_id = $1 AND i.item_type = 'INVENTORY' GROUP BY sol.item_id`, [so.id])).rows;
      if (!lines.length)
        throw validationError("Sales order has no stock lines to pick");
      const number = await nextDocumentNumber(ctx.tx, ctx.org, "PICK");
      const pl = (await ctx.tx.query(`INSERT INTO pick_lists (organization_id, legal_entity_id, number, sales_order_id, warehouse_id, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [ctx.org, ctx.le, number, so.id, whId, ctx.user])).rows[0];
      let shortage = false;
      for (const l of lines) {
        if (!new Money28(l.qty).isPositive())
          continue;
        const bins = (await ctx.tx.query(`SELECT bs.bin_id, b.bin_code, b.bin_type, bs.quantity::text AS quantity FROM bin_stock bs JOIN warehouse_bins b ON b.id = bs.bin_id WHERE b.warehouse_id = $1 AND bs.item_id = $2 AND b.is_active`, [whId, l.item_id])).rows;
        const alloc = allocatePick(l.qty, bins);
        if (alloc.shortage !== "0")
          shortage = true;
        for (const a of alloc.allocations)
          await ctx.tx.query(`INSERT INTO pick_list_lines (pick_list_id, item_id, bin_id, qty_requested) VALUES ($1,$2,$3,$4)`, [pl.id, l.item_id, a.bin_id, a.quantity]);
      }
      await ctx.tx.query(`UPDATE pick_lists SET shortage = $2 WHERE id = $1`, [pl.id, shortage]);
      await audit2(ctx, "PICK_LIST_GENERATED", "PICK_LIST", pl.id, void 0, { number, sales_order: so.order_number, shortage });
      await emit(ctx, "PICK_LIST_GENERATED", { id: pl.id, number, sales_order_id: so.id, shortage });
      return { ...pl, shortage };
    });
    return ok(req, res, out, 201);
  });
  app.post("/api/wms/pick-lists/:id/lines/:lineId/confirm", authenticate, requireAnyPermission(Permission27.WMS_PICK, Permission27.WMS_MANAGE), requireModule("WMS"), async (req, res) => {
    const out = await unitOfWork(req, async (ctx) => {
      const pl = await loadRow(ctx.tx, "pick_lists", req.params.id, ctx.org, "Pick list", true);
      if (pl.status !== "PICKING")
        throw new ApiError(409, ErrorCode36.INVALID_STATE, `Start the pick list first (status ${pl.status})`);
      const line = (await ctx.tx.query(`SELECT * FROM pick_list_lines WHERE id::text = $1 AND pick_list_id = $2 FOR UPDATE`, [req.params.lineId, pl.id])).rows[0];
      if (!line)
        throw notFound("Pick line");
      if (!line.bin_id)
        throw new ApiError(409, ErrorCode36.INSUFFICIENT_STOCK, "Shortage line has no bin allocation; replenish and regenerate");
      const qty = new Money28(decimal(req.body?.quantity, "quantity", { sign: "positive", scale: 4 }));
      const remaining = new Money28(line.qty_requested).sub(line.qty_picked);
      if (qty.gt(remaining))
        throw validationError(`Only ${remaining.format(4)} remains to pick on this line`, { field: "quantity" });
      await addBinQty(ctx.tx, ctx.org, line.bin_id, line.item_id, qty.negated(), "PICK", ctx.user, "PICK_LIST", pl.id);
      await ctx.tx.query(`UPDATE pick_list_lines SET qty_picked = qty_picked + $2 WHERE id = $1`, [line.id, qty.toFixed(8)]);
      await audit2(ctx, "PICK_CONFIRMED", "PICK_LIST", pl.id, void 0, { line: line.id, quantity: qty.toFixed(4) });
      return { line_id: line.id, picked: new Money28(line.qty_picked).add(qty).toFixed(4), requested: new Money28(line.qty_requested).toFixed(4) };
    });
    return ok(req, res, out);
  });
}

// apps/api/dist/routes/automation-events.js
init_context();
init_http();
init_errors();
init_resource();
import { Permission as Permission28, ErrorCode as ErrorCode37 } from "@omnysync/contracts";

// apps/api/dist/automation/conditions.js
import { Money as Money29 } from "@omnysync/financial-engine";
var OPERATORS = ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "in", "exists", "not_exists"];
var DEC = /^-?\d+(\.\d+)?$/;
var FIELD = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*){0,4}$/;
function getPath(obj, path2) {
  return path2.split(".").reduce((o, k) => o && typeof o === "object" ? o[k] : void 0, obj);
}
function cmp(a, b) {
  const as = String(a ?? "");
  const bs = String(b ?? "");
  if (DEC.test(as) && DEC.test(bs))
    return new Money29(as).toDecimal().comparedTo(new Money29(bs).toDecimal());
  if (/^\d{4}-\d{2}-\d{2}/.test(as) && /^\d{4}-\d{2}-\d{2}/.test(bs))
    return as < bs ? -1 : as > bs ? 1 : 0;
  return null;
}
function evaluate(cond, payload) {
  const v = getPath(payload, cond.field);
  switch (cond.op) {
    case "exists":
      return v !== void 0 && v !== null && v !== "";
    case "not_exists":
      return v === void 0 || v === null || v === "";
    case "eq":
      return cmp(v, cond.value) === 0 || String(v ?? "") === String(cond.value ?? "");
    case "neq":
      return !(cmp(v, cond.value) === 0 || String(v ?? "") === String(cond.value ?? ""));
    case "contains":
      return String(v ?? "").toLowerCase().includes(String(cond.value ?? "").toLowerCase());
    case "in":
      return (Array.isArray(cond.value) ? cond.value : String(cond.value ?? "").split(",")).map((x) => String(x).trim()).includes(String(v ?? ""));
    default: {
      const c = cmp(v, cond.value);
      if (c === null)
        return false;
      return cond.op === "gt" ? c > 0 : cond.op === "gte" ? c >= 0 : cond.op === "lt" ? c < 0 : c <= 0;
    }
  }
}
var matchesAll = (conds, payload) => conds.every((c) => evaluate(c, payload));
function validateDefinition(def) {
  const errs = [];
  if (typeof def.event_type !== "string" || !/^[A-Z][A-Z0-9_]{2,79}$/.test(def.event_type))
    errs.push("Trigger event type is required (e.g. SERVICE_CASE_CREATED)");
  const conds = Array.isArray(def.conditions) ? def.conditions : null;
  if (!conds)
    errs.push("Conditions must be a list");
  else if (conds.length > 10)
    errs.push("At most 10 conditions");
  else
    conds.forEach((c, i) => {
      if (!c || typeof c.field !== "string" || !FIELD.test(c.field))
        errs.push(`Condition ${i + 1}: field must be a payload path`);
      if (!OPERATORS.includes(c?.op))
        errs.push(`Condition ${i + 1}: unknown operator`);
      if (["gt", "gte", "lt", "lte"].includes(c?.op) && !(DEC.test(String(c.value ?? "")) || /^\d{4}-\d{2}-\d{2}$/.test(String(c.value ?? ""))))
        errs.push(`Condition ${i + 1}: comparison needs a number or date`);
    });
  const acts = Array.isArray(def.actions) ? def.actions : null;
  if (!acts || acts.length === 0)
    errs.push("At least one action is required");
  else if (acts.length > 5)
    errs.push("At most 5 actions");
  else
    acts.forEach((a, i) => {
      if (!a || !["ALERT", "TASK"].includes(a.type))
        errs.push(`Action ${i + 1}: only ALERT and TASK actions are allowed (financial actions are never automated from events)`);
      if (!a?.title || String(a.title).length > 200)
        errs.push(`Action ${i + 1}: title is required (max 200)`);
      if (a?.type === "ALERT" && a.severity && !["INFO", "WARNING", "CRITICAL"].includes(a.severity))
        errs.push(`Action ${i + 1}: bad severity`);
      if (a?.type === "TASK" && a.due_in_days !== void 0 && !(Number.isInteger(a.due_in_days) && a.due_in_days >= 0 && a.due_in_days <= 365))
        errs.push(`Action ${i + 1}: due_in_days 0-365`);
    });
  return errs;
}
function renderTemplate(tpl, payload) {
  return String(tpl).replace(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g, (_m, p) => {
    const v = getPath(payload, p);
    return v === void 0 || v === null ? "" : String(v);
  }).slice(0, 1e3);
}

// apps/api/dist/automation/events.js
var MAX_EVENTS = 500;
function addDays2(d, n) {
  const x = new Date(d.getTime() + n * 864e5);
  return x.toISOString().slice(0, 10);
}
async function applyActions(q, rule, def, ev, payload) {
  const results = [];
  for (const a of def.actions) {
    const title = renderTemplate(a.title, payload);
    const body = a.body ? renderTemplate(a.body, payload) : null;
    if (a.type === "ALERT") {
      const dedupe = `EVENT_RULE:${rule.id}:${ev.id}`;
      await q.query(`INSERT INTO automation_alerts (organization_id, rule_id, category, severity, title, body, entity_type, entity_id, dedupe_key, data, assigned_role)
         VALUES ($1, NULL, 'EVENT_RULE', $2, $3, $4, $5, $6, $7, $8, $9)`, [rule.organization_id, a.severity || "INFO", title, body, ev.event_type, typeof payload.id === "string" && /^[0-9a-f-]{36}$/i.test(payload.id) ? payload.id : null, dedupe, JSON.stringify({ rule: rule.code, event_id: ev.id }), a.assigned_role || null]);
      results.push({ type: "ALERT", title });
    } else if (a.type === "TASK") {
      await q.query(`INSERT INTO automation_tasks (organization_id, rule_id, event_id, title, body, assigned_role, due_date, entity_type, entity_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [rule.organization_id, rule.id, ev.id, title, body, a.assigned_role || null, a.due_in_days !== void 0 ? addDays2(new Date(ev.created_at), a.due_in_days) : null, ev.event_type, typeof payload.id === "string" && /^[0-9a-f-]{36}$/i.test(payload.id) ? payload.id : null]);
      results.push({ type: "TASK", title });
    }
  }
  return results;
}
async function processEvents(db2, orgId) {
  const params = [];
  let where = `r.status = 'PUBLISHED'`;
  if (orgId) {
    params.push(orgId);
    where += ` AND r.organization_id = $1`;
  }
  const pending = await db2.query(`SELECT r.id AS rule_id, e.id AS event_id FROM automation_event_rules r
     JOIN outbox_events e ON e.organization_id = r.organization_id AND e.event_type = r.event_type AND e.created_at >= r.published_at
     WHERE ${where} AND NOT EXISTS (SELECT 1 FROM automation_event_deliveries d WHERE d.rule_id = r.id AND d.event_id = e.id)
     ORDER BY e.created_at LIMIT ${MAX_EVENTS}`, params);
  let delivered = 0;
  let matched = 0;
  for (const p of pending.rows) {
    await db2.transaction(async (tx) => {
      const rule = (await tx.query(`SELECT * FROM automation_event_rules WHERE id = $1 AND status = 'PUBLISHED'`, [p.rule_id])).rows[0];
      if (!rule)
        return;
      const ev = (await tx.query(`SELECT * FROM outbox_events WHERE id = $1`, [p.event_id])).rows[0];
      const def = typeof rule.published_definition === "string" ? JSON.parse(rule.published_definition) : rule.published_definition;
      const payload = typeof ev.payload === "string" ? JSON.parse(ev.payload) : ev.payload || {};
      const isMatch = matchesAll(def.conditions || [], payload);
      const claim = await tx.query(`INSERT INTO automation_event_deliveries (organization_id, rule_id, rule_version, event_id, matched) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (rule_id, event_id) DO NOTHING RETURNING id`, [rule.organization_id, rule.id, rule.version, ev.id, isMatch]);
      if (!claim.rows.length)
        return;
      delivered++;
      if (!isMatch)
        return;
      matched++;
      const results = await applyActions(tx, rule, def, ev, payload);
      await tx.query(`UPDATE automation_event_deliveries SET outcome = $2 WHERE id = $1`, [claim.rows[0].id, JSON.stringify(results)]);
    });
  }
  return { delivered, matched };
}

// apps/api/dist/routes/automation-events.js
var VIEW7 = [Permission28.AUTOMATION_VIEW, Permission28.AUTOMATION_MANAGE];
var parse = (v) => typeof v === "string" ? JSON.parse(v) : v;
function registerAutomationEventRoutes(app) {
  app.get("/api/automation/event-catalog", authenticate, requireAnyPermission(...VIEW7), async (req, res) => {
    const r = await db.query(`SELECT event_type, COUNT(*)::int AS count, MAX(created_at) AS last_seen FROM outbox_events WHERE organization_id = $1 GROUP BY event_type ORDER BY event_type`, [req.session.organization_id]);
    const out = [];
    for (const row of r.rows) {
      const sample = (await db.query(`SELECT payload FROM outbox_events WHERE organization_id = $1 AND event_type = $2 ORDER BY created_at DESC LIMIT 1`, [req.session.organization_id, row.event_type])).rows[0];
      const payload = parse(sample?.payload) || {};
      out.push({ id: row.event_type, event_type: row.event_type, count: row.count, last_seen: row.last_seen, fields: Object.keys(payload).filter((k) => !/_hash$/.test(k)).slice(0, 40), sample: payload });
    }
    return ok(req, res, out);
  });
  defineResource(app, {
    path: "/api/automation/event-rules",
    table: "automation_event_rules",
    label: "Event rule",
    event: "AUTOMATION_EVENT_RULE",
    module: "AUT",
    view: VIEW7,
    create: Permission28.AUTOMATION_MANAGE,
    update: Permission28.AUTOMATION_MANAGE,
    fields: {
      code: { type: "string", required: true, max: 64, pattern: /^[A-Z0-9_-]+$/ },
      name: { type: "string", required: true },
      description: { type: "text" },
      event_type: { type: "string", required: true, max: 80, pattern: /^[A-Z][A-Z0-9_]+$/ },
      conditions: { type: "json" },
      actions: { type: "json", required: true }
    },
    editable: ["name", "description", "event_type", "conditions", "actions"],
    initialStatus: "DRAFT",
    search: ["code", "name", "event_type"],
    orderBy: "t.code",
    select: `t.*, (SELECT COUNT(*)::int FROM automation_event_deliveries d WHERE d.rule_id = t.id AND d.matched) AS match_count`,
    beforeCreate: async (_ctx, v) => {
      const errs = validateDefinition({ event_type: v.event_type, conditions: parse(v.conditions) || [], actions: parse(v.actions) });
      if (errs.length)
        throw new ApiError(400, ErrorCode37.VALIDATION_FAILED, errs.join("; "), { problems: errs });
      if (!v.conditions)
        v.conditions = "[]";
    },
    beforeUpdate: async (_ctx, row, v) => {
      const merged = { event_type: v.event_type ?? row.event_type, conditions: parse(v.conditions ?? row.conditions) || [], actions: parse(v.actions ?? row.actions) };
      const errs = validateDefinition(merged);
      if (errs.length)
        throw new ApiError(400, ErrorCode37.VALIDATION_FAILED, errs.join("; "), { problems: errs });
    },
    commands: {
      // Editing a published rule changes the draft only; running deliveries keep their version until re-published.
      publish: {
        from: ["DRAFT", "PUBLISHED", "PAUSED"],
        to: "PUBLISHED",
        permission: Permission28.AUTOMATION_MANAGE,
        run: async (ctx, row) => {
          const def = { event_type: row.event_type, conditions: parse(row.conditions) || [], actions: parse(row.actions) || [] };
          const errs = validateDefinition(def);
          if (errs.length)
            throw new ApiError(400, ErrorCode37.VALIDATION_FAILED, errs.join("; "), { problems: errs });
          return { set: { version: Number(row.version) + 1, published_definition: JSON.stringify(def), published_at: (/* @__PURE__ */ new Date()).toISOString(), published_by: ctx.user } };
        }
      },
      pause: { from: ["PUBLISHED"], to: "PAUSED", permission: Permission28.AUTOMATION_MANAGE }
    }
  });
  app.post("/api/automation/event-rules/simulate", authenticate, requireAnyPermission(...VIEW7), async (req, res) => {
    const def = { event_type: req.body?.event_type, conditions: req.body?.conditions || [], actions: req.body?.actions || [] };
    const errs = validateDefinition(def);
    if (errs.length)
      throw new ApiError(400, ErrorCode37.VALIDATION_FAILED, errs.join("; "), { problems: errs });
    const evs = await db.query(`SELECT id, payload, created_at FROM outbox_events WHERE organization_id = $1 AND event_type = $2 ORDER BY created_at DESC LIMIT 50`, [req.session.organization_id, def.event_type]);
    const results = evs.rows.map((e) => {
      const p = parse(e.payload) || {};
      const matched = matchesAll(def.conditions, p);
      return { event_id: e.id, created_at: e.created_at, matched, preview: matched ? def.actions.map((a) => `${a.type}: ${renderTemplate(a.title, p)}`) : [] };
    });
    return ok(req, res, { evaluated: results.length, matched: results.filter((r) => r.matched).length, results });
  });
  app.post("/api/automation/events/process", authenticate, requirePermission(Permission28.AUTOMATION_RUN), async (req, res) => {
    return ok(req, res, await processEvents(db, req.session.organization_id));
  });
  app.get("/api/automation/tasks", authenticate, requireAnyPermission(...VIEW7), async (req, res) => {
    const status = typeof req.query.status === "string" && req.query.status ? req.query.status : "OPEN";
    const r = await db.query(`SELECT t.*, r.code AS rule_code, r.name AS rule_name FROM automation_tasks t LEFT JOIN automation_event_rules r ON r.id = t.rule_id
       WHERE t.organization_id = $1 AND t.status = $2 ORDER BY t.due_date NULLS LAST, t.created_at DESC LIMIT 200`, [req.session.organization_id, status]);
    return ok(req, res, r.rows);
  });
  app.post("/api/automation/tasks/:id/complete", authenticate, requireAnyPermission(...VIEW7), async (req, res) => {
    const out = await unitOfWork(req, async (ctx) => {
      const r = await ctx.tx.query(`UPDATE automation_tasks SET status = 'DONE', completed_by = $3, completed_at = NOW() WHERE id::text = $1 AND organization_id = $2 AND status = 'OPEN' RETURNING *`, [req.params.id, ctx.org, ctx.user]);
      if (!r.rows[0]) {
        const ex = await ctx.tx.query(`SELECT status FROM automation_tasks WHERE id::text = $1 AND organization_id = $2`, [req.params.id, ctx.org]);
        if (!ex.rows[0])
          throw notFound("Task");
        throw new ApiError(409, ErrorCode37.INVALID_STATE, `Task is already ${ex.rows[0].status}`);
      }
      await audit2(ctx, "AUTOMATION_TASK_COMPLETED", "AUTOMATION_TASK", r.rows[0].id, { status: "OPEN" }, { status: "DONE" });
      return r.rows[0];
    });
    return ok(req, res, out);
  });
}

// apps/api/dist/app.js
init_service();
init_crm();

// apps/api/dist/routes/time.js
init_context();
init_http();
init_errors();
init_resource();
init_modules();
init_scope();
init_validate();
init_posting();
init_config();
import { Permission as Permission29, ErrorCode as ErrorCode38, AccountingPurpose as AccountingPurpose19 } from "@omnysync/contracts";
import { Money as Money30 } from "@omnysync/financial-engine";
var VIEW8 = [Permission29.TIME_VIEW, Permission29.TIME_SUBMIT, Permission29.TIME_APPROVE];
function isSelfService(perms2) {
  return perms2.includes(Permission29.TIME_SUBMIT) && !perms2.includes(Permission29.TIME_APPROVE) && !perms2.includes(Permission29.TIME_POST);
}
var ownScope = (req) => isSelfService(req.session.permissions) ? { sql: "t.employee_id IN (SELECT id FROM employees WHERE user_id = $SCOPE)", value: req.session.user_id } : null;
async function assertOwnEmployee(ctx, employeeId) {
  if (!isSelfService(ctx.req.session.permissions))
    return;
  const r = await ctx.tx.query(`SELECT 1 FROM employees WHERE id = $1 AND organization_id = $2 AND user_id = $3`, [employeeId, ctx.org, ctx.user]);
  if (!r.rows[0])
    throw new ApiError(403, ErrorCode38.FORBIDDEN_SCOPE, "You can only record time and leave for your own employee record", { field: "employee_id" });
}
var OVERTIME_MULTIPLIER = "1.5";
var addDays3 = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
var dow = (iso) => (/* @__PURE__ */ new Date(`${iso}T00:00:00Z`)).getUTCDay();
var TIME_RE2 = /^([01]\d|2[0-3]):[0-5]\d$/;
var minutesOf = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
function leaveDays(start, end, holidays = []) {
  let n = 0;
  for (let d = start; d <= end; d = addDays3(d, 1))
    if (dow(d) !== 0 && !holidays.includes(d))
      n++;
  return n;
}
function timesheetTotals(entries, otAfter, rate) {
  const byDay = /* @__PURE__ */ new Map();
  for (const e of entries)
    byDay.set(e.work_date, (byDay.get(e.work_date) || Money30.zero()).add(e.hours));
  let total = Money30.zero();
  let ot = Money30.zero();
  for (const h of byDay.values()) {
    total = total.add(h);
    if (h.gt(otAfter))
      ot = ot.add(h.sub(otAfter));
  }
  const regular = total.sub(ot);
  const cost = regular.add(ot.mul(OVERTIME_MULTIPLIER)).mul(rate).round(2);
  return { total_hours: total.toFixed(2), overtime_hours: ot.toFixed(2), cost_amount: cost.toFixed(2) };
}
async function recompute(q, org, sheet) {
  const entries = (await q.query(`SELECT work_date, hours::text FROM tim_entries WHERE timesheet_id = $1`, [sheet.id])).rows.map((e) => ({ work_date: toIsoDate(e.work_date), hours: e.hours }));
  const otAfter = String(await getSetting(q, org, "time.daily_overtime_after_hours"));
  const t = timesheetTotals(entries, otAfter, String(sheet.cost_rate));
  await q.query(`UPDATE tim_timesheets SET total_hours = $2, overtime_hours = $3, cost_amount = $4, revision = revision + 1, updated_at = NOW() WHERE id = $1`, [sheet.id, t.total_hours, t.overtime_hours, t.cost_amount]);
  return t;
}
function registerTimeRoutes(app) {
  defineResource(app, {
    path: "/api/time/timesheets",
    table: "tim_timesheets",
    label: "Timesheet",
    event: "TIME_SHEET",
    module: "TIM",
    view: VIEW8,
    create: Permission29.TIME_SUBMIT,
    update: Permission29.TIME_SUBMIT,
    fields: {
      employee_id: { type: "ref", table: "employees", required: true, label: "employee_id" },
      week_start: { type: "date", required: true },
      cost_rate: { type: "decimal", required: true, scale: 2 },
      notes: { type: "text" }
    },
    editable: ["notes", "cost_rate"],
    editableIn: ["DRAFT", "REJECTED"],
    numbering: { column: "number", prefix: "TS", dateField: "week_start" },
    initialStatus: "DRAFT",
    select: `t.*, e.employee_number, e.first_name || ' ' || e.last_name AS employee_name, (t.week_start + 6) AS week_end, u.name AS approved_by_name`,
    joins: "JOIN employees e ON e.id = t.employee_id LEFT JOIN users u ON u.id = t.approved_by",
    search: ["number", "e.first_name", "e.last_name", "e.employee_number"],
    filters: ["employee_id"],
    orderBy: "t.week_start DESC, e.employee_number",
    detail: async (q, row) => ({
      entries: (await q.query(`SELECT te.*, p.code AS project_code, p.name AS project_name FROM tim_entries te LEFT JOIN projects p ON p.id = te.project_id WHERE te.timesheet_id = $1 ORDER BY te.work_date, te.start_time`, [row.id])).rows
    }),
    rowScope: ownScope,
    beforeCreate: async (ctx, v) => {
      await assertOwnEmployee(ctx, v.employee_id);
      if (dow(v.week_start) !== 1)
        throw validationError("week_start must be a Monday", { field: "week_start" });
      const dup = await ctx.tx.query(`SELECT number FROM tim_timesheets WHERE organization_id = $1 AND employee_id = $2 AND week_start = $3`, [ctx.org, v.employee_id, v.week_start]);
      if (dup.rows[0])
        throw new ApiError(409, ErrorCode38.DUPLICATE_RESOURCE, `Timesheet ${dup.rows[0].number} already exists for that week`);
    },
    commands: {
      submit: {
        from: ["DRAFT", "REJECTED"],
        to: "SUBMITTED",
        permission: Permission29.TIME_SUBMIT,
        run: async (ctx, row) => {
          const n = (await ctx.tx.query(`SELECT COUNT(*)::int n FROM tim_entries WHERE timesheet_id = $1`, [row.id])).rows[0].n;
          if (!n)
            throw new ApiError(409, ErrorCode38.INVALID_STATE, "Add at least one time entry before submitting");
          const t = await recompute(ctx.tx, ctx.org, row);
          return { set: { ...t, submitted_at: (/* @__PURE__ */ new Date()).toISOString(), reject_reason: null } };
        }
      },
      approve: {
        from: ["SUBMITTED"],
        to: "APPROVED",
        permission: Permission29.TIME_APPROVE,
        sodColumn: "created_by",
        run: async (ctx) => ({ set: { approved_by: ctx.user, approved_at: (/* @__PURE__ */ new Date()).toISOString() } })
      },
      reject: { from: ["SUBMITTED"], to: "REJECTED", permission: Permission29.TIME_APPROVE, fields: { reject_reason: { type: "text", required: true } }, run: async (_c, _r, i) => ({ set: { reject_reason: i.reject_reason } }) },
      post: {
        from: ["APPROVED"],
        to: "POSTED",
        permission: Permission29.TIME_POST,
        fields: { posting_date: { type: "date" } },
        run: async (ctx, row, i) => {
          const date = i.posting_date || addDays3(toIsoDate(row.week_start), 6);
          const byProject = (await ctx.tx.query(`SELECT project_id, SUM(hours)::text AS hours FROM tim_entries WHERE timesheet_id = $1 GROUP BY project_id ORDER BY project_id NULLS LAST`, [row.id])).rows;
          const total = new Money30(row.cost_amount);
          if (!total.isPositive())
            return { set: {}, data: { journal: null, note: "Zero cost \u2014 nothing to post" } };
          const totalHours = byProject.reduce((a, r) => a.add(r.hours), Money30.zero());
          let allocated = Money30.zero();
          const lines = byProject.map((r, idx) => {
            const amt = idx === byProject.length - 1 ? total.sub(allocated) : total.mul(r.hours).div(totalHours.toFixed(8)).round(2);
            allocated = allocated.add(amt);
            return { account_code: "511004", debit: amt.toFixed(8), project_id: r.project_id, description: `Labour ${row.number}` };
          });
          lines.push({ account_code: "211011", credit: total.toFixed(8), description: `Accrued labour ${row.number}` });
          const j = await postJournal(ctx.tx, auditLogger, outboxService, {
            organizationId: ctx.org,
            legalEntityId: ctx.le,
            userId: ctx.user,
            postingDate: date,
            purpose: AccountingPurpose19.TIMESHEET_COST,
            description: `Timesheet labour cost ${row.number}`,
            sourceType: "TIMESHEET",
            sourceId: row.id,
            sourceKey: `TIM:${row.id}`,
            numberPrefix: "JV-TIM",
            correlationId: ctx.req.correlationId,
            lines
          });
          return { set: { journal_id: j?.journalId ?? null }, data: j };
        }
      }
    }
  });
  app.post("/api/time/timesheets/:id/entries", authenticate, requireAnyPermission(Permission29.TIME_SUBMIT), requireModule("TIM"), async (req, res) => {
    const out = await unitOfWork(req, async (ctx) => {
      const sheet = await loadRow(ctx.tx, "tim_timesheets", req.params.id, ctx.org, "Timesheet", true);
      await assertOwnEmployee(ctx, sheet.employee_id);
      if (!["DRAFT", "REJECTED"].includes(sheet.status))
        throw new ApiError(409, ErrorCode38.INVALID_STATE, `Timesheet is ${sheet.status}; entries are locked`);
      const date = dateOnly(req.body?.work_date, "work_date");
      const ws = toIsoDate(sheet.week_start);
      if (date < ws || date > addDays3(ws, 6))
        throw validationError(`work_date must fall in the week ${ws} \u2013 ${addDays3(ws, 6)}`, { field: "work_date" });
      const start = str(req.body?.start_time, "start_time", { max: 5, pattern: TIME_RE2 });
      const end = str(req.body?.end_time, "end_time", { max: 5, pattern: TIME_RE2 });
      if (minutesOf(end) <= minutesOf(start))
        throw validationError("end_time must be after start_time (split overnight shifts at midnight)", { field: "end_time" });
      const projectId = typeof req.body?.project_id === "string" && req.body.project_id ? req.body.project_id : null;
      if (projectId)
        await assertOrgRef(ctx.tx, "projects", projectId, ctx.org, "project_id");
      await ctx.tx.query(`SELECT id FROM employees WHERE id = $1 FOR UPDATE`, [sheet.employee_id]);
      const clash = (await ctx.tx.query(`SELECT te.start_time, te.end_time, s.number FROM tim_entries te JOIN tim_timesheets s ON s.id = te.timesheet_id
           WHERE te.employee_id = $1 AND te.work_date = $2 AND te.start_time < $4::time AND te.end_time > $3::time AND s.status <> 'REJECTED' LIMIT 1`, [sheet.employee_id, date, start, end])).rows[0];
      if (clash)
        throw new ApiError(409, ErrorCode38.OVERLAP_DETECTED, `Overlaps ${String(clash.start_time).slice(0, 5)}\u2013${String(clash.end_time).slice(0, 5)} on ${clash.number}`, { field: "start_time" });
      const leave = (await ctx.tx.query(`SELECT leave_type FROM tim_leave_requests WHERE employee_id = $1 AND status = 'APPROVED' AND $2::date BETWEEN start_date AND end_date`, [sheet.employee_id, date])).rows[0];
      if (leave)
        throw new ApiError(409, ErrorCode38.OVERLAP_DETECTED, `Employee is on approved ${leave.leave_type} leave on ${date}`, { field: "work_date" });
      const hours = new Money30(minutesOf(end) - minutesOf(start)).div(60).round(2).toFixed(2);
      const row = (await ctx.tx.query(`INSERT INTO tim_entries (organization_id, timesheet_id, employee_id, work_date, start_time, end_time, hours, project_id, activity, billable, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [ctx.org, sheet.id, sheet.employee_id, date, start, end, hours, projectId, str(req.body?.activity, "activity", { max: 255 }), bool(req.body?.billable), ctx.user])).rows[0];
      const totals = await recompute(ctx.tx, ctx.org, sheet);
      await audit2(ctx, "TIME_ENTRY_ADDED", "TIME_SHEET", sheet.id, void 0, { date, start, end, hours });
      return { ...row, totals };
    });
    return ok(req, res, out, 201);
  });
  app.post("/api/time/entries/:id/delete", authenticate, requireAnyPermission(Permission29.TIME_SUBMIT), requireModule("TIM"), async (req, res) => {
    const out = await unitOfWork(req, async (ctx) => {
      const e = (await ctx.tx.query(`SELECT * FROM tim_entries WHERE id::text = $1 AND organization_id = $2`, [req.params.id, ctx.org])).rows[0];
      if (!e)
        throw notFound("Time entry");
      const sheet = await loadRow(ctx.tx, "tim_timesheets", e.timesheet_id, ctx.org, "Timesheet", true);
      await assertOwnEmployee(ctx, sheet.employee_id);
      if (!["DRAFT", "REJECTED"].includes(sheet.status))
        throw new ApiError(409, ErrorCode38.INVALID_STATE, `Timesheet is ${sheet.status}; entries are locked`);
      await ctx.tx.query(`DELETE FROM tim_entries WHERE id = $1`, [e.id]);
      await audit2(ctx, "TIME_ENTRY_REMOVED", "TIME_SHEET", sheet.id, { date: toIsoDate(e.work_date), hours: e.hours }, void 0);
      return recompute(ctx.tx, ctx.org, sheet);
    });
    return ok(req, res, out);
  });
  defineResource(app, {
    path: "/api/time/leave",
    table: "tim_leave_requests",
    label: "Leave request",
    event: "TIME_LEAVE",
    module: "TIM",
    view: VIEW8,
    create: Permission29.TIME_SUBMIT,
    update: Permission29.TIME_SUBMIT,
    fields: {
      employee_id: { type: "ref", table: "employees", required: true, label: "employee_id" },
      leave_type: { type: "enum", values: ["ANNUAL", "SICK", "CASUAL", "UNPAID", "MATERNITY", "PATERNITY", "HAJJ"], required: true },
      start_date: { type: "date", required: true },
      end_date: { type: "date", required: true },
      reason: { type: "text" }
    },
    editable: ["reason"],
    editableIn: ["REQUESTED"],
    initialStatus: "REQUESTED",
    select: `t.*, e.employee_number, e.first_name || ' ' || e.last_name AS employee_name`,
    joins: "JOIN employees e ON e.id = t.employee_id",
    search: ["e.first_name", "e.last_name", "e.employee_number"],
    filters: ["employee_id", "leave_type"],
    orderBy: "t.start_date DESC",
    rowScope: ownScope,
    beforeCreate: async (ctx, v) => {
      await assertOwnEmployee(ctx, v.employee_id);
      if (v.end_date < v.start_date)
        throw validationError("end_date must be on or after start_date", { field: "end_date" });
      await ctx.tx.query(`SELECT id FROM employees WHERE id = $1 FOR UPDATE`, [v.employee_id]);
      const ov = (await ctx.tx.query(`SELECT start_date, end_date, status FROM tim_leave_requests WHERE employee_id = $1 AND status IN ('REQUESTED','APPROVED') AND start_date <= $3 AND end_date >= $2 LIMIT 1`, [v.employee_id, v.start_date, v.end_date])).rows[0];
      if (ov)
        throw new ApiError(409, ErrorCode38.OVERLAP_DETECTED, `Overlaps ${ov.status.toLowerCase()} leave ${toIsoDate(ov.start_date)} \u2013 ${toIsoDate(ov.end_date)}`, { field: "start_date" });
      const logged = (await ctx.tx.query(`SELECT COUNT(*)::int n FROM tim_entries te JOIN tim_timesheets s ON s.id = te.timesheet_id WHERE te.employee_id = $1 AND te.work_date BETWEEN $2 AND $3 AND s.status <> 'REJECTED'`, [v.employee_id, v.start_date, v.end_date])).rows[0].n;
      if (logged)
        throw new ApiError(409, ErrorCode38.OVERLAP_DETECTED, `${logged} time entr${logged === 1 ? "y is" : "ies are"} already logged in that window`, { field: "start_date" });
      const days = leaveDays(v.start_date, v.end_date);
      if (!days)
        throw validationError("The window contains no working days", { field: "start_date" });
      v.days = days;
    },
    commands: {
      approve: { from: ["REQUESTED"], to: "APPROVED", permission: Permission29.TIME_APPROVE, sodColumn: "created_by", fields: { decision_note: { type: "text" } }, run: async (ctx, _r, i) => ({ set: { decided_by: ctx.user, decision_note: i.decision_note } }) },
      reject: { from: ["REQUESTED"], to: "REJECTED", permission: Permission29.TIME_APPROVE, fields: { decision_note: { type: "text", required: true } }, run: async (ctx, _r, i) => ({ set: { decided_by: ctx.user, decision_note: i.decision_note } }) },
      cancel: { from: ["REQUESTED", "APPROVED"], to: "CANCELLED", permission: Permission29.TIME_SUBMIT }
    }
  });
  app.get("/api/time/employees", authenticate, requireAnyPermission(...VIEW8), async (req, res) => {
    const org = req.session.organization_id;
    const self = isSelfService(req.session.permissions);
    const search = typeof req.query.search === "string" ? `%${req.query.search.slice(0, 80)}%` : null;
    const r = await db.query(`SELECT id, employee_number, first_name, last_name, employment_type FROM employees
       WHERE organization_id = $1 AND status = 'ACTIVE' AND ($2::uuid IS NULL OR user_id = $2::uuid)
         AND ($3::text IS NULL OR employee_number ILIKE $3 OR first_name || ' ' || last_name ILIKE $3)
       ORDER BY employee_number LIMIT 100`, [org, self ? req.session.user_id : null, search]);
    return ok(req, res, r.rows);
  });
  app.get("/api/time/summary", authenticate, requireAnyPermission(...VIEW8), async (req, res) => {
    const org = req.session.organization_id;
    const own = isSelfService(req.session.permissions) ? req.session.user_id : null;
    const scope = `AND ($2::uuid IS NULL OR employee_id IN (SELECT id FROM employees WHERE user_id = $2::uuid))`;
    const s = (await db.query(`SELECT COUNT(*) FILTER (WHERE status='SUBMITTED')::int awaiting_approval, COUNT(*) FILTER (WHERE status='APPROVED')::int awaiting_posting,
          COALESCE(SUM(total_hours) FILTER (WHERE week_start >= date_trunc('month', NOW())::date),0)::text hours_mtd,
          COALESCE(SUM(overtime_hours) FILTER (WHERE week_start >= date_trunc('month', NOW())::date),0)::text overtime_mtd,
          COALESCE(SUM(cost_amount) FILTER (WHERE status='POSTED'),0)::text posted_cost
         FROM tim_timesheets WHERE organization_id = $1 ${scope}`, [org, own])).rows[0];
    const leave = (await db.query(`SELECT COUNT(*) FILTER (WHERE status='REQUESTED')::int pending, COUNT(*) FILTER (WHERE status='APPROVED' AND CURRENT_DATE BETWEEN start_date AND end_date)::int on_leave_today FROM tim_leave_requests WHERE organization_id = $1 ${scope}`, [org, own])).rows[0];
    return ok(req, res, { ...s, leave });
  });
}

// apps/api/dist/routes/logistics.js
init_context();
init_http();
init_errors();
init_resource();
init_modules();
init_validate();
init_posting();
import { Permission as Permission30, ErrorCode as ErrorCode39, AccountingPurpose as AccountingPurpose20 } from "@omnysync/contracts";
import { Money as Money31 } from "@omnysync/financial-engine";
var VIEW9 = [Permission30.LOGISTICS_VIEW, Permission30.LOGISTICS_MANAGE, Permission30.LOGISTICS_POST];
var CODES = ["BOOKED", "PICKED_UP", "IN_TRANSIT", "AT_HUB", "OUT_FOR_DELIVERY", "DELIVERED", "EXCEPTION", "NOTE"];
async function addEvent(ctx, shipmentId, e) {
  const r = await ctx.tx.query(`INSERT INTO log_tracking_events (organization_id, shipment_id, event_at, code, location, note, source, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (shipment_id, event_at, code) DO NOTHING RETURNING *`, [ctx.org, shipmentId, e.event_at, e.code, e.location ?? null, e.note ?? null, e.source || "MANUAL", ctx.user]);
  return r.rows[0] || null;
}
function registerLogisticsRoutes(app) {
  defineResource(app, {
    path: "/api/log/carriers",
    table: "log_carriers",
    label: "Carrier",
    event: "LOGISTICS_CARRIER",
    module: "LOG",
    view: VIEW9,
    create: Permission30.LOGISTICS_MANAGE,
    update: Permission30.LOGISTICS_MANAGE,
    fields: {
      code: { type: "string", required: true, max: 32, pattern: /^[A-Z0-9-]+$/ },
      name: { type: "string", required: true },
      mode: { type: "enum", values: ["ROAD", "AIR", "SEA", "RAIL", "COURIER", "OWN_FLEET"], required: true },
      party_id: { type: "ref", table: "parties", label: "party_id" },
      tracking_url_template: { type: "string", max: 500, pattern: /^https:\/\/[^\s]+$/ }
    },
    editable: ["name", "party_id", "tracking_url_template"],
    initialStatus: "ACTIVE",
    select: "t.*, p.name AS vendor_name",
    joins: "LEFT JOIN parties p ON p.id = t.party_id",
    search: ["code", "t.name"],
    orderBy: "t.code",
    beforeCreate: async (ctx, v) => {
      if (v.party_id) {
        const p = await loadRow(ctx.tx, "parties", v.party_id, ctx.org, "Party");
        if (!["VENDOR", "BOTH"].includes(p.party_type))
          throw validationError("Carrier account must be a vendor", { field: "party_id" });
      }
    },
    commands: { deactivate: { from: ["ACTIVE"], to: "INACTIVE" }, activate: { from: ["INACTIVE"], to: "ACTIVE" } }
  });
  defineResource(app, {
    path: "/api/log/shipments",
    table: "log_shipments",
    label: "Shipment",
    event: "LOGISTICS_SHIPMENT",
    module: "LOG",
    view: VIEW9,
    create: Permission30.LOGISTICS_MANAGE,
    update: Permission30.LOGISTICS_MANAGE,
    fields: {
      direction: { type: "enum", values: ["OUTBOUND", "INBOUND"], required: true },
      carrier_id: { type: "ref", table: "log_carriers", label: "carrier_id" },
      party_id: { type: "ref", table: "parties", label: "party_id" },
      sales_order_id: { type: "ref", table: "sales_orders", label: "sales_order_id" },
      purchase_order_id: { type: "ref", table: "purchase_orders", label: "purchase_order_id" },
      origin: { type: "string", required: true },
      destination: { type: "string", required: true },
      packages: { type: "int", min: 1, max: 1e4, default: 1 },
      weight_kg: { type: "decimal", scale: 3 },
      planned_ship_date: { type: "date", defaultToday: true },
      promised_date: { type: "date" },
      freight_amount: { type: "decimal", default: "0", scale: 2 }
    },
    editable: ["carrier_id", "origin", "destination", "packages", "weight_kg", "planned_ship_date", "promised_date", "freight_amount"],
    editableIn: ["PLANNED", "BOOKED"],
    numbering: { column: "number", prefix: "SHP" },
    initialStatus: "PLANNED",
    select: `t.*, c.name AS carrier_name, c.code AS carrier_code, c.tracking_url_template, p.name AS party_name, so.order_number AS sales_order_number, po.po_number AS purchase_order_number,
      (t.status = 'DELIVERED' AND t.promised_date IS NOT NULL AND (t.delivered_at AT TIME ZONE 'Asia/Karachi')::date <= t.promised_date) AS on_time,
      (t.status NOT IN ('DELIVERED','CANCELLED') AND t.promised_date < CURRENT_DATE) AS late`,
    joins: "LEFT JOIN log_carriers c ON c.id = t.carrier_id LEFT JOIN parties p ON p.id = t.party_id LEFT JOIN sales_orders so ON so.id = t.sales_order_id LEFT JOIN purchase_orders po ON po.id = t.purchase_order_id",
    search: ["number", "tracking_number", "destination", "p.name", "c.name"],
    filters: ["direction", "carrier_id"],
    detail: async (q, row) => ({
      events: (await q.query(`SELECT e.*, u.name AS recorded_by FROM log_tracking_events e LEFT JOIN users u ON u.id = e.created_by WHERE e.shipment_id = $1 ORDER BY e.event_at, e.created_at`, [row.id])).rows,
      tracking_url: row.tracking_url_template && row.tracking_number ? String(row.tracking_url_template).replace("{tracking}", encodeURIComponent(row.tracking_number)) : null
    }),
    beforeCreate: async (ctx, v) => {
      if (v.sales_order_id && v.purchase_order_id)
        throw validationError("Link a sales order or a purchase order, not both", { field: "purchase_order_id" });
      if (v.direction === "OUTBOUND" && v.purchase_order_id)
        throw validationError("Outbound shipments link to sales orders", { field: "purchase_order_id" });
      if (v.direction === "INBOUND" && v.sales_order_id)
        throw validationError("Inbound shipments link to purchase orders", { field: "sales_order_id" });
      if (v.promised_date && v.planned_ship_date && v.promised_date < v.planned_ship_date)
        throw validationError("promised_date cannot be before planned_ship_date", { field: "promised_date" });
      const src = v.sales_order_id ? await loadRow(ctx.tx, "sales_orders", v.sales_order_id, ctx.org, "Sales order") : v.purchase_order_id ? await loadRow(ctx.tx, "purchase_orders", v.purchase_order_id, ctx.org, "Purchase order") : null;
      if (src) {
        if (["CANCELLED", "DRAFT"].includes(src.status))
          throw new ApiError(409, ErrorCode39.INVALID_STATE, `Linked order is ${src.status}`);
        if (v.party_id && v.party_id !== src.party_id)
          throw validationError("Party differs from the linked order", { field: "party_id" });
        v.party_id = src.party_id;
      }
    },
    commands: {
      book: {
        from: ["PLANNED"],
        to: "BOOKED",
        permission: Permission30.LOGISTICS_MANAGE,
        fields: { carrier_id: { type: "ref", table: "log_carriers", label: "carrier_id" }, tracking_number: { type: "string", required: true, max: 80, pattern: /^[A-Za-z0-9-]+$/ } },
        run: async (ctx, row, i) => {
          const carrierId = i.carrier_id || row.carrier_id;
          if (!carrierId)
            throw validationError("Choose a carrier", { field: "carrier_id" });
          const c = await loadRow(ctx.tx, "log_carriers", carrierId, ctx.org, "Carrier");
          if (c.status !== "ACTIVE")
            throw new ApiError(409, ErrorCode39.INVALID_STATE, `${c.name} is inactive`);
          const dup = await ctx.tx.query(`SELECT number FROM log_shipments WHERE organization_id = $1 AND carrier_id = $2 AND tracking_number = $3 AND id <> $4`, [ctx.org, carrierId, i.tracking_number, row.id]);
          if (dup.rows[0])
            throw new ApiError(409, ErrorCode39.DUPLICATE_RESOURCE, `Tracking number already used on ${dup.rows[0].number}`, { field: "tracking_number" });
          await addEvent(ctx, row.id, { event_at: (/* @__PURE__ */ new Date()).toISOString(), code: "BOOKED", note: `${c.name} \xB7 ${i.tracking_number}`, source: "SYSTEM" });
          return { set: { carrier_id: carrierId, tracking_number: i.tracking_number } };
        }
      },
      dispatch: {
        from: ["BOOKED"],
        to: "IN_TRANSIT",
        permission: Permission30.LOGISTICS_MANAGE,
        fields: { shipped_at: { type: "datetime" }, location: { type: "string" } },
        run: async (ctx, row, i) => {
          const at = i.shipped_at || (/* @__PURE__ */ new Date()).toISOString();
          if (new Date(at).getTime() > Date.now() + 5 * 6e4)
            throw validationError("shipped_at cannot be in the future", { field: "shipped_at" });
          await addEvent(ctx, row.id, { event_at: at, code: "PICKED_UP", location: i.location || row.origin, source: "SYSTEM" });
          return { set: { shipped_at: at } };
        }
      },
      deliver: {
        from: ["IN_TRANSIT", "EXCEPTION"],
        to: "DELIVERED",
        permission: Permission30.LOGISTICS_MANAGE,
        fields: { pod_name: { type: "string", required: true }, pod_note: { type: "text" }, delivered_at: { type: "datetime" } },
        run: async (ctx, row, i) => {
          const at = i.delivered_at || (/* @__PURE__ */ new Date()).toISOString();
          if (row.shipped_at && new Date(at) < new Date(row.shipped_at))
            throw validationError("Delivery cannot precede dispatch", { field: "delivered_at" });
          if (new Date(at).getTime() > Date.now() + 5 * 6e4)
            throw validationError("delivered_at cannot be in the future", { field: "delivered_at" });
          await addEvent(ctx, row.id, { event_at: at, code: "DELIVERED", location: row.destination, note: `Received by ${i.pod_name}`, source: "SYSTEM" });
          return { set: { delivered_at: at, pod_name: i.pod_name, pod_note: i.pod_note, exception_reason: null } };
        }
      },
      exception: {
        from: ["BOOKED", "IN_TRANSIT"],
        to: "EXCEPTION",
        permission: Permission30.LOGISTICS_MANAGE,
        fields: { exception_reason: { type: "text", required: true } },
        run: async (ctx, row, i) => {
          await addEvent(ctx, row.id, { event_at: (/* @__PURE__ */ new Date()).toISOString(), code: "EXCEPTION", note: i.exception_reason, source: "SYSTEM" });
          return { set: { exception_reason: i.exception_reason } };
        }
      },
      resume: { from: ["EXCEPTION"], to: "IN_TRANSIT", permission: Permission30.LOGISTICS_MANAGE },
      cancel: { from: ["PLANNED", "BOOKED"], to: "CANCELLED", permission: Permission30.LOGISTICS_MANAGE },
      "post-freight": {
        from: ["BOOKED", "IN_TRANSIT", "DELIVERED", "EXCEPTION"],
        permission: Permission30.LOGISTICS_POST,
        fields: { posting_date: { type: "date" } },
        run: async (ctx, row, i) => {
          if (row.freight_journal_id)
            throw new ApiError(409, ErrorCode39.ALREADY_BILLED, "Freight has already been posted for this shipment");
          const amt = new Money31(row.freight_amount);
          if (!amt.isPositive())
            throw validationError("Set a freight amount before posting", { field: "freight_amount" });
          const c = row.carrier_id ? await loadRow(ctx.tx, "log_carriers", row.carrier_id, ctx.org, "Carrier") : null;
          const date = i.posting_date || todayIso();
          const credit = c?.party_id ? { account_code: "211001", credit: amt.toFixed(8), party_id: c.party_id, description: `Freight payable ${row.number}` } : { account_code: "211003", credit: amt.toFixed(8), description: `Accrued freight ${row.number}` };
          const j = await postJournal(ctx.tx, auditLogger, outboxService, {
            organizationId: ctx.org,
            legalEntityId: ctx.le,
            userId: ctx.user,
            postingDate: date,
            purpose: AccountingPurpose20.FREIGHT_CHARGE,
            description: `Freight ${row.number} ${c ? c.name : ""}`.trim(),
            sourceType: "SHIPMENT",
            sourceId: row.id,
            sourceKey: `LOG_FREIGHT:${row.id}`,
            numberPrefix: "JV-LOG",
            correlationId: ctx.req.correlationId,
            lines: [{ account_code: "521012", debit: amt.toFixed(8), description: `Freight ${row.number} \u2192 ${row.destination}` }, credit]
          });
          return { set: { freight_journal_id: j?.journalId ?? null }, data: j };
        }
      }
    }
  });
  app.post("/api/log/shipments/:id/events", authenticate, requireAnyPermission(Permission30.LOGISTICS_MANAGE), requireModule("LOG"), async (req, res) => {
    const out = await unitOfWork(req, async (ctx) => {
      const s = await loadRow(ctx.tx, "log_shipments", req.params.id, ctx.org, "Shipment", true);
      if (["PLANNED", "CANCELLED", "DELIVERED"].includes(s.status))
        throw new ApiError(409, ErrorCode39.INVALID_STATE, `No tracking events on a ${s.status.toLowerCase()} shipment`);
      const at = new Date(String(req.body?.event_at || ""));
      if (Number.isNaN(at.getTime()))
        throw validationError("event_at must be an ISO date-time", { field: "event_at" });
      if (at.getTime() > Date.now() + 5 * 6e4)
        throw validationError("event_at cannot be in the future", { field: "event_at" });
      const code = oneOf(req.body?.code, "code", CODES.filter((c) => c !== "DELIVERED" && c !== "BOOKED"));
      const ev = await addEvent(ctx, s.id, { event_at: at.toISOString(), code, location: req.body?.location ? str(req.body.location, "location", { max: 255 }) : null, note: req.body?.note ? str(req.body.note, "note", { max: 2e3 }) : null, source: req.body?.source === "CARRIER" ? "CARRIER" : "MANUAL" });
      if (ev) {
        await audit2(ctx, "LOGISTICS_TRACKING_EVENT", "LOGISTICS_SHIPMENT", s.id, void 0, { code, event_at: ev.event_at });
        await emit(ctx, "LOGISTICS_TRACKING_EVENT", { id: s.id, number: s.number, code, location: ev.location });
      }
      return { event: ev, replayed: !ev };
    });
    return ok(req, res, out, out.replayed ? 200 : 201);
  });
  app.get("/api/log/summary", authenticate, requireAnyPermission(...VIEW9), async (req, res) => {
    const org = req.session.organization_id;
    const r = (await db.query(`SELECT COUNT(*) FILTER (WHERE status IN ('BOOKED','IN_TRANSIT'))::int in_flight, COUNT(*) FILTER (WHERE status = 'EXCEPTION')::int exceptions,
          COUNT(*) FILTER (WHERE status NOT IN ('DELIVERED','CANCELLED') AND promised_date < CURRENT_DATE)::int late,
          COUNT(*) FILTER (WHERE status = 'DELIVERED' AND promised_date IS NOT NULL)::int delivered_promised,
          COUNT(*) FILTER (WHERE status = 'DELIVERED' AND promised_date IS NOT NULL AND (delivered_at AT TIME ZONE 'Asia/Karachi')::date <= promised_date)::int delivered_on_time,
          COALESCE(SUM(freight_amount) FILTER (WHERE freight_journal_id IS NOT NULL AND created_at >= date_trunc('month', NOW())),0)::text freight_mtd,
          COUNT(*) FILTER (WHERE freight_journal_id IS NULL AND freight_amount > 0 AND status <> 'CANCELLED')::int freight_unposted
         FROM log_shipments WHERE organization_id = $1`, [org])).rows[0];
    return ok(req, res, { ...r, otd_pct: r.delivered_promised ? (r.delivered_on_time / r.delivered_promised * 100).toFixed(1) : null });
  });
}

// apps/api/dist/routes/bi.js
init_context();
init_http();
init_errors();
init_resource();
init_validate();
import { Permission as Permission31, ErrorCode as ErrorCode40 } from "@omnysync/contracts";
var DATASETS = [
  {
    code: "revenue_by_month",
    name: "Revenue by month",
    description: "Posted revenue (credit \u2212 debit on REVENUE accounts) per calendar month.",
    permission: [Permission31.FINANCE_REPORTS_VIEW],
    dimension: "month",
    measures: ["revenue"],
    sql: `SELECT to_char(j.posting_date, 'YYYY-MM') AS month, SUM(jl.base_credit - jl.base_debit)::numeric(24,2)::text AS revenue
          FROM journal_lines jl JOIN journals j ON j.id = jl.journal_id JOIN accounts a ON a.id = jl.account_id
          WHERE j.organization_id = $1 AND j.status IN ('POSTED','REVERSED') AND a.statement_class = 'REVENUE' AND j.posting_date BETWEEN $2 AND $3
          GROUP BY 1 ORDER BY 1`
  },
  {
    code: "expense_by_account",
    name: "Expenses by account",
    description: "Posted expense by leaf account in the window.",
    permission: [Permission31.FINANCE_REPORTS_VIEW],
    dimension: "account",
    measures: ["amount"],
    sql: `SELECT a.code || ' ' || a.name AS account, SUM(jl.base_debit - jl.base_credit)::numeric(24,2)::text AS amount
          FROM journal_lines jl JOIN journals j ON j.id = jl.journal_id JOIN accounts a ON a.id = jl.account_id
          WHERE j.organization_id = $1 AND j.status IN ('POSTED','REVERSED') AND a.statement_class = 'EXPENSE' AND j.posting_date BETWEEN $2 AND $3
          GROUP BY a.code, a.name HAVING SUM(jl.base_debit - jl.base_credit) <> 0 ORDER BY SUM(jl.base_debit - jl.base_credit) DESC LIMIT 15`
  },
  {
    code: "ar_aging",
    name: "Receivables aging",
    description: "Outstanding posted customer invoices by days past due at the window end.",
    permission: [Permission31.FINANCE_REPORTS_VIEW],
    dimension: "bucket",
    measures: ["outstanding", "invoices"],
    sql: `WITH x AS (SELECT outstanding_amount, ($3::date - due_date) AS dpd FROM ar_invoices WHERE organization_id = $1 AND status NOT IN ('DRAFT','CANCELLED','VOID') AND outstanding_amount > 0 AND invoice_date <= $3 AND invoice_date >= $2::date - 3650)
          SELECT b.bucket, COALESCE(SUM(x.outstanding_amount),0)::numeric(24,2)::text AS outstanding, COUNT(x.*)::int AS invoices
          FROM (VALUES (1,'Current'),(2,'1\u201330'),(3,'31\u201360'),(4,'61\u201390'),(5,'90+')) AS b(ord, bucket)
          LEFT JOIN x ON (CASE WHEN x.dpd <= 0 THEN 1 WHEN x.dpd <= 30 THEN 2 WHEN x.dpd <= 60 THEN 3 WHEN x.dpd <= 90 THEN 4 ELSE 5 END) = b.ord
          GROUP BY b.ord, b.bucket ORDER BY b.ord`
  },
  {
    code: "service_cases_by_status",
    name: "Service cases by status",
    description: "Service cases opened in the window by current status.",
    permission: [Permission31.SERVICE_VIEW, Permission31.SERVICE_MANAGE],
    dimension: "status",
    measures: ["cases"],
    sql: `SELECT status, COUNT(*)::int AS cases FROM srv_cases WHERE organization_id = $1 AND (created_at AT TIME ZONE 'Asia/Karachi')::date BETWEEN $2 AND $3 GROUP BY status ORDER BY cases DESC`
  },
  {
    code: "service_sla_by_priority",
    name: "SLA attainment by priority",
    description: "Resolved cases within their (pause-adjusted) resolution SLA, % by priority.",
    permission: [Permission31.SERVICE_VIEW, Permission31.SERVICE_MANAGE],
    dimension: "priority",
    measures: ["attainment_pct", "resolved"],
    sql: `SELECT priority, COUNT(*)::int AS resolved,
            ROUND(100.0 * COUNT(*) FILTER (WHERE resolved_at <= resolution_due_at + (paused_minutes || ' minutes')::interval) / NULLIF(COUNT(*),0), 1)::text AS attainment_pct
          FROM srv_cases WHERE organization_id = $1 AND resolved_at IS NOT NULL AND (resolved_at AT TIME ZONE 'Asia/Karachi')::date BETWEEN $2 AND $3
          GROUP BY priority ORDER BY CASE priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END`
  },
  {
    code: "technician_hours",
    name: "Technician hours",
    description: "Approved service hours per technician in the window.",
    permission: [Permission31.SERVICE_MANAGE],
    dimension: "technician",
    measures: ["hours"],
    sql: `SELECT t.name AS technician, ROUND(SUM(te.minutes) / 60.0, 2)::text AS hours FROM srv_time_entries te JOIN srv_technicians t ON t.id = te.technician_id
          WHERE te.organization_id = $1 AND te.status = 'APPROVED' AND (te.start_at AT TIME ZONE 'Asia/Karachi')::date BETWEEN $2 AND $3 GROUP BY t.name ORDER BY SUM(te.minutes) DESC`
  },
  {
    code: "pipeline_by_stage",
    name: "Sales pipeline by stage",
    description: "Open opportunity value and weighted value per stage (not date-filtered).",
    permission: [Permission31.CRM_VIEW, Permission31.CRM_MANAGE],
    dimension: "stage",
    measures: ["amount", "weighted"],
    sql: `SELECT stage, SUM(amount)::numeric(24,2)::text AS amount, SUM(amount * probability / 100)::numeric(24,2)::text AS weighted FROM crm_opportunities
          WHERE organization_id = $1 AND status = 'OPEN' AND ($2::date IS NOT NULL AND $3::date IS NOT NULL)
          GROUP BY stage ORDER BY CASE stage WHEN 'PROSPECTING' THEN 0 WHEN 'QUALIFICATION' THEN 1 WHEN 'SITE_SURVEY' THEN 2 WHEN 'PROPOSAL' THEN 3 ELSE 4 END`
  },
  {
    code: "stock_value_by_item",
    name: "Stock value by item",
    description: "Perpetual stock value at standard cost (top 15) as of the window end.",
    permission: [Permission31.INVENTORY_MANAGE, Permission31.FINANCE_REPORTS_VIEW],
    dimension: "item",
    measures: ["value", "quantity"],
    sql: `SELECT i.code AS item, SUM(sm.total_value)::numeric(24,2)::text AS value, SUM(sm.quantity)::numeric(24,2)::text AS quantity FROM stock_movements sm JOIN items i ON i.id = sm.item_id
          WHERE sm.organization_id = $1 AND sm.movement_date <= $3 AND $2::date IS NOT NULL GROUP BY i.code HAVING SUM(sm.quantity) <> 0 ORDER BY SUM(sm.total_value) DESC LIMIT 15`
  }
];
function csvCell(v) {
  const s = v == null ? "" : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
var CHARTS = ["BAR", "LINE", "TABLE", "KPI"];
var datasetByCode = (c) => DATASETS.find((d) => d.code === c);
var canRead = (perms2, d) => d.permission.some((p) => perms2.includes(p));
function validateWidgets(raw) {
  const list = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!Array.isArray(list))
    throw validationError("widgets must be a list", { field: "widgets" });
  if (list.length > 12)
    throw validationError("A dashboard can hold at most 12 widgets", { field: "widgets" });
  return list.map((w, i) => {
    const d = datasetByCode(String(w?.dataset));
    if (!d)
      throw validationError(`Widget ${i + 1}: unknown dataset "${w?.dataset}"`, { field: "widgets" });
    if (!CHARTS.includes(w.chart))
      throw validationError(`Widget ${i + 1}: chart must be one of ${CHARTS.join(", ")}`, { field: "widgets" });
    const measure = w.measure || d.measures[0];
    if (!d.measures.includes(measure))
      throw validationError(`Widget ${i + 1}: ${d.code} has no measure "${measure}" (use ${d.measures.join(", ")})`, { field: "widgets" });
    return { dataset: d.code, chart: w.chart, title: String(w.title || d.name).slice(0, 120), measure };
  });
}
async function runDataset(q, org, d, from, to) {
  if (from > to)
    throw validationError("from must be on or before to", { field: "from" });
  const r = await q.query(d.sql, [org, from, to]);
  return r.rows;
}
function window(query) {
  const to = query.to ? dateOnly(query.to, "to") : todayIso();
  const from = query.from ? dateOnly(query.from, "from") : `${to.slice(0, 4)}-01-01`;
  return { from, to };
}
function registerBiRoutes(app) {
  const VIEW14 = [Permission31.BI_VIEW, Permission31.BI_MANAGE];
  app.get("/api/bi/datasets", authenticate, requireAnyPermission(...VIEW14), async (req, res) => {
    const perms2 = req.session.permissions;
    return ok(req, res, DATASETS.map(({ sql: _sql, ...d }) => ({ ...d, readable: canRead(perms2, d) })));
  });
  app.get("/api/bi/datasets/:code/query", authenticate, requireAnyPermission(...VIEW14), async (req, res) => {
    const d = datasetByCode(req.params.code);
    if (!d)
      throw notFound("Dataset");
    if (!canRead(req.session.permissions, d))
      throw new ApiError(403, ErrorCode40.FORBIDDEN_SCOPE, `You need ${d.permission.join(" or ")} to read ${d.name}`);
    const { from, to } = window(req.query);
    const rows = await runDataset(db, req.session.organization_id, d, from, to);
    if (req.query.format === "csv") {
      const cols = [d.dimension, ...d.measures];
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${d.code}_${from}_${to}.csv"`);
      return res.send([cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n"));
    }
    return ok(req, res, { dataset: d.code, from, to, dimension: d.dimension, measures: d.measures, rows });
  });
  defineResource(app, {
    path: "/api/bi/dashboards",
    table: "bi_dashboards",
    label: "Dashboard",
    event: "BI_DASHBOARD",
    module: "BI",
    view: VIEW14,
    create: Permission31.BI_MANAGE,
    update: Permission31.BI_MANAGE,
    fields: {
      code: { type: "string", required: true, max: 40, pattern: /^[A-Z0-9-]+$/ },
      name: { type: "string", required: true },
      description: { type: "text" },
      widgets: { type: "json", required: true },
      visibility: { type: "enum", values: ["PRIVATE", "SHARED"], default: "PRIVATE" }
    },
    editable: ["name", "description", "widgets", "visibility"],
    editableIn: ["ACTIVE"],
    initialStatus: "ACTIVE",
    select: `t.*, u.name AS owner_name, jsonb_array_length(t.widgets) AS widget_count`,
    joins: "LEFT JOIN users u ON u.id = t.created_by",
    search: ["code", "t.name"],
    filters: ["visibility"],
    orderBy: "t.name",
    beforeCreate: async (ctx, v) => {
      v.widgets = JSON.stringify(validateWidgets(v.widgets));
      const dup = await ctx.tx.query(`SELECT 1 FROM bi_dashboards WHERE organization_id = $1 AND code = $2`, [ctx.org, v.code]);
      if (dup.rows.length)
        throw new ApiError(409, ErrorCode40.DUPLICATE_RESOURCE, `Dashboard ${v.code} already exists`, { field: "code" });
    },
    beforeUpdate: async (ctx, row, v) => {
      if (row.created_by !== ctx.user && !ctx.req.session.permissions.includes(Permission31.CONFIG_MANAGE))
        throw new ApiError(403, ErrorCode40.FORBIDDEN_SCOPE, "Only the owner can edit this dashboard");
      if (v.widgets !== void 0)
        v.widgets = JSON.stringify(validateWidgets(v.widgets));
    },
    commands: { archive: { from: ["ACTIVE"], to: "ARCHIVED", permission: Permission31.BI_MANAGE }, restore: { from: ["ARCHIVED"], to: "ACTIVE", permission: Permission31.BI_MANAGE } }
  });
  app.get("/api/bi/dashboards/:id/render", authenticate, requireAnyPermission(...VIEW14), async (req, res) => {
    const org = req.session.organization_id;
    const r = await db.query(`SELECT * FROM bi_dashboards WHERE organization_id = $1 AND id::text = $2`, [org, req.params.id]);
    const dash = r.rows[0];
    if (!dash || dash.visibility === "PRIVATE" && dash.created_by !== req.session.user_id)
      throw notFound("Dashboard");
    const { from, to } = window(req.query);
    const perms2 = req.session.permissions;
    const widgets = [];
    for (const w of typeof dash.widgets === "string" ? JSON.parse(dash.widgets) : dash.widgets) {
      const d = datasetByCode(w.dataset);
      if (!d) {
        widgets.push({ ...w, error: "Dataset no longer exists" });
        continue;
      }
      if (!canRead(perms2, d)) {
        widgets.push({ ...w, forbidden: true, dimension: d.dimension, rows: [] });
        continue;
      }
      widgets.push({ ...w, dimension: d.dimension, measures: d.measures, rows: await runDataset(db, org, d, from, to) });
    }
    return ok(req, res, { id: dash.id, name: dash.name, description: dash.description, from, to, widgets });
  });
}

// apps/api/dist/routes/documents.js
init_context();
init_http();
init_errors();
init_resource();
init_modules();
init_scope();
init_validate();
import crypto22 from "node:crypto";
import { Permission as Permission32, ErrorCode as ErrorCode41 } from "@omnysync/contracts";
var VIEW10 = [Permission32.DOC_VIEW, Permission32.DOC_MANAGE, Permission32.DOC_HOLD];
var MAX_BYTES = 5 * 1024 * 1024;
var LINKABLE = {
  PARTY: "parties",
  SERVICE_CASE: "srv_cases",
  SERVICE_WORK_ORDER: "srv_work_orders",
  SERVICE_CONTRACT: "srv_contracts",
  OPPORTUNITY: "crm_opportunities",
  SUPPLIER: "sup_profiles",
  SHIPMENT: "log_shipments",
  PROJECT: "projects",
  EMPLOYEE: "employees",
  PURCHASE_ORDER: "purchase_orders",
  SALES_ORDER: "sales_orders",
  CANDIDATE: "tal_candidates"
};
var LINK_LABEL = {
  PARTY: { from: "parties x", label: "x.code || ' \xB7 ' || x.name", order: "x.code" },
  SERVICE_CASE: { from: "srv_cases x", label: "x.number || ' \xB7 ' || x.title", order: "x.number DESC" },
  SERVICE_WORK_ORDER: { from: "srv_work_orders x", label: "x.number || ' \xB7 ' || x.status", order: "x.number DESC" },
  SERVICE_CONTRACT: { from: "srv_contracts x", label: "x.number || ' \xB7 ' || x.title", order: "x.number DESC" },
  OPPORTUNITY: { from: "crm_opportunities x", label: "x.number || ' \xB7 ' || x.name", order: "x.number DESC" },
  SUPPLIER: { from: "sup_profiles x JOIN parties p ON p.id = x.party_id", label: "p.code || ' \xB7 ' || p.name", order: "p.code" },
  SHIPMENT: { from: "log_shipments x", label: "x.number || ' \xB7 ' || x.status", order: "x.number DESC" },
  PROJECT: { from: "projects x", label: "x.code || ' \xB7 ' || x.name", order: "x.code" },
  EMPLOYEE: { from: "employees x", label: "x.employee_number || ' \xB7 ' || x.first_name || ' ' || x.last_name", order: "x.employee_number" },
  PURCHASE_ORDER: { from: "purchase_orders x", label: "x.po_number || ' \xB7 ' || x.status", order: "x.po_number DESC" },
  SALES_ORDER: { from: "sales_orders x", label: "x.order_number || ' \xB7 ' || x.status", order: "x.order_number DESC" },
  CANDIDATE: { from: "tal_candidates x", label: "x.full_name || ' \xB7 ' || x.email", order: "x.full_name" }
};
var entityLabelSql = `CASE t.entity_type ${Object.entries(LINK_LABEL).map(([k, d]) => `WHEN '${k}' THEN (SELECT ${d.label} FROM ${d.from} WHERE x.id::text = t.entity_id::text AND x.organization_id = t.organization_id)`).join(" ")} END`;
var MIME = {
  "application/pdf": { ext: ["pdf"], magic: (b) => b.subarray(0, 5).toString("latin1") === "%PDF-" },
  "image/png": { ext: ["png"], magic: (b) => b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  "image/jpeg": { ext: ["jpg", "jpeg"], magic: (b) => b[0] === 255 && b[1] === 216 && b[2] === 255 },
  "text/plain": { ext: ["txt", "csv"], magic: (b) => !b.subarray(0, 4096).includes(0) },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { ext: ["docx"], magic: (b) => b[0] === 80 && b[1] === 75 },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { ext: ["xlsx"], magic: (b) => b[0] === 80 && b[1] === 75 }
};
function inspectUpload(filename, mime, contentBase64) {
  const spec = MIME[mime];
  if (!spec)
    throw validationError(`File type ${mime} is not allowed (${Object.keys(MIME).join(", ")})`, { field: "mime_type" });
  const clean = filename.replace(/[\\/]/g, "_").replace(/[\u0000-\u001f]/g, "").trim();
  if (!clean || clean.length > 255)
    throw validationError("Invalid filename", { field: "filename" });
  const ext = clean.includes(".") ? clean.split(".").pop().toLowerCase() : "";
  if (!spec.ext.includes(ext))
    throw validationError(`A ${mime} file must end with .${spec.ext.join(" / .")}`, { field: "filename" });
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(contentBase64))
    throw validationError("content_base64 is not valid base64", { field: "content_base64" });
  const bytes = Buffer.from(contentBase64, "base64");
  if (!bytes.length)
    throw validationError("File is empty", { field: "content_base64" });
  if (bytes.length > MAX_BYTES)
    throw validationError(`File exceeds ${MAX_BYTES / 1048576} MB`, { field: "content_base64" });
  if (spec.magic && !spec.magic(bytes))
    throw validationError(`File content does not match ${mime}`, { field: "content_base64" });
  return { filename: clean, bytes, sha256: crypto22.createHash("sha256").update(bytes).digest("hex") };
}
function registerDocumentRoutes(app) {
  defineResource(app, {
    path: "/api/doc/documents",
    table: "doc_documents",
    label: "Document",
    event: "DOCUMENT",
    module: "DOC",
    view: VIEW10,
    create: Permission32.DOC_MANAGE,
    update: Permission32.DOC_MANAGE,
    fields: {
      title: { type: "string", required: true },
      category: { type: "enum", values: ["CONTRACT", "WARRANTY_CARD", "SITE_PHOTO", "INVOICE", "CERTIFICATE", "DRAWING", "POLICY", "HR", "OTHER"], required: true },
      entity_type: { type: "enum", values: Object.keys(LINKABLE) },
      entity_id: { type: "string", max: 64 },
      retention_until: { type: "date" }
    },
    editable: ["title", "retention_until"],
    editableIn: ["DRAFT", "IN_REVIEW", "APPROVED"],
    numbering: { column: "number", prefix: "DOC" },
    initialStatus: "DRAFT",
    select: `t.*, v.filename, v.mime_type, v.size_bytes, v.sha256, u.name AS owner_name, ${entityLabelSql} AS entity_label`,
    joins: "LEFT JOIN doc_versions v ON v.document_id = t.id AND v.version_no = t.current_version LEFT JOIN users u ON u.id = t.created_by",
    search: ["number", "title", "v.filename"],
    filters: ["category", "entity_type", "entity_id", "legal_hold"],
    detail: async (q, row) => ({
      versions: (await q.query(`SELECT v.id, v.version_no, v.filename, v.mime_type, v.size_bytes, v.sha256, v.note, v.created_at, (v.content IS NOT NULL) AS has_content, u.name AS uploaded_by_name FROM doc_versions v LEFT JOIN users u ON u.id = v.uploaded_by WHERE v.document_id = $1 ORDER BY v.version_no DESC`, [row.id])).rows
    }),
    beforeCreate: async (ctx, v) => {
      if (!!v.entity_type !== !!v.entity_id)
        throw validationError("Provide both entity_type and entity_id to link a record", { field: "entity_id" });
      if (v.entity_type)
        await assertOrgRef(ctx.tx, LINKABLE[v.entity_type], v.entity_id, ctx.org, "entity_id");
    },
    commands: {
      submit: {
        from: ["DRAFT"],
        to: "IN_REVIEW",
        permission: Permission32.DOC_MANAGE,
        run: async (ctx, row) => {
          if (!row.current_version)
            throw new ApiError(409, ErrorCode41.INVALID_STATE, "Upload a file before submitting for review");
          return { set: { submitted_by: ctx.user } };
        }
      },
      approve: { from: ["IN_REVIEW"], to: "APPROVED", permission: Permission32.DOC_MANAGE, sodColumn: "submitted_by", run: async (ctx) => ({ set: { approved_by: ctx.user, approved_at: (/* @__PURE__ */ new Date()).toISOString() } }) },
      return: { from: ["IN_REVIEW"], to: "DRAFT", permission: Permission32.DOC_MANAGE },
      obsolete: { from: ["APPROVED"], to: "OBSOLETE", permission: Permission32.DOC_MANAGE },
      hold: { from: ["DRAFT", "IN_REVIEW", "APPROVED", "OBSOLETE"], permission: Permission32.DOC_HOLD, fields: { hold_reason: { type: "text", required: true } }, run: async (_c, row, i) => {
        if (row.legal_hold)
          throw new ApiError(409, ErrorCode41.INVALID_STATE, "Document is already on legal hold");
        return { set: { legal_hold: true, hold_reason: i.hold_reason } };
      } },
      release: { from: ["DRAFT", "IN_REVIEW", "APPROVED", "OBSOLETE"], permission: Permission32.DOC_HOLD, fields: { hold_reason: { type: "text", required: true } }, run: async (_c, row, i) => {
        if (!row.legal_hold)
          throw new ApiError(409, ErrorCode41.INVALID_STATE, "Document is not on legal hold");
        return { set: { legal_hold: false, hold_reason: `Released: ${i.hold_reason}` } };
      } },
      delete: {
        from: ["DRAFT", "IN_REVIEW", "APPROVED", "OBSOLETE"],
        to: "DELETED",
        permission: Permission32.DOC_MANAGE,
        fields: { reason: { type: "text", required: true } },
        run: async (ctx, row) => {
          if (row.legal_hold)
            throw new ApiError(409, ErrorCode41.LEGAL_HOLD, `Document is under legal hold (${row.hold_reason}) and cannot be deleted`);
          if (row.retention_until && toIsoDate(row.retention_until) > todayIso())
            throw new ApiError(409, ErrorCode41.LEGAL_HOLD, `Retention period runs until ${toIsoDate(row.retention_until)}`);
          await ctx.tx.query(`UPDATE doc_versions SET content = NULL WHERE document_id = $1`, [row.id]);
          return { set: { deleted_at: (/* @__PURE__ */ new Date()).toISOString() } };
        }
      }
    }
  });
  app.get("/api/doc/link-targets", authenticate, requireAnyPermission(Permission32.DOC_MANAGE), async (req, res) => {
    const type = String(req.query.type || "");
    const d = LINK_LABEL[type];
    if (!d)
      throw validationError(`type must be one of ${Object.keys(LINK_LABEL).join(", ")}`, { field: "type" });
    const search = typeof req.query.search === "string" && req.query.search.trim() ? `%${req.query.search.trim().slice(0, 80)}%` : null;
    const r = await db.query(`SELECT x.id, ${d.label} AS label FROM ${d.from} WHERE x.organization_id = $1 AND ($2::text IS NULL OR ${d.label} ILIKE $2) ORDER BY ${d.order} LIMIT 200`, [req.session.organization_id, search]);
    return ok(req, res, r.rows.map((x) => ({ ...x, entity_type: type })));
  });
  app.post("/api/doc/documents/:id/versions", authenticate, requireAnyPermission(Permission32.DOC_MANAGE), requireModule("DOC"), async (req, res) => {
    const out = await unitOfWork(req, async (ctx) => {
      const d = await loadRow(ctx.tx, "doc_documents", req.params.id, ctx.org, "Document", true);
      if (!["DRAFT", "APPROVED"].includes(d.status))
        throw new ApiError(409, ErrorCode41.INVALID_STATE, `Cannot add a version to a ${d.status.toLowerCase().replace("_", " ")} document`);
      const f = inspectUpload(str(req.body?.filename, "filename", { max: 255 }), str(req.body?.mime_type, "mime_type", { max: 80 }), String(req.body?.content_base64 ?? ""));
      const latest = (await ctx.tx.query(`SELECT sha256 FROM doc_versions WHERE document_id = $1 AND version_no = $2`, [d.id, d.current_version])).rows[0];
      if (latest && latest.sha256 === f.sha256)
        throw new ApiError(409, ErrorCode41.DUPLICATE_RESOURCE, `Identical to version ${d.current_version} (same sha256)`);
      const n = Number(d.current_version) + 1;
      const v = (await ctx.tx.query(`INSERT INTO doc_versions (organization_id, document_id, version_no, filename, mime_type, size_bytes, sha256, content, note, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING id, version_no, filename, mime_type, size_bytes, sha256, created_at`, [ctx.org, d.id, n, f.filename, req.body.mime_type, f.bytes.length, f.sha256, f.bytes, req.body?.note ? str(req.body.note, "note", { max: 2e3 }) : null, ctx.user])).rows[0];
      await ctx.tx.query(`UPDATE doc_documents SET current_version = $2, status = CASE WHEN status = 'APPROVED' THEN 'DRAFT' ELSE status END, approved_by = CASE WHEN status = 'APPROVED' THEN NULL ELSE approved_by END, revision = revision + 1, updated_at = NOW() WHERE id = $1`, [d.id, n]);
      await audit2(ctx, "DOCUMENT_VERSION_ADDED", "DOCUMENT", d.id, { version: d.current_version }, { version: n, sha256: f.sha256, size: f.bytes.length });
      await emit(ctx, "DOCUMENT_VERSION_ADDED", { id: d.id, number: d.number, version: n, sha256: f.sha256 });
      return { ...v, requires_review: d.status === "APPROVED" };
    });
    return ok(req, res, out, 201);
  });
  app.get("/api/doc/documents/:id/versions/:v/download", authenticate, requireAnyPermission(...VIEW10), async (req, res) => {
    const org = req.session.organization_id;
    const r = await db.query(`SELECT v.* FROM doc_versions v JOIN doc_documents d ON d.id = v.document_id WHERE d.organization_id = $1 AND d.id::text = $2 AND v.version_no = $3`, [org, req.params.id, Number(req.params.v) || 0]);
    const v = r.rows[0];
    if (!v)
      throw notFound("Document version");
    if (!v.content)
      throw new ApiError(410, ErrorCode41.INVALID_STATE, "Content was purged when the document was deleted; only the hash trail remains");
    const bytes = Buffer.isBuffer(v.content) ? v.content : Buffer.from(v.content);
    if (crypto22.createHash("sha256").update(bytes).digest("hex") !== v.sha256)
      throw new ApiError(500, ErrorCode41.INVALID_STATE, "Stored content failed its integrity check");
    res.setHeader("Content-Type", v.mime_type);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `attachment; filename="${String(v.filename).replace(/"/g, "")}"`);
    res.setHeader("X-Content-SHA256", v.sha256);
    return res.send(bytes);
  });
  app.get("/api/doc/summary", authenticate, requireAnyPermission(...VIEW10), async (req, res) => {
    const org = req.session.organization_id;
    const s = (await db.query(`SELECT COUNT(*) FILTER (WHERE status <> 'DELETED')::int documents, COUNT(*) FILTER (WHERE status = 'IN_REVIEW')::int in_review, COUNT(*) FILTER (WHERE legal_hold)::int on_hold,
          COUNT(*) FILTER (WHERE status <> 'DELETED' AND retention_until IS NOT NULL AND retention_until < CURRENT_DATE)::int retention_expired,
          (SELECT COALESCE(SUM(size_bytes),0)::bigint FROM doc_versions WHERE organization_id = $1 AND content IS NOT NULL)::text stored_bytes
         FROM doc_documents WHERE organization_id = $1`, [org])).rows[0];
    return ok(req, res, s);
  });
}

// apps/api/dist/routes/fleet.js
init_numbering();
init_context();
init_http();
init_errors();
init_resource();
init_validate();
init_posting();
import crypto23 from "node:crypto";
import { Permission as Permission33, ErrorCode as ErrorCode42, AccountingPurpose as AccountingPurpose21 } from "@omnysync/contracts";
import { Money as Money32 } from "@omnysync/financial-engine";
var VIEW11 = [Permission33.FLEET_VIEW, Permission33.FLEET_MANAGE, Permission33.FLEET_POST];
var MAX_KM_JUMP = 3e3;
function checkOdometer(previous, next) {
  const n = new Money32(next);
  if (previous == null)
    return null;
  const p = new Money32(previous);
  if (!n.gt(p))
    throw validationError(`Odometer must be greater than the last reading (${p.toFixed(1)} km)`, { field: "odometer_km" });
  if (n.sub(p).gt(MAX_KM_JUMP))
    throw validationError(`A ${n.sub(p).toFixed(0)} km jump since the last fill looks wrong (max ${MAX_KM_JUMP} km)`, { field: "odometer_km" });
  return n.sub(p);
}
function registerFleetRoutes(app) {
  defineResource(app, {
    path: "/api/flt/vehicles",
    table: "flt_vehicles",
    label: "Vehicle",
    event: "FLEET_VEHICLE",
    module: "FLT",
    view: VIEW11,
    create: Permission33.FLEET_MANAGE,
    update: Permission33.FLEET_MANAGE,
    fields: {
      code: { type: "string", required: true, max: 32, pattern: /^[A-Z0-9-]+$/ },
      registration: { type: "string", required: true, max: 32, pattern: /^[A-Za-z0-9 -]+$/ },
      make_model: { type: "string", required: true, max: 120 },
      model_year: { type: "int", min: 1980, max: 2100 },
      fuel_type: { type: "enum", values: ["PETROL", "DIESEL", "CNG", "HYBRID", "EV"], default: "PETROL" },
      odometer_km: { type: "decimal", default: "0", scale: 1 },
      insurance_expiry: { type: "date" },
      fitness_expiry: { type: "date" }
    },
    editable: ["make_model", "insurance_expiry", "fitness_expiry"],
    initialStatus: "ACTIVE",
    select: `t.*, (t.insurance_expiry < CURRENT_DATE + 30 OR t.fitness_expiry < CURRENT_DATE + 30) AS compliance_due,
      (SELECT tech.name FROM flt_assignments a JOIN srv_technicians tech ON tech.id = a.technician_id WHERE a.vehicle_id = t.id AND a.status = 'BOOKED' AND NOW() BETWEEN a.start_at AND a.end_at LIMIT 1) AS current_driver,
      (SELECT ROUND(AVG(km_per_litre), 2) FROM flt_fuel_logs f WHERE f.vehicle_id = t.id AND f.status <> 'VOID' AND f.km_per_litre IS NOT NULL) AS avg_km_per_litre`,
    search: ["code", "registration", "make_model"],
    filters: ["fuel_type"],
    orderBy: "t.code",
    detail: async (q, row) => ({
      maintenance_work_order: row.maintenance_work_order_id ? (await q.query(`SELECT id, work_order_number, status, priority, description, total_cost FROM maintenance_work_orders WHERE id = $1`, [row.maintenance_work_order_id])).rows[0] ?? null : null,
      fuel: (await q.query(`SELECT * FROM flt_fuel_logs WHERE vehicle_id = $1 ORDER BY log_date DESC, odometer_km DESC LIMIT 20`, [row.id])).rows,
      assignments: (await q.query(`SELECT a.*, tech.name AS technician_name FROM flt_assignments a JOIN srv_technicians tech ON tech.id = a.technician_id WHERE a.vehicle_id = $1 ORDER BY a.start_at DESC LIMIT 20`, [row.id])).rows
    }),
    beforeCreate: async (ctx, v) => {
      v.registration = String(v.registration).toUpperCase();
      const dup = await ctx.tx.query(`SELECT code FROM flt_vehicles WHERE organization_id = $1 AND (code = $2 OR registration = $3)`, [ctx.org, v.code, v.registration]);
      if (dup.rows[0])
        throw new ApiError(409, ErrorCode42.DUPLICATE_RESOURCE, `Vehicle ${dup.rows[0].code} already uses that code or registration`, { field: "registration" });
    },
    commands: {
      maintenance: {
        from: ["ACTIVE"],
        to: "IN_MAINTENANCE",
        permission: Permission33.FLEET_MANAGE,
        fields: { status_note: { type: "text", required: true }, priority: { type: "enum", values: ["LOW", "MEDIUM", "HIGH", "EMERGENCY"] } },
        run: async (ctx, row, i) => {
          let equipmentId = row.maintenance_equipment_id;
          if (!equipmentId) {
            equipmentId = crypto23.randomUUID();
            await ctx.tx.query(`INSERT INTO maintenance_equipment (id, organization_id, legal_entity_id, equipment_code, name, category, criticality, serial_number) VALUES ($1,$2,$3,$4,$5,'VEHICLE','HIGH',$6)`, [equipmentId, ctx.org, ctx.le, `FLT-${row.code}`, `${row.code} \xB7 ${row.make_model || row.registration}`, row.registration]);
          }
          const woId = crypto23.randomUUID();
          const woNum = await nextDocumentNumber(ctx.tx, ctx.org, "WO");
          await ctx.tx.query(`INSERT INTO maintenance_work_orders (id, organization_id, legal_entity_id, work_order_number, equipment_id, order_type, priority, status, description, start_date, created_by)
             VALUES ($1,$2,$3,$4,$5,'CORRECTIVE',$6,'SCHEDULED',$7,CURRENT_DATE,$8)`, [woId, ctx.org, ctx.le, woNum, equipmentId, i.priority || "MEDIUM", `Fleet ${row.code} (${row.registration}): ${i.status_note}`, ctx.user]);
          await ctx.tx.query(`UPDATE maintenance_equipment SET status = 'UNDER_MAINTENANCE', updated_at = NOW() WHERE id = $1`, [equipmentId]);
          return { set: { status_note: i.status_note, maintenance_equipment_id: equipmentId, maintenance_work_order_id: woId }, data: { work_order_number: woNum } };
        }
      },
      reactivate: {
        from: ["IN_MAINTENANCE"],
        to: "ACTIVE",
        permission: Permission33.FLEET_MANAGE,
        run: async (ctx, row) => {
          if (row.maintenance_work_order_id) {
            const wo = (await ctx.tx.query(`SELECT work_order_number, status FROM maintenance_work_orders WHERE id = $1 AND organization_id = $2`, [row.maintenance_work_order_id, ctx.org])).rows[0];
            if (wo && !["COMPLETED", "CANCELLED"].includes(wo.status)) {
              throw new ApiError(409, ErrorCode42.INVALID_STATE, `Maintenance work order ${wo.work_order_number} is ${wo.status.toLowerCase()} \u2014 complete or cancel it first`, { work_order_number: wo.work_order_number });
            }
          }
          return { set: { maintenance_work_order_id: null } };
        }
      },
      retire: {
        from: ["ACTIVE", "IN_MAINTENANCE"],
        to: "RETIRED",
        permission: Permission33.FLEET_MANAGE,
        fields: { status_note: { type: "text", required: true } },
        run: async (ctx, row, i) => {
          const n = (await ctx.tx.query(`SELECT COUNT(*)::int n FROM flt_assignments WHERE vehicle_id = $1 AND status = 'BOOKED' AND end_at > NOW()`, [row.id])).rows[0].n;
          if (n)
            throw new ApiError(409, ErrorCode42.INVALID_STATE, `${n} future assignment(s) must be cancelled first`);
          return { set: { status_note: i.status_note } };
        }
      }
    }
  });
  defineResource(app, {
    path: "/api/flt/assignments",
    table: "flt_assignments",
    label: "Assignment",
    event: "FLEET_ASSIGNMENT",
    module: "FLT",
    view: VIEW11,
    create: Permission33.FLEET_MANAGE,
    update: false,
    fields: {
      vehicle_id: { type: "ref", table: "flt_vehicles", required: true, label: "vehicle_id" },
      technician_id: { type: "ref", table: "srv_technicians", required: true, label: "technician_id" },
      start_at: { type: "datetime", required: true },
      end_at: { type: "datetime", required: true },
      purpose: { type: "string" }
    },
    initialStatus: "BOOKED",
    select: `t.*, v.code AS vehicle_code, v.registration, tech.name AS technician_name`,
    joins: "JOIN flt_vehicles v ON v.id = t.vehicle_id JOIN srv_technicians tech ON tech.id = t.technician_id",
    search: ["v.code", "v.registration", "tech.name", "purpose"],
    filters: ["vehicle_id", "technician_id"],
    orderBy: "t.start_at DESC",
    beforeCreate: async (ctx, v) => {
      if (new Date(v.end_at) <= new Date(v.start_at))
        throw validationError("end_at must be after start_at", { field: "end_at" });
      const veh = (await ctx.tx.query(`SELECT * FROM flt_vehicles WHERE id = $1 FOR UPDATE`, [v.vehicle_id])).rows[0];
      if (veh.status !== "ACTIVE")
        throw new ApiError(409, ErrorCode42.INVALID_STATE, `${veh.code} is ${veh.status.toLowerCase().replace("_", " ")}`);
      await ctx.tx.query(`SELECT 1 FROM srv_technicians WHERE id = $1 FOR UPDATE`, [v.technician_id]);
      const clash = (await ctx.tx.query(`SELECT a.vehicle_id, v.code, tech.name FROM flt_assignments a JOIN flt_vehicles v ON v.id = a.vehicle_id JOIN srv_technicians tech ON tech.id = a.technician_id
           WHERE a.organization_id = $1 AND a.status = 'BOOKED' AND (a.vehicle_id = $2 OR a.technician_id = $3) AND a.start_at < $5 AND a.end_at > $4 LIMIT 1`, [ctx.org, v.vehicle_id, v.technician_id, v.start_at, v.end_at])).rows[0];
      if (clash)
        throw new ApiError(409, ErrorCode42.CAPACITY_CONFLICT, clash.vehicle_id === v.vehicle_id ? `${clash.code} is already assigned to ${clash.name} in that window` : `${clash.name} already has ${clash.code} in that window`);
    },
    commands: {
      return: { from: ["BOOKED"], to: "RETURNED", permission: Permission33.FLEET_MANAGE, run: async () => ({ set: { returned_at: (/* @__PURE__ */ new Date()).toISOString() } }) },
      cancel: { from: ["BOOKED"], to: "CANCELLED", permission: Permission33.FLEET_MANAGE }
    }
  });
  defineResource(app, {
    path: "/api/flt/fuel",
    table: "flt_fuel_logs",
    label: "Fuel log",
    event: "FLEET_FUEL",
    module: "FLT",
    view: VIEW11,
    create: Permission33.FLEET_MANAGE,
    update: false,
    fields: {
      vehicle_id: { type: "ref", table: "flt_vehicles", required: true, label: "vehicle_id" },
      log_date: { type: "date", required: true },
      odometer_km: { type: "decimal", required: true, scale: 1 },
      litres: { type: "decimal", required: true, sign: "positive", scale: 2 },
      amount: { type: "decimal", required: true, sign: "positive", scale: 2 },
      station: { type: "string", max: 120 },
      paid_by: { type: "enum", values: ["CASH", "ACCOUNT"], default: "CASH" }
    },
    initialStatus: "LOGGED",
    select: `t.*, v.code AS vehicle_code, v.registration, ROUND(t.amount / NULLIF(t.litres, 0), 2) AS price_per_litre`,
    joins: "JOIN flt_vehicles v ON v.id = t.vehicle_id",
    search: ["v.code", "v.registration", "station"],
    filters: ["vehicle_id", "paid_by"],
    orderBy: "t.log_date DESC, t.odometer_km DESC",
    beforeCreate: async (ctx, v) => {
      const veh = (await ctx.tx.query(`SELECT * FROM flt_vehicles WHERE id = $1 FOR UPDATE`, [v.vehicle_id])).rows[0];
      if (veh.status === "RETIRED")
        throw new ApiError(409, ErrorCode42.INVALID_STATE, `${veh.code} is retired`);
      if (veh.fuel_type === "EV")
        throw validationError("EVs are charged, not fuelled \u2014 log charging as an expense", { field: "vehicle_id" });
      const last = (await ctx.tx.query(`SELECT odometer_km::text, log_date FROM flt_fuel_logs WHERE vehicle_id = $1 AND status <> 'VOID' ORDER BY odometer_km DESC LIMIT 1`, [veh.id])).rows[0];
      if (last && v.log_date < toIsoDate(last.log_date))
        throw validationError(`log_date is before the last fill (${toIsoDate(last.log_date)})`, { field: "log_date" });
      const prev = last?.odometer_km ?? (new Money32(veh.odometer_km).isPositive() ? String(veh.odometer_km) : null);
      const dist = checkOdometer(prev, v.odometer_km);
      v.previous_odometer_km = prev;
      v.km_per_litre = dist ? dist.div(v.litres).round(2).toFixed(2) : null;
      await ctx.tx.query(`UPDATE flt_vehicles SET odometer_km = GREATEST(odometer_km, $2), updated_at = NOW() WHERE id = $1`, [veh.id, v.odometer_km]);
    },
    commands: {
      post: {
        from: ["LOGGED"],
        to: "POSTED",
        permission: Permission33.FLEET_POST,
        run: async (ctx, row) => {
          const veh = await loadRow(ctx.tx, "flt_vehicles", row.vehicle_id, ctx.org, "Vehicle");
          const amt = new Money32(row.amount).toFixed(8);
          const j = await postJournal(ctx.tx, auditLogger, outboxService, {
            organizationId: ctx.org,
            legalEntityId: ctx.le,
            userId: ctx.user,
            postingDate: toIsoDate(row.log_date),
            purpose: AccountingPurpose21.FLEET_EXPENSE,
            description: `Fuel ${veh.code} ${veh.registration} ${new Money32(row.litres).toFixed(2)} L`,
            sourceType: "FLEET_FUEL",
            sourceId: row.id,
            sourceKey: `FLT_FUEL:${row.id}`,
            numberPrefix: "JV-FLT",
            correlationId: ctx.req.correlationId,
            lines: [
              { account_code: "521011", debit: amt, description: `Fuel ${veh.code}` },
              { account_code: row.paid_by === "CASH" ? "111001" : "211003", credit: amt, description: row.paid_by === "CASH" ? "Cash paid at pump" : "Fuel card / account payable" }
            ]
          });
          return { set: { journal_id: j?.journalId ?? null }, data: j };
        }
      },
      void: { from: ["LOGGED"], to: "VOID", permission: Permission33.FLEET_MANAGE, fields: { void_reason: { type: "text", required: true } }, run: async (_c, _r, i) => ({ set: { void_reason: i.void_reason } }) }
    }
  });
  app.get("/api/flt/summary", authenticate, requireAnyPermission(...VIEW11), async (req, res) => {
    const org = req.session.organization_id;
    const v = (await db.query(`SELECT COUNT(*) FILTER (WHERE status='ACTIVE')::int active, COUNT(*) FILTER (WHERE status='IN_MAINTENANCE')::int maintenance, COUNT(*) FILTER (WHERE status <> 'RETIRED' AND (insurance_expiry < CURRENT_DATE + 30 OR fitness_expiry < CURRENT_DATE + 30))::int compliance_due FROM flt_vehicles WHERE organization_id = $1`, [org])).rows[0];
    const f = (await db.query(`SELECT COALESCE(SUM(amount) FILTER (WHERE log_date >= date_trunc('month', CURRENT_DATE)),0)::text fuel_mtd, COALESCE(SUM(litres) FILTER (WHERE log_date >= date_trunc('month', CURRENT_DATE)),0)::text litres_mtd, ROUND(AVG(km_per_litre),2)::text avg_kmpl, COUNT(*) FILTER (WHERE status='LOGGED')::int unposted FROM flt_fuel_logs WHERE organization_id = $1 AND status <> 'VOID'`, [org])).rows[0];
    return ok(req, res, { ...v, ...f });
  });
}

// apps/api/dist/routes/grc.js
init_context();
init_http();
init_errors();
init_resource();
init_modules();
init_validate();
init_numbering();
init_config();
import { Permission as Permission34, ErrorCode as ErrorCode43 } from "@omnysync/contracts";
var VIEW12 = [Permission34.GRC_VIEW, Permission34.GRC_MANAGE];
var FREQ = { MONTHLY: 1, QUARTERLY: 3, ANNUAL: 12 };
var score = (l, i) => l * i;
function checkResidual(l, i, rl, ri) {
  if (rl == null !== (ri == null))
    throw validationError("Give both residual likelihood and impact, or neither", { field: rl == null ? "residual_likelihood" : "residual_impact" });
  if (rl != null && ri != null && score(rl, ri) > score(l, i))
    throw validationError("Residual score cannot exceed the inherent score", { field: "residual_likelihood" });
}
function registerGrcRoutes(app) {
  const riskSel = `t.*, t.likelihood * t.impact AS inherent_score, t.residual_likelihood * t.residual_impact AS residual_score,
    (SELECT COUNT(*)::int FROM grc_controls c WHERE c.risk_id = t.id AND c.status <> 'RETIRED') AS controls,
    (SELECT COUNT(*)::int FROM grc_controls c WHERE c.risk_id = t.id AND c.status = 'DEFICIENT') AS deficient_controls`;
  defineResource(app, {
    path: "/api/grc/risks",
    table: "grc_risks",
    label: "Risk",
    event: "GRC_RISK",
    module: "GRC",
    view: VIEW12,
    create: Permission34.GRC_MANAGE,
    update: Permission34.GRC_MANAGE,
    fields: {
      title: { type: "string", required: true },
      description: { type: "text" },
      category: { type: "enum", values: ["OPERATIONAL", "FINANCIAL", "COMPLIANCE", "SAFETY", "IT", "STRATEGIC"], required: true },
      owner: { type: "string", max: 120 },
      likelihood: { type: "int", required: true, min: 1, max: 5 },
      impact: { type: "int", required: true, min: 1, max: 5 },
      residual_likelihood: { type: "int", min: 1, max: 5 },
      residual_impact: { type: "int", min: 1, max: 5 },
      treatment: { type: "enum", values: ["MITIGATE", "ACCEPT", "TRANSFER", "AVOID"], default: "MITIGATE" },
      review_date: { type: "date" }
    },
    editable: ["title", "description", "owner", "likelihood", "impact", "residual_likelihood", "residual_impact", "treatment", "review_date"],
    editableIn: ["OPEN", "MITIGATING", "ACCEPTED"],
    numbering: { column: "code", prefix: "RSK" },
    initialStatus: "OPEN",
    select: riskSel,
    search: ["code", "title", "owner"],
    filters: ["category"],
    orderBy: "(t.likelihood * t.impact) DESC, t.code",
    beforeCreate: async (_c, v) => checkResidual(v.likelihood, v.impact, v.residual_likelihood, v.residual_impact),
    beforeUpdate: async (_c, row, v) => {
      const m = { ...row, ...v };
      checkResidual(m.likelihood, m.impact, m.residual_likelihood, m.residual_impact);
      if (row.status === "ACCEPTED" && (v.residual_likelihood !== void 0 || v.residual_impact !== void 0 || v.likelihood !== void 0 || v.impact !== void 0)) {
        v.status = "OPEN";
      }
    },
    detail: async (q, row) => ({
      controls: (await q.query(`SELECT id, code, title, control_type, frequency, status, last_result, next_test_due FROM grc_controls WHERE risk_id = $1 ORDER BY code`, [row.id])).rows,
      incidents: (await q.query(`SELECT id, number, title, severity, status, occurred_on FROM grc_incidents WHERE risk_id = $1 ORDER BY occurred_on DESC`, [row.id])).rows
    }),
    commands: {
      start_mitigation: { from: ["OPEN"], to: "MITIGATING", permission: Permission34.GRC_MANAGE },
      accept: {
        from: ["OPEN", "MITIGATING"],
        to: "ACCEPTED",
        permission: Permission34.GRC_MANAGE,
        fields: { acceptance_note: { type: "text", required: true } },
        run: async (ctx, row, i) => {
          const appetite = Number(await getSetting(ctx.tx, ctx.org, "grc.risk_appetite"));
          const s = row.residual_likelihood != null ? score(row.residual_likelihood, row.residual_impact) : score(row.likelihood, row.impact);
          if (s > appetite)
            throw new ApiError(409, ErrorCode43.INVALID_STATE, `Residual score ${s} exceeds the risk appetite (${appetite}); mitigate further or raise the appetite`, { score: s, appetite });
          return { set: { acceptance_note: i.acceptance_note, treatment: "ACCEPT" } };
        }
      },
      close: {
        from: ["OPEN", "MITIGATING", "ACCEPTED"],
        to: "CLOSED",
        permission: Permission34.GRC_MANAGE,
        run: async (ctx, row) => {
          const d = (await ctx.tx.query(`SELECT code FROM grc_controls WHERE risk_id = $1 AND status = 'DEFICIENT'`, [row.id])).rows;
          if (d.length)
            throw new ApiError(409, ErrorCode43.INVALID_STATE, `Deficient controls must be remediated first: ${d.map((x) => x.code).join(", ")}`);
          return {};
        }
      },
      reopen: { from: ["CLOSED", "ACCEPTED"], to: "OPEN", permission: Permission34.GRC_MANAGE }
    }
  });
  defineResource(app, {
    path: "/api/grc/controls",
    table: "grc_controls",
    label: "Control",
    event: "GRC_CONTROL",
    module: "GRC",
    view: VIEW12,
    create: Permission34.GRC_MANAGE,
    update: Permission34.GRC_MANAGE,
    fields: {
      title: { type: "string", required: true },
      risk_id: { type: "ref", table: "grc_risks", required: true, label: "risk_id" },
      control_type: { type: "enum", values: ["PREVENTIVE", "DETECTIVE", "CORRECTIVE"], required: true },
      frequency: { type: "enum", values: ["MONTHLY", "QUARTERLY", "ANNUAL"], required: true },
      owner: { type: "string", max: 120 },
      procedure: { type: "text" },
      next_test_due: { type: "date" }
    },
    editable: ["title", "owner", "procedure", "frequency", "next_test_due"],
    editableIn: ["DESIGN", "OPERATING", "DEFICIENT"],
    numbering: { column: "code", prefix: "CTL" },
    initialStatus: "DESIGN",
    select: `t.*, r.code AS risk_code, r.title AS risk_title, (t.next_test_due < CURRENT_DATE) AS test_overdue`,
    joins: "JOIN grc_risks r ON r.id = t.risk_id",
    search: ["t.code", "t.title", "r.title"],
    filters: ["risk_id"],
    beforeCreate: async (ctx, v) => {
      const r = await loadRow(ctx.tx, "grc_risks", v.risk_id, ctx.org, "Risk");
      if (r.status === "CLOSED")
        throw new ApiError(409, ErrorCode43.INVALID_STATE, "Cannot add a control to a closed risk");
    },
    detail: async (q, row) => ({ tests: (await q.query(`SELECT t.*, u.email AS tested_by_email FROM grc_control_tests t LEFT JOIN users u ON u.id = t.tested_by WHERE t.control_id = $1 ORDER BY t.test_date DESC, t.created_at DESC`, [row.id])).rows }),
    commands: { retire: { from: ["DESIGN", "OPERATING", "DEFICIENT"], to: "RETIRED", permission: Permission34.GRC_MANAGE } }
  });
  app.post("/api/grc/controls/:id/tests", authenticate, requireAnyPermission(Permission34.GRC_MANAGE), requireModule("GRC", "command"), async (req, res) => {
    const b = req.body || {};
    const testDate = b.test_date ? dateOnly(b.test_date, "test_date") : todayIso();
    if (testDate > todayIso())
      throw validationError("test_date cannot be in the future", { field: "test_date" });
    if (!["PASS", "FAIL"].includes(b.result))
      throw validationError("result must be PASS or FAIL", { field: "result" });
    const evidence = String(b.evidence ?? "").trim();
    if (evidence.length < 5)
      throw validationError("evidence is required (what was sampled and seen)", { field: "evidence" });
    const sample = b.sample_size === void 0 || b.sample_size === null || b.sample_size === "" ? null : int(b.sample_size, "sample_size", { min: 1, max: 1e5 });
    const exceptions = b.exceptions === void 0 || b.exceptions === "" ? 0 : int(b.exceptions, "exceptions", { min: 0, max: 1e5 });
    if (sample !== null && exceptions > sample)
      throw validationError("exceptions cannot exceed sample_size", { field: "exceptions" });
    if (b.result === "PASS" && exceptions > 0 && sample !== null && exceptions / sample > 0.05)
      throw validationError("More than 5% exceptions cannot be recorded as PASS", { field: "result" });
    const out = await unitOfWork(req, async (ctx) => {
      const c = await loadRow(ctx.tx, "grc_controls", req.params.id, ctx.org, "Control", true);
      if (c.status === "RETIRED")
        throw new ApiError(409, ErrorCode43.INVALID_STATE, "Control is retired");
      const t = await ctx.tx.query(`INSERT INTO grc_control_tests (organization_id, control_id, test_date, result, sample_size, exceptions, evidence, tested_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [ctx.org, c.id, testDate, b.result, sample, exceptions, evidence, ctx.user]);
      const latest = !c.last_tested_on || testDate >= toIsoDate(c.last_tested_on);
      let incident = null;
      if (latest) {
        await ctx.tx.query(`UPDATE grc_controls SET last_tested_on = $2, last_result = $3, next_test_due = $4, status = $5, revision = revision + 1, updated_at = NOW() WHERE id = $1`, [c.id, testDate, b.result, addMonths(testDate, FREQ[c.frequency]), b.result === "PASS" ? "OPERATING" : "DEFICIENT"]);
      }
      if (b.result === "FAIL") {
        const number = await nextDocumentNumber(ctx.tx, ctx.org, "INC", testDate);
        incident = (await ctx.tx.query(`INSERT INTO grc_incidents (organization_id, legal_entity_id, number, title, severity, incident_type, occurred_on, risk_id, control_id, description, due_date, status, created_by) VALUES ($1,$2,$3,$4,'HIGH','CONTROL_FAILURE',$5,$6,$7,$8,$9,'REPORTED',$10) RETURNING id, number`, [ctx.org, ctx.le, number, `Control ${c.code} failed testing`, testDate, c.risk_id, c.id, evidence, addMonths(testDate, 1), ctx.user])).rows[0];
        await emit(ctx, "GRC_CONTROL_FAILED", { control_id: c.id, code: c.code, incident_id: incident.id });
      }
      await audit2(ctx, "TEST", "GRC_CONTROL", c.id, void 0, { result: b.result, test_date: testDate });
      return { ...t.rows[0], incident };
    });
    return ok(req, res, out, 201);
  });
  defineResource(app, {
    path: "/api/grc/incidents",
    table: "grc_incidents",
    label: "Incident",
    event: "GRC_INCIDENT",
    module: "GRC",
    view: VIEW12,
    create: Permission34.GRC_MANAGE,
    update: Permission34.GRC_MANAGE,
    fields: {
      title: { type: "string", required: true },
      severity: { type: "enum", values: ["LOW", "MEDIUM", "HIGH", "CRITICAL"], required: true },
      incident_type: { type: "enum", values: ["SAFETY", "ENVIRONMENTAL", "DATA", "FRAUD", "OPERATIONAL", "CONTROL_FAILURE"], default: "OPERATIONAL" },
      occurred_on: { type: "date", required: true },
      risk_id: { type: "ref", table: "grc_risks", label: "risk_id" },
      description: { type: "text" },
      root_cause: { type: "text" },
      corrective_action: { type: "text" },
      due_date: { type: "date" }
    },
    editable: ["title", "severity", "description", "root_cause", "corrective_action", "due_date", "risk_id"],
    editableIn: ["REPORTED", "INVESTIGATING"],
    numbering: { column: "number", prefix: "INC", dateField: "occurred_on" },
    initialStatus: "REPORTED",
    select: `t.*, r.code AS risk_code, c.code AS control_code, (t.due_date < CURRENT_DATE AND t.status IN ('REPORTED','INVESTIGATING')) AS overdue`,
    joins: "LEFT JOIN grc_risks r ON r.id = t.risk_id LEFT JOIN grc_controls c ON c.id = t.control_id",
    search: ["number", "t.title"],
    filters: ["severity"],
    beforeCreate: async (_c, v) => {
      if (v.occurred_on > todayIso())
        throw validationError("occurred_on cannot be in the future", { field: "occurred_on" });
    },
    commands: {
      investigate: { from: ["REPORTED"], to: "INVESTIGATING", permission: Permission34.GRC_MANAGE },
      resolve: {
        from: ["REPORTED", "INVESTIGATING"],
        to: "RESOLVED",
        permission: Permission34.GRC_MANAGE,
        fields: { root_cause: { type: "text" }, corrective_action: { type: "text" } },
        run: async (ctx, row, i) => {
          const rc = i.root_cause ?? row.root_cause;
          const ca = i.corrective_action ?? row.corrective_action;
          if (!rc || !ca)
            throw validationError("Root cause and corrective action are required to resolve", { field: !rc ? "root_cause" : "corrective_action" });
          return { set: { root_cause: rc, corrective_action: ca } };
        }
      },
      close: {
        from: ["RESOLVED"],
        to: "CLOSED",
        permission: Permission34.GRC_MANAGE,
        sodColumn: "created_by"
      }
    }
  });
  app.get("/api/grc/summary", authenticate, requireAnyPermission(...VIEW12), async (req, res) => {
    const org = req.session.organization_id;
    const risks = (await db.query(`SELECT likelihood, impact, residual_likelihood, residual_impact, status FROM grc_risks WHERE organization_id = $1 AND status <> 'CLOSED'`, [org])).rows;
    const heat = Array.from({ length: 5 }, () => Array(5).fill(0));
    for (const r of risks)
      heat[5 - (r.residual_likelihood ?? r.likelihood)][(r.residual_impact ?? r.impact) - 1]++;
    const appetite = Number(await getSetting(db, org, "grc.risk_appetite"));
    const above = risks.filter((r) => score(r.residual_likelihood ?? r.likelihood, r.residual_impact ?? r.impact) > appetite).length;
    const c = (await db.query(`SELECT COUNT(*) FILTER (WHERE status='DEFICIENT')::int deficient, COUNT(*) FILTER (WHERE status <> 'RETIRED' AND next_test_due < CURRENT_DATE)::int tests_overdue, COUNT(*) FILTER (WHERE status='OPERATING')::int operating FROM grc_controls WHERE organization_id = $1`, [org])).rows[0];
    const i = (await db.query(`SELECT COUNT(*) FILTER (WHERE status IN ('REPORTED','INVESTIGATING'))::int open_incidents, COUNT(*) FILTER (WHERE status IN ('REPORTED','INVESTIGATING') AND severity IN ('HIGH','CRITICAL'))::int open_high FROM grc_incidents WHERE organization_id = $1`, [org])).rows[0];
    return ok(req, res, { open_risks: risks.length, above_appetite: above, appetite, heatmap: heat, ...c, ...i });
  });
}

// apps/api/dist/routes/talent.js
init_context();
init_http();
init_errors();
init_resource();
init_modules();
init_validate();
import { Permission as Permission35, ErrorCode as ErrorCode44 } from "@omnysync/contracts";
import { Money as Money33 } from "@omnysync/financial-engine";
var VIEW13 = [Permission35.TALENT_VIEW, Permission35.TALENT_MANAGE];
var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function splitName(full) {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1)
    return { first: parts[0], last: "-" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}
function registerTalentRoutes(app) {
  defineResource(app, {
    path: "/api/tal/requisitions",
    table: "tal_requisitions",
    label: "Requisition",
    event: "TALENT_REQUISITION",
    module: "TAL",
    view: VIEW13,
    create: Permission35.TALENT_MANAGE,
    update: Permission35.TALENT_MANAGE,
    fields: {
      title: { type: "string", required: true },
      department: { type: "string", max: 120 },
      location: { type: "string", max: 120 },
      employment_type: { type: "enum", values: ["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN"], default: "FULL_TIME" },
      positions: { type: "int", min: 1, max: 100, default: 1 },
      salary_min: { type: "decimal", required: true, sign: "positive", scale: 2 },
      salary_max: { type: "decimal", required: true, sign: "positive", scale: 2 },
      target_date: { type: "date" },
      justification: { type: "text" }
    },
    editable: ["title", "department", "location", "positions", "salary_min", "salary_max", "target_date", "justification"],
    editableIn: ["DRAFT", "OPEN", "ON_HOLD"],
    numbering: { column: "number", prefix: "REQ" },
    initialStatus: "DRAFT",
    select: `t.*, (SELECT COUNT(*)::int FROM tal_applications a WHERE a.requisition_id = t.id AND a.status NOT IN ('REJECTED','WITHDRAWN','HIRED')) AS active_applicants`,
    search: ["number", "title", "department"],
    beforeCreate: async (_c, v) => {
      if (new Money33(v.salary_max).lt(v.salary_min))
        throw validationError("salary_max must be \u2265 salary_min", { field: "salary_max" });
    },
    beforeUpdate: async (_c, row, v) => {
      const min = v.salary_min ?? row.salary_min;
      const max = v.salary_max ?? row.salary_max;
      if (new Money33(max).lt(min))
        throw validationError("salary_max must be \u2265 salary_min", { field: "salary_max" });
      if (v.positions !== void 0 && v.positions < row.filled)
        throw validationError(`positions cannot drop below the ${row.filled} already filled`, { field: "positions" });
    },
    detail: async (q, row) => ({
      applications: (await q.query(`SELECT a.id, a.status, a.applied_on, c.full_name, c.email, (SELECT ROUND(AVG(score),1) FROM tal_interviews i WHERE i.application_id = a.id) AS avg_score FROM tal_applications a JOIN tal_candidates c ON c.id = a.candidate_id WHERE a.requisition_id = $1 ORDER BY a.created_at`, [row.id])).rows
    }),
    commands: {
      submit: { from: ["DRAFT"], to: "SUBMITTED", permission: Permission35.TALENT_MANAGE, run: async (ctx) => ({ set: { submitted_by: ctx.user } }) },
      approve: { from: ["SUBMITTED"], to: "OPEN", permission: Permission35.TALENT_MANAGE, sodColumn: "submitted_by", run: async (ctx) => ({ set: { approved_by: ctx.user } }) },
      hold: { from: ["OPEN"], to: "ON_HOLD", permission: Permission35.TALENT_MANAGE, fields: { hold_reason: { type: "text", required: true } }, run: async (_c, _r, i) => ({ set: { hold_reason: i.hold_reason } }) },
      reopen: { from: ["ON_HOLD"], to: "OPEN", permission: Permission35.TALENT_MANAGE },
      cancel: {
        from: ["DRAFT", "SUBMITTED", "OPEN", "ON_HOLD"],
        to: "CANCELLED",
        permission: Permission35.TALENT_MANAGE,
        fields: { hold_reason: { type: "text", required: true } },
        run: async (ctx, row, i) => {
          await ctx.tx.query(`UPDATE tal_applications SET status = 'REJECTED', rejection_reason = 'Requisition cancelled', updated_at = NOW() WHERE requisition_id = $1 AND status IN ('APPLIED','SCREENING','INTERVIEW','OFFER')`, [row.id]);
          return { set: { hold_reason: i.hold_reason } };
        }
      }
    }
  });
  defineResource(app, {
    path: "/api/tal/candidates",
    table: "tal_candidates",
    label: "Candidate",
    event: "TALENT_CANDIDATE",
    module: "TAL",
    view: VIEW13,
    create: Permission35.TALENT_MANAGE,
    update: Permission35.TALENT_MANAGE,
    fields: {
      full_name: { type: "string", required: true, max: 200 },
      email: { type: "string", required: true, max: 255, pattern: EMAIL },
      phone: { type: "string", max: 50 },
      source: { type: "enum", values: ["REFERRAL", "JOB_BOARD", "WALK_IN", "AGENCY", "LINKEDIN", "CAMPUS"], default: "JOB_BOARD" },
      skills: { type: "text" },
      years_experience: { type: "decimal", sign: "nonNegative", scale: 1 },
      current_city: { type: "string", max: 120 }
    },
    editable: ["full_name", "phone", "skills", "years_experience", "current_city"],
    initialStatus: "ACTIVE",
    select: `t.*, (SELECT COUNT(*)::int FROM tal_applications a WHERE a.candidate_id = t.id) AS applications`,
    search: ["full_name", "email", "skills"],
    filters: ["source"],
    beforeCreate: async (ctx, v) => {
      v.email = String(v.email).toLowerCase();
      const d = await ctx.tx.query(`SELECT 1 FROM tal_candidates WHERE organization_id = $1 AND LOWER(email) = $2`, [ctx.org, v.email]);
      if (d.rows.length)
        throw new ApiError(409, ErrorCode44.DUPLICATE_RESOURCE, `A candidate with ${v.email} already exists`);
    },
    detail: async (q, row) => ({
      // Separate key: `applications` is the list count column (it rendered as [object Object] in the drawer).
      application_history: (await q.query(`SELECT a.id, a.status, r.number, r.title FROM tal_applications a JOIN tal_requisitions r ON r.id = a.requisition_id WHERE a.candidate_id = $1 ORDER BY a.created_at DESC`, [row.id])).rows,
      // CVs and certificates are DOC documents linked to the candidate (type/size/magic-byte checked, versioned, hashed).
      documents: (await q.query(`SELECT d.id, d.number, d.title, d.category, d.status, d.current_version, v.filename, v.size_bytes FROM doc_documents d LEFT JOIN doc_versions v ON v.document_id = d.id AND v.version_no = d.current_version
           WHERE d.organization_id = $1 AND d.entity_type = 'CANDIDATE' AND d.entity_id::text = $2 AND d.status <> 'DELETED' ORDER BY d.created_at DESC`, [row.organization_id, row.id])).rows
    }),
    commands: { archive: { from: ["ACTIVE"], to: "ARCHIVED", permission: Permission35.TALENT_MANAGE }, restore: { from: ["ARCHIVED"], to: "ACTIVE", permission: Permission35.TALENT_MANAGE } }
  });
  defineResource(app, {
    path: "/api/tal/applications",
    table: "tal_applications",
    label: "Application",
    event: "TALENT_APPLICATION",
    module: "TAL",
    view: VIEW13,
    create: Permission35.TALENT_MANAGE,
    update: false,
    fields: {
      requisition_id: { type: "ref", table: "tal_requisitions", required: true, label: "requisition_id" },
      candidate_id: { type: "ref", table: "tal_candidates", required: true, label: "candidate_id" },
      applied_on: { type: "date", defaultToday: true }
    },
    initialStatus: "APPLIED",
    select: `t.*, c.full_name, c.email, c.source, r.number AS requisition_number, r.title AS requisition_title, r.salary_min, r.salary_max,
      (SELECT ROUND(AVG(score),1) FROM tal_interviews i WHERE i.application_id = t.id) AS avg_score,
      (SELECT COUNT(*)::int FROM tal_interviews i WHERE i.application_id = t.id) AS interviews`,
    joins: "JOIN tal_candidates c ON c.id = t.candidate_id JOIN tal_requisitions r ON r.id = t.requisition_id",
    search: ["c.full_name", "c.email", "r.title"],
    filters: ["requisition_id", "candidate_id"],
    beforeCreate: async (ctx, v) => {
      const r = await loadRow(ctx.tx, "tal_requisitions", v.requisition_id, ctx.org, "Requisition");
      if (r.status !== "OPEN")
        throw new ApiError(409, ErrorCode44.INVALID_STATE, `Requisition ${r.number} is not open for applications`);
      const c = await loadRow(ctx.tx, "tal_candidates", v.candidate_id, ctx.org, "Candidate");
      if (c.status !== "ACTIVE")
        throw new ApiError(409, ErrorCode44.INVALID_STATE, "Candidate is archived");
      const d = await ctx.tx.query(`SELECT 1 FROM tal_applications WHERE requisition_id = $1 AND candidate_id = $2`, [v.requisition_id, v.candidate_id]);
      if (d.rows.length)
        throw new ApiError(409, ErrorCode44.DUPLICATE_RESOURCE, "Candidate already applied to this requisition");
    },
    detail: async (q, row) => ({ interviews: (await q.query(`SELECT * FROM tal_interviews WHERE application_id = $1 ORDER BY interview_date DESC, created_at DESC`, [row.id])).rows }),
    commands: {
      screen: { from: ["APPLIED"], to: "SCREENING", permission: Permission35.TALENT_MANAGE },
      shortlist: { from: ["SCREENING"], to: "INTERVIEW", permission: Permission35.TALENT_MANAGE },
      offer: {
        from: ["INTERVIEW"],
        to: "OFFER",
        permission: Permission35.TALENT_MANAGE,
        fields: { offered_salary: { type: "decimal", required: true, sign: "positive", scale: 2 }, offer_start_date: { type: "date", required: true }, offer_note: { type: "text" } },
        run: async (ctx, row, i) => {
          const iv = (await ctx.tx.query(`SELECT recommendation, round FROM tal_interviews WHERE application_id = $1`, [row.id])).rows;
          if (!iv.some((x) => x.recommendation === "HIRE"))
            throw new ApiError(409, ErrorCode44.INVALID_STATE, "An offer needs at least one HIRE recommendation from an interview");
          if (iv.some((x) => x.round === "FINAL" && x.recommendation === "NO_HIRE"))
            throw new ApiError(409, ErrorCode44.INVALID_STATE, "Final-round interviewer recommended NO_HIRE");
          const r = await loadRow(ctx.tx, "tal_requisitions", row.requisition_id, ctx.org, "Requisition");
          if (r.status !== "OPEN")
            throw new ApiError(409, ErrorCode44.INVALID_STATE, `Requisition ${r.number} is ${r.status.toLowerCase()}`);
          const s = new Money33(String(i.offered_salary));
          if ((s.lt(r.salary_min) || s.gt(r.salary_max)) && !i.offer_note)
            throw validationError(`Offer is outside the band ${new Money33(r.salary_min).toFixed(0)}\u2013${new Money33(r.salary_max).toFixed(0)}; add an offer note justifying it`, { field: "offer_note" });
          if (String(i.offer_start_date) < todayIso())
            throw validationError("offer_start_date cannot be in the past", { field: "offer_start_date" });
          return { set: { offered_salary: i.offered_salary, offer_start_date: i.offer_start_date, offer_note: i.offer_note ?? null } };
        }
      },
      hire: {
        from: ["OFFER"],
        to: "HIRED",
        permission: Permission35.TALENT_MANAGE,
        run: async (ctx, row) => {
          const r = await loadRow(ctx.tx, "tal_requisitions", row.requisition_id, ctx.org, "Requisition", true);
          if (r.filled >= r.positions)
            throw new ApiError(409, ErrorCode44.CAPACITY_CONFLICT, `All ${r.positions} position(s) on ${r.number} are already filled`);
          const c = await loadRow(ctx.tx, "tal_candidates", row.candidate_id, ctx.org, "Candidate");
          const n = (await ctx.tx.query(`SELECT COALESCE(MAX(NULLIF(regexp_replace(employee_number, '\\D', '', 'g'), '')::int), 100) + 1 AS n FROM employees WHERE legal_entity_id = $1 AND employee_number LIKE 'EMP-%'`, [ctx.le])).rows[0].n;
          const { first, last } = splitName(c.full_name);
          const emp = await ctx.tx.query(`INSERT INTO employees (id, organization_id, legal_entity_id, employee_number, first_name, last_name, email, phone, employment_type, joining_date, status) VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,'ACTIVE') RETURNING id, employee_number`, [ctx.org, ctx.le, `EMP-${n}`, first, last, c.email, c.phone, r.employment_type, toIsoDate(row.offer_start_date)]);
          const filled = r.filled + 1;
          await ctx.tx.query(`UPDATE tal_requisitions SET filled = $2, status = $3, revision = revision + 1, updated_at = NOW() WHERE id = $1`, [r.id, filled, filled >= r.positions ? "FILLED" : r.status]);
          await emit(ctx, "TALENT_HIRED", { application_id: row.id, employee_id: emp.rows[0].id, requisition_id: r.id });
          return { set: { employee_id: emp.rows[0].id }, data: { employee_number: emp.rows[0].employee_number, requisition_status: filled >= r.positions ? "FILLED" : r.status } };
        }
      },
      reject: { from: ["APPLIED", "SCREENING", "INTERVIEW", "OFFER"], to: "REJECTED", permission: Permission35.TALENT_MANAGE, fields: { rejection_reason: { type: "text", required: true } }, run: async (_c, _r, i) => ({ set: { rejection_reason: i.rejection_reason } }) },
      withdraw: { from: ["APPLIED", "SCREENING", "INTERVIEW", "OFFER"], to: "WITHDRAWN", permission: Permission35.TALENT_MANAGE }
    }
  });
  app.post("/api/tal/applications/:id/interviews", authenticate, requireAnyPermission(Permission35.TALENT_MANAGE), requireModule("TAL", "command"), async (req, res) => {
    const b = req.body || {};
    const date = b.interview_date ? dateOnly(b.interview_date, "interview_date") : todayIso();
    const interviewer = String(b.interviewer ?? "").trim();
    if (!interviewer)
      throw validationError("interviewer is required", { field: "interviewer" });
    const score2 = int(b.score, "score", { min: 1, max: 5 });
    if (!["HIRE", "MAYBE", "NO_HIRE"].includes(b.recommendation))
      throw validationError("recommendation must be HIRE, MAYBE or NO_HIRE", { field: "recommendation" });
    const round = b.round ?? "TECHNICAL";
    if (!["PHONE", "TECHNICAL", "PRACTICAL", "HR", "FINAL"].includes(round))
      throw validationError("invalid round", { field: "round" });
    if (b.recommendation === "HIRE" && score2 < 3)
      throw validationError("A HIRE recommendation needs a score of at least 3", { field: "score" });
    const out = await unitOfWork(req, async (ctx) => {
      const a = await loadRow(ctx.tx, "tal_applications", req.params.id, ctx.org, "Application", true);
      if (a.status !== "INTERVIEW")
        throw new ApiError(409, ErrorCode44.INVALID_STATE, "Shortlist the application for interview first");
      const r = await ctx.tx.query(`INSERT INTO tal_interviews (organization_id, application_id, interview_date, interviewer, round, score, recommendation, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [ctx.org, a.id, date, interviewer, round, score2, b.recommendation, b.notes ?? null, ctx.user]);
      await audit2(ctx, "INTERVIEW", "TALENT_APPLICATION", a.id, void 0, { score: score2, recommendation: b.recommendation });
      return r.rows[0];
    });
    return ok(req, res, out, 201);
  });
  app.get("/api/tal/summary", authenticate, requireAnyPermission(...VIEW13), async (req, res) => {
    const org = req.session.organization_id;
    const r = (await db.query(`SELECT COUNT(*) FILTER (WHERE status='OPEN')::int open_reqs, COALESCE(SUM(positions - filled) FILTER (WHERE status='OPEN'),0)::int open_positions FROM tal_requisitions WHERE organization_id = $1`, [org])).rows[0];
    const a = (await db.query(`SELECT status, COUNT(*)::int n FROM tal_applications WHERE organization_id = $1 GROUP BY status`, [org])).rows;
    const by = Object.fromEntries(a.map((x) => [x.status, x.n]));
    const t = (await db.query(`SELECT ROUND(AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 86400))::int days FROM tal_applications WHERE organization_id = $1 AND status = 'HIRED'`, [org])).rows[0];
    return ok(req, res, { ...r, pipeline: (by.APPLIED || 0) + (by.SCREENING || 0) + (by.INTERVIEW || 0), offers: by.OFFER || 0, hired: by.HIRED || 0, by_stage: by, avg_days_to_hire: t.days });
  });
}

// apps/api/dist/app.js
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
function createApp() {
  const app = express();
  wrapAsyncRoutes(app);
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const incoming = req.headers["x-correlation-id"];
    req.correlationId = typeof incoming === "string" && /^[A-Za-z0-9._:-]{8,100}$/.test(incoming) ? incoming : crypto24.randomUUID();
    res.setHeader("x-correlation-id", req.correlationId);
    const start = Date.now();
    res.on("finish", () => {
      if (process.env.NODE_ENV === "test")
        return;
      const duration = Date.now() - start;
      console.log(`[${req.correlationId}] ${req.method} ${req.path} ${res.statusCode} (${duration}ms)`);
    });
    next();
  });
  app.get(["/health", "/ping"], (_req, res) => {
    res.status(200).json({
      status: "healthy",
      service: "omnysync-erp",
      uptime: process.uptime(),
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      keepAlive: getKeepAliveStatus()
    });
  });
  app.get(["/api", "/api/health"], (_req, res) => {
    res.status(200).json({
      success: true,
      data: {
        status: "healthy",
        service: "omnysync-erp-api",
        uptime: process.uptime(),
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        version: "0.2.0",
        environment: process.env.NODE_ENV || "development"
      }
    });
  });
  app.get("/api/keep-alive/status", (_req, res) => {
    res.status(200).json({
      success: true,
      data: getKeepAliveStatus()
    });
  });
  app.post("/api/keep-alive/ping", async (req, res) => {
    const targetUrl = resolveKeepAliveUrl();
    if (!targetUrl) {
      return res.status(400).json({
        success: false,
        error: { code: "CONFIG_MISSING", message: "No target URL configured for keep-alive ping" }
      });
    }
    const result = await sendPing(targetUrl);
    return res.status(result.success ? 200 : 502).json({
      success: result.success,
      data: result
    });
  });
  const allowed = (process.env.OMNYSYNC_ALLOWED_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,*").split(",").map((o) => o.trim()).filter(Boolean);
  app.use(cors({
    origin: (origin, cb) => cb(null, !origin || allowed.includes("*") || allowed.includes(origin)),
    exposedHeaders: ["x-correlation-id", "idempotent-replay"]
  }));
  const smallJson = express.json({ limit: "1mb" });
  const uploadJson = express.json({ limit: "8mb" });
  app.use((req, res, next) => /^\/api\/doc\/documents\/[^/]+\/versions$/.test(req.path) ? uploadJson(req, res, next) : smallJson(req, res, next));
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  registerPlatformRoutes(app);
  registerFinanceRoutes(app);
  registerMastersRoutes(app);
  registerSalesRoutes(app);
  registerProcurementRoutes(app);
  registerPaymentsRoutes(app);
  registerTreasuryRoutes(app);
  registerHrmRoutes(app);
  registerInventoryRoutes(app);
  registerManufacturingRoutes(app);
  registerProjectsRoutes(app);
  registerAssetsRoutes(app);
  registerPosRoutes(app);
  registerAutomationRoutes(app);
  registerQualityRoutes(app);
  registerMaintenanceRoutes(app);
  registerAdminRoutes(app);
  registerConfigRoutes(app);
  registerTaxRoutes(app);
  registerWmsRoutes(app);
  registerAutomationEventRoutes(app);
  registerServiceRoutes(app);
  registerCrmRoutes(app);
  registerTimeRoutes(app);
  registerSupplierRoutes(app);
  registerLogisticsRoutes(app);
  registerBiRoutes(app);
  registerDocumentRoutes(app);
  registerFleetRoutes(app);
  registerSubscriptionRoutes(app);
  registerBudgetRoutes(app);
  registerLendingRoutes(app);
  registerGrcRoutes(app);
  registerTalentRoutes(app);
  app.use("/api", (req, res) => {
    res.status(404).json({
      success: false,
      error: { code: "RESOURCE_NOT_FOUND", message: `No route ${req.method} ${req.path}`, correlation_id: req.correlationId }
    });
  });
  const candidateWebPaths = [
    path.resolve(__dirname, "../../web/dist"),
    path.resolve(process.cwd(), "apps/web/dist"),
    path.resolve(process.cwd(), "dist/web")
  ];
  const staticWebDir = candidateWebPaths.find((p) => fs.existsSync(p));
  if (staticWebDir) {
    console.log(`[Omnysync Web Host] Serving production frontend build from ${staticWebDir}`);
    app.use(express.static(staticWebDir));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api"))
        return next();
      const indexFile = path.join(staticWebDir, "index.html");
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        next();
      }
    });
  }
  app.use(errorHandler);
  return app;
}

// api/index.ts
var appInstance = null;
function getApp() {
  if (!appInstance) {
    appInstance = createApp();
  }
  return appInstance;
}
function handler(req, res) {
  try {
    const app = getApp();
    return app(req, res);
  } catch (err) {
    console.error("[Vercel Serverless Function Crash]:", err);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: {
          code: "SERVERLESS_FUNCTION_ERROR",
          message: err?.message || String(err),
          stack: err?.stack
        }
      });
    }
  }
}
export {
  handler as default
};
