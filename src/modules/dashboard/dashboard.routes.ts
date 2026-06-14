import { Router } from 'express';
import { requireAuth } from '@/modules/auth/auth.middleware';
import { asyncHandler } from '@/shared/http/async-handler';
import { getDashboardSummary } from '@/modules/dashboard/dashboard.controller';

const router = Router();

router.use(requireAuth);

router.get('/summary', asyncHandler(getDashboardSummary));

export default router;