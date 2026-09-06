import { Request, Response, NextFunction } from 'express';
import { AppError } from './errors.js';
import { logger } from './logger.js';
import { getRequestId } from './context.js';

export const errorHandlerMiddleware = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const requestId = getRequestId();

  if (err instanceof AppError) {
    logger.warn('ErrorHandler', `AppError [${err.errorCode}]: ${err.message}`, {
      statusCode: err.statusCode,
      details: err.details,
      path: req.originalUrl,
      method: req.method
    });

    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.errorCode,
        message: err.message,
        details: err.details,
        requestId,
        timestamp: new Date().toISOString()
      }
    });
    return;
  }

  logger.error('ErrorHandler', `Unhandled error: ${err.message}`, {
    stack: err.stack,
    path: req.originalUrl,
    method: req.method
  });

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected server error occurred',
      requestId,
      timestamp: new Date().toISOString()
    }
  });
};
