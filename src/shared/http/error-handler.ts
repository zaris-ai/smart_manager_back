import { NextFunction, Request, Response } from 'express';

type AppLikeError = {
  statusCode?: number;
  status?: number;
  code?: string;
  message?: string;
  stack?: string;
  details?: unknown;
  errors?: unknown;
};

const getErrorMessage = (error: unknown): string => {
  if (!error) return 'خطای داخلی سرور رخ داده است.';

  if (error instanceof Error && error.message) return error.message;

  if (typeof error === 'string') return error;

  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as AppLikeError).message === 'string'
  ) {
    return (error as AppLikeError).message || 'خطای داخلی سرور رخ داده است.';
  }

  return 'خطای داخلی سرور رخ داده است.';
};

const getErrorStatusCode = (error: unknown): number => {
  if (!error || typeof error !== 'object') return 500;

  const appError = error as AppLikeError;

  return appError.statusCode || appError.status || 500;
};

const getErrorCode = (error: unknown, statusCode: number): string => {
  if (error && typeof error === 'object') {
    const appError = error as AppLikeError;

    if (appError.code) return appError.code;
  }

  if (statusCode === 400) return 'BAD_REQUEST';
  if (statusCode === 401) return 'UNAUTHORIZED';
  if (statusCode === 403) return 'FORBIDDEN';
  if (statusCode === 404) return 'NOT_FOUND';

  return 'INTERNAL_SERVER_ERROR';
};

export const errorHandler = (
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  const statusCode = getErrorStatusCode(error);
  const safeStatusCode = statusCode >= 400 && statusCode < 600 ? statusCode : 500;

  const appError = error as AppLikeError | undefined;

  const responseBody: Record<string, unknown> = {
    success: false,
    message:
      safeStatusCode >= 500
        ? 'خطای داخلی سرور رخ داده است.'
        : getErrorMessage(error),
    code: getErrorCode(error, safeStatusCode),
  };

  if (appError?.details) {
    responseBody.details = appError.details;
  }

  if (appError?.errors) {
    responseBody.errors = appError.errors;
  }

  if (process.env.NODE_ENV !== 'production') {
    responseBody.debug = {
      originalMessage: getErrorMessage(error),
      stack:
        error instanceof Error
          ? error.stack
          : typeof appError?.stack === 'string'
            ? appError.stack
            : undefined,
    };
  }

  res.status(safeStatusCode).json(responseBody);
};

export default errorHandler;