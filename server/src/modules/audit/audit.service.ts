import { db } from '../../shared/db.js';
import { AuditLog } from '../../shared/types.js';
import { getRequestId } from '../../core/context.js';
import { v4 as uuidv4 } from 'uuid';
import { postgresRepo } from '../../shared/postgres.repo.js';

export interface CreateAuditLogDTO {
  action: string;
  category: 'auth' | 'file' | 'folder' | 'share' | 'trash' | 'quota' | 'job';
  actorId: string;
  actorEmail?: string;
  resourceId?: string;
  resourceType?: string;
  details?: Record<string, any>;
  ip?: string;
}

/**
 * Maximum number of audit log entries to retain in memory.
 * When the cap is reached the oldest entries (tail) are evicted.
 * This prevents unbounded heap growth in long-running processes.
 */
const MAX_AUDIT_LOG_ENTRIES = 10_000;

export class AuditService {
  async record(dto: CreateAuditLogDTO): Promise<AuditLog> {
    const entry: AuditLog = {
      id: `aud-${uuidv4().substring(0, 8)}`,
      action: dto.action,
      category: dto.category,
      actorId: dto.actorId,
      actorEmail: dto.actorEmail,
      resourceId: dto.resourceId,
      resourceType: dto.resourceType,
      details: dto.details,
      requestId: getRequestId(),
      ip: dto.ip || '127.0.0.1',
      timestamp: new Date().toISOString(),
    };

    db.auditLogs.unshift(entry);
    await postgresRepo.saveAuditLog(entry);

    // Ring-buffer eviction: trim oldest entries beyond the cap
    if (db.auditLogs.length > MAX_AUDIT_LOG_ENTRIES) {
      db.auditLogs.length = MAX_AUDIT_LOG_ENTRIES;
    }

    return entry;
  }

  async list(filters?: { actorId?: string; category?: string; limit?: number }): Promise<AuditLog[]> {
    let logs = [...db.auditLogs];

    if (filters?.actorId) {
      logs = logs.filter(l => l.actorId === filters.actorId);
    }
    if (filters?.category) {
      logs = logs.filter(l => l.category === filters.category);
    }
    if (filters?.limit) {
      logs = logs.slice(0, filters.limit);
    }

    return logs;
  }
}

export const auditService = new AuditService();

