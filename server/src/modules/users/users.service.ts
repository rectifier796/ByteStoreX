import { db } from '../../shared/db.js';
import { User } from '../../shared/types.js';
import { NotFoundError, ForbiddenError, ValidationError } from '../../core/errors.js';

export class UsersService {
  async getById(id: string): Promise<Omit<User, 'passwordHash'>> {
    const user = db.users.get(id);
    if (!user) {
      throw new NotFoundError('User');
    }
    const { passwordHash: _, ...safeUser } = user;
    return safeUser;
  }

  /** Admin-only: list all users (never expose to regular users — PII + recon risk). */
  async listAll(): Promise<Array<Omit<User, 'passwordHash'>>> {
    return Array.from(db.users.values()).map((u) => {
      const { passwordHash: _, ...safe } = u;
      return safe;
    });
  }

  /**
   * Update own profile. Only whitelisted fields (name) are accepted.
   * Role, quota, storageUsedBytes etc. MUST NOT be settable here.
   */
  async updateProfile(id: string, updates: { name?: string }): Promise<Omit<User, 'passwordHash'>> {
    const user = db.users.get(id);
    if (!user) {
      throw new NotFoundError('User');
    }

    if (updates.name !== undefined) {
      const trimmed = updates.name.trim();
      if (!trimmed || trimmed.length > 128) {
        throw new ValidationError('Name must be between 1 and 128 characters.');
      }
      user.name = trimmed;
    }
    user.updatedAt = new Date().toISOString();

    db.users.set(id, user);
    const { passwordHash: _, ...safe } = user;
    return safe;
  }
}

export const usersService = new UsersService();
