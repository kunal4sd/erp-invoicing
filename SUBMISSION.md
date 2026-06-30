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
git clone <repo-url>
cd erp-invoicing

# 2. Build and start everything — one command, no other steps needed
docker compose up --build

# Postgres starts → backend builds → migrations run → seed runs → API starts → frontend builds
# Look for: "✅ Seed complete!" in the output, then the server startup message

# 3. Open the app
#    Frontend:  http://localhost:3000
#    API health: http://localhost:3001/health
```

> If you prefer to run in the background: `docker compose up --build -d` then `docker compose logs -f backend` to watch progress.

The seed runs automatically on first startup — the frontend auto-detects the first tenant and is immediately usable with demo data.

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

> **Multi-tenant demo:** The sidebar shows a tenant switcher when more than one tenant exists. Tenant B (Globex Inc.) is intentionally empty — switching to it demonstrates row-level isolation (no data leaks from Tenant A). All demo invoices and customers belong to Tenant A (Acme Corporation).

> **Role switcher:** The sidebar includes a role dropdown (CONTROLLER / AR_CLERK / VIEWER). CONTROLLER is required to Approve, Void, or Write-Off invoices. AR_CLERK can create invoices and record payments. VIEWER is read-only.

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
| Role enforcement (CONTROLLER, AR_CLERK) | `src/middleware/requireRole.ts` |
| Accounting period close enforcement | `invoice.service.ts:validatePeriodOpen` + `payment.service.ts` |
| Audit log (insert-only) | `src/middleware/audit.ts` + AuditLog table |
| Multi-entity hierarchy (parent/subsidiary) | `Entity` model, scoped to all records |
| Exchange rate table + invoice FX field | `ExchangeRate` model, `invoice.exchangeRate` |
| Docker Compose (auto-migrate + auto-seed) | `docker-compose.yml` + `Dockerfile` |
| Unit + integration tests (52 cases) | `src/__tests__/invoice.test.ts`, `src/__tests__/api.test.ts` |
| Next.js dashboard (AR summary, aging, invoices, customers) | `frontend/src/app/` |
| Auto-tenant detection in frontend | `TenantProvider.tsx` |

### Designed, Not Fully Implemented in Prototype

| Feature | Where Documented | Notes |
|---------|-----------------|-------|
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

Additional endpoints: `POST /invoices/:id/void`, `POST /invoices/:id/send`, `POST /invoices/:id/write-off`, `POST /credit-memos`, `POST /credit-memos/:id/apply`, `GET /reports/ar-aging`, `GET /reports/gl-reconciliation`, `GET /reports/ar-summary`, `POST /gl-accounts`, `GET /gl-accounts`, `POST /tenants`, `GET /customers`, `POST /customers`.

---

## Running Tests

```bash
cd backend
npm ci
npm test
```

Expected: **52 tests pass, 0 failures.**

- `invoice.test.ts` — 33 pure unit tests (state machine, FIFO arithmetic, GL balance, aging buckets). No database required.
- `api.test.ts` — 19 integration tests against the full Express HTTP stack (tenant middleware, RBAC, invoice CRUD, payments, aging, journal entries). Prisma is mocked via `jest.mock`.

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
| SUBMISSION.md + README | 15 min |
| **Total** | **~5.5 hours** |

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
