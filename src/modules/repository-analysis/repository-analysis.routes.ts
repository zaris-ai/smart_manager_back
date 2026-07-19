import { Router } from 'express';
import { requireAuth } from '@/modules/auth/auth.middleware';
import {
  requirePermission,
  UserPermission,
} from '@/modules/users/user.permissions';
import { asyncHandler } from '@/shared/http/async-handler';
import { repositoryExpectationsUpload } from './repository-expectations-upload.middleware';
import { validateRequest } from '@/shared/http/validate-request';
import {
  createRepositoryConnectionController,
  deleteRepositoryConnectionController,
  getRepositoryAnalysisRunController,
  getRepositoryConnectionController,
  listRepositoryAnalysisRunsController,
  listRepositoryConnectionsController,
  startRepositoryAnalysisController,
  updateRepositoryConnectionController,
} from './repository-analysis.controller';
import {
  analysisRunIdParamSchema,
  createRepositoryConnectionSchema,
  listRepositoryAnalysisRunsSchema,
  listRepositoryConnectionsSchema,
  repositoryIdParamSchema,
  startRepositoryAnalysisSchema,
  updateRepositoryConnectionSchema,
} from './repository-analysis.validation';

const router = Router();

router.use(requireAuth);

router.get(
  '/repositories',
  requirePermission(UserPermission.REPOSITORY_AUDITS_READ),
  validateRequest(listRepositoryConnectionsSchema),
  asyncHandler(listRepositoryConnectionsController),
);

router.post(
  '/repositories',
  requirePermission(UserPermission.REPOSITORY_AUDITS_MANAGE),
  validateRequest(createRepositoryConnectionSchema),
  asyncHandler(createRepositoryConnectionController),
);

router.get(
  '/repositories/:repositoryId',
  requirePermission(UserPermission.REPOSITORY_AUDITS_READ),
  validateRequest(repositoryIdParamSchema),
  asyncHandler(getRepositoryConnectionController),
);

router.patch(
  '/repositories/:repositoryId',
  requirePermission(UserPermission.REPOSITORY_AUDITS_MANAGE),
  validateRequest(updateRepositoryConnectionSchema),
  asyncHandler(updateRepositoryConnectionController),
);

router.delete(
  '/repositories/:repositoryId',
  requirePermission(UserPermission.REPOSITORY_AUDITS_MANAGE),
  validateRequest(repositoryIdParamSchema),
  asyncHandler(deleteRepositoryConnectionController),
);

router.post(
  '/repositories/:repositoryId/analyze',
  requirePermission(UserPermission.REPOSITORY_AUDITS_MANAGE),
  repositoryExpectationsUpload.single('expectationsFile'),
  validateRequest(startRepositoryAnalysisSchema),
  asyncHandler(startRepositoryAnalysisController),
);

router.get(
  '/runs',
  requirePermission(UserPermission.REPOSITORY_AUDITS_READ),
  validateRequest(listRepositoryAnalysisRunsSchema),
  asyncHandler(listRepositoryAnalysisRunsController),
);

router.get(
  '/runs/:runId',
  requirePermission(UserPermission.REPOSITORY_AUDITS_READ),
  validateRequest(analysisRunIdParamSchema),
  asyncHandler(getRepositoryAnalysisRunController),
);

export default router;
