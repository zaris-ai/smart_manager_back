import { Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import mongoose, { Types } from 'mongoose';
import { env } from '@/config/env';
import {
    Project,
    ProjectFile,
    ProjectFileCategory,
    PROJECT_FILE_CATEGORY_LABELS,
    ProjectProgressNote,
} from '@/modules/projects/project.model';
import User, { UserDocument, UserRole } from '@/modules/users/user.model';
import TelegramBotSession, {
    TelegramBotSessionStep,
} from '@/modules/telegram/telegram-bot-session.model';
import {
    answerTelegramCallbackQuery,
    downloadTelegramFile,
    escapeTelegramHtml,
    getTelegramFile,
    isTelegramBotWebhookConfigured,
    sendTelegramBotMessage,
} from '@/modules/telegram/telegram.service';
import {
    TelegramCallbackQueryPayload,
    TelegramFileLikePayload,
    TelegramMessagePayload,
    TelegramPhotoSizePayload,
    TelegramUpdatePayload,
} from '@/modules/telegram/telegram.types';

type BotUser = Pick<
    UserDocument,
    '_id' | 'fullName' | 'username' | 'role' | 'isActive'
>;

type MediaCandidate = {
    fileId: string;
    fileUniqueId: string;
    originalName: string;
    mimeType: string;
    fileSize: number;
    kind: 'voice' | 'audio' | 'document' | 'photo' | 'video';
};

const PROJECT_SELECT_LIMIT = 10;
const uploadDir = path.join(process.cwd(), 'uploads', 'projects');

const isValidObjectId = (value?: string): boolean => {
    return Boolean(value && mongoose.Types.ObjectId.isValid(value));
};

const toObjectId = (value: string): Types.ObjectId => {
    return new mongoose.Types.ObjectId(value);
};

const getChatId = (message: TelegramMessagePayload): string => {
    return String(message.chat.id);
};

const getTelegramUserId = (message: TelegramMessagePayload): string => {
    return String(message.from?.id || message.chat.id);
};

const getTelegramUsername = (message: TelegramMessagePayload): string => {
    return String(message.from?.username || message.chat.username || '')
        .replace(/^@/, '')
        .toLowerCase();
};

const getUserFilter = (message: TelegramMessagePayload) => {
    const telegramUserId = getTelegramUserId(message);
    const telegramChatId = getChatId(message);

    return {
        isActive: true,
        $or: [{ telegramUserId }, { telegramChatId }],
    };
};

const getLinkedUser = async (
    message: TelegramMessagePayload,
): Promise<BotUser | null> => {
    return User.findOne(getUserFilter(message)).select(
        '_id fullName username role isActive',
    );
};

const buildMainKeyboard = () => ({
    inline_keyboard: [
        [{ text: 'ثبت گزارش پروژه', callback_data: 'bot:add_report' }],
        [{ text: 'ثبت وظیفه برای مدیران', callback_data: 'task:back:projects' }],
        [{ text: 'وظایف باز من', callback_data: 'task:open_tasks' }],
        [{ text: 'فهرست پروژه‌های من', callback_data: 'bot:list_projects' }],
        [{ text: 'لغو عملیات جاری', callback_data: 'bot:cancel' }],
    ],
});

const buildDefaultReplyKeyboard = () => ({
    keyboard: [
        [{ text: 'شروع / راهنما' }, { text: 'ثبت وظیفه' }],
        [{ text: 'وظایف باز من' }, { text: 'ثبت گزارش پروژه' }],
        [{ text: 'پروژه‌های من' }, { text: 'لغو عملیات' }],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
    is_persistent: true,
});

const buildBotGuideText = (user: BotUser): string => {
    return [
        `سلام ${escapeTelegramHtml(user.fullName || user.username)}.`,
        '',
        'راهنمای ربات مدیریتی آوید:',
        '',
        'ثبت گزارش پروژه: متن، فایل، عکس، ویدئو یا ویس برای پروژه ثبت می‌شود.',
        'ثبت وظیفه: مدیر می‌تواند برای مدیر دیگر وظیفه ثبت کند و در مرحله آخر ویس ضبط‌شده، فایل، عکس، ویدئو یا بدون پیوست ارسال کند.',
        'وظایف باز من: وظایف انجام‌نشده شما نمایش داده می‌شود.',
        '',
        'دستورات سریع:',
        '/start - شروع و نمایش راهنما',
        '/task - ثبت وظیفه برای مدیران',
        '/tasks - نمایش وظایف باز من',
        '/projects - نمایش پروژه‌های من',
        '/report - ثبت گزارش پروژه',
        '/cancel - لغو عملیات جاری',
    ].join('\n');
};

const buildProjectKeyboard = (
    projects: Array<{ _id: Types.ObjectId; title: string }>,
) => ({
    inline_keyboard: [
        ...projects.map((project) => [
            {
                text: project.title.slice(0, 40),
                callback_data: `bot:project:${project._id.toString()}`,
            },
        ]),
        [{ text: 'لغو', callback_data: 'bot:cancel' }],
    ],
});

const buildAttachmentKeyboard = () => ({
    inline_keyboard: [
        [{ text: 'بدون فایل ثبت شود', callback_data: 'bot:skip_attachment' }],
        [{ text: 'لغو', callback_data: 'bot:cancel' }],
    ],
});

const getAccessibleProjects = async (user: BotUser) => {
    const filter: Record<string, unknown> = {};

    if (user.role !== UserRole.MANAGER) {
        filter.assignedUserIds = user._id;
    }

    return Project.find(filter)
        .select('_id title status priority assignedUserIds')
        .sort({ updatedAt: -1, createdAt: -1 })
        .limit(PROJECT_SELECT_LIMIT);
};

const getAccessibleProjectById = async (user: BotUser, projectId: string) => {
    if (!isValidObjectId(projectId)) return null;

    const filter: Record<string, unknown> = { _id: toObjectId(projectId) };

    if (user.role !== UserRole.MANAGER) {
        filter.assignedUserIds = user._id;
    }

    return Project.findOne(filter).select('_id title status');
};

const upsertSession = async (
    message: TelegramMessagePayload,
    user: BotUser | null,
    update: Record<string, unknown> = {},
) => {
    return TelegramBotSession.findOneAndUpdate(
        {
            telegramUserId: getTelegramUserId(message),
            telegramChatId: getChatId(message),
        },
        {
            $set: {
                telegramUsername: getTelegramUsername(message),
                linkedUserId: user?._id || null,
                ...update,
            },
            $setOnInsert: {
                telegramUserId: getTelegramUserId(message),
                telegramChatId: getChatId(message),
            },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
    );
};

const resetSession = async (
    message: TelegramMessagePayload,
    user: BotUser | null,
) => {
    await upsertSession(message, user, {
        step: TelegramBotSessionStep.IDLE,
        selectedProjectId: null,
        selectedProjectTitle: '',
        lastProjectNoteId: null,
        pendingDescription: '',
    });
};

const sendUnlinkedUserMessage = async (message: TelegramMessagePayload) => {
    const telegramUserId = getTelegramUserId(message);
    const telegramChatId = getChatId(message);
    const username = getTelegramUsername(message);

    await sendTelegramBotMessage(
        telegramChatId,
        [
            'حساب تلگرام شما هنوز به کاربر پنل متصل نشده است.',
            '',
            `Telegram User ID: <code>${escapeTelegramHtml(telegramUserId)}</code>`,
            `Telegram Chat ID: <code>${escapeTelegramHtml(telegramChatId)}</code>`,
            username ? `Username: @${escapeTelegramHtml(username)}` : '',
            '',
            'مدیر باید یکی از این شناسه‌ها را در اطلاعات کاربر ثبت کند.',
        ]
            .filter(Boolean)
            .join('\n'),
    );
};

const sendProjectSelection = async (
    message: TelegramMessagePayload,
    user: BotUser,
) => {
    const projects = await getAccessibleProjects(user);

    if (!projects.length) {
        await sendTelegramBotMessage(
            getChatId(message),
            'هیچ پروژه‌ای برای شما پیدا نشد. اگر باید پروژه‌ای ببینید، باید در پنل به پروژه اختصاص داده شوید.',
            { replyMarkup: buildMainKeyboard() },
        );
        return;
    }

    await upsertSession(message, user, {
        step: TelegramBotSessionStep.AWAITING_PROJECT,
        selectedProjectId: null,
        selectedProjectTitle: '',
        lastProjectNoteId: null,
        pendingDescription: '',
    });

    await sendTelegramBotMessage(getChatId(message), 'پروژه را انتخاب کنید:', {
        replyMarkup: buildProjectKeyboard(projects),
    });
};

const sendProjectsList = async (
    message: TelegramMessagePayload,
    user: BotUser,
) => {
    const projects = await getAccessibleProjects(user);

    if (!projects.length) {
        await sendTelegramBotMessage(
            getChatId(message),
            'هیچ پروژه‌ای برای شما پیدا نشد.',
        );
        return;
    }

    const text = [
        'پروژه‌های قابل دسترسی شما:',
        '',
        ...projects.map((project, index) => {
            return `${index + 1}. ${escapeTelegramHtml(project.title)} — ${escapeTelegramHtml(project.status)}`;
        }),
    ].join('\n');

    await sendTelegramBotMessage(getChatId(message), text, {
        replyMarkup: buildMainKeyboard(),
    });
};

const extensionFromMime = (mimeType: string): string => {
    const map: Record<string, string> = {
        'audio/ogg': '.ogg',
        'audio/mpeg': '.mp3',
        'audio/mp4': '.m4a',
        'audio/x-m4a': '.m4a',
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'application/pdf': '.pdf',
        'video/mp4': '.mp4',
    };

    return map[mimeType] || '';
};

const safeOriginalName = (value: string): string => {
    const safe = value.replace(/[^a-zA-Z0-9.\-_]/g, '_');

    return safe || 'telegram-file';
};

const originalNameFromFilePath = (
    filePath: string,
    fallback: string,
): string => {
    const name = path.basename(filePath || '').trim();

    return safeOriginalName(name || fallback);
};

const getLargestPhoto = (
    photos: TelegramPhotoSizePayload[] | undefined,
): TelegramPhotoSizePayload | null => {
    if (!photos?.length) return null;

    return [...photos].sort((a, b) => (b.file_size || 0) - (a.file_size || 0))[0];
};

const fileLikeToCandidate = (
    file: TelegramFileLikePayload,
    kind: MediaCandidate['kind'],
    fallbackName: string,
): MediaCandidate => {
    const extension = extensionFromMime(file.mime_type || '');
    const fallbackWithExtension = path.extname(fallbackName)
        ? fallbackName
        : `${fallbackName}${extension}`;

    return {
        fileId: file.file_id,
        fileUniqueId: file.file_unique_id || '',
        originalName: file.file_name || fallbackWithExtension,
        mimeType: file.mime_type || '',
        fileSize: file.file_size || 0,
        kind,
    };
};

const getMediaCandidate = (
    message: TelegramMessagePayload,
): MediaCandidate | null => {
    if (message.voice) {
        return fileLikeToCandidate(message.voice, 'voice', 'voice.ogg');
    }

    if (message.audio) {
        return fileLikeToCandidate(message.audio, 'audio', 'audio');
    }

    if (message.document) {
        return fileLikeToCandidate(message.document, 'document', 'document');
    }

    if (message.video) {
        return fileLikeToCandidate(message.video, 'video', 'video.mp4');
    }

    const photo = getLargestPhoto(message.photo);

    if (photo) {
        return {
            fileId: photo.file_id,
            fileUniqueId: photo.file_unique_id || '',
            originalName: 'photo.jpg',
            mimeType: 'image/jpeg',
            fileSize: photo.file_size || 0,
            kind: 'photo',
        };
    }

    return null;
};

const saveTelegramMediaAsProjectFile = async (
    message: TelegramMessagePayload,
    media: MediaCandidate,
    projectId: Types.ObjectId,
    uploadedBy: Types.ObjectId,
    progressNoteId?: Types.ObjectId | null,
) => {
    const telegramFile = await getTelegramFile(media.fileId);

    if (!telegramFile.file_path) {
        throw new Error('مسیر فایل از تلگرام دریافت نشد.');
    }

    const buffer = await downloadTelegramFile(telegramFile.file_path);
    await fs.mkdir(uploadDir, { recursive: true });

    const originalName = originalNameFromFilePath(
        telegramFile.file_path,
        media.originalName,
    );
    const fileName = `${Date.now()}-${crypto.randomUUID()}-${originalName}`;
    const filePath = path.join(uploadDir, fileName);

    await fs.writeFile(filePath, buffer);

    return ProjectFile.create({
        projectId,
        progressNoteId: progressNoteId || null,
        uploadedBy,
        fileName,
        originalName: safeOriginalName(media.originalName || originalName),
        fileUrl: `/api/v1/uploads/projects/${fileName}`,
        fileType: media.mimeType,
        fileSize: media.fileSize || buffer.length,
        category: ProjectFileCategory.REPORTS,
        categoryLabel: PROJECT_FILE_CATEGORY_LABELS[ProjectFileCategory.REPORTS],
        source: 'telegram_bot',
        telegramFileId: media.fileId,
        telegramFileUniqueId: media.fileUniqueId,
        telegramMessageId: message.message_id,
        language: 'fa',
        direction: 'rtl',
    });
};

const createTelegramProjectNote = async (
    message: TelegramMessagePayload,
    user: BotUser,
    projectId: Types.ObjectId,
    description: string,
) => {
    const project = await Project.findById(projectId).select('status');

    return ProjectProgressNote.create({
        projectId,
        authorId: user._id,
        registeredById: user._id,
        note: description.trim(),
        progressPercent: null,
        statusSnapshot: project?.status || 'telegram_bot',
        source: 'telegram_bot',
        telegramChatId: getChatId(message),
        telegramMessageId: message.message_id,
        language: 'fa',
        direction: 'rtl',
    });
};

const completeAttachmentStep = async (
    message: TelegramMessagePayload,
    user: BotUser,
    media: MediaCandidate | null,
) => {
    const session = await TelegramBotSession.findOne({
        telegramUserId: getTelegramUserId(message),
        telegramChatId: getChatId(message),
    });

    if (
        !session ||
        session.step !== TelegramBotSessionStep.AWAITING_ATTACHMENT ||
        !session.selectedProjectId
    ) {
        await sendTelegramBotMessage(
            getChatId(message),
            'برای ثبت فایل ابتدا پروژه را انتخاب کنید و توضیح را ارسال کنید.',
            { replyMarkup: buildMainKeyboard() },
        );
        return;
    }

    if (media) {
        await saveTelegramMediaAsProjectFile(
            message,
            media,
            session.selectedProjectId,
            user._id,
            session.lastProjectNoteId || null,
        );
    }

    await resetSession(message, user);

    await sendTelegramBotMessage(
        getChatId(message),
        media
            ? 'گزارش پروژه همراه با فایل/صدا با موفقیت ثبت شد.'
            : 'گزارش پروژه بدون فایل با موفقیت ثبت شد.',
        { replyMarkup: buildMainKeyboard() },
    );
};

const handleProjectDescription = async (
    message: TelegramMessagePayload,
    user: BotUser,
    description: string,
    media: MediaCandidate | null,
) => {
    const session = await TelegramBotSession.findOne({
        telegramUserId: getTelegramUserId(message),
        telegramChatId: getChatId(message),
    });

    if (
        !session ||
        session.step !== TelegramBotSessionStep.AWAITING_DESCRIPTION ||
        !session.selectedProjectId
    ) {
        await sendTelegramBotMessage(
            getChatId(message),
            'برای ثبت گزارش ابتدا پروژه را انتخاب کنید.',
            { replyMarkup: buildMainKeyboard() },
        );
        return;
    }

    const note = await createTelegramProjectNote(
        message,
        user,
        session.selectedProjectId,
        description,
    );

    await upsertSession(message, user, {
        step: TelegramBotSessionStep.AWAITING_ATTACHMENT,
        lastProjectNoteId: note._id,
        pendingDescription: description.trim(),
    });

    if (media) {
        await completeAttachmentStep(message, user, media);
        return;
    }

    await sendTelegramBotMessage(
        getChatId(message),
        'توضیح ثبت شد. حالا فایل، ویس، عکس یا سند پروژه را ارسال کنید. اگر فایل ندارید، گزینه زیر را بزنید.',
        { replyMarkup: buildAttachmentKeyboard() },
    );
};

const handleStart = async (message: TelegramMessagePayload, user: BotUser) => {
    await upsertSession(message, user, { step: TelegramBotSessionStep.IDLE });

    await sendTelegramBotMessage(getChatId(message), buildBotGuideText(user), {
        replyMarkup: buildDefaultReplyKeyboard(),
    });

    await sendTelegramBotMessage(
        getChatId(message),
        'از دکمه‌های داخل پیام هم می‌توانید استفاده کنید:',
        { replyMarkup: buildMainKeyboard() },
    );
};

const handleCallback = async (callbackQuery: TelegramCallbackQueryPayload) => {
    if (!callbackQuery.message) return;

    const message = callbackQuery.message;
    message.from = callbackQuery.from;

    const user = await getLinkedUser(message);

    await answerTelegramCallbackQuery(callbackQuery.id).catch(() => undefined);

    if (!user) {
        await sendUnlinkedUserMessage(message);
        return;
    }

    const data = callbackQuery.data || '';

    if (data === 'bot:add_report' || data === 'bot:list_projects') {
        if (data === 'bot:add_report') {
            await sendProjectSelection(message, user);
            return;
        }

        await sendProjectsList(message, user);
        return;
    }

    if (data === 'bot:cancel') {
        await resetSession(message, user);
        await sendTelegramBotMessage(getChatId(message), 'عملیات جاری لغو شد.', {
            replyMarkup: buildMainKeyboard(),
        });
        return;
    }

    if (data === 'bot:skip_attachment') {
        await completeAttachmentStep(message, user, null);
        return;
    }

    if (data.startsWith('bot:project:')) {
        const projectId = data.replace('bot:project:', '');
        const project = await getAccessibleProjectById(user, projectId);

        if (!project) {
            await sendTelegramBotMessage(
                getChatId(message),
                'پروژه پیدا نشد یا به آن دسترسی ندارید.',
                { replyMarkup: buildMainKeyboard() },
            );
            return;
        }

        await upsertSession(message, user, {
            step: TelegramBotSessionStep.AWAITING_DESCRIPTION,
            selectedProjectId: project._id,
            selectedProjectTitle: project.title,
            lastProjectNoteId: null,
            pendingDescription: '',
        });

        await sendTelegramBotMessage(
            getChatId(message),
            `پروژه انتخاب شد: <b>${escapeTelegramHtml(project.title)}</b>\nتوضیح یا گزارش خود را ارسال کنید. اگر فایل/ویس را همین الان می‌فرستید، توضیح را در کپشن بگذارید.`,
        );
    }
};

const handleMessage = async (message: TelegramMessagePayload) => {
    const user = await getLinkedUser(message);

    if (!user) {
        await sendUnlinkedUserMessage(message);
        return;
    }

    const text = String(message.text || '').trim();
    const media = getMediaCandidate(message);
    const description = String(message.caption || message.text || '').trim();

    if (
        text === '/start' ||
        text === 'start' ||
        text === 'شروع' ||
        text === 'راهنما' ||
        text === 'شروع / راهنما'
    ) {
        await handleStart(message, user);
        return;
    }

    if (text === '/cancel' || text === 'لغو' || text === 'لغو عملیات') {
        await resetSession(message, user);
        await sendTelegramBotMessage(getChatId(message), 'عملیات جاری لغو شد.', {
            replyMarkup: buildMainKeyboard(),
        });
        return;
    }

    if (text === '/projects' || text === 'پروژه‌های من') {
        await sendProjectsList(message, user);
        return;
    }

    if (
        text === '/new' ||
        text === '/report' ||
        text === 'ثبت گزارش پروژه'
    ) {
        await sendProjectSelection(message, user);
        return;
    }

    if (text === '/skip' || text === 'بدون فایل' || text === 'بدون پیوست') {
        await completeAttachmentStep(message, user, null);
        return;
    }

    const session = await TelegramBotSession.findOne({
        telegramUserId: getTelegramUserId(message),
        telegramChatId: getChatId(message),
    });

    if (session?.step === TelegramBotSessionStep.AWAITING_DESCRIPTION) {
        if (!description) {
            await sendTelegramBotMessage(
                getChatId(message),
                'توضیح گزارش الزامی است. لطفاً متن توضیح را ارسال کنید یا فایل را همراه کپشن بفرستید.',
            );
            return;
        }

        await handleProjectDescription(message, user, description, media);
        return;
    }

    if (session?.step === TelegramBotSessionStep.AWAITING_ATTACHMENT) {
        if (!media) {
            await sendTelegramBotMessage(
                getChatId(message),
                'لطفاً فایل، ویس، عکس، ویدئو یا سند ارسال کنید یا /skip را بزنید.',
                { replyMarkup: buildAttachmentKeyboard() },
            );
            return;
        }

        await completeAttachmentStep(message, user, media);
        return;
    }

    await sendTelegramBotMessage(
        getChatId(message),
        'برای ثبت گزارش پروژه، ثبت وظیفه یا مشاهده وظایف باز از دکمه‌های زیر استفاده کنید.',
        { replyMarkup: buildMainKeyboard() },
    );
};

export const handleTelegramWebhook = async (req: Request, res: Response) => {
    if (!isTelegramBotWebhookConfigured()) {
        res.status(503).json({
            success: false,
            message: 'ربات تلگرام تنظیم نشده است.',
            code: 'TELEGRAM_NOT_CONFIGURED',
        });
        return;
    }

    const { secret } = req.params;

    if (!env.telegramWebhookSecret || secret !== env.telegramWebhookSecret) {
        res.status(403).json({
            success: false,
            message: 'مسیر وبهوک تلگرام معتبر نیست.',
            code: 'INVALID_TELEGRAM_WEBHOOK_SECRET',
        });
        return;
    }

    const update = req.body as TelegramUpdatePayload;

    res.status(200).json({ success: true });

    try {
        if (update.callback_query) {
            await handleCallback(update.callback_query);
            return;
        }

        if (update.message) {
            await handleMessage(update.message);
        }
    } catch (error) {
        console.error('Telegram webhook handling failed:', error);
    }
};

export const getTelegramBotStatus = async (_req: Request, res: Response) => {
    res.json({
        success: true,
        data: {
            configured: isTelegramBotWebhookConfigured(),
            webhookPath: env.telegramWebhookSecret
                ? `/api/v1/telegram/webhook/${env.telegramWebhookSecret}`
                : '',
        },
    });
};