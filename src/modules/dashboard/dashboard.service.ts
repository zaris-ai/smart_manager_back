import { Types } from 'mongoose';
import {
    Project,
    PROJECT_PRIORITY_LABELS,
    PROJECT_STATUS_LABELS,
    ProjectFile,
    ProjectPriority,
    ProjectProgressNote,
    ProjectStatus,
    ProjectTask,
    ProjectTaskStatus,
    PROJECT_TASK_STATUS_LABELS,
} from '@/modules/projects/project.model';
import User, { UserStatus } from '@/modules/users/user.model';
import { AuthenticatedRequest } from '@/modules/auth/auth.middleware';

type RoleScope = 'manager' | 'employee';

type CountItem = {
    key: string;
    label: string;
    count: number;
};

type TrendItem = {
    date: string;
    label: string;
    workLogs: number;
    completedTasks: number;
};

type RecentActivity = {
    id: string;
    type: 'project' | 'task' | 'note' | 'file';
    title: string;
    description: string;
    date: string;
    projectId?: string;
};

export type DashboardSummary = {
    generatedAt: string;
    scope: RoleScope;
    stats: {
        totalUsers: number;
        activeUsers: number;
        totalProjects: number;
        activeProjects: number;
        completedProjects: number;
        openTasks: number;
        dueTodayTasks: number;
        overdueTasks: number;
        completedTasks: number;
        workLogsToday: number;
        workLogsYesterday: number;
        uploadedFiles: number;
        completionRate: number;
    };
    projectStatus: CountItem[];
    projectPriority: CountItem[];
    taskStatus: CountItem[];
    workTrend: TrendItem[];
    recentActivities: RecentActivity[];
};

const OPEN_TASK_STATUSES = [
    ProjectTaskStatus.TODO,
    ProjectTaskStatus.IN_PROGRESS,
    ProjectTaskStatus.BLOCKED,
];

const getAuthUserId = (req: AuthenticatedRequest): string => {
    return String(req.user?.id || req.user?.userId || '');
};

const getScope = (req: AuthenticatedRequest): RoleScope => {
    const role = String(req.user?.role || '').toLowerCase();

    return role === 'manager' || role === 'admin' ? 'manager' : 'employee';
};

const isValidObjectId = (value: string): boolean => {
    return Types.ObjectId.isValid(value);
};

const toObjectId = (value: string): Types.ObjectId => {
    return new Types.ObjectId(value);
};

const startOfDay = (date: Date): Date => {
    const clonedDate = new Date(date);
    clonedDate.setHours(0, 0, 0, 0);

    return clonedDate;
};

const endOfDay = (date: Date): Date => {
    const clonedDate = new Date(date);
    clonedDate.setHours(23, 59, 59, 999);

    return clonedDate;
};

const addDays = (date: Date, days: number): Date => {
    const clonedDate = new Date(date);
    clonedDate.setDate(clonedDate.getDate() + days);

    return clonedDate;
};

const toDateKey = (date: Date): string => {
    return date.toISOString().slice(0, 10);
};

const toPersianShortDate = (date: Date): string => {
    return new Intl.DateTimeFormat('fa-IR', {
        month: 'short',
        day: 'numeric',
    }).format(date);
};

const normalizeCount = async (
    filter: Record<string, unknown>,
    model: { countDocuments: (filter: any) => Promise<number> },
): Promise<number> => {
    return model.countDocuments(filter as any);
};

const buildScopedFilters = (req: AuthenticatedRequest) => {
    const scope = getScope(req);
    const authUserId = getAuthUserId(req);
    const canUseUserId = isValidObjectId(authUserId);
    const userObjectId = canUseUserId ? toObjectId(authUserId) : null;

    if (scope === 'manager') {
        return {
            scope,
            projectFilter: {} as Record<string, unknown>,
            taskFilter: {} as Record<string, unknown>,
            noteFilter: {} as Record<string, unknown>,
            fileFilter: {} as Record<string, unknown>,
        };
    }

    if (!userObjectId) {
        return {
            scope,
            projectFilter: { _id: null } as Record<string, unknown>,
            taskFilter: { _id: null } as Record<string, unknown>,
            noteFilter: { _id: null } as Record<string, unknown>,
            fileFilter: { _id: null } as Record<string, unknown>,
        };
    }

    return {
        scope,
        projectFilter: { assignedUserIds: userObjectId } as Record<string, unknown>,
        taskFilter: { assignedUserIds: userObjectId } as Record<string, unknown>,
        noteFilter: { authorId: userObjectId } as Record<string, unknown>,
        fileFilter: { uploadedBy: userObjectId } as Record<string, unknown>,
    };
};

const countByEnum = async <T extends string>(
    keys: readonly T[],
    labels: Record<T, string>,
    fieldName: string,
    baseFilter: Record<string, unknown>,
    model: { countDocuments: (filter: any) => Promise<number> },
): Promise<CountItem[]> => {
    const items = await Promise.all(
        keys.map(async (key) => {
            const count = await normalizeCount(
                {
                    ...baseFilter,
                    [fieldName]: key,
                },
                model,
            );

            return {
                key,
                label: labels[key],
                count,
            };
        }),
    );

    return items;
};

const getProjectTitle = (project: any): string => {
    if (!project) return 'پروژه نامشخص';

    return project.title || 'پروژه نامشخص';
};

const trimText = (value: unknown, maxLength: number): string => {
    const text = String(value || '').trim();

    if (!text) return '';
    if (text.length <= maxLength) return text;

    return `${text.slice(0, maxLength - 1)}…`;
};

const buildRecentActivities = async (
    projectFilter: Record<string, unknown>,
    taskFilter: Record<string, unknown>,
    noteFilter: Record<string, unknown>,
    fileFilter: Record<string, unknown>,
): Promise<RecentActivity[]> => {
    const [projects, tasks, notes, files] = await Promise.all([
        Project.find(projectFilter as any)
            .sort({ createdAt: -1 })
            .limit(5)
            .lean(),

        ProjectTask.find(taskFilter as any)
            .populate('projectId', 'title')
            .sort({ updatedAt: -1 })
            .limit(5)
            .lean(),

        ProjectProgressNote.find(noteFilter as any)
            .populate('projectId', 'title')
            .populate('authorId', 'firstName lastName fullName username')
            .sort({ createdAt: -1 })
            .limit(5)
            .lean(),

        ProjectFile.find(fileFilter as any)
            .populate('projectId', 'title')
            .populate('uploadedBy', 'firstName lastName fullName username')
            .sort({ createdAt: -1 })
            .limit(5)
            .lean(),
    ]);

    const projectActivities: RecentActivity[] = projects.map((project: any) => ({
        id: String(project._id),
        type: 'project',
        title: `ایجاد پروژه: ${project.title}`,
        description: project.description
            ? trimText(project.description, 100)
            : 'پروژه جدید در سامانه ثبت شد.',
        date: new Date(project.createdAt).toISOString(),
        projectId: String(project._id),
    }));

    const taskActivities: RecentActivity[] = tasks.map((task: any) => ({
        id: String(task._id),
        type: 'task',
        title: `وظیفه: ${task.title}`,
        description: `${getProjectTitle(task.projectId)} · ${PROJECT_TASK_STATUS_LABELS[task.status as ProjectTaskStatus] || task.status
            }`,
        date: new Date(task.updatedAt || task.createdAt).toISOString(),
        projectId: task.projectId?._id ? String(task.projectId._id) : undefined,
    }));

    const noteActivities: RecentActivity[] = notes.map((note: any) => ({
        id: String(note._id),
        type: 'note',
        title: `گزارش کار: ${getProjectTitle(note.projectId)}`,
        description: trimText(note.note, 140) || 'گزارش کار جدید ثبت شد.',
        date: new Date(note.createdAt).toISOString(),
        projectId: note.projectId?._id ? String(note.projectId._id) : undefined,
    }));

    const fileActivities: RecentActivity[] = files.map((file: any) => ({
        id: String(file._id),
        type: 'file',
        title: `فایل جدید: ${file.originalName}`,
        description: `${getProjectTitle(file.projectId)} · ${file.categoryLabel || 'سایر'
            }`,
        date: new Date(file.createdAt).toISOString(),
        projectId: file.projectId?._id ? String(file.projectId._id) : undefined,
    }));

    return [
        ...projectActivities,
        ...taskActivities,
        ...noteActivities,
        ...fileActivities,
    ]
        .sort((first, second) => {
            return new Date(second.date).getTime() - new Date(first.date).getTime();
        })
        .slice(0, 8);
};

const buildWorkTrend = async (
    noteFilter: Record<string, unknown>,
    taskFilter: Record<string, unknown>,
): Promise<TrendItem[]> => {
    const today = startOfDay(new Date());
    const firstDay = addDays(today, -6);
    const lastDay = endOfDay(today);

    const [notes, completedTasks] = await Promise.all([
        ProjectProgressNote.find({
            ...noteFilter,
            createdAt: { $gte: firstDay, $lte: lastDay },
        } as any)
            .select('createdAt')
            .lean(),

        ProjectTask.find({
            ...taskFilter,
            status: ProjectTaskStatus.DONE,
            completedAt: { $gte: firstDay, $lte: lastDay },
        } as any)
            .select('completedAt updatedAt')
            .lean(),
    ]);

    return Array.from({ length: 7 }).map((_, index) => {
        const day = addDays(firstDay, index);
        const dayKey = toDateKey(day);

        const workLogs = notes.filter((note: any) => {
            return toDateKey(new Date(note.createdAt)) === dayKey;
        }).length;

        const completedCount = completedTasks.filter((task: any) => {
            const completedDate = task.completedAt || task.updatedAt;

            return completedDate && toDateKey(new Date(completedDate)) === dayKey;
        }).length;

        return {
            date: dayKey,
            label: toPersianShortDate(day),
            workLogs,
            completedTasks: completedCount,
        };
    });
};

export const buildDashboardSummary = async (
    req: AuthenticatedRequest,
): Promise<DashboardSummary> => {
    const { scope, projectFilter, taskFilter, noteFilter, fileFilter } =
        buildScopedFilters(req);

    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);
    const yesterdayStart = startOfDay(addDays(now, -1));
    const yesterdayEnd = endOfDay(addDays(now, -1));

    const totalTasks = await normalizeCount(taskFilter, ProjectTask);

    const [
        totalUsers,
        activeUsers,
        totalProjects,
        activeProjects,
        completedProjects,
        openTasks,
        dueTodayTasks,
        overdueTasks,
        completedTasks,
        workLogsToday,
        workLogsYesterday,
        uploadedFiles,
        projectStatus,
        projectPriority,
        taskStatus,
        workTrend,
        recentActivities,
    ] = await Promise.all([
        scope === 'manager' ? normalizeCount({}, User) : Promise.resolve(1),

        scope === 'manager'
            ? normalizeCount({ status: UserStatus.ACTIVE, isActive: true }, User)
            : Promise.resolve(1),

        normalizeCount(projectFilter, Project),

        normalizeCount({ ...projectFilter, status: ProjectStatus.ACTIVE }, Project),

        normalizeCount(
            { ...projectFilter, status: ProjectStatus.COMPLETED },
            Project,
        ),

        normalizeCount(
            { ...taskFilter, status: { $in: OPEN_TASK_STATUSES } },
            ProjectTask,
        ),

        normalizeCount(
            {
                ...taskFilter,
                status: { $in: OPEN_TASK_STATUSES },
                dueDate: { $gte: todayStart, $lte: todayEnd },
            },
            ProjectTask,
        ),

        normalizeCount(
            {
                ...taskFilter,
                status: { $in: OPEN_TASK_STATUSES },
                dueDate: { $lt: todayStart },
            },
            ProjectTask,
        ),

        normalizeCount({ ...taskFilter, status: ProjectTaskStatus.DONE }, ProjectTask),

        normalizeCount(
            {
                ...noteFilter,
                createdAt: { $gte: todayStart, $lte: todayEnd },
            },
            ProjectProgressNote,
        ),

        normalizeCount(
            {
                ...noteFilter,
                createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd },
            },
            ProjectProgressNote,
        ),

        normalizeCount(fileFilter, ProjectFile),

        countByEnum(
            Object.values(ProjectStatus),
            PROJECT_STATUS_LABELS,
            'status',
            projectFilter,
            Project,
        ),

        countByEnum(
            Object.values(ProjectPriority),
            PROJECT_PRIORITY_LABELS,
            'priority',
            projectFilter,
            Project,
        ),

        countByEnum(
            Object.values(ProjectTaskStatus),
            PROJECT_TASK_STATUS_LABELS,
            'status',
            taskFilter,
            ProjectTask,
        ),

        buildWorkTrend(noteFilter, taskFilter),

        buildRecentActivities(projectFilter, taskFilter, noteFilter, fileFilter),
    ]);

    const completionRate =
        totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    return {
        generatedAt: now.toISOString(),
        scope,
        stats: {
            totalUsers,
            activeUsers,
            totalProjects,
            activeProjects,
            completedProjects,
            openTasks,
            dueTodayTasks,
            overdueTasks,
            completedTasks,
            workLogsToday,
            workLogsYesterday,
            uploadedFiles,
            completionRate,
        },
        projectStatus,
        projectPriority,
        taskStatus,
        workTrend,
        recentActivities,
    };
};