-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: concurrency_fixes
--
-- 1. Add SequenceCounter table — atomic per-tenant sequence for INV/JE numbers.
--    Uses INSERT ... ON CONFLICT DO UPDATE (single atomic statement) so concurrent
--    transactions can never read the same counter value.
--
-- 2. Scope idempotency keys by tenant on Invoice and Payment.
--    Previously @unique was global — Tenant B sending key "abc" would get Tenant A's
--    record returned (cross-tenant data leak). Now uniqueness is (tenantId, key).
-- ─────────────────────────────────────────────────────────────────────────────

-- CreateTable: SequenceCounter
CREATE TABLE "SequenceCounter" (
    "tenantId"    TEXT    NOT NULL,
    "counterName" TEXT    NOT NULL,
    "lastValue"   INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "SequenceCounter_pkey" PRIMARY KEY ("tenantId", "counterName")
);

ALTER TABLE "SequenceCounter"
    ADD CONSTRAINT "SequenceCounter_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill counters from existing data so numbering continues from current max.
INSERT INTO "SequenceCounter" ("tenantId", "counterName", "lastValue")
SELECT
    "tenantId",
    'INV',
    COALESCE(MAX(CAST(SPLIT_PART("invoiceNumber", '-', 2) AS INTEGER)), 0)
FROM "Invoice"
GROUP BY "tenantId"
ON CONFLICT ("tenantId", "counterName") DO NOTHING;

INSERT INTO "SequenceCounter" ("tenantId", "counterName", "lastValue")
SELECT
    "tenantId",
    'JE',
    COALESCE(MAX(CAST(SPLIT_PART("entryNumber", '-', 2) AS INTEGER)), 0)
FROM "JournalEntry"
GROUP BY "tenantId"
ON CONFLICT ("tenantId", "counterName") DO NOTHING;

-- ─── Invoice idempotency: global → tenant-scoped ──────────────────────────────

-- Drop global unique index
DROP INDEX IF EXISTS "Invoice_idempotencyKey_key";

-- Add tenant-scoped unique index (NULL values are excluded — NULLs are never equal
-- in PostgreSQL unique indexes, so rows without an idempotency key are unaffected)
CREATE UNIQUE INDEX "Invoice_tenantId_idempotencyKey_key"
    ON "Invoice"("tenantId", "idempotencyKey")
    WHERE "idempotencyKey" IS NOT NULL;

-- ─── Payment idempotency: global → tenant-scoped ──────────────────────────────

DROP INDEX IF EXISTS "Payment_idempotencyKey_key";
DROP INDEX IF EXISTS "Payment_idempotencyKey_idx";

CREATE UNIQUE INDEX "Payment_tenantId_idempotencyKey_key"
    ON "Payment"("tenantId", "idempotencyKey")
    WHERE "idempotencyKey" IS NOT NULL;
