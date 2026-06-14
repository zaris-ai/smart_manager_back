import { env } from '@/config/env';
import {
    Project,
    ProjectPriority,
    PROJECT_PRIORITY_LABELS,
    ProjectProgressNote,
    ProjectStatus,
    ProjectTask,
    ProjectTaskStatus,
} from '@/modules/projects/project.model';
import User, { UserRole, UserStatus } from '@/modules/users/user.model';
import {
    escapeTelegramHtml,
    isTelegramConfigured,
    sendTelegramMessage,
} from '@/modules/telegram/telegram.service';

const USER_SELECT = 'firstName lastName fullName username role roleLabel isActive';
const PROJECT_SELECT = 'title status priority startDate dueDate assignedUserIds';

const ALERT_CHECK_INTERVAL_MS = 30 * 1000;
const MAX_TASKS_IN_ALERT = 12;
const MAX_NOTES_IN_ALERT = 8;

type DailyAlertTrigger = 'schedule' | 'manual';

type SendDailyWorkAlertOptions = {
    trigger?: DailyAlertTrigger;
};

type TimeParts = {
    year: string;
    month: string;
    day: string;
    hour: string;
    minute: string;
};

let schedulerStarted = false;
let schedulerTimer: NodeJS.Timeout | null = null;
let lastScheduledAlertDateKey = '';

const openTaskStatuses = {
    $nin: [ProjectTaskStatus.DONE, ProjectTaskStatus.CANCELLED],
};

const getTimeParts = (date: Date, timeZone: string): TimeParts => {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    });

    const parts = formatter.formatToParts(date);

    const getPart = (type: string): string => {
        return parts.find((part) => part.type === type)?.value || '';
    };

    return {
        year: getPart('year'),
        month: getPart('month'),
        day: getPart('day'),
        hour: getPart('hour'),
        minute: getPart('minute'),
    };
};

const getDateKey = (
    date: Date,
    timeZone = env.telegramDailyAlertTimezone,
): string => {
    const parts = getTimeParts(date, timeZone);

    return `${parts.year}-${parts.month}-${parts.day}`;
};

const getTimeKey = (
    date: Date,
    timeZone = env.telegramDailyAlertTimezone,
): string => {
    const parts = getTimeParts(date, timeZone);

    return `${parts.hour}:${parts.minute}`;
};

const getYesterdayDateKey = (
    now: Date,
    timeZone = env.telegramDailyAlertTimezone,
): string => {
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    return getDateKey(yesterday, timeZone);
};

const formatDisplayDate = (date: Date): string => {
    return new Intl.DateTimeFormat('fa-IR', {
        timeZone: env.telegramDailyAlertTimezone,
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    }).format(date);
};

const getUserDisplayName = (user: any): string => {
    if (!user) return 'بدون مسئول';

    return (
        user.fullName ||
        `${user.firstName || ''} ${user.lastName || ''}`.trim() ||
        user.username ||
        'بدون نام'
    );
};

const getProjectTitle = (project: any): string => {
    return project?.title || 'پروژه نامشخص';
};

const getPriorityLabel = (priority: ProjectPriority | string): string => {
    return PROJECT_PRIORITY_LABELS[priority as ProjectPriority] || String(priority || '');
};

const truncate = (value: unknown, maxLength: number): string => {
    const text = String(value || '').trim();

    if (text.length <= maxLength) return text;

    return `${text.slice(0, maxLength - 1)}…`;
};

const formatAssignedUsers = (users: any[]): string => {
    if (!users?.length) return 'بدون مسئول';

    return users.map(getUserDisplayName).join('، ');
};

const formatTaskLine = (task: any, index: number): string => {
    const projectTitle = getProjectTitle(task.projectId);
    const assignedUsers = formatAssignedUsers(task.assignedUserIds || []);
    const priorityLabel = getPriorityLabel(task.priority);

    return [
        `${index}. <b>${escapeTelegramHtml(truncate(task.title, 90))}</b>`,
        `   پروژه: ${escapeTelegramHtml(projectTitle)}`,
        `   مسئول: ${escapeTelegramHtml(assignedUsers)}`,
        `   اولویت: ${escapeTelegramHtml(priorityLabel)}`,
    ].join('\n');
};

const formatNoteLine = (note: any, index: number): string => {
    const projectTitle = getProjectTitle(note.projectId);
    const authorName = getUserDisplayName(note.authorId);

    const progress =
        note.progressPercent !== null && note.progressPercent !== undefined
            ? ` | پیشرفت: ${note.progressPercent}%`
            : '';

    return [
        `${index}. <b>${escapeTelegramHtml(projectTitle)}</b>`,
        `   توسط: ${escapeTelegramHtml(authorName)}${escapeTelegramHtml(progress)}`,
        `   ${escapeTelegramHtml(truncate(note.note, 180))}`,
    ].join('\n');
};

const buildDailyAlertMessage = async (
    trigger: DailyAlertTrigger,
): Promise<string> => {
    const now = new Date();
    const todayKey = getDateKey(now);
    const yesterdayKey = getYesterdayDateKey(now);
    const recentNotesFrom = new Date(now.getTime() - 48 * 60 * 60 * 1000);

    const [
        activeManagersCount,
        activeProjectsCount,
        activeProjects,
        openTasks,
        recentNotes,
    ] = await Promise.all([
        User.countDocuments({
            role: UserRole.MANAGER,
            status: UserStatus.ACTIVE,
            isActive: true,
        }),

        Project.countDocuments({
            status: ProjectStatus.ACTIVE,
        }),

        Project.find({
            status: ProjectStatus.ACTIVE,
        })
            .select(PROJECT_SELECT)
            .sort({ priority: 1, dueDate: 1 })
            .limit(20),

        ProjectTask.find({
            status: openTaskStatuses,
        })
            .populate('projectId', PROJECT_SELECT)
            .populate('assignedUserIds', USER_SELECT)
            .sort({ dueDate: 1, priority: 1 })
            .limit(200),

        ProjectProgressNote.find({
            createdAt: { $gte: recentNotesFrom },
        })
            .populate('projectId', PROJECT_SELECT)
            .populate('authorId', USER_SELECT)
            .sort({ createdAt: -1 })
            .limit(100),
    ]);

    const todayTasks = openTasks.filter((task) => {
        return task.dueDate ? getDateKey(task.dueDate) === todayKey : false;
    });

    const overdueTasks = openTasks.filter((task) => {
        return task.dueDate ? getDateKey(task.dueDate) < todayKey : false;
    });

    const noDueDateTasks = openTasks.filter((task) => !task.dueDate);

    const yesterdayNotes = recentNotes.filter((note) => {
        return getDateKey(note.createdAt) === yesterdayKey;
    });

    const activeProjectsDueSoon = activeProjects.filter((project) => {
        if (!project.dueDate) return false;

        const dueKey = getDateKey(project.dueDate);

        return dueKey >= todayKey;
    });

    const header = [
        '📌 <b>گزارش صبحگاهی مدیران</b>',
        `🗓 ${escapeTelegramHtml(formatDisplayDate(now))}`,
        `⏱ زمان‌بندی: ${escapeTelegramHtml(env.telegramDailyAlertTime)} / ${escapeTelegramHtml(env.telegramDailyAlertTimezone)}`,
        trigger === 'manual' ? '🧪 ارسال دستی برای تست' : '',
    ]
        .filter(Boolean)
        .join('\n');

    const summary = [
        '',
        '📊 <b>خلاصه وضعیت</b>',
        `• مدیران فعال: ${activeManagersCount}`,
        `• پروژه‌های فعال: ${activeProjectsCount}`,
        `• کارهای موعد امروز: ${todayTasks.length}`,
        `• کارهای عقب‌افتاده: ${overdueTasks.length}`,
        `• کارهای بدون موعد: ${noDueDateTasks.length}`,
        `• گزارش‌های ثبت‌شده دیروز: ${yesterdayNotes.length}`,
    ].join('\n');

    const todaySection = [
        '',
        '✅ <b>کارهای موعد امروز</b>',
        todayTasks.length
            ? todayTasks
                .slice(0, MAX_TASKS_IN_ALERT)
                .map((task, index) => formatTaskLine(task, index + 1))
                .join('\n\n')
            : 'برای امروز کار موعددار ثبت نشده است.',
        todayTasks.length > MAX_TASKS_IN_ALERT
            ? `\n+${todayTasks.length - MAX_TASKS_IN_ALERT} کار دیگر`
            : '',
    ]
        .filter(Boolean)
        .join('\n');

    const overdueSection = [
        '',
        '⚠️ <b>کارهای عقب‌افتاده</b>',
        overdueTasks.length
            ? overdueTasks
                .slice(0, MAX_TASKS_IN_ALERT)
                .map((task, index) => formatTaskLine(task, index + 1))
                .join('\n\n')
            : 'کار عقب‌افتاده‌ای وجود ندارد.',
        overdueTasks.length > MAX_TASKS_IN_ALERT
            ? `\n+${overdueTasks.length - MAX_TASKS_IN_ALERT} کار دیگر`
            : '',
    ]
        .filter(Boolean)
        .join('\n');

    const notesSection = [
        '',
        '📝 <b>گزارش‌های کاری دیروز</b>',
        yesterdayNotes.length
            ? yesterdayNotes
                .slice(0, MAX_NOTES_IN_ALERT)
                .map((note, index) => formatNoteLine(note, index + 1))
                .join('\n\n')
            : 'دیروز گزارشی ثبت نشده است.',
        yesterdayNotes.length > MAX_NOTES_IN_ALERT
            ? `\n+${yesterdayNotes.length - MAX_NOTES_IN_ALERT} گزارش دیگر`
            : '',
    ]
        .filter(Boolean)
        .join('\n');

    const projectsSection = [
        '',
        '📁 <b>پروژه‌های فعال نزدیک به موعد</b>',
        activeProjectsDueSoon.length
            ? activeProjectsDueSoon
                .slice(0, 8)
                .map((project, index) => {
                    const dueDate = project.dueDate
                        ? new Intl.DateTimeFormat('fa-IR', {
                            timeZone: env.telegramDailyAlertTimezone,
                            month: 'short',
                            day: 'numeric',
                        }).format(project.dueDate)
                        : 'بدون موعد';

                    return `${index + 1}. ${escapeTelegramHtml(project.title)} — ${escapeTelegramHtml(getPriorityLabel(project.priority))} — ${escapeTelegramHtml(dueDate)}`;
                })
                .join('\n')
            : 'پروژه فعالی با موعد آینده ثبت نشده است.',
    ].join('\n');

    const footer = [
        '',
        '—',
        'این پیام به صورت خودکار از پنل مدیریت پروژه آوید ارسال شده است.',
        env.telegramAlertDashboardUrl
            ? `داشبورد: ${escapeTelegramHtml(env.telegramAlertDashboardUrl)}`
            : '',
    ]
        .filter(Boolean)
        .join('\n');

    return [
        header,
        summary,
        todaySection,
        overdueSection,
        notesSection,
        projectsSection,
        footer,
    ].join('\n');
};

export const sendDailyWorkAlert = async (
    options: SendDailyWorkAlertOptions = {},
): Promise<{ sent: boolean; reason?: string }> => {
    if (!isTelegramConfigured()) {
        return {
            sent: false,
            reason: 'Telegram is not configured.',
        };
    }

    const message = await buildDailyAlertMessage(options.trigger || 'schedule');

    await sendTelegramMessage(message);

    return { sent: true };
};

const isValidAlertTime = (value: string): boolean => {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
};

const shouldSendScheduledAlert = (now: Date): boolean => {
    if (!env.telegramDailyAlertEnabled) return false;
    if (!isTelegramConfigured()) return false;
    if (!isValidAlertTime(env.telegramDailyAlertTime)) return false;

    const currentTimeKey = getTimeKey(now);
    const currentDateKey = getDateKey(now);

    return (
        currentTimeKey === env.telegramDailyAlertTime &&
        lastScheduledAlertDateKey !== currentDateKey
    );
};

export const startDailyWorkAlertScheduler = (): void => {
    if (schedulerStarted) return;

    schedulerStarted = true;

    if (!env.telegramDailyAlertEnabled) {
        console.log('Telegram daily work alert scheduler is disabled.');
        return;
    }

    if (!isTelegramConfigured()) {
        console.warn(
            'Telegram daily work alert scheduler is enabled but TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID is missing.',
        );
        return;
    }

    if (!isValidAlertTime(env.telegramDailyAlertTime)) {
        console.warn(
            `Invalid TELEGRAM_DAILY_ALERT_TIME: ${env.telegramDailyAlertTime}. Expected HH:mm, for example 08:30.`,
        );
        return;
    }

    schedulerTimer = setInterval(async () => {
        const now = new Date();

        if (!shouldSendScheduledAlert(now)) return;

        const currentDateKey = getDateKey(now);
        lastScheduledAlertDateKey = currentDateKey;

        try {
            await sendDailyWorkAlert({ trigger: 'schedule' });
            console.log(`Telegram daily work alert sent for ${currentDateKey}.`);
        } catch (error) {
            lastScheduledAlertDateKey = '';
            console.error('Failed to send Telegram daily work alert:', error);
        }
    }, ALERT_CHECK_INTERVAL_MS);

    schedulerTimer.unref?.();

    console.log(
        `Telegram daily work alert scheduler started at ${env.telegramDailyAlertTime} (${env.telegramDailyAlertTimezone}).`,
    );
};

export const stopDailyWorkAlertScheduler = (): void => {
    if (schedulerTimer) {
        clearInterval(schedulerTimer);
        schedulerTimer = null;
    }

    schedulerStarted = false;
};