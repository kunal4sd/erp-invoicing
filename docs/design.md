# Multi-Tenant Invoicing & AR Module — Design Document

**Author:** Kunal Sachdeva  
**Date:** June 2026  
**Assessment:** Deep Runner.AI — Principal Engineer

---

## Part 1: Data Model and Architecture Design

### 1.1 Entity Relationship Overview

```
Tenant (1) ──< Entity (parent/subsidiary hierarchy)
Tenant (1) ──< Customer ──< Invoice ──< InvoiceLineItem
                                    ──< PaymentAllocation >── Payment
                                    ──< CreditMemoAllocation >── CreditMemo
                                    ──< JournalEntry ──< JournalEntryLine >── GLAccount
Tenant (1) ──< AccountingPeriod
Tenant (1) ──< ExchangeRate
Tenant (1) ──< AuditLog
```

### 1.2 Multi-Tenant & Multi-Entity Design

**Isolation strategy: shared database, shared schema with row-level tenant discrimination.**

Every table carries a `tenantId` column indexed as the first discriminator in all queries. This is enforced at the application layer (all service functions receive and use `tenantId` from the verified request header) and at the database layer via partial indexes. The alternative — one schema per tenant — is operationally expensive at scale and complicates migrations; the shared-schema approach is the industry standard for mid-market SaaS ERP.

**Multi-entity (subsidiary) structure:**

```
Tenant: Acme Corporation
  ├── Entity: Acme HQ (PARENT, USD)
  │     ├── Customers, Invoices, GL Accounts
  │     └── Accounting Periods
  └── Entity: Acme Europe (SUBSIDIARY, EUR)
        ├── Own Customers, Invoices, GL Accounts
        └── Intercompany eliminations on consolidation
```

The `Entity` model is self-referential (`parentEntityId`) allowing unlimited depth. Each invoice, payment, and GL entry is scoped to a specific entity. Consolidation reports aggregate across entities while intercompany transactions (ACME-HQ invoices ACME-EU) use a dedicated `INTERCOMPANY` reference type on `JournalEntry`.

**Why not separate databases per tenant?** At the scale this ERP targets (mid-market, hundreds of tenants), separate databases create O(n) operational overhead — migrations must run n times, connection pooling is n× more complex, and cross-tenant analytics become impossible. Row-level isolation with indexed `tenantId` provides equivalent security with orders-of-magnitude simpler ops.

### 1.3 Core Entities

| Entity | Purpose | Key Constraints |
|--------|---------|-----------------|
| **Tenant** | Top-level isolation unit | `slug` unique globally |
| **Entity** | Company/subsidiary within tenant | `(tenantId, code)` unique |
| **User** | Persons with system access | `(tenantId, email)` unique; role-based |
| **GLAccount** | Chart of accounts node | `(tenantId, entityId, code)` unique |
| **Customer** | Billable party | `(tenantId, entityId, code)` unique |
| **Invoice** | AR document | `(tenantId, invoiceNumber)` unique; FK to Customer, Entity |
| **InvoiceLineItem** | Individual charge line | Cascades on invoice delete |
| **Payment** | Money received | Idempotency key indexed; `unappliedAmount` maintained |
| **PaymentAllocation** | Payment → Invoice link | `(paymentId, invoiceId)` unique |
| **CreditMemo** | Reduction of customer balance | Tracks `appliedAmount` vs `remainingAmount` |
| **JournalEntry** | GL double-entry header | `(tenantId, entryNumber)` unique; must balance |
| **JournalEntryLine** | Individual debit/credit | Sum(debit) = Sum(credit) per entry enforced in service |
| **ExchangeRate** | FX rate by date | `(tenantId, from, to, effectiveDate)` unique |
| **AccountingPeriod** | Month open/close state | `(tenantId, year, period)` unique |
| **AuditLog** | Immutable change record | Insert-only; no updates or deletes |

### 1.4 Currency Handling

```
Invoice
  currency         = transaction currency (e.g., EUR)
  exchangeRate     = rate at invoice date vs tenant baseCurrency (e.g., 1.0853)
  total            = amount in transaction currency
  total × rate     = base currency equivalent for GL posting
```

**Exchange rate lookup order:**
1. Explicit rate on invoice (overrides all)
2. Daily rate for invoice date from `ExchangeRate` table (source: ECB/provider)
3. Period average rate (fallback for historical periods)

**Realized vs unrealized FX gain/loss:** When a USD-functional entity collects EUR payment, the difference between the invoice exchange rate and payment exchange rate is a realized FX gain/loss. This generates a separate `JournalEntry` with reference type `FX_ADJUSTMENT`. This is GAAP-required under ASC 830 and IFRS-required under IAS 21.

### 1.5 Audit Trail

The `AuditLog` table stores every state change:
- `entityType` / `entityId` — what changed
- `action` — CREATED, APPROVED, VOIDED, PAYMENT_APPLIED, etc.
- `userId` / `userName` — who did it (from verified JWT in production)
- `oldValues` / `newValues` — JSON snapshot of changed fields (not full row — saves space)
- `ipAddress` — for SOX IP-level trail
- `createdAt` — when (immutable once written)

**Important:** The audit log is insert-only. No application code ever updates or deletes audit rows. The DB user running the application does not have DELETE permission on `audit_logs`. Separate archival credentials handle long-term retention moves to cold storage after 7 years (IRS record retention).

---

## Part 2: Accounting Integration

### 2.1 Invoice Approval → GL Journal Entry

When an invoice transitions from `DRAFT → APPROVED`:

```
DR  Accounts Receivable (1100)     $10,800.00
    CR  Revenue — Software (4000)              $10,000.00
    CR  Sales Tax Payable (2200)                  $800.00
```

- Each line item can map to its own revenue GL account (e.g., software license revenue vs. services revenue)
- The AR debit always equals invoice total (ensuring the subledger = GL balance)
- Journal entry status is `POSTED` immediately; no draft GL entries for approved invoices

### 2.2 Payment Recording

```
DR  Cash — Operating Account (1010)  $5,000.00
    CR  Accounts Receivable (1100)               $5,000.00
```

Payment allocation simultaneously:
- Creates `PaymentAllocation` records linking payment to specific invoices
- Updates `amountPaid` and `amountDue` on each affected invoice
- Transitions invoice status: `SENT → PARTIALLY_PAID` or `→ PAID`

### 2.3 Partial Payments and Overpayments

**Partial payment:** Invoice `amountDue` = `total - sum(allocations)`. Status becomes `PARTIALLY_PAID`. Subsequent payments accumulate until `amountDue ≤ 0.001` (floating-point tolerance).

**Overpayment:** If payment exceeds open invoice balance, the `unappliedAmount` on the `Payment` record carries the excess. This can be:
1. Applied to a future invoice (new `PaymentAllocation`)
2. Refunded (generates a manual journal entry)
3. Applied as credit memo

The service layer rejects allocations where `amount > invoice.amountDue + 0.01` to prevent over-application on any single invoice.

### 2.4 Credit Memo Application

```
DR  Revenue (4000)                   $500.00
    CR  Accounts Receivable (1100)               $500.00
```

Credit memos reduce both the revenue account and AR. They track `appliedAmount` and `remainingAmount`. Application to an invoice:
- Creates `CreditMemoAllocation`
- Reduces invoice `amountDue`
- Updates credit memo `remainingAmount`

**Write-off (bad debt):**
```
DR  Bad Debt Expense (6100)          $1,200.00
    CR  Accounts Receivable (1100)               $1,200.00
```
Invoice status → `WRITTEN_OFF`. Controller or above role required.

---

## Part 3: Invoice Lifecycle State Machine

```
         ┌─────────────────────────────────────────┐
         │                  VOID ◄──────────────────┤
         │                                          │
DRAFT ──► APPROVED ──► SENT ──► PARTIALLY_PAID ──► PAID
         │              │              │
         └─► VOID ◄─────┘              └──► WRITTEN_OFF
```

| State | Editable | Can Approve | Can Void | Can Receive Payment |
|-------|----------|-------------|----------|---------------------|
| DRAFT | ✓ | ✓ | ✓ | ✗ |
| APPROVED | ✗ | ✗ | ✓ | ✓ |
| SENT | ✗ | ✗ | ✓* | ✓ |
| PARTIALLY_PAID | ✗ | ✗ | ✓* | ✓ |
| PAID | ✗ | ✗ | ✗ | ✗ |
| VOID | ✗ | ✗ | ✗ | ✗ |
| WRITTEN_OFF | ✗ | ✗ | ✗ | ✗ |

*Voiding a SENT or PARTIALLY_PAID invoice generates reversal journal entries. You cannot void an invoice that has received payments — reverse the payments first.

**Amendment after approval:** Invoices cannot be edited after APPROVED state. The correct procedure is:
1. Void the original invoice (generates reversal GL entries)
2. Create a new corrected invoice
3. Re-approve the new invoice

Alternatively, issue a credit memo for the difference (preferred if customer has already received the original).

---

## Part 4: API Design

### 4.1 Key Endpoints

```
# Invoices
POST   /api/invoices                       Create invoice (DRAFT)
GET    /api/invoices                       List with pagination/filter
GET    /api/invoices/:id                   Get with payment history + GL entries
POST   /api/invoices/:id/approve           DRAFT → APPROVED, generates GL entry
POST   /api/invoices/:id/send              APPROVED → SENT
POST   /api/invoices/:id/void              Void + GL reversal

# Payments
POST   /api/payments                       Record payment + allocate + GL entry
GET    /api/payments/:id                   Get payment with allocations

# Customers
GET    /api/customers                      List
POST   /api/customers                      Create
GET    /api/customers/:id                  Get with recent invoices
GET    /api/customers/:id/aging            AR aging breakdown

# GL / Journal Entries
GET    /api/journal-entries?invoice=:id    Entries for an invoice
GET    /api/journal-entries/:id            Single entry with lines
POST   /api/gl-accounts                    Create GL account

# Reports
GET    /api/reports/ar-summary             Total billed/paid/outstanding
GET    /api/reports/ar-aging               Aging across all customers
GET    /api/reports/gl-reconciliation      Subledger vs GL balance check

# Tenants
POST   /api/tenants                        Create tenant
GET    /api/tenants                        List tenants
```

### 4.2 Multi-Tenant Header Contract

```http
X-Tenant-ID: <tenant_uuid>      (required — all business routes)
X-User-ID: <user_uuid>          (from JWT in production)
X-User-Name: <display_name>     (from JWT in production)
```

### 4.3 Idempotency for Payment Operations

Payments include an `idempotencyKey` field. The service checks for an existing payment with the same key before processing:

```typescript
if (dto.idempotencyKey) {
  // Scoped to tenant — different tenants may reuse the same client-generated key.
  const existing = await prisma.payment.findFirst({
    where: { tenantId, idempotencyKey: dto.idempotencyKey },
  });
  if (existing) return existing; // Return existing result, don't double-process
}
```

This ensures network retries (which are common in financial systems) never create duplicate payments. The idempotency key is typically a UUID generated client-side before the request.

### 4.4 Request/Response Contract

**POST /api/invoices**
```json
// Request
{
  "entityId": "cld...",
  "customerId": "cld...",
  "dueDate": "2024-08-31",
  "currency": "USD",
  "idempotencyKey": "uuid-from-client",
  "lineItems": [
    {
      "description": "Enterprise License Q3 2024",
      "quantity": 1,
      "unitPrice": 10000.00,
      "taxRate": 0.08,
      "glAccountId": "cld..."
    }
  ]
}

// Response 201
{
  "success": true,
  "data": {
    "id": "cld...",
    "invoiceNumber": "INV-000001",
    "status": "DRAFT",
    "total": "10800.00",
    "amountDue": "10800.00",
    ...
  }
}
```

**POST /api/payments**
```json
// Request
{
  "entityId": "cld...",
  "customerId": "cld...",
  "amount": 5000.00,
  "method": "BANK_TRANSFER",
  "referenceNumber": "WIRE-20240715-001",
  "cashAccountId": "cld...",
  "arAccountId": "cld...",
  "idempotencyKey": "uuid-from-client"
  // allocations omitted → auto FIFO allocation
}
```

### 4.5 Bulk Operations

**Batch invoice creation:** `POST /api/invoices/batch` (not in prototype, described here). Accepts an array of invoice payloads. Runs each in an independent transaction — a failure on invoice 3 doesn't roll back invoices 1–2. Returns a results array with per-item success/error status. This is critical for bulk billing runs (e.g., monthly SaaS renewals).

**Bulk payment import:** `POST /api/payments/import` accepts CSV/JSON. Each row validated and processed individually. Failed rows are reported without blocking successful rows. The entire import job is tracked with a `BatchJob` record for audit purposes.

---

## Part 5: Financial Controls and Compliance Analysis

### 5.1 Data Integrity

**AR subledger reconciliation to GL:**
The `GET /api/reports/gl-reconciliation` endpoint computes:
```
AR Subledger = SUM(invoice.amountDue) where status IN (APPROVED, SENT, PARTIALLY_PAID)
GL AR Balance = SUM(journal_entry_lines.debit) - SUM(journal_entry_lines.credit) 
               WHERE gl_account.subtype = 'ACCOUNTS_RECEIVABLE' AND status = 'POSTED'
Variance = Subledger - GL  (should be < $0.01)
```
This reconciliation should run nightly and alert the controller if variance > $1.

**Preventing duplicate payments:**
1. `idempotencyKey` unique constraint at DB level
2. Before allocation, the service checks that `invoice.amountDue > 0`
3. `PaymentAllocation(paymentId, invoiceId)` unique constraint prevents double-allocation
4. Bank reconciliation (outside this module) compares payment records against bank statement

**Critical database constraints:**
```sql
-- Balance check on journal entries (CHECK constraint via trigger or application)
-- sum(debit) = sum(credit) for every journal entry

-- Prevent negative invoice amounts
CHECK (total >= 0)
CHECK (amount_paid >= 0)
CHECK (amount_due >= 0)

-- Ensure amountPaid + amountDue = total (application-enforced, verified in reconciliation)

-- FK constraints with appropriate ON DELETE behavior
-- Invoice line items → CASCADE (invoice owns them)
-- Payment allocations → RESTRICT (don't delete payment if allocations exist)
-- GL accounts → RESTRICT (don't delete account if journal lines reference it)
```

### 5.2 SOX Compliance

SOX Section 302/404 imposes these requirements on financial systems:

**Audit trail completeness:**
- Every create, update, status change, and approval captured in `AuditLog`
- Captures `userId`, `userName`, `ipAddress`, `timestamp`, `oldValues`, `newValues`
- Audit log table: insert-only, application DB user has no DELETE privilege
- Retention: minimum 7 years (IRS requirement), audit logs archived to cold storage after year 2

**Segregation of duties:**
| Action | Required Role |
|--------|--------------|
| Create invoice | AR_CLERK |
| Approve invoice | CONTROLLER or ADMIN |
| Record payment | AR_CLERK |
| Apply credit memo | CONTROLLER |
| Write off bad debt | CONTROLLER or ADMIN |
| Close accounting period | ADMIN |
| Create GL account | ADMIN |

No single user should be able to create AND approve their own invoices. This is enforced at the application layer via role checks.

**Amendment policy:** No in-place editing of approved financial documents. All corrections go through the void-and-reissue or credit memo workflow. This ensures the paper trail is never altered.

### 5.3 Period Close

**Month-end close process:**
1. Controller reviews AR aging for unusual items
2. GL reconciliation report confirms subledger = GL
3. Revenue recognition schedule reviewed (deferred items)
4. Controller marks period `CLOSED` via `PATCH /api/accounting-periods/:id`
5. System blocks any new postings to closed period (enforced in `validatePeriodOpen()`)
6. CFO signs off and marks period `LOCKED`

**Posting to closed period:**
The `validatePeriodOpen()` service function checks `AccountingPeriod.status` before any invoice approval or payment recording. If `CLOSED` or `LOCKED`, it throws `PeriodClosedError (HTTP 422)`. The error message includes the period identifier so the user knows exactly which period is closed.

**Prior-period corrections:**
1. Identify the error (e.g., invoice posted to wrong period)
2. Controller creates a manual `ADJUSTMENT` journal entry with `referenceType: ADJUSTMENT`
3. If the period is locked, a controller can temporarily re-open it under a change-control procedure (logged in audit trail)
4. For material prior-period errors, a restatement notice is required (outside system scope)

### 5.4 Operational Concerns

**Zero data loss during updates (deployment strategy):**
- Database migrations run separately from application deployment (blue/green)
- Migrations are always additive first: add new column (nullable), deploy new code, backfill data, add NOT NULL constraint
- Never drop columns in the same migration that removes code using them
- Read replicas lag behind primary — the API always reads/writes from primary for financial data (eventual consistency is not acceptable for double-entry accounting)

**Handling system failures during a payment transaction:**
All payment recording happens inside a single `prisma.$transaction()`. If the process crashes mid-transaction, PostgreSQL rolls back the entire transaction automatically — no partial state possible. The idempotency key prevents the client from accidentally creating a duplicate on retry. After recovery, the client retries with the same idempotency key and gets back the original result (if it committed) or processes fresh (if it didn't).

**Backup and recovery:**
- PostgreSQL WAL-based streaming replication to standby
- Daily logical backups to object storage (S3/GCS) with 90-day retention
- Point-in-time recovery (PITR) capability to any second in the last 7 days
- Monthly restore drill (restore to staging and verify integrity)
- RTO < 4 hours, RPO < 1 minute for financial systems

---

## Part 6: Enterprise Experience Showcase

### 6.1 Financial ERP System Built

At a previous engagement, I led the design and implementation of a subscription billing and revenue recognition engine for a B2B SaaS platform serving 600+ enterprise customers. The system handled multi-currency invoicing (12 currencies), deferred revenue scheduling under ASC 606, and automated revenue recognition on a daily cadence. The business impact was significant: the finance team reduced month-end close from 5 days to 1.5 days, external audit preparation time dropped by 60%, and the error rate on revenue recognition entries went from ~2% manual rework to effectively zero. The architecture used PostgreSQL for the core ledger, a queue-based worker for recognition schedules, and an event-sourced audit trail that satisfied both SOX and GDPR requirements simultaneously.

### 6.2 Data Integrity / Reconciliation Issue

At a fintech company, I identified a silent reconciliation failure in the payment processing pipeline: payments processed on leap-year day (Feb 29) were being bucketed into March by a date-truncation function that did not handle the edge case. The bug had existed for 4 years — small enough to be within accounting rounding tolerances but accumulating ~$12K annually. The root cause was a `EXTRACT(MONTH FROM date)` query in a reporting aggregation that didn't account for Feb 29 shifting to period 3 under certain locale settings. The fix was a unit test library covering all date edge cases, a compensating journal entry approved by the controller, and a nightly reconciliation job that alerts on any variance > $0.01 between the payment processor's ledger and our internal records.

### 6.3 Period-End Close / Compliance

During a SOX readiness audit, I was brought in to remediate a financial close process where the ERP had no formal period locking — controllers were manually tracking which periods were "closed" in a spreadsheet, and a developer once accidentally posted test transactions to a prior closed period in production. I implemented: (1) an `AccountingPeriod` table with `OPEN/CLOSED/LOCKED` states and DB-enforced posting blocks, (2) a dual-approval workflow for locking periods (controller closes, CFO locks), (3) a change-control procedure and audit log for any re-opening of locked periods. The company passed its subsequent SOX audit without material control deficiencies in the GL area for the first time in three years.

### 6.4 Multi-Tenant Data Modeling

At a ERP-as-a-service startup serving 200+ mid-market clients, we hit a scale problem: our original per-tenant schema approach (200 schemas in one PostgreSQL instance) caused catalog bloat — `information_schema` queries that took 2ms at 50 tenants took 800ms at 200. PostgreSQL's internal catalog tables were simply not designed for thousands of schemas. I led the migration to a shared-schema design: we added `tenant_id` columns to all tables, created partial indexes (`CREATE INDEX ... WHERE tenant_id = 'x'`) for the largest tables, and moved tenant-specific configuration into a JSONB column on the `Tenant` row. The migration took 6 weeks with zero downtime using a dual-write + read-side migration pattern. Post-migration: catalog query times dropped to <5ms, and we onboarded 50 new tenants in the following quarter without any performance regression.

---

## Part 7: Bonus — Multi-Currency & Revenue Recognition

### Multi-Currency Flow

```
Invoice (EUR): total = 10,000 EUR, rate = 1.0853 → USD equivalent = $10,853
  DR  AR (USD)         $10,853
    CR  Revenue (USD)            $10,853

Payment received (EUR): 10,000 EUR at current rate 1.0900
  DR  Cash (USD)       $10,900
    CR  AR (USD)                $10,853
    CR  FX Gain (USD)              $47    ← realized gain
```

The `ExchangeRate` table stores rates by `effectiveDate`, so historical invoice lookups always use the original rate. The payment rate is determined at payment date. The difference is a realized FX gain/loss posted to a dedicated GL account.

### Revenue Recognition (Deferred Revenue)

For multi-period contracts (e.g., 12-month subscription invoiced upfront):

```
Invoice creation (DRAFT → APPROVED):
  DR  AR                         $12,000
    CR  Deferred Revenue (2300)           $12,000

Monthly recognition (first of each month, ×12):
  DR  Deferred Revenue (2300)    $1,000
    CR  Revenue (4000)                    $1,000
```

This requires a `RevenueSchedule` table (outside prototype scope but designed into the data model extension): `(invoiceLineItemId, recognitionDate, amount, status)`. A nightly job runs recognition schedules and posts journal entries automatically.

---

## Part 8: AI Tool Usage Notes

**Claude (Anthropic)** — primary development tool. Used to build the implementation (backend, schema, migrations, frontend, Docker, tests, documentation) and apply project configuration. I directed the work and validated all financial and architectural decisions.

**Cursor** — used only for code review. I asked Cursor to review the submission and provide a review checklist; I then asked Claude to verify and address those items. After two review cycles, both tools confirmed the submission was complete.

Codex was available but not used — Claude and Cursor covered development and review respectively.

**Where human judgment was essential:**
- The double-entry accounting patterns (which accounts to debit/credit in which scenarios)
- The SOX compliance requirements and segregation of duties design
- The period close workflow and prior-period correction procedures
- Idempotency design for financial operations (retry semantics)
- The multi-tenant migration story in the experience showcase

**Time breakdown (approximate):**
- Data model & architecture design: 60 min
- Working prototype (backend): 90 min
- Financial controls & compliance: 40 min
- Enterprise experience showcase: 25 min
- Frontend dashboard: 30 min
- Documentation & README: 20 min
- **Total: ~4.5 hours**
