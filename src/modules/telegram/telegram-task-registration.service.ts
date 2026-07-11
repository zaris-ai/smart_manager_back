/**
 * Compatibility export.
 *
 * The previous codebase contained a second in-memory Telegram task workflow.
 * Task registration is now consolidated in telegram-task-bot.service.ts so
 * webhook routing, persistent sessions, attachments, transcription, due dates,
 * priorities and task status updates use one implementation.
 */
export { telegramTaskBotService as telegramTaskRegistrationService } from './telegram-task-bot.service';
