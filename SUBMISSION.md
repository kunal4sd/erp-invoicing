# Assignment Submission

**Candidate:** Kunal Sachdeva  
**Email:** kunal4sd@gmail.com  
**Role:** Principal Engineer — Deep Runner.AI  
**Deadline:** 1 July 2026  

---

## Repository

**GitHub URL:** https://github.com/kunal4sd/erp-invoicing

---

## Prerequisites

**You only need Docker Desktop** — nothing else. All runtimes and databases run in containers.

- Docker Desktop 4.x or later (includes Docker Compose v2)
- Git (to clone)
- Make sure Docker Desktop is **running** before executing any docker commands

## 5-Minute Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/kunal4sd/erp-invoicing.git
cd erp-invoicing

# 2. Build and start everything — one command, no other steps needed
docker compose up --build

# Postgres starts → backend builds → migrations run → seed runs → API starts → frontend builds
# Look for: "✅ Seed complete!" in the output, then the server startup message

# 3. Open the app
#    Frontend:  http://localhost:3000
#    API health: http://localhost:3001/health

# 4. Run smoke tests (optional — requires the stack to be running)
bash scripts/verify.sh
# Note: verify.sh uses X-Tenant-ID header auth (ALLOW_HEADER_AUTH=true). It does not exercise JWT login.
```

> If you prefer to run in the background: `docker compose up --build -d` then `docker compose logs -f backend` to watch progress.

The seed runs automatically on first startup. Open http://localhost:3000 and sign in with one of the demo users (password: `demo`):

| Email | Role |
|-------|------|
| `controller@demo.local` | CONTROLLER — full access |
| `clerk@demo.local` | AR_CLERK — create/send invoices and record payments in UI |
| `viewer@demo.local` | VIEWER — read-only |

Click a quick-login card on the login page, or enter email + password manually.

### What you'll see when the app opens

8 demo invoices are pre-loaded covering every lifecycle state:

| Invoice | Status | Customer | Amount | What it shows |
|---------|--------|----------|--------|---------------|
| INV-000001 | **PAID** | Alpha Tech | $12,050 | 2-line invoice (SW license + impl), 8% tax, full wire payment + GL cash entry |
| INV-000002 | **PARTIALLY_PAID** | Alpha Tech | $5,000 | $2,000 ACH received, $3,000 balance overdue 15 days |
| INV-000003 | **SENT (OVERDUE)** | Beta Enter. | $8,500 | 45 days past due — appears in 31–60 day aging bucket |
| INV-000004 | **SENT** | Beta Enter. | $3,200 | Not yet due — appears in Current aging bucket |
| INV-000005 | **APPROVED** | Alpha Tech | $16,200 | Approved, not yet sent — GL entry posted, AR on books |
| INV-000006 | **DRAFT** | Beta Enter. | $2,500 | In-progress — no GL entry until approved |
| INV-000007 | **VOID** | Alpha Tech | $1,000 | Duplicate voided — original JE + full reversal JE visible |
| INV-000008 | **WRITTEN_OFF** | Beta Enter. | $4,200 | Bad debt — DR Bad Debt Expense / CR AR journal entry visible |

Each approved+ invoice has balanced DR/CR journal entries. Payments have allocation records. AR aging and GL reconciliation reports reflect live balances.

> **Demo login:** Sign in at http://localhost:3000/login — password `demo` for all accounts. Use `controller@demo.local` for Approve/Void/Write-Off, `clerk@demo.local` to create invoices and record payments, or `viewer@demo.local` for read-only access.

> **Multi-tenant:** All seeded invoices and customers belong to Tenant A (Acme Corporation). Tenant B (Globex Inc.) is intentionally empty to demonstrate row-level isolation when queried with a different tenant ID.

---

## What Is Implemented vs. Designed Only

### Fully Implemented (code + tests)

| Feature | File(s) |
|---------|---------|
| Multi-tenant isolation (X-Tenant-ID header) | `src/middleware/tenant.ts` |
| Invoice CRUD + 7-state lifecycle | `src/modules/invoices/` |
| Invoice approval → GL journal entry generation | `invoice.service.ts:approveInvoice` |
| Invoice void + GL reversal entries | `invoice.service.ts:voidInvoice` |
| Invoice send, write-off | `invoice.service.ts` |
| Payment recording with FIFO auto-allocation | `src/modules/payments/` |
| Manual payment allocation | `payment.service.ts:recordPayment` |
| Idempotency keys on payments + invoices | Both services |
| Credit memo create + apply to invoice | `src/modules/credit-memos/` |
| AR aging report (5 buckets per customer) | `customer.service.ts:getCustomerAgingReport` |
| Full AR aging report (all customers) | `reports.controller.ts:arAgingAllHandler` |
| GL journal entries query | `src/modules/gl/` |
| AR subledger ↔ GL reconciliation | `reports.controller.ts:glReconciliationHandler` |
| Role enforcement (CONTROLLER, AR_CLERK, VIEWER) | `src/middleware/requireRole.ts` — role from JWT when Bearer token present; otherwise `X-User-Role` header (defaults to VIEWER) |
| Audit log (insert-only) | `src/middleware/audit.ts` + AuditLog table |
| Multi-entity hierarchy (parent/subsidiary) | `Entity` model, scoped to all records |
| Exchange rate table + invoice FX field | `ExchangeRate` model, `invoice.exchangeRate` |
| Docker Compose (auto-migrate + auto-seed) | `docker-compose.yml` + `Dockerfile` |
| CI pipeline (GitHub Actions) | `.github/workflows/ci.yml` — runs `npm test` on every push/PR to main |
| Unit + integration tests (63 cases) | `src/__tests__/invoice.test.ts`, `src/__tests__/api.test.ts` |
| Next.js dashboard (AR summary, aging, invoices, customers, credit memos) | `frontend/src/app/` |
| JWT login session (tenant + role from token) | `AuthProvider.tsx` + login page |

### Partially Implemented

| Feature | Where | Notes |
|---------|-------|-------|
| Accounting period close enforcement | `invoice.service.ts:validatePeriodOpen` | Enforcement is **fail-open**: posting is blocked only when an `AccountingPeriod` row exists and its `status` is `CLOSED` or `LOCKED`. If no row exists for the posting month, posting is allowed. Tenant A has 12 seeded periods (past months `CLOSED`, current/future `OPEN`). Tenant B has no periods by design (isolation demo tenant). A full implementation would auto-create OPEN periods on tenant setup or default-deny when no period row exists. |
| Audit log integrity | `middleware/audit.ts` | When the UI uses JWT, `userId` and `userName` are taken from the signed token. With `ALLOW_HEADER_AUTH=true`, curl clients can still supply `X-User-ID` / `X-User-Name` (unverified). The audit write also happens **after** the main transaction commits, so a crash between commit and audit leaves no record. Production fix: write the audit row **inside** the same database transaction as the business change. |
| Authentication | `middleware/auth.ts`, `modules/auth/` | Demo JWT via `POST /api/auth/demo-login` (3 seeded users, shared password). UI sends `Authorization: Bearer`. When `ALLOW_HEADER_AUTH=true` (default), curl examples with `X-User-Role` still work for reviewers. Production: password hashing, refresh tokens, session revocation, and `ALLOW_HEADER_AUTH=false`. |

### Designed, Not Fully Implemented in Prototype

| Feature | Where Documented | Notes |
|---------|-----------------|-------|
| Unapplied cash GL entry | `payment.service.ts:recordPayment` | When a payment has allocations, the GL entry is posted for the allocated amount (DR Cash / CR AR). When `unappliedAmount > 0`, the unallocated cash is tracked on `Payment.unappliedAmount` but is not posted to a GL Unapplied Cash liability account. This would require a dedicated liability account per tenant which is not in the demo chart of accounts. The payment is visible on the Payment ledger and the `unappliedAmount` field is preserved for future allocation. |
| FX gain/loss journal entries | `docs/design.md §7` | `ExchangeRate` table and `exchangeRate` fields are in place; the GL posting of realized FX gain/loss on payment is described but the differential journal entry is not wired |
| Revenue recognition schedules | `docs/design.md §7` | Schema extension described; `RevenueSchedule` table and nightly recognition job not implemented |
| Bulk invoice import / batch endpoints | `docs/design.md §4.5` | Architecture described; `/invoices/batch` and `/payments/import` not implemented |
| Intercompany invoice handling | `docs/design.md §1.2` | Multi-entity model supports it; no dedicated intercompany elimination endpoint |
| SAP integration patterns | `docs/design.md` | Conceptual only |
| Period close API | `docs/design.md §5.3` | `AccountingPeriod` table exists; no `PATCH /accounting-periods/:id` endpoint |

---

## Required API Endpoints — Verified

| Endpoint | Status |
|----------|--------|
| `POST /api/invoices` | ✅ |
| `GET /api/invoices/:id` | ✅ |
| `POST /api/invoices/:id/approve` | ✅ |
| `POST /api/payments` | ✅ |
| `GET /api/customers/:id/aging` | ✅ |
| `GET /api/journal-entries?invoice=:id` | ✅ |

Additional endpoints: `POST /invoices/:id/void`, `POST /invoices/:id/send`, `POST /invoices/:id/write-off`, `POST /credit-memos`, `POST /credit-memos/:id/apply`, `GET /reports/ar-aging`, `GET /reports/gl-reconciliation`, `GET /reports/ar-summary`, `POST /gl-accounts` (CONTROLLER), `GET /gl-accounts`, `POST /tenants` (**requires `X-Admin-Key`**), `GET /tenants`, `GET /customers`, `POST /customers` (AR_CLERK).

### Prototype scope notes (intentional gaps)

| Area | Status |
|------|--------|
| Payment recording | Invoice detail page — **Record Payment** form (AR_CLERK+) |
| Credit memos | `/credit-memos` — list, create, and apply (CONTROLLER) |
| `scripts/verify.sh` | Smoke tests via `X-Tenant-ID` header auth; does not exercise JWT login |
| Postgres in Docker | Exposed on host port 5432 for local debugging (not production-hardened) |
| AR aging-all report | Uses `findMany` (fine at demo scale; AR summary uses SQL `aggregate`) |

---

## Running Tests

```bash
cd backend
npm ci
npm test
```

Expected: **63 tests pass, 0 failures.**

- `invoice.test.ts` — 33 pure unit tests (state machine, FIFO arithmetic, GL balance, aging buckets). No database required.
- `api.test.ts` — 30 integration tests against the full Express HTTP stack (tenant middleware, RBAC, demo JWT login, invoice CRUD, payments, aging, journal entries, accounting guards, concurrent-approve race guard, write-off missing-AR guard, health check DB ping, admin-key guard, role guards on customers/GL accounts). Prisma is mocked via `jest.mock`.

---

## Time Spent

| Section | Time |
|---------|------|
| Data model + architecture design | 60 min |
| Backend prototype (all modules) | 90 min |
| Financial controls + compliance doc | 40 min |
| Enterprise experience showcase | 25 min |
| Frontend dashboard | 30 min |
| Tests, migrations, Docker fixes | 45 min |
| JWT login, security guards, CI polish | 60 min |
| SUBMISSION.md + README | 25 min |
| **Total** | **~6.5 hours** |

---

## AI Tools Used

**Claude (Anthropic)** — primary development tool. I used Claude to build the implementation (backend modules, Prisma schema and migrations, frontend, Docker setup, tests, and documentation) and to apply project configuration. I directed the work and validated all financial and architectural decisions.

**Cursor** — used only for code review. I asked Cursor to review the submission and provide a review checklist; I then asked Claude to verify and address those items. After two review cycles, both tools confirmed the submission was complete.

I also have Codex available but did not use it here — Claude handled development and Cursor handled review.

**Where human domain expertise was essential (AI did not drive these decisions):**
- Double-entry accounting rules (which accounts debit/credit in which scenarios)
- SOX compliance requirements and segregation of duties design
- Period close workflow and prior-period correction procedures
- Idempotency semantics for financial operations
- The enterprise experience examples in the design document (real career experience)
- Choice of shared-schema vs. per-tenant-schema architecture and the operational reasoning behind it

---

## Design Document

Full design document (data model, GL integration, compliance analysis, architecture decisions) is in [`docs/design.md`](./docs/design.md).
