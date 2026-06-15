import { Request, Response } from 'express';
import TelegramTaskSession from './telegram-task-session.model';
import { telegramTaskBotService } from './telegram-task-bot.service';
import { handleTelegramWebhook as handlePreviousTelegramWebhook } from './telegram-bot.controller';

type TelegramMessage = {
    text?: string;
    chat?: {
        id?: number | string;
    };
    voice?: unknown;
    audio?: unknown;
    document?: unknown;
    video?: unknown;
    photo?: unknown[];
};

type TelegramCallbackQuery = {
    data?: string;
    message?: TelegramMessage;
};

type TelegramUpdate = {
    message?: TelegramMessage;
    callback_query?: TelegramCallbackQuery;
};

const TASK_TEXT_COMMANDS = new Set([
    '/task',
    '/newtask',
    'ثبت وظیفه',
    'تعریف وظیفه',
    'ثبت وظیفه برای مدیران',

    '/tasks',
    '/mytasks',
    'وظایف باز من',
    'وظایف من',
    'کارهای باز من',
]);

const getChatIdFromUpdate = (update: TelegramUpdate): string => {
    const chatId =
        update.message?.chat?.id || update.callback_query?.message?.chat?.id;

    return chatId ? String(chatId) : '';
};

const getTextFromUpdate = (update: TelegramUpdate): string => {
    return String(update.message?.text || '').trim();
};

const getCallbackDataFromUpdate = (update: TelegramUpdate): string => {
    return String(update.callback_query?.data || '').trim();
};

const messageHasAttachment = (message?: TelegramMessage): boolean => {
    return Boolean(
        message?.voice ||
            message?.audio ||
            message?.document ||
            message?.video ||
            message?.photo?.length,
    );
};

const hasActiveTaskSession = async (chatId: string): Promise<boolean> => {
    if (!chatId) return false;

    const session = await TelegramTaskSession.exists({
        chatId,
    } as any);

    return Boolean(session);
};

const isTaskUpdate = async (update: TelegramUpdate): Promise<boolean> => {
    const text = getTextFromUpdate(update);
    const callbackData = getCallbackDataFromUpdate(update);
    const chatId = getChatIdFromUpdate(update);

    if (TASK_TEXT_COMMANDS.has(text)) {
        return true;
    }

    if (callbackData.startsWith('task:')) {
        return true;
    }

    if (messageHasAttachment(update.message)) {
        return hasActiveTaskSession(chatId);
    }

    return hasActiveTaskSession(chatId);
};

const getRequestSecret = (req: Request): string => {
    return (
        String(req.headers['x-telegram-bot-api-secret-token'] || '') ||
        String(req.query.secret || '') ||
        String(req.params.secret || '')
    );
};

export const telegramWebhook = async (
    req: Request,
    res: Response,
): Promise<void> => {
    const configuredSecret = process.env.TELEGRAM_WEBHOOK_SECRET || '';
    const requestSecret = getRequestSecret(req);

    if (configuredSecret && requestSecret !== configuredSecret) {
        res.status(401).json({
            success: false,
            message: 'Invalid Telegram webhook secret.',
            code: 'INVALID_TELEGRAM_SECRET',
        });
        return;
    }

    const update = req.body as TelegramUpdate;

    try {
        const shouldUseTaskBot = await isTaskUpdate(update);

        if (shouldUseTaskBot) {
            await telegramTaskBotService.handleUpdate(req.body);

            res.status(200).json({
                success: true,
                message: 'Telegram task update processed.',
            });
            return;
        }

        /*
          Preserve previous bot features.

          The old controller expects req.params.secret because the old route was:
          /telegram/webhook/:secret

          The new Telegram webhook uses x-telegram-bot-api-secret-token.
          We inject the configured secret before delegating to the old handler.
        */
        (req.params as any).secret = configuredSecret;

        await handlePreviousTelegramWebhook(req, res);
    } catch (error) {
        console.error('Telegram webhook bridge error:', error);

        if (!res.headersSent) {
            res.status(200).json({
                success: false,
                message: 'Telegram update received but processing failed.',
            });
        }
    }
};