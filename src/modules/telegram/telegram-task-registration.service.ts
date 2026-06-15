import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { ProjectTaskModel } from '../projects/project-task.model';
import { ProjectFileModel } from '../projects/project-file.model';

import ProjectModel from '../projects/project.model';
import UserModel from '../users/user.model';

type TelegramMessage = {
    message_id: number;
    chat: {
        id: number;
    };
    text?: string;
    document?: {
        file_id: string;
        file_name?: string;
        mime_type?: string;
        file_size?: number;
    };
    audio?: {
        file_id: string;
        file_name?: string;
        mime_type?: string;
        file_size?: number;
    };
    video?: {
        file_id: string;
        file_name?: string;
        mime_type?: string;
        file_size?: number;
    };
    voice?: {
        file_id: string;
        mime_type?: string;
        file_size?: number;
    };
    photo?: Array<{
        file_id: string;
        file_size?: number;
        width?: number;
        height?: number;
    }>;
};

type TelegramCallbackQuery = {
    id: string;
    data?: string;
    message?: TelegramMessage;
};

type TelegramUpdate = {
    message?: TelegramMessage;
    callback_query?: TelegramCallbackQuery;
};

type TaskRegistrationStep =
    | 'select_project'
    | 'select_manager'
    | 'title'
    | 'description'
    | 'priority'
    | 'start_date'
    | 'due_date'
    | 'collect_files';

type TaskRegistrationState = {
    step: TaskRegistrationStep;
    chatId: number;
    requesterUserId?: string;
    projectId?: string;
    managerId?: string;
    title?: string;
    description?: string;
    priority?: 'low' | 'medium' | 'high' | 'critical';
    startDate?: Date | null;
    dueDate?: Date | null;
    createdTaskId?: string;
};

const states = new Map<number, TaskRegistrationState>();

const TELEGRAM_API_BASE = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

const uploadRoot = path.resolve(process.cwd(), 'uploads', 'projects');

const TASK_FILE_CATEGORY = 'reports';
const TASK_FILE_CATEGORY_LABEL = 'گزارش‌ها';

if (!fs.existsSync(uploadRoot)) {
    fs.mkdirSync(uploadRoot, { recursive: true });
}

const isValidObjectId = (value?: string) => {
    return Boolean(value && mongoose.Types.ObjectId.isValid(value));
};

const escapeHtml = (value: string) => {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
};

const parseDateInput = (value?: string) => {
    if (!value) return null;

    const trimmed = value.trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return null;
    }

    const date = new Date(`${trimmed}T00:00:00.000Z`);

    if (Number.isNaN(date.getTime())) return null;

    return date;
};

const formatUserName = (user: any) => {
    return (
        user.fullName ||
        [user.firstName, user.lastName].filter(Boolean).join(' ') ||
        user.username ||
        user.email ||
        'مدیر بدون نام'
    );
};

const getTelegramFileFromMessage = (message: TelegramMessage) => {
    if (message.document) {
        return {
            fileId: message.document.file_id,
            originalName: message.document.file_name || `document-${Date.now()}`,
            mimeType: message.document.mime_type || 'application/octet-stream',
            fileSize: message.document.file_size || 0,
        };
    }

    if (message.audio) {
        return {
            fileId: message.audio.file_id,
            originalName: message.audio.file_name || `audio-${Date.now()}.mp3`,
            mimeType: message.audio.mime_type || 'audio/mpeg',
            fileSize: message.audio.file_size || 0,
        };
    }

    if (message.video) {
        return {
            fileId: message.video.file_id,
            originalName: message.video.file_name || `video-${Date.now()}.mp4`,
            mimeType: message.video.mime_type || 'video/mp4',
            fileSize: message.video.file_size || 0,
        };
    }

    if (message.voice) {
        return {
            fileId: message.voice.file_id,
            originalName: `voice-${Date.now()}.ogg`,
            mimeType: message.voice.mime_type || 'audio/ogg',
            fileSize: message.voice.file_size || 0,
        };
    }

    if (message.photo?.length) {
        const photo = [...message.photo].sort((a, b) => {
            return (b.file_size || 0) - (a.file_size || 0);
        })[0];

        return {
            fileId: photo.file_id,
            originalName: `photo-${Date.now()}.jpg`,
            mimeType: 'image/jpeg',
            fileSize: photo.file_size || 0,
        };
    }

    return null;
};

const telegramRequest = async <T>(
    method: string,
    payload: Record<string, unknown>,
): Promise<T> => {
    const response = await fetch(`${TELEGRAM_API_BASE}/${method}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });

    const data = (await response.json()) as {
        ok: boolean;
        result: T;
        description?: string;
    };

    if (!data.ok) {
        throw new Error(data.description || `Telegram ${method} failed`);
    }

    return data.result;
};

const sendMessage = async (
    chatId: number,
    text: string,
    replyMarkup?: Record<string, unknown>,
) => {
    await telegramRequest('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
    });
};

const answerCallbackQuery = async (callbackQueryId: string, text?: string) => {
    await telegramRequest('answerCallbackQuery', {
        callback_query_id: callbackQueryId,
        text: text || '',
    });
};

const getCurrentUserByChatId = async (chatId: number) => {
    return UserModel.findOne({
        telegramChatId: String(chatId),
        isActive: true,
    }).lean();
};

const getAvailableProjectsForUser = async (userId: string) => {
    if (!isValidObjectId(userId)) {
        return [];
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);

    const projects = await ProjectModel.find({
        $or: [
            { ownerId: userObjectId },
            { assignedUserIds: userObjectId },
        ],
    } as any)
        .sort({ updatedAt: -1 })
        .limit(30)
        .lean();

    return projects
        .filter((project: any) => {
            const status = String(project.status || '').toLowerCase();

            return !['completed', 'cancelled'].includes(status);
        })
        .slice(0, 10);
};

const getProjectManagers = async (projectId: string) => {
    const project = await ProjectModel.findById(projectId)
        .populate(
            'ownerId',
            'firstName lastName fullName username email role isActive telegramChatId',
        )
        .populate(
            'assignedUserIds',
            'firstName lastName fullName username email role isActive telegramChatId',
        )
        .lean();

    if (!project) return [];

    const users = [
        project.ownerId,
        ...(project.assignedUserIds || []),
    ].filter(Boolean) as any[];

    const uniqueUsers = new Map<string, any>();

    users.forEach((user) => {
        const userId = String(user._id || user.id || '');

        if (!userId) return;

        const role = String(user.role || '').toLowerCase();

        if (!user.isActive) return;
        if (!['manager', 'admin'].includes(role)) return;

        uniqueUsers.set(userId, user);
    });

    return Array.from(uniqueUsers.values());
};

const sendProjectPicker = async (chatId: number, requesterUserId: string) => {
    const projects = await getAvailableProjectsForUser(requesterUserId);

    if (!projects.length) {
        await sendMessage(chatId, 'هیچ پروژه فعالی برای شما پیدا نشد.');
        return;
    }

    states.set(chatId, {
        step: 'select_project',
        chatId,
        requesterUserId,
    });

    await sendMessage(chatId, 'پروژه را برای تعریف وظیفه انتخاب کنید:', {
        inline_keyboard: projects.map((project: any) => [
            {
                text: project.title,
                callback_data: `tt:p:${String(project._id)}`,
            },
        ]),
    });
};

const sendManagerPicker = async (chatId: number, projectId: string) => {
    const managers = await getProjectManagers(projectId);

    if (!managers.length) {
        await sendMessage(chatId, 'هیچ مدیر فعالی در این پروژه پیدا نشد.');
        states.delete(chatId);
        return;
    }

    await sendMessage(chatId, 'مدیر مسئول وظیفه را انتخاب کنید:', {
        inline_keyboard: managers.map((manager: any) => [
            {
                text: formatUserName(manager),
                callback_data: `tt:m:${String(manager._id)}`,
            },
        ]),
    });
};

const sendPriorityPicker = async (chatId: number) => {
    await sendMessage(chatId, 'اولویت وظیفه را انتخاب کنید:', {
        inline_keyboard: [
            [
                {
                    text: 'کم',
                    callback_data: 'tt:pr:low',
                },
                {
                    text: 'متوسط',
                    callback_data: 'tt:pr:medium',
                },
            ],
            [
                {
                    text: 'زیاد',
                    callback_data: 'tt:pr:high',
                },
                {
                    text: 'بحرانی',
                    callback_data: 'tt:pr:critical',
                },
            ],
        ],
    });
};

const createTaskFromState = async (state: TaskRegistrationState) => {
    if (!state.projectId || !state.managerId || !state.title) {
        throw new Error('اطلاعات وظیفه کامل نیست.');
    }

    const task = await ProjectTaskModel.create({
        projectId: new mongoose.Types.ObjectId(state.projectId),
        title: state.title.trim(),
        description: state.description || '',
        assignedUserIds: [new mongoose.Types.ObjectId(state.managerId)],
        status: 'todo',
        priority: state.priority || 'medium',
        startDate: state.startDate || null,
        dueDate: state.dueDate || null,
        completedAt: null,
        createdBy:
            state.requesterUserId && isValidObjectId(state.requesterUserId)
                ? new mongoose.Types.ObjectId(state.requesterUserId)
                : null,
        updatedBy:
            state.requesterUserId && isValidObjectId(state.requesterUserId)
                ? new mongoose.Types.ObjectId(state.requesterUserId)
                : null,
    });

    return task;
};

const downloadTelegramFile = async (fileId: string) => {
    const fileInfo = await telegramRequest<{
        file_id: string;
        file_unique_id: string;
        file_size?: number;
        file_path: string;
    }>('getFile', {
        file_id: fileId,
    });

    const response = await fetch(
        `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${fileInfo.file_path}`,
    );

    if (!response.ok) {
        throw new Error('دانلود فایل از تلگرام ناموفق بود.');
    }

    const arrayBuffer = await response.arrayBuffer();

    return {
        buffer: Buffer.from(arrayBuffer),
        filePath: fileInfo.file_path,
        fileSize: fileInfo.file_size || Buffer.byteLength(Buffer.from(arrayBuffer)),
    };
};

const saveTelegramAttachmentToTask = async (
    message: TelegramMessage,
    state: TaskRegistrationState,
) => {
    if (!state.projectId || !state.createdTaskId) {
        throw new Error('وظیفه برای ذخیره فایل پیدا نشد.');
    }

    const telegramFile = getTelegramFileFromMessage(message);

    if (!telegramFile) {
        return false;
    }

    const downloadedFile = await downloadTelegramFile(telegramFile.fileId);

    const safeOriginalName = telegramFile.originalName.replace(
        /[^\w.\-\u0600-\u06FF]+/g,
        '-',
    );

    const fileName = `${Date.now()}-${Math.round(
        Math.random() * 1_000_000_000,
    )}-${safeOriginalName}`;

    const absolutePath = path.join(uploadRoot, fileName);

    fs.writeFileSync(absolutePath, downloadedFile.buffer);

    await ProjectFileModel.create({
        projectId: new mongoose.Types.ObjectId(state.projectId),
        taskId: new mongoose.Types.ObjectId(state.createdTaskId),
        progressNoteId: null,
        uploadedBy:
            state.requesterUserId && isValidObjectId(state.requesterUserId)
                ? new mongoose.Types.ObjectId(state.requesterUserId)
                : null,
        fileName,
        originalName: telegramFile.originalName,
        fileUrl: `/uploads/projects/${fileName}`,
        fileType: telegramFile.mimeType,
        fileSize: telegramFile.fileSize || downloadedFile.fileSize,
        category: TASK_FILE_CATEGORY,
        categoryLabel: TASK_FILE_CATEGORY_LABEL,
        source: 'telegram_bot',
    } as any);

    return true;
};

const startTaskRegistration = async (chatId: number) => {
    const user = await getCurrentUserByChatId(chatId);

    if (!user) {
        await sendMessage(
            chatId,
            'حساب تلگرام شما به هیچ کاربر فعالی در سامانه وصل نیست.',
        );
        return;
    }

    await sendProjectPicker(chatId, String(user._id));
};

const handleTextMessage = async (message: TelegramMessage) => {
    const chatId = message.chat.id;
    const text = message.text?.trim() || '';

    if (
        ['/task', '/tasks', '/newtask', 'تعریف وظیفه', 'ثبت وظیفه'].includes(
            text,
        )
    ) {
        await startTaskRegistration(chatId);
        return;
    }

    const state = states.get(chatId);

    if (!state) return;

    if (text === '/cancel') {
        states.delete(chatId);
        await sendMessage(chatId, 'فرآیند تعریف وظیفه لغو شد.');
        return;
    }

    if (state.step === 'title') {
        if (!text) {
            await sendMessage(chatId, 'عنوان وظیفه الزامی است. عنوان را ارسال کنید.');
            return;
        }

        state.title = text;
        state.step = 'description';

        states.set(chatId, state);

        await sendMessage(
            chatId,
            'توضیحات وظیفه را ارسال کنید. برای رد کردن، علامت - را بفرستید.',
        );

        return;
    }

    if (state.step === 'description') {
        state.description = text === '-' ? '' : text;
        state.step = 'priority';

        states.set(chatId, state);

        await sendPriorityPicker(chatId);

        return;
    }

    if (state.step === 'start_date') {
        if (text === '-' || text.toLowerCase() === 'skip') {
            state.startDate = null;
            state.step = 'due_date';
            states.set(chatId, state);

            await sendMessage(
                chatId,
                'تاریخ موعد را با فرمت 2026-06-20 ارسال کنید. برای رد کردن، - را بفرستید.',
            );

            return;
        }

        const parsedDate = parseDateInput(text);

        if (!parsedDate) {
            await sendMessage(
                chatId,
                'فرمت تاریخ شروع صحیح نیست. نمونه صحیح: 2026-06-20 یا برای رد کردن -',
            );
            return;
        }

        state.startDate = parsedDate;
        state.step = 'due_date';
        states.set(chatId, state);

        await sendMessage(
            chatId,
            'تاریخ موعد را با فرمت 2026-06-20 ارسال کنید. برای رد کردن، - را بفرستید.',
        );

        return;
    }

    if (state.step === 'due_date') {
        if (text === '-' || text.toLowerCase() === 'skip') {
            state.dueDate = null;
        } else {
            const parsedDate = parseDateInput(text);

            if (!parsedDate) {
                await sendMessage(
                    chatId,
                    'فرمت تاریخ موعد صحیح نیست. نمونه صحیح: 2026-06-20 یا برای رد کردن -',
                );
                return;
            }

            state.dueDate = parsedDate;
        }

        const task = await createTaskFromState(state);

        state.createdTaskId = String(task._id);
        state.step = 'collect_files';
        states.set(chatId, state);

        await sendMessage(
            chatId,
            [
                'وظیفه با موفقیت ثبت شد.',
                '',
                `عنوان: <b>${escapeHtml(state.title || '')}</b>`,
                '',
                'اکنون می‌توانید فایل‌های مربوط به این وظیفه را ارسال کنید.',
                'هر نوع فایل قابل قبول است: سند، عکس، صوت، ویدیو و غیره.',
                '',
                'برای پایان، روی دکمه زیر بزنید.',
            ].join('\n'),
            {
                inline_keyboard: [
                    [
                        {
                            text: 'پایان ثبت وظیفه',
                            callback_data: 'tt:finish',
                        },
                    ],
                ],
            },
        );
    }
};

const handleFileMessage = async (message: TelegramMessage) => {
    const chatId = message.chat.id;
    const state = states.get(chatId);

    if (!state || state.step !== 'collect_files') {
        return;
    }

    const saved = await saveTelegramAttachmentToTask(message, state);

    if (!saved) {
        await sendMessage(chatId, 'این پیام فایل قابل ذخیره ندارد.');
        return;
    }

    await sendMessage(
        chatId,
        'فایل برای وظیفه ذخیره شد. می‌توانید فایل دیگری بفرستید یا پایان ثبت وظیفه را بزنید.',
        {
            inline_keyboard: [
                [
                    {
                        text: 'پایان ثبت وظیفه',
                        callback_data: 'tt:finish',
                    },
                ],
            ],
        },
    );
};

const handleCallbackQuery = async (callbackQuery: TelegramCallbackQuery) => {
    const chatId = callbackQuery.message?.chat.id;

    if (!chatId || !callbackQuery.data) return;

    await answerCallbackQuery(callbackQuery.id);

    const data = callbackQuery.data;
    const state = states.get(chatId);

    if (data === 'tt:start') {
        await startTaskRegistration(chatId);
        return;
    }

    if (data === 'tt:finish') {
        states.delete(chatId);
        await sendMessage(chatId, 'ثبت وظیفه کامل شد.');
        return;
    }

    if (data.startsWith('tt:p:')) {
        const projectId = data.replace('tt:p:', '');

        if (!isValidObjectId(projectId)) {
            await sendMessage(chatId, 'شناسه پروژه معتبر نیست.');
            return;
        }

        const currentState = state || {
            step: 'select_project' as TaskRegistrationStep,
            chatId,
        };

        currentState.projectId = projectId;
        currentState.step = 'select_manager';

        states.set(chatId, currentState);

        await sendManagerPicker(chatId, projectId);
        return;
    }

    if (data.startsWith('tt:m:')) {
        const managerId = data.replace('tt:m:', '');

        if (!state?.projectId || !isValidObjectId(managerId)) {
            await sendMessage(chatId, 'انتخاب مدیر معتبر نیست.');
            return;
        }

        state.managerId = managerId;
        state.step = 'title';

        states.set(chatId, state);

        await sendMessage(chatId, 'عنوان وظیفه را ارسال کنید.');
        return;
    }

    if (data.startsWith('tt:pr:')) {
        if (!state) {
            await sendMessage(
                chatId,
                'فرآیند تعریف وظیفه پیدا نشد. دوباره /task را ارسال کنید.',
            );
            return;
        }

        const priority = data.replace('tt:pr:', '') as
            | 'low'
            | 'medium'
            | 'high'
            | 'critical';

        if (!['low', 'medium', 'high', 'critical'].includes(priority)) {
            await sendMessage(chatId, 'اولویت معتبر نیست.');
            return;
        }

        state.priority = priority;
        state.step = 'start_date';

        states.set(chatId, state);

        await sendMessage(
            chatId,
            'تاریخ شروع را با فرمت 2026-06-20 ارسال کنید. برای رد کردن، - را بفرستید.',
        );
    }
};

export const telegramTaskRegistrationService = {
    async handleUpdate(update: TelegramUpdate) {
        try {
            if (update.callback_query) {
                await handleCallbackQuery(update.callback_query);
                return;
            }

            if (update.message) {
                const message = update.message;

                if (
                    message.document ||
                    message.photo ||
                    message.audio ||
                    message.video ||
                    message.voice
                ) {
                    await handleFileMessage(message);
                    return;
                }

                await handleTextMessage(message);
            }
        } catch (error) {
            const chatId =
                update.message?.chat.id || update.callback_query?.message?.chat.id;

            if (chatId) {
                await sendMessage(
                    chatId,
                    error instanceof Error
                        ? `خطا: ${escapeHtml(error.message)}`
                        : 'خطا در پردازش پیام تلگرام.',
                );
            }
        }
    },

    async sendTaskEntryButton(chatId: number) {
        await sendMessage(chatId, 'برای تعریف وظیفه جدید روی دکمه زیر بزنید:', {
            inline_keyboard: [
                [
                    {
                        text: 'تعریف وظیفه جدید',
                        callback_data: 'tt:start',
                    },
                ],
            ],
        });
    },
};