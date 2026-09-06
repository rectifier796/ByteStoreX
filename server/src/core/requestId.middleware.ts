import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { requestContext } from './context.js';

export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const existingId = req.headers['x-request-id'] as string;
  const requestId = existingId || `req-${uuidv4().substring(0, 8)}`;
  
  res.setHeader('X-Request-ID', requestId);
  (req as any).requestId = requestId;

  const store = {
    requestId,
    ip: req.ip || req.socket.remoteAddress || 'unknown'
  };

  requestContext.run(store, () => {
    next();
  });
};
