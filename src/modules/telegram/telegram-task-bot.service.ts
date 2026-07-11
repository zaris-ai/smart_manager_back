import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { Types } from 'mongoose';
import TelegramTaskSession from './telegram-task-session.model';
import User, { UserRole } from '@/modules/users/user.model';
import Project, {
  ProjectFile,
  ProjectFileCategory,
  PROJECT_FILE_CATEGORY_LABELS,
  PROJECT_PRIORITY_LABELS,
  PROJECT_TASK_STATUS_LABELS,
  ProjectPriority,
  ProjectTask,
  ProjectTaskStatus,
} from '@/modules/projects/project.model';
import {
  answerTelegramCallbackQuery,
  downloadTelegramFile,
  escapeTelegramHtml,
  getTelegramFile,
  sendTelegramBotMessage,
} from '@/modules/telegram/telegram.service';
import {
  TelegramCallbackQueryPayload,
  TelegramFileLikePayload,
  TelegramMessagePayload,
  TelegramPhotoSizePayload,
  TelegramReplyMarkup,
  TelegramUpdatePayload,
} from '@/modules/telegram/telegram.types';
import {
  toProjectFileTranscriptionFields,
  transcribeAudioPath,
} from '@/modules/projects/audio-transcription.service';

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
  localPath: string;
};

const uploadDir = path.join(process.cwd(), 'uploads', 'projects', 'tasks');
const OPEN_TASK_STATUSES = [
  ProjectTaskStatus.TODO,
  ProjectTaskStatus.IN_PROGRESS,
  ProjectTaskStatus.BLOCKED,
];
const MUTABLE_TASK_STATUSES = new Set<ProjectTaskStatus>([
  ProjectTaskStatus.TODO,
  ProjectTaskStatus.IN_PROGRESS,
  ProjectTaskStatus.BLOCKED,
  ProjectTaskStatus.DONE,
]);

const getChatId = (message?: TelegramMessagePayload): string => {
  return String(message?.chat?.id || '');
};

const getTelegramUserId = (
  message?: TelegramMessagePayload,
  callbackQuery?: TelegramCallbackQueryPayload,
): string => {
  return String(message?.from?.id || callbackQuery?.from?.id || '');
};

const sendMessage = async (
  chatId: string,
  text: string,
  replyMarkup?: TelegramReplyMarkup,
): Promise<void> => {
  await sendTelegramBotMessage(chatId, text, {
    parseMode: 'HTML',
    replyMarkup,
  });
};

const answerCallbackQuery = async (
  callbackQueryId: string,
  text?: string,
): Promise<void> => {
  await answerTelegramCallbackQuery(callbackQueryId, text).catch(
    () => undefined,
  );
};

const buildInlineKeyboard = (
  rows: Array<Array<{ text: string; callback_data: string }>>,
): TelegramReplyMarkup => ({ inline_keyboard: rows });

const buildTaskHomeKeyboard = (): TelegramReplyMarkup => {
  return buildInlineKeyboard([
    [{ text: 'ثبت وظیفه جدید', callback_data: 'task:create' }],
    [{ text: 'وظایف باز من', callback_data: 'task:open_tasks' }],
    [{ text: 'بازگشت به منوی اصلی', callback_data: 'bot:summary' }],
    [{ text: 'لغو عملیات', callback_data: 'task:cancel' }],
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
  return task?.projectId && typeof task.projectId === 'object'
    ? getProjectTitle(task.projectId)
    : 'پروژه نامشخص';
};

const formatDate = (value?: Date | string | null): string => {
  if (!value) return 'بدون مهلت';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'بدون مهلت';

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
    $or: [{ telegramUserId }, { telegramChatId: chatId }],
  });
};

const ensureLinkedActor = async (
  chatId: string,
  telegramUserId: string,
): Promise<any | null> => {
  const actor = await findActorByTelegram(telegramUserId, chatId);

  if (!actor) {
    await sendMessage(
      chatId,
      'حساب تلگرام شما به کاربری در پنل متصل نیست. شناسه‌های نمایش‌داده‌شده توسط /start را در پروفایل کاربر ثبت کنید.',
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

  if (String(actor.role) !== UserRole.MANAGER) {
    await sendMessage(
      chatId,
      'ثبت وظیفه جدید از ربات فقط برای مدیران فعال است. کارشناسان می‌توانند وظایف تخصیص‌یافته خود را مشاهده و به‌روزرسانی کنند.',
    );
    return null;
  }

  return actor;
};

const clearSession = async (chatId: string): Promise<void> => {
  await TelegramTaskSession.deleteMany({ chatId });
};

const getActiveTaskSession = async (chatId: string): Promise<any | null> => {
  return TelegramTaskSession.findOne({ chatId }).sort({ updatedAt: -1 });
};

const getOptionalFileTaskSession = async (
  chatId: string,
): Promise<any | null> => {
  return TelegramTaskSession.findOne({ chatId, step: 'optional_file' }).sort({
    updatedAt: -1,
  });
};

const canReadTask = (actor: any, task: any): boolean => {
  if ([UserRole.MANAGER, UserRole.BOARD].includes(String(actor.role) as UserRole)) {
    return true;
  }

  const actorId = String(actor._id);
  const assigneeIds = Array.isArray(task.assignedUserIds)
    ? task.assignedUserIds.map((value: any) => String(value?._id || value))
    : [];

  return assigneeIds.includes(actorId) || String(task.createdBy?._id || task.createdBy) === actorId;
};

const canUpdateTask = (actor: any, task: any): boolean => {
  if (String(actor.role) === UserRole.MANAGER) return true;
  if (String(actor.role) === UserRole.BOARD) return false;

  const actorId = String(actor._id);
  const assigneeIds = Array.isArray(task.assignedUserIds)
    ? task.assignedUserIds.map((value: any) => String(value?._id || value))
    : [];

  return assigneeIds.includes(actorId);
};

const showTaskHome = async (
  chatId: string,
  telegramUserId: string,
): Promise<void> => {
  const actor = await ensureLinkedActor(chatId, telegramUserId);
  if (!actor) return;

  const roleMessage =
    String(actor.role) === UserRole.MANAGER
      ? 'می‌توانید وظیفه جدید ثبت کنید، مسئول را از میان اعضای واقعی پروژه انتخاب کنید و وضعیت وظایف را به‌روزرسانی کنید.'
      : 'می‌توانید وظایف باز خود را مشاهده کنید و وضعیت وظایف تخصیص‌یافته را تغییر دهید.';

  await sendMessage(
    chatId,
    [
      `سلام ${escapeTelegramHtml(getUserDisplayName(actor))}.`,
      '',
      roleMessage,
      '',
      'فرآیند ثبت وظیفه شامل انتخاب پروژه، مسئول، اولویت، متن، مهلت و پیوست اختیاری است.',
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

  await clearSession(chatId);
  await TelegramTaskSession.create({
    chatId,
    telegramUserId,
    actorUserId: actor._id,
    step: 'select_project',
  });

  const projects = await Project.find({
    status: { $nin: ['cancelled'] },
  })
    .sort({ updatedAt: -1 })
    .limit(20)
    .select('title status priority ownerId assignedUserIds projectMembers');

  if (!projects.length) {
    await sendMessage(chatId, 'هیچ پروژه فعالی برای ثبت وظیفه پیدا نشد.');
    await clearSession(chatId);
    return;
  }

  const rows = projects.map((project: any) => [
    {
      text: getProjectTitle(project).slice(0, 52),
      callback_data: `task:project:${project._id.toString()}`,
    },
  ]);
  rows.push([
    { text: 'وظایف باز من', callback_data: 'task:open_tasks' },
    { text: 'انصراف', callback_data: 'task:cancel' },
  ]);

  await sendMessage(
    chatId,
    'پروژه مورد نظر را انتخاب کنید. مسئول وظیفه در مرحله بعد فقط از میان افراد تعیین‌شده در همان پروژه انتخاب می‌شود:',
    buildInlineKeyboard(rows),
  );
};

const listOpenTasks = async (
  chatId: string,
  telegramUserId: string,
): Promise<void> => {
  const actor = await ensureLinkedActor(chatId, telegramUserId);
  if (!actor) return;

  const role = String(actor.role);
  const filter: Record<string, unknown> = {
    status: { $in: OPEN_TASK_STATUSES },
  };

  if (role === UserRole.MANAGER) {
    filter.$or = [{ assignedUserIds: actor._id }, { createdBy: actor._id }];
  } else if (role !== UserRole.BOARD) {
    filter.assignedUserIds = actor._id;
  }

  const tasks = await ProjectTask.find(filter)
    .populate('projectId', 'title status priority')
    .populate('assignedUserIds', 'fullName username role isActive')
    .sort({ dueDate: 1, updatedAt: -1 })
    .limit(20);

  if (!tasks.length) {
    await sendMessage(
      chatId,
      'هیچ وظیفه باز و انجام‌نشده‌ای برای شما پیدا نشد.',
      buildTaskHomeKeyboard(),
    );
    return;
  }

  const now = Date.now();
  const summary = tasks.map((task: any, index: number) => {
    const dueAt = task.dueDate ? new Date(task.dueDate).getTime() : 0;
    const overdue = dueAt > 0 && dueAt < now;
    const assignees = Array.isArray(task.assignedUserIds)
      ? task.assignedUserIds.map(getUserDisplayName).join('، ')
      : '';

    return [
      `${index + 1}. <b>${escapeTelegramHtml(task.title)}</b>`,
      `پروژه: ${escapeTelegramHtml(getProjectTitleFromTask(task))}`,
      `وضعیت: ${escapeTelegramHtml(PROJECT_TASK_STATUS_LABELS[task.status as ProjectTaskStatus] || task.status)}`,
      `اولویت: ${escapeTelegramHtml(PROJECT_PRIORITY_LABELS[task.priority as ProjectPriority] || task.priority)}`,
      `مسئول: ${escapeTelegramHtml(assignees || 'تعیین نشده')}`,
      `مهلت: ${overdue ? '⚠️ ' : ''}${escapeTelegramHtml(formatDate(task.dueDate))}`,
    ].join('\n');
  });

  const rows = tasks.slice(0, 12).map((task: any) => [
    {
      text: `مشاهده: ${String(task.title).slice(0, 38)}`,
      callback_data: `task:view:${task._id.toString()}`,
    },
  ]);
  rows.push([{ text: 'منوی وظایف', callback_data: 'task:home' }]);

  await sendMessage(
    chatId,
    ['وظایف باز:', '', ...summary].join('\n\n'),
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
    .populate('ownerId', 'fullName username role isActive')
    .populate('assignedUserIds', 'fullName username role isActive')
    .populate('projectMembers.userId', 'fullName username role isActive');

  if (!project) {
    await sendMessage(chatId, 'پروژه انتخاب‌شده پیدا نشد.');
    await clearSession(chatId);
    return;
  }

  const candidateMap = new Map<string, any>();
  const addCandidate = (candidate: any) => {
    if (
      !candidate?._id ||
      candidate.isActive === false ||
      String(candidate.role) === UserRole.BOARD
    ) {
      return;
    }
    candidateMap.set(String(candidate._id), candidate);
  };

  addCandidate((project as any).ownerId);
  ((project as any).assignedUserIds || []).forEach(addCandidate);
  ((project as any).projectMembers || []).forEach((member: any) =>
    addCandidate(member?.userId),
  );

  const candidates = Array.from(candidateMap.values());

  if (!candidates.length) {
    await sendMessage(
      chatId,
      [
        `پروژه «${escapeTelegramHtml(project.title)}» هنوز مسئول یا عضو ندارد.`,
        '',
        'ابتدا افراد و مسئولیت‌ها را در صفحه ویرایش پروژه تعیین کنید؛ سپس ثبت وظیفه از ربات امکان‌پذیر است.',
      ].join('\n'),
      buildInlineKeyboard([
        [{ text: 'انتخاب پروژه دیگر', callback_data: 'task:back:projects' }],
        [{ text: 'لغو', callback_data: 'task:cancel' }],
      ]),
    );
    await clearSession(chatId);
    return;
  }

  const session = await getActiveTaskSession(chatId);
  if (!session) {
    await sendMessage(chatId, 'فرآیند ثبت وظیفه منقضی شده است. دوباره /task را بزنید.');
    return;
  }

  await TelegramTaskSession.findByIdAndUpdate(session._id, {
    step: 'select_assignee',
    selectedProjectId: project._id,
    selectedAssigneeId: null,
    selectedManagerId: null,
    taskTitle: '',
    taskDescription: '',
    taskPriority: 'medium',
    taskDueDate: null,
  });

  const rows = candidates.slice(0, 30).map((candidate: any) => [
    {
      text: `${getUserDisplayName(candidate)} — ${candidate.role === UserRole.MANAGER ? 'مدیر' : candidate.role === UserRole.BOARD ? 'هیئت مدیره' : 'کارشناس'}`.slice(0, 58),
      callback_data: `task:assignee:${candidate._id.toString()}`,
    },
  ]);
  rows.push([
    { text: 'بازگشت به پروژه‌ها', callback_data: 'task:back:projects' },
    { text: 'انصراف', callback_data: 'task:cancel' },
  ]);

  await sendMessage(
    chatId,
    `پروژه انتخاب شد: <b>${escapeTelegramHtml(project.title)}</b>\n\nمسئول وظیفه را از میان افراد پروژه انتخاب کنید:`,
    buildInlineKeyboard(rows),
  );
};

const handleAssigneeSelected = async (
  chatId: string,
  telegramUserId: string,
  assigneeId: string,
): Promise<void> => {
  const actor = await ensureManagerActor(chatId, telegramUserId);
  if (!actor) return;

  if (!Types.ObjectId.isValid(assigneeId)) {
    await sendMessage(chatId, 'شناسه مسئول معتبر نیست.');
    return;
  }

  const session = await getActiveTaskSession(chatId);
  if (!session?.selectedProjectId) {
    await sendMessage(chatId, 'فرآیند ثبت وظیفه پیدا نشد. دوباره /task را بزنید.');
    await clearSession(chatId);
    return;
  }

  const project = await Project.findOne({
    _id: session.selectedProjectId,
    $or: [
      { ownerId: new Types.ObjectId(assigneeId) },
      { assignedUserIds: new Types.ObjectId(assigneeId) },
      { 'projectMembers.userId': new Types.ObjectId(assigneeId) },
    ],
  });
  const assignee = await User.findOne({
    _id: new Types.ObjectId(assigneeId),
    isActive: true,
  });

  if (!project || !assignee) {
    await sendMessage(
      chatId,
      'این کاربر دیگر عضو پروژه نیست یا غیرفعال شده است. پروژه را دوباره انتخاب کنید.',
    );
    await clearSession(chatId);
    return;
  }

  await TelegramTaskSession.findByIdAndUpdate(session._id, {
    step: 'select_priority',
    selectedAssigneeId: assignee._id,
    selectedManagerId: assignee._id,
  });

  await sendMessage(
    chatId,
    `مسئول انتخاب شد: <b>${escapeTelegramHtml(getUserDisplayName(assignee))}</b>\n\nاولویت وظیفه را انتخاب کنید:`,
    buildInlineKeyboard([
      [
        { text: 'کم', callback_data: 'task:priority:low' },
        { text: 'متوسط', callback_data: 'task:priority:medium' },
      ],
      [
        { text: 'زیاد', callback_data: 'task:priority:high' },
        { text: 'بحرانی', callback_data: 'task:priority:critical' },
      ],
      [{ text: 'انصراف', callback_data: 'task:cancel' }],
    ]),
  );
};

const handlePrioritySelected = async (
  chatId: string,
  telegramUserId: string,
  priority: string,
): Promise<void> => {
  const actor = await ensureManagerActor(chatId, telegramUserId);
  if (!actor) return;

  if (!Object.values(ProjectPriority).includes(priority as ProjectPriority)) {
    await sendMessage(chatId, 'اولویت انتخاب‌شده معتبر نیست.');
    return;
  }

  const session = await getActiveTaskSession(chatId);
  if (!session?.selectedAssigneeId) {
    await sendMessage(chatId, 'فرآیند ثبت وظیفه کامل نیست. دوباره /task را بزنید.');
    await clearSession(chatId);
    return;
  }

  await TelegramTaskSession.findByIdAndUpdate(session._id, {
    step: 'enter_task',
    taskPriority: priority,
  });

  await sendMessage(
    chatId,
    [
      `اولویت: <b>${escapeTelegramHtml(PROJECT_PRIORITY_LABELS[priority as ProjectPriority])}</b>`,
      '',
      'متن وظیفه را ارسال کنید:',
      'خط اول = عنوان وظیفه',
      'خط‌های بعدی = توضیحات اختیاری',
    ].join('\n'),
    buildInlineKeyboard([[{ text: 'انصراف', callback_data: 'task:cancel' }]]),
  );
};

const parseTaskText = (text: string): { title: string; description: string } => {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    title: (lines[0] || text.trim()).slice(0, 220),
    description: lines.slice(1).join('\n').trim().slice(0, 5000),
  };
};

const handleTaskText = async (
  chatId: string,
  telegramUserId: string,
  text: string,
): Promise<void> => {
  const actor = await ensureManagerActor(chatId, telegramUserId);
  if (!actor) return;

  const session = await getActiveTaskSession(chatId);
  if (
    !session ||
    session.step !== 'enter_task' ||
    !session.selectedProjectId ||
    !(session.selectedAssigneeId || session.selectedManagerId)
  ) {
    await sendMessage(chatId, 'برای ثبت وظیفه ابتدا /task را ارسال کنید.');
    await clearSession(chatId);
    return;
  }

  const parsed = parseTaskText(text);
  if (parsed.title.length < 3) {
    await sendMessage(chatId, 'عنوان وظیفه باید حداقل ۳ کاراکتر باشد.');
    return;
  }

  await TelegramTaskSession.findByIdAndUpdate(session._id, {
    step: 'select_due_date',
    taskTitle: parsed.title,
    taskDescription: parsed.description,
  });

  await sendMessage(
    chatId,
    `وظیفه: <b>${escapeTelegramHtml(parsed.title)}</b>\n\nمهلت انجام را انتخاب کنید:`,
    buildInlineKeyboard([
      [
        { text: 'امروز', callback_data: 'task:due:today' },
        { text: 'فردا', callback_data: 'task:due:tomorrow' },
      ],
      [
        { text: '۳ روز دیگر', callback_data: 'task:due:3' },
        { text: '۷ روز دیگر', callback_data: 'task:due:7' },
      ],
      [
        { text: '۱۴ روز دیگر', callback_data: 'task:due:14' },
        { text: 'بدون مهلت', callback_data: 'task:due:none' },
      ],
      [{ text: 'انصراف', callback_data: 'task:cancel' }],
    ]),
  );
};

const resolveDueDate = (value: string): Date | null | undefined => {
  if (value === 'none') return null;

  const now = new Date();
  const due = new Date(now);

  if (value === 'today') {
    due.setHours(23, 59, 59, 999);
    return due;
  }

  if (value === 'tomorrow') {
    due.setDate(due.getDate() + 1);
    due.setHours(23, 59, 59, 999);
    return due;
  }

  const days = Number(value);
  if (![3, 7, 14].includes(days)) return undefined;

  due.setDate(due.getDate() + days);
  due.setHours(23, 59, 59, 999);
  return due;
};

const handleDueDateSelected = async (
  chatId: string,
  telegramUserId: string,
  dueValue: string,
): Promise<void> => {
  const actor = await ensureManagerActor(chatId, telegramUserId);
  if (!actor) return;

  const dueDate = resolveDueDate(dueValue);
  if (dueDate === undefined) {
    await sendMessage(chatId, 'مهلت انتخاب‌شده معتبر نیست.');
    return;
  }

  const session = await getActiveTaskSession(chatId);
  if (!session?.taskTitle) {
    await sendMessage(chatId, 'اطلاعات وظیفه کامل نیست. دوباره /task را بزنید.');
    await clearSession(chatId);
    return;
  }

  await TelegramTaskSession.findByIdAndUpdate(session._id, {
    step: 'optional_file',
    taskDueDate: dueDate,
  });

  await sendMessage(
    chatId,
    [
      `مهلت: <b>${escapeTelegramHtml(formatDate(dueDate))}</b>`,
      '',
      'اکنون ویس، فایل صوتی، سند، عکس یا ویدئو را ارسال کنید. متن ویس به‌صورت خودکار استخراج می‌شود. در صورت نداشتن پیوست، گزینه زیر را بزنید.',
    ].join('\n'),
    buildInlineKeyboard([
      [{ text: 'ثبت بدون پیوست', callback_data: 'task:file:none' }],
      [{ text: 'انصراف', callback_data: 'task:cancel' }],
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

const safeOriginalName = (value: string): string => {
  return String(value || '').replace(/[^a-zA-Z0-9.\-_]/g, '_') || 'telegram-file';
};

const fileLikeToAttachment = (
  file: TelegramFileLikePayload,
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
  photos: TelegramPhotoSizePayload[] | undefined,
): TelegramPhotoSizePayload | null => {
  if (!photos?.length) return null;
  return [...photos].sort((a, b) => (b.file_size || 0) - (a.file_size || 0))[0];
};

const getTelegramAttachment = (
  message: TelegramMessagePayload,
): TelegramAttachmentInput | null => {
  if (message.voice?.file_id) {
    return fileLikeToAttachment(message.voice, 'voice', 'voice.ogg');
  }
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
  if (!photo?.file_id) return null;

  return {
    fileId: photo.file_id,
    fileUniqueId: photo.file_unique_id || '',
    originalName: 'photo.jpg',
    fileType: 'image/jpeg',
    fileSize: photo.file_size || 0,
    kind: 'photo',
  };
};

const downloadTelegramAttachment = async (
  attachment: TelegramAttachmentInput,
): Promise<DownloadedTelegramFile> => {
  const telegramFile = await getTelegramFile(attachment.fileId);
  if (!telegramFile.file_path) {
    throw new Error('مسیر فایل از تلگرام دریافت نشد.');
  }

  const buffer = await downloadTelegramFile(telegramFile.file_path);
  await fs.mkdir(uploadDir, { recursive: true });

  const pathName = safeOriginalName(path.basename(telegramFile.file_path));
  const extension =
    path.extname(pathName) ||
    path.extname(attachment.originalName) ||
    extensionFromMime(attachment.fileType || '') ||
    (attachment.kind === 'voice' ? '.ogg' : '');
  const originalName = path.extname(pathName)
    ? pathName
    : `${safeOriginalName(attachment.originalName)}${extension}`;
  const fileName = `${Date.now()}-${crypto.randomUUID()}-${originalName}`;
  const filePath = path.join(uploadDir, fileName);

  await fs.writeFile(filePath, buffer);

  return {
    fileName,
    originalName,
    fileUrl: `/api/v1/uploads/projects/tasks/${fileName}`,
    fileType:
      attachment.fileType ||
      (attachment.kind === 'voice' ? 'audio/ogg' : undefined),
    fileSize: attachment.fileSize || buffer.length,
    localPath: filePath,
  };
};

const createTaskFromSession = async (
  chatId: string,
  actor: any,
  fileMessage?: TelegramMessagePayload,
): Promise<void> => {
  const session = await getOptionalFileTaskSession(chatId);
  const assigneeId = session?.selectedAssigneeId || session?.selectedManagerId;

  if (!session?.selectedProjectId || !assigneeId || !session.taskTitle) {
    await sendMessage(chatId, 'اطلاعات وظیفه کامل نیست. دوباره /task را بزنید.');
    await clearSession(chatId);
    return;
  }

  const [project, assignee] = await Promise.all([
    Project.findById(session.selectedProjectId),
    User.findOne({ _id: assigneeId, isActive: true }),
  ]);

  if (!project || !assignee) {
    await sendMessage(chatId, 'پروژه یا مسئول انتخاب‌شده دیگر معتبر نیست.');
    await clearSession(chatId);
    return;
  }

  const task = await ProjectTask.create({
    projectId: project._id,
    title: session.taskTitle,
    description: session.taskDescription || '',
    assignedUserIds: [assignee._id],
    status: ProjectTaskStatus.TODO,
    priority: session.taskPriority || ProjectPriority.MEDIUM,
    startDate: new Date(),
    dueDate: session.taskDueDate || null,
    completedAt: null,
    createdBy: actor._id,
    updatedBy: actor._id,
    source: 'telegram_bot',
    telegramChatId: chatId,
    telegramMessageId: fileMessage?.message_id || null,
    language: 'fa',
    direction: 'rtl',
  });

  const attachment = fileMessage ? getTelegramAttachment(fileMessage) : null;
  let attachmentMessage = 'وظیفه بدون پیوست ثبت شد.';

  if (attachment) {
    try {
      const downloadedFile = await downloadTelegramAttachment(attachment);
      const transcription = await transcribeAudioPath({
        path: downloadedFile.localPath,
        originalname: downloadedFile.originalName,
        filename: downloadedFile.fileName,
        mimetype: downloadedFile.fileType || attachment.fileType,
        size: downloadedFile.fileSize || attachment.fileSize || 0,
      });

      const fileRecord = await ProjectFile.create({
        projectId: project._id,
        taskId: task._id,
        progressNoteId: null,
        uploadedBy: actor._id,
        fileName: downloadedFile.fileName,
        originalName: downloadedFile.originalName,
        fileUrl: downloadedFile.fileUrl,
        fileType: downloadedFile.fileType || attachment.fileType || '',
        fileSize: downloadedFile.fileSize || attachment.fileSize || 0,
        category: ProjectFileCategory.TASK_ATTACHMENT,
        categoryLabel:
          PROJECT_FILE_CATEGORY_LABELS[ProjectFileCategory.TASK_ATTACHMENT],
        source: 'telegram_bot',
        telegramFileId: attachment.fileId,
        telegramFileUniqueId: attachment.fileUniqueId || '',
        telegramMessageId: fileMessage?.message_id || null,
        telegramChatId: chatId,
        telegramAttachmentKind: attachment.kind,
        ...toProjectFileTranscriptionFields(transcription),
        language: 'fa',
        direction: 'rtl',
      });

      const transcript = String(fileRecord.transcriptionText || '').trim();
      if (transcript && !String(task.description || '').trim()) {
        task.description = transcript;
        await task.save();
      }

      attachmentMessage = transcript
        ? 'پیوست ذخیره و متن فایل صوتی استخراج شد.'
        : 'پیوست وظیفه ذخیره شد.';
    } catch (error) {
      console.error('Telegram task attachment save failed:', error);
      attachmentMessage = `وظیفه ثبت شد اما پیوست ذخیره نشد: ${escapeTelegramHtml(
        error instanceof Error ? error.message : 'خطای نامشخص',
      )}`;
    }
  }

  const assigneeChatId = String(
    assignee.telegramChatId || assignee.telegramUserId || '',
  );

  if (assigneeChatId && assigneeChatId !== chatId) {
    await sendMessage(
      assigneeChatId,
      [
        '📌 وظیفه جدیدی به شما تخصیص داده شد.',
        '',
        `پروژه: <b>${escapeTelegramHtml(getProjectTitle(project))}</b>`,
        `عنوان: <b>${escapeTelegramHtml(task.title)}</b>`,
        `اولویت: ${escapeTelegramHtml(PROJECT_PRIORITY_LABELS[task.priority as ProjectPriority])}`,
        `مهلت: ${escapeTelegramHtml(formatDate(task.dueDate))}`,
        `ثبت‌کننده: ${escapeTelegramHtml(getUserDisplayName(actor))}`,
      ].join('\n'),
      buildInlineKeyboard([
        [{ text: 'مشاهده وظیفه', callback_data: `task:view:${task._id}` }],
      ]),
    ).catch((error) => {
      console.error('Telegram assignee notification failed:', error);
    });
  }

  await clearSession(chatId);

  await sendMessage(
    chatId,
    [
      '✅ وظیفه با موفقیت ثبت شد.',
      '',
      `پروژه: <b>${escapeTelegramHtml(getProjectTitle(project))}</b>`,
      `مسئول: <b>${escapeTelegramHtml(getUserDisplayName(assignee))}</b>`,
      `عنوان: <b>${escapeTelegramHtml(task.title)}</b>`,
      `اولویت: ${escapeTelegramHtml(PROJECT_PRIORITY_LABELS[task.priority as ProjectPriority])}`,
      `مهلت: ${escapeTelegramHtml(formatDate(task.dueDate))}`,
      attachmentMessage,
    ].join('\n'),
    buildInlineKeyboard([
      [{ text: 'مشاهده وظیفه', callback_data: `task:view:${task._id}` }],
      [{ text: 'ثبت وظیفه دیگر', callback_data: 'task:create' }],
      [{ text: 'منوی وظایف', callback_data: 'task:home' }],
    ]),
  );
};

const showTaskDetails = async (
  chatId: string,
  telegramUserId: string,
  taskId: string,
): Promise<void> => {
  const actor = await ensureLinkedActor(chatId, telegramUserId);
  if (!actor) return;

  if (!Types.ObjectId.isValid(taskId)) {
    await sendMessage(chatId, 'شناسه وظیفه معتبر نیست.');
    return;
  }

  const task = await ProjectTask.findById(taskId)
    .populate('projectId', 'title status priority')
    .populate('assignedUserIds', 'fullName username role isActive')
    .populate('createdBy', 'fullName username role');

  if (!task || !canReadTask(actor, task)) {
    await sendMessage(chatId, 'وظیفه پیدا نشد یا به آن دسترسی ندارید.');
    return;
  }

  const files = await ProjectFile.find({ taskId: task._id })
    .sort({ createdAt: -1 })
    .limit(10)
    .select('originalName fileType transcriptionStatus transcriptionText');
  const assignees = (task.assignedUserIds as any[])
    .map(getUserDisplayName)
    .join('، ');
  const canUpdate = canUpdateTask(actor, task);

  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  if (canUpdate) {
    rows.push([
      { text: 'برای انجام', callback_data: `task:status:${task._id}:todo` },
      {
        text: 'در حال انجام',
        callback_data: `task:status:${task._id}:in_progress`,
      },
    ]);
    rows.push([
      { text: 'مسدود', callback_data: `task:status:${task._id}:blocked` },
      { text: 'انجام شد', callback_data: `task:status:${task._id}:done` },
    ]);
  }
  rows.push([{ text: 'وظایف باز', callback_data: 'task:open_tasks' }]);

  await sendMessage(
    chatId,
    [
      `<b>${escapeTelegramHtml(task.title)}</b>`,
      '',
      `پروژه: ${escapeTelegramHtml(getProjectTitleFromTask(task))}`,
      `وضعیت: ${escapeTelegramHtml(PROJECT_TASK_STATUS_LABELS[task.status as ProjectTaskStatus] || task.status)}`,
      `اولویت: ${escapeTelegramHtml(PROJECT_PRIORITY_LABELS[task.priority as ProjectPriority] || task.priority)}`,
      `مسئول: ${escapeTelegramHtml(assignees || 'تعیین نشده')}`,
      `ثبت‌کننده: ${escapeTelegramHtml(getUserDisplayName(task.createdBy))}`,
      `مهلت: ${escapeTelegramHtml(formatDate(task.dueDate))}`,
      task.description
        ? `\nتوضیحات:\n${escapeTelegramHtml(task.description)}`
        : '',
      `\nپیوست‌ها: ${files.length}`,
      files.length
        ? files
            .map((file: any, index: number) =>
              `${index + 1}. ${escapeTelegramHtml(file.originalName)}${file.transcriptionText ? ' — دارای متن استخراج‌شده' : ''}`,
            )
            .join('\n')
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
    buildInlineKeyboard(rows),
  );
};

const updateTaskStatus = async (
  chatId: string,
  telegramUserId: string,
  taskId: string,
  statusValue: string,
): Promise<void> => {
  const actor = await ensureLinkedActor(chatId, telegramUserId);
  if (!actor) return;

  const status = statusValue as ProjectTaskStatus;
  if (!Types.ObjectId.isValid(taskId) || !MUTABLE_TASK_STATUSES.has(status)) {
    await sendMessage(chatId, 'درخواست تغییر وضعیت معتبر نیست.');
    return;
  }

  const task = await ProjectTask.findById(taskId);
  if (!task || !canUpdateTask(actor, task)) {
    await sendMessage(chatId, 'اجازه تغییر وضعیت این وظیفه را ندارید.');
    return;
  }

  task.status = status;
  task.updatedBy = actor._id;
  await task.save();

  const recipientIds = [
    task.createdBy,
    ...(Array.isArray(task.assignedUserIds) ? task.assignedUserIds : []),
  ]
    .map((value: any) => String(value?._id || value || ''))
    .filter((value) => value && value !== String(actor._id));

  if (recipientIds.length) {
    const recipients = await User.find({
      _id: { $in: recipientIds },
      isActive: true,
    }).select('fullName username telegramChatId telegramUserId');

    await Promise.all(
      recipients.map(async (recipient: any) => {
        const recipientChatId = String(
          recipient.telegramChatId || recipient.telegramUserId || '',
        );
        if (!recipientChatId || recipientChatId === chatId) return;

        await sendMessage(
          recipientChatId,
          [
            '🔄 وضعیت یک وظیفه تغییر کرد.',
            '',
            `وظیفه: <b>${escapeTelegramHtml(task.title)}</b>`,
            `وضعیت جدید: <b>${escapeTelegramHtml(PROJECT_TASK_STATUS_LABELS[status])}</b>`,
            `تغییردهنده: ${escapeTelegramHtml(getUserDisplayName(actor))}`,
          ].join('\n'),
          buildInlineKeyboard([
            [{ text: 'مشاهده وظیفه', callback_data: `task:view:${task._id}` }],
          ]),
        ).catch((error) => {
          console.error('Telegram task status notification failed:', error);
        });
      }),
    );
  }

  await sendMessage(
    chatId,
    `وضعیت وظیفه «${escapeTelegramHtml(task.title)}» به <b>${escapeTelegramHtml(PROJECT_TASK_STATUS_LABELS[status])}</b> تغییر کرد.`,
  );
  await showTaskDetails(chatId, telegramUserId, taskId);
};

const handleOptionalAttachmentMessage = async (
  chatId: string,
  telegramUserId: string,
  message: TelegramMessagePayload,
): Promise<void> => {
  const actor = await ensureManagerActor(chatId, telegramUserId);
  if (!actor) return;

  const session = await getOptionalFileTaskSession(chatId);
  if (!session) {
    await sendMessage(
      chatId,
      'برای ثبت پیوست ابتدا فرآیند /task را تا مرحله پیوست ادامه دهید.',
      buildTaskHomeKeyboard(),
    );
    return;
  }

  if (!getTelegramAttachment(message)) {
    await sendMessage(
      chatId,
      'فقط ویس، فایل صوتی، سند، عکس یا ویدئو قابل قبول است.',
      buildInlineKeyboard([
        [{ text: 'ثبت بدون پیوست', callback_data: 'task:file:none' }],
        [{ text: 'انصراف', callback_data: 'task:cancel' }],
      ]),
    );
    return;
  }

  await createTaskFromSession(chatId, actor, message);
};

const handleCallbackQuery = async (
  callbackQuery: TelegramCallbackQueryPayload,
): Promise<void> => {
  const data = String(callbackQuery.data || '');
  const message = callbackQuery.message;
  const chatId = getChatId(message);
  const telegramUserId = getTelegramUserId(message, callbackQuery);

  if (!chatId) return;
  await answerCallbackQuery(callbackQuery.id);

  if (data === 'task:cancel') {
    await clearSession(chatId);
    await sendMessage(chatId, 'فرآیند ثبت وظیفه لغو شد.', buildTaskHomeKeyboard());
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
    await handleProjectSelected(
      chatId,
      telegramUserId,
      data.replace('task:project:', ''),
    );
    return;
  }
  if (data.startsWith('task:assignee:') || data.startsWith('task:manager:')) {
    await handleAssigneeSelected(
      chatId,
      telegramUserId,
      data.replace('task:assignee:', '').replace('task:manager:', ''),
    );
    return;
  }
  if (data.startsWith('task:priority:')) {
    await handlePrioritySelected(
      chatId,
      telegramUserId,
      data.replace('task:priority:', ''),
    );
    return;
  }
  if (data.startsWith('task:due:')) {
    await handleDueDateSelected(
      chatId,
      telegramUserId,
      data.replace('task:due:', ''),
    );
    return;
  }
  if (data === 'task:file:none') {
    const actor = await ensureManagerActor(chatId, telegramUserId);
    if (actor) await createTaskFromSession(chatId, actor);
    return;
  }
  if (data.startsWith('task:view:')) {
    await showTaskDetails(
      chatId,
      telegramUserId,
      data.replace('task:view:', ''),
    );
    return;
  }
  if (data.startsWith('task:status:')) {
    const parts = data.split(':');
    await updateTaskStatus(chatId, telegramUserId, parts[2] || '', parts[3] || '');
    return;
  }

  await sendMessage(chatId, 'دستور وظیفه معتبر نیست.', buildTaskHomeKeyboard());
};

const handleTextMessage = async (
  message: TelegramMessagePayload,
): Promise<void> => {
  const chatId = getChatId(message);
  const telegramUserId = getTelegramUserId(message);
  const text = String(message.text || '').trim();

  if (!chatId) return;

  if (['/cancel', 'انصراف', 'لغو عملیات'].includes(text)) {
    await clearSession(chatId);
    await sendMessage(chatId, 'فرآیند فعلی لغو شد.', buildTaskHomeKeyboard());
    return;
  }
  if (
    ['/tasks', '/mytasks', 'وظایف باز من', 'وظایف من', 'کارهای باز من'].includes(
      text,
    )
  ) {
    await listOpenTasks(chatId, telegramUserId);
    return;
  }
  if (
    ['/task', '/newtask', 'ثبت وظیفه', 'تعریف وظیفه', 'ثبت وظیفه جدید'].includes(
      text,
    )
  ) {
    await startTaskFlow(chatId, telegramUserId);
    return;
  }

  const actor = await ensureLinkedActor(chatId, telegramUserId);
  if (!actor) return;

  const session = await getActiveTaskSession(chatId);
  if (!session) {
    await showTaskHome(chatId, telegramUserId);
    return;
  }

  if (session.step === 'enter_task') {
    await handleTaskText(chatId, telegramUserId, text);
    return;
  }
  if (session.step === 'optional_file') {
    if (['/skip', 'بدون فایل', 'بدون پیوست'].includes(text)) {
      if (String(actor.role) === UserRole.MANAGER) {
        await createTaskFromSession(chatId, actor);
      }
      return;
    }

    await sendMessage(
      chatId,
      'در این مرحله پیوست را ارسال کنید یا «ثبت بدون پیوست» را بزنید.',
      buildInlineKeyboard([
        [{ text: 'ثبت بدون پیوست', callback_data: 'task:file:none' }],
        [{ text: 'انصراف', callback_data: 'task:cancel' }],
      ]),
    );
    return;
  }

  await sendMessage(chatId, 'لطفاً یکی از گزینه‌های نمایش‌داده‌شده را انتخاب کنید.');
};

const messageHasAttachment = (message: TelegramMessagePayload): boolean => {
  return Boolean(
    message.voice ||
      message.audio ||
      message.document ||
      message.video ||
      message.photo?.length,
  );
};

export const telegramTaskBotService = {
  async handleUpdate(update: TelegramUpdatePayload): Promise<void> {
    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
      return;
    }

    if (!update.message) return;

    if (messageHasAttachment(update.message)) {
      await handleOptionalAttachmentMessage(
        getChatId(update.message),
        getTelegramUserId(update.message),
        update.message,
      );
      return;
    }

    if (update.message.text) {
      await handleTextMessage(update.message);
    }
  },
};
