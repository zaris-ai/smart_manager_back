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
  New recommended route.

  Telegram should call:
  /api/v1/telegram/webhook

  Secret is validated from:
  x-telegram-bot-api-secret-token
*/
router.post('/webhook', asyncHandler(telegramWebhook));

/*
  Backward-compatible old route.

  Keep this route so older webhook URLs and previous bot behavior do not break:
  /api/v1/telegram/webhook/:secret
*/
router.post('/webhook/:secret', asyncHandler(handleTelegramWebhook));

export default router;