import { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from './auth.token';

export type AuthUser = {
  id: string;
  userId: string;
  username: string;
  role: string;
};

export type AuthenticatedRequest = Request & {
  user?: AuthUser;
};

export const requireAuth = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void => {
  const authorizationHeader = req.headers.authorization || '';

  const [scheme, token] = authorizationHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    res.status(401).json({
      success: false,
      message: 'توکن دسترسی ارسال نشده است.',
      code: 'ACCESS_TOKEN_REQUIRED',
    });
    return;
  }

  try {
    const payload = verifyAccessToken(token);

    req.user = {
      id: payload.id || payload.sub,
      userId: payload.id || payload.sub,
      username: payload.username,
      role: payload.role,
    };

    next();
  } catch {
    res.status(401).json({
      success: false,
      message: 'توکن دسترسی معتبر نیست یا منقضی شده است.',
      code: 'INVALID_ACCESS_TOKEN',
    });
  }
};