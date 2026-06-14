import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import mongoose, { Types } from 'mongoose';
import User, {
  UserDocument,
  UserRole,
  USER_ROLE_LABELS,
  UserStatus,
  USER_STATUS_LABELS,
} from './user.model';

type AuthRequest = Request & {
  user?: {
    id?: string;
    _id?: string;
    userId?: string;
    role?: string;
  };
};

const SAFE_USER_SELECT =
  'firstName lastName fullName username email phone role roleLabel status statusLabel isActive profile managerId language direction lastLoginAt createdAt updatedAt createdBy updatedBy';

const getAuthUserId = (req: AuthRequest): string => {
  return String(req.user?.id || req.user?._id || req.user?.userId || '');
};

const getAppRole = (req: AuthRequest): UserRole => {
  const role = String(req.user?.role || '').toLowerCase();

  if (role === 'manager' || role === 'admin') return UserRole.MANAGER;

  return UserRole.EMPLOYEE;
};

const isManager = (req: AuthRequest): boolean => {
  return getAppRole(req) === UserRole.MANAGER;
};

const isValidObjectId = (value?: string): boolean => {
  return Boolean(value && mongoose.Types.ObjectId.isValid(value));
};

const toObjectId = (value: string): Types.ObjectId => {
  return new mongoose.Types.ObjectId(value);
};

const sendValidationError = (
  res: Response,
  message: string,
  details?: unknown,
): void => {
  res.status(400).json({
    success: false,
    message,
    code: 'VALIDATION_ERROR',
    details,
  });
};

const sendForbidden = (res: Response): void => {
  res.status(403).json({
    success: false,
    message: 'شما دسترسی لازم برای این عملیات را ندارید.',
    code: 'FORBIDDEN',
  });
};

const sendNotFound = (res: Response, message = 'کاربر پیدا نشد.'): void => {
  res.status(404).json({
    success: false,
    message,
    code: 'NOT_FOUND',
  });
};

const sendSuccess = <T>(
  res: Response,
  data: T,
  message = 'عملیات با موفقیت انجام شد.',
  statusCode = 200,
  extra?: Record<string, unknown>,
): void => {
  res.status(statusCode).json({
    success: true,
    message,
    data,
    ...(extra || {}),
  });
};

const normalizeRole = (value: unknown): UserRole | null => {
  if (!value || typeof value !== 'string') return null;

  const normalized = value.trim().toLowerCase();

  if (normalized === UserRole.MANAGER) return UserRole.MANAGER;
  if (normalized === UserRole.EMPLOYEE) return UserRole.EMPLOYEE;

  /**
   * Legacy compatibility only.
   * Old admin becomes manager.
   */
  if (normalized === 'admin') return UserRole.MANAGER;

  return null;
};

const normalizeStatus = (value: unknown): UserStatus | null => {
  if (!value || typeof value !== 'string') return null;

  const normalized = value.trim().toLowerCase();

  if (normalized === UserStatus.ACTIVE) return UserStatus.ACTIVE;
  if (normalized === UserStatus.INACTIVE) return UserStatus.INACTIVE;
  if (normalized === UserStatus.SUSPENDED) return UserStatus.SUSPENDED;

  return null;
};

const normalizeProfile = (value: unknown) => {
  const profile =
    value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

  return {
    jobTitle: typeof profile.jobTitle === 'string' ? profile.jobTitle.trim() : '',
    domain: typeof profile.domain === 'string' ? profile.domain.trim() : '',
    specialtyChapter:
      typeof profile.specialtyChapter === 'string'
        ? profile.specialtyChapter.trim()
        : '',
    responsibilityScope:
      typeof profile.responsibilityScope === 'string'
        ? profile.responsibilityScope.trim()
        : '',
    bio: typeof profile.bio === 'string' ? profile.bio.trim() : '',
  };
};

const toSafeUser = (user: UserDocument | null) => {
  if (!user) return null;

  const raw = user.toObject();

  delete raw.passwordHash;

  return {
    id: raw._id?.toString(),
    ...raw,
  };
};

const validateManagerId = (managerId: unknown): Types.ObjectId | null => {
  if (!managerId || managerId === '') return null;

  if (typeof managerId !== 'string' || !isValidObjectId(managerId)) {
    throw new Error('شناسه مدیر معتبر نیست.');
  }

  return toObjectId(managerId);
};

export const listUsers = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  const {
    page = '1',
    limit = '20',
    search,
    role,
    status,
    isActive,
    managerId,
  } = req.query;

  const authUserId = getAuthUserId(req);

  if (!isManager(req)) {
    if (!isValidObjectId(authUserId)) {
      sendForbidden(res);
      return;
    }

    const currentUser = await User.findById(authUserId).select(SAFE_USER_SELECT);

    sendSuccess(
      res,
      currentUser ? [toSafeUser(currentUser)] : [],
      'اطلاعات کاربر جاری دریافت شد.',
      200,
      {
        pagination: {
          total: currentUser ? 1 : 0,
          page: 1,
          limit: 1,
          totalPages: currentUser ? 1 : 0,
        },
      },
    );
    return;
  }

  const pageNumber = Math.max(Number(page) || 1, 1);
  const limitNumber = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const skip = (pageNumber - 1) * limitNumber;

  const filter: Record<string, unknown> = {};

  if (typeof search === 'string' && search.trim()) {
    filter.$or = [
      { firstName: { $regex: search.trim(), $options: 'i' } },
      { lastName: { $regex: search.trim(), $options: 'i' } },
      { fullName: { $regex: search.trim(), $options: 'i' } },
      { username: { $regex: search.trim(), $options: 'i' } },
      { email: { $regex: search.trim(), $options: 'i' } },
      { phone: { $regex: search.trim(), $options: 'i' } },
    ];
  }

  if (typeof role === 'string' && role.trim()) {
    const normalizedRole = normalizeRole(role);

    if (!normalizedRole) {
      sendValidationError(res, 'نقش کاربر معتبر نیست.');
      return;
    }

    filter.role = normalizedRole;
  }

  if (typeof status === 'string' && status.trim()) {
    const normalizedStatus = normalizeStatus(status);

    if (!normalizedStatus) {
      sendValidationError(res, 'وضعیت کاربر معتبر نیست.');
      return;
    }

    filter.status = normalizedStatus;
  }

  if (typeof isActive === 'string' && isActive.trim()) {
    filter.isActive = isActive === 'true';
  }

  if (typeof managerId === 'string' && managerId.trim()) {
    if (!isValidObjectId(managerId)) {
      sendValidationError(res, 'شناسه مدیر معتبر نیست.');
      return;
    }

    filter.managerId = toObjectId(managerId);
  }

  const [items, total] = await Promise.all([
    User.find(filter)
      .select(SAFE_USER_SELECT)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNumber),
    User.countDocuments(filter),
  ]);

  res.json({
    success: true,
    message: 'فهرست کاربران با موفقیت دریافت شد.',
    data: items.map(toSafeUser),
    pagination: {
      total,
      page: pageNumber,
      limit: limitNumber,
      totalPages: Math.ceil(total / limitNumber),
    },
  });
};

export const getUserById = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  const { id } = req.params;
  const authUserId = getAuthUserId(req);

  if (!isValidObjectId(id)) {
    sendValidationError(res, 'شناسه کاربر معتبر نیست.');
    return;
  }

  if (!isManager(req) && id !== authUserId) {
    sendForbidden(res);
    return;
  }

  const user = await User.findById(id).select(SAFE_USER_SELECT);

  if (!user) {
    sendNotFound(res);
    return;
  }

  sendSuccess(res, toSafeUser(user), 'اطلاعات کاربر با موفقیت دریافت شد.');
};

export const getCurrentUser = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  const authUserId = getAuthUserId(req);

  if (!isValidObjectId(authUserId)) {
    sendForbidden(res);
    return;
  }

  const user = await User.findById(authUserId).select(SAFE_USER_SELECT);

  if (!user) {
    sendNotFound(res);
    return;
  }

  sendSuccess(res, toSafeUser(user), 'اطلاعات کاربر جاری دریافت شد.');
};

export const createUser = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  if (!isManager(req)) {
    sendForbidden(res);
    return;
  }

  const authUserId = getAuthUserId(req);

  if (!isValidObjectId(authUserId)) {
    sendValidationError(res, 'شناسه کاربر جاری معتبر نیست.');
    return;
  }

  const {
    firstName,
    lastName,
    username,
    email,
    phone,
    password,
    role,
    status,
    profile,
    managerId,
    telegramUserId,
    telegramChatId,
    telegramUsername,
  } = req.body;

  if (!firstName || typeof firstName !== 'string') {
    sendValidationError(res, 'نام الزامی است.');
    return;
  }

  if (!lastName || typeof lastName !== 'string') {
    sendValidationError(res, 'نام خانوادگی الزامی است.');
    return;
  }

  if (!username || typeof username !== 'string') {
    sendValidationError(res, 'نام کاربری الزامی است.');
    return;
  }

  if (!email || typeof email !== 'string') {
    sendValidationError(res, 'ایمیل الزامی است.');
    return;
  }

  if (!password || typeof password !== 'string' || password.length < 8) {
    sendValidationError(res, 'رمز عبور باید حداقل ۸ کاراکتر باشد.');
    return;
  }

  const normalizedRole = normalizeRole(role) || UserRole.EMPLOYEE;
  const normalizedStatus = normalizeStatus(status) || UserStatus.ACTIVE;

  let normalizedManagerId: Types.ObjectId | null = null;

  try {
    normalizedManagerId =
      normalizedRole === UserRole.EMPLOYEE ? validateManagerId(managerId) : null;
  } catch (error) {
    sendValidationError(
      res,
      error instanceof Error ? error.message : 'شناسه مدیر معتبر نیست.',
    );
    return;
  }

  const duplicateUser = await User.findOne({
    $or: [
      { username: username.trim().toLowerCase() },
      { email: email.trim().toLowerCase() },
    ],
  });

  if (duplicateUser) {
    sendValidationError(res, 'نام کاربری یا ایمیل قبلاً ثبت شده است.');
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await User.create({
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    fullName: `${firstName} ${lastName}`.trim(),
    username: username.trim().toLowerCase(),
    email: email.trim().toLowerCase(),
    phone: typeof phone === 'string' ? phone.trim() : '',
    passwordHash,
    role: normalizedRole,
    roleLabel: USER_ROLE_LABELS[normalizedRole],
    status: normalizedStatus,
    statusLabel: USER_STATUS_LABELS[normalizedStatus],
    isActive: normalizedStatus === UserStatus.ACTIVE,
    profile: normalizeProfile(profile),
    managerId: normalizedManagerId,
    language: 'fa',
    direction: 'rtl',
    telegramUserId:
      typeof telegramUserId === 'string' ? telegramUserId.trim() : '',
    telegramChatId:
      typeof telegramChatId === 'string' ? telegramChatId.trim() : '',
    telegramUsername:
      typeof telegramUsername === 'string'
        ? telegramUsername.trim().replace(/^@/, '').toLowerCase()
        : '',
    createdBy: toObjectId(authUserId),
    updatedBy: toObjectId(authUserId),
  });

  const createdUser = await User.findById(user._id).select(SAFE_USER_SELECT);

  sendSuccess(res, toSafeUser(createdUser), 'کاربر با موفقیت ایجاد شد.', 201);
};

export const updateUser = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  const { id } = req.params;
  const authUserId = getAuthUserId(req);

  if (!isValidObjectId(id)) {
    sendValidationError(res, 'شناسه کاربر معتبر نیست.');
    return;
  }

  if (!isValidObjectId(authUserId)) {
    sendValidationError(res, 'شناسه کاربر جاری معتبر نیست.');
    return;
  }

  const isSelfUpdate = id === authUserId;

  if (!isManager(req) && !isSelfUpdate) {
    sendForbidden(res);
    return;
  }

  const existingUser = await User.findById(id);

  if (!existingUser) {
    sendNotFound(res);
    return;
  }

  const update: Record<string, unknown> = {
    updatedBy: toObjectId(authUserId),
  };

  if ('firstName' in req.body) {
    if (!req.body.firstName || typeof req.body.firstName !== 'string') {
      sendValidationError(res, 'نام معتبر نیست.');
      return;
    }

    update.firstName = req.body.firstName.trim();
  }

  if ('lastName' in req.body) {
    if (!req.body.lastName || typeof req.body.lastName !== 'string') {
      sendValidationError(res, 'نام خانوادگی معتبر نیست.');
      return;
    }

    update.lastName = req.body.lastName.trim();
  }

  if ('phone' in req.body) {
    update.phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : '';
  }

  if ('profile' in req.body) {
    update.profile = normalizeProfile(req.body.profile);
  }

  if (isManager(req)) {
    if ('username' in req.body) {
      if (!req.body.username || typeof req.body.username !== 'string') {
        sendValidationError(res, 'نام کاربری معتبر نیست.');
        return;
      }

      update.username = req.body.username.trim().toLowerCase();
    }

    if ('email' in req.body) {
      if (!req.body.email || typeof req.body.email !== 'string') {
        sendValidationError(res, 'ایمیل معتبر نیست.');
        return;
      }

      update.email = req.body.email.trim().toLowerCase();
    }

    if ('role' in req.body) {
      const normalizedRole = normalizeRole(req.body.role);

      if (!normalizedRole) {
        sendValidationError(res, 'نقش کاربر معتبر نیست.');
        return;
      }

      update.role = normalizedRole;
      update.roleLabel = USER_ROLE_LABELS[normalizedRole];

      if (normalizedRole === UserRole.MANAGER) {
        update.managerId = null;
      }
    }

    if ('status' in req.body) {
      const normalizedStatus = normalizeStatus(req.body.status);

      if (!normalizedStatus) {
        sendValidationError(res, 'وضعیت کاربر معتبر نیست.');
        return;
      }

      update.status = normalizedStatus;
      update.statusLabel = USER_STATUS_LABELS[normalizedStatus];
      update.isActive = normalizedStatus === UserStatus.ACTIVE;
    }

    if ('managerId' in req.body) {
      try {
        const targetRole =
          update.role === UserRole.MANAGER
            ? UserRole.MANAGER
            : update.role === UserRole.EMPLOYEE
              ? UserRole.EMPLOYEE
              : existingUser.role;

        update.managerId =
          targetRole === UserRole.MANAGER
            ? null
            : validateManagerId(req.body.managerId);
      } catch (error) {
        sendValidationError(
          res,
          error instanceof Error ? error.message : 'شناسه مدیر معتبر نیست.',
        );
        return;
      }
    }

    if ('password' in req.body && req.body.password) {
      if (typeof req.body.password !== 'string' || req.body.password.length < 8) {
        sendValidationError(res, 'رمز عبور باید حداقل ۸ کاراکتر باشد.');
        return;
      }

      update.passwordHash = await bcrypt.hash(req.body.password, 12);
    }
  }

  if ('firstName' in update || 'lastName' in update) {
    const firstName =
      typeof update.firstName === 'string' ? update.firstName : existingUser.firstName;

    const lastName =
      typeof update.lastName === 'string' ? update.lastName : existingUser.lastName;

    update.fullName = `${firstName} ${lastName}`.trim();
  }

  if (update.username || update.email) {
    const duplicateFilters = [];

    if (update.username) {
      duplicateFilters.push({ username: update.username });
    }

    if (update.email) {
      duplicateFilters.push({ email: update.email });
    }

    if (duplicateFilters.length > 0) {
      const duplicateUser = await User.findOne({
        _id: { $ne: id },
        $or: duplicateFilters,
      });

      if (duplicateUser) {
        sendValidationError(res, 'نام کاربری یا ایمیل قبلاً ثبت شده است.');
        return;
      }
    }
  }

  if (isManager(req) && 'telegramUserId' in req.body) {
    update.telegramUserId =
      typeof req.body.telegramUserId === 'string'
        ? req.body.telegramUserId.trim()
        : '';
  }

  if (isManager(req) && 'telegramChatId' in req.body) {
    update.telegramChatId =
      typeof req.body.telegramChatId === 'string'
        ? req.body.telegramChatId.trim()
        : '';
  }

  if (isManager(req) && 'telegramUsername' in req.body) {
    update.telegramUsername =
      typeof req.body.telegramUsername === 'string'
        ? req.body.telegramUsername.trim().replace(/^@/, '').toLowerCase()
        : '';
  }

  const updatedUser = await User.findByIdAndUpdate(id, update, {
    new: true,
    runValidators: true,
  }).select(SAFE_USER_SELECT);

  sendSuccess(res, toSafeUser(updatedUser), 'کاربر با موفقیت ویرایش شد.');
};

export const deleteUser = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  if (!isManager(req)) {
    sendForbidden(res);
    return;
  }

  const { id } = req.params;
  const authUserId = getAuthUserId(req);

  if (!isValidObjectId(id)) {
    sendValidationError(res, 'شناسه کاربر معتبر نیست.');
    return;
  }

  if (id === authUserId) {
    sendValidationError(res, 'مدیر نمی‌تواند حساب خودش را حذف کند.');
    return;
  }

  const user = await User.findByIdAndUpdate(
    id,
    {
      status: UserStatus.INACTIVE,
      statusLabel: USER_STATUS_LABELS[UserStatus.INACTIVE],
      isActive: false,
      updatedBy: isValidObjectId(authUserId) ? toObjectId(authUserId) : null,
    },
    {
      new: true,
      runValidators: true,
    },
  ).select(SAFE_USER_SELECT);

  if (!user) {
    sendNotFound(res);
    return;
  }

  sendSuccess(res, toSafeUser(user), 'کاربر با موفقیت غیرفعال شد.');
};