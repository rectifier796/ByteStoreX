import { Request, Response, NextFunction } from 'express';
import { authService } from './auth.service.js';
import { UnauthorizedError, ForbiddenError } from '../../core/errors.js';
import { requestContext } from '../../core/context.js';

export const requireAuth = (req: Request, _res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Missing or invalid Authorization header'));
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = authService.verifyAccessToken(token);
    (req as any).user = payload;

    // Mutate current request context store to include userId & userRole
    const currentStore = requestContext.getStore();
    if (currentStore) {
      currentStore.userId = payload.userId;
      currentStore.userRole = payload.role;
    }

    next();
  } catch (err) {
    next(err);
  }
};

export const requireAdmin = (req: Request, _res: Response, next: NextFunction): void => {
  const user = (req as any).user;
  if (!user || user.role !== 'admin') {
    return next(new ForbiddenError('Admin privilege required for this resource'));
  }
  next();
};
