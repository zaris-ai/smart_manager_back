import crypto from 'crypto';
import jwt, { Secret, SignOptions } from 'jsonwebtoken';
import { Request } from 'express';
import { Types } from 'mongoose';
import AuthRefreshToken from './auth.model';
import { UserDocument } from '@/modules/users/user.model';

export type AccessTokenPayload = {
  type: 'access';
  sub: string;
  id: string;
  username: string;
  role: string;
};

export type RefreshTokenPayload = {
  type: 'refresh';
  sub: string;
  id: string;
};

export type AuthTokenPair = {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  accessTokenExpiresIn: string;
  refreshTokenExpiresIn: string;
};

const accessSecret: Secret = process.env.JWT_ACCESS_SECRET || 'dev-access-secret';
const refreshSecret: Secret =
  process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret';

const accessTokenExpiresIn = process.env.JWT_ACCESS_EXPIRES_IN || '15m';
const refreshTokenExpiresIn = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

const accessTokenSignOptions: SignOptions = {
  expiresIn: accessTokenExpiresIn as SignOptions['expiresIn'],
};

const refreshTokenSignOptions: SignOptions = {
  expiresIn: refreshTokenExpiresIn as SignOptions['expiresIn'],
};

const parseDurationToMs = (duration: string): number => {
  const normalized = duration.trim();

  if (/^\d+$/.test(normalized)) {
    return Number(normalized) * 1000;
  }

  const match = normalized.match(/^(\d+)(ms|s|m|h|d)$/);

  if (!match) {
    return 7 * 24 * 60 * 60 * 1000;
  }

  const value = Number(match[1]);
  const unit = match[2];

  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return value * multipliers[unit];
};

export const hashToken = (token: string): string => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

export const signAccessToken = (user: UserDocument): string => {
  const userId = user._id.toString();

  const payload: AccessTokenPayload = {
    type: 'access',
    sub: userId,
    id: userId,
    username: user.username,
    role: user.role,
  };

  return jwt.sign(payload, accessSecret, accessTokenSignOptions);
};

export const signRefreshToken = (user: UserDocument): string => {
  const userId = user._id.toString();

  const payload: RefreshTokenPayload = {
    type: 'refresh',
    sub: userId,
    id: userId,
  };

  return jwt.sign(payload, refreshSecret, refreshTokenSignOptions);
};

export const verifyAccessToken = (token: string): AccessTokenPayload => {
  const payload = jwt.verify(token, accessSecret) as AccessTokenPayload;

  if (payload.type !== 'access') {
    throw new Error('Invalid access token type.');
  }

  return payload;
};

export const verifyRefreshToken = (token: string): RefreshTokenPayload => {
  const payload = jwt.verify(token, refreshSecret) as RefreshTokenPayload;

  if (payload.type !== 'refresh') {
    throw new Error('Invalid refresh token type.');
  }

  return payload;
};

export const createTokenPair = async (
  user: UserDocument,
  req?: Request,
): Promise<AuthTokenPair> => {
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);

  const expiresAt = new Date(
    Date.now() + parseDurationToMs(refreshTokenExpiresIn),
  );

  await AuthRefreshToken.create({
    userId: new Types.ObjectId(user._id.toString()),
    refreshTokenHash: hashToken(refreshToken),
    userAgent: req?.headers['user-agent'] || '',
    ipAddress: req?.ip || '',
    expiresAt,
    revokedAt: null,
  });

  return {
    accessToken,
    refreshToken,
    tokenType: 'Bearer',
    accessTokenExpiresIn,
    refreshTokenExpiresIn,
  };
};

export const createAccessTokenWithExistingRefreshToken = (
  user: UserDocument,
  refreshToken: string,
): AuthTokenPair => {
  return {
    accessToken: signAccessToken(user),
    refreshToken,
    tokenType: 'Bearer',
    accessTokenExpiresIn,
    refreshTokenExpiresIn,
  };
};

export const revokeRefreshToken = async (
  refreshToken: string,
): Promise<void> => {
  await AuthRefreshToken.findOneAndUpdate(
    {
      refreshTokenHash: hashToken(refreshToken),
      revokedAt: null,
    },
    {
      revokedAt: new Date(),
    },
  );
};