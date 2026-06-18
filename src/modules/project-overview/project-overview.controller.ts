// src/modules/project-overview/project-overview.controller.ts

import { Request, Response } from 'express';
import User from '@/modules/users/user.model';
import { ProjectRole } from '@/modules/project-roles/project-role.model';
import {
  Project,
  ProjectFile,
  ProjectFileCategory,
  ProjectPriority,
  PROJECT_PRIORITY_LABELS,
  ProjectStatus,
  PROJECT_STATUS_LABELS,
  ProjectTask,
  ProjectTaskStatus,
  PROJECT_TASK_STATUS_LABELS,
} from '@/modules/projects/project.model';

type CountMap = Record<string, number>;
type SizeMap = Record<string, number>;

type LeanRecord = Record<string, any>;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const PROJECT_STATUS_ORDER: ProjectStatus[] = [
  ProjectStatus.NEGOTIATING,
  ProjectStatus.PROPOSAL_DRAFTING,
  ProjectStatus.CONTRACT_SIGNING,
  ProjectStatus.PLANNING,
  ProjectStatus.ACTIVE,
  ProjectStatus.ON_HOLD,
  ProjectStatus.COMPLETED,
  ProjectStatus.CANCELLED,
];

const PROJECT_PRIORITY_ORDER: ProjectPriority[] = [
  ProjectPriority.CRITICAL,
  ProjectPriority.HIGH,
  ProjectPriority.MEDIUM,
  ProjectPriority.LOW,
];

const TASK_STATUS_ORDER: ProjectTaskStatus[] = [
  ProjectTaskStatus.TODO,
  ProjectTaskStatus.IN_PROGRESS,
  ProjectTaskStatus.BLOCKED,
  ProjectTaskStatus.DONE,
  ProjectTaskStatus.CANCELLED,
];

const CLOSED_PROJECT_STATUSES = new Set<string>([
  ProjectStatus.COMPLETED,
  ProjectStatus.CANCELLED,
]);

const CLOSED_TASK_STATUSES = new Set<string>([
  ProjectTaskStatus.DONE,
  ProjectTaskStatus.CANCELLED,
]);

const toId = (value: unknown): string => {
  if (value === null || value === undefined) return '';

  if (typeof value === 'string') return value;

  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }

  if (typeof value !== 'object') return '';

  const record = value as {
    _id?: unknown;
    id?: unknown;
    toHexString?: () => string;
    toString?: () => string;
  };

  /**
   * Mongoose ObjectId has both `_id` and `id` getters in some cases.
   * Accessing `_id` on an ObjectId can return the same ObjectId again, which
   * caused infinite recursion. Always handle ObjectId directly first.
   */
  if (typeof record.toHexString === 'function') {
    try {
      const hex = record.toHexString();

      if (hex && hex !== '[object Object]') return hex;
    } catch {
      // Continue to other safe fallbacks.
    }
  }

  if (record._id && record._id !== value) {
    const id = toId(record._id);

    if (id) return id;
  }

  if (record.id && record.id !== value) {
    const id = toId(record.id);

    if (id) return id;
  }

  if (typeof record.toString === 'function') {
    try {
      const stringValue = record.toString();

      if (stringValue && stringValue !== '[object Object]') return stringValue;
    } catch {
      // Ignore unsafe toString implementations.
    }
  }

  return '';
};

const startOfToday = (): Date => {
  const now = new Date();

  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

const toDate = (value: unknown): Date | null => {
  if (!value) return null;

  const date = value instanceof Date ? value : new Date(String(value));

  if (Number.isNaN(date.getTime())) return null;

  return date;
};

const formatDate = (value: unknown): string | null => {
  const date = toDate(value);

  if (!date) return null;

  return date.toISOString();
};

const isPastDate = (value: unknown, today: Date): boolean => {
  const date = toDate(value);

  if (!date) return false;

  return date.getTime() < today.getTime();
};

const daysBetween = (from: Date, to: Date): number => {
  return Math.ceil((to.getTime() - from.getTime()) / ONE_DAY_MS);
};

const increment = (map: CountMap, key: string, amount = 1): void => {
  map[key] = (map[key] || 0) + amount;
};

const addSize = (map: SizeMap, key: string, amount = 0): void => {
  map[key] = (map[key] || 0) + amount;
};

const getUserDisplayName = (user: LeanRecord | undefined): string => {
  if (!user) return 'نامشخص';

  return String(
    user.fullName ||
      [user.firstName, user.lastName].filter(Boolean).join(' ') ||
      user.username ||
      user.email ||
      'نامشخص',
  );
};

const getRoleTitle = (role: LeanRecord | undefined, fallback?: string): string => {
  if (role) {
    return String(role.title || role.name || fallback || 'بدون نقش');
  }

  return String(fallback || 'بدون نقش');
};

const buildStatusChart = (
  counts: CountMap,
  overdueCounts: CountMap,
) => {
  return PROJECT_STATUS_ORDER.map((status) => ({
    key: status,
    label: PROJECT_STATUS_LABELS[status],
    count: counts[status] || 0,
    overdue: overdueCounts[status] || 0,
  })).filter((item) => item.count > 0 || item.overdue > 0);
};

const buildPriorityChart = (counts: CountMap) => {
  return PROJECT_PRIORITY_ORDER.map((priority) => ({
    key: priority,
    label: PROJECT_PRIORITY_LABELS[priority],
    count: counts[priority] || 0,
  })).filter((item) => item.count > 0);
};

const buildTaskStatusChart = (counts: CountMap, overdueCounts: CountMap) => {
  return TASK_STATUS_ORDER.map((status) => ({
    key: status,
    label: PROJECT_TASK_STATUS_LABELS[status],
    count: counts[status] || 0,
    overdue: overdueCounts[status] || 0,
  })).filter((item) => item.count > 0 || item.overdue > 0);
};

export const getProjectOverview = async (_req: Request, res: Response) => {
  const today = startOfToday();
  const nextSevenDays = new Date(today.getTime() + 7 * ONE_DAY_MS);

  const [projects, tasks, files, roles, users] = await Promise.all([
    Project.find({}).lean(),
    ProjectTask.find({}).lean(),
    ProjectFile.find({}).lean(),
    ProjectRole.find({}).lean(),
    User.find({})
      .select('firstName lastName fullName username email role roleLabel isActive')
      .lean(),
  ]);

  const projectById = new Map<string, LeanRecord>();
  const roleById = new Map<string, LeanRecord>();
  const userById = new Map<string, LeanRecord>();

  projects.forEach((project: LeanRecord) => {
    projectById.set(toId(project._id), project);
  });

  roles.forEach((role: LeanRecord) => {
    roleById.set(toId(role._id), role);
  });

  users.forEach((user: LeanRecord) => {
    userById.set(toId(user._id), user);
  });

  const projectStatusCounts: CountMap = {};
  const projectStatusOverdueCounts: CountMap = {};
  const projectPriorityCounts: CountMap = {};
  const taskStatusCounts: CountMap = {};
  const taskStatusOverdueCounts: CountMap = {};
  const roleTotals: Record<string, LeanRecord> = {};
  const expertTotals: Record<string, LeanRecord> = {};
  const reportSizeByProject: SizeMap = {};
  const reportCountByProject: CountMap = {};

  let overdueProjects = 0;
  let dueSoonProjects = 0;
  let activeProjects = 0;
  let completedProjects = 0;
  let cancelledProjects = 0;
  let overdueTasks = 0;
  let blockedTasks = 0;
  let doneTasks = 0;
  let reportFilesCount = 0;
  let reportFilesSizeBytes = 0;

  const overdueProjectRows = projects
    .map((project: LeanRecord) => {
      const status = String(project.status || ProjectStatus.ACTIVE);
      const priority = String(project.priority || ProjectPriority.MEDIUM);
      const dueDate = toDate(project.dueDate);
      const isClosed = CLOSED_PROJECT_STATUSES.has(status);
      const isOverdue = Boolean(dueDate && dueDate < today && !isClosed);
      const isDueSoon = Boolean(
        dueDate && dueDate >= today && dueDate <= nextSevenDays && !isClosed,
      );

      increment(projectStatusCounts, status);
      increment(projectPriorityCounts, priority);

      if (isOverdue) {
        overdueProjects += 1;
        increment(projectStatusOverdueCounts, status);
      }

      if (isDueSoon) {
        dueSoonProjects += 1;
      }

      if (status === ProjectStatus.ACTIVE) {
        activeProjects += 1;
      }

      if (status === ProjectStatus.COMPLETED) {
        completedProjects += 1;
      }

      if (status === ProjectStatus.CANCELLED) {
        cancelledProjects += 1;
      }

      return {
        id: toId(project._id),
        title: String(project.title || 'بدون عنوان'),
        status,
        statusLabel: PROJECT_STATUS_LABELS[status as ProjectStatus] || status,
        priority,
        priorityLabel: PROJECT_PRIORITY_LABELS[priority as ProjectPriority] || priority,
        dueDate: formatDate(project.dueDate),
        daysOverdue: dueDate && isOverdue ? Math.abs(daysBetween(today, dueDate)) : 0,
        ownerId: toId(project.ownerId),
        ownerName: getUserDisplayName(userById.get(toId(project.ownerId))),
      };
    })
    .filter((project: LeanRecord) => project.daysOverdue > 0)
    .sort((a: LeanRecord, b: LeanRecord) => b.daysOverdue - a.daysOverdue)
    .slice(0, 10);

  tasks.forEach((task: LeanRecord) => {
    const status = String(task.status || ProjectTaskStatus.TODO);
    const project = projectById.get(toId(task.projectId));
    const projectClosed = project
      ? CLOSED_PROJECT_STATUSES.has(String(project.status || ''))
      : false;
    const isClosedTask = CLOSED_TASK_STATUSES.has(status);
    const isOverdue = Boolean(
      task.dueDate && isPastDate(task.dueDate, today) && !isClosedTask && !projectClosed,
    );

    increment(taskStatusCounts, status);

    if (isOverdue) {
      overdueTasks += 1;
      increment(taskStatusOverdueCounts, status);
    }

    if (status === ProjectTaskStatus.BLOCKED) {
      blockedTasks += 1;
    }

    if (status === ProjectTaskStatus.DONE) {
      doneTasks += 1;
    }
  });

  projects.forEach((project: LeanRecord) => {
    const projectStatus = String(project.status || '');
    const projectClosed = CLOSED_PROJECT_STATUSES.has(projectStatus);
    const projectDueDate = toDate(project.dueDate);
    const projectIsOverdue = Boolean(projectDueDate && projectDueDate < today && !projectClosed);
    const members = Array.isArray(project.projectMembers) ? project.projectMembers : [];

    members.forEach((member: LeanRecord) => {
      const userId = toId(member.userId);
      const roleId = toId(member.roleId);
      const role = roleById.get(roleId);
      const user = userById.get(userId);
      const roleKey = roleId || member.roleInProject || 'without-role';
      const expertKey = userId || 'without-user';
      const memberExpectedFinish = toDate(member.expectedFinishedAt);
      const memberIsOverdue = Boolean(
        !projectClosed &&
          ((memberExpectedFinish && memberExpectedFinish < today) ||
            (!memberExpectedFinish && projectIsOverdue)),
      );

      if (!roleTotals[roleKey]) {
        roleTotals[roleKey] = {
          id: roleId,
          title: getRoleTitle(role, member.roleInProject),
          totalProjects: 0,
          overdueProjects: 0,
          activeProjects: 0,
        };
      }

      roleTotals[roleKey].totalProjects += 1;

      if (!projectClosed) {
        roleTotals[roleKey].activeProjects += 1;
      }

      if (memberIsOverdue) {
        roleTotals[roleKey].overdueProjects += 1;
      }

      if (!expertTotals[expertKey]) {
        expertTotals[expertKey] = {
          id: userId,
          name: getUserDisplayName(user),
          totalProjects: 0,
          overdueProjects: 0,
          activeProjects: 0,
          roles: new Set<string>(),
        };
      }

      expertTotals[expertKey].totalProjects += 1;

      if (!projectClosed) {
        expertTotals[expertKey].activeProjects += 1;
      }

      if (memberIsOverdue) {
        expertTotals[expertKey].overdueProjects += 1;
      }

      if (roleTotals[roleKey]?.title) {
        expertTotals[expertKey].roles.add(roleTotals[roleKey].title);
      }
    });
  });

  files.forEach((file: LeanRecord) => {
    const category = String(file.category || '');
    const fileSize = Number(file.fileSize || 0);
    const projectId = toId(file.projectId);

    if (category === ProjectFileCategory.REPORTS) {
      reportFilesCount += 1;
      reportFilesSizeBytes += fileSize;
      increment(reportCountByProject, projectId);
      addSize(reportSizeByProject, projectId, fileSize);
    }
  });

  const byRole = Object.values(roleTotals)
    .map((role: LeanRecord) => ({
      id: String(role.id || ''),
      title: String(role.title || 'بدون نقش'),
      totalProjects: Number(role.totalProjects || 0),
      activeProjects: Number(role.activeProjects || 0),
      overdueProjects: Number(role.overdueProjects || 0),
    }))
    .sort((a: LeanRecord, b: LeanRecord) => b.overdueProjects - a.overdueProjects || b.totalProjects - a.totalProjects);

  const byExpert = Object.values(expertTotals)
    .map((expert: LeanRecord) => ({
      id: String(expert.id || ''),
      name: String(expert.name || 'نامشخص'),
      totalProjects: Number(expert.totalProjects || 0),
      activeProjects: Number(expert.activeProjects || 0),
      overdueProjects: Number(expert.overdueProjects || 0),
      roles: Array.from(expert.roles || []),
    }))
    .sort((a: LeanRecord, b: LeanRecord) => b.overdueProjects - a.overdueProjects || b.totalProjects - a.totalProjects);

  const reportVolumeByProject = Object.entries(reportSizeByProject)
    .map(([projectId, sizeBytes]) => {
      const project = projectById.get(projectId);

      return {
        projectId,
        projectTitle: String(project?.title || 'بدون عنوان'),
        reportFilesCount: reportCountByProject[projectId] || 0,
        reportFilesSizeBytes: sizeBytes,
      };
    })
    .sort((a, b) => b.reportFilesSizeBytes - a.reportFilesSizeBytes)
    .slice(0, 10);

  return res.json({
    success: true,
    message: 'نمای کلان پروژه‌ها با موفقیت دریافت شد.',
    data: {
      generatedAt: new Date().toISOString(),
      summary: {
        totalProjects: projects.length,
        activeProjects,
        completedProjects,
        cancelledProjects,
        overdueProjects,
        dueSoonProjects,
        totalTasks: tasks.length,
        overdueTasks,
        blockedTasks,
        doneTasks,
        totalRoles: roles.length,
        totalExperts: users.length,
        reportFilesCount,
        reportFilesSizeBytes,
      },
      charts: {
        projectsByStatus: buildStatusChart(projectStatusCounts, projectStatusOverdueCounts),
        projectsByPriority: buildPriorityChart(projectPriorityCounts),
        tasksByStatus: buildTaskStatusChart(taskStatusCounts, taskStatusOverdueCounts),
        overdueByRole: byRole.filter((item) => item.overdueProjects > 0).slice(0, 10),
        overdueByExpert: byExpert.filter((item) => item.overdueProjects > 0).slice(0, 10),
        reportVolumeByProject,
      },
      tables: {
        overdueProjects: overdueProjectRows,
        roleWorkload: byRole,
        expertWorkload: byExpert,
      },
    },
  });
};