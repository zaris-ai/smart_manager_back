// src/modules/project-roles/project-role.controller.ts

import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { ProjectRole } from './project-role.model';

type AuthRequest = Request & {
  user?: {
    id?: string;
    _id?: string;
    userId?: string;
    role?: string;
  };
};

const ROLE_SELECT = 'title description isActive sortOrder createdAt updatedAt';

const getAuthUserId = (req: AuthRequest): string => {
  return String(req.user?.id || req.user?._id || req.user?.userId || '');
};

const isManager = (req: AuthRequest): boolean => {
  const role = String(req.user?.role || '').toLowerCase();
  return role === 'manager' || role === 'admin';
};

const isValidObjectId = (value?: string): boolean => {
  return Boolean(value && mongoose.Types.ObjectId.isValid(value));
};

const toObjectId = (value: string): mongoose.Types.ObjectId => {
  return new mongoose.Types.ObjectId(value);
};

const sendValidationError = (res: Response, message: string, details?: unknown) => {
  return res.status(400).json({
    success: false,
    message,
    code: 'VALIDATION_ERROR',
    details,
  });
};

const sendForbidden = (res: Response) => {
  return res.status(403).json({
    success: false,
    message: 'شما دسترسی لازم برای این عملیات را ندارید.',
    code: 'FORBIDDEN',
  });
};

const sendNotFound = (res: Response) => {
  return res.status(404).json({
    success: false,
    message: 'نقش پروژه پیدا نشد.',
    code: 'PROJECT_ROLE_NOT_FOUND',
  });
};

const normalizeTitle = (value: unknown): string => {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
};

const normalizeDescription = (value: unknown): string => {
  return typeof value === 'string' ? value.trim() : '';
};

const normalizeSortOrder = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.trunc(parsed);
};

const normalizeIsActive = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === 'boolean') return value;

  if (typeof value === 'string') {
    const normalized = value.toLowerCase().trim();
    if (['true', '1', 'yes', 'active'].includes(normalized)) return true;
    if (['false', '0', 'no', 'inactive'].includes(normalized)) return false;
  }

  return fallback;
};

const isDuplicateKeyError = (error: unknown): boolean => {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      Number((error as { code?: number }).code) === 11000,
  );
};

export const listProjectRoles = async (req: AuthRequest, res: Response) => {
  const includeInactive =
    String(req.query.includeInactive || '').toLowerCase() === 'true';
  const search = String(req.query.search || '').trim();

  const filter: Record<string, unknown> = {};

  if (!includeInactive) {
    filter.isActive = true;
  }

  if (search) {
    filter.title = { $regex: search, $options: 'i' };
  }

  const roles = await ProjectRole.find(filter)
    .select(ROLE_SELECT)
    .sort({ isActive: -1, sortOrder: 1, title: 1 })
    .lean();

  return res.json({
    success: true,
    message: 'نقش‌های پروژه با موفقیت دریافت شدند.',
    data: roles,
    items: roles,
  });
};

export const createProjectRole = async (req: AuthRequest, res: Response) => {
  if (!isManager(req)) return sendForbidden(res);

  const title = normalizeTitle(req.body.title);
  const description = normalizeDescription(req.body.description);
  const sortOrder = normalizeSortOrder(req.body.sortOrder);
  const authUserId = getAuthUserId(req);

  if (!title) {
    return sendValidationError(res, 'عنوان نقش پروژه الزامی است.');
  }

  if (authUserId && !isValidObjectId(authUserId)) {
    return sendValidationError(res, 'شناسه کاربر جاری معتبر نیست.');
  }

  try {
    const role = await ProjectRole.create({
      title,
      description,
      sortOrder,
      isActive: normalizeIsActive(req.body.isActive, true),
      createdBy:
        authUserId && isValidObjectId(authUserId) ? toObjectId(authUserId) : null,
      updatedBy:
        authUserId && isValidObjectId(authUserId) ? toObjectId(authUserId) : null,
    });

    return res.status(201).json({
      success: true,
      message: 'نقش پروژه با موفقیت ایجاد شد.',
      data: role,
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return sendValidationError(res, 'نقشی با این عنوان قبلاً ثبت شده است.');
    }

    throw error;
  }
};

export const updateProjectRole = async (req: AuthRequest, res: Response) => {
  if (!isManager(req)) return sendForbidden(res);

  const { roleId } = req.params;
  const authUserId = getAuthUserId(req);

  if (!isValidObjectId(roleId)) {
    return sendValidationError(res, 'شناسه نقش پروژه معتبر نیست.');
  }

  if (authUserId && !isValidObjectId(authUserId)) {
    return sendValidationError(res, 'شناسه کاربر جاری معتبر نیست.');
  }

  const update: Record<string, unknown> = {};

  if (req.body.title !== undefined) {
    const title = normalizeTitle(req.body.title);

    if (!title) {
      return sendValidationError(res, 'عنوان نقش پروژه الزامی است.');
    }

    update.title = title;
    update.normalizedTitle = title.toLowerCase();
  }

  if (req.body.description !== undefined) {
    update.description = normalizeDescription(req.body.description);
  }

  if (req.body.sortOrder !== undefined) {
    update.sortOrder = normalizeSortOrder(req.body.sortOrder);
  }

  if (req.body.isActive !== undefined) {
    update.isActive = normalizeIsActive(req.body.isActive, true);
  }

  update.updatedBy =
    authUserId && isValidObjectId(authUserId) ? toObjectId(authUserId) : null;

  try {
    const role = await ProjectRole.findByIdAndUpdate(roleId, update, {
      new: true,
      runValidators: true,
    }).select(ROLE_SELECT);

    if (!role) return sendNotFound(res);

    return res.json({
      success: true,
      message: 'نقش پروژه با موفقیت ویرایش شد.',
      data: role,
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return sendValidationError(res, 'نقشی با این عنوان قبلاً ثبت شده است.');
    }

    throw error;
  }
};

export const archiveProjectRole = async (req: AuthRequest, res: Response) => {
  if (!isManager(req)) return sendForbidden(res);

  const { roleId } = req.params;
  const authUserId = getAuthUserId(req);

  if (!isValidObjectId(roleId)) {
    return sendValidationError(res, 'شناسه نقش پروژه معتبر نیست.');
  }

  const role = await ProjectRole.findByIdAndUpdate(
    roleId,
    {
      $set: {
        isActive: false,
        updatedBy:
          authUserId && isValidObjectId(authUserId)
            ? toObjectId(authUserId)
            : null,
      },
    },
    {
      new: true,
      runValidators: true,
    },
  ).select(ROLE_SELECT);

  if (!role) return sendNotFound(res);

  return res.json({
    success: true,
    message: 'نقش پروژه غیرفعال شد.',
    data: role,
  });
};
