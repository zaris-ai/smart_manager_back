import { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import User, { UserRole, UserStatus } from './user.model';

export enum UserPermission {
  USERS_READ = 'users.read',
  USERS_CREATE = 'users.create',
  USERS_UPDATE = 'users.update',
  USERS_DEACTIVATE = 'users.deactivate',
  USERS_DELETE = 'users.delete',

  ROLES_MANAGE = 'roles.manage',

  PROJECTS_READ = 'projects.read',
  PROJECTS_CREATE = 'projects.create',
  PROJECTS_UPDATE = 'projects.update',
  PROJECTS_MANAGE = 'projects.manage',


  REPORTS_READ = 'reports.read',
  REPORTS_CREATE = 'reports.create',
  REPORTS_REVIEW = 'reports.review',

  CONTRACTS_READ = 'contracts.read',
  CONTRACTS_CREATE = 'contracts.create',
  CONTRACTS_UPDATE = 'contracts.update',
  CONTRACTS_MANAGE = 'contracts.manage',

  EVIDENCE_READ = 'evidence.read',
  EVIDENCE_CREATE = 'evidence.create',
  EVIDENCE_REVIEW = 'evidence.review',

  RISKS_READ = 'risks.read',
  RISKS_CREATE = 'risks.create',
  RISKS_UPDATE = 'risks.update',
  RISKS_MANAGE = 'risks.manage',

  DECISIONS_READ = 'decisions.read',
  DECISIONS_APPROVE = 'decisions.approve',

  ADMIN_OVERVIEW = 'admin.overview',
}

export const ROLE_ACCESS_LEVEL: Record<UserRole, number> = {
  [UserRole.BOARD]: 100,
  [UserRole.MANAGER]: 70,
  [UserRole.EXPERT]: 10,
};

export const ACCESS_LEVEL_LABELS = [
  {
    value: 100,
    role: UserRole.BOARD,
    label: 'هیئت مدیره',
    description: 'دسترسی راهبردی و نظارتی؛ فقط مشاهده، بدون ثبت یا تغییر داده.',
  },
  {
    value: 70,
    role: UserRole.MANAGER,
    label: 'مدیر',
    description: 'دسترسی مدیریتی و اجرایی؛ امکان ایجاد، ویرایش، بررسی و مدیریت.',
  },
  {
    value: 10,
    role: UserRole.EXPERT,
    label: 'کارشناس',
    description: 'دسترسی اجرایی محدود؛ ثبت گزارش، شواهد و پیگیری وظایف خود.',
  },
];

export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, UserPermission[]> = {
  [UserRole.BOARD]: [
    UserPermission.USERS_READ,
    UserPermission.PROJECTS_READ,
    UserPermission.REPORTS_READ,
    UserPermission.CONTRACTS_READ,
    UserPermission.EVIDENCE_READ,
    UserPermission.RISKS_READ,
    UserPermission.DECISIONS_READ,
    UserPermission.ADMIN_OVERVIEW,
  ],

  [UserRole.MANAGER]: [
    UserPermission.USERS_READ,
    UserPermission.USERS_CREATE,
    UserPermission.USERS_UPDATE,
    UserPermission.USERS_DEACTIVATE,
    UserPermission.ROLES_MANAGE,

    UserPermission.PROJECTS_READ,
    UserPermission.PROJECTS_CREATE,
    UserPermission.PROJECTS_UPDATE,
    UserPermission.PROJECTS_MANAGE,


    UserPermission.REPORTS_READ,
    UserPermission.REPORTS_CREATE,
    UserPermission.REPORTS_REVIEW,

    UserPermission.CONTRACTS_READ,
    UserPermission.CONTRACTS_CREATE,
    UserPermission.CONTRACTS_UPDATE,
    UserPermission.CONTRACTS_MANAGE,

    UserPermission.EVIDENCE_READ,
    UserPermission.EVIDENCE_CREATE,
    UserPermission.EVIDENCE_REVIEW,

    UserPermission.RISKS_READ,
    UserPermission.RISKS_CREATE,
    UserPermission.RISKS_UPDATE,
    UserPermission.RISKS_MANAGE,

    UserPermission.DECISIONS_READ,
    UserPermission.DECISIONS_APPROVE,

    UserPermission.ADMIN_OVERVIEW,
  ],

  [UserRole.EXPERT]: [
    UserPermission.PROJECTS_READ,
    UserPermission.REPORTS_CREATE,
    UserPermission.EVIDENCE_CREATE,
    UserPermission.RISKS_READ,
    UserPermission.RISKS_CREATE,
  ],
};

export type AuthenticatedUserRequest = Request & {
  user?: {
    id?: string;
    _id?: string;
    userId?: string;
    role?: string;
  };
  authUser?: {
    id: string;
    role: UserRole;
    status: UserStatus;
    isActive: boolean;
  };
};

export const normalizeRoleValue = (value: unknown): UserRole | null => {
  if (!value || typeof value !== 'string') return null;

  const normalized = value.trim().toLowerCase().replace(/-/g, '_');

  if (normalized === 'board') return UserRole.BOARD;
  if (normalized === 'manager') return UserRole.MANAGER;
  if (normalized === 'expert') return UserRole.EXPERT;

  /**
   * Backward compatibility.
   * Previous system used employee/admin-like values.
   */
  if (normalized === 'employee') return UserRole.EXPERT;
  if (normalized === 'admin') return UserRole.MANAGER;
  if (normalized === 'super_admin') return UserRole.MANAGER;
  if (normalized === 'project_owner') return UserRole.MANAGER;
  if (normalized === 'specialty_owner') return UserRole.MANAGER;

  return null;
};

export const getRolePermissions = (role: UserRole): UserPermission[] => {
  return DEFAULT_ROLE_PERMISSIONS[role] || [];
};

export const roleHasPermission = (
  role: UserRole,
  permission: UserPermission,
): boolean => {
  return getRolePermissions(role).includes(permission);
};

export const roleHasAnyPermission = (
  role: UserRole,
  permissions: UserPermission[],
): boolean => {
  return permissions.some((permission) => roleHasPermission(role, permission));
};

const getAuthUserId = (req: AuthenticatedUserRequest): string => {
  return String(req.user?.id || req.user?._id || req.user?.userId || '');
};

const sendUnauthorized = (res: Response): void => {
  res.status(401).json({
    success: false,
    message: 'برای دسترسی به این بخش باید وارد سامانه شوید.',
    code: 'UNAUTHORIZED',
  });
};

const sendForbidden = (res: Response): void => {
  res.status(403).json({
    success: false,
    message: 'شما دسترسی لازم برای این عملیات را ندارید.',
    code: 'FORBIDDEN',
  });
};

const loadAuthenticatedUser = async (
  req: AuthenticatedUserRequest,
  res: Response,
): Promise<boolean> => {
  if (req.authUser) return true;

  const authUserId = getAuthUserId(req);

  if (!authUserId || !mongoose.Types.ObjectId.isValid(authUserId)) {
    sendUnauthorized(res);
    return false;
  }

  const user = await User.findById(authUserId).select('role status isActive');

  if (!user || !user.isActive || user.status !== UserStatus.ACTIVE) {
    sendUnauthorized(res);
    return false;
  }

  const normalizedRole = normalizeRoleValue(user.role) || UserRole.EXPERT;

  req.authUser = {
    id: user._id.toString(),
    role: normalizedRole,
    status: user.status,
    isActive: user.isActive,
  };

  return true;
};

export const requirePermission = (...permissions: UserPermission[]) => {
  return async (
    req: AuthenticatedUserRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const loaded = await loadAuthenticatedUser(req, res);

      if (!loaded) return;

      if (!roleHasAnyPermission(req.authUser!.role, permissions)) {
        sendForbidden(res);
        return;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

export const requirePermissionOrSelf = (
  permission: UserPermission,
  paramName = 'id',
) => {
  return async (
    req: AuthenticatedUserRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const loaded = await loadAuthenticatedUser(req, res);

      if (!loaded) return;

      const targetId = String(req.params[paramName] || '');

      if (targetId && targetId === req.authUser!.id) {
        next();
        return;
      }

      if (!roleHasPermission(req.authUser!.role, permission)) {
        sendForbidden(res);
        return;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};