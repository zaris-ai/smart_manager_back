import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import AuthRefreshToken from './auth.model';
import {
  createTokenPair,
  hashToken,
  revokeRefreshToken,
  verifyRefreshToken,
} from './auth.token';
import User, { UserStatus } from '@/modules/users/user.model';

type AuthRequest = Request & {
  user?: {
    id?: string;
    userId?: string;
    username?: string;
    role?: string;
  };
};

const SAFE_USER_SELECT =
  'firstName lastName fullName username email phone role roleLabel status statusLabel isActive profile managerId language direction lastLoginAt createdAt updatedAt telegramUserId telegramChatId telegramUsername';

const sendValidationError = (res: Response, message: string): void => {
  res.status(400).json({
    success: false,
    message,
    code: 'VALIDATION_ERROR',
  });
};

const sendUnauthorized = (res: Response, message: string): void => {
  res.status(401).json({
    success: false,
    message,
    code: 'UNAUTHORIZED',
  });
};

const toSafeUser = (user: any) => {
  if (!user) return null;

  const raw = user.toObject ? user.toObject() : user;

  delete raw.passwordHash;

  return {
    id: raw._id?.toString(),
    ...raw,
  };
};

export const login = async (req: Request, res: Response): Promise<void> => {
  const { username, email, password } = req.body;

  const identifier = String(username || email || '').trim().toLowerCase();

  if (!identifier || !password) {
    sendValidationError(res, 'نام کاربری و رمز عبور الزامی است.');
    return;
  }

  const user = await User.findOne({
    $or: [{ username: identifier }, { email: identifier }],
  }).select(`+passwordHash ${SAFE_USER_SELECT}`);

  if (!user) {
    sendUnauthorized(res, 'نام کاربری یا رمز عبور اشتباه است.');
    return;
  }

  if (user.status !== UserStatus.ACTIVE || !user.isActive) {
    sendUnauthorized(res, 'حساب کاربری فعال نیست.');
    return;
  }

  const passwordIsValid = await bcrypt.compare(password, user.passwordHash);

  if (!passwordIsValid) {
    sendUnauthorized(res, 'نام کاربری یا رمز عبور اشتباه است.');
    return;
  }

  user.lastLoginAt = new Date();
  await user.save();

  const tokens = await createTokenPair(user, req);

  res.json({
    success: true,
    message: 'ورود با موفقیت انجام شد.',
    data: {
      user: toSafeUser(user),
      tokens,
    },
  });
};

export const refresh = async (req: Request, res: Response): Promise<void> => {
  const { refreshToken } = req.body;

  if (!refreshToken || typeof refreshToken !== 'string') {
    sendValidationError(res, 'توکن تمدید الزامی است.');
    return;
  }

  try {
    const payload = verifyRefreshToken(refreshToken);

    const storedToken = await AuthRefreshToken.findOne({
      userId: payload.id,
      refreshTokenHash: hashToken(refreshToken),
      revokedAt: null,
      expiresAt: {
        $gt: new Date(),
      },
    });

    if (!storedToken) {
      sendUnauthorized(res, 'توکن تمدید معتبر نیست یا منقضی شده است.');
      return;
    }

    const user = await User.findById(payload.id).select(
      `+passwordHash ${SAFE_USER_SELECT}`,
    );

    if (!user || user.status !== UserStatus.ACTIVE || !user.isActive) {
      sendUnauthorized(res, 'حساب کاربری فعال نیست.');
      return;
    }

    storedToken.revokedAt = new Date();
    await storedToken.save();

    const tokens = await createTokenPair(user, req);

    res.json({
      success: true,
      message: 'توکن با موفقیت تمدید شد.',
      data: {
        user: toSafeUser(user),
        tokens,
      },
    });
  } catch {
    sendUnauthorized(res, 'توکن تمدید معتبر نیست یا منقضی شده است.');
  }
};

export const logout = async (req: Request, res: Response): Promise<void> => {
  const { refreshToken } = req.body || {};

  if (refreshToken && typeof refreshToken === 'string') {
    await revokeRefreshToken(refreshToken);
  }

  res.json({
    success: true,
    message: 'خروج با موفقیت انجام شد.',
    data: null,
  });
};

export const me = async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.user?.id || req.user?.userId;

  if (!userId) {
    sendUnauthorized(res, 'کاربر احراز هویت نشده است.');
    return;
  }

  const user = await User.findById(userId).select(SAFE_USER_SELECT);

  if (!user) {
    sendUnauthorized(res, 'کاربر پیدا نشد.');
    return;
  }

  res.json({
    success: true,
    message: 'اطلاعات کاربر جاری دریافت شد.',
    data: toSafeUser(user),
  });
};