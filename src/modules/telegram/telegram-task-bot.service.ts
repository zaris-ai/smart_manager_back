import fs from 'fs';
import path from 'path';
import { Types } from 'mongoose';
import TelegramTaskSession from './telegram-task-session.model';
import User from '@/modules/users/user.model';
import Project, {
  ProjectFile,
  ProjectTask,
} from '@/modules/projects/project.model';

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
  document?: {
    file_id: string;
    file_name?: string;
    mime_type?: string;
    file_size?: number;
  };
  photo?: Array<{
    file_id: string;
    file_unique_id?: string;
    file_size?: number;
    width?: number;
    height?: number;
  }>;
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
  originalName: string;
  fileType?: string;
  fileSize?: number;
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
    reply_markup: replyMarkup,
  });
};

const answerCallbackQuery = async (
  callbackQueryId: string,
  text?: string,
): Promise<void> => {
  await sendTelegramRequest('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
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

const ensureManagerActor = async (
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
    )}</b>\n\nاگر فایل دارید همین حالا ارسال کنید. در غیر این صورت روی «بدون فایل» بزنید.`,
    buildInlineKeyboard([
      [
        {
          text: 'بدون فایل',
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

const downloadTelegramFile = async (
  fileId: string,
  fallbackName: string,
): Promise<DownloadedTelegramFile> => {
  ensureBotToken();

  const fileInfoResponse = await fetch(`${TELEGRAM_API_BASE_URL}/getFile`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      file_id: fileId,
    }),
  });

  const fileInfoData = await fileInfoResponse.json().catch(() => null);

  if (
    !fileInfoResponse.ok ||
    !fileInfoData?.ok ||
    !fileInfoData?.result?.file_path
  ) {
    throw new Error('Telegram file info could not be fetched.');
  }

  const telegramFilePath = fileInfoData.result.file_path as string;
  const extension = path.extname(telegramFilePath) || path.extname(fallbackName);
  const safeOriginalName = fallbackName || `telegram-file${extension || ''}`;
  const fileName = `${Date.now()}-${Math.round(
    Math.random() * 1e9,
  )}${extension}`;

  const relativeDir = path.join('projects', 'tasks');
  const absoluteDir = path.join(UPLOAD_ROOT, relativeDir);

  fs.mkdirSync(absoluteDir, {
    recursive: true,
  });

  const absolutePath = path.join(absoluteDir, fileName);
  const fileResponse = await fetch(`${TELEGRAM_FILE_BASE_URL}/${telegramFilePath}`);

  if (!fileResponse.ok) {
    throw new Error('Telegram file could not be downloaded.');
  }

  const arrayBuffer = await fileResponse.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  fs.writeFileSync(absolutePath, buffer);

  return {
    fileName,
    originalName: safeOriginalName,
    fileUrl: `${PUBLIC_UPLOAD_PREFIX}/projects/tasks/${fileName}`,
    fileSize: buffer.length,
  };
};

const getTelegramAttachment = (
  message: TelegramMessage,
): TelegramAttachmentInput | null => {
  if (message.document?.file_id) {
    return {
      fileId: message.document.file_id,
      originalName: message.document.file_name || 'telegram-document',
      fileType: message.document.mime_type,
      fileSize: message.document.file_size,
    };
  }

  if (message.photo?.length) {
    const largestPhoto = [...message.photo].sort(
      (a, b) => (b.file_size || 0) - (a.file_size || 0),
    )[0];

    if (largestPhoto?.file_id) {
      return {
        fileId: largestPhoto.file_id,
        originalName: `telegram-photo-${
          largestPhoto.file_unique_id || Date.now()
        }.jpg`,
        fileType: 'image/jpeg',
        fileSize: largestPhoto.file_size,
      };
    }
  }

  return null;
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
    priority: 'medium',
    startDate: new Date(),
    dueDate: null,
    completedAt: null,
    createdBy: actor._id,
    updatedBy: actor._id,
    source: 'telegram_bot',
    telegramChatId: chatId,
  } as any);

  const attachment = fileMessage ? getTelegramAttachment(fileMessage) : null;

  if (attachment) {
    const downloadedFile = await downloadTelegramFile(
      attachment.fileId,
      attachment.originalName,
    );

    await ProjectFile.create({
      projectId: project._id,
      taskId: task._id,
      uploadedBy: actor._id,
      fileName: downloadedFile.fileName,
      originalName: downloadedFile.originalName,
      fileUrl: downloadedFile.fileUrl,
      fileType: attachment.fileType,
      fileSize: downloadedFile.fileSize || attachment.fileSize || 0,
      category: 'task_attachment',
      source: 'telegram_bot',
      telegramChatId: chatId,
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
      attachment ? 'فایل پیوست شد.' : 'بدون فایل ثبت شد.',
    ].join('\n'),
  );
};

const handleOptionalFileMessage = async (
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
      'در این مرحله فقط فایل، عکس یا گزینه «بدون فایل» قابل قبول است.',
      buildInlineKeyboard([
        [
          {
            text: 'بدون فایل',
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
    await sendMessage(chatId, 'فرآیند ثبت وظیفه لغو شد.');
    return;
  }

  if (data === 'task:back:projects') {
    await startTaskFlow(chatId, telegramUserId);
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

  await sendMessage(chatId, 'دستور انتخاب‌شده معتبر نیست.');
};

const handleTextMessage = async (
  message: TelegramMessage,
): Promise<void> => {
  const chatId = getChatId(message);
  const telegramUserId = getTelegramUserId(message);
  const text = String(message.text || '').trim();

  if (!chatId) return;

  if (text === '/cancel' || text === 'انصراف') {
    await clearSession(chatId);
    await sendMessage(chatId, 'فرآیند فعلی لغو شد.');
    return;
  }

  if (text === '/start') {
    const actor = await findActorByTelegram(telegramUserId, chatId);

    if (actor) {
      await User.findByIdAndUpdate(
        actor._id,
        {
          telegramUserId,
          telegramChatId: chatId,
          telegramUsername: message.from?.username || actor.telegramUsername,
        },
        {
          new: true,
        },
      );

      await sendMessage(
        chatId,
        'بات به حساب شما متصل است.\nبرای ثبت وظیفه مدیریتی دستور /task را ارسال کنید.',
      );
      return;
    }

    await sendMessage(
      chatId,
      'برای استفاده از بات، ابتدا باید حساب تلگرام شما در پنل مدیریتی ثبت شده باشد.',
    );
    return;
  }

  if (text === '/task' || text === 'ثبت وظیفه') {
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
      'برای ثبت وظیفه دستور /task را ارسال کنید.',
      buildInlineKeyboard([
        [
          {
            text: 'ثبت وظیفه',
            callback_data: 'task:back:projects',
          },
        ],
      ]),
    );
    return;
  }

  if (session.step === 'enter_task') {
    await handleTaskText(chatId, telegramUserId, text);
    return;
  }

  if (session.step === 'optional_file') {
    await sendMessage(
      chatId,
      'در این مرحله فایل را ارسال کنید یا روی «بدون فایل» بزنید.',
      buildInlineKeyboard([
        [
          {
            text: 'بدون فایل',
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

const handleFileMessage = async (
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
      'برای ثبت فایل وظیفه ابتدا دستور /task را ارسال کنید.',
    );
    return;
  }

  await handleOptionalFileMessage(chatId, telegramUserId, message);
};

export const telegramTaskBotService = {
  async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
      return;
    }

    if (!update.message) return;

    if (update.message.document || update.message.photo?.length) {
      await handleFileMessage(update.message);
      return;
    }

    if (update.message.text) {
      await handleTextMessage(update.message);
    }
  },
};