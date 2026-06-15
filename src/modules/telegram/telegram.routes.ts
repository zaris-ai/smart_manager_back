import { Router } from 'express';
import {
    getTelegramBotStatus,
    handleTelegramWebhook,
} from '@/modules/telegram/telegram-bot.controller';
import { requireAuth } from '@/modules/auth/auth.middleware';
import { asyncHandler } from '@/shared/http/async-handler';
import { telegramController } from './telegram.controller';

const router = Router();

router.get('/status', requireAuth, asyncHandler(getTelegramBotStatus));
router.post('/webhook/:secret', asyncHandler(handleTelegramWebhook));
router.post('/webhook', telegramController.webhook);

export default router;