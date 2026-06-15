import fs from 'fs';
import path from 'path';
import { Types } from 'mongoose';
import TelegramTaskSession from './telegram-task-session.model';
import User from '@/modules/users/user.model';
import Project, {
    ProjectFile,
    ProjectTask,
} from '@/modules/projects/project.model';

type TelegramFileLike = {
    file_id: string;
    file_unique_id?: string;
    file_name?: string;
    mime_type?: string;
    file_size?: number;
    duration?: number;
};

type TelegramPhotoSize = {
    file_id: string;
    file_unique_id?: string;
    file_size?: number;
    width?: number;
    height?: number;
};

type TelegramMessage = {
    message_id: number;
    text?: string;
    caption?: string;
    chat: {
        id: number | string;
    };
    from?: {
        id?: number;
        username?: string;
        first_name?: string;
        last_name?: string;
    };
    voice?: TelegramFileLike;
    audio?: TelegramFileLike;
    document?: TelegramFileLike;
    video?: TelegramFileLike;
    photo?: TelegramPhotoSize[];
};

type TelegramCallbackQuery = {
    id: string;
    data?: string;
    message?: TelegramMessage;
    from?: {
        id?: number;
        username?: string;
        first_name?: string;
        last_name?: string;
    };
};

type TelegramUpdate = {
    update_id: number;
    message?: TelegramMessage;
    callback_query?: TelegramCallbackQuery;
};

type TelegramAttachmentInput = {
    fileId: string;
    fileUniqueId?: string;
    originalName: string;
    fileType?: string;
    fileSize?: number;
    kind: 'voice' | 'audio' | 'document' | 'photo' | 'video';
};

type DownloadedTelegramFile = {
    fileName: string;
    originalName: string;
    fileUrl: string;
    fileType?: string;
    fileSize?: number;
};

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_API_BASE_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const TELEGRAM_FILE_BASE_URL = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}`;

const UPLOAD_ROOT =
    process.env.UPLOAD_ROOT || path.join(process.cwd(), 'uploads');
const PUBLIC_UPLOAD_PREFIX = process.env.PUBLIC_UPLOAD_PREFIX || '/uploads';

const ROLE_MANAGER = 'manager';
const STATUS_CANCELLED = 'cancelled';
const TASK_STATUS_DONE = 'done';
const TASK_STATUS_CANCELLED = 'cancelled';

const TASK_ATTACHMENT_CATEGORY = 'task_attachment';
const TASK_ATTACHMENT_CATEGORY_LABEL = 'پیوست وظیفه';

const ensureBotToken = (): void => {
    if (!TELEGRAM_BOT_TOKEN) {
        throw new Error('TELEGRAM_BOT_TOKEN is not configured.');
    }
};

const getChatId = (message?: TelegramMessage): string => {
    return String(message?.chat?.id || '');
};

const getTelegramUserId = (
    message?: TelegramMessage,
    callbackQuery?: TelegramCallbackQuery,
): string => {
    return String(message?.from?.id || callbackQuery?.from?.id || '');
};

const escapeHtml = (value: string): string => {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
};

const sendTelegramRequest = async <T = any>(
    method: string,
    payload: Record<string, any>,
): Promise<T> => {
    ensureBotToken();

    const response = await fetch(`${TELEGRAM_API_BASE_URL}/${method}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.ok) {
        throw new Error(
            data?.description || `Telegram API request failed: ${method}`,
        );
    }

    return data.result as T;
};

const sendMessage = async (
    chatId: string,
    text: string,
    replyMarkup?: Record<string, any>,
): Promise<void> => {
    await sendTelegramRequest('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
};

const answerCallbackQuery = async (
    callbackQueryId: string,
    text?: string,
): Promise<void> => {
    await sendTelegramRequest('answerCallbackQuery', {
        callback_query_id: callbackQueryId,
        ...(text ? { text } : {}),
        show_alert: false,
    });
};

const buildInlineKeyboard = (
    rows: Array<Array<{ text: string; callback_data: string }>>,
): Record<string, any> => {
    return {
        inline_keyboard: rows,
    };
};

const buildTaskHomeKeyboard = (): Record<string, any> => {
    return buildInlineKeyboard([
        [
            {
                text: 'ثبت وظیفه برای مدیران',
                callback_data: 'task:create',
            },
        ],
        [
            {
                text: 'وظایف باز من',
                callback_data: 'task:open_tasks',
            },
        ],
        [
            {
                text: 'لغو',
                callback_data: 'task:cancel',
            },
        ],
    ]);
};

const getUserDisplayName = (user: any): string => {
    return (
        user?.fullName ||
        [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
        user?.username ||
        user?.email ||
        'کاربر بدون نام'
    );
};

const getProjectTitle = (project: any): string => {
    return project?.title || project?.name || 'پروژه بدون عنوان';
};

const getProjectTitleFromTask = (task: any): string => {
    const project = task?.projectId;

    if (project && typeof project === 'object') {
        return getProjectTitle(project);
    }

    return 'پروژه نامشخص';
};

const getTaskStatusLabel = (status?: string): string => {
    const labels: Record<string, string> = {
        todo: 'برای انجام',
        in_progress: 'در حال انجام',
        blocked: 'مسدود',
        done: 'انجام‌شده',
        cancelled: 'لغوشده',
    };

    return labels[String(status || '')] || String(status || 'نامشخص');
};

const formatDate = (value?: Date | string | null): string => {
    if (!value) return 'ندارد';

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return 'ندارد';

    return new Intl.DateTimeFormat('fa-IR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(date);
};

const findActorByTelegram = async (
    telegramUserId: string,
    chatId: string,
): Promise<any | null> => {
    return User.findOne({
        isActive: true,
        $or: [
            {
                telegramUserId,
            },
            {
                telegramChatId: chatId,
            },
        ],
    } as any);
};

const ensureLinkedActor = async (
    chatId: string,
    telegramUserId: string,
): Promise<any | null> => {
    const actor = await findActorByTelegram(telegramUserId, chatId);

    if (!actor) {
        await sendMessage(
            chatId,
            'حساب تلگرام شما به هیچ کاربری در پنل متصل نیست. ابتدا اتصال تلگرام کاربر را در پنل انجام دهید.',
        );
        return null;
    }

    return actor;
};

const ensureManagerActor = async (
    chatId: string,
    telegramUserId: string,
): Promise<any | null> => {
    const actor = await ensureLinkedActor(chatId, telegramUserId);

    if (!actor) return null;

    if (String(actor.role) !== ROLE_MANAGER) {
        await sendMessage(
            chatId,
            'فقط مدیران می‌توانند از طریق بات برای مدیران دیگر وظیفه ثبت کنند.',
        );
        return null;
    }

    return actor;
};

const clearSession = async (chatId: string): Promise<void> => {
    await TelegramTaskSession.deleteMany({
        chatId,
    } as any);
};

const showTaskHome = async (
    chatId: string,
    telegramUserId: string,
): Promise<void> => {
    const actor = await ensureLinkedActor(chatId, telegramUserId);
    if (!actor) return;

    await sendMessage(
        chatId,
        [
            `سلام ${escapeHtml(getUserDisplayName(actor))}.`,
            '',
            'از این بخش می‌توانید وظیفه مدیریتی ثبت کنید یا وظایف باز خود را ببینید.',
            '',
            'برای ثبت وظیفه: پروژه را انتخاب کنید، مدیر را انتخاب کنید، متن وظیفه را بنویسید، سپس ویس ضبط‌شده، فایل، عکس، ویدئو یا «بدون پیوست» را ارسال کنید.',
        ].join('\n'),
        buildTaskHomeKeyboard(),
    );
};

const startTaskFlow = async (
    chatId: string,
    telegramUserId: string,
): Promise<void> => {
    const actor = await ensureManagerActor(chatId, telegramUserId);
    if (!actor) return;

    await TelegramTaskSession.findOneAndUpdate(
        {
            chatId,
            actorUserId: actor._id,
        } as any,
        {
            chatId,
            telegramUserId,
            actorUserId: actor._id,
            step: 'select_project',
            selectedProjectId: undefined,
            selectedManagerId: undefined,
            taskTitle: undefined,
            taskDescription: undefined,
        },
        {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true,
        },
    );

    const projects = await Project.find({
        status: {
            $nin: [STATUS_CANCELLED],
        },
    } as any)
        .sort({
            updatedAt: -1,
        })
        .limit(20)
        .select('title name status priority ownerId assignedUserIds');

    if (!projects.length) {
        await sendMessage(chatId, 'هیچ پروژه‌ای برای ثبت وظیفه پیدا نشد.');
        await clearSession(chatId);
        return;
    }

    const rows = projects.map((project: any) => [
        {
            text: getProjectTitle(project).slice(0, 55),
            callback_data: `task:project:${project._id.toString()}`,
        },
    ]);

    rows.push([
        {
            text: 'وظایف باز من',
            callback_data: 'task:open_tasks',
        },
        {
            text: 'انصراف',
            callback_data: 'task:cancel',
        },
    ]);

    await sendMessage(
        chatId,
        'پروژه‌ای که می‌خواهید برای آن وظیفه ثبت کنید را انتخاب کنید:',
        buildInlineKeyboard(rows),
    );
};

const listOpenTasks = async (
    chatId: string,
    telegramUserId: string,
): Promise<void> => {
    const actor = await ensureLinkedActor(chatId, telegramUserId);
    if (!actor) return;

    const openStatusFilter = {
        $nin: [TASK_STATUS_DONE, TASK_STATUS_CANCELLED],
    };

    const filter =
        String(actor.role) === ROLE_MANAGER
            ? {
                  status: openStatusFilter,
                  $or: [
                      {
                          assignedUserIds: actor._id,
                      },
                      {
                          createdBy: actor._id,
                      },
                  ],
              }
            : {
                  status: openStatusFilter,
                  assignedUserIds: actor._id,
              };

    const tasks = await ProjectTask.find(filter as any)
        .populate('projectId', 'title name status')
        .populate(
            'assignedUserIds',
            'firstName lastName fullName username email role',
        )
        .sort({
            dueDate: 1,
            updatedAt: -1,
            createdAt: -1,
        })
        .limit(20);

    if (!tasks.length) {
        await sendMessage(
            chatId,
            'هیچ وظیفه باز و انجام‌نشده‌ای برای شما پیدا نشد.',
            buildTaskHomeKeyboard(),
        );
        return;
    }

    const lines = [
        'وظایف باز شما:',
        '',
        ...tasks.map((task: any, index: number) => {
            const assignedUsers = Array.isArray(task.assignedUserIds)
                ? task.assignedUserIds.map(getUserDisplayName).filter(Boolean)
                : [];

            return [
                `${index + 1}. <b>${escapeHtml(task.title)}</b>`,
                `پروژه: ${escapeHtml(getProjectTitleFromTask(task))}`,
                `وضعیت: ${escapeHtml(getTaskStatusLabel(task.status))}`,
                `مسئول: ${escapeHtml(assignedUsers.join('، ') || 'نامشخص')}`,
                `مهلت: ${escapeHtml(formatDate(task.dueDate))}`,
            ].join('\n');
        }),
    ];

    await sendMessage(chatId, lines.join('\n\n'), buildTaskHomeKeyboard());
};

const handleProjectSelected = async (
    chatId: string,
    telegramUserId: string,
    projectId: string,
): Promise<void> => {
    const actor = await ensureManagerActor(chatId, telegramUserId);
    if (!actor) return;

    if (!Types.ObjectId.isValid(projectId)) {
        await sendMessage(chatId, 'شناسه پروژه معتبر نیست.');
        await clearSession(chatId);
        return;
    }

    const project = await Project.findById(projectId)
        .populate(
            'ownerId',
            'firstName lastName fullName username email role isActive',
        )
        .populate(
            'assignedUserIds',
            'firstName lastName fullName username email role isActive',
        );

    if (!project) {
        await sendMessage(chatId, 'پروژه انتخاب‌شده پیدا نشد.');
        await clearSession(chatId);
        return;
    }

    await TelegramTaskSession.findOneAndUpdate(
        {
            chatId,
            actorUserId: actor._id,
        } as any,
        {
            step: 'select_manager',
            selectedProjectId: project._id,
            selectedManagerId: undefined,
            taskTitle: undefined,
            taskDescription: undefined,
        },
    );

    const projectUsers = [
        (project as any).ownerId,
        ...(Array.isArray((project as any).assignedUserIds)
            ? (project as any).assignedUserIds
            : []),
    ].filter(Boolean);

    const managerMap = new Map<string, any>();

    projectUsers.forEach((user: any) => {
        if (
            user &&
            user._id &&
            String(user.role) === ROLE_MANAGER &&
            user.isActive !== false
        ) {
            managerMap.set(user._id.toString(), user);
        }
    });

    let managers = Array.from(managerMap.values());

    if (!managers.length) {
        managers = await User.find({
            role: ROLE_MANAGER,
            isActive: true,
        } as any)
            .sort({
                fullName: 1,
                username: 1,
            })
            .limit(30)
            .select('firstName lastName fullName username email role isActive');
    }

    if (!managers.length) {
        await sendMessage(chatId, 'هیچ مدیر فعالی برای تخصیص وظیفه پیدا نشد.');
        await clearSession(chatId);
        return;
    }

    const rows = managers.map((manager: any) => [
        {
            text: getUserDisplayName(manager).slice(0, 55),
            callback_data: `task:manager:${manager._id.toString()}`,
        },
    ]);

    rows.push([
        {
            text: 'بازگشت به انتخاب پروژه',
            callback_data: 'task:back:projects',
        },
        {
            text: 'انصراف',
            callback_data: 'task:cancel',
        },
    ]);

    await sendMessage(
        chatId,
        `پروژه انتخاب شد: <b>${escapeHtml(
            getProjectTitle(project),
        )}</b>\n\nمدیری که وظیفه باید برای او ثبت شود را انتخاب کنید:`,
        buildInlineKeyboard(rows),
    );
};

const handleManagerSelected = async (
    chatId: string,
    telegramUserId: string,
    managerId: string,
): Promise<void> => {
    const actor = await ensureManagerActor(chatId, telegramUserId);
    if (!actor) return;

    if (!Types.ObjectId.isValid(managerId)) {
        await sendMessage(chatId, 'شناسه مدیر معتبر نیست.');
        await clearSession(chatId);
        return;
    }

    const session = await TelegramTaskSession.findOne({
        chatId,
        actorUserId: actor._id,
    } as any);

    if (!session || !session.selectedProjectId) {
        await sendMessage(
            chatId,
            'فرآیند ثبت وظیفه پیدا نشد. دوباره /task را ارسال کنید.',
        );
        await clearSession(chatId);
        return;
    }

    const manager = await User.findOne({
        _id: new Types.ObjectId(managerId),
        role: ROLE_MANAGER,
        isActive: true,
    } as any);

    if (!manager) {
        await sendMessage(chatId, 'مدیر انتخاب‌شده پیدا نشد یا فعال نیست.');
        await clearSession(chatId);
        return;
    }

    await TelegramTaskSession.findOneAndUpdate(
        {
            chatId,
            actorUserId: actor._id,
        } as any,
        {
            step: 'enter_task',
            selectedManagerId: manager._id,
        },
    );

    await sendMessage(
        chatId,
        `مدیر انتخاب شد: <b>${escapeHtml(
            getUserDisplayName(manager),
        )}</b>\n\nمتن وظیفه را ارسال کنید.\n\nپیشنهاد:\nخط اول = عنوان وظیفه\nخط‌های بعدی = توضیحات`,
        buildInlineKeyboard([
            [
                {
                    text: 'انصراف',
                    callback_data: 'task:cancel',
                },
            ],
        ]),
    );
};

const parseTaskText = (
    text: string,
): {
    title: string;
    description: string;
} => {
    const lines = text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

    const title = lines[0] || text.trim();
    const description = lines.slice(1).join('\n').trim();

    return {
        title: title.slice(0, 180),
        description,
    };
};

const handleTaskText = async (
    chatId: string,
    telegramUserId: string,
    text: string,
): Promise<void> => {
    const actor = await ensureManagerActor(chatId, telegramUserId);
    if (!actor) return;

    const session = await TelegramTaskSession.findOne({
        chatId,
        actorUserId: actor._id,
    } as any);

    if (
        !session ||
        session.step !== 'enter_task' ||
        !session.selectedProjectId ||
        !session.selectedManagerId
    ) {
        await sendMessage(chatId, 'برای ثبت وظیفه ابتدا /task را ارسال کنید.');
        await clearSession(chatId);
        return;
    }

    const parsed = parseTaskText(text);

    if (!parsed.title || parsed.title.length < 3) {
        await sendMessage(chatId, 'عنوان وظیفه باید حداقل ۳ کاراکتر باشد.');
        return;
    }

    await TelegramTaskSession.findOneAndUpdate(
        {
            chatId,
            actorUserId: actor._id,
        } as any,
        {
            step: 'optional_file',
            taskTitle: parsed.title,
            taskDescription: parsed.description,
        },
    );

    await sendMessage(
        chatId,
        `وظیفه ثبت موقت شد:\n<b>${escapeHtml(
            parsed.title,
        )}</b>\n\nاکنون می‌توانید ویس ضبط کنید و ارسال کنید. همچنین می‌توانید فایل، عکس یا ویدئو بفرستید. اگر پیوست ندارید، روی «بدون پیوست» بزنید.`,
        buildInlineKeyboard([
            [
                {
                    text: 'بدون پیوست',
                    callback_data: 'task:file:none',
                },
            ],
            [
                {
                    text: 'انصراف',
                    callback_data: 'task:cancel',
                },
            ],
        ]),
    );
};

const extensionFromMime = (mimeType: string): string => {
    const map: Record<string, string> = {
        'audio/ogg': '.ogg',
        'audio/mpeg': '.mp3',
        'audio/mp4': '.m4a',
        'audio/x-m4a': '.m4a',
        'audio/aac': '.aac',
        'audio/wav': '.wav',
        'audio/webm': '.webm',
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'application/pdf': '.pdf',
        'video/mp4': '.mp4',
    };

    return map[mimeType] || '';
};

const fileExtensionFromTelegramPath = (telegramFilePath: string): string => {
    return path.extname(telegramFilePath || '');
};

const fileLikeToAttachment = (
    file: TelegramFileLike,
    kind: TelegramAttachmentInput['kind'],
    fallbackName: string,
): TelegramAttachmentInput => {
    const extension = extensionFromMime(file.mime_type || '');
    const fallbackWithExtension = path.extname(fallbackName)
        ? fallbackName
        : `${fallbackName}${extension}`;

    return {
        fileId: file.file_id,
        fileUniqueId: file.file_unique_id || '',
        originalName: file.file_name || fallbackWithExtension,
        fileType: file.mime_type || '',
        fileSize: file.file_size || 0,
        kind,
    };
};

const getLargestPhoto = (
    photos: TelegramPhotoSize[] | undefined,
): TelegramPhotoSize | null => {
    if (!photos?.length) return null;

    return [...photos].sort((a, b) => (b.file_size || 0) - (a.file_size || 0))[0];
};

const getTelegramAttachment = (
    message: TelegramMessage,
): TelegramAttachmentInput | null => {
    /*
      Recorded Telegram audio from the microphone arrives here:
      message.voice

      This is the main fix.
    */
    if (message.voice?.file_id) {
        return fileLikeToAttachment(message.voice, 'voice', 'voice.ogg');
    }

    /*
      Uploaded audio files arrive here:
      message.audio
    */
    if (message.audio?.file_id) {
        return fileLikeToAttachment(message.audio, 'audio', 'audio');
    }

    if (message.document?.file_id) {
        return fileLikeToAttachment(message.document, 'document', 'document');
    }

    if (message.video?.file_id) {
        return fileLikeToAttachment(message.video, 'video', 'video.mp4');
    }

    const photo = getLargestPhoto(message.photo);

    if (photo?.file_id) {
        return {
            fileId: photo.file_id,
            fileUniqueId: photo.file_unique_id || '',
            originalName: 'photo.jpg',
            fileType: 'image/jpeg',
            fileSize: photo.file_size || 0,
            kind: 'photo',
        };
    }

    return null;
};

const getTelegramFileInfo = async (
    fileId: string,
): Promise<{
    file_id: string;
    file_unique_id?: string;
    file_size?: number;
    file_path?: string;
}> => {
    const result = await sendTelegramRequest<{
        file_id: string;
        file_unique_id?: string;
        file_size?: number;
        file_path?: string;
    }>('getFile', {
        file_id: fileId,
    });

    return result;
};

const downloadTelegramAttachment = async (
    attachment: TelegramAttachmentInput,
): Promise<DownloadedTelegramFile> => {
    ensureBotToken();

    const telegramFile = await getTelegramFileInfo(attachment.fileId);

    if (!telegramFile.file_path) {
        throw new Error('Telegram file path could not be fetched.');
    }

    const fileResponse = await fetch(
        `${TELEGRAM_FILE_BASE_URL}/${telegramFile.file_path}`,
    );

    if (!fileResponse.ok) {
        throw new Error('Telegram file could not be downloaded.');
    }

    const arrayBuffer = await fileResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const extensionFromTelegram = fileExtensionFromTelegramPath(
        telegramFile.file_path,
    );

    const extension =
        path.extname(attachment.originalName) ||
        extensionFromTelegram ||
        extensionFromMime(attachment.fileType || '') ||
        (attachment.kind === 'voice' ? '.ogg' : '');

    const baseOriginalName = path.basename(
        attachment.originalName || `${attachment.kind}${extension}`,
    );

    const safeOriginalName = baseOriginalName.replace(/[^a-zA-Z0-9.\-_]/g, '_');

    const finalOriginalName = path.extname(safeOriginalName)
        ? safeOriginalName
        : `${safeOriginalName}${extension}`;

    const fileName = `${Date.now()}-${Math.round(
        Math.random() * 1e9,
    )}-${finalOriginalName}`;

    const relativeDir = path.join('projects', 'tasks');
    const absoluteDir = path.join(UPLOAD_ROOT, relativeDir);

    fs.mkdirSync(absoluteDir, {
        recursive: true,
    });

    const absolutePath = path.join(absoluteDir, fileName);

    fs.writeFileSync(absolutePath, buffer);

    return {
        fileName,
        originalName: finalOriginalName,
        fileUrl: `${PUBLIC_UPLOAD_PREFIX}/projects/tasks/${fileName}`,
        fileType: attachment.fileType,
        fileSize: buffer.length || attachment.fileSize || telegramFile.file_size || 0,
    };
};

const createTaskFromSession = async (
    chatId: string,
    actor: any,
    fileMessage?: TelegramMessage,
): Promise<void> => {
    const session = await TelegramTaskSession.findOne({
        chatId,
        actorUserId: actor._id,
    } as any);

    if (
        !session ||
        session.step !== 'optional_file' ||
        !session.selectedProjectId ||
        !session.selectedManagerId ||
        !session.taskTitle
    ) {
        await sendMessage(
            chatId,
            'اطلاعات وظیفه کامل نیست. دوباره /task را ارسال کنید.',
        );
        await clearSession(chatId);
        return;
    }

    const project = await Project.findById(session.selectedProjectId);

    if (!project) {
        await sendMessage(chatId, 'پروژه انتخاب‌شده پیدا نشد.');
        await clearSession(chatId);
        return;
    }

    const manager = await User.findOne({
        _id: session.selectedManagerId,
        role: ROLE_MANAGER,
        isActive: true,
    } as any);

    if (!manager) {
        await sendMessage(chatId, 'مدیر انتخاب‌شده پیدا نشد یا فعال نیست.');
        await clearSession(chatId);
        return;
    }

    const task = await ProjectTask.create({
        projectId: project._id,
        title: session.taskTitle,
        description: session.taskDescription || '',
        assignedUserIds: [manager._id],
        status: 'todo',
        statusLabel: 'برای انجام',
        priority: 'medium',
        priorityLabel: 'متوسط',
        startDate: new Date(),
        dueDate: null,
        completedAt: null,
        createdBy: actor._id,
        updatedBy: actor._id,
        source: 'telegram_bot',
        telegramChatId: chatId,
        language: 'fa',
        direction: 'rtl',
    } as any);

    const attachment = fileMessage ? getTelegramAttachment(fileMessage) : null;

    if (attachment) {
        const downloadedFile = await downloadTelegramAttachment(attachment);

        await ProjectFile.create({
            projectId: project._id,
            taskId: task._id,
            uploadedBy: actor._id,
            fileName: downloadedFile.fileName,
            originalName: downloadedFile.originalName,
            fileUrl: downloadedFile.fileUrl,
            fileType:
                downloadedFile.fileType ||
                attachment.fileType ||
                (attachment.kind === 'voice' ? 'audio/ogg' : ''),
            fileSize: downloadedFile.fileSize || attachment.fileSize || 0,
            category: TASK_ATTACHMENT_CATEGORY,
            categoryLabel: TASK_ATTACHMENT_CATEGORY_LABEL,
            source: 'telegram_bot',
            telegramFileId: attachment.fileId,
            telegramFileUniqueId: attachment.fileUniqueId || '',
            telegramMessageId: fileMessage?.message_id || null,
            telegramChatId: chatId,
            telegramAttachmentKind: attachment.kind,
            language: 'fa',
            direction: 'rtl',
        } as any);
    }

    await clearSession(chatId);

    await sendMessage(
        chatId,
        [
            'وظیفه با موفقیت ثبت شد.',
            '',
            `پروژه: <b>${escapeHtml(getProjectTitle(project))}</b>`,
            `مدیر مسئول: <b>${escapeHtml(getUserDisplayName(manager))}</b>`,
            `وظیفه: <b>${escapeHtml(task.title)}</b>`,
            attachment
                ? attachment.kind === 'voice'
                    ? 'ویس ضبط‌شده به وظیفه پیوست شد.'
                    : 'پیوست وظیفه ثبت شد.'
                : 'وظیفه بدون پیوست ثبت شد.',
        ].join('\n'),
        buildTaskHomeKeyboard(),
    );
};

const handleOptionalAttachmentMessage = async (
    chatId: string,
    telegramUserId: string,
    message: TelegramMessage,
): Promise<void> => {
    const actor = await ensureManagerActor(chatId, telegramUserId);
    if (!actor) return;

    const attachment = getTelegramAttachment(message);

    if (!attachment) {
        await sendMessage(
            chatId,
            'در این مرحله فقط ویس ضبط‌شده، فایل صوتی، فایل، عکس، ویدئو یا گزینه «بدون پیوست» قابل قبول است.',
            buildInlineKeyboard([
                [
                    {
                        text: 'بدون پیوست',
                        callback_data: 'task:file:none',
                    },
                ],
                [
                    {
                        text: 'انصراف',
                        callback_data: 'task:cancel',
                    },
                ],
            ]),
        );
        return;
    }

    await createTaskFromSession(chatId, actor, message);
};

const handleCallbackQuery = async (
    callbackQuery: TelegramCallbackQuery,
): Promise<void> => {
    const data = callbackQuery.data || '';
    const chatId = getChatId(callbackQuery.message);
    const telegramUserId = getTelegramUserId(undefined, callbackQuery);

    if (!chatId) return;

    await answerCallbackQuery(callbackQuery.id);

    if (data === 'task:cancel') {
        await clearSession(chatId);
        await sendMessage(
            chatId,
            'فرآیند ثبت وظیفه لغو شد.',
            buildTaskHomeKeyboard(),
        );
        return;
    }

    if (data === 'task:home') {
        await showTaskHome(chatId, telegramUserId);
        return;
    }

    if (data === 'task:create' || data === 'task:back:projects') {
        await startTaskFlow(chatId, telegramUserId);
        return;
    }

    if (data === 'task:open_tasks') {
        await listOpenTasks(chatId, telegramUserId);
        return;
    }

    if (data.startsWith('task:project:')) {
        const projectId = data.replace('task:project:', '');
        await handleProjectSelected(chatId, telegramUserId, projectId);
        return;
    }

    if (data.startsWith('task:manager:')) {
        const managerId = data.replace('task:manager:', '');
        await handleManagerSelected(chatId, telegramUserId, managerId);
        return;
    }

    if (data === 'task:file:none') {
        const actor = await ensureManagerActor(chatId, telegramUserId);
        if (!actor) return;

        await createTaskFromSession(chatId, actor);
        return;
    }

    await sendMessage(
        chatId,
        'دستور انتخاب‌شده معتبر نیست.',
        buildTaskHomeKeyboard(),
    );
};

const handleTextMessage = async (
    message: TelegramMessage,
): Promise<void> => {
    const chatId = getChatId(message);
    const telegramUserId = getTelegramUserId(message);
    const text = String(message.text || '').trim();

    if (!chatId) return;

    if (text === '/cancel' || text === 'انصراف' || text === 'لغو عملیات') {
        await clearSession(chatId);
        await sendMessage(chatId, 'فرآیند فعلی لغو شد.', buildTaskHomeKeyboard());
        return;
    }

    if (
        text === '/tasks' ||
        text === '/mytasks' ||
        text === 'وظایف باز من' ||
        text === 'وظایف من' ||
        text === 'کارهای باز من'
    ) {
        await listOpenTasks(chatId, telegramUserId);
        return;
    }

    if (
        text === '/task' ||
        text === '/newtask' ||
        text === 'ثبت وظیفه' ||
        text === 'تعریف وظیفه' ||
        text === 'ثبت وظیفه برای مدیران'
    ) {
        await startTaskFlow(chatId, telegramUserId);
        return;
    }

    const actor = await findActorByTelegram(telegramUserId, chatId);

    if (!actor) {
        await sendMessage(
            chatId,
            'حساب تلگرام شما به پنل متصل نیست. ابتدا اتصال کاربر به تلگرام را انجام دهید.',
        );
        return;
    }

    const session = await TelegramTaskSession.findOne({
        chatId,
        actorUserId: actor._id,
    } as any);

    if (!session) {
        await sendMessage(
            chatId,
            'برای ثبت وظیفه از «ثبت وظیفه» و برای مشاهده وظایف انجام‌نشده از «وظایف باز من» استفاده کنید.',
            buildTaskHomeKeyboard(),
        );
        return;
    }

    if (session.step === 'enter_task') {
        await handleTaskText(chatId, telegramUserId, text);
        return;
    }

    if (session.step === 'optional_file') {
        if (text === '/skip' || text === 'بدون فایل' || text === 'بدون پیوست') {
            await createTaskFromSession(chatId, actor);
            return;
        }

        await sendMessage(
            chatId,
            'در این مرحله ویس ضبط‌شده، فایل صوتی، فایل، عکس یا ویدئو را ارسال کنید یا روی «بدون پیوست» بزنید.',
            buildInlineKeyboard([
                [
                    {
                        text: 'بدون پیوست',
                        callback_data: 'task:file:none',
                    },
                ],
                [
                    {
                        text: 'انصراف',
                        callback_data: 'task:cancel',
                    },
                ],
            ]),
        );
        return;
    }

    await sendMessage(chatId, 'لطفاً یکی از گزینه‌های نمایش داده‌شده را انتخاب کنید.');
};

const handleAttachmentMessage = async (
    message: TelegramMessage,
): Promise<void> => {
    const chatId = getChatId(message);
    const telegramUserId = getTelegramUserId(message);

    if (!chatId) return;

    const actor = await findActorByTelegram(telegramUserId, chatId);

    if (!actor) {
        await sendMessage(chatId, 'حساب تلگرام شما به پنل متصل نیست.');
        return;
    }

    const session = await TelegramTaskSession.findOne({
        chatId,
        actorUserId: actor._id,
    } as any);

    if (!session || session.step !== 'optional_file') {
        await sendMessage(
            chatId,
            'برای ثبت ویس یا فایل وظیفه، ابتدا دستور /task را ارسال کنید و تا مرحله پیوست پیش بروید.',
            buildTaskHomeKeyboard(),
        );
        return;
    }

    await handleOptionalAttachmentMessage(chatId, telegramUserId, message);
};

const messageHasAttachment = (message: TelegramMessage): boolean => {
    return Boolean(
        message.voice ||
            message.audio ||
            message.document ||
            message.video ||
            message.photo?.length,
    );
};

export const telegramTaskBotService = {
    async handleUpdate(update: TelegramUpdate): Promise<void> {
        if (update.callback_query) {
            await handleCallbackQuery(update.callback_query);
            return;
        }

        if (!update.message) return;

        /*
          Critical:
          Telegram recorded audio is message.voice.
          This branch must run before text handling.
        */
        if (messageHasAttachment(update.message)) {
            await handleAttachmentMessage(update.message);
            return;
        }

        if (update.message.text) {
            await handleTextMessage(update.message);
        }
    },
};