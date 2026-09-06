import { EventEmitter } from 'events';
import { db } from '../../shared/db.js';
import { Job } from '../../shared/types.js';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../core/logger.js';
import { getRequestId } from '../../core/context.js';
import { auditService } from '../audit/audit.service.js';
import { NotFoundError, ValidationError } from '../../core/errors.js';
import { postgresRepo } from '../../shared/postgres.repo.js';

export class JobsEngine extends EventEmitter {
  constructor() {
    super();
  }

  /**
   * Validates legal job state transitions.
   * State Machine:
   *   PENDING -> PROCESSING | FAILED
   *   PROCESSING -> COMPLETED | PENDING (retry) | FAILED
   *   COMPLETED -> [] (Terminal state)
   *   FAILED -> PENDING (Re-enqueue)
   */
  private validateStateTransition(current: Job['status'], next: Job['status']): void {
    const validTransitions: Record<Job['status'], Job['status'][]> = {
      PENDING: ['PROCESSING', 'FAILED'],
      queued: ['PROCESSING', 'FAILED'],
      PROCESSING: ['COMPLETED', 'PENDING', 'FAILED'],
      COMPLETED: [],
      FAILED: ['PENDING'],
    };

    const allowed = validTransitions[current] || [];
    if (!allowed.includes(next)) {
      throw new ValidationError(`Invalid job state transition from '${current}' to '${next}'`);
    }
  }

  /**
   * Enqueue a new background job into PENDING status.
   */
  async enqueue(
    type: Job['type'],
    payload: Record<string, any>,
    ownerId: string,
    maxAttempts: number = 3
  ): Promise<Job> {
    const now = new Date().toISOString();
    const job: Job = {
      id: `job-${uuidv4().substring(0, 8)}`,
      type,
      status: 'PENDING',
      progress: 0,
      payload,
      attempts: 0,
      maxAttempts: maxAttempts || 3,
      nextRunAt: now,
      lockedAt: null,
      lockedBy: null,
      requestId: getRequestId(),
      ownerId,
      createdAt: now,
      updatedAt: now,
    };

    db.jobs.set(job.id, job);
    await postgresRepo.saveJob(job);
    logger.info('JobsEngine', `Job '${job.id}' [${job.type}] enqueued with PENDING status (maxAttempts: ${job.maxAttempts}).`);

    return job;
  }

  /**
   * Claim next eligible pending job with FOR UPDATE SKIP LOCKED semantics.
   */
  async claimNextJob(workerId: string = 'worker-default'): Promise<Job | null> {
    const nowMs = Date.now();
    const staleThresholdMs = 300000; // 5 minutes

    // Find next eligible PENDING job in FIFO queue order
    const eligibleJobs = Array.from(db.jobs.values()).filter((j) => {
      const isPendingStatus = j.status === 'PENDING' || j.status === 'queued';
      const isDueToRun = new Date(j.nextRunAt).getTime() <= nowMs;
      const isUnlockedOrStale =
        !j.lockedAt || new Date(j.lockedAt).getTime() < nowMs - staleThresholdMs;

      return isPendingStatus && isDueToRun && isUnlockedOrStale;
    });

    if (eligibleJobs.length === 0) {
      return null;
    }

    // Sort by creation date (FIFO)
    eligibleJobs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const candidateJob = eligibleJobs[0];

    // Validate state transition
    this.validateStateTransition(candidateJob.status, 'PROCESSING');

    // Atomically claim the job
    const nowStr = new Date().toISOString();
    candidateJob.status = 'PROCESSING';
    candidateJob.lockedAt = nowStr;
    candidateJob.lockedBy = workerId;
    candidateJob.attempts += 1;
    candidateJob.updatedAt = nowStr;

    db.jobs.set(candidateJob.id, candidateJob);

    logger.info(
      'JobsEngine',
      `Worker '${workerId}' claimed job '${candidateJob.id}' (${candidateJob.type}) [Attempt ${candidateJob.attempts}/${candidateJob.maxAttempts}] via SKIP LOCKED semantics.`
    );

    return candidateJob;
  }

  /**
   * Complete a claimed job successfully.
   */
  async completeJob(
    jobId: string,
    workerId: string = 'system',
    result?: Record<string, any>
  ): Promise<Job> {
    const job = db.jobs.get(jobId);
    if (!job) {
      throw new NotFoundError('Job');
    }

    this.validateStateTransition(job.status, 'COMPLETED');

    const nowStr = new Date().toISOString();
    job.status = 'COMPLETED';
    job.progress = 100;
    job.result = result || { message: `Job ${job.type} executed successfully`, completedAt: nowStr };
    job.lockedAt = null;
    job.lockedBy = null;
    job.updatedAt = nowStr;

    db.jobs.set(job.id, job);
    logger.info('JobsEngine', `Worker '${workerId}' completed job '${job.id}' successfully.`);

    await auditService.record({
      action: 'BACKGROUND_JOB_COMPLETE',
      category: 'job',
      actorId: job.ownerId,
      resourceId: job.id,
      details: { type: job.type, result: job.result, attempts: job.attempts }
    });

    return job;
  }

  /**
   * Fail a job with exponential backoff and random jitter, scheduling a retry if attempts remain.
   */
  async failJob(
    jobId: string,
    workerId: string = 'system',
    errorMsg: string = 'Execution error'
  ): Promise<Job> {
    const job = db.jobs.get(jobId);
    if (!job) {
      throw new NotFoundError('Job');
    }

    const nowMs = Date.now();
    const nowStr = new Date().toISOString();

    if (job.attempts < job.maxAttempts) {
      this.validateStateTransition(job.status, 'PENDING');

      // Calculate Exponential Backoff with Jitter
      const baseBackoffMs = 1000; // 1s base
      const exponentialMs = baseBackoffMs * Math.pow(2, job.attempts - 1);
      const randomJitterMs = Math.floor(Math.random() * 0.3 * exponentialMs); // up to 30% jitter
      const delayMs = Math.min(exponentialMs + randomJitterMs, 300000); // max 5 min
      const nextRunAtStr = new Date(nowMs + delayMs).toISOString();

      job.status = 'PENDING'; // Re-enqueued for retry
      job.error = errorMsg;
      job.nextRunAt = nextRunAtStr;
      job.lockedAt = null;
      job.lockedBy = null;
      job.updatedAt = nowStr;

      db.jobs.set(job.id, job);

      logger.warn(
        'JobsEngine',
        `Job '${job.id}' failed attempt ${job.attempts}/${job.maxAttempts}. Scheduled retry in ${Math.round(
          delayMs / 1000
        )}s (at ${nextRunAtStr}) with exponential backoff & jitter.`
      );
    } else {
      this.validateStateTransition(job.status, 'FAILED');

      // Permanently FAILED after max attempts exhausted
      job.status = 'FAILED';
      job.error = errorMsg;
      job.lockedAt = null;
      job.lockedBy = null;
      job.updatedAt = nowStr;

      db.jobs.set(job.id, job);

      logger.error(
        'JobsEngine',
        `Job '${job.id}' permanently FAILED after exhausting max attempts (${job.attempts}/${job.maxAttempts}). Error: ${errorMsg}`
      );

      await auditService.record({
        action: 'BACKGROUND_JOB_FAILED',
        category: 'job',
        actorId: job.ownerId,
        resourceId: job.id,
        details: { type: job.type, error: errorMsg, attempts: job.attempts }
      });
    }

    return job;
  }

  /**
   * Recover stale jobs stuck in PROCESSING state due to worker crashes or timeouts.
   */
  async recoverStaleJobs(staleThresholdMs: number = 300000): Promise<{ recoveredCount: number; failedCount: number; jobIds: string[] }> {
    const nowMs = Date.now();
    const staleJobs = Array.from(db.jobs.values()).filter(
      (j) => j.status === 'PROCESSING' && j.lockedAt && new Date(j.lockedAt).getTime() < nowMs - staleThresholdMs
    );

    let recoveredCount = 0;
    let failedCount = 0;
    const processedJobIds: string[] = [];

    for (const job of staleJobs) {
      processedJobIds.push(job.id);
      try {
        // Re-use failJob so exponential backoff, audit events and state guards are consistent.
        // At recovery time job.attempts is already incremented (was done at claimNextJob),
        // so failJob will correctly check whether retries remain.
        const staleMsg = `Lock expired: stale worker '${job.lockedBy || 'unknown'}' exceeded ${staleThresholdMs}ms`;
        const recovered = await this.failJob(job.id, job.lockedBy || 'system', staleMsg);
        if (recovered.status === 'PENDING') {
          recoveredCount++;
          logger.warn('JobsEngine', `Recovered stale job '${job.id}' back to PENDING for retry.`);
        } else {
          failedCount++;
          logger.error('JobsEngine', `Stale job '${job.id}' permanently FAILED (max attempts exhausted).`);
        }
      } catch (err: any) {
        logger.error('JobsEngine', `Error during stale recovery for job '${job.id}': ${err.message}`);
        failedCount++;
      }
    }

    return { recoveredCount, failedCount, jobIds: processedJobIds };
  }

  async listJobs(ownerId: string): Promise<Job[]> {
    return Array.from(db.jobs.values())
      .filter((j) => j.ownerId === ownerId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * Fetch a single job. Admins can fetch any job; regular users only see their own.
   */
  async getJob(jobId: string, ownerId: string, userRole?: string): Promise<Job | undefined> {
    const job = db.jobs.get(jobId);
    if (!job) return undefined;
    if (userRole === 'admin') return job;
    if (job.ownerId !== ownerId) return undefined;
    return job;
  }
}

export const jobsEngine = new JobsEngine();
