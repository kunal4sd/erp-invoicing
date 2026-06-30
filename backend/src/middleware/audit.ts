import { prisma } from '../config/database';
import { logger } from '../shared/logger';

interface AuditEntry {
  tenantId: string;
  entityType: string;
  entityId: string;
  action: string;
  userId: string;
  userName: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  ipAddress?: string;
}

export async function createAuditLog(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        tenantId: entry.tenantId,
        entityType: entry.entityType,
        entityId: entry.entityId,
        action: entry.action,
        userId: entry.userId,
        userName: entry.userName,
        oldValues: entry.oldValues as object ?? undefined,
        newValues: entry.newValues as object ?? undefined,
        ipAddress: entry.ipAddress,
      },
    });
  } catch (err) {
    // Audit log failure must never crash the main request
    logger.error('Failed to write audit log', { entry, error: err });
  }
}
