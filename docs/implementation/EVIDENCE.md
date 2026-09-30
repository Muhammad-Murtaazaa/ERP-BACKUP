# Test and Verification Evidence

## Milestone 0 & Milestone 1 Verification Matrix

### Automated Test Matrix
| Test Suite | Target Invariant | Result | Evidence Reference |
|---|---|---|---|
| Money & Arithmetic | Exact decimal scale (24,8/24,12), half-up rounding, string serialization, rejection of NaN/Infinity | **PASSED** | `packages/financial-engine/test/financial-engine.test.ts:18` |
| Four-Level COA | Leaf-only posting validation, L1-L3 posting rejection, cycle prevention, parent rollup | **PASSED** | `packages/financial-engine/test/financial-engine.test.ts:46` |
| Balanced Journal Posting | Sum(Base Debit) = Sum(Base Credit), rejection of unbalanced drafts | **PASSED** | `packages/financial-engine/test/financial-engine.test.ts:162` |
| Period Guard & Lock | Rejection of postings in `HARD_CLOSED` or `SOFT_CLOSED` periods | **PASSED** | `packages/financial-engine/test/financial-engine.test.ts:121` |
| Immutability & Reversals | Direct UPDATE/DELETE rejection on posted facts; exact mirror linked reversal creation | **PASSED** | `packages/financial-engine/test/financial-engine.test.ts:258` |
| General Ledger & Trial Balance | Trial balance debits = credits; GL agrees with transaction line details | **PASSED** | `packages/financial-engine/test/financial-engine.test.ts:285` |
| Multi-Tenant Scope & Constraints | Organization isolation, level checks (1..4), chk_not_both_debit_credit database constraint | **PASSED** | `packages/platform/test/platform.test.ts:60` |
| Full M1 Lifecycle E2E | Draft -> Submit -> Approve -> Post -> Reversal -> Reconciled Trial Balance via REST API | **PASSED** | `apps/api/test/api.test.ts:180` |
| Hard Closed Period Guard | REST API rejects posting into HARD_CLOSED period with `PERIOD_CLOSED` code (400) | **PASSED** | `apps/api/test/api.test.ts:260` |
| Unbalanced Journal Guard | REST API rejects unbalanced debit/credit payload with `JOURNAL_UNBALANCED` code (400) | **PASSED** | `apps/api/test/api.test.ts:122` |
| Non-Leaf Account Guard | REST API rejects postings referencing non-leaf parent accounts (Level 1..3) | **PASSED** | `apps/api/test/api.test.ts:151` |
| Append-Only Audit Trail | REST API records `JOURNAL_POSTED`, `JOURNAL_REVERSED`, and COA creation events | **PASSED** | `apps/api/test/api.test.ts:291` |

### Actual Run Command & Output
```bash
$ npx vitest run

 ✓ packages/financial-engine/test/financial-engine.test.ts (15 tests) 74ms
 ✓ packages/platform/test/platform.test.ts (3 tests) 7279ms
   ✓ Platform & Database Integration: Migrations, Seeds & Tenancy > runs deterministic synthetic seed successfully 706ms
 ✓ apps/api/test/api.test.ts (6 tests) 7762ms

 Test Files  3 passed (3)
      Tests  24 passed (24)
   Duration  10.56s
```

### Production Build Command & Output
```bash
$ npm run build

> @omnysync/contracts@0.1.0 build
> tsc

> @omnysync/financial-engine@0.1.0 build
> tsc

> @omnysync/platform@0.1.0 build
> tsc

> @omnysync/ui@0.1.0 build
> tsc

> @omnysync/api@0.1.0 build
> tsc

> @omnysync/web@0.1.0 build
> tsc && vite build
✓ 1605 modules transformed.
dist/index.html                   0.73 kB │ gzip:  0.48 kB
dist/assets/index-DiKBVfXz.css   18.32 kB │ gzip:  4.25 kB
dist/assets/index-klfo927m.js   321.04 kB │ gzip: 95.68 kB
✓ built in 35.37s
```
