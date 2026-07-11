import crypto from 'crypto';
import { NextFunction, Response } from 'express';
import { env } from '@/config/env';
import { AuthenticatedRequest } from '@/modules/auth/auth.middleware';
import {
  Project,
  ProjectFile,
  ProjectProgressNote,
  ProjectSource,
  ProjectStatus,
  ProjectTask,
  ProjectTaskStatus,
} from '@/modules/projects/project.model';
import User, { UserRole } from '@/modules/users/user.model';
import TelegramBotSession from './telegram-bot-session.model';
import TelegramTaskSession from './telegram-task-session.model';
import TelegramLinkCode, {
  hashTelegramLinkCode,
} from './telegram-link-code.model';
import {
  deleteTelegramWebhook,
  getTelegramBotIdentity,
  getTelegramWebhookInfo,
  sendTelegramBotMessage,
  setTelegramBotCommands,
  setTelegramWebhook,
} from './telegram.service';

const MANAGER_ROLE_ALIASES = new Set([
  UserRole.MANAGER,
  'admin',
  'super_admin',
  'project_owner',
]);

export const requireTelegramManager = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void => {
  if (!req.user?.role || !MANAGER_ROLE_ALIASES.has(req.user.role as UserRole)) {
    res.status(403).json({
      success: false,
      message: 'مدیریت تنظیمات ربات فقط برای مدیران مجاز است.',
      code: 'TELEGRAM_MANAGER_REQUIRED',
    });
    return;
  }

  next();
};

const normalizeWebhookUrl = (value: unknown): string => {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return '';

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return '';
  }

  if (parsed.protocol !== 'https:') return '';

  if (parsed.pathname.endsWith('/api/v1/telegram/webhook')) {
    return parsed.toString().replace(/\/$/, '');
  }

  parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}/api/v1/telegram/webhook`;
  parsed.search = '';
  parsed.hash = '';

  return parsed.toString().replace(/\/$/, '');
};

const readPagination = (req: AuthenticatedRequest) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  return { page, limit, skip: (page - 1) * limit };
};

export const getTelegramOverview = async (
  _req: AuthenticatedRequest,
  res: Response,
) => {
  const now = new Date();
  const activeUserFilter = { isActive: true };
  const linkedFilter = {
    ...activeUserFilter,
    $or: [
      { telegramUserId: { $exists: true, $ne: '' } },
      { telegramChatId: { $exists: true, $ne: '' } },
    ],
  };

  const [
    activeUsers,
    linkedUsers,
    reportSessions,
    taskSessions,
    telegramTasks,
    telegramNotes,
    telegramFiles,
    openTasks,
    overdueTasks,
    staffingPending,
    activeProjects,
    recentTasks,
    recentNotes,
  ] = await Promise.all([
    User.countDocuments(activeUserFilter),
    User.countDocuments(linkedFilter),
    TelegramBotSession.countDocuments({ step: { $ne: 'idle' } }),
    TelegramTaskSession.countDocuments({}),
    ProjectTask.countDocuments({ source: ProjectSource.TELEGRAM_BOT }),
    ProjectProgressNote.countDocuments({ source: ProjectSource.TELEGRAM_BOT }),
    ProjectFile.countDocuments({ source: ProjectSource.TELEGRAM_BOT }),
    ProjectTask.countDocuments({
      status: {
        $in: [
          ProjectTaskStatus.TODO,
          ProjectTaskStatus.IN_PROGRESS,
          ProjectTaskStatus.BLOCKED,
        ],
      },
    }),
    ProjectTask.countDocuments({
      status: {
        $in: [
          ProjectTaskStatus.TODO,
          ProjectTaskStatus.IN_PROGRESS,
          ProjectTaskStatus.BLOCKED,
        ],
      },
      dueDate: { $lt: now },
    }),
    Project.countDocuments({
      status: { $nin: [ProjectStatus.COMPLETED, ProjectStatus.CANCELLED] },
      $or: [
        { ownerId: null },
        { ownerId: { $exists: false } },
        { assignedUserIds: { $size: 0 } },
        { projectMembers: { $size: 0 } },
      ],
    }),
    Project.countDocuments({
      status: { $nin: [ProjectStatus.COMPLETED, ProjectStatus.CANCELLED] },
    }),
    ProjectTask.find({ source: ProjectSource.TELEGRAM_BOT })
      .populate('projectId', 'title')
      .populate('createdBy', 'fullName username')
      .sort({ createdAt: -1 })
      .limit(6)
      .lean(),
    ProjectProgressNote.find({ source: ProjectSource.TELEGRAM_BOT })
      .populate('projectId', 'title')
      .populate('authorId', 'fullName username')
      .sort({ createdAt: -1 })
      .limit(6)
      .lean(),
  ]);

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
      apiError = error instanceof Error ? error.message : 'خطا در Telegram API';
    }
  }

  const activity = [
    ...recentTasks.map((task: any) => ({
      id: String(task._id),
      type: 'task' as const,
      title: task.title,
      projectTitle: task.projectId?.title || 'پروژه نامشخص',
      actorName:
        task.createdBy?.fullName || task.createdBy?.username || 'کاربر نامشخص',
      createdAt: task.createdAt,
    })),
    ...recentNotes.map((note: any) => ({
      id: String(note._id),
      type: 'report' as const,
      title: String(note.note || '').slice(0, 160),
      projectTitle: note.projectId?.title || 'پروژه نامشخص',
      actorName:
        note.authorId?.fullName || note.authorId?.username || 'کاربر نامشخص',
      createdAt: note.createdAt,
    })),
  ]
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
    .slice(0, 10);

  res.json({
    success: true,
    data: {
      configuration: {
        tokenConfigured: Boolean(env.telegramBotToken),
        secretConfigured: Boolean(env.telegramWebhookSecret),
        publicUrlConfigured: Boolean(env.telegramBotPublicUrl),
        transcriptionConfigured: Boolean(env.openaiApiKey),
        dailyAlertEnabled: env.telegramDailyAlertEnabled,
        dailyAlertTime: env.telegramDailyAlertTime,
        dailyAlertTimezone: env.telegramDailyAlertTimezone,
      },
      bot,
      webhook,
      apiError,
      counts: {
        activeUsers,
        linkedUsers,
        unlinkedUsers: Math.max(0, activeUsers - linkedUsers),
        activeReportSessions: reportSessions,
        activeTaskSessions: taskSessions,
        telegramTasks,
        telegramReports: telegramNotes,
        telegramFiles,
        openTasks,
        overdueTasks,
        staffingPending,
        activeProjects,
      },
      commands: [
        { command: '/start', description: 'راهنما و منوی اصلی' },
        { command: '/link', description: 'اتصال امن با کد یک‌بارمصرف' },
        { command: '/summary', description: 'خلاصه مدیریتی' },
        { command: '/projects', description: 'فهرست و جزئیات پروژه‌ها' },
        { command: '/tasks', description: 'وظایف باز کاربر' },
        { command: '/task', description: 'ثبت وظیفه جدید برای عضو پروژه' },
        { command: '/report', description: 'ثبت گزارش و پیوست پروژه' },
        { command: '/staffing', description: 'پروژه‌های نیازمند تعیین افراد' },
        { command: '/cancel', description: 'لغو فرآیند جاری' },
      ],
      activity,
    },
  });
};

export const listTelegramUsers = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  const { page, limit, skip } = readPagination(req);
  const search = String(req.query.search || '').trim();
  const linked = String(req.query.linked || '').trim();
  const filter: Record<string, unknown> = {};

  if (search) {
    const safe = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(safe, 'i');
    filter.$or = [
      { fullName: pattern },
      { username: pattern },
      { email: pattern },
      { telegramUsername: pattern },
      { telegramUserId: pattern },
      { telegramChatId: pattern },
    ];
  }

  const telegramLinkCondition = {
    $or: [
      { telegramUserId: { $exists: true, $ne: '' } },
      { telegramChatId: { $exists: true, $ne: '' } },
    ],
  };

  if (linked === 'true') {
    if (filter.$or) {
      filter.$and = [{ $or: filter.$or }, telegramLinkCondition];
      delete filter.$or;
    } else {
      Object.assign(filter, telegramLinkCondition);
    }
  }

  if (linked === 'false') {
    const noLinkCondition = {
      $and: [
        {
          $or: [
            { telegramUserId: { $exists: false } },
            { telegramUserId: '' },
          ],
        },
        {
          $or: [
            { telegramChatId: { $exists: false } },
            { telegramChatId: '' },
          ],
        },
      ],
    };

    if (filter.$or) {
      filter.$and = [{ $or: filter.$or }, noLinkCondition];
      delete filter.$or;
    } else {
      Object.assign(filter, noLinkCondition);
    }
  }

  const [items, total] = await Promise.all([
    User.find(filter)
      .select(
        'firstName lastName fullName username email role roleLabel status statusLabel isActive telegramUserId telegramChatId telegramUsername updatedAt',
      )
      .sort({ isActive: -1, fullName: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    User.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: items.map((item: any) => ({
      ...item,
      id: String(item._id),
      linked: Boolean(item.telegramUserId || item.telegramChatId),
    })),
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  });
};

export const configureTelegramWebhook = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  if (!env.telegramBotToken) {
    res.status(400).json({
      success: false,
      message: 'TELEGRAM_BOT_TOKEN تنظیم نشده است.',
      code: 'TELEGRAM_TOKEN_MISSING',
    });
    return;
  }

  if (!env.telegramWebhookSecret) {
    res.status(400).json({
      success: false,
      message: 'TELEGRAM_WEBHOOK_SECRET تنظیم نشده است.',
      code: 'TELEGRAM_SECRET_MISSING',
    });
    return;
  }

  const webhookUrl = normalizeWebhookUrl(
    req.body?.publicUrl || env.telegramBotPublicUrl,
  );

  if (!webhookUrl) {
    res.status(400).json({
      success: false,
      message:
        'یک آدرس عمومی معتبر HTTPS وارد کنید یا TELEGRAM_BOT_PUBLIC_URL را تنظیم کنید.',
      code: 'INVALID_TELEGRAM_PUBLIC_URL',
    });
    return;
  }

  await setTelegramWebhook({
    url: webhookUrl,
    secretToken: env.telegramWebhookSecret,
    dropPendingUpdates: Boolean(req.body?.dropPendingUpdates),
  });

  await setTelegramBotCommands([
    { command: 'start', description: 'راهنما و منوی اصلی' },
    { command: 'link', description: 'اتصال امن حساب با کد یک‌بارمصرف' },
    { command: 'summary', description: 'خلاصه مدیریتی' },
    { command: 'projects', description: 'فهرست و جزئیات پروژه‌ها' },
    { command: 'tasks', description: 'وظایف باز من' },
    { command: 'task', description: 'ثبت وظیفه جدید' },
    { command: 'report', description: 'ثبت گزارش پروژه' },
    { command: 'staffing', description: 'پروژه‌های نیازمند تعیین افراد' },
    { command: 'cancel', description: 'لغو عملیات جاری' },
  ]).catch((error) => {
    console.error('Telegram setMyCommands failed:', error);
  });

  const webhook = await getTelegramWebhookInfo();

  res.json({
    success: true,
    message: 'وبهوک تلگرام با موفقیت تنظیم شد.',
    data: { webhook },
  });
};

export const removeTelegramWebhook = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  if (!env.telegramBotToken) {
    res.status(400).json({
      success: false,
      message: 'TELEGRAM_BOT_TOKEN تنظیم نشده است.',
      code: 'TELEGRAM_TOKEN_MISSING',
    });
    return;
  }

  await deleteTelegramWebhook(Boolean(req.body?.dropPendingUpdates));

  res.json({
    success: true,
    message: 'وبهوک تلگرام حذف شد.',
  });
};

export const sendTelegramTest = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  const userId = String(req.body?.userId || '').trim();
  let chatId = String(req.body?.chatId || '').trim();

  if (userId) {
    const user = await User.findById(userId).select(
      'fullName username telegramChatId telegramUserId',
    );
    if (!user) {
      res.status(404).json({
        success: false,
        message: 'کاربر پیدا نشد.',
        code: 'USER_NOT_FOUND',
      });
      return;
    }
    chatId = user.telegramChatId || user.telegramUserId || '';
  }

  if (!chatId && req.user?.id) {
    const currentUser = await User.findById(req.user.id).select(
      'telegramChatId telegramUserId',
    );
    chatId = currentUser?.telegramChatId || currentUser?.telegramUserId || '';
  }

  if (!chatId) {
    res.status(400).json({
      success: false,
      message: 'برای ارسال آزمایشی، کاربر متصل یا Chat ID معتبر انتخاب کنید.',
      code: 'TELEGRAM_CHAT_ID_REQUIRED',
    });
    return;
  }

  const text =
    String(req.body?.message || '').trim() ||
    '✅ اتصال ربات تلگرام آوید با موفقیت بررسی شد.';

  await sendTelegramBotMessage(chatId, text, {
    parseMode: 'HTML',
  });

  res.json({
    success: true,
    message: 'پیام آزمایشی با موفقیت ارسال شد.',
  });
};

export const unlinkTelegramUser = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  const user = await User.findById(req.params.userId);
  if (!user) {
    res.status(404).json({
      success: false,
      message: 'کاربر پیدا نشد.',
      code: 'USER_NOT_FOUND',
    });
    return;
  }

  user.telegramUserId = '';
  user.telegramChatId = '';
  user.telegramUsername = '';
  user.updatedBy = req.user?.id ? (req.user.id as any) : null;
  await user.save();

  await Promise.all([
    TelegramBotSession.deleteMany({ linkedUserId: user._id }),
    TelegramTaskSession.deleteMany({ actorUserId: user._id }),
    TelegramLinkCode.deleteMany({ userId: user._id }),
  ]);

  res.json({
    success: true,
    message: 'اتصال تلگرام کاربر حذف شد.',
    data: {
      id: String(user._id),
      linked: false,
    },
  });
};


const TELEGRAM_LINK_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const TELEGRAM_LINK_CODE_TTL_MINUTES = 15;

const generateTelegramLinkCode = (): string => {
  return Array.from({ length: 8 }, () =>
    TELEGRAM_LINK_CODE_ALPHABET.charAt(
      crypto.randomInt(0, TELEGRAM_LINK_CODE_ALPHABET.length),
    ),
  ).join('');
};

export const createTelegramLinkCode = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  const user = await User.findById(req.params.userId).select(
    'fullName username email isActive telegramUserId telegramChatId',
  );

  if (!user) {
    res.status(404).json({
      success: false,
      message: 'کاربر پیدا نشد.',
      code: 'USER_NOT_FOUND',
    });
    return;
  }

  if (!user.isActive) {
    res.status(400).json({
      success: false,
      message: 'برای کاربر غیرفعال نمی‌توان کد اتصال تلگرام ساخت.',
      code: 'INACTIVE_USER',
    });
    return;
  }

  let code = '';
  let codeHash = '';
  let uniqueCodeFound = false;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    code = generateTelegramLinkCode();
    codeHash = hashTelegramLinkCode(code);
    const duplicate = await TelegramLinkCode.exists({ codeHash });
    if (!duplicate) {
      uniqueCodeFound = true;
      break;
    }
  }

  if (!code || !codeHash || !uniqueCodeFound) {
    res.status(500).json({
      success: false,
      message: 'ساخت کد اتصال تلگرام ناموفق بود.',
      code: 'TELEGRAM_LINK_CODE_GENERATION_FAILED',
    });
    return;
  }

  const expiresAt = new Date(
    Date.now() + TELEGRAM_LINK_CODE_TTL_MINUTES * 60 * 1000,
  );

  await TelegramLinkCode.findOneAndUpdate(
    { userId: user._id },
    {
      $set: {
        codeHash,
        expiresAt,
        createdBy: req.user?.id || null,
      },
      $setOnInsert: { userId: user._id },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  res.json({
    success: true,
    message: 'کد اتصال یک‌بارمصرف ساخته شد.',
    data: {
      userId: String(user._id),
      userName: user.fullName || user.username || user.email,
      code,
      command: `/link ${code}`,
      startParameter: `link_${code}`,
      expiresAt,
      expiresInMinutes: TELEGRAM_LINK_CODE_TTL_MINUTES,
      alreadyLinked: Boolean(user.telegramUserId || user.telegramChatId),
    },
  });
};
