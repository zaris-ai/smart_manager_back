import { Router } from 'express';
import { asyncHandler } from '@/shared/http/async-handler';
import {
  createUsersProjectsFixtures,
  previewUsersProjectsFixtures,
} from '@/modules/fixtures/fixture.controller';

const router = Router();

router.get('/users-projects', asyncHandler(previewUsersProjectsFixtures));
router.post('/users-projects', asyncHandler(createUsersProjectsFixtures));

export default router;
