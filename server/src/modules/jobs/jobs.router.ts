import { Router, Request, Response, NextFunction } from 'express';
import { jobsEngine } from './jobs.engine.js';
import { workerDispatcher } from './worker.dispatcher.js';
import { requireAuth } from '../auth/auth.middleware.js';
import { NotFoundError, ForbiddenError } from '../../core/errors.js';

export const jobsRouter = Router();

// GET /api/v1/jobs - List user jobs
jobsRouter.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as any).user.userId;
    const jobs = await jobsEngine.listJobs(ownerId);
    res.json({ success: true, jobs });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/jobs/:id - Query specific job status
jobsRouter.get('/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const job = await jobsEngine.getJob(req.params.id, user.userId);
    if (!job) throw new NotFoundError('Job');
    res.json({ success: true, job });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/jobs/enqueue - Enqueue a new background job
jobsRouter.post('/enqueue', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as any).user.userId;
    const { type, payload, maxAttempts } = req.body;
    const job = await jobsEngine.enqueue(type, payload || {}, ownerId, maxAttempts);
    res.status(201).json({ success: true, job });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/jobs/claim - Claim next pending job (admin / internal worker only)
jobsRouter.post('/claim', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userRole = (req as any).user.role;
    if (userRole !== 'admin') {
      throw new ForbiddenError('Only administrators can claim jobs from the queue.');
    }
    const workerId = (req.body.workerId as string) || (req as any).user.userId;
    const job = await jobsEngine.claimNextJob(workerId);
    if (!job) {
      return res.status(204).send(); // No pending jobs available
    }
    res.json({ success: true, job });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/jobs/process-next - Manually trigger one worker dispatch execution step
jobsRouter.post('/process-next', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const processed = await workerDispatcher.claimAndProcessNext();
    res.json({ success: true, processed });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/jobs/run-cleanup - Enqueue and execute immediate background cleanup sweep
jobsRouter.post('/run-cleanup', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ownerId = (req as any).user.userId;
    const userRole = (req as any).user.role;
    if (userRole !== 'admin') {
      throw new ForbiddenError('Only system administrators can execute cleanup sweeps.');
    }
    const job = await jobsEngine.enqueue('trash_cleanup', {}, ownerId);
    await workerDispatcher.claimAndProcessNext();
    const updatedJob = await jobsEngine.getJob(job.id, ownerId);
    res.json({ success: true, job: updatedJob || job });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/jobs/:id/complete - Mark claimed job as completed (owner or admin)
jobsRouter.post('/:id/complete', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const existingJob = await jobsEngine.getJob(req.params.id, user.userId, user.role);
    if (!existingJob && user.role !== 'admin') {
      throw new ForbiddenError('You do not own this job.');
    }
    const workerId = (req.body.workerId as string) || user.userId;
    const resultPayload = req.body.result;
    const job = await jobsEngine.completeJob(req.params.id, workerId, resultPayload);
    res.json({ success: true, job });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/jobs/:id/fail - Mark claimed job as failed (owner or admin)
jobsRouter.post('/:id/fail', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const existingJob = await jobsEngine.getJob(req.params.id, user.userId, user.role);
    if (!existingJob && user.role !== 'admin') {
      throw new ForbiddenError('You do not own this job.');
    }
    const workerId = (req.body.workerId as string) || user.userId;
    const errorMsg = req.body.error || 'Execution failure';
    const job = await jobsEngine.failJob(req.params.id, workerId, errorMsg);
    res.json({ success: true, job });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/jobs/recover-stale - Trigger administrative stale job recovery
jobsRouter.post('/recover-stale', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userRole = (req as any).user.role;
    if (userRole !== 'admin') {
      throw new ForbiddenError('Only system administrators can execute stale job recovery.');
    }
    const result = await jobsEngine.recoverStaleJobs();
    res.json({ success: true, message: `Stale job recovery completed.`, data: result });
  } catch (err) {
    next(err);
  }
});
