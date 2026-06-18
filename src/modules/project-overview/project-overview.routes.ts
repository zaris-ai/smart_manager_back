// src/modules/project-overview/project-overview.routes.ts

import { NextFunction, RequestHandler, Response, Router } from 'express';
import { requireAuth } from '@/modules/auth/auth.middleware';
import { getProjectOverview } from './project-overview.controller';

type RouteController = (
  req: any,
  res: Response,
  next?: NextFunction,
) => Promise<unknown> | unknown;

const routeHandler = (controller: RouteController): RequestHandler => {
  return async (req, res, next): Promise<void> => {
    try {
      await controller(req, res, next);
    } catch (error) {
      next(error);
    }
  };
};

const router = Router();

router.use(requireAuth);
router.get('/', routeHandler(getProjectOverview));

export default router;