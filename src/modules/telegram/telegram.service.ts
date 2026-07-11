import { env } from '@/config/env';
import {
  TelegramFileResponsePayload,
  TelegramSendMessageOptions,
} from '@/modules/telegram/telegram.types';

const TELEGRAM_API_BASE_URL = 'https://api.telegram.org/bot';
const TELEGRAM_FILE_BASE_URL = 'https://api.telegram.org/file/bot';
const TELEGRAM_MESSAGE_LIMIT = 3900;

type TelegramApiResponse<T = unknown> = {
  ok: boolean;
  description?: string;
  result?: T;
};

export type TelegramBotIdentity = {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
  can_join_groups?: boolean;
  can_read_all_group_messages?: boolean;
  supports_inline_queries?: boolean;
};

export type TelegramWebhookInfo = {
  url: string;
  has_custom_certificate?: boolean;
  pending_update_count?: number;
  ip_address?: string;
  last_error_date?: number;
  last_error_message?: string;
  last_synchronization_error_date?: number;
  max_connections?: number;
  allowed_updates?: string[];
};

export const escapeTelegramHtml = (value: unknown): string => {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
};

const splitMessage = (message: string): string[] => {
  if (message.length <= TELEGRAM_MESSAGE_LIMIT) return [message];

  const parts: string[] = [];
  let remaining = message;

  while (remaining.length > TELEGRAM_MESSAGE_LIMIT) {
    const slice = remaining.slice(0, TELEGRAM_MESSAGE_LIMIT);
    const lastBreak = slice.lastIndexOf('\n');
    const cutAt = lastBreak > 1000 ? lastBreak : TELEGRAM_MESSAGE_LIMIT;

    parts.push(remaining.slice(0, cutAt));
    remaining = remaining.slice(cutAt).trimStart();
  }

  if (remaining) parts.push(remaining);

  return parts;
};

const assertTelegramToken = (): string => {
  if (!env.telegramBotToken) {
    throw new Error('Telegram is not configured. Set TELEGRAM_BOT_TOKEN.');
  }

  return env.telegramBotToken;
};

const telegramRequest = async <T>(
  method: string,
  payload?: Record<string, unknown>,
): Promise<T> => {
  const token = assertTelegramToken();

  const response = await fetch(`${TELEGRAM_API_BASE_URL}${token}/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });

  const result = (await response.json().catch(() => null)) as
    | TelegramApiResponse<T>
    | null;

  if (!response.ok || !result?.ok || result.result === undefined) {
    throw new Error(
      result?.description ||
        `Telegram ${method} failed with status ${response.status}`,
    );
  }

  return result.result;
};

export const isTelegramConfigured = (): boolean => {
  return Boolean(env.telegramBotToken && env.telegramChannelId);
};

export const isTelegramBotWebhookConfigured = (): boolean => {
  return Boolean(env.telegramBotToken && env.telegramWebhookSecret);
};

export const sendTelegramMessage = async (message: string): Promise<void> => {
  if (!isTelegramConfigured()) {
    throw new Error(
      'Telegram is not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNEL_ID.',
    );
  }

  await sendTelegramBotMessage(env.telegramChannelId, message, {
    parseMode: 'HTML',
    disableWebPagePreview: true,
  });
};

export const sendTelegramBotMessage = async (
  chatId: string | number,
  message: string,
  options: TelegramSendMessageOptions = {},
): Promise<void> => {
  const parts = splitMessage(message);

  for (const part of parts) {
    await telegramRequest('sendMessage', {
      chat_id: chatId,
      text: part,
      parse_mode: options.parseMode || 'HTML',
      disable_web_page_preview: options.disableWebPagePreview ?? true,
      ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
    });
  }
};

export const answerTelegramCallbackQuery = async (
  callbackQueryId: string,
  text?: string,
): Promise<void> => {
  await telegramRequest('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  });
};

export const getTelegramFile = async (
  fileId: string,
): Promise<TelegramFileResponsePayload> => {
  return telegramRequest<TelegramFileResponsePayload>('getFile', {
    file_id: fileId,
  });
};

export const downloadTelegramFile = async (
  filePath: string,
): Promise<Buffer> => {
  const token = assertTelegramToken();
  const response = await fetch(`${TELEGRAM_FILE_BASE_URL}${token}/${filePath}`);

  if (!response.ok) {
    throw new Error(
      `Telegram file download failed with status ${response.status}`,
    );
  }

  const arrayBuffer = await response.arrayBuffer();

  return Buffer.from(arrayBuffer);
};

export const getTelegramBotIdentity = async (): Promise<TelegramBotIdentity> => {
  return telegramRequest<TelegramBotIdentity>('getMe');
};

export const getTelegramWebhookInfo = async (): Promise<TelegramWebhookInfo> => {
  return telegramRequest<TelegramWebhookInfo>('getWebhookInfo');
};

export const setTelegramWebhook = async (input: {
  url: string;
  secretToken?: string;
  dropPendingUpdates?: boolean;
}): Promise<boolean> => {
  return telegramRequest<boolean>('setWebhook', {
    url: input.url,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: input.dropPendingUpdates ?? false,
    ...(input.secretToken ? { secret_token: input.secretToken } : {}),
  });
};

export const deleteTelegramWebhook = async (
  dropPendingUpdates = false,
): Promise<boolean> => {
  return telegramRequest<boolean>('deleteWebhook', {
    drop_pending_updates: dropPendingUpdates,
  });
};


export const setTelegramBotCommands = async (
  commands: Array<{ command: string; description: string }>,
): Promise<boolean> => {
  return telegramRequest<boolean>('setMyCommands', {
    commands,
    language_code: 'fa',
  });
};
