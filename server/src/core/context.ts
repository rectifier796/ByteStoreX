import { AsyncLocalStorage } from 'async_hooks';

export interface RequestStore {
  requestId: string;
  userId?: string;
  userRole?: string;
  ip?: string;
}

export const requestContext = new AsyncLocalStorage<RequestStore>();

export function getRequestId(): string {
  const store = requestContext.getStore();
  return store?.requestId || 'req-system';
}

export function getCurrentUserId(): string | undefined {
  const store = requestContext.getStore();
  return store?.userId;
}
