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

const router = express.Router();

type AsyncRouteHandler = (req: Request, res: Response) => Promise<void>;

const wrap = (handler: AsyncRouteHandler) => {
  return asyncHandler(handler);
};

router.get('/me', requireAuth, wrap(getCurrentUser as AsyncRouteHandler));
router.get('/', requireAuth, wrap(listUsers as AsyncRouteHandler));
router.post('/', requireAuth, wrap(createUser as AsyncRouteHandler));

router.get('/:id', requireAuth, wrap(getUserById as AsyncRouteHandler));
router.patch('/:id', requireAuth, wrap(updateUser as AsyncRouteHandler));
router.delete('/:id', requireAuth, wrap(deleteUser as AsyncRouteHandler));

export default router;