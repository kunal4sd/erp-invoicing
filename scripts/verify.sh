#!/usr/bin/env bash
# Smoke-test a running Docker Compose stack.
# Usage: ./scripts/verify.sh [BASE_URL]
#   BASE_URL defaults to http://localhost:3001
set -euo pipefail

BASE_URL="${1:-http://localhost:3001}"
PASS=0
FAIL=0

check() {
  local label="$1" expected="$2" actual="$3"
  if echo "$actual" | grep -q "$expected"; then
    echo "  PASS  $label"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $label"
    echo "        expected to contain: $expected"
    echo "        got: $actual"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== ERP Invoicing Smoke Tests ==="
echo "Target: $BASE_URL"
echo

echo "--- Health ---"
res=$(curl -sf "$BASE_URL/health" 2>/dev/null || echo '{"status":"error"}')
check "GET /health returns ok" '"status":"ok"' "$res"

echo
echo "--- Tenants ---"
res=$(curl -sf "$BASE_URL/api/tenants" 2>/dev/null || echo '{"success":false}')
check "GET /api/tenants returns success" '"success":true' "$res"

TENANT_ID=$(echo "$res" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$TENANT_ID" ]; then
  echo "  SKIP  Could not detect tenant ID — skipping tenant-scoped checks"
else
  echo "  INFO  Tenant: $TENANT_ID"

  echo
  echo "--- Invoices ---"
  res=$(curl -sf "$BASE_URL/api/invoices" -H "X-Tenant-ID: $TENANT_ID" 2>/dev/null || echo '{"success":false}')
  check "GET /api/invoices" '"success":true' "$res"

  echo
  echo "--- AR Summary ---"
  res=$(curl -sf "$BASE_URL/api/reports/ar-summary" -H "X-Tenant-ID: $TENANT_ID" 2>/dev/null || echo '{"success":false}')
  check "GET /api/reports/ar-summary" '"success":true' "$res"

  echo
  echo "--- GL Reconciliation ---"
  res=$(curl -sf "$BASE_URL/api/reports/gl-reconciliation" -H "X-Tenant-ID: $TENANT_ID" 2>/dev/null || echo '{"success":false}')
  check "GET /api/reports/gl-reconciliation" '"success":true' "$res"
  check "GL reconciliation is balanced" '"isReconciled":true' "$res"
fi

echo
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
