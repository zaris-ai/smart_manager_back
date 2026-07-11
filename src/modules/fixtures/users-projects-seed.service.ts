import bcrypt from 'bcryptjs';
import { Types } from 'mongoose';
import {
  FIXTURE_DEFAULT_PASSWORD,
  projectChartDateProfiles,
  projectFileFixtures,
  projectFixtures,
  projectReportFixtures,
  projectRoleFixtures,
  projectTaskFixtures,
  userFixtures,
  userProjectRoleMap,
} from '@/modules/fixtures/users-projects.fixture';
import ProjectRole from '@/modules/project-roles/project-role.model';
import {
  Project,
  PROJECT_FILE_CATEGORY_LABELS,
  PROJECT_PRIORITY_LABELS,
  PROJECT_STATUS_LABELS,
  ProjectFile,
  ProjectFileCategory,
  ProjectPhase,
  ProjectPriority,
  ProjectProgressNote,
  ProjectSource,
  ProjectStatus,
  ProjectTask,
  PROJECT_TASK_STATUS_LABELS,
  ProjectTaskStatus,
} from '@/modules/projects/project.model';
import User, {
  USER_ROLE_LABELS,
  USER_STATUS_LABELS,
  UserRole,
  UserStatus,
} from '@/modules/users/user.model';

export type SeedUsersProjectsOptions = {
  reset?: boolean;
};

export type SeedUsersProjectsResult = {
  users: {
    created: number;
    updated: number;
    totalFixtureUsers: number;
  };
  roles: {
    created: number;
    updated: number;
    totalFixtureRoles: number;
  };
  projects: {
    created: number;
    updated: number;
    totalFixtureProjects: number;
  };
  phases: {
    created: number;
    removedBeforeCreate: number;
    totalFixturePhases: number;
  };
  tasks: {
    created: number;
    removedBeforeCreate: number;
    totalFixtureTasks: number;
  };
  reports: {
    created: number;
    removedBeforeCreate: number;
    totalFixtureReports: number;
  };
  files: {
    created: number;
    removedBeforeCreate: number;
    totalFixtureFiles: number;
  };
  chartCoverage: {
    projectStatuses: ProjectStatus[];
    projectPriorities: ProjectPriority[];
    taskStatuses: ProjectTaskStatus[];
    includesOverdueProjects: boolean;
    includesDueSoonProjects: boolean;
    includesReportFiles: boolean;
    includesWorkTrend: boolean;
    includesRoleWorkload: boolean;
    includesExpertWorkload: boolean;
  };
  credentials: {
    defaultPassword: string;
    usernames: string[];
  };
};

const FIXTURE_USERNAME_PREFIX = 'fixture.';
const FIXTURE_PROJECT_TITLE_PREFIX = 'داده آزمایشی |';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const normalizeRoleTitle = (value: string): string => {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
};

const startOfDay = (date = new Date()): Date => {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);

  return result;
};

const addDays = (date: Date, days: number): Date => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);

  return result;
};

const withHour = (date: Date, hour: number): Date => {
  const result = new Date(date);
  result.setHours(hour, 0, 0, 0);

  return result;
};

const toDate = (value: string): Date => {
  return new Date(`${value}T00:00:00.000Z`);
};

const getDaysBetween = (from: Date, to: Date): number => {
  return Math.max(1, Math.round((to.getTime() - from.getTime()) / ONE_DAY_MS));
};

const getDateProfileMap = () => {
  return new Map(
    projectChartDateProfiles.map((profile) => [profile.projectTitle, profile]),
  );
};

const resolveProjectDates = (title: string, startDate: string, dueDate: string) => {
  const profile = getDateProfileMap().get(title);
  const today = startOfDay();

  if (!profile) {
    return {
      startDate: toDate(startDate),
      dueDate: toDate(dueDate),
    };
  }

  return {
    startDate: addDays(today, profile.startOffsetDays),
    dueDate: addDays(today, profile.dueOffsetDays),
  };
};

const resolveProjectStatus = (title: string, fallback: ProjectStatus): ProjectStatus => {
  return getDateProfileMap().get(title)?.status || fallback;
};

const resolveProjectPriority = (
  title: string,
  fallback: ProjectPriority,
): ProjectPriority => {
  return getDateProfileMap().get(title)?.priority || fallback;
};

const uniqueObjectIds = (ids: Types.ObjectId[]): Types.ObjectId[] => {
  const seen = new Set<string>();
  const result: Types.ObjectId[] = [];

  ids.forEach((id) => {
    const key = id.toString();

    if (seen.has(key)) return;

    seen.add(key);
    result.push(id);
  });

  return result;
};

const uniqueStrings = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  values.forEach((value) => {
    const key = String(value || '').trim();

    if (!key || seen.has(key)) return;

    seen.add(key);
    result.push(key);
  });

  return result;
};

const getUserMap = async (): Promise<Map<string, Types.ObjectId>> => {
  const users = await User.find({
    username: {
      $in: userFixtures.map((user) => user.username),
    },
  }).select('_id username');

  return new Map(
    users.map((user) => [String(user.username), user._id as Types.ObjectId]),
  );
};

const getRoleMap = async (): Promise<Map<string, Types.ObjectId>> => {
  const roles = await ProjectRole.find({
    normalizedTitle: {
      $in: projectRoleFixtures.map((role) => normalizeRoleTitle(role.title)),
    },
  }).select('_id normalizedTitle title');

  return new Map(
    roles.map((role) => [
      normalizeRoleTitle(String(role.title || role.normalizedTitle)),
      role._id as Types.ObjectId,
    ]),
  );
};

const getProjectMap = async (): Promise<Map<string, Types.ObjectId>> => {
  const projects = await Project.find({
    title: {
      $in: projectFixtures.map((project) => project.title),
    },
  }).select('_id title');

  return new Map(
    projects.map((project) => [String(project.title), project._id as Types.ObjectId]),
  );
};

const getRoleIdForUsername = (
  username: string,
  roleIdMap: Map<string, Types.ObjectId>,
): Types.ObjectId | null => {
  const roleTitle = userProjectRoleMap[username] || 'عضو پروژه';

  return roleIdMap.get(normalizeRoleTitle(roleTitle)) || null;
};

const buildProjectMembers = (
  usernames: string[],
  userIdMap: Map<string, Types.ObjectId>,
  roleIdMap: Map<string, Types.ObjectId>,
  startedAt: Date,
  expectedFinishedAt: Date,
) => {
  return uniqueStrings(usernames)
    .map((username) => {
      const userId = userIdMap.get(username);

      if (!userId) return null;

      const roleTitle = userProjectRoleMap[username] || 'عضو پروژه';

      return {
        userId,
        roleId: getRoleIdForUsername(username, roleIdMap),
        roleInProject: roleTitle,
        startedAt,
        expectedFinishedAt,
      };
    })
    .filter(Boolean);
};

const resolvePhaseDates = (
  projectStartDate: Date,
  projectDueDate: Date,
  order: number,
  totalPhases: number,
) => {
  const duration = getDaysBetween(projectStartDate, projectDueDate);
  const safeTotal = Math.max(totalPhases, 1);
  const startOffset = Math.floor(((order - 1) * duration) / safeTotal);
  const endOffset = order >= safeTotal
    ? duration
    : Math.max(startOffset, Math.floor((order * duration) / safeTotal) - 1);

  return {
    startDate: addDays(projectStartDate, startOffset),
    endDate: addDays(projectStartDate, endOffset),
  };
};

const buildFakeFileUrl = (fileName: string): string => {
  return `/uploads/fixtures/${encodeURIComponent(fileName)}`;
};

export const getUsersProjectsFixturePreview = () => {
  return {
    users: userFixtures.map(({ email, firstName, lastName, phone, profile, role, status, username }) => ({
      firstName,
      lastName,
      username,
      email,
      phone,
      role,
      status,
      profile,
    })),
    roles: projectRoleFixtures,
    projects: projectFixtures,
    chartProfiles: projectChartDateProfiles,
    tasks: projectTaskFixtures,
    reports: projectReportFixtures,
    files: projectFileFixtures,
    counts: {
      users: userFixtures.length,
      roles: projectRoleFixtures.length,
      projects: projectFixtures.length,
      phases: projectFixtures.reduce((sum, project) => sum + project.phases.length, 0),
      tasks: projectTaskFixtures.length,
      reports: projectReportFixtures.length,
      files: projectFileFixtures.length,
    },
    defaultPassword: FIXTURE_DEFAULT_PASSWORD,
  };
};

export const seedUsersAndProjects = async (
  options: SeedUsersProjectsOptions = {},
): Promise<SeedUsersProjectsResult> => {
  const reset = Boolean(options.reset);

  const existingFixtureProjects = await Project.find({
    title: {
      $regex: `^${FIXTURE_PROJECT_TITLE_PREFIX}`,
    },
  }).select('_id');

  const existingFixtureProjectIds = existingFixtureProjects.map(
    (project) => project._id as Types.ObjectId,
  );

  if (reset) {
    if (existingFixtureProjectIds.length > 0) {
      await ProjectFile.deleteMany({ projectId: { $in: existingFixtureProjectIds } });
      await ProjectProgressNote.deleteMany({ projectId: { $in: existingFixtureProjectIds } });
      await ProjectTask.deleteMany({ projectId: { $in: existingFixtureProjectIds } });
      await ProjectPhase.deleteMany({ projectId: { $in: existingFixtureProjectIds } });
      await Project.deleteMany({ _id: { $in: existingFixtureProjectIds } });
    }

    await ProjectRole.deleteMany({
      normalizedTitle: {
        $in: projectRoleFixtures.map((role) => normalizeRoleTitle(role.title)),
      },
    });

    await User.deleteMany({
      $or: [
        { username: { $regex: `^${FIXTURE_USERNAME_PREFIX}` } },
        { email: { $in: userFixtures.map((user) => user.email) } },
      ],
    });
  }

  const passwordHash = await bcrypt.hash(FIXTURE_DEFAULT_PASSWORD, 12);
  let createdUsers = 0;
  let updatedUsers = 0;

  for (const fixture of userFixtures) {
    const existingUser = await User.findOne({
      $or: [{ username: fixture.username }, { email: fixture.email }],
    }).select('+passwordHash');

    const payload = {
      firstName: fixture.firstName,
      lastName: fixture.lastName,
      fullName: `${fixture.firstName} ${fixture.lastName}`.trim(),
      username: fixture.username,
      email: fixture.email,
      phone: fixture.phone,
      passwordHash: existingUser?.passwordHash || passwordHash,
      role: fixture.role,
      roleLabel: USER_ROLE_LABELS[fixture.role] || USER_ROLE_LABELS[UserRole.EXPERT],
      status: fixture.status,
      statusLabel:
        USER_STATUS_LABELS[fixture.status] || USER_STATUS_LABELS[UserStatus.ACTIVE],
      isActive: fixture.status === UserStatus.ACTIVE,
      profile: fixture.profile,
      managerId: null,
      language: 'fa' as const,
      direction: 'rtl' as const,
      updatedBy: null,
    };

    if (existingUser) {
      await User.updateOne({ _id: existingUser._id }, { $set: payload });
      updatedUsers += 1;
    } else {
      await User.create({
        ...payload,
        createdBy: null,
        lastLoginAt: null,
      });
      createdUsers += 1;
    }
  }

  const userIdMap = await getUserMap();
  let createdRoles = 0;
  let updatedRoles = 0;

  for (const fixture of projectRoleFixtures) {
    const normalizedTitle = normalizeRoleTitle(fixture.title);
    const existingRole = await ProjectRole.findOne({ normalizedTitle });
    const firstManagerId = userIdMap.get('fixture.manager.maryam') || null;

    const payload = {
      title: fixture.title,
      normalizedTitle,
      description: fixture.description,
      isActive: true,
      sortOrder: fixture.sortOrder,
      language: 'fa' as const,
      direction: 'rtl' as const,
      updatedBy: firstManagerId,
    };

    if (existingRole) {
      await ProjectRole.updateOne({ _id: existingRole._id }, { $set: payload });
      updatedRoles += 1;
    } else {
      await ProjectRole.create({
        ...payload,
        createdBy: firstManagerId,
      });
      createdRoles += 1;
    }
  }

  const roleIdMap = await getRoleMap();
  let createdProjects = 0;
  let updatedProjects = 0;
  let createdPhases = 0;
  let removedPhases = 0;

  for (const [projectIndex, fixture] of projectFixtures.entries()) {
    const ownerId = userIdMap.get(fixture.ownerUsername) || null;
    const phaseUsernames = fixture.phases.flatMap((phase) => phase.assignedUserUsernames);
    const allProjectUsernames = uniqueStrings([
      fixture.ownerUsername,
      ...fixture.memberUsernames,
      ...phaseUsernames,
    ]);
    const assignedUserIds = uniqueObjectIds(
      allProjectUsernames
        .map((username) => userIdMap.get(username))
        .filter(Boolean) as Types.ObjectId[],
    );
    const { startDate, dueDate } = resolveProjectDates(
      fixture.title,
      fixture.startDate,
      fixture.dueDate,
    );
    const status = resolveProjectStatus(fixture.title, fixture.status);
    const priority = resolveProjectPriority(fixture.title, fixture.priority);

    const projectPayload = {
      title: fixture.title,
      description: fixture.description,
      status,
      statusLabel: PROJECT_STATUS_LABELS[status] || status,
      priority,
      priorityLabel: PROJECT_PRIORITY_LABELS[priority] || priority,
      startDate,
      dueDate,
      ownerId,
      assignedUserIds,
      projectMembers: buildProjectMembers(
        allProjectUsernames,
        userIdMap,
        roleIdMap,
        startDate,
        dueDate,
      ),
      language: 'fa' as const,
      direction: 'rtl' as const,
      updatedBy: ownerId,
    };

    let project = await Project.findOne({ title: fixture.title });

    if (project) {
      await Project.updateOne({ _id: project._id }, { $set: projectPayload });
      updatedProjects += 1;
    } else {
      project = await Project.create({
        ...projectPayload,
        createdBy: ownerId,
      });
      createdProjects += 1;
    }

    removedPhases += await ProjectPhase.countDocuments({ projectId: project._id });
    await ProjectPhase.deleteMany({ projectId: project._id });

    const totalPhases = fixture.phases.length;
    const phasePayloads = fixture.phases.map((phase) => {
      const phaseDates = resolvePhaseDates(
        startDate,
        dueDate,
        phase.order,
        totalPhases,
      );

      const expectedRevenue = Math.round((projectIndex + 1) * 12_000_000 + phase.order * 3_500_000);
      const expectedExpense = Math.round(expectedRevenue * (0.42 + (phase.order % 2) * 0.08));
      const realizedRevenue = Math.round(expectedRevenue * (0.35 + ((projectIndex + phase.order) % 5) * 0.13));
      const realizedExpense = Math.round(expectedExpense * (0.45 + ((projectIndex + phase.order) % 4) * 0.11));

      return {
        projectId: project!._id,
        title: phase.title,
        description: phase.description,
        assignedUserIds: phase.assignedUserUsernames
          .map((username) => userIdMap.get(username))
          .filter(Boolean),
        startDate: phaseDates.startDate,
        endDate: phaseDates.endDate,
        order: phase.order,
        financial: {
          expectedRevenue,
          expectedExpense,
          realizedRevenue,
          realizedExpense,
          currency: 'IRR',
          note: `داده مالی ساده برای ${phase.title}`,
          updatedAt: new Date(),
        },
        createdBy: ownerId,
        updatedBy: ownerId,
        language: 'fa' as const,
        direction: 'rtl' as const,
      };
    });

    if (phasePayloads.length > 0) {
      await ProjectPhase.insertMany(phasePayloads, { ordered: true });
      createdPhases += phasePayloads.length;
    }
  }

  const projectIdMap = await getProjectMap();
  const seededProjectIds = Array.from(projectIdMap.values());
  const removedTasks = seededProjectIds.length
    ? await ProjectTask.countDocuments({ projectId: { $in: seededProjectIds } })
    : 0;
  const removedReports = seededProjectIds.length
    ? await ProjectProgressNote.countDocuments({ projectId: { $in: seededProjectIds } })
    : 0;
  const removedFiles = seededProjectIds.length
    ? await ProjectFile.countDocuments({ projectId: { $in: seededProjectIds } })
    : 0;

  if (seededProjectIds.length > 0) {
    await ProjectFile.deleteMany({ projectId: { $in: seededProjectIds } });
    await ProjectProgressNote.deleteMany({ projectId: { $in: seededProjectIds } });
    await ProjectTask.deleteMany({ projectId: { $in: seededProjectIds } });
  }

  let createdTasks = 0;
  const today = startOfDay();

  for (const fixture of projectTaskFixtures) {
    const projectId = projectIdMap.get(fixture.projectTitle);

    if (!projectId) continue;

    const assignedUserIds = uniqueObjectIds(
      fixture.assigneeUsernames
        .map((username) => userIdMap.get(username))
        .filter(Boolean) as Types.ObjectId[],
    );
    const startDate = addDays(today, fixture.startOffsetDays);
    const dueDate = addDays(today, fixture.dueOffsetDays);
    const completedAt = fixture.status === ProjectTaskStatus.DONE
      ? addDays(today, fixture.completedOffsetDays ?? fixture.dueOffsetDays)
      : null;

    const createdTask = await ProjectTask.create({
      projectId,
      title: fixture.title,
      description: fixture.description,
      assignedUserIds,
      status: fixture.status,
      statusLabel: PROJECT_TASK_STATUS_LABELS[fixture.status] || fixture.status,
      priority: fixture.priority,
      priorityLabel: PROJECT_PRIORITY_LABELS[fixture.priority] || fixture.priority,
      startDate,
      dueDate,
      completedAt,
      createdBy: assignedUserIds[0] || null,
      updatedBy: assignedUserIds[0] || null,
      source: ProjectSource.WEB,
      language: 'fa' as const,
      direction: 'rtl' as const,
    });

    const taskTimestamp = withHour(completedAt || dueDate || startDate, 10);
    await ProjectTask.updateOne(
      { _id: createdTask._id },
      { $set: { createdAt: taskTimestamp, updatedAt: taskTimestamp } },
      { timestamps: false } as any,
    );
    createdTasks += 1;
  }

  let createdReports = 0;
  let createdFiles = 0;

  for (const fixture of projectReportFixtures) {
    const projectId = projectIdMap.get(fixture.projectTitle);
    const authorId = userIdMap.get(fixture.authorUsername) || null;

    if (!projectId) continue;

    const createdAt = withHour(addDays(today, fixture.createdOffsetDays), 11);
    const createdNote = await ProjectProgressNote.create({
      projectId,
      authorId,
      registeredById: authorId,
      note: fixture.note,
      progressPercent: fixture.progressPercent,
      statusSnapshot: '',
      source: ProjectSource.WEB,
      language: 'fa' as const,
      direction: 'rtl' as const,
    });

    await ProjectProgressNote.updateOne(
      { _id: createdNote._id },
      { $set: { createdAt, updatedAt: createdAt } },
      { timestamps: false } as any,
    );
    createdReports += 1;

    if (fixture.fileSizeBytes) {
      const fileName = `fixture-report-${String(createdNote._id)}.pdf`;
      const createdFile = await ProjectFile.create({
        projectId,
        progressNoteId: createdNote._id,
        taskId: null,
        uploadedBy: authorId,
        fileName,
        originalName: `${fixture.projectTitle.replace('داده آزمایشی | ', '')}-report.pdf`,
        fileUrl: buildFakeFileUrl(fileName),
        fileType: 'application/pdf',
        fileSize: fixture.fileSizeBytes,
        category: ProjectFileCategory.REPORTS,
        categoryLabel: PROJECT_FILE_CATEGORY_LABELS[ProjectFileCategory.REPORTS],
        source: ProjectSource.WEB,
        transcriptionStatus: 'not_applicable',
        language: 'fa' as const,
        direction: 'rtl' as const,
      });

      await ProjectFile.updateOne(
        { _id: createdFile._id },
        { $set: { createdAt, updatedAt: createdAt } },
        { timestamps: false } as any,
      );
      createdFiles += 1;
    }
  }

  for (const fixture of projectFileFixtures) {
    const projectId = projectIdMap.get(fixture.projectTitle);
    const uploadedBy = userIdMap.get(fixture.uploadedByUsername) || null;

    if (!projectId) continue;

    const createdAt = withHour(addDays(today, fixture.createdOffsetDays), 12);
    const fileName = `fixture-${fixture.originalName}`.replace(/\s+/g, '-');
    const createdFile = await ProjectFile.create({
      projectId,
      progressNoteId: null,
      taskId: null,
      uploadedBy,
      fileName,
      originalName: fixture.originalName,
      fileUrl: buildFakeFileUrl(fileName),
      fileType: fixture.fileType,
      fileSize: fixture.fileSizeBytes,
      category: fixture.category,
      categoryLabel: PROJECT_FILE_CATEGORY_LABELS[fixture.category],
      source: ProjectSource.WEB,
      transcriptionStatus: 'not_applicable',
      language: 'fa' as const,
      direction: 'rtl' as const,
    });

    await ProjectFile.updateOne(
      { _id: createdFile._id },
      { $set: { createdAt, updatedAt: createdAt } },
      { timestamps: false } as any,
    );
    createdFiles += 1;
  }

  return {
    users: {
      created: createdUsers,
      updated: updatedUsers,
      totalFixtureUsers: userFixtures.length,
    },
    roles: {
      created: createdRoles,
      updated: updatedRoles,
      totalFixtureRoles: projectRoleFixtures.length,
    },
    projects: {
      created: createdProjects,
      updated: updatedProjects,
      totalFixtureProjects: projectFixtures.length,
    },
    phases: {
      created: createdPhases,
      removedBeforeCreate: removedPhases,
      totalFixturePhases: projectFixtures.reduce(
        (sum, project) => sum + project.phases.length,
        0,
      ),
    },
    tasks: {
      created: createdTasks,
      removedBeforeCreate: removedTasks,
      totalFixtureTasks: projectTaskFixtures.length,
    },
    reports: {
      created: createdReports,
      removedBeforeCreate: removedReports,
      totalFixtureReports: projectReportFixtures.length,
    },
    files: {
      created: createdFiles,
      removedBeforeCreate: removedFiles,
      totalFixtureFiles: projectFileFixtures.length + projectReportFixtures.filter((report) => report.fileSizeBytes).length,
    },
    chartCoverage: {
      projectStatuses: Array.from(new Set(projectChartDateProfiles.map((profile) => profile.status))),
      projectPriorities: Array.from(new Set(projectChartDateProfiles.map((profile) => profile.priority))),
      taskStatuses: Array.from(new Set(projectTaskFixtures.map((task) => task.status))),
      includesOverdueProjects: projectChartDateProfiles.some(
        (profile) =>
          profile.dueOffsetDays < 0 &&
          profile.status !== ProjectStatus.COMPLETED &&
          profile.status !== ProjectStatus.CANCELLED,
      ),
      includesDueSoonProjects: projectChartDateProfiles.some(
        (profile) =>
          profile.dueOffsetDays >= 0 &&
          profile.dueOffsetDays <= 7 &&
          profile.status !== ProjectStatus.COMPLETED &&
          profile.status !== ProjectStatus.CANCELLED,
      ),
      includesReportFiles: projectFileFixtures.some((file) => file.category === ProjectFileCategory.REPORTS) ||
        projectReportFixtures.some((report) => Boolean(report.fileSizeBytes)),
      includesWorkTrend: projectReportFixtures.some((report) => report.createdOffsetDays >= -6),
      includesRoleWorkload: projectRoleFixtures.length > 0,
      includesExpertWorkload: userFixtures.length > 0,
    },
    credentials: {
      defaultPassword: FIXTURE_DEFAULT_PASSWORD,
      usernames: userFixtures.map((user) => user.username),
    },
  };
};
