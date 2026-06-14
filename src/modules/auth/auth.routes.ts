import express, { Request, Response } from 'express';
import { login, logout, me, refresh } from './auth.controller';
import { requireAuth } from './auth.middleware';
import { asyncHandler } from '@/shared/http/async-handler';

const router = express.Router();

type AsyncRouteHandler = (req: Request, res: Response) => Promise<void>;

const wrap = (handler: AsyncRouteHandler) => {
  return asyncHandler(handler);
};

router.post('/login', wrap(login as AsyncRouteHandler));
router.post('/refresh', wrap(refresh as AsyncRouteHandler));
router.post('/logout', wrap(logout as AsyncRouteHandler));
router.get('/me', requireAuth, wrap(me as AsyncRouteHandler));

export default router;