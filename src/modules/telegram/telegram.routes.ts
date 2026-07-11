import { Router } from 'express';
import {
  getTelegramBotStatus,
  handleTelegramWebhook,
} from '@/modules/telegram/telegram-bot.controller';
import { requireAuth } from '@/modules/auth/auth.middleware';
import { asyncHandler } from '@/shared/http/async-handler';
import { telegramWebhook } from './telegram.controller';
import {
  configureTelegramWebhook,
  createTelegramLinkCode,
  getTelegramOverview,
  listTelegramUsers,
  removeTelegramWebhook,
  requireTelegramManager,
  sendTelegramTest,
  unlinkTelegramUser,
} from './telegram-admin.controller';

const router = Router();

router.get('/status', requireAuth, asyncHandler(getTelegramBotStatus));
router.get(
  '/overview',
  requireAuth,
  requireTelegramManager,
  asyncHandler(getTelegramOverview),
);
router.get(
  '/users',
  requireAuth,
  requireTelegramManager,
  asyncHandler(listTelegramUsers),
);
router.post(
  '/webhook/configure',
  requireAuth,
  requireTelegramManager,
  asyncHandler(configureTelegramWebhook),
);
router.delete(
  '/webhook/configure',
  requireAuth,
  requireTelegramManager,
  asyncHandler(removeTelegramWebhook),
);
router.post(
  '/test-message',
  requireAuth,
  requireTelegramManager,
  asyncHandler(sendTelegramTest),
);
router.post(
  '/users/:userId/link-code',
  requireAuth,
  requireTelegramManager,
  asyncHandler(createTelegramLinkCode),
);

router.delete(
  '/users/:userId/link',
  requireAuth,
  requireTelegramManager,
  asyncHandler(unlinkTelegramUser),
);

/*
  Primary webhook route used by Telegram setWebhook.
  The secret is validated from x-telegram-bot-api-secret-token.
*/
router.post('/webhook', asyncHandler(telegramWebhook));

/* Backward-compatible webhook route. */
router.post('/webhook/:secret', asyncHandler(handleTelegramWebhook));

export default router;
