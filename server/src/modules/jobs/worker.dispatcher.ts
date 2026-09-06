import { jobsEngine } from './jobs.engine.js';
import { JOB_HANDLERS } from './job.handlers.js';
import { logger } from '../../core/logger.js';

export class WorkerDispatcher {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private workerId: string;

  constructor(workerId: string = 'worker-local-01') {
    this.workerId = workerId;
  }

  /**
   * Claim and execute the next pending job from the queue.
   */
  async claimAndProcessNext(): Promise<boolean> {
    try {
      const job = await jobsEngine.claimNextJob(this.workerId);
      if (!job) {
        return false; // Queue empty or no eligible jobs
      }

      logger.info('WorkerDispatcher', `Dispatching job '${job.id}' (${job.type}) to task handler...`);

      const handler = JOB_HANDLERS[job.type];

      if (!handler) {
        logger.warn('WorkerDispatcher', `No registered handler found for job type '${job.type}'. Skipping.`);
        await jobsEngine.completeJob(job.id, this.workerId, {
          skipped: true,
          reason: `No registered handler for job type '${job.type}'`,
        });
        return true;
      }

      try {
        const result = await handler(job);
        await jobsEngine.completeJob(job.id, this.workerId, result);
        logger.info('WorkerDispatcher', `Job '${job.id}' (${job.type}) processed successfully.`);
      } catch (err: any) {
        logger.error('WorkerDispatcher', `Task handler failed for job '${job.id}': ${err.message}`);
        await jobsEngine.failJob(job.id, this.workerId, err.message || 'Task handler execution error');
      }

      return true;
    } catch (err: any) {
      logger.error('WorkerDispatcher', `Worker dispatch error: ${err.message}`);
      return false;
    }
  }

  /**
   * Start in-process polling worker loop.
   */
  startPolling(intervalMs: number = 2000): void {
    if (this.isRunning) return;

    this.isRunning = true;
    logger.info('WorkerDispatcher', `In-process background worker started (Worker ID: '${this.workerId}', Interval: ${intervalMs}ms).`);

    this.timer = setInterval(async () => {
      if (!this.isRunning) return;
      try {
        await this.claimAndProcessNext();
      } catch (err: any) {
        logger.warn('WorkerDispatcher', `Worker polling loop error: ${err.message}`);
      }
    }, intervalMs);
  }

  /**
   * Stop in-process polling worker loop.
   */
  stopPolling(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    logger.info('WorkerDispatcher', `In-process background worker stopped.`);
  }
}

export const workerDispatcher = new WorkerDispatcher();
