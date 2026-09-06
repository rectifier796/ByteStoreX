import { Router, Request, Response, NextFunction } from 'express';
import { authService } from './auth.service.js';
import { requireAuth } from './auth.middleware.js';
import { db } from '../../shared/db.js';

export const authRouter = Router();

// Registration
authRouter.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ip = req.ip || '127.0.0.1';
    const result = await authService.register(req.body, ip);
    res.status(201).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

// Login
authRouter.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ip = req.ip || '127.0.0.1';
    const result = await authService.login(req.body, ip);
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

// Token Refresh (Rotation)
authRouter.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ip = req.ip || '127.0.0.1';
    const refreshToken = req.body.refreshToken || req.headers['x-refresh-token'];
    const tokens = await authService.rotateRefreshToken(refreshToken, ip);
    res.json({ success: true, tokens });
  } catch (err) {
    next(err);
  }
});

// Logout
authRouter.post('/logout', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const ip = req.ip || '127.0.0.1';
    const refreshToken = req.body.refreshToken || req.headers['x-refresh-token'];
    await authService.logout(refreshToken, userId, ip);
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
});

// Revoke All User Sessions
authRouter.post('/revoke-all', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const revokedCount = await authService.revokeAllSessions(userId);
    res.json({ success: true, message: `All active sessions revoked (${revokedCount} tokens invalidated)` });
  } catch (err) {
    next(err);
  }
});

// Fetch current user payload
authRouter.get('/me', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const user = db.users.get(userId);
    if (!user) {
      // Fallback if in-memory user map doesn't contain user record
      const payload = (req as any).user;
      return res.json({
        success: true,
        user: {
          id: payload.userId,
          email: payload.email,
          name: payload.email ? payload.email.split('@')[0] : 'User',
          role: payload.role || 'user',
        },
      });
    }
    const { passwordHash: _, ...safeUser } = user;
    res.json({ success: true, user: { ...safeUser, id: safeUser.id } });
  } catch (err) {
    next(err);
  }
});
