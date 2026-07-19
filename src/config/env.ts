import dotenv from 'dotenv';
// for test

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

  repositoryAnalysisEnabled: optionalBooleanEnv(
    'REPOSITORY_ANALYSIS_ENABLED',
    true,
  ),
  gitlabBaseUrl: optionalEnv('GITLAB_BASE_URL', '').replace(/\/$/, ''),
  gitlabAccessToken: optionalEnv('GITLAB_ACCESS_TOKEN', ''),
  repositoryAnalysisAllowInsecureHttp: optionalBooleanEnv(
    'REPOSITORY_ANALYSIS_ALLOW_INSECURE_HTTP',
    false,
  ),
  repositoryAnalysisAllowedGitlabHosts: optionalEnv(
    'REPOSITORY_ANALYSIS_ALLOWED_GITLAB_HOSTS',
    '',
  ),
  repositoryAnalysisMaxFiles: optionalNumberEnv(
    'REPOSITORY_ANALYSIS_MAX_FILES',
    10_000,
  ),
  repositoryAnalysisMaxSelectedFiles: optionalNumberEnv(
    'REPOSITORY_ANALYSIS_MAX_SELECTED_FILES',
    80,
  ),
  repositoryAnalysisMaxFileBytes: optionalNumberEnv(
    'REPOSITORY_ANALYSIS_MAX_FILE_BYTES',
    256 * 1024,
  ),
  repositoryAnalysisMaxPromptBytes: optionalNumberEnv(
    'REPOSITORY_ANALYSIS_MAX_PROMPT_BYTES',
    600 * 1024,
  ),
  repositoryAnalysisMaxExpectationsBytes: optionalNumberEnv(
    'REPOSITORY_ANALYSIS_MAX_EXPECTATIONS_BYTES',
    512 * 1024,
  ),
  repositoryAnalysisGitlabTimeoutMs: optionalNumberEnv(
    'REPOSITORY_ANALYSIS_GITLAB_TIMEOUT_MS',
    30_000,
  ),
  repositoryAnalysisStaleAfterMs: optionalNumberEnv(
    'REPOSITORY_ANALYSIS_STALE_AFTER_MS',
    30 * 60 * 1000,
  ),
  openaiRepositoryAnalysisModel: optionalEnv(
    'OPENAI_REPOSITORY_ANALYSIS_MODEL',
    'gpt-4.1-mini',
  ),
  openaiRepositoryAnalysisTimeoutMs: optionalNumberEnv(
    'OPENAI_REPOSITORY_ANALYSIS_TIMEOUT_MS',
    90_000,
  ),
  repositoryAnalysisAiEngine: optionalEnv(
    'REPOSITORY_ANALYSIS_AI_ENGINE',
    'python_multi_pass',
  ),
  repositoryAnalysisPythonBin: optionalEnv(
    'REPOSITORY_ANALYSIS_PYTHON_BIN',
    'python3',
  ),
  repositoryAnalysisPythonPath: optionalEnv(
    'REPOSITORY_ANALYSIS_PYTHON_PATH',
    'python',
  ),
  repositoryAnalysisPythonModule: optionalEnv(
    'REPOSITORY_ANALYSIS_PYTHON_MODULE',
    'repository_analysis',
  ),
  repositoryAnalysisAiChildTimeoutMs: optionalNumberEnv(
    'REPOSITORY_ANALYSIS_AI_CHILD_TIMEOUT_MS',
    8 * 60 * 1000,
  ),
  repositoryAnalysisAiMaxBatches: optionalNumberEnv(
    'REPOSITORY_ANALYSIS_AI_MAX_BATCHES',
    6,
  ),
  repositoryAnalysisAiBatchChars: optionalNumberEnv(
    'REPOSITORY_ANALYSIS_AI_BATCH_CHARS',
    90_000,
  ),
  repositoryAnalysisAiMaxOutputBytes: optionalNumberEnv(
    'REPOSITORY_ANALYSIS_AI_MAX_OUTPUT_BYTES',
    8 * 1024 * 1024,
  ),
  repositoryAnalysisAiCriticEnabled: optionalBooleanEnv(
    'REPOSITORY_ANALYSIS_AI_CRITIC_ENABLED',
    true,
  ),
  repositoryAnalysisAiFallbackToTypescript: optionalBooleanEnv(
    'REPOSITORY_ANALYSIS_AI_FALLBACK_TO_TYPESCRIPT',
    true,
  ),

};
