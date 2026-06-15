import { Request, Response } from 'express';
import { telegramTaskBotService } from './telegram-task-bot.service';

export const telegramWebhook = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const configuredSecret = process.env.TELEGRAM_WEBHOOK_SECRET || '';
  const requestSecret =
    String(req.headers['x-telegram-bot-api-secret-token'] || '') ||
    String(req.query.secret || '');

  if (configuredSecret && requestSecret !== configuredSecret) {
    res.status(401).json({
      success: false,
      message: 'Invalid Telegram webhook secret.',
      code: 'INVALID_TELEGRAM_SECRET',
    });
    return;
  }

  try {
    await telegramTaskBotService.handleUpdate(req.body);

    res.status(200).json({
      success: true,
      message: 'Telegram update processed.',
    });
  } catch (error) {
    console.error('Telegram webhook error:', error);

    res.status(200).json({
      success: false,
      message: 'Telegram update received but processing failed.',
    });
  }
};