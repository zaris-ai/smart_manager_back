import { Router } from 'express';
import {
    getTelegramBotStatus,
    handleTelegramWebhook,
} from '@/modules/telegram/telegram-bot.controller';
import { requireAuth } from '@/modules/auth/auth.middleware';
import { asyncHandler } from '@/shared/http/async-handler';

const router = Router();

router.get('/status', requireAuth, asyncHandler(getTelegramBotStatus));
router.post('/webhook/:secret', asyncHandler(handleTelegramWebhook));

export default router;