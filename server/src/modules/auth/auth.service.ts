import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { db } from '../../shared/db.js';
import { User, RefreshToken } from '../../shared/types.js';
import { config } from '../../config/index.js';
import { ValidationError, UnauthorizedError, ConflictError } from '../../core/errors.js';
import { v4 as uuidv4 } from 'uuid';
import { auditService } from '../audit/audit.service.js';
import { logger } from '../../core/logger.js';
import { postgresRepo } from '../../shared/postgres.repo.js';

export interface LoginDTO {
  email: string;
  password: string;
}

export interface RegisterDTO {
  email: string;
  password: string;
  name: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export class AuthService {
  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private generateAccessToken(user: User): string {
    return jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      config.jwtSecret,
      { expiresIn: 900 } // 15 minutes short-lived access token
    );
  }

  private async generateAndStoreRefreshToken(userId: string): Promise<string> {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(); // 7 days

    const tokenRecord: RefreshToken = {
      id: `rft-${uuidv4().substring(0, 8)}`,
      tokenHash,
      userId,
      isRevoked: false,
      expiresAt,
      createdAt: new Date().toISOString(),
    };

    db.refreshTokens.set(tokenRecord.id, tokenRecord);
    await postgresRepo.saveRefreshToken(tokenRecord);
    return rawToken;
  }

  async register(dto: RegisterDTO, ip: string): Promise<{ tokens: AuthTokens; user: Omit<User, 'passwordHash'> }> {
    if (!dto.email || !dto.password || !dto.name) {
      throw new ValidationError('Email, password, and name are required');
    }

    const existing = Array.from(db.users.values()).find((u) => u.email.toLowerCase() === dto.email.toLowerCase());
    if (existing) {
      throw new ConflictError('User with this email already exists');
    }

    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(dto.password, salt);

    const newUser: User = {
      id: `usr-${uuidv4().substring(0, 8)}`,
      email: dto.email.toLowerCase(),
      name: dto.name,
      passwordHash,
      role: 'user',
      storageUsedBytes: 0,
      quotaBytes: config.defaultQuota,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    db.users.set(newUser.id, newUser);
    await postgresRepo.saveUser(newUser);

    const accessToken = this.generateAccessToken(newUser);
    const refreshToken = await this.generateAndStoreRefreshToken(newUser.id);

    await auditService.record({
      action: 'USER_REGISTER',
      category: 'auth',
      actorId: newUser.id,
      actorEmail: newUser.email,
      ip,
      details: { name: newUser.name }
    });

    const { passwordHash: _, ...safeUser } = newUser;
    return { tokens: { accessToken, refreshToken }, user: safeUser };
  }

  async login(dto: LoginDTO, ip: string): Promise<{ tokens: AuthTokens; user: Omit<User, 'passwordHash'> }> {
    if (!dto.email || !dto.password) {
      throw new ValidationError('Email and password are required');
    }

    const user = Array.from(db.users.values()).find((u) => u.email.toLowerCase() === dto.email.toLowerCase());
    if (!user) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const isValid = bcrypt.compareSync(dto.password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const accessToken = this.generateAccessToken(user);
    const refreshToken = await this.generateAndStoreRefreshToken(user.id);

    await auditService.record({
      action: 'USER_LOGIN',
      category: 'auth',
      actorId: user.id,
      actorEmail: user.email,
      ip,
      details: { role: user.role }
    });

    const { passwordHash: _, ...safeUser } = user;
    return { tokens: { accessToken, refreshToken }, user: safeUser };
  }

  async rotateRefreshToken(rawRefreshToken: string, ip: string): Promise<AuthTokens> {
    if (!rawRefreshToken) {
      throw new ValidationError('Refresh token is required');
    }

    const tokenHash = this.hashToken(rawRefreshToken);
    const existingToken = Array.from(db.refreshTokens.values()).find((t) => t.tokenHash === tokenHash);

    if (!existingToken) {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }

    // Reuse Attack Detection: If token is already revoked, revoke all active sessions for this user!
    if (existingToken.isRevoked) {
      logger.error('AuthSecurity', `TOKEN REUSE DETECTED! Revoking all sessions for userId=${existingToken.userId}`);
      await this.revokeAllSessions(existingToken.userId);

      await auditService.record({
        action: 'TOKEN_REUSE_DETECTED',
        category: 'auth',
        actorId: existingToken.userId,
        ip,
        details: { revokedTokenId: existingToken.id }
      });

      throw new UnauthorizedError('Security alert: Revoked refresh token reuse detected. All sessions terminated.');
    }

    // Expiration Check
    if (new Date(existingToken.expiresAt).getTime() < Date.now()) {
      existingToken.isRevoked = true;
      db.refreshTokens.set(existingToken.id, existingToken);
      throw new UnauthorizedError('Refresh token has expired');
    }

    const user = db.users.get(existingToken.userId);
    if (!user) {
      throw new UnauthorizedError('User associated with refresh token no longer exists');
    }

    // Revoke old refresh token (Rotation)
    existingToken.isRevoked = true;
    db.refreshTokens.set(existingToken.id, existingToken);

    // Issue new token pair
    const newAccessToken = this.generateAccessToken(user);
    const newRefreshToken = await this.generateAndStoreRefreshToken(user.id);

    await auditService.record({
      action: 'REFRESH_TOKEN_ROTATE',
      category: 'auth',
      actorId: user.id,
      ip,
      details: { oldTokenId: existingToken.id }
    });

    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
  }

  async logout(rawRefreshToken: string, userId: string, ip: string): Promise<void> {
    if (rawRefreshToken) {
      const tokenHash = this.hashToken(rawRefreshToken);
      const tokenRecord = Array.from(db.refreshTokens.values()).find((t) => t.tokenHash === tokenHash);
      if (tokenRecord) {
        tokenRecord.isRevoked = true;
        db.refreshTokens.set(tokenRecord.id, tokenRecord);
      }
    }

    await auditService.record({
      action: 'USER_LOGOUT',
      category: 'auth',
      actorId: userId,
      ip,
    });
  }

  async revokeAllSessions(userId: string): Promise<number> {
    let count = 0;
    for (const [id, record] of db.refreshTokens.entries()) {
      if (record.userId === userId && !record.isRevoked) {
        record.isRevoked = true;
        db.refreshTokens.set(id, record);
        count++;
      }
    }
    return count;
  }

  verifyAccessToken(token: string): { userId: string; email: string; role: string } {
    try {
      return jwt.verify(token, config.jwtSecret) as any;
    } catch {
      throw new UnauthorizedError('Invalid or expired access token');
    }
  }
}

export const authService = new AuthService();
