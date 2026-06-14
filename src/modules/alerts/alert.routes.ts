import { Router } from 'express';
import { requireAuth } from '@/modules/auth/auth.middleware';
import { asyncHandler } from '@/shared/http/async-handler';
import { sendDailyWorkAlertNow } from '@/modules/alerts/alert.controller';

const router = Router();

router.use(requireAuth);

router.post('/telegram/daily-work/send-now', asyncHandler(sendDailyWorkAlertNow));

export default router;