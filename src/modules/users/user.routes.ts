import express, { Request, Response } from 'express';
import {
  createUser,
  deleteUser,
  getCurrentUser,
  getUserById,
  listUsers,
  updateUser,
} from './user.controller';
import { requireAuth } from '@/modules/auth/auth.middleware';
import { asyncHandler } from '@/shared/http/async-handler';
import {
  requirePermission,
  requirePermissionOrSelf,
  UserPermission,
} from './user.permissions';

const router = express.Router();

type AsyncRouteHandler = (req: Request, res: Response) => Promise<void>;

const wrap = (handler: AsyncRouteHandler) => {
  return asyncHandler(handler);
};

router.get('/me', requireAuth, wrap(getCurrentUser as AsyncRouteHandler));

router.get(
  '/',
  requireAuth,
  requirePermission(UserPermission.USERS_READ),
  wrap(listUsers as AsyncRouteHandler),
);

router.post(
  '/',
  requireAuth,
  requirePermission(UserPermission.USERS_CREATE),
  wrap(createUser as AsyncRouteHandler),
);

router.get(
  '/:id',
  requireAuth,
  requirePermissionOrSelf(UserPermission.USERS_READ, 'id'),
  wrap(getUserById as AsyncRouteHandler),
);

router.patch(
  '/:id',
  requireAuth,
  requirePermissionOrSelf(UserPermission.USERS_UPDATE, 'id'),
  wrap(updateUser as AsyncRouteHandler),
);

router.delete(
  '/:id',
  requireAuth,
  requirePermission(UserPermission.USERS_DEACTIVATE),
  wrap(deleteUser as AsyncRouteHandler),
);

export default router;