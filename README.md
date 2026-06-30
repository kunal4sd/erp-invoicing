# ERP Invoicing & Accounts Receivable Module

> Principal Engineer Technical Assessment — Deep Runner.AI  
> Multi-tenant invoicing and AR module with GL integration, audit trails, and aging reports.

See [SUBMISSION.md](./SUBMISSION.md) for the reviewer quick-start guide, implemented-vs-designed feature table, and test instructions.

---

## Prerequisites

The only thing you need installed on your machine to run this project is **Docker Desktop**. Everything else (Node.js, PostgreSQL, npm packages) runs inside containers.

| Requirement | Version | Notes |
|-------------|---------|-------|
| **Docker Desktop** | 4.x or later | Includes Docker Engine + Docker Compose v2 |
| **Git** | Any recent version | To clone the repository |

> **Windows users:** Docker Desktop requires WSL 2 (Windows Subsystem for Linux). Docker Desktop installs this automatically during setup. Make sure Docker Desktop is running (whale icon in system tray) before running any `docker` commands.

> **No need to install:** Node.js, npm, PostgreSQL, or any other runtime. Docker handles everything.

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Backend API | Node.js + TypeScript + Express | Node 20 LTS |
| ORM | Prisma | 5.22 |
| Database | PostgreSQL | 16 |
| Frontend | Next.js (App Router) + Tailwind CSS | Next.js 14 |
| Container runtime | Docker Compose | v2 (included in Docker Desktop) |
| Base image (backend) | Debian Bookworm Slim | `node:20-bookworm-slim` |
| Base image (frontend) | Alpine | `node:20-alpine` |

> **Why Debian for the backend?** Prisma 5's query engine is compiled against glibc + OpenSSL. Alpine Linux uses musl libc and cannot load Prisma's native binary without additional packages. The Debian slim image resolves this reliably without requiring Alpine hacks.

---

## Quick Start (Docker — one command)

```bash
git clone https://github.com/kunal4sd/erp-invoicing.git
cd erp-invoicing

docker compose up --build
```

That's it. Docker will:
1. Pull `postgres:16-alpine` and start the database
2. Build the backend image (Debian slim + Node 20 + TypeScript compile)
3. Run `prisma migrate deploy` (creates all tables)
4. Run the seed script (creates 8 demo invoices across all lifecycle states — PAID, PARTIALLY_PAID, SENT overdue, SENT current, APPROVED, DRAFT, VOID, WRITTEN_OFF — with real GL journal entries and payments)
5. Start the Express API on port 3001
6. Build the frontend image and start Next.js on port 3000

Watch for `✅ Seed complete!` in the logs, then open the app.

**To run in detached mode (background):**
```bash
docker compose up --build -d
docker compose logs -f backend   # watch seed output
```

Services:
- **Frontend:** http://localhost:3000
- **Backend API:** http://localhost:3001
- **Health check:** http://localhost:3001/health

> **No manual steps needed.** Migrations and seed data run automatically on first start. Open http://localhost:3000 and sign in with a demo user (see [Login](#login) below).

---

## Login

After `docker compose up`, open http://localhost:3000. You will be redirected to the login page.

**Password for all demo users:** `demo`

| Email | Role | Capabilities |
|-------|------|--------------|
| `controller@demo.local` | CONTROLLER | Approve/void/write-off invoices, credit memos, full access |
| `clerk@demo.local` | AR_CLERK | Create invoices, send, record payments (all in UI) |
| `viewer@demo.local` | VIEWER | Read-only |

The UI issues a JWT on login and sends `Authorization: Bearer <token>` on API calls. For curl/API testing without logging in, set `ALLOW_HEADER_AUTH=true` (default) and use `X-Tenant-ID` + `X-User-Role` headers as shown in the API examples below.

### How to test with different users (UI walkthrough)

Use this checklist to verify RBAC before submitting. **Password for every account: `demo`**

**Start the stack** (if not already running):
```bash
docker compose up --build
# wait for "✅ Seed complete!" in logs, then open http://localhost:3000
```

**Switch users anytime:** click **Sign out** in the sidebar (bottom-left) → you return to `/login`.

---

#### 1. VIEWER — read-only (`viewer@demo.local`)

On the login page, click the **Viewer** quick-login card (or enter email + password manually).

| Action | Expected result |
|--------|-----------------|
| Dashboard, Invoices, Customers, AR Aging | ✅ Loads seeded data |
| Invoices → **+ New Invoice** button | ❌ Hidden — shows "Read-only (VIEWER)" |
| Open **INV-000006** (DRAFT) → **Approve** button | ❌ Disabled — "CONTROLLER only" |
| Sidebar | Shows email, role badge `VIEWER` |

---

#### 2. AR_CLERK — create invoices (`clerk@demo.local`)

Sign out, then click the **AR Clerk** quick-login card.

| Action | Expected result |
|--------|-----------------|
| Invoices → **+ New Invoice** | ✅ Opens create form |
| Fill customer, line items → **Create Invoice** | ✅ New DRAFT invoice appears in list |
| Open the new DRAFT → **Approve** | ❌ Disabled (CONTROLLER only) |
| Open **INV-000005** (APPROVED) → **Mark as Sent** | ✅ Status → SENT |
| Open **INV-000003** (SENT) → **Record Payment** | ✅ Payment form at bottom; balance decreases |

---

#### 3. CONTROLLER — approve / void (`controller@demo.local`)

Sign out, then click the **Controller** quick-login card.

| Action | Expected result |
|--------|-----------------|
| Open **INV-000006** (DRAFT, $2,500) | ✅ Detail page loads |
| Select AR account → **Approve & Post to GL** | ✅ Status → APPROVED; GL journal entries appear |
| **Mark as Sent** on an APPROVED invoice | ✅ Status → SENT |
| **Write Off** on a SENT invoice with balance | ✅ Status → WRITTEN_OFF |
| **Void** on DRAFT/APPROVED/SENT | ✅ Status → VOID |
| **Credit Memos** → create memo → **Apply** to open invoice | ✅ Memo applied; invoice balance decreases |
| Sidebar | Role badge `CONTROLLER`; theme toggle (sun/moon) bottom-right |

> **Tip:** Pre-seeded invoices cover all lifecycle states — see [SUBMISSION.md](./SUBMISSION.md) for the full table (PAID, PARTIALLY_PAID, SENT, DRAFT, VOID, WRITTEN_OFF).

---

#### 4. Automated checks (optional)

**Unit/integration tests** (no Docker needed):
```bash
cd backend && npm ci && npm test
# Expected: 63 tests pass
```

**Smoke tests** (stack must be running):
```bash
bash scripts/verify.sh
# Expected: 6 passed, 0 failed
```

**API health:**
```bash
curl http://localhost:3001/health
# Expected: {"status":"ok","database":"connected",...}
```

---

## Running Tests (no Docker required)

Tests run entirely against mocked Prisma — no database needed.

```bash
cd backend
npm ci          # install dependencies
npm test        # run 63 tests
```

Expected output: **63 tests pass, 0 failures** in ~10 seconds.

Requires Node.js 20+ installed locally (only needed if you want to run tests without Docker).

---

## Local Development (without Docker)

### Prerequisites for local dev
- Node.js 20+ — https://nodejs.org
- PostgreSQL 16 running locally (or point `DATABASE_URL` at any PostgreSQL 16 instance)

### Backend

```bash
cd backend

# Install dependencies
npm ci

# Copy and configure env
cp .env.example .env
# Edit DATABASE_URL if needed

# Generate Prisma client + run migrations
npm run db:generate
npm run db:migrate

# Seed demo data (prints tenant/entity/customer IDs)
npm run db:seed

# Start dev server
npm run dev
```

### Frontend

```bash
cd frontend
npm install

# API URL only — sign in at http://localhost:3000/login after starting the backend (JWT sets tenant + role)
echo "NEXT_PUBLIC_API_URL=http://localhost:3001" > .env.local

npm run dev
```

---

## API Reference & Sample Requests

> **Important:** Business routes require authentication. The UI uses JWT (`Authorization: Bearer`) after login. For curl, use `X-Tenant-ID` + `X-User-Role` when `ALLOW_HEADER_AUTH=true` (default).  
> Get your tenant ID from the seed script output or from the JWT payload after `POST /api/auth/demo-login`.

Set these variables before running the examples:

```bash
TENANT_ID="<from seed output>"
ENTITY_ID="<from seed output>"
CUSTOMER_ID="<from seed output>"
AR_ACCOUNT_ID="<from seed output>"
CASH_ACCOUNT_ID="<from seed output>"
BASE_URL="http://localhost:3001"
```

> **Role headers:** `POST` endpoints that change state enforce RBAC via `X-User-Role`.  
> AR_CLERK can create invoices and payments. CONTROLLER is required for approve, void, and write-off.  
> Omitting the header defaults to VIEWER (read-only).

### 1. Create an Invoice

```bash
curl -X POST "$BASE_URL/api/invoices" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: $TENANT_ID" \
  -H "X-User-Role: AR_CLERK" \
  -H "X-User-ID: user-001" \
  -H "X-User-Name: Jane Accountant" \
  -d '{
    "entityId": "'$ENTITY_ID'",
    "customerId": "'$CUSTOMER_ID'",
    "dueDate": "2024-08-31",
    "currency": "USD",
    "idempotencyKey": "inv-create-001",
    "lineItems": [
      {
        "description": "Enterprise License Q3 2024",
        "quantity": 1,
        "unitPrice": 10000.00,
        "taxRate": 0.08,
        "glAccountId": "<revenue-account-id>"
      },
      {
        "description": "Implementation Services",
        "quantity": 5,
        "unitPrice": 250.00,
        "taxRate": 0,
        "glAccountId": "<services-account-id>"
      }
    ]
  }'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "cld...",
    "invoiceNumber": "INV-000001",
    "status": "DRAFT",
    "subtotal": "11250.00",
    "taxAmount": "800.00",
    "total": "12050.00",
    "amountDue": "12050.00"
  }
}
```
> Note: subtotal = $10,000 + $1,250 (5×$250) = $11,250; tax = $10,000 × 8% = $800; total = $12,050

### 2. Approve Invoice (generates GL journal entry)

Requires `X-User-Role: CONTROLLER` — returns 403 for AR_CLERK or VIEWER.

```bash
INVOICE_ID="<from step 1>"

curl -X POST "$BASE_URL/api/invoices/$INVOICE_ID/approve" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: $TENANT_ID" \
  -H "X-User-Role: CONTROLLER" \
  -H "X-User-ID: controller-001" \
  -H "X-User-Name: Mike Controller" \
  -d '{"arAccountId": "'$AR_ACCOUNT_ID'"}'
```

### 3. Get Invoice with Payment History & GL Entries

```bash
curl "$BASE_URL/api/invoices/$INVOICE_ID" \
  -H "X-Tenant-ID: $TENANT_ID"
```

### 4. Record a Payment (auto FIFO allocation)

```bash
curl -X POST "$BASE_URL/api/payments" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: $TENANT_ID" \
  -H "X-User-Role: AR_CLERK" \
  -H "X-User-ID: user-001" \
  -H "X-User-Name: Jane Accountant" \
  -d '{
    "entityId": "'$ENTITY_ID'",
    "customerId": "'$CUSTOMER_ID'",
    "amount": 5000.00,
    "method": "BANK_TRANSFER",
    "referenceNumber": "WIRE-20240715-001",
    "cashAccountId": "'$CASH_ACCOUNT_ID'",
    "arAccountId": "'$AR_ACCOUNT_ID'",
    "idempotencyKey": "pay-001"
  }'
```

### 5. Record a Payment with Manual Allocation

```bash
curl -X POST "$BASE_URL/api/payments" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: $TENANT_ID" \
  -H "X-User-Role: AR_CLERK" \
  -H "X-User-ID: user-001" \
  -H "X-User-Name: Jane Accountant" \
  -d '{
    "entityId": "'$ENTITY_ID'",
    "customerId": "'$CUSTOMER_ID'",
    "amount": 11050.00,
    "method": "ACH",
    "referenceNumber": "ACH-20240716-042",
    "cashAccountId": "'$CASH_ACCOUNT_ID'",
    "arAccountId": "'$AR_ACCOUNT_ID'",
    "idempotencyKey": "pay-002",
    "allocations": [
      { "invoiceId": "'$INVOICE_ID'", "amount": 11050.00 }
    ]
  }'
```

### 6. AR Aging Report for a Customer

```bash
curl "$BASE_URL/api/customers/$CUSTOMER_ID/aging" \
  -H "X-Tenant-ID: $TENANT_ID"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "customerName": "Alpha Tech Solutions",
    "asOfDate": "2024-07-15",
    "summary": {
      "current": "11050.00",
      "days_1_30": "0.00",
      "days_31_60": "0.00",
      "days_61_90": "0.00",
      "days_over_90": "0.00",
      "total": "11050.00"
    },
    "detail": { ... }
  }
}
```

### 7. GL Journal Entries for an Invoice

```bash
curl "$BASE_URL/api/journal-entries?invoice=$INVOICE_ID" \
  -H "X-Tenant-ID: $TENANT_ID"
```

**Response shows the double-entry:**
```json
{
  "data": [{
    "entryNumber": "JE-000001",
    "description": "Invoice approved: INV-000001",
    "lines": [
      { "glAccount": { "code": "1100", "name": "Accounts Receivable" }, "debit": "11050.00", "credit": "0.00" },
      { "glAccount": { "code": "4000", "name": "Revenue - Software" }, "debit": "0.00", "credit": "10000.00" },
      { "glAccount": { "code": "4100", "name": "Revenue - Services" }, "debit": "0.00", "credit": "250.00" },
      { "glAccount": { "code": "2200", "name": "Sales Tax Payable" }, "debit": "0.00", "credit": "800.00" }
    ]
  }]
}
```

### 8. Full AR Aging Report (all customers)

```bash
curl "$BASE_URL/api/reports/ar-aging" \
  -H "X-Tenant-ID: $TENANT_ID"
```

### 9. GL Reconciliation Check

```bash
curl "$BASE_URL/api/reports/gl-reconciliation" \
  -H "X-Tenant-ID: $TENANT_ID"
```

### 10. Void an Invoice

Requires `X-User-Role: CONTROLLER`.

```bash
curl -X POST "$BASE_URL/api/invoices/$INVOICE_ID/void" \
  -H "X-Tenant-ID: $TENANT_ID" \
  -H "X-User-Role: CONTROLLER" \
  -H "X-User-ID: controller-001" \
  -H "X-User-Name: Mike Controller"
```

### 11. Write Off an Invoice as Bad Debt

Requires `X-User-Role: CONTROLLER`. Generates DR Bad Debt Expense / CR AR journal entry.

```bash
curl -X POST "$BASE_URL/api/invoices/$INVOICE_ID/write-off" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: $TENANT_ID" \
  -H "X-User-Role: CONTROLLER" \
  -H "X-User-ID: controller-001" \
  -H "X-User-Name: Mike Controller" \
  -d '{"badDebtAccountId": "<bad-debt-account-id-from-seed>"}'
```

---

## Architecture Decisions

### Why PostgreSQL over a document database?

Financial data is inherently relational. Invoices reference customers, line items reference GL accounts, payments link to invoices via allocation join tables. ACID transactions spanning multiple tables are non-negotiable for double-entry accounting. PostgreSQL's transaction isolation guarantees that a payment allocation either fully commits (invoice balance updated, payment status updated, GL entry created) or fully rolls back.

### Why Prisma over raw SQL?

Prisma provides compile-time type safety — if a field is renamed in the schema, every query that references it breaks at compile time, not at runtime in production. The migration system is deterministic and auditable. Raw SQL is fine for complex reporting queries; Prisma handles the entity CRUD with type safety.

### Why shared-schema multi-tenancy?

See [docs/design.md § 1.2] for the full analysis. Short version: per-tenant schemas don't scale past ~100 tenants in a single PostgreSQL instance due to catalog bloat. Row-level isolation with indexed `tenantId` is the production-proven pattern for SaaS ERP.

### Why not use a microservices architecture?

For a prototype and initial production deployment, a well-structured monolith with clear module boundaries is the right call. Microservices add operational complexity (service discovery, distributed tracing, distributed transactions) that is premature when the team is small and the domain model is still evolving. The current modular structure (`invoices/`, `payments/`, `customers/`, `gl/`, `reports/`) makes a future service extraction straightforward when the need genuinely arises.

---

## Project Structure

```
erp-invoicing/
├── backend/
│   ├── src/
│   │   ├── app.ts               # Express setup, middleware, routes
│   │   ├── server.ts            # HTTP server bootstrap
│   │   ├── config/
│   │   │   └── database.ts      # Prisma singleton
│   │   ├── middleware/
│   │   │   ├── tenant.ts        # X-Tenant-ID extraction & validation
│   │   │   ├── audit.ts         # Audit log writer
│   │   │   └── errorHandler.ts  # Global error handler
│   │   ├── modules/
│   │   │   ├── invoices/        # Invoice CRUD + state machine + GL entry generation
│   │   │   ├── payments/        # Payment recording + FIFO/manual allocation
│   │   │   ├── customers/       # Customer CRUD + aging report
│   │   │   ├── gl/              # Journal entry queries + GL account management
│   │   │   ├── reports/         # AR summary, aging, GL reconciliation
│   │   │   ├── auth/            # Demo JWT login (POST /api/auth/demo-login)
│   │   │   └── tenants/         # Tenant list (public GET); POST requires X-Admin-Key
│   │   └── shared/
│   │       ├── errors.ts        # Typed error classes
│   │       └── logger.ts        # Winston logger
│   ├── prisma/
│   │   ├── schema.prisma        # Full data model
│   │   └── seed.ts              # Demo data seeder
│   ├── Dockerfile
│   └── package.json
├── frontend/
│   ├── src/app/
│   │   ├── page.tsx             # Dashboard (AR summary + GL reconciliation)
│   │   ├── invoices/page.tsx    # Invoice list
│   │   ├── customers/page.tsx   # Customer list
│   │   └── reports/page.tsx     # AR aging report
│   └── src/lib/api.ts           # Typed API client
├── docs/
│   └── design.md                # Full design document + compliance analysis
├── docker-compose.yml
└── README.md
```

---

## Key Financial Concepts Demonstrated

- **Double-entry accounting:** Every invoice approval and payment creates balanced journal entries (sum of debits = sum of credits)
- **AR subledger reconciliation:** The GL reconciliation report verifies the AR account balance equals the sum of open invoice balances
- **Invoice lifecycle state machine:** 7 states with valid transition rules enforced at service layer
- **Idempotent payment recording:** Retry-safe via idempotency keys
- **Multi-tenant isolation:** Row-level tenant discrimination on every query
- **Multi-entity hierarchy:** Parent/subsidiary structures with entity-scoped GL accounts
- **Period close enforcement:** Prevents posting to closed accounting periods
- **Complete audit trail:** Every state change recorded with user, timestamp, and old/new values
- **FIFO payment allocation:** Auto-applies payments to oldest invoices first (standard AR practice)
- **AR aging buckets:** Current, 1-30, 31-60, 61-90, 90+ days overdue

---

## Assessment AI Tool Note

Built with **Claude** (development) and reviewed with **Cursor** (code review only). See `SUBMISSION.md` and `docs/design.md § Part 8` for full disclosure.
