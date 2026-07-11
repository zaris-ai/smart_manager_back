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
  PROJECT_PRIORITY_LABELS,
  PROJECT_STATUS_LABELS,
  PROJECT_TASK_STATUS_LABELS,
  ProjectPhase,
  ProjectPriority,
  ProjectProgressNote,
  ProjectSource,
  ProjectStatus,
  ProjectTask,
  ProjectTaskStatus,
} from '@/modules/projects/project.model';
import {
  isTranscribableAudioMeta,
  toProjectFileTranscriptionFields,
  transcribeAudioPath,
} from '@/modules/projects/audio-transcription.service';
import User, { UserRole } from '@/modules/users/user.model';
import TelegramLinkCode, {
  hashTelegramLinkCode,
} from '@/modules/telegram/telegram-link-code.model';
import TelegramBotSession, {
  TelegramBotSessionStep,
} from '@/modules/telegram/telegram-bot-session.model';
import TelegramTaskSession from '@/modules/telegram/telegram-task-session.model';
import {
  answerTelegramCallbackQuery,
  downloadTelegramFile,
  escapeTelegramHtml,
  getTelegramBotIdentity,
  getTelegramFile,
  getTelegramWebhookInfo,
  isTelegramBotWebhookConfigured,
  sendTelegramBotMessage,
} from '@/modules/telegram/telegram.service';
import { telegramTaskBotService } from '@/modules/telegram/telegram-task-bot.service';
import {
  TelegramCallbackQueryPayload,
  TelegramFileLikePayload,
  TelegramMessagePayload,
  TelegramPhotoSizePayload,
  TelegramUpdatePayload,
} from '@/modules/telegram/telegram.types';

type BotUser = {
  _id: Types.ObjectId;
  fullName: string;
  username: string;
  role: UserRole;
  isActive: boolean;
};

type MediaCandidate = {
  fileId: string;
  fileUniqueId: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  kind: 'voice' | 'audio' | 'document' | 'photo' | 'video';
};

const PROJECT_SELECT_LIMIT = 12;
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

const getUserFilter = (message: TelegramMessagePayload) => ({
  isActive: true,
  $or: [
    { telegramUserId: getTelegramUserId(message) },
    { telegramChatId: getChatId(message) },
  ],
});

const getLinkedUser = async (
  message: TelegramMessagePayload,
): Promise<BotUser | null> => {
  return User.findOne(getUserFilter(message)).select(
    '_id fullName username role isActive',
  );
};

const isReadAllRole = (user: BotUser): boolean => {
  return [UserRole.MANAGER, UserRole.BOARD].includes(user.role as UserRole);
};

const canWriteProjectData = (user: BotUser): boolean => {
  return user.role !== UserRole.BOARD;
};

const buildMainKeyboard = (user?: BotUser | null) => {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [
    [{ text: 'خلاصه مدیریتی', callback_data: 'bot:summary' }],
    [{ text: 'پروژه‌ها و جزئیات', callback_data: 'bot:list_projects' }],
    [{ text: 'وظایف باز من', callback_data: 'task:open_tasks' }],
  ];

  if (user?.role === UserRole.MANAGER) {
    rows.push([{ text: 'ثبت وظیفه جدید', callback_data: 'task:create' }]);
  }

  if (user && canWriteProjectData(user)) {
    rows.push([{ text: 'ثبت گزارش پروژه', callback_data: 'bot:add_report' }]);
  }

  if (user && isReadAllRole(user)) {
    rows.push([
      { text: 'پروژه‌های نیازمند تخصیص', callback_data: 'bot:staffing' },
    ]);
  }

  rows.push([{ text: 'راهنما', callback_data: 'bot:help' }]);
  rows.push([{ text: 'لغو عملیات جاری', callback_data: 'bot:cancel' }]);

  return { inline_keyboard: rows };
};

const buildDefaultReplyKeyboard = () => ({
  keyboard: [
    [{ text: 'خلاصه مدیریتی' }, { text: 'پروژه‌های من' }],
    [{ text: 'وظایف باز من' }, { text: 'ثبت وظیفه' }],
    [{ text: 'ثبت گزارش پروژه' }, { text: 'لغو عملیات' }],
  ],
  resize_keyboard: true,
  one_time_keyboard: false,
  is_persistent: true,
});

const buildBotGuideText = (user: BotUser): string => {
  const roleLine =
    user.role === UserRole.MANAGER
      ? 'شما دسترسی مدیریتی دارید: مشاهده همه پروژه‌ها، ثبت وظیفه برای اعضای پروژه، گزارش‌گیری و مشاهده پروژه‌های بدون تخصیص.'
      : user.role === UserRole.BOARD
        ? 'شما دسترسی نظارتی دارید: مشاهده خلاصه، پروژه‌ها، فازها، وضعیت مالی و وظایف بدون امکان تغییر داده.'
        : 'شما پروژه‌ها و وظایفی را می‌بینید که در پنل به شما تخصیص داده شده‌اند.';

  return [
    `سلام ${escapeTelegramHtml(user.fullName || user.username)}.`,
    '',
    '<b>ربات مدیریت پروژه آوید</b>',
    roleLine,
    '',
    'قابلیت‌ها:',
    '• خلاصه مدیریتی پروژه‌ها و وظایف',
    '• مشاهده جزئیات پروژه، فازها، مالی، گزارش‌ها و وظایف',
    '• ثبت گزارش متنی، فایل، عکس، ویدئو و ویس با تبدیل صدا به متن',
    '• ثبت وظیفه برای اعضای واقعی پروژه با اولویت و مهلت',
    '• مشاهده و تغییر وضعیت وظایف مجاز',
    '• نمایش پروژه‌هایی که هنوز افراد و مسئولیت‌ها در آن‌ها تعیین نشده‌اند',
    '',
    'دستورات:',
    '/start — راهنما و منوی اصلی',
    '/link CODE — اتصال امن حساب با کد یک‌بارمصرف',
    '/summary — خلاصه مدیریتی',
    '/projects — پروژه‌ها',
    '/tasks — وظایف باز',
    '/task — ثبت وظیفه',
    '/report — ثبت گزارش پروژه',
    '/staffing — پروژه‌های نیازمند تخصیص',
    '/cancel — لغو عملیات جاری',
  ].join('\n');
};

const formatDate = (value?: Date | string | null): string => {
  if (!value) return 'تعیین نشده';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'تعیین نشده';

  return new Intl.DateTimeFormat('fa-IR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
};

const formatMoney = (value: number, currency = 'IRR'): string => {
  return `${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 2 }).format(
    Number(value || 0),
  )} ${escapeTelegramHtml(currency || 'IRR')}`;
};

const getAccessibleProjectFilter = async (
  user: BotUser,
): Promise<Record<string, unknown>> => {
  if (isReadAllRole(user)) return {};

  const phaseProjectIds = await ProjectPhase.distinct('projectId', {
    assignedUserIds: user._id,
  });

  return {
    $or: [
      { ownerId: user._id },
      { assignedUserIds: user._id },
      { 'projectMembers.userId': user._id },
      ...(phaseProjectIds.length ? [{ _id: { $in: phaseProjectIds } }] : []),
    ],
  };
};

const getAccessibleProjects = async (user: BotUser, limit = PROJECT_SELECT_LIMIT) => {
  const filter = await getAccessibleProjectFilter(user);

  return Project.find(filter)
    .select(
      '_id title status statusLabel priority priorityLabel startDate dueDate ownerId assignedUserIds projectMembers',
    )
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(limit);
};

const getAccessibleProjectById = async (user: BotUser, projectId: string) => {
  if (!isValidObjectId(projectId)) return null;

  const accessFilter = await getAccessibleProjectFilter(user);
  return Project.findOne({
    _id: toObjectId(projectId),
    ...accessFilter,
  });
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

const extractTelegramLinkCode = (text: string): string | null => {
  const normalized = String(text || '').trim();
  const directMatch = normalized.match(/^\/link(?:@[a-z0-9_]+)?\s+([a-z0-9]+)$/i);
  if (directMatch?.[1]) return directMatch[1].toUpperCase();

  const startMatch = normalized.match(
    /^\/start(?:@[a-z0-9_]+)?\s+link_([a-z0-9]+)$/i,
  );
  return startMatch?.[1] ? startMatch[1].toUpperCase() : null;
};

const isTelegramLinkCommand = (text: string): boolean => {
  return /^\/link(?:@[a-z0-9_]+)?(?:\s|$)/i.test(text) ||
    /^\/start(?:@[a-z0-9_]+)?\s+link_/i.test(text);
};

const handleTelegramLinkCommand = async (
  message: TelegramMessagePayload,
  text: string,
): Promise<boolean> => {
  if (!isTelegramLinkCommand(text)) return false;

  const code = extractTelegramLinkCode(text);
  if (!code) {
    await sendTelegramBotMessage(
      getChatId(message),
      [
        'کد اتصال وارد نشده یا نامعتبر است.',
        '',
        'مدیر سامانه باید از صفحه مدیریت ربات برای شما کد یک‌بارمصرف بسازد.',
        'سپس دستور را به شکل زیر ارسال کنید:',
        '<code>/link ABCD2345</code>',
      ].join('\n'),
    );
    return true;
  }

  const token = await TelegramLinkCode.findOne({
    codeHash: hashTelegramLinkCode(code),
    expiresAt: { $gt: new Date() },
  });

  if (!token) {
    await sendTelegramBotMessage(
      getChatId(message),
      'کد اتصال معتبر نیست، منقضی شده یا قبلاً استفاده شده است. کد جدیدی از مدیر سامانه دریافت کنید.',
    );
    return true;
  }

  const telegramUserId = getTelegramUserId(message);
  const telegramChatId = getChatId(message);
  const telegramUsername = getTelegramUsername(message);

  const conflict = await User.findOne({
    _id: { $ne: token.userId },
    $or: [
      { telegramUserId },
      { telegramChatId },
    ],
  }).select('_id fullName username');

  if (conflict) {
    await sendTelegramBotMessage(
      telegramChatId,
      'این حساب تلگرام قبلاً به کاربر دیگری متصل شده است. ابتدا مدیر سامانه باید اتصال قبلی را حذف کند.',
    );
    return true;
  }

  const user = await User.findOne({
    _id: token.userId,
    isActive: true,
  }).select('_id fullName username role isActive telegramUserId telegramChatId telegramUsername');

  if (!user) {
    await TelegramLinkCode.deleteOne({ _id: token._id });
    await sendTelegramBotMessage(
      telegramChatId,
      'کاربر مرتبط با این کد فعال نیست. با مدیر سامانه تماس بگیرید.',
    );
    return true;
  }

  const consumed = await TelegramLinkCode.findOneAndDelete({
    _id: token._id,
    codeHash: token.codeHash,
    expiresAt: { $gt: new Date() },
  });

  if (!consumed) {
    await sendTelegramBotMessage(
      telegramChatId,
      'این کد هم‌اکنون استفاده شده یا منقضی شده است. کد جدید دریافت کنید.',
    );
    return true;
  }

  user.telegramUserId = telegramUserId;
  user.telegramChatId = telegramChatId;
  user.telegramUsername = telegramUsername;
  user.updatedBy = user._id;
  await user.save();

  await Promise.all([
    TelegramLinkCode.deleteMany({ userId: user._id }),
    TelegramBotSession.deleteMany({
      $or: [
        { linkedUserId: user._id },
        { telegramUserId },
        { telegramChatId },
      ],
    }),
    TelegramTaskSession.deleteMany({
      $or: [{ actorUserId: user._id }, { chatId: telegramChatId }],
    }),
  ]);

  await sendTelegramBotMessage(
    telegramChatId,
    [
      '✅ حساب تلگرام با موفقیت متصل شد.',
      '',
      `کاربر: <b>${escapeTelegramHtml(user.fullName || user.username)}</b>`,
      'از این پس دسترسی‌های ربات بر اساس نقش و عضویت واقعی شما در پروژه‌ها اعمال می‌شود.',
    ].join('\n'),
    { replyMarkup: buildMainKeyboard(user as BotUser) },
  );

  return true;
};

const sendUnlinkedUserMessage = async (message: TelegramMessagePayload) => {
  const telegramChatId = getChatId(message);

  await sendTelegramBotMessage(
    telegramChatId,
    [
      'حساب تلگرام شما هنوز به کاربر پنل متصل نشده است.',
      '',
      'برای اتصال امن، مدیر سامانه باید از صفحه «مدیریت ربات تلگرام» یک کد یک‌بارمصرف برای شما بسازد.',
      'پس از دریافت کد، دستور زیر را ارسال کنید:',
      '<code>/link CODE</code>',
      '',
      'کد اتصال ۱۵ دقیقه اعتبار دارد و فقط یک‌بار قابل استفاده است.',
    ].join('\n'),
  );
};

const sendSummary = async (message: TelegramMessagePayload, user: BotUser) => {
  const projectFilter = await getAccessibleProjectFilter(user);
  const projects = await Project.find(projectFilter).select(
    '_id status dueDate ownerId assignedUserIds projectMembers',
  );
  const projectIds = projects.map((project) => project._id);
  const taskFilter: Record<string, unknown> = {
    projectId: { $in: projectIds },
    status: {
      $in: [
        ProjectTaskStatus.TODO,
        ProjectTaskStatus.IN_PROGRESS,
        ProjectTaskStatus.BLOCKED,
      ],
    },
  };

  if (!isReadAllRole(user)) {
    taskFilter.assignedUserIds = user._id;
  }

  const [openTasks, recentReportsCount] = await Promise.all([
    ProjectTask.find(taskFilter).select('status dueDate'),
    ProjectProgressNote.countDocuments({
      projectId: { $in: projectIds },
      createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    }),
  ]);

  const now = Date.now();
  const overdueProjects = projects.filter(
    (project) =>
      project.dueDate &&
      new Date(project.dueDate).getTime() < now &&
      ![ProjectStatus.COMPLETED, ProjectStatus.CANCELLED].includes(project.status),
  ).length;
  const overdueTasks = openTasks.filter(
    (task) => task.dueDate && new Date(task.dueDate).getTime() < now,
  ).length;
  const staffingPending = projects.filter(
    (project) =>
      !project.ownerId ||
      !project.assignedUserIds?.length ||
      !project.projectMembers?.length,
  ).length;

  const statusCounts = projects.reduce<Record<string, number>>((acc, project) => {
    acc[project.status] = (acc[project.status] || 0) + 1;
    return acc;
  }, {});

  const lines = [
    '<b>خلاصه مدیریتی</b>',
    '',
    `پروژه‌های قابل دسترسی: <b>${projects.length}</b>`,
    `فعال: <b>${statusCounts[ProjectStatus.ACTIVE] || 0}</b>`,
    `در برنامه‌ریزی: <b>${statusCounts[ProjectStatus.PLANNING] || 0}</b>`,
    `متوقف: <b>${statusCounts[ProjectStatus.ON_HOLD] || 0}</b>`,
    `تکمیل‌شده: <b>${statusCounts[ProjectStatus.COMPLETED] || 0}</b>`,
    `پروژه عقب‌افتاده: <b>${overdueProjects}</b>`,
    '',
    `وظایف باز: <b>${openTasks.length}</b>`,
    `وظایف عقب‌افتاده: <b>${overdueTasks}</b>`,
    `گزارش‌های ۷ روز اخیر: <b>${recentReportsCount}</b>`,
  ];

  if (isReadAllRole(user)) {
    lines.push(`پروژه نیازمند تعیین افراد/مسئولیت: <b>${staffingPending}</b>`);
  }

  await sendTelegramBotMessage(getChatId(message), lines.join('\n'), {
    replyMarkup: buildMainKeyboard(user),
  });
};

const sendProjectSelection = async (
  message: TelegramMessagePayload,
  user: BotUser,
) => {
  if (!canWriteProjectData(user)) {
    await sendTelegramBotMessage(
      getChatId(message),
      'نقش هیئت مدیره دسترسی مشاهده دارد و نمی‌تواند گزارش جدید ثبت کند.',
      { replyMarkup: buildMainKeyboard(user) },
    );
    return;
  }

  const projects = await getAccessibleProjects(user);
  if (!projects.length) {
    await sendTelegramBotMessage(
      getChatId(message),
      'هیچ پروژه‌ای برای ثبت گزارش در دسترس شما نیست.',
      { replyMarkup: buildMainKeyboard(user) },
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

  await sendTelegramBotMessage(getChatId(message), 'پروژه گزارش را انتخاب کنید:', {
    replyMarkup: {
      inline_keyboard: [
        ...projects.map((project) => [
          {
            text: project.title.slice(0, 48),
            callback_data: `bot:report_project:${project._id}`,
          },
        ]),
        [{ text: 'لغو', callback_data: 'bot:cancel' }],
      ],
    },
  });
};

const sendProjectsList = async (
  message: TelegramMessagePayload,
  user: BotUser,
) => {
  const projects = await getAccessibleProjects(user);

  if (!projects.length) {
    await sendTelegramBotMessage(getChatId(message), 'هیچ پروژه‌ای برای شما پیدا نشد.', {
      replyMarkup: buildMainKeyboard(user),
    });
    return;
  }

  const rows = projects.map((project) => [
    {
      text: `${PROJECT_STATUS_LABELS[project.status] || project.status} | ${project.title}`.slice(
        0,
        58,
      ),
      callback_data: `bot:view:${project._id}`,
    },
  ]);
  rows.push([{ text: 'خلاصه مدیریتی', callback_data: 'bot:summary' }]);

  const text = [
    '<b>پروژه‌های قابل دسترسی</b>',
    '',
    ...projects.map((project, index) => {
      const staffingIncomplete =
        !project.ownerId ||
        !project.assignedUserIds?.length ||
        !project.projectMembers?.length;
      return `${index + 1}. ${escapeTelegramHtml(project.title)} — ${escapeTelegramHtml(
        PROJECT_STATUS_LABELS[project.status] || project.status,
      )}${staffingIncomplete ? ' — ⚠️ تخصیص ناقص' : ''}`;
    }),
  ].join('\n');

  await sendTelegramBotMessage(getChatId(message), text, {
    replyMarkup: { inline_keyboard: rows },
  });
};

const sendProjectDetails = async (
  message: TelegramMessagePayload,
  user: BotUser,
  projectId: string,
) => {
  const project = await getAccessibleProjectById(user, projectId);
  if (!project) {
    await sendTelegramBotMessage(
      getChatId(message),
      'پروژه پیدا نشد یا به آن دسترسی ندارید.',
      { replyMarkup: buildMainKeyboard(user) },
    );
    return;
  }

  await project.populate([
    { path: 'ownerId', select: 'fullName username role' },
    { path: 'assignedUserIds', select: 'fullName username role' },
    { path: 'projectMembers.userId', select: 'fullName username role' },
    { path: 'projectMembers.roleId', select: 'title' },
  ]);

  const [phases, tasks, noteCount, fileCount] = await Promise.all([
    ProjectPhase.find({ projectId: project._id }).sort({ order: 1 }),
    ProjectTask.find({ projectId: project._id }).select('status dueDate'),
    ProjectProgressNote.countDocuments({ projectId: project._id }),
    ProjectFile.countDocuments({ projectId: project._id }),
  ]);

  const financial = phases.reduce(
    (acc, phase) => {
      acc.expectedRevenue += Number(phase.financial?.expectedRevenue || 0);
      acc.expectedExpense += Number(phase.financial?.expectedExpense || 0);
      acc.realizedRevenue += Number(phase.financial?.realizedRevenue || 0);
      acc.realizedExpense += Number(phase.financial?.realizedExpense || 0);
      return acc;
    },
    {
      expectedRevenue: 0,
      expectedExpense: 0,
      realizedRevenue: 0,
      realizedExpense: 0,
    },
  );

  const doneTasks = tasks.filter((task) => task.status === ProjectTaskStatus.DONE).length;
  const openTasks = tasks.filter((task) =>
    [
      ProjectTaskStatus.TODO,
      ProjectTaskStatus.IN_PROGRESS,
      ProjectTaskStatus.BLOCKED,
    ].includes(task.status),
  ).length;
  const progressPercent = tasks.length
    ? Math.round((doneTasks / tasks.length) * 100)
    : 0;
  const staffingIncomplete =
    !project.ownerId ||
    !project.assignedUserIds?.length ||
    !project.projectMembers?.length;
  const owner = (project as any).ownerId;
  const currency = phases.find((phase) => phase.financial?.currency)?.financial
    ?.currency || 'IRR';

  const text = [
    `<b>${escapeTelegramHtml(project.title)}</b>`,
    '',
    `وضعیت: ${escapeTelegramHtml(PROJECT_STATUS_LABELS[project.status] || project.status)}`,
    `اولویت: ${escapeTelegramHtml(PROJECT_PRIORITY_LABELS[project.priority] || project.priority)}`,
    `شروع: ${escapeTelegramHtml(formatDate(project.startDate))}`,
    `سررسید: ${escapeTelegramHtml(formatDate(project.dueDate))}`,
    `مسئول پروژه: ${escapeTelegramHtml(owner?.fullName || owner?.username || 'تعیین نشده')}`,
    `اعضا: ${project.assignedUserIds?.length || 0}`,
    staffingIncomplete ? '⚠️ افراد یا مسئولیت‌های پروژه هنوز کامل نشده‌اند.' : '',
    '',
    `فازها: ${phases.length}`,
    `وظایف: ${tasks.length} | باز: ${openTasks} | انجام‌شده: ${doneTasks}`,
    `پیشرفت وظایف: ${progressPercent}%`,
    `گزارش‌ها: ${noteCount} | فایل‌ها: ${fileCount}`,
    '',
    `درآمد تحقق‌یافته: ${formatMoney(financial.realizedRevenue, currency)}`,
    `هزینه تحقق‌یافته: ${formatMoney(financial.realizedExpense, currency)}`,
    `تراز تحقق‌یافته: ${formatMoney(
      financial.realizedRevenue - financial.realizedExpense,
      currency,
    )}`,
    project.description
      ? `\nتوضیحات:\n${escapeTelegramHtml(project.description.slice(0, 1000))}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const rows: Array<Array<{ text: string; callback_data: string }>> = [
    [
      { text: 'فازها', callback_data: `bot:phases:${project._id}` },
      { text: 'وظایف', callback_data: `bot:tasks:${project._id}` },
    ],
    [
      { text: 'مالی', callback_data: `bot:finance:${project._id}` },
      { text: 'گزارش‌های اخیر', callback_data: `bot:notes:${project._id}` },
    ],
  ];

  if (canWriteProjectData(user)) {
    rows.push([
      { text: 'ثبت گزارش برای این پروژه', callback_data: `bot:report_project:${project._id}` },
    ]);
  }
  if (user.role === UserRole.MANAGER) {
    rows.push([
      { text: 'تغییر وضعیت پروژه', callback_data: `bot:status_picker:${project._id}` },
      { text: 'تغییر اولویت', callback_data: `bot:priority_picker:${project._id}` },
    ]);
    rows.push([{ text: 'ثبت وظیفه جدید', callback_data: 'task:create' }]);
  }
  rows.push([{ text: 'بازگشت به پروژه‌ها', callback_data: 'bot:list_projects' }]);

  await sendTelegramBotMessage(getChatId(message), text, {
    replyMarkup: { inline_keyboard: rows },
  });
};


const ensureManagerBotUser = async (
  message: TelegramMessagePayload,
  user: BotUser,
): Promise<boolean> => {
  if (user.role === UserRole.MANAGER) return true;

  await sendTelegramBotMessage(
    getChatId(message),
    'این عملیات فقط برای مدیران مجاز است.',
    { replyMarkup: buildMainKeyboard(user) },
  );
  return false;
};

const sendProjectStatusPicker = async (
  message: TelegramMessagePayload,
  user: BotUser,
  projectId: string,
) => {
  if (!(await ensureManagerBotUser(message, user))) return;

  const project = await getAccessibleProjectById(user, projectId);
  if (!project) {
    await sendTelegramBotMessage(getChatId(message), 'پروژه پیدا نشد.');
    return;
  }

  const normalStatuses = [
    ProjectStatus.NEGOTIATING,
    ProjectStatus.PROPOSAL_DRAFTING,
    ProjectStatus.CONTRACT_SIGNING,
    ProjectStatus.PLANNING,
    ProjectStatus.ACTIVE,
    ProjectStatus.ON_HOLD,
  ];

  const rows = normalStatuses.map((status) => [
    {
      text: PROJECT_STATUS_LABELS[status],
      callback_data: `bot:set_status:${project._id}:${status}`,
    },
  ]);
  rows.push([
    {
      text: PROJECT_STATUS_LABELS[ProjectStatus.COMPLETED],
      callback_data: `bot:confirm_status:${project._id}:${ProjectStatus.COMPLETED}`,
    },
    {
      text: PROJECT_STATUS_LABELS[ProjectStatus.CANCELLED],
      callback_data: `bot:confirm_status:${project._id}:${ProjectStatus.CANCELLED}`,
    },
  ]);
  rows.push([{ text: 'بازگشت', callback_data: `bot:view:${project._id}` }]);

  await sendTelegramBotMessage(
    getChatId(message),
    `وضعیت فعلی «${escapeTelegramHtml(project.title)}»: <b>${escapeTelegramHtml(
      PROJECT_STATUS_LABELS[project.status] || project.status,
    )}</b>\n\nوضعیت جدید را انتخاب کنید:`,
    { replyMarkup: { inline_keyboard: rows } },
  );
};

const confirmProjectStatus = async (
  message: TelegramMessagePayload,
  user: BotUser,
  projectId: string,
  statusValue: string,
) => {
  if (!(await ensureManagerBotUser(message, user))) return;
  if (!Object.values(ProjectStatus).includes(statusValue as ProjectStatus)) {
    await sendTelegramBotMessage(getChatId(message), 'وضعیت معتبر نیست.');
    return;
  }

  const project = await getAccessibleProjectById(user, projectId);
  if (!project) {
    await sendTelegramBotMessage(getChatId(message), 'پروژه پیدا نشد.');
    return;
  }

  const status = statusValue as ProjectStatus;
  await sendTelegramBotMessage(
    getChatId(message),
    `آیا از تغییر وضعیت پروژه «${escapeTelegramHtml(project.title)}» به <b>${escapeTelegramHtml(
      PROJECT_STATUS_LABELS[status],
    )}</b> مطمئن هستید؟`,
    {
      replyMarkup: {
        inline_keyboard: [
          [
            {
              text: 'بله، تغییر بده',
              callback_data: `bot:set_status:${project._id}:${status}`,
            },
            { text: 'انصراف', callback_data: `bot:view:${project._id}` },
          ],
        ],
      },
    },
  );
};

const updateProjectStatusFromBot = async (
  message: TelegramMessagePayload,
  user: BotUser,
  projectId: string,
  statusValue: string,
) => {
  if (!(await ensureManagerBotUser(message, user))) return;
  if (!Object.values(ProjectStatus).includes(statusValue as ProjectStatus)) {
    await sendTelegramBotMessage(getChatId(message), 'وضعیت معتبر نیست.');
    return;
  }

  const project = await getAccessibleProjectById(user, projectId);
  if (!project) {
    await sendTelegramBotMessage(getChatId(message), 'پروژه پیدا نشد.');
    return;
  }

  project.status = statusValue as ProjectStatus;
  project.updatedBy = user._id;
  await project.save();

  await sendTelegramBotMessage(
    getChatId(message),
    `✅ وضعیت پروژه به <b>${escapeTelegramHtml(
      PROJECT_STATUS_LABELS[project.status],
    )}</b> تغییر کرد.`,
  );
  await sendProjectDetails(message, user, projectId);
};

const sendProjectPriorityPicker = async (
  message: TelegramMessagePayload,
  user: BotUser,
  projectId: string,
) => {
  if (!(await ensureManagerBotUser(message, user))) return;

  const project = await getAccessibleProjectById(user, projectId);
  if (!project) {
    await sendTelegramBotMessage(getChatId(message), 'پروژه پیدا نشد.');
    return;
  }

  const rows = Object.values(ProjectPriority).map((priority) => [
    {
      text: PROJECT_PRIORITY_LABELS[priority],
      callback_data: `bot:set_priority:${project._id}:${priority}`,
    },
  ]);
  rows.push([{ text: 'بازگشت', callback_data: `bot:view:${project._id}` }]);

  await sendTelegramBotMessage(
    getChatId(message),
    `اولویت فعلی «${escapeTelegramHtml(project.title)}»: <b>${escapeTelegramHtml(
      PROJECT_PRIORITY_LABELS[project.priority],
    )}</b>\n\nاولویت جدید را انتخاب کنید:`,
    { replyMarkup: { inline_keyboard: rows } },
  );
};

const updateProjectPriorityFromBot = async (
  message: TelegramMessagePayload,
  user: BotUser,
  projectId: string,
  priorityValue: string,
) => {
  if (!(await ensureManagerBotUser(message, user))) return;
  if (!Object.values(ProjectPriority).includes(priorityValue as ProjectPriority)) {
    await sendTelegramBotMessage(getChatId(message), 'اولویت معتبر نیست.');
    return;
  }

  const project = await getAccessibleProjectById(user, projectId);
  if (!project) {
    await sendTelegramBotMessage(getChatId(message), 'پروژه پیدا نشد.');
    return;
  }

  project.priority = priorityValue as ProjectPriority;
  project.updatedBy = user._id;
  await project.save();

  await sendTelegramBotMessage(
    getChatId(message),
    `✅ اولویت پروژه به <b>${escapeTelegramHtml(
      PROJECT_PRIORITY_LABELS[project.priority],
    )}</b> تغییر کرد.`,
  );
  await sendProjectDetails(message, user, projectId);
};

const sendProjectPhases = async (
  message: TelegramMessagePayload,
  user: BotUser,
  projectId: string,
) => {
  const project = await getAccessibleProjectById(user, projectId);
  if (!project) {
    await sendTelegramBotMessage(getChatId(message), 'پروژه در دسترس نیست.');
    return;
  }

  const phases = await ProjectPhase.find({ projectId: project._id })
    .populate('assignedUserIds', 'fullName username')
    .sort({ order: 1, startDate: 1 });

  const text = phases.length
    ? [
        `<b>فازهای ${escapeTelegramHtml(project.title)}</b>`,
        '',
        ...phases.map((phase: any, index: number) => {
          const assignees = (phase.assignedUserIds || [])
            .map((item: any) => item.fullName || item.username)
            .filter(Boolean)
            .join('، ');
          return [
            `${index + 1}. <b>${escapeTelegramHtml(phase.title)}</b>`,
            `زمان: ${formatDate(phase.startDate)} تا ${formatDate(phase.endDate)}`,
            `مسئولان: ${escapeTelegramHtml(assignees || 'تعیین نشده')}`,
          ].join('\n');
        }),
      ].join('\n\n')
    : `برای پروژه «${escapeTelegramHtml(project.title)}» فازی ثبت نشده است.`;

  await sendTelegramBotMessage(getChatId(message), text, {
    replyMarkup: {
      inline_keyboard: [
        [{ text: 'جزئیات پروژه', callback_data: `bot:view:${project._id}` }],
      ],
    },
  });
};

const sendProjectFinance = async (
  message: TelegramMessagePayload,
  user: BotUser,
  projectId: string,
) => {
  const project = await getAccessibleProjectById(user, projectId);
  if (!project) {
    await sendTelegramBotMessage(getChatId(message), 'پروژه در دسترس نیست.');
    return;
  }

  const phases = await ProjectPhase.find({ projectId: project._id }).sort({ order: 1 });
  if (!phases.length) {
    await sendTelegramBotMessage(
      getChatId(message),
      `برای پروژه «${escapeTelegramHtml(project.title)}» فاز و اطلاعات مالی ثبت نشده است.`,
      {
        replyMarkup: {
          inline_keyboard: [
            [{ text: 'جزئیات پروژه', callback_data: `bot:view:${project._id}` }],
          ],
        },
      },
    );
    return;
  }

  const totals = phases.reduce(
    (acc, phase) => {
      acc.expectedRevenue += Number(phase.financial?.expectedRevenue || 0);
      acc.expectedExpense += Number(phase.financial?.expectedExpense || 0);
      acc.realizedRevenue += Number(phase.financial?.realizedRevenue || 0);
      acc.realizedExpense += Number(phase.financial?.realizedExpense || 0);
      return acc;
    },
    { expectedRevenue: 0, expectedExpense: 0, realizedRevenue: 0, realizedExpense: 0 },
  );
  const currency = phases[0].financial?.currency || 'IRR';

  const text = [
    `<b>گزارش مالی ${escapeTelegramHtml(project.title)}</b>`,
    '',
    `درآمد پیش‌بینی‌شده: ${formatMoney(totals.expectedRevenue, currency)}`,
    `هزینه پیش‌بینی‌شده: ${formatMoney(totals.expectedExpense, currency)}`,
    `درآمد تحقق‌یافته: ${formatMoney(totals.realizedRevenue, currency)}`,
    `هزینه تحقق‌یافته: ${formatMoney(totals.realizedExpense, currency)}`,
    `تراز تحقق‌یافته: ${formatMoney(
      totals.realizedRevenue - totals.realizedExpense,
      currency,
    )}`,
    '',
    ...phases.map((phase, index) =>
      [
        `${index + 1}. <b>${escapeTelegramHtml(phase.title)}</b>`,
        `پیش‌بینی: درآمد ${formatMoney(phase.financial?.expectedRevenue || 0, phase.financial?.currency)} | هزینه ${formatMoney(phase.financial?.expectedExpense || 0, phase.financial?.currency)}`,
        `تحقق: درآمد ${formatMoney(phase.financial?.realizedRevenue || 0, phase.financial?.currency)} | هزینه ${formatMoney(phase.financial?.realizedExpense || 0, phase.financial?.currency)}`,
      ].join('\n'),
    ),
  ].join('\n\n');

  await sendTelegramBotMessage(getChatId(message), text, {
    replyMarkup: {
      inline_keyboard: [
        [{ text: 'جزئیات پروژه', callback_data: `bot:view:${project._id}` }],
      ],
    },
  });
};

const sendProjectTasks = async (
  message: TelegramMessagePayload,
  user: BotUser,
  projectId: string,
) => {
  const project = await getAccessibleProjectById(user, projectId);
  if (!project) {
    await sendTelegramBotMessage(getChatId(message), 'پروژه در دسترس نیست.');
    return;
  }

  const filter: Record<string, unknown> = { projectId: project._id };
  if (!isReadAllRole(user)) filter.assignedUserIds = user._id;

  const tasks = await ProjectTask.find(filter)
    .populate('assignedUserIds', 'fullName username')
    .sort({ dueDate: 1, updatedAt: -1 })
    .limit(20);

  const text = tasks.length
    ? [
        `<b>وظایف ${escapeTelegramHtml(project.title)}</b>`,
        '',
        ...tasks.map((task: any, index: number) => {
          const assignees = (task.assignedUserIds || [])
            .map((item: any) => item.fullName || item.username)
            .join('، ');
          return [
            `${index + 1}. <b>${escapeTelegramHtml(task.title)}</b>`,
            `وضعیت: ${escapeTelegramHtml(PROJECT_TASK_STATUS_LABELS[task.status as ProjectTaskStatus] || task.status)}`,
            `مسئول: ${escapeTelegramHtml(assignees || 'تعیین نشده')}`,
            `مهلت: ${formatDate(task.dueDate)}`,
          ].join('\n');
        }),
      ].join('\n\n')
    : 'وظیفه‌ای برای این پروژه پیدا نشد.';

  const rows = tasks.slice(0, 12).map((task) => [
    {
      text: `مشاهده: ${task.title.slice(0, 38)}`,
      callback_data: `task:view:${task._id}`,
    },
  ]);
  rows.push([{ text: 'جزئیات پروژه', callback_data: `bot:view:${project._id}` }]);

  await sendTelegramBotMessage(getChatId(message), text, {
    replyMarkup: { inline_keyboard: rows },
  });
};

const sendProjectNotes = async (
  message: TelegramMessagePayload,
  user: BotUser,
  projectId: string,
) => {
  const project = await getAccessibleProjectById(user, projectId);
  if (!project) {
    await sendTelegramBotMessage(getChatId(message), 'پروژه در دسترس نیست.');
    return;
  }

  const notes = await ProjectProgressNote.find({ projectId: project._id })
    .populate('authorId', 'fullName username')
    .sort({ createdAt: -1 })
    .limit(10);

  const text = notes.length
    ? [
        `<b>گزارش‌های اخیر ${escapeTelegramHtml(project.title)}</b>`,
        '',
        ...notes.map((note: any, index: number) => {
          const author = note.authorId?.fullName || note.authorId?.username || 'نامشخص';
          return [
            `${index + 1}. ${escapeTelegramHtml(String(note.note).slice(0, 700))}`,
            `ثبت‌کننده: ${escapeTelegramHtml(author)} | تاریخ: ${formatDate(note.createdAt)}`,
            note.progressPercent !== null && note.progressPercent !== undefined
              ? `پیشرفت اعلام‌شده: ${note.progressPercent}%`
              : '',
          ]
            .filter(Boolean)
            .join('\n');
        }),
      ].join('\n\n')
    : 'گزارشی برای این پروژه ثبت نشده است.';

  await sendTelegramBotMessage(getChatId(message), text, {
    replyMarkup: {
      inline_keyboard: [
        ...(canWriteProjectData(user)
          ? [
              [
                {
                  text: 'ثبت گزارش جدید',
                  callback_data: `bot:report_project:${project._id}`,
                },
              ],
            ]
          : []),
        [{ text: 'جزئیات پروژه', callback_data: `bot:view:${project._id}` }],
      ],
    },
  });
};

const sendStaffingPending = async (
  message: TelegramMessagePayload,
  user: BotUser,
) => {
  if (!isReadAllRole(user)) {
    await sendTelegramBotMessage(
      getChatId(message),
      'این گزارش فقط برای نقش‌های مدیریتی و نظارتی در دسترس است.',
      { replyMarkup: buildMainKeyboard(user) },
    );
    return;
  }

  const projects = await Project.find({
    status: { $nin: [ProjectStatus.COMPLETED, ProjectStatus.CANCELLED] },
    $or: [
      { ownerId: null },
      { ownerId: { $exists: false } },
      { assignedUserIds: { $size: 0 } },
      { projectMembers: { $size: 0 } },
    ],
  })
    .sort({ priority: -1, updatedAt: -1 })
    .limit(30)
    .select('title ownerId assignedUserIds projectMembers priority status');

  const text = projects.length
    ? [
        '<b>پروژه‌های نیازمند تعیین افراد و مسئولیت‌ها</b>',
        '',
        ...projects.map((project, index) => {
          const gaps = [
            !project.ownerId ? 'مسئول پروژه' : '',
            !project.assignedUserIds?.length ? 'اعضا' : '',
            !project.projectMembers?.length ? 'نقش/مسئولیت اعضا' : '',
          ].filter(Boolean);
          return `${index + 1}. ${escapeTelegramHtml(project.title)} — ${escapeTelegramHtml(
            gaps.join('، '),
          )}`;
        }),
        '',
        'تخصیص افراد باید از صفحه ویرایش پروژه در پنل انجام شود؛ Excel فقط اطلاعات پروژه و فاز را وارد می‌کند.',
      ].join('\n')
    : 'همه پروژه‌های فعال دارای مسئول، عضو و مسئولیت ثبت‌شده هستند.';

  const rows = projects.slice(0, 12).map((project) => [
    {
      text: project.title.slice(0, 50),
      callback_data: `bot:view:${project._id}`,
    },
  ]);
  rows.push([{ text: 'منوی اصلی', callback_data: 'bot:summary' }]);

  await sendTelegramBotMessage(getChatId(message), text, {
    replyMarkup: { inline_keyboard: rows },
  });
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
  return value.replace(/[^a-zA-Z0-9.\-_]/g, '_') || 'telegram-file';
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
  if (message.voice) return fileLikeToCandidate(message.voice, 'voice', 'voice.ogg');
  if (message.audio) return fileLikeToCandidate(message.audio, 'audio', 'audio');
  if (message.document)
    return fileLikeToCandidate(message.document, 'document', 'document');
  if (message.video) return fileLikeToCandidate(message.video, 'video', 'video.mp4');

  const photo = getLargestPhoto(message.photo);
  if (!photo) return null;

  return {
    fileId: photo.file_id,
    fileUniqueId: photo.file_unique_id || '',
    originalName: 'photo.jpg',
    mimeType: 'image/jpeg',
    fileSize: photo.file_size || 0,
    kind: 'photo',
  };
};

const isAudioMediaCandidate = (media?: MediaCandidate | null): boolean => {
  if (!media) return false;
  return isTranscribableAudioMeta({
    mimeType: media.mimeType,
    fileName: media.originalName,
    kind: media.kind,
  });
};

const saveTelegramMediaAsProjectFile = async (
  message: TelegramMessagePayload,
  media: MediaCandidate,
  projectId: Types.ObjectId,
  userId: Types.ObjectId,
  progressNoteId: Types.ObjectId | null,
) => {
  const telegramFile = await getTelegramFile(media.fileId);
  if (!telegramFile.file_path) throw new Error('مسیر فایل از تلگرام دریافت نشد.');

  const buffer = await downloadTelegramFile(telegramFile.file_path);
  await fs.mkdir(uploadDir, { recursive: true });

  const extension =
    path.extname(media.originalName) ||
    path.extname(telegramFile.file_path) ||
    extensionFromMime(media.mimeType) ||
    (media.kind === 'voice' ? '.ogg' : '');
  const originalName = path.extname(media.originalName)
    ? safeOriginalName(media.originalName)
    : `${safeOriginalName(media.originalName)}${extension}`;
  const fileName = `${Date.now()}-${crypto.randomUUID()}-${originalName}`;
  const localPath = path.join(uploadDir, fileName);
  await fs.writeFile(localPath, buffer);

  const transcription = await transcribeAudioPath({
    path: localPath,
    originalname: originalName,
    filename: fileName,
    mimetype: media.mimeType || (media.kind === 'voice' ? 'audio/ogg' : undefined),
    size: media.fileSize || buffer.length,
  });

  return ProjectFile.create({
    projectId,
    progressNoteId,
    taskId: null,
    uploadedBy: userId,
    fileName,
    originalName,
    fileUrl: `/api/v1/uploads/projects/${fileName}`,
    fileType: media.mimeType || '',
    fileSize: media.fileSize || buffer.length,
    category: ProjectFileCategory.REPORTS,
    categoryLabel: PROJECT_FILE_CATEGORY_LABELS[ProjectFileCategory.REPORTS],
    source: ProjectSource.TELEGRAM_BOT,
    telegramFileId: media.fileId,
    telegramFileUniqueId: media.fileUniqueId,
    telegramMessageId: message.message_id,
    telegramChatId: getChatId(message),
    telegramAttachmentKind: media.kind,
    ...toProjectFileTranscriptionFields(transcription),
    language: 'fa',
    direction: 'rtl',
  });
};

const parseProgressPercent = (description: string): number | null => {
  const normalized = description
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
  const match = normalized.match(/(?:^|\s)(100|[0-9]{1,2})\s*(?:%|٪)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
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
    progressPercent: parseProgressPercent(description),
    statusSnapshot: project?.status || '',
    source: ProjectSource.TELEGRAM_BOT,
    telegramChatId: getChatId(message),
    telegramMessageId: message.message_id,
    language: 'fa',
    direction: 'rtl',
  });
};

const buildAttachmentKeyboard = () => ({
  inline_keyboard: [
    [{ text: 'ثبت بدون فایل', callback_data: 'bot:skip_attachment' }],
    [{ text: 'لغو', callback_data: 'bot:cancel' }],
  ],
});

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
      'برای ثبت فایل ابتدا پروژه را انتخاب و توضیح گزارش را ارسال کنید.',
      { replyMarkup: buildMainKeyboard(user) },
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

  const projectId = session.selectedProjectId.toString();
  await resetSession(message, user);

  await sendTelegramBotMessage(
    getChatId(message),
    media
      ? '✅ گزارش پروژه همراه با پیوست ثبت شد.'
      : '✅ گزارش پروژه بدون پیوست ثبت شد.',
    {
      replyMarkup: {
        inline_keyboard: [
          [{ text: 'مشاهده پروژه', callback_data: `bot:view:${projectId}` }],
          [{ text: 'منوی اصلی', callback_data: 'bot:summary' }],
        ],
      },
    },
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
    await sendTelegramBotMessage(getChatId(message), 'ابتدا پروژه گزارش را انتخاب کنید.', {
      replyMarkup: buildMainKeyboard(user),
    });
    return;
  }

  let finalDescription = description.trim();
  let savedFile: any | null = null;

  if (!finalDescription && media && isAudioMediaCandidate(media)) {
    savedFile = await saveTelegramMediaAsProjectFile(
      message,
      media,
      session.selectedProjectId,
      user._id,
      null,
    );
    finalDescription = String(savedFile.transcriptionText || '').trim();
  }

  if (!finalDescription) {
    await sendTelegramBotMessage(
      getChatId(message),
      media && isAudioMediaCandidate(media)
        ? 'فایل صوتی دریافت شد اما متن قابل استفاده استخراج نشد. توضیح متنی ارسال کنید یا ویس واضح‌تری بفرستید.'
        : 'توضیح گزارش الزامی است. متن را ارسال کنید یا برای فایل، کپشن بنویسید.',
    );
    return;
  }

  const note = await createTelegramProjectNote(
    message,
    user,
    session.selectedProjectId,
    finalDescription,
  );

  if (savedFile) {
    savedFile.progressNoteId = note._id;
    await savedFile.save();
  }

  await upsertSession(message, user, {
    step: TelegramBotSessionStep.AWAITING_ATTACHMENT,
    lastProjectNoteId: note._id,
    pendingDescription: finalDescription,
  });

  if (media && !savedFile) {
    await completeAttachmentStep(message, user, media);
    return;
  }

  if (savedFile) {
    const projectId = session.selectedProjectId.toString();
    await resetSession(message, user);
    await sendTelegramBotMessage(
      getChatId(message),
      '✅ گزارش همراه فایل صوتی و متن استخراج‌شده ثبت شد.',
      {
        replyMarkup: {
          inline_keyboard: [
            [{ text: 'مشاهده پروژه', callback_data: `bot:view:${projectId}` }],
          ],
        },
      },
    );
    return;
  }

  await sendTelegramBotMessage(
    getChatId(message),
    'توضیح ثبت شد. اکنون فایل، ویس، عکس، ویدئو یا سند را ارسال کنید؛ یا گزارش را بدون فایل نهایی کنید.',
    { replyMarkup: buildAttachmentKeyboard() },
  );
};

const selectReportProject = async (
  message: TelegramMessagePayload,
  user: BotUser,
  projectId: string,
) => {
  if (!canWriteProjectData(user)) {
    await sendTelegramBotMessage(getChatId(message), 'اجازه ثبت گزارش ندارید.');
    return;
  }

  const project = await getAccessibleProjectById(user, projectId);
  if (!project) {
    await sendTelegramBotMessage(
      getChatId(message),
      'پروژه پیدا نشد یا به آن دسترسی ندارید.',
      { replyMarkup: buildMainKeyboard(user) },
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
    [
      `پروژه انتخاب شد: <b>${escapeTelegramHtml(project.title)}</b>`,
      '',
      'گزارش را ارسال کنید. برای ثبت درصد پیشرفت می‌توانید عبارتی مانند «پیشرفت ۶۵٪» داخل متن بنویسید.',
      'برای فایل/ویس، توضیح را در کپشن قرار دهید. ویس بدون کپشن نیز به متن تبدیل می‌شود.',
    ].join('\n'),
    {
      replyMarkup: {
        inline_keyboard: [[{ text: 'لغو', callback_data: 'bot:cancel' }]],
      },
    },
  );
};

const handleStart = async (message: TelegramMessagePayload, user: BotUser) => {
  await resetSession(message, user);

  await sendTelegramBotMessage(getChatId(message), buildBotGuideText(user), {
    replyMarkup: buildDefaultReplyKeyboard(),
  });
  await sendTelegramBotMessage(getChatId(message), 'منوی عملیاتی:', {
    replyMarkup: buildMainKeyboard(user),
  });
};

const handleCallback = async (callbackQuery: TelegramCallbackQueryPayload) => {
  if (!callbackQuery.message) return;

  if (String(callbackQuery.data || '').startsWith('task:')) {
    await telegramTaskBotService.handleUpdate({
      update_id: 0,
      callback_query: callbackQuery,
    });
    return;
  }

  const message = callbackQuery.message;
  message.from = callbackQuery.from;
  const user = await getLinkedUser(message);

  await answerTelegramCallbackQuery(callbackQuery.id).catch(() => undefined);

  if (!user) {
    await sendUnlinkedUserMessage(message);
    return;
  }

  const data = String(callbackQuery.data || '');

  if (data === 'bot:help') {
    await sendTelegramBotMessage(getChatId(message), buildBotGuideText(user), {
      replyMarkup: buildMainKeyboard(user),
    });
    return;
  }
  if (data === 'bot:summary') {
    await sendSummary(message, user);
    return;
  }
  if (data === 'bot:list_projects') {
    await sendProjectsList(message, user);
    return;
  }
  if (data === 'bot:add_report') {
    await sendProjectSelection(message, user);
    return;
  }
  if (data === 'bot:staffing') {
    await sendStaffingPending(message, user);
    return;
  }
  if (data === 'bot:cancel') {
    await resetSession(message, user);
    await sendTelegramBotMessage(getChatId(message), 'عملیات جاری لغو شد.', {
      replyMarkup: buildMainKeyboard(user),
    });
    return;
  }
  if (data === 'bot:skip_attachment') {
    await completeAttachmentStep(message, user, null);
    return;
  }
  if (data.startsWith('bot:view:')) {
    await sendProjectDetails(message, user, data.replace('bot:view:', ''));
    return;
  }
  if (data.startsWith('bot:phases:')) {
    await sendProjectPhases(message, user, data.replace('bot:phases:', ''));
    return;
  }
  if (data.startsWith('bot:finance:')) {
    await sendProjectFinance(message, user, data.replace('bot:finance:', ''));
    return;
  }
  if (data.startsWith('bot:tasks:')) {
    await sendProjectTasks(message, user, data.replace('bot:tasks:', ''));
    return;
  }
  if (data.startsWith('bot:notes:')) {
    await sendProjectNotes(message, user, data.replace('bot:notes:', ''));
    return;
  }
  if (data.startsWith('bot:status_picker:')) {
    await sendProjectStatusPicker(
      message,
      user,
      data.replace('bot:status_picker:', ''),
    );
    return;
  }
  if (data.startsWith('bot:confirm_status:')) {
    const parts = data.split(':');
    await confirmProjectStatus(message, user, parts[2] || '', parts[3] || '');
    return;
  }
  if (data.startsWith('bot:set_status:')) {
    const parts = data.split(':');
    await updateProjectStatusFromBot(
      message,
      user,
      parts[2] || '',
      parts[3] || '',
    );
    return;
  }
  if (data.startsWith('bot:priority_picker:')) {
    await sendProjectPriorityPicker(
      message,
      user,
      data.replace('bot:priority_picker:', ''),
    );
    return;
  }
  if (data.startsWith('bot:set_priority:')) {
    const parts = data.split(':');
    await updateProjectPriorityFromBot(
      message,
      user,
      parts[2] || '',
      parts[3] || '',
    );
    return;
  }
  if (data.startsWith('bot:report_project:')) {
    await selectReportProject(
      message,
      user,
      data.replace('bot:report_project:', ''),
    );
    return;
  }
  if (data.startsWith('bot:project:')) {
    await selectReportProject(message, user, data.replace('bot:project:', ''));
    return;
  }

  await sendTelegramBotMessage(getChatId(message), 'گزینه انتخاب‌شده معتبر نیست.', {
    replyMarkup: buildMainKeyboard(user),
  });
};

const handleMessage = async (message: TelegramMessagePayload) => {
  const text = String(message.text || '').trim();

  if (await handleTelegramLinkCommand(message, text)) {
    return;
  }
  const taskCommands = new Set([
    '/task',
    '/newtask',
    '/tasks',
    '/mytasks',
    'ثبت وظیفه',
    'وظایف باز من',
    'وظایف من',
  ]);

  if (taskCommands.has(text)) {
    await telegramTaskBotService.handleUpdate({ update_id: 0, message });
    return;
  }

  const user = await getLinkedUser(message);
  if (!user) {
    await sendUnlinkedUserMessage(message);
    return;
  }

  const media = getMediaCandidate(message);
  const description = String(message.caption || message.text || '').trim();

  if (
    ['/start', 'start', 'شروع', 'راهنما', 'شروع / راهنما'].includes(text)
  ) {
    await handleStart(message, user);
    return;
  }
  if (['/cancel', 'لغو', 'لغو عملیات'].includes(text)) {
    await resetSession(message, user);
    await sendTelegramBotMessage(getChatId(message), 'عملیات جاری لغو شد.', {
      replyMarkup: buildMainKeyboard(user),
    });
    return;
  }
  if (['/summary', 'خلاصه مدیریتی'].includes(text)) {
    await sendSummary(message, user);
    return;
  }
  if (['/projects', 'پروژه‌های من', 'پروژه‌ها'].includes(text)) {
    await sendProjectsList(message, user);
    return;
  }
  if (['/staffing', 'پروژه‌های نیازمند تخصیص'].includes(text)) {
    await sendStaffingPending(message, user);
    return;
  }
  if (['/new', '/report', 'ثبت گزارش پروژه'].includes(text)) {
    await sendProjectSelection(message, user);
    return;
  }
  if (['/skip', 'بدون فایل', 'بدون پیوست'].includes(text)) {
    await completeAttachmentStep(message, user, null);
    return;
  }

  const session = await TelegramBotSession.findOne({
    telegramUserId: getTelegramUserId(message),
    telegramChatId: getChatId(message),
  });

  if (session?.step === TelegramBotSessionStep.AWAITING_DESCRIPTION) {
    if (!description && !(media && isAudioMediaCandidate(media))) {
      await sendTelegramBotMessage(
        getChatId(message),
        'توضیح گزارش الزامی است. متن ارسال کنید یا فایل صوتی بفرستید.',
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
        'پیوست را ارسال کنید یا گزینه ثبت بدون فایل را بزنید.',
        { replyMarkup: buildAttachmentKeyboard() },
      );
      return;
    }

    await completeAttachmentStep(message, user, media);
    return;
  }

  await sendTelegramBotMessage(
    getChatId(message),
    'از منوی زیر برای مشاهده وضعیت یا ثبت اطلاعات استفاده کنید.',
    { replyMarkup: buildMainKeyboard(user) },
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
  let bot: Awaited<ReturnType<typeof getTelegramBotIdentity>> | null = null;
  let webhook: Awaited<ReturnType<typeof getTelegramWebhookInfo>> | null = null;
  let apiError = '';

  if (env.telegramBotToken) {
    try {
      [bot, webhook] = await Promise.all([
        getTelegramBotIdentity(),
        getTelegramWebhookInfo(),
      ]);
    } catch (error) {
      apiError = error instanceof Error ? error.message : 'Telegram API error';
    }
  }

  res.json({
    success: true,
    data: {
      configured: isTelegramBotWebhookConfigured(),
      tokenConfigured: Boolean(env.telegramBotToken),
      secretConfigured: Boolean(env.telegramWebhookSecret),
      publicUrlConfigured: Boolean(env.telegramBotPublicUrl),
      webhookConfigured: Boolean(webhook?.url),
      webhookPath: '/api/v1/telegram/webhook',
      bot,
      webhook,
      apiError,
    },
  });
};
