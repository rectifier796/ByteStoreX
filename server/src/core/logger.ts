import { getRequestId } from './context.js';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogPayload {
  timestamp: string;
  level: LogLevel;
  requestId: string;
  module: string;
  message: string;
  meta?: Record<string, any>;
}

class StructuredLogger {
  private formatLog(level: LogLevel, moduleName: string, message: string, meta?: Record<string, any>): string {
    const payload: LogPayload = {
      timestamp: new Date().toISOString(),
      level,
      requestId: getRequestId(),
      module: moduleName,
      message,
      ...(meta && Object.keys(meta).length > 0 ? { meta } : {})
    };
    return JSON.stringify(payload);
  }

  info(moduleName: string, message: string, meta?: Record<string, any>): void {
    console.log(this.formatLog('info', moduleName, message, meta));
  }

  warn(moduleName: string, message: string, meta?: Record<string, any>): void {
    console.warn(this.formatLog('warn', moduleName, message, meta));
  }

  error(moduleName: string, message: string, meta?: Record<string, any>): void {
    console.error(this.formatLog('error', moduleName, message, meta));
  }

  debug(moduleName: string, message: string, meta?: Record<string, any>): void {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(this.formatLog('debug', moduleName, message, meta));
    }
  }
}

export const logger = new StructuredLogger();
