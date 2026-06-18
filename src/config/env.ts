// test
import dotenv from 'dotenv';

dotenv.config();

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

function optionalBooleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];

  if (!value) {
    return fallback;
  }

  return value === 'true';
}

function optionalNumberEnv(name: string, fallback: number): number {
  const value = process.env[name];

  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be a valid number.`);
  }

  return parsed;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: optionalNumberEnv('PORT', 4000),

  mongoUri: requiredEnv('MONGO_URI'),
  mongoDbName: requiredEnv('MONGO_DB_NAME'),

  jwtAccessSecret: requiredEnv('JWT_ACCESS_SECRET'),
  jwtRefreshSecret: requiredEnv('JWT_REFRESH_SECRET'),
  jwtAccessExpiresIn: optionalEnv('JWT_ACCESS_EXPIRES_IN', '15m'),
  jwtRefreshExpiresIn: optionalEnv('JWT_REFRESH_EXPIRES_IN', '7d'),

  defaultAdminEnabled: optionalBooleanEnv('DEFAULT_ADMIN_ENABLED', true),
  defaultAdminUsername: optionalEnv('DEFAULT_ADMIN_USERNAME', 'admin'),
  defaultAdminEmail: optionalEnv('DEFAULT_ADMIN_EMAIL', 'admin@avid.local'),
  defaultAdminPassword: optionalEnv('DEFAULT_ADMIN_PASSWORD', 'Admin123456!'),
  defaultAdminFirstName: optionalEnv('DEFAULT_ADMIN_FIRST_NAME', 'مدیر'),
  defaultAdminLastName: optionalEnv('DEFAULT_ADMIN_LAST_NAME', 'سامانه'),

  telegramBotToken: optionalEnv('TELEGRAM_BOT_TOKEN', ''),
  telegramChannelId: optionalEnv('TELEGRAM_CHANNEL_ID', ''),
  telegramDailyAlertEnabled: optionalBooleanEnv(
    'TELEGRAM_DAILY_ALERT_ENABLED',
    false,
  ),
  telegramDailyAlertTime: optionalEnv('TELEGRAM_DAILY_ALERT_TIME', '08:30'),
  telegramDailyAlertTimezone: optionalEnv(
    'TELEGRAM_DAILY_ALERT_TIMEZONE',
    'Asia/Baku',
  ),
  telegramAlertDashboardUrl: optionalEnv('TELEGRAM_ALERT_DASHBOARD_URL', ''),
  telegramWebhookSecret: optionalEnv('TELEGRAM_WEBHOOK_SECRET', ''),
  telegramBotPublicUrl: optionalEnv('TELEGRAM_BOT_PUBLIC_URL', ''),

  openaiApiKey: optionalEnv('OPENAI_API_KEY', ''),
  openaiBaseUrl: optionalEnv('OPENAI_BASE_URL', 'https://api.openai.com/v1').replace(/\/$/, ''),
  openaiTranscriptionModel: optionalEnv(
    'OPENAI_TRANSCRIPTION_MODEL',
    'gpt-4o-mini-transcribe',
  ),
  openaiTranscriptionLanguage: optionalEnv('OPENAI_TRANSCRIPTION_LANGUAGE', 'fa'),
};