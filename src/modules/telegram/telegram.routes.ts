import { Router } from 'express';
import {
    getTelegramBotStatus,
    handleTelegramWebhook,
} from '@/modules/telegram/telegram-bot.controller';
import { requireAuth } from '@/modules/auth/auth.middleware';
import { asyncHandler } from '@/shared/http/async-handler';
import { telegramWebhook } from './telegram.controller';

const router = Router();

router.get('/status', requireAuth, asyncHandler(getTelegramBotStatus));

/*
  New webhook route used by Telegram setWebhook.
  Secret is validated from x-telegram-bot-api-secret-token.
*/
router.post('/webhook', asyncHandler(telegramWebhook));

/*
  Backward-compatible old route.
  Keep this so previous webhook URL and old bot features remain available.
*/
router.post('/webhook/:secret', asyncHandler(handleTelegramWebhook));

export default router;