// src/modules/project-roles/project-role.routes.ts

import { NextFunction, RequestHandler, Response, Router } from 'express';
import { requireAuth } from '@/modules/auth/auth.middleware';
import {
  archiveProjectRole,
  createProjectRole,
  listProjectRoles,
  updateProjectRole,
} from './project-role.controller';

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

router.get('/', routeHandler(listProjectRoles));
router.post('/', routeHandler(createProjectRole));
router.patch('/:roleId', routeHandler(updateProjectRole));
router.delete('/:roleId', routeHandler(archiveProjectRole));

export default router;
