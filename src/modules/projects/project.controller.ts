import { Request, Response } from "express";
import mongoose, { Types } from "mongoose";
import User, { UserRole } from "../users/user.model";
import {
  Project,
  ProjectCalendarEventType,
  ProjectPhase,
  ProjectFile,
  ProjectFileCategory,
  PROJECT_FILE_CATEGORY_LABELS,
  ProjectPriority,
  PROJECT_PRIORITY_LABELS,
  ProjectProgressNote,
  ProjectStatus,
  PROJECT_STATUS_LABELS,
  ProjectTask,
  ProjectTaskStatus,
  PROJECT_TASK_STATUS_LABELS,
} from "./project.model";
import { ProjectRole } from "@/modules/project-roles/project-role.model";
import {
  isTranscribableAudioFile,
  transcribeAudioFile,
} from "./audio-transcription.service";

type AppRole = "manager" | "employee";

type AuthRequest = Request & {
  file?: Express.Multer.File;
  user?: {
    id?: string;
    _id?: string;
    userId?: string;
    role?: string;
    fullName?: string;
    username?: string;
  };
};

type ProjectMemberPayload = {
  userId: string;
  roleId: string | null;
  roleInProject: string;
  startedAt: Date | null;
  expectedFinishedAt: Date | null;
};

type ProjectMemberRecord = {
  userId: Types.ObjectId;
  roleId: Types.ObjectId | null;
  roleInProject: string;
  startedAt: Date | null;
  expectedFinishedAt: Date | null;
};

type ProjectPhasePayload = {
  title: string;
  description: string;
  assignedUserIds: string[];
  startDate: Date;
  endDate: Date;
  order: number;
  financial: {
    expectedRevenue: number;
    expectedExpense: number;
    realizedRevenue: number;
    realizedExpense: number;
    currency: string;
    note: string;
    updatedAt: Date | null;
  };
};

const USER_SELECT =
  "firstName lastName fullName username email role roleLabel isActive";

const getAuthUserId = (req: AuthRequest): string => {
  return String(req.user?.id || req.user?._id || req.user?.userId || "");
};

const getAppRole = (req: AuthRequest): AppRole => {
  const rawRole = String(req.user?.role || "").toLowerCase();

  /**
   * Legacy compatibility:
   * If your old default user still has role "admin", it is treated as manager.
   * New business model remains only manager/employee.
   */
  if (rawRole === "manager" || rawRole === "admin") return "manager";

  return "employee";
};

const isManager = (req: AuthRequest): boolean => {
  return getAppRole(req) === "manager";
};

const isValidObjectId = (value?: string): boolean => {
  return Boolean(value && mongoose.Types.ObjectId.isValid(value));
};

const toObjectId = (value: string): Types.ObjectId => {
  return new mongoose.Types.ObjectId(value);
};

const buildProjectUploadFileUrl = (fileName: string): string => {
  return `/api/v1/uploads/projects/${fileName}`;
};

const buildTranscriptionFields = async (file: Express.Multer.File) => {
  const transcription = await transcribeAudioFile(file);

  return {
    transcriptionStatus: transcription.status,
    transcriptionText: transcription.text,
    transcriptionError: transcription.error || "",
    transcriptionModel: transcription.model || "",
    transcriptionLanguage: transcription.language || "",
    transcribedAt: transcription.transcribedAt || null,
  };
};

const sendValidationError = (
  res: Response,
  message: string,
  details?: unknown,
) => {
  return res.status(400).json({
    success: false,
    message,
    code: "VALIDATION_ERROR",
    details,
  });
};

const sendForbidden = (res: Response) => {
  return res.status(403).json({
    success: false,
    message: "شما دسترسی لازم برای این عملیات را ندارید.",
    code: "FORBIDDEN",
  });
};

const sendNotFound = (res: Response, message: string) => {
  return res.status(404).json({
    success: false,
    message,
    code: "NOT_FOUND",
  });
};

const sendSuccess = <T>(
  res: Response,
  data: T,
  message = "عملیات با موفقیت انجام شد.",
  statusCode = 200,
  extra?: Record<string, unknown>,
) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
    ...(extra || {}),
  });
};

const normalizeEnumValue = <T extends Record<string, string>>(
  value: unknown,
  enumObject: T,
): T[keyof T] | null => {
  if (!value || typeof value !== "string") return null;

  const rawValue = value.trim();
  const lowerValue = rawValue.toLowerCase();

  const enumValues = Object.values(enumObject);

  const matchedValue = enumValues.find((enumValue) => {
    return enumValue.toLowerCase() === lowerValue;
  });

  return (matchedValue as T[keyof T]) || null;
};

const normalizeOptionalDate = (value: unknown): Date | null => {
  if (!value || typeof value !== "string") return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return null;

  return date;
};

const normalizeRequiredDate = (value: unknown): Date | null => {
  if (!value || typeof value !== "string") return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return null;

  return date;
};

const normalizeObjectIdArray = (value: unknown): Types.ObjectId[] => {
  if (!Array.isArray(value)) return [];

  const uniqueIds = Array.from(
    new Set(
      value
        .filter((item) => typeof item === "string" && isValidObjectId(item))
        .map((item) => String(item)),
    ),
  );

  return uniqueIds.map(toObjectId);
};

const normalizeAmount = (value: unknown): number | null => {
  if (value === undefined || value === null || value === "") return 0;

  const amount = Number(value);

  if (!Number.isFinite(amount) || amount < 0) return null;

  return Math.round(amount * 100) / 100;
};

const normalizeCurrency = (value: unknown): string => {
  if (typeof value !== "string") return "IRR";

  const currency = value.trim().toUpperCase();

  return currency ? currency.slice(0, 12) : "IRR";
};

const getAmountAlias = (
  payload: Record<string, unknown>,
  keys: string[],
): unknown => {
  const key = keys.find((item) => payload[item] !== undefined);
  return key ? payload[key] : undefined;
};

const normalizePhaseFinancialPayload = (
  value: unknown,
): ProjectPhasePayload["financial"] | null => {
  const payload =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};

  const expectedRevenue = normalizeAmount(
    getAmountAlias(payload, [
      "expectedRevenue",
      "plannedRevenue",
      "potentialRevenue",
      "potentialRevenueAmount",
    ]),
  );
  const expectedExpense = normalizeAmount(
    getAmountAlias(payload, [
      "expectedExpense",
      "plannedExpense",
      "potentialExpense",
      "potentialCost",
      "potentialCostAmount",
    ]),
  );
  const realizedRevenue = normalizeAmount(
    getAmountAlias(payload, [
      "realizedRevenue",
      "realizedRevenueAmount",
      "revenue",
      "earnedAmount",
      "income",
    ]),
  );
  const realizedExpense = normalizeAmount(
    getAmountAlias(payload, [
      "realizedExpense",
      "realizedCost",
      "realizedCostAmount",
      "expense",
      "spentAmount",
      "cost",
    ]),
  );

  if (
    expectedRevenue === null ||
    expectedExpense === null ||
    realizedRevenue === null ||
    realizedExpense === null
  ) {
    return null;
  }

  return {
    expectedRevenue,
    expectedExpense,
    realizedRevenue,
    realizedExpense,
    currency: normalizeCurrency(payload.currency),
    note: typeof payload.note === "string" ? payload.note.trim().slice(0, 1000) : "",
    updatedAt:
      payload.updatedAt && typeof payload.updatedAt === "string"
        ? normalizeOptionalDate(payload.updatedAt)
        : null,
  };
};

const PHASE_FINANCIAL_KEYS = [
  "expectedRevenue",
  "plannedRevenue",
  "potentialRevenue",
  "potentialRevenueAmount",
  "expectedExpense",
  "plannedExpense",
  "potentialExpense",
  "potentialCost",
  "potentialCostAmount",
  "realizedRevenue",
  "realizedRevenueAmount",
  "revenue",
  "earnedAmount",
  "income",
  "realizedExpense",
  "realizedCost",
  "realizedCostAmount",
  "expense",
  "spentAmount",
  "cost",
  "currency",
  "note",
];

const hasPhaseFinancialPayload = (body: Record<string, unknown>): boolean => {
  if (body.financial && typeof body.financial === "object") return true;

  return PHASE_FINANCIAL_KEYS.some((key) => body[key] !== undefined);
};

const normalizeMergedPhaseFinancialPayload = (
  existingFinancial: any,
  body: Record<string, unknown>,
): ProjectPhasePayload["financial"] | null => {
  const directPayload =
    body.financial && typeof body.financial === "object"
      ? (body.financial as Record<string, unknown>)
      : body;

  return normalizePhaseFinancialPayload({
    expectedRevenue: existingFinancial?.expectedRevenue || 0,
    expectedExpense: existingFinancial?.expectedExpense || 0,
    realizedRevenue: existingFinancial?.realizedRevenue || 0,
    realizedExpense: existingFinancial?.realizedExpense || 0,
    currency: existingFinancial?.currency || "IRR",
    note: existingFinancial?.note || "",
    ...directPayload,
    updatedAt: new Date().toISOString(),
  });
};


const normalizeProjectPhasesPayload = (
  value: unknown,
): { phases: ProjectPhasePayload[]; error: string | null } => {
  if (value === undefined || value === null || value === "") {
    return { phases: [], error: null };
  }

  if (!Array.isArray(value)) {
    return { phases: [], error: "فازهای پروژه باید به صورت آرایه ارسال شوند." };
  }

  const phases: ProjectPhasePayload[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];

    if (!item || typeof item !== "object") {
      return { phases: [], error: `فاز شماره ${index + 1} معتبر نیست.` };
    }

    const payload = item as Record<string, unknown>;
    const title = typeof payload.title === "string" ? payload.title.trim() : "";

    if (!title) {
      return { phases: [], error: `عنوان فاز شماره ${index + 1} الزامی است.` };
    }

    const startDate = normalizeRequiredDate(payload.startDate);
    const endDate = normalizeRequiredDate(payload.endDate);

    if (!startDate || !endDate) {
      return {
        phases: [],
        error: `تاریخ شروع و پایان فاز شماره ${index + 1} معتبر نیست.`,
      };
    }

    if (endDate < startDate) {
      return {
        phases: [],
        error: `تاریخ پایان فاز شماره ${index + 1} نمی‌تواند قبل از تاریخ شروع باشد.`,
      };
    }

    const assignedUserIds = normalizeObjectIdArray(payload.assignedUserIds).map(
      (userId) => userId.toString(),
    );

    if (!assignedUserIds.length) {
      return {
        phases: [],
        error: `برای فاز شماره ${index + 1} حداقل یک مسئول انجام کار انتخاب کنید.`,
      };
    }

    const financial = normalizePhaseFinancialPayload(
      payload.financial || payload,
    );

    if (!financial) {
      return {
        phases: [],
        error: `مبالغ مالی فاز شماره ${index + 1} باید عدد مثبت یا صفر باشند.`,
      };
    }

    const order = Number(payload.order ?? index + 1);

    phases.push({
      title,
      description:
        typeof payload.description === "string"
          ? payload.description.trim()
          : "",
      assignedUserIds: Array.from(new Set(assignedUserIds)),
      startDate,
      endDate,
      order: Number.isInteger(order) && order > 0 ? order : index + 1,
      financial,
    });
  }

  return { phases, error: null };
};

const buildPhaseFinancialSummary = (financial: any) => {
  const expectedRevenue = Number(financial?.expectedRevenue || 0);
  const expectedExpense = Number(financial?.expectedExpense || 0);
  const realizedRevenue = Number(financial?.realizedRevenue || 0);
  const realizedExpense = Number(financial?.realizedExpense || 0);

  return {
    expectedProfit: Math.round((expectedRevenue - expectedExpense) * 100) / 100,
    realizedProfit: Math.round((realizedRevenue - realizedExpense) * 100) / 100,
    revenueAchievementPercent:
      expectedRevenue > 0
        ? Math.round((realizedRevenue / expectedRevenue) * 10000) / 100
        : null,
    expenseUsagePercent:
      expectedExpense > 0
        ? Math.round((realizedExpense / expectedExpense) * 10000) / 100
        : null,
  };
};

const serializeProjectPhase = (phase: any): any => {
  const phaseObject = serializeDocument(phase);
  const financial = phaseObject?.financial || {};

  return {
    ...phaseObject,
    financial: {
      expectedRevenue: Number(financial.expectedRevenue || 0),
      expectedExpense: Number(financial.expectedExpense || 0),
      realizedRevenue: Number(financial.realizedRevenue || 0),
      realizedExpense: Number(financial.realizedExpense || 0),
      currency: financial.currency || "IRR",
      note: financial.note || "",
      updatedAt: financial.updatedAt || null,
      potentialRevenueAmount: Number(financial.expectedRevenue || 0),
      potentialCostAmount: Number(financial.expectedExpense || 0),
      realizedRevenueAmount: Number(financial.realizedRevenue || 0),
      realizedCostAmount: Number(financial.realizedExpense || 0),
    },
    financialSummary: buildPhaseFinancialSummary(financial),
  };
};

const buildDefaultProjectPhaseSummary = () => ({
  phaseCount: 0,
  totalExpectedRevenue: 0,
  totalExpectedExpense: 0,
  totalRealizedRevenue: 0,
  totalRealizedExpense: 0,
  expectedBalance: 0,
  realizedBalance: 0,
  totalPotentialRevenue: 0,
  totalPotentialCost: 0,
  totalRealizedCost: 0,
  potentialBalance: 0,
});

const attachPhaseSummariesToProjects = async (
  projects: any[],
): Promise<any[]> => {
  const projectObjects = projects.map(serializeDocument);
  const projectIds = projectObjects
    .map((project) => project?._id)
    .filter(Boolean)
    .map((projectId) => toObjectId(String(projectId)));

  if (!projectIds.length) return projectObjects;

  const summaries = await ProjectPhase.aggregate([
    {
      $match: {
        projectId: { $in: projectIds },
      },
    },
    {
      $group: {
        _id: "$projectId",
        phaseCount: { $sum: 1 },
        totalExpectedRevenue: { $sum: "$financial.expectedRevenue" },
        totalExpectedExpense: { $sum: "$financial.expectedExpense" },
        totalRealizedRevenue: { $sum: "$financial.realizedRevenue" },
        totalRealizedExpense: { $sum: "$financial.realizedExpense" },
      },
    },
  ]);

  const summaryMap = new Map<string, any>();

  summaries.forEach((summary) => {
    const totalExpectedRevenue = Number(summary.totalExpectedRevenue || 0);
    const totalExpectedExpense = Number(summary.totalExpectedExpense || 0);
    const totalRealizedRevenue = Number(summary.totalRealizedRevenue || 0);
    const totalRealizedExpense = Number(summary.totalRealizedExpense || 0);

    summaryMap.set(String(summary._id), {
      phaseCount: Number(summary.phaseCount || 0),
      totalExpectedRevenue,
      totalExpectedExpense,
      totalRealizedRevenue,
      totalRealizedExpense,
      expectedBalance: Math.round((totalExpectedRevenue - totalExpectedExpense) * 100) / 100,
      realizedBalance: Math.round((totalRealizedRevenue - totalRealizedExpense) * 100) / 100,
      totalPotentialRevenue: totalExpectedRevenue,
      totalPotentialCost: totalExpectedExpense,
      totalRealizedCost: totalRealizedExpense,
      potentialBalance: Math.round((totalExpectedRevenue - totalExpectedExpense) * 100) / 100,
    });
  });

  return projectObjects.map((project) => ({
    ...project,
    phaseSummary:
      summaryMap.get(String(project._id)) || buildDefaultProjectPhaseSummary(),
  }));
};

const getProjectMembersPayload = (body: Record<string, unknown>): unknown => {
  if (Array.isArray(body.projectMembers)) return body.projectMembers;
  if (Array.isArray(body.members)) return body.members;

  return [];
};

const normalizeProjectMembersPayload = (
  value: unknown,
): ProjectMemberPayload[] => {
  if (!Array.isArray(value)) return [];

  const map = new Map<string, ProjectMemberPayload>();

  value.forEach((item) => {
    if (!item || typeof item !== "object") return;

    const payload = item as Record<string, unknown>;
    const userId = String(payload.userId || "").trim();

    if (!isValidObjectId(userId)) return;

    const roleId = String(payload.roleId || "").trim();

    map.set(userId, {
      userId,
      roleId: isValidObjectId(roleId) ? roleId : null,
      roleInProject:
        typeof payload.roleInProject === "string"
          ? payload.roleInProject.trim()
          : "",
      startedAt: normalizeOptionalDate(payload.startedAt),
      expectedFinishedAt: normalizeOptionalDate(payload.expectedFinishedAt),
    });
  });

  return Array.from(map.values());
};

const buildExistingProjectMemberMap = (
  project: any,
): Map<string, ProjectMemberPayload> => {
  const map = new Map<string, ProjectMemberPayload>();
  const members = Array.isArray(project?.projectMembers)
    ? project.projectMembers
    : [];

  members.forEach((member: any) => {
    const rawUserId = member?.userId?._id || member?.userId;
    const userId = String(rawUserId || "").trim();

    if (!isValidObjectId(userId)) return;

    const rawRoleId = member?.roleId?._id || member?.roleId;
    const roleId = String(rawRoleId || "").trim();

    map.set(userId, {
      userId,
      roleId: isValidObjectId(roleId) ? roleId : null,
      roleInProject: String(member.roleInProject || "").trim(),
      startedAt: member.startedAt ? new Date(member.startedAt) : null,
      expectedFinishedAt: member.expectedFinishedAt
        ? new Date(member.expectedFinishedAt)
        : null,
    });
  });

  return map;
};

const attachProjectRoleTitles = async (
  members: ProjectMemberPayload[],
): Promise<{ members: ProjectMemberPayload[]; error: string | null }> => {
  const roleIds = Array.from(
    new Set(
      members
        .map((member) => member.roleId)
        .filter((roleId): roleId is string =>
          Boolean(roleId && isValidObjectId(roleId)),
        ),
    ),
  );

  if (!roleIds.length) {
    return { members, error: null };
  }

  const roles = await ProjectRole.find({
    _id: { $in: roleIds.map(toObjectId) },
    isActive: true,
  })
    .select("title")
    .lean();

  const roleTitleMap = new Map(
    roles.map((role: any) => [
      String(role._id),
      String(role.title || "").trim(),
    ]),
  );

  const missingRoleId = roleIds.find((roleId) => !roleTitleMap.has(roleId));

  if (missingRoleId) {
    return {
      members,
      error: "نقش انتخاب‌شده برای عضو پروژه معتبر یا فعال نیست.",
    };
  }

  return {
    members: members.map((member) => ({
      ...member,
      roleInProject: member.roleId
        ? roleTitleMap.get(member.roleId) || member.roleInProject
        : member.roleInProject,
    })),
    error: null,
  };
};

const buildProjectMembers = ({
  userIds,
  ownerId,
  requestedMembers,
  existingMembers,
  fallbackStartDate,
  fallbackExpectedFinishedAt,
}: {
  userIds: string[];
  ownerId: string;
  requestedMembers: ProjectMemberPayload[];
  existingMembers?: Map<string, ProjectMemberPayload>;
  fallbackStartDate?: Date | null;
  fallbackExpectedFinishedAt?: Date | null;
}): ProjectMemberRecord[] => {
  const requestedMap = new Map(
    requestedMembers.map((member) => [member.userId, member]),
  );

  const uniqueIds = Array.from(
    new Set([
      ownerId,
      ...userIds,
      ...requestedMembers.map((member) => member.userId),
    ]),
  ).filter(isValidObjectId);

  return uniqueIds.map((userId) => {
    const requested = requestedMap.get(userId);
    const existing = existingMembers?.get(userId);

    const roleId = requested?.roleId || existing?.roleId || null;
    const roleInProject =
      requested?.roleInProject ||
      existing?.roleInProject ||
      (userId === ownerId ? "مسئول پروژه" : "عضو پروژه");

    return {
      userId: toObjectId(userId),
      roleId: roleId && isValidObjectId(roleId) ? toObjectId(roleId) : null,
      roleInProject,
      startedAt:
        requested?.startedAt ??
        existing?.startedAt ??
        fallbackStartDate ??
        null,
      expectedFinishedAt:
        requested?.expectedFinishedAt ??
        existing?.expectedFinishedAt ??
        fallbackExpectedFinishedAt ??
        null,
    };
  });
};

const validateProjectMembersDates = (
  members: ProjectMemberRecord[],
): string | null => {
  const invalidMember = members.find((member) => {
    return (
      member.startedAt &&
      member.expectedFinishedAt &&
      member.expectedFinishedAt < member.startedAt
    );
  });

  if (!invalidMember) return null;

  return "تاریخ پایان احتمالی عضو پروژه نمی‌تواند قبل از تاریخ شروع او باشد.";
};

const populateProjectQuery = (query: any) => {
  return query
    .populate("ownerId", USER_SELECT)
    .populate("assignedUserIds", USER_SELECT)
    .populate("projectMembers.userId", USER_SELECT)
    .populate("projectMembers.roleId", "title description isActive sortOrder")
    .populate("createdBy", USER_SELECT)
    .populate("updatedBy", USER_SELECT);
};

const populatePhaseQuery = (query: any) => {
  return query
    .populate("assignedUserIds", USER_SELECT)
    .populate("createdBy", USER_SELECT)
    .populate("updatedBy", USER_SELECT);
};

const populateTaskQuery = (query: any) => {
  return query
    .populate("assignedUserIds", USER_SELECT)
    .populate("createdBy", USER_SELECT)
    .populate("updatedBy", USER_SELECT);
};

const populateNoteQuery = (query: any) => {
  return query
    .populate("authorId", USER_SELECT)
    .populate("registeredById", USER_SELECT);
};

const populateFileQuery = (query: any) => {
  return query
    .populate("uploadedBy", USER_SELECT)
    .populate(
      "progressNoteId",
      "note progressPercent statusSnapshot source createdAt",
    );
};

const serializeDocument = (document: any): any => {
  return document?.toObject ? document.toObject() : document;
};

const attachFilesToNotes = async (notes: any[]) => {
  const noteObjects = notes.map(serializeDocument);
  const noteIds = noteObjects
    .map((note) => note?._id)
    .filter(Boolean)
    .map((noteId) => String(noteId));

  if (!noteIds.length) return noteObjects;

  const files = await populateFileQuery(
    ProjectFile.find({
      progressNoteId: { $in: noteIds.map(toObjectId) },
    }).sort({ createdAt: -1 }),
  );

  const groupedFiles = (files as any[]).reduce(
    (acc: Record<string, any[]>, file: any) => {
      const fileObject = serializeDocument(file);
      const progressNoteId = fileObject.progressNoteId;
      const noteId =
        typeof progressNoteId === "object" && progressNoteId?._id
          ? String(progressNoteId._id)
          : String(progressNoteId || "");

      if (!noteId) return acc;

      acc[noteId] = acc[noteId] || [];
      acc[noteId].push(fileObject);

      return acc;
    },
    {} as Record<string, any[]>,
  );

  return noteObjects.map((note) => {
    const noteFiles = groupedFiles[String(note._id)] || [];

    return {
      ...note,
      files: noteFiles,
      attachmentCount: noteFiles.length,
    };
  });
};

const getEmployeeProjectFilter = (
  req: AuthRequest,
): Record<string, unknown> => {
  if (getAppRole(req) !== "employee") return {};

  const authUserId = getAuthUserId(req);

  if (!isValidObjectId(authUserId)) return { _id: null };

  return {
    assignedUserIds: toObjectId(authUserId),
  };
};

const employeeHasProjectAccess = (req: AuthRequest, project: any): boolean => {
  if (getAppRole(req) === "manager") return true;

  const authUserId = getAuthUserId(req);

  if (!isValidObjectId(authUserId)) return false;

  return project.assignedUserIds?.some((userId: Types.ObjectId) => {
    return String((userId as any)?._id || userId) === authUserId;
  });
};

const employeeHasPhaseAccess = (req: AuthRequest, phase: any): boolean => {
  if (getAppRole(req) === "manager") return true;

  const authUserId = getAuthUserId(req);

  if (!isValidObjectId(authUserId)) return false;

  return phase.assignedUserIds?.some((userId: Types.ObjectId) => {
    return String((userId as any)?._id || userId) === authUserId;
  });
};

const ensurePhaseAssigneesAreProjectMembers = async ({
  project,
  assignedUserIds,
  authUserId,
}: {
  project: any;
  assignedUserIds: string[];
  authUserId: string;
}): Promise<string | null> => {
  const ownerId = String(project.ownerId || "");

  if (!isValidObjectId(ownerId)) {
    return "مسئول پروژه برای این پروژه ثبت نشده است.";
  }

  const finalAssignedUserIdStrings = Array.from(
    new Set([
      ownerId,
      ...(project.assignedUserIds || []).map((item: Types.ObjectId) =>
        item.toString(),
      ),
      ...assignedUserIds,
    ]),
  ).filter(isValidObjectId);

  const projectMembers = buildProjectMembers({
    userIds: finalAssignedUserIdStrings,
    ownerId,
    requestedMembers: [],
    existingMembers: buildExistingProjectMemberMap(project),
    fallbackStartDate: project.startDate,
    fallbackExpectedFinishedAt: project.dueDate,
  });

  const projectMemberDateError = validateProjectMembersDates(projectMembers);

  if (projectMemberDateError) return projectMemberDateError;

  await Project.findByIdAndUpdate(project._id, {
    $set: {
      assignedUserIds: finalAssignedUserIdStrings.map(toObjectId),
      projectMembers,
      updatedBy: toObjectId(authUserId),
    },
  });

  return null;
};

const employeeHasTaskAccess = (req: AuthRequest, task: any): boolean => {
  if (getAppRole(req) === "manager") return true;

  const authUserId = getAuthUserId(req);

  if (!isValidObjectId(authUserId)) return false;

  return task.assignedUserIds?.some((userId: Types.ObjectId) => {
    return String((userId as any)?._id || userId) === authUserId;
  });
};

const resolveProjectNoteAuthorId = async (
  req: AuthRequest,
  _project: any,
  requestedAuthorId: unknown,
): Promise<Types.ObjectId> => {
  const authUserId = getAuthUserId(req);

  if (!isValidObjectId(authUserId)) {
    throw new Error("شناسه کاربر جاری معتبر نیست.");
  }

  const targetAuthorId =
    typeof requestedAuthorId === "string" && requestedAuthorId.trim()
      ? requestedAuthorId.trim()
      : authUserId;

  if (!isValidObjectId(targetAuthorId)) {
    throw new Error("شناسه مدیر انجام‌دهنده معتبر نیست.");
  }

  const managerUser = await User.findOne({
    _id: targetAuthorId,
    role: UserRole.MANAGER,
    isActive: true,
  }).select("_id role isActive");

  if (!managerUser) {
    throw new Error("مدیر انتخاب‌شده معتبر یا فعال نیست.");
  }

  return managerUser._id as Types.ObjectId;
};

const resolveManagerTaskAssigneeIds = async (
  req: AuthRequest,
  requestedAssignedUserIds: unknown,
): Promise<Types.ObjectId[]> => {
  const authUserId = getAuthUserId(req);

  if (!isValidObjectId(authUserId)) {
    throw new Error("شناسه کاربر جاری معتبر نیست.");
  }

  const rawIds = Array.isArray(requestedAssignedUserIds)
    ? requestedAssignedUserIds
    : [];

  const uniqueIds = Array.from(
    new Set(
      rawIds
        .filter((item) => typeof item === "string" && isValidObjectId(item))
        .map((item) => String(item)),
    ),
  );

  if (!uniqueIds.length) {
    uniqueIds.push(authUserId);
  }

  const managers = await User.find({
    _id: { $in: uniqueIds.map(toObjectId) },
    role: UserRole.MANAGER,
    isActive: true,
  }).select("_id role isActive");

  if (managers.length !== uniqueIds.length) {
    throw new Error("همه مسئولان انتخاب‌شده باید مدیر فعال باشند.");
  }

  return managers.map((manager) => manager._id as Types.ObjectId);
};

export const listProjects = async (req: AuthRequest, res: Response) => {
  const {
    page = "1",
    limit = "20",
    search,
    status,
    priority,
    assignedUserId,
  } = req.query;

  const pageNumber = Math.max(Number(page) || 1, 1);
  const limitNumber = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const skip = (pageNumber - 1) * limitNumber;

  const filter: Record<string, unknown> = {
    ...getEmployeeProjectFilter(req),
  };

  if (typeof search === "string" && search.trim()) {
    filter.$or = [
      { title: { $regex: search.trim(), $options: "i" } },
      { description: { $regex: search.trim(), $options: "i" } },
    ];
  }

  if (typeof status === "string" && status.trim()) {
    const normalizedStatus = normalizeEnumValue(status, ProjectStatus);

    if (!normalizedStatus) {
      return sendValidationError(res, "وضعیت پروژه معتبر نیست.");
    }

    filter.status = normalizedStatus;
  }

  if (typeof priority === "string" && priority.trim()) {
    const normalizedPriority = normalizeEnumValue(priority, ProjectPriority);

    if (!normalizedPriority) {
      return sendValidationError(res, "اولویت پروژه معتبر نیست.");
    }

    filter.priority = normalizedPriority;
  }

  if (typeof assignedUserId === "string" && assignedUserId.trim()) {
    if (!isValidObjectId(assignedUserId)) {
      return sendValidationError(res, "شناسه کاربر معتبر نیست.");
    }

    filter.assignedUserIds = toObjectId(assignedUserId);
  }

  const [items, total] = await Promise.all([
    populateProjectQuery(
      Project.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNumber),
    ),
    Project.countDocuments(filter),
  ]);

  const itemsWithPhaseSummary = await attachPhaseSummariesToProjects(
    items as any[],
  );

  return res.json({
    success: true,
    message: "فهرست پروژه‌ها با موفقیت دریافت شد.",
    data: itemsWithPhaseSummary,
    pagination: {
      total,
      page: pageNumber,
      limit: limitNumber,
      totalPages: Math.ceil(total / limitNumber),
    },
  });
};

export const createProject = async (req: AuthRequest, res: Response) => {
  if (!isManager(req)) return sendForbidden(res);

  const authUserId = getAuthUserId(req);

  if (!isValidObjectId(authUserId)) {
    return sendValidationError(res, "شناسه کاربر جاری معتبر نیست.");
  }

  const {
    title,
    description,
    status,
    priority,
    startDate,
    dueDate,
    ownerId,
    assignedUserIds,
    phases,
  } = req.body;

  if (!title || typeof title !== "string" || !title.trim()) {
    return sendValidationError(res, "عنوان پروژه الزامی است.");
  }

  if (!ownerId || typeof ownerId !== "string" || !isValidObjectId(ownerId)) {
    return sendValidationError(res, "مسئول پروژه معتبر نیست.");
  }

  const parsedStartDate = normalizeRequiredDate(startDate);

  if (!parsedStartDate) {
    return sendValidationError(res, "تاریخ شروع پروژه معتبر نیست.");
  }

  const parsedDueDate = normalizeOptionalDate(dueDate);

  if (parsedDueDate && parsedDueDate < parsedStartDate) {
    return sendValidationError(
      res,
      "موعد تحویل نمی‌تواند قبل از تاریخ شروع باشد.",
    );
  }

  const normalizedPhasePayloads = normalizeProjectPhasesPayload(phases);

  if (normalizedPhasePayloads.error) {
    return sendValidationError(res, normalizedPhasePayloads.error);
  }

  const normalizedStatus =
    normalizeEnumValue(status, ProjectStatus) || ProjectStatus.PLANNING;

  const normalizedPriority =
    normalizeEnumValue(priority, ProjectPriority) || ProjectPriority.MEDIUM;

  const normalizedOwnerId = toObjectId(ownerId);
  const normalizedAssignedUserIds = normalizeObjectIdArray(assignedUserIds);
  const projectRoleResolution = await attachProjectRoleTitles(
    normalizeProjectMembersPayload(getProjectMembersPayload(req.body)),
  );

  if (projectRoleResolution.error) {
    return sendValidationError(res, projectRoleResolution.error);
  }

  const normalizedProjectMemberPayloads = projectRoleResolution.members;

  const finalAssignedUserIdStrings = Array.from(
    new Set([
      normalizedOwnerId.toString(),
      ...normalizedAssignedUserIds.map((item) => item.toString()),
      ...normalizedProjectMemberPayloads.map((member) => member.userId),
      ...normalizedPhasePayloads.phases.flatMap(
        (phase) => phase.assignedUserIds,
      ),
    ]),
  );

  const projectMembers = buildProjectMembers({
    userIds: finalAssignedUserIdStrings,
    ownerId: normalizedOwnerId.toString(),
    requestedMembers: normalizedProjectMemberPayloads,
    fallbackStartDate: parsedStartDate,
    fallbackExpectedFinishedAt: parsedDueDate,
  });

  const projectMemberDateError = validateProjectMembersDates(projectMembers);

  if (projectMemberDateError) {
    return sendValidationError(res, projectMemberDateError);
  }

  const finalAssignedUserIds = finalAssignedUserIdStrings.map(toObjectId);

  const project = await Project.create({
    title: title.trim(),
    description: typeof description === "string" ? description.trim() : "",
    status: normalizedStatus,
    statusLabel: PROJECT_STATUS_LABELS[normalizedStatus],
    priority: normalizedPriority,
    priorityLabel: PROJECT_PRIORITY_LABELS[normalizedPriority],
    startDate: parsedStartDate,
    dueDate: parsedDueDate,
    ownerId: normalizedOwnerId,
    assignedUserIds: finalAssignedUserIds,
    projectMembers,
    language: "fa",
    direction: "rtl",
    createdBy: toObjectId(authUserId),
    updatedBy: toObjectId(authUserId),
  });

  if (normalizedPhasePayloads.phases.length) {
    await ProjectPhase.insertMany(
      normalizedPhasePayloads.phases.map((phase) => ({
        projectId: project._id,
        title: phase.title,
        description: phase.description,
        assignedUserIds: phase.assignedUserIds.map(toObjectId),
        startDate: phase.startDate,
        endDate: phase.endDate,
        order: phase.order,
        financial: phase.financial,
        language: "fa",
        direction: "rtl",
        createdBy: toObjectId(authUserId),
        updatedBy: toObjectId(authUserId),
      })),
    );
  }

  const populatedProject = await populateProjectQuery(
    Project.findById(project._id),
  );
  const phasesForProject = await populatePhaseQuery(
    ProjectPhase.find({ projectId: project._id }).sort({
      order: 1,
      startDate: 1,
    }),
  );
  const [projectWithSummary] = await attachPhaseSummariesToProjects(
    populatedProject ? [populatedProject] : [],
  );

  return sendSuccess(
    res,
    {
      ...projectWithSummary,
      phases: phasesForProject.map(serializeProjectPhase),
    },
    "پروژه با موفقیت ایجاد شد.",
    201,
  );
};

export const getProjectById = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    return sendValidationError(res, "شناسه پروژه معتبر نیست.");
  }

  const project = await populateProjectQuery(Project.findById(id));

  if (!project) {
    return sendNotFound(res, "پروژه پیدا نشد.");
  }

  if (!employeeHasProjectAccess(req, project)) {
    return sendForbidden(res);
  }

  const phases = await populatePhaseQuery(
    ProjectPhase.find({ projectId: id }).sort({ order: 1, startDate: 1 }),
  );
  const [projectWithSummary] = await attachPhaseSummariesToProjects([project]);

  return sendSuccess(
    res,
    {
      ...projectWithSummary,
      phases: phases.map(serializeProjectPhase),
    },
    "اطلاعات پروژه با موفقیت دریافت شد.",
  );
};

export const updateProject = async (req: AuthRequest, res: Response) => {
  if (!isManager(req)) return sendForbidden(res);

  const { id } = req.params;
  const authUserId = getAuthUserId(req);

  if (!isValidObjectId(id)) {
    return sendValidationError(res, "شناسه پروژه معتبر نیست.");
  }

  if (!isValidObjectId(authUserId)) {
    return sendValidationError(res, "شناسه کاربر جاری معتبر نیست.");
  }

  const project = await Project.findById(id);

  if (!project) {
    return sendNotFound(res, "پروژه پیدا نشد.");
  }

  const update: Record<string, unknown> = {
    updatedBy: toObjectId(authUserId),
  };

  if ("title" in req.body) {
    if (!req.body.title || typeof req.body.title !== "string") {
      return sendValidationError(res, "عنوان پروژه معتبر نیست.");
    }

    update.title = req.body.title.trim();
  }

  if ("description" in req.body) {
    update.description =
      typeof req.body.description === "string"
        ? req.body.description.trim()
        : "";
  }

  if ("status" in req.body) {
    const normalizedStatus = normalizeEnumValue(req.body.status, ProjectStatus);

    if (!normalizedStatus) {
      return sendValidationError(res, "وضعیت پروژه معتبر نیست.");
    }

    update.status = normalizedStatus;
    update.statusLabel = PROJECT_STATUS_LABELS[normalizedStatus];
  }

  if ("priority" in req.body) {
    const normalizedPriority = normalizeEnumValue(
      req.body.priority,
      ProjectPriority,
    );

    if (!normalizedPriority) {
      return sendValidationError(res, "اولویت پروژه معتبر نیست.");
    }

    update.priority = normalizedPriority;
    update.priorityLabel = PROJECT_PRIORITY_LABELS[normalizedPriority];
  }

  if ("startDate" in req.body) {
    const parsedStartDate = normalizeRequiredDate(req.body.startDate);

    if (!parsedStartDate) {
      return sendValidationError(res, "تاریخ شروع پروژه معتبر نیست.");
    }

    update.startDate = parsedStartDate;
  }

  if ("dueDate" in req.body) {
    update.dueDate = normalizeOptionalDate(req.body.dueDate);
  }

  if ("ownerId" in req.body) {
    if (
      !req.body.ownerId ||
      typeof req.body.ownerId !== "string" ||
      !isValidObjectId(req.body.ownerId)
    ) {
      return sendValidationError(res, "مسئول پروژه معتبر نیست.");
    }

    update.ownerId = toObjectId(req.body.ownerId);
  }

  const shouldUpdateMembers =
    "assignedUserIds" in req.body ||
    "projectMembers" in req.body ||
    "members" in req.body ||
    "ownerId" in req.body;

  if (shouldUpdateMembers) {
    const ownerId =
      update.ownerId instanceof Types.ObjectId
        ? update.ownerId
        : project.ownerId;

    if (!ownerId) {
      return sendValidationError(
        res,
        "مسئول پروژه برای این پروژه ثبت نشده است.",
      );
    }

    const assignedIds =
      "assignedUserIds" in req.body
        ? normalizeObjectIdArray(req.body.assignedUserIds)
        : project.assignedUserIds || [];

    const projectRoleResolution = await attachProjectRoleTitles(
      normalizeProjectMembersPayload(getProjectMembersPayload(req.body)),
    );

    if (projectRoleResolution.error) {
      return sendValidationError(res, projectRoleResolution.error);
    }

    const normalizedProjectMemberPayloads = projectRoleResolution.members;

    const finalAssignedUserIdStrings = Array.from(
      new Set([
        ownerId.toString(),
        ...assignedIds.map((item: Types.ObjectId) => item.toString()),
        ...normalizedProjectMemberPayloads.map((member) => member.userId),
      ]),
    );

    const projectMembers = buildProjectMembers({
      userIds: finalAssignedUserIdStrings,
      ownerId: ownerId.toString(),
      requestedMembers: normalizedProjectMemberPayloads,
      existingMembers: buildExistingProjectMemberMap(project),
      fallbackStartDate:
        update.startDate instanceof Date ? update.startDate : project.startDate,
      fallbackExpectedFinishedAt:
        "dueDate" in update ? (update.dueDate as Date | null) : project.dueDate,
    });

    const projectMemberDateError = validateProjectMembersDates(projectMembers);

    if (projectMemberDateError) {
      return sendValidationError(res, projectMemberDateError);
    }

    update.assignedUserIds = finalAssignedUserIdStrings.map(toObjectId);
    update.projectMembers = projectMembers;
  }

  const nextStartDate =
    update.startDate instanceof Date ? update.startDate : project.startDate;

  const nextDueDate =
    "dueDate" in update ? (update.dueDate as Date | null) : project.dueDate;

  if (nextDueDate && nextStartDate && nextDueDate < nextStartDate) {
    return sendValidationError(
      res,
      "موعد تحویل نمی‌تواند قبل از تاریخ شروع باشد.",
    );
  }

  const updatedProject = await populateProjectQuery(
    Project.findByIdAndUpdate(id, update, {
      new: true,
      runValidators: true,
    }),
  );

  return sendSuccess(res, updatedProject, "پروژه با موفقیت ویرایش شد.");
};

export const deleteProject = async (req: AuthRequest, res: Response) => {
  if (!isManager(req)) return sendForbidden(res);

  const { id } = req.params;

  if (!isValidObjectId(id)) {
    return sendValidationError(res, "شناسه پروژه معتبر نیست.");
  }

  const project = await Project.findByIdAndDelete(id);

  if (!project) {
    return sendNotFound(res, "پروژه پیدا نشد.");
  }

  await Promise.all([
    ProjectPhase.deleteMany({ projectId: project._id }),
    ProjectTask.deleteMany({ projectId: project._id }),
    ProjectProgressNote.deleteMany({ projectId: project._id }),
    ProjectFile.deleteMany({ projectId: project._id }),
  ]);

  return sendSuccess(res, null, "پروژه با موفقیت حذف شد.");
};

export const assignUsersToProject = async (req: AuthRequest, res: Response) => {
  if (!isManager(req)) return sendForbidden(res);

  const { id } = req.params;
  const { userIds } = req.body;
  const authUserId = getAuthUserId(req);

  if (!isValidObjectId(id)) {
    return sendValidationError(res, "شناسه پروژه معتبر نیست.");
  }

  if (!isValidObjectId(authUserId)) {
    return sendValidationError(res, "شناسه کاربر جاری معتبر نیست.");
  }

  const project = await Project.findById(id);

  if (!project) {
    return sendNotFound(res, "پروژه پیدا نشد.");
  }

  if (!project.ownerId) {
    return sendValidationError(res, "مسئول پروژه برای این پروژه ثبت نشده است.");
  }

  const normalizedUserIds = normalizeObjectIdArray(userIds);
  const projectRoleResolution = await attachProjectRoleTitles(
    normalizeProjectMembersPayload(getProjectMembersPayload(req.body)),
  );

  if (projectRoleResolution.error) {
    return sendValidationError(res, projectRoleResolution.error);
  }

  const normalizedProjectMemberPayloads = projectRoleResolution.members;

  const finalAssignedUserIdStrings = Array.from(
    new Set([
      project.ownerId.toString(),
      ...(project.assignedUserIds || []).map((item: Types.ObjectId) =>
        item.toString(),
      ),
      ...normalizedUserIds.map((item) => item.toString()),
      ...normalizedProjectMemberPayloads.map((member) => member.userId),
    ]),
  );

  const projectMembers = buildProjectMembers({
    userIds: finalAssignedUserIdStrings,
    ownerId: project.ownerId.toString(),
    requestedMembers: normalizedProjectMemberPayloads,
    existingMembers: buildExistingProjectMemberMap(project),
    fallbackStartDate: project.startDate,
    fallbackExpectedFinishedAt: project.dueDate,
  });

  const projectMemberDateError = validateProjectMembersDates(projectMembers);

  if (projectMemberDateError) {
    return sendValidationError(res, projectMemberDateError);
  }

  const updatedProject = await populateProjectQuery(
    Project.findByIdAndUpdate(
      id,
      {
        $set: {
          assignedUserIds: finalAssignedUserIdStrings.map(toObjectId),
          projectMembers,
          updatedBy: toObjectId(authUserId),
        },
      },
      {
        new: true,
        runValidators: true,
      },
    ),
  );

  return sendSuccess(
    res,
    updatedProject,
    "اعضای پروژه با موفقیت به‌روزرسانی شدند.",
  );
};

export const updateProjectMember = async (req: AuthRequest, res: Response) => {
  if (!isManager(req)) return sendForbidden(res);

  const { id, userId } = req.params;
  const authUserId = getAuthUserId(req);

  if (!isValidObjectId(id) || !isValidObjectId(userId)) {
    return sendValidationError(res, "شناسه پروژه یا کاربر معتبر نیست.");
  }

  if (!isValidObjectId(authUserId)) {
    return sendValidationError(res, "شناسه کاربر جاری معتبر نیست.");
  }

  const project = await Project.findById(id);

  if (!project) {
    return sendNotFound(res, "پروژه پیدا نشد.");
  }

  if (!project.ownerId) {
    return sendValidationError(res, "مسئول پروژه برای این پروژه ثبت نشده است.");
  }

  const requestedRoleId = String(req.body.roleId || "").trim();
  const roleId = isValidObjectId(requestedRoleId) ? requestedRoleId : null;
  const requestedRoleResolution = await attachProjectRoleTitles([
    {
      userId,
      roleId,
      roleInProject:
        typeof req.body.roleInProject === "string"
          ? req.body.roleInProject.trim()
          : "",
      startedAt: null,
      expectedFinishedAt: null,
    },
  ]);

  if (requestedRoleResolution.error) {
    return sendValidationError(res, requestedRoleResolution.error);
  }

  const resolvedRole = requestedRoleResolution.members[0];
  const roleInProject = resolvedRole?.roleInProject || "";

  const startedAt = normalizeOptionalDate(req.body.startedAt);
  const expectedFinishedAt = normalizeOptionalDate(req.body.expectedFinishedAt);

  if (startedAt && expectedFinishedAt && expectedFinishedAt < startedAt) {
    return sendValidationError(
      res,
      "تاریخ پایان احتمالی عضو پروژه نمی‌تواند قبل از تاریخ شروع او باشد.",
    );
  }

  const existingMembers = buildExistingProjectMemberMap(project);
  const existingMember = existingMembers.get(userId);

  existingMembers.set(userId, {
    userId,
    roleId: roleId || existingMember?.roleId || null,
    roleInProject:
      roleInProject ||
      existingMember?.roleInProject ||
      (project.ownerId.toString() === userId ? "مسئول پروژه" : "عضو پروژه"),
    startedAt:
      req.body.startedAt !== undefined
        ? startedAt
        : existingMember?.startedAt || project.startDate || null,
    expectedFinishedAt:
      req.body.expectedFinishedAt !== undefined
        ? expectedFinishedAt
        : existingMember?.expectedFinishedAt || project.dueDate || null,
  });

  const finalAssignedUserIdStrings = Array.from(
    new Set([
      project.ownerId.toString(),
      ...(project.assignedUserIds || []).map((item: Types.ObjectId) =>
        item.toString(),
      ),
      userId,
    ]),
  );

  const projectMembers = buildProjectMembers({
    userIds: finalAssignedUserIdStrings,
    ownerId: project.ownerId.toString(),
    requestedMembers: Array.from(existingMembers.values()),
    existingMembers,
    fallbackStartDate: project.startDate,
    fallbackExpectedFinishedAt: project.dueDate,
  });

  const updatedProject = await populateProjectQuery(
    Project.findByIdAndUpdate(
      id,
      {
        $set: {
          assignedUserIds: finalAssignedUserIdStrings.map(toObjectId),
          projectMembers,
          updatedBy: toObjectId(authUserId),
        },
      },
      {
        new: true,
        runValidators: true,
      },
    ),
  );

  return sendSuccess(
    res,
    updatedProject,
    "نقش و زمان‌بندی عضو پروژه با موفقیت ویرایش شد.",
  );
};

export const removeUserFromProject = async (
  req: AuthRequest,
  res: Response,
) => {
  if (!isManager(req)) return sendForbidden(res);

  const { id, userId } = req.params;
  const authUserId = getAuthUserId(req);

  if (!isValidObjectId(id) || !isValidObjectId(userId)) {
    return sendValidationError(res, "شناسه پروژه یا کاربر معتبر نیست.");
  }

  if (!isValidObjectId(authUserId)) {
    return sendValidationError(res, "شناسه کاربر جاری معتبر نیست.");
  }

  const project = await Project.findById(id);

  if (!project) {
    return sendNotFound(res, "پروژه پیدا نشد.");
  }

  const ownerId = project.ownerId;

  if (!ownerId) {
    return sendValidationError(res, "مسئول پروژه برای این پروژه ثبت نشده است.");
  }

  if (ownerId.toString() === userId) {
    return sendValidationError(res, "مسئول پروژه را نمی‌توان از اعضا حذف کرد.");
  }

  const assignedPhase = await ProjectPhase.findOne({
    projectId: id,
    assignedUserIds: toObjectId(userId),
  }).select("_id title");

  if (assignedPhase) {
    return sendValidationError(
      res,
      "این کاربر مسئول حداقل یک فاز پروژه است؛ ابتدا مسئول فاز را تغییر دهید.",
    );
  }

  const updatedProject = await populateProjectQuery(
    Project.findByIdAndUpdate(
      id,
      {
        $pull: {
          assignedUserIds: toObjectId(userId),
          projectMembers: { userId: toObjectId(userId) },
        },
        $set: { updatedBy: toObjectId(authUserId) },
      },
      {
        new: true,
        runValidators: true,
      },
    ),
  );

  return sendSuccess(res, updatedProject, "کاربر با موفقیت از پروژه حذف شد.");
};

export const listProjectPhases = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    return sendValidationError(res, "شناسه پروژه معتبر نیست.");
  }

  const project = await Project.findById(id);

  if (!project) {
    return sendNotFound(res, "پروژه پیدا نشد.");
  }

  if (!employeeHasProjectAccess(req, project)) {
    return sendForbidden(res);
  }

  const phases = await populatePhaseQuery(
    ProjectPhase.find({ projectId: id }).sort({ order: 1, startDate: 1 }),
  );

  return sendSuccess(
    res,
    phases.map(serializeProjectPhase),
    "فازهای پروژه با موفقیت دریافت شدند.",
  );
};

export const createProjectPhase = async (req: AuthRequest, res: Response) => {
  if (!isManager(req)) return sendForbidden(res);

  const { id } = req.params;
  const authUserId = getAuthUserId(req);

  if (!isValidObjectId(id)) {
    return sendValidationError(res, "شناسه پروژه معتبر نیست.");
  }

  if (!isValidObjectId(authUserId)) {
    return sendValidationError(res, "شناسه کاربر جاری معتبر نیست.");
  }

  const project = await Project.findById(id);

  if (!project) {
    return sendNotFound(res, "پروژه پیدا نشد.");
  }

  const normalizedPhasePayloads = normalizeProjectPhasesPayload([req.body]);

  if (normalizedPhasePayloads.error) {
    return sendValidationError(res, normalizedPhasePayloads.error);
  }

  const phasePayload = normalizedPhasePayloads.phases[0];
  const membershipError = await ensurePhaseAssigneesAreProjectMembers({
    project,
    assignedUserIds: phasePayload.assignedUserIds,
    authUserId,
  });

  if (membershipError) {
    return sendValidationError(res, membershipError);
  }

  const phase = await ProjectPhase.create({
    projectId: toObjectId(id),
    title: phasePayload.title,
    description: phasePayload.description,
    assignedUserIds: phasePayload.assignedUserIds.map(toObjectId),
    startDate: phasePayload.startDate,
    endDate: phasePayload.endDate,
    order: phasePayload.order,
    financial: phasePayload.financial,
    language: "fa",
    direction: "rtl",
    createdBy: toObjectId(authUserId),
    updatedBy: toObjectId(authUserId),
  });

  const populatedPhase = await populatePhaseQuery(
    ProjectPhase.findById(phase._id),
  );

  return sendSuccess(
    res,
    serializeProjectPhase(populatedPhase),
    "فاز پروژه با موفقیت ایجاد شد.",
    201,
  );
};

export const getProjectPhaseById = async (req: AuthRequest, res: Response) => {
  const { id, phaseId } = req.params;

  if (!isValidObjectId(id) || !isValidObjectId(phaseId)) {
    return sendValidationError(res, "شناسه پروژه یا فاز معتبر نیست.");
  }

  const project = await Project.findById(id);

  if (!project) {
    return sendNotFound(res, "پروژه پیدا نشد.");
  }

  if (!employeeHasProjectAccess(req, project)) {
    return sendForbidden(res);
  }

  const phase = await populatePhaseQuery(
    ProjectPhase.findOne({ _id: phaseId, projectId: id }),
  );

  if (!phase) {
    return sendNotFound(res, "فاز پروژه پیدا نشد.");
  }

  if (!employeeHasPhaseAccess(req, phase)) {
    return sendForbidden(res);
  }

  return sendSuccess(
    res,
    serializeProjectPhase(phase),
    "اطلاعات فاز پروژه با موفقیت دریافت شد.",
  );
};

export const updateProjectPhase = async (req: AuthRequest, res: Response) => {
  if (!isManager(req)) return sendForbidden(res);

  const { id, phaseId } = req.params;
  const authUserId = getAuthUserId(req);

  if (!isValidObjectId(id) || !isValidObjectId(phaseId)) {
    return sendValidationError(res, "شناسه پروژه یا فاز معتبر نیست.");
  }

  if (!isValidObjectId(authUserId)) {
    return sendValidationError(res, "شناسه کاربر جاری معتبر نیست.");
  }

  const [project, phase] = await Promise.all([
    Project.findById(id),
    ProjectPhase.findOne({ _id: phaseId, projectId: id }),
  ]);

  if (!project) {
    return sendNotFound(res, "پروژه پیدا نشد.");
  }

  if (!phase) {
    return sendNotFound(res, "فاز پروژه پیدا نشد.");
  }

  const update: Record<string, unknown> = {
    updatedBy: toObjectId(authUserId),
  };

  if ("title" in req.body) {
    if (!req.body.title || typeof req.body.title !== "string") {
      return sendValidationError(res, "عنوان فاز معتبر نیست.");
    }

    update.title = req.body.title.trim();
  }

  if ("description" in req.body) {
    update.description =
      typeof req.body.description === "string"
        ? req.body.description.trim()
        : "";
  }

  let nextAssignedUserIds = (phase.assignedUserIds || []).map(
    (userId: Types.ObjectId) => userId.toString(),
  );

  if ("assignedUserIds" in req.body) {
    nextAssignedUserIds = normalizeObjectIdArray(req.body.assignedUserIds).map(
      (userId) => userId.toString(),
    );

    if (!nextAssignedUserIds.length) {
      return sendValidationError(
        res,
        "برای هر فاز حداقل یک مسئول انجام کار انتخاب کنید.",
      );
    }

    update.assignedUserIds = nextAssignedUserIds.map(toObjectId);
  }

  if ("startDate" in req.body) {
    const parsedStartDate = normalizeRequiredDate(req.body.startDate);

    if (!parsedStartDate) {
      return sendValidationError(res, "تاریخ شروع فاز معتبر نیست.");
    }

    update.startDate = parsedStartDate;
  }

  if ("endDate" in req.body) {
    const parsedEndDate = normalizeRequiredDate(req.body.endDate);

    if (!parsedEndDate) {
      return sendValidationError(res, "تاریخ پایان فاز معتبر نیست.");
    }

    update.endDate = parsedEndDate;
  }

  const nextStartDate =
    update.startDate instanceof Date ? update.startDate : phase.startDate;
  const nextEndDate =
    update.endDate instanceof Date ? update.endDate : phase.endDate;

  if (nextEndDate && nextStartDate && nextEndDate < nextStartDate) {
    return sendValidationError(
      res,
      "تاریخ پایان فاز نمی‌تواند قبل از تاریخ شروع باشد.",
    );
  }

  if ("order" in req.body) {
    const order = Number(req.body.order);
    update.order = Number.isInteger(order) && order > 0 ? order : phase.order;
  }

  if (hasPhaseFinancialPayload(req.body)) {
    const normalizedFinancial = normalizeMergedPhaseFinancialPayload(
      phase.financial,
      req.body,
    );

    if (!normalizedFinancial) {
      return sendValidationError(
        res,
        "مبالغ مالی فاز باید عدد مثبت یا صفر باشند.",
      );
    }

    update.financial = normalizedFinancial;
  }

  const membershipError = await ensurePhaseAssigneesAreProjectMembers({
    project,
    assignedUserIds: nextAssignedUserIds,
    authUserId,
  });

  if (membershipError) {
    return sendValidationError(res, membershipError);
  }

  const updatedPhase = await populatePhaseQuery(
    ProjectPhase.findOneAndUpdate({ _id: phaseId, projectId: id }, update, {
      new: true,
      runValidators: true,
    }),
  );

  return sendSuccess(
    res,
    serializeProjectPhase(updatedPhase),
    "فاز پروژه با موفقیت ویرایش شد.",
  );
};

export const updateProjectPhaseFinancial = async (
  req: AuthRequest,
  res: Response,
) => {
  if (!isManager(req)) return sendForbidden(res);

  const { id, phaseId } = req.params;
  const authUserId = getAuthUserId(req);

  if (!isValidObjectId(id) || !isValidObjectId(phaseId)) {
    return sendValidationError(res, "شناسه پروژه یا فاز معتبر نیست.");
  }

  if (!isValidObjectId(authUserId)) {
    return sendValidationError(res, "شناسه کاربر جاری معتبر نیست.");
  }

  const phase = await ProjectPhase.findOne({ _id: phaseId, projectId: id });

  if (!phase) {
    return sendNotFound(res, "فاز پروژه پیدا نشد.");
  }

  const normalizedFinancial = normalizeMergedPhaseFinancialPayload(
    phase.financial,
    req.body,
  );

  if (!normalizedFinancial) {
    return sendValidationError(
      res,
      "مبالغ مالی فاز باید عدد مثبت یا صفر باشند.",
    );
  }

  const updatedPhase = await populatePhaseQuery(
    ProjectPhase.findOneAndUpdate(
      { _id: phaseId, projectId: id },
      {
        $set: {
          financial: normalizedFinancial,
          updatedBy: toObjectId(authUserId),
        },
      },
      { new: true, runValidators: true },
    ),
  );

  return sendSuccess(
    res,
    serializeProjectPhase(updatedPhase),
    "اطلاعات مالی فاز با موفقیت ثبت شد.",
  );
};

export const deleteProjectPhase = async (req: AuthRequest, res: Response) => {
  if (!isManager(req)) return sendForbidden(res);

  const { id, phaseId } = req.params;

  if (!isValidObjectId(id) || !isValidObjectId(phaseId)) {
    return sendValidationError(res, "شناسه پروژه یا فاز معتبر نیست.");
  }

  const phase = await ProjectPhase.findOneAndDelete({
    _id: phaseId,
    projectId: id,
  });

  if (!phase) {
    return sendNotFound(res, "فاز پروژه پیدا نشد.");
  }

  return sendSuccess(res, null, "فاز پروژه با موفقیت حذف شد.");
};

export const listProjectTasks = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    return sendValidationError(res, "شناسه پروژه معتبر نیست.");
  }

  const project = await Project.findById(id);

  if (!project) {
    return sendNotFound(res, "پروژه پیدا نشد.");
  }

  if (!employeeHasProjectAccess(req, project)) {
    return sendForbidden(res);
  }

  const filter: Record<string, unknown> = { projectId: id };

  if (getAppRole(req) === "employee") {
    filter.assignedUserIds = toObjectId(getAuthUserId(req));
  }

  const tasks = await populateTaskQuery(
    ProjectTask.find(filter).sort({ dueDate: 1, createdAt: -1 }),
  );

  return sendSuccess(res, tasks, "وظایف پروژه با موفقیت دریافت شد.");
};

export const createProjectTask = async (req: AuthRequest, res: Response) => {
  if (!isManager(req)) return sendForbidden(res);

  const { id } = req.params;
  const authUserId = getAuthUserId(req);

  if (!isValidObjectId(id)) {
    return sendValidationError(res, "شناسه پروژه معتبر نیست.");
  }

  if (!isValidObjectId(authUserId)) {
    return sendValidationError(res, "شناسه کاربر جاری معتبر نیست.");
  }

  const project = await Project.findById(id);

  if (!project) {
    return sendNotFound(res, "پروژه پیدا نشد.");
  }

  const {
    title,
    description,
    assignedUserIds,
    status,
    priority,
    startDate,
    dueDate,
  } = req.body;

  if (!title || typeof title !== "string" || !title.trim()) {
    return sendValidationError(res, "عنوان وظیفه الزامی است.");
  }

  let resolvedAssignedUserIds: Types.ObjectId[];

  try {
    resolvedAssignedUserIds = await resolveManagerTaskAssigneeIds(
      req,
      assignedUserIds,
    );
  } catch (error) {
    return sendValidationError(
      res,
      error instanceof Error
        ? error.message
        : "مسئولان انتخاب‌شده برای وظیفه معتبر نیستند.",
    );
  }

  const normalizedStatus =
    normalizeEnumValue(status, ProjectTaskStatus) || ProjectTaskStatus.TODO;

  const normalizedPriority =
    normalizeEnumValue(priority, ProjectPriority) || ProjectPriority.MEDIUM;

  const parsedStartDate = normalizeOptionalDate(startDate);
  const parsedDueDate = normalizeOptionalDate(dueDate);

  if (parsedStartDate && parsedDueDate && parsedDueDate < parsedStartDate) {
    return sendValidationError(
      res,
      "موعد انجام وظیفه نمی‌تواند قبل از تاریخ شروع باشد.",
    );
  }

  const task = await ProjectTask.create({
    projectId: toObjectId(id),
    title: title.trim(),
    description: typeof description === "string" ? description.trim() : "",
    assignedUserIds: resolvedAssignedUserIds,
    status: normalizedStatus,
    statusLabel: PROJECT_TASK_STATUS_LABELS[normalizedStatus],
    priority: normalizedPriority,
    priorityLabel: PROJECT_PRIORITY_LABELS[normalizedPriority],
    startDate: parsedStartDate,
    dueDate: parsedDueDate,
    completedAt:
      normalizedStatus === ProjectTaskStatus.DONE ? new Date() : null,
    language: "fa",
    direction: "rtl",
    createdBy: toObjectId(authUserId),
    updatedBy: toObjectId(authUserId),
  });

  const populatedTask = await populateTaskQuery(ProjectTask.findById(task._id));

  return sendSuccess(res, populatedTask, "وظیفه با موفقیت ایجاد شد.", 201);
};

export const updateProjectTask = async (req: AuthRequest, res: Response) => {
  const { id, taskId } = req.params;
  const authUserId = getAuthUserId(req);

  if (!isValidObjectId(id) || !isValidObjectId(taskId)) {
    return sendValidationError(res, "شناسه پروژه یا وظیفه معتبر نیست.");
  }

  if (!isValidObjectId(authUserId)) {
    return sendValidationError(res, "شناسه کاربر جاری معتبر نیست.");
  }

  const task = await ProjectTask.findOne({ _id: taskId, projectId: id });

  if (!task) {
    return sendNotFound(res, "وظیفه پیدا نشد.");
  }

  if (!employeeHasTaskAccess(req, task)) {
    return sendForbidden(res);
  }

  const update: Record<string, unknown> = {
    updatedBy: toObjectId(authUserId),
  };

  if (isManager(req)) {
    if ("title" in req.body) {
      if (!req.body.title || typeof req.body.title !== "string") {
        return sendValidationError(res, "عنوان وظیفه معتبر نیست.");
      }

      update.title = req.body.title.trim();
    }

    if ("description" in req.body) {
      update.description =
        typeof req.body.description === "string"
          ? req.body.description.trim()
          : "";
    }

    if ("priority" in req.body) {
      const normalizedPriority = normalizeEnumValue(
        req.body.priority,
        ProjectPriority,
      );

      if (!normalizedPriority) {
        return sendValidationError(res, "اولویت وظیفه معتبر نیست.");
      }

      update.priority = normalizedPriority;
      update.priorityLabel = PROJECT_PRIORITY_LABELS[normalizedPriority];
    }

    if ("startDate" in req.body) {
      update.startDate = normalizeOptionalDate(req.body.startDate);
    }

    if ("dueDate" in req.body) {
      update.dueDate = normalizeOptionalDate(req.body.dueDate);
    }

    if ("assignedUserIds" in req.body) {
      try {
        update.assignedUserIds = await resolveManagerTaskAssigneeIds(
          req,
          req.body.assignedUserIds,
        );
      } catch (error) {
        return sendValidationError(
          res,
          error instanceof Error
            ? error.message
            : "مسئولان انتخاب‌شده برای وظیفه معتبر نیستند.",
        );
      }
    }
  }

  if ("status" in req.body) {
    const normalizedStatus = normalizeEnumValue(
      req.body.status,
      ProjectTaskStatus,
    );

    if (!normalizedStatus) {
      return sendValidationError(res, "وضعیت وظیفه معتبر نیست.");
    }

    update.status = normalizedStatus;
    update.statusLabel = PROJECT_TASK_STATUS_LABELS[normalizedStatus];
    update.completedAt =
      normalizedStatus === ProjectTaskStatus.DONE ? new Date() : null;
  }

  const nextStartDate =
    update.startDate instanceof Date ? update.startDate : task.startDate;

  const nextDueDate =
    "dueDate" in update ? (update.dueDate as Date | null) : task.dueDate;

  if (nextStartDate && nextDueDate && nextDueDate < nextStartDate) {
    return sendValidationError(
      res,
      "موعد انجام وظیفه نمی‌تواند قبل از تاریخ شروع باشد.",
    );
  }

  const updatedTask = await populateTaskQuery(
    ProjectTask.findOneAndUpdate({ _id: taskId, projectId: id }, update, {
      new: true,
      runValidators: true,
    }),
  );

  return sendSuccess(res, updatedTask, "وظیفه با موفقیت ویرایش شد.");
};

export const deleteProjectTask = async (req: AuthRequest, res: Response) => {
  if (!isManager(req)) return sendForbidden(res);

  const { id, taskId } = req.params;

  if (!isValidObjectId(id) || !isValidObjectId(taskId)) {
    return sendValidationError(res, "شناسه پروژه یا وظیفه معتبر نیست.");
  }

  const task = await ProjectTask.findOneAndDelete({
    _id: taskId,
    projectId: id,
  });

  if (!task) {
    return sendNotFound(res, "وظیفه پیدا نشد.");
  }

  return sendSuccess(res, null, "وظیفه با موفقیت حذف شد.");
};

export const listProjectNotes = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    return sendValidationError(res, "شناسه پروژه معتبر نیست.");
  }

  const project = await Project.findById(id);

  if (!project) {
    return sendNotFound(res, "پروژه پیدا نشد.");
  }

  if (!employeeHasProjectAccess(req, project)) {
    return sendForbidden(res);
  }

  const notes = await populateNoteQuery(
    ProjectProgressNote.find({ projectId: id }).sort({ createdAt: -1 }),
  );

  const notesWithFiles = await attachFilesToNotes(notes);

  return sendSuccess(
    res,
    notesWithFiles,
    "یادداشت‌های پروژه با موفقیت دریافت شد.",
  );
};

export const createProjectNote = async (req: AuthRequest, res: Response) => {
  if (!isManager(req)) return sendForbidden(res);

  const { id } = req.params;
  const authUserId = getAuthUserId(req);

  if (!isValidObjectId(id)) {
    return sendValidationError(res, "شناسه پروژه معتبر نیست.");
  }

  if (!isValidObjectId(authUserId)) {
    return sendValidationError(res, "شناسه کاربر جاری معتبر نیست.");
  }

  const project = await Project.findById(id);

  if (!project) {
    return sendNotFound(res, "پروژه پیدا نشد.");
  }

  const { note, progressPercent, statusSnapshot, authorId } = req.body;
  const rawNote = typeof note === "string" ? note.trim() : "";
  const hasAudioFile = isTranscribableAudioFile(req.file || null);
  const transcriptionFields = req.file
    ? await buildTranscriptionFields(req.file)
    : null;

  const finalNote =
    rawNote ||
    (transcriptionFields?.transcriptionStatus === "completed"
      ? transcriptionFields.transcriptionText.trim()
      : "");

  if (!finalNote) {
    return sendValidationError(
      res,
      hasAudioFile
        ? "متن گزارش خالی است و تبدیل فایل صوتی به متن هم انجام نشد."
        : "متن گزارش کار الزامی است.",
      transcriptionFields?.transcriptionError
        ? { transcriptionError: transcriptionFields.transcriptionError }
        : undefined,
    );
  }

  let noteAuthorId: Types.ObjectId;

  try {
    noteAuthorId = await resolveProjectNoteAuthorId(req, project, authorId);
  } catch (error) {
    return sendValidationError(
      res,
      error instanceof Error
        ? error.message
        : "مدیر انجام‌دهنده گزارش معتبر نیست.",
    );
  }

  const parsedProgressPercent =
    progressPercent === undefined ||
    progressPercent === null ||
    progressPercent === ""
      ? null
      : Number(progressPercent);

  if (
    parsedProgressPercent !== null &&
    (Number.isNaN(parsedProgressPercent) ||
      parsedProgressPercent < 0 ||
      parsedProgressPercent > 100)
  ) {
    return sendValidationError(res, "درصد پیشرفت باید عددی بین ۰ تا ۱۰۰ باشد.");
  }

  const normalizedSnapshot =
    normalizeEnumValue(statusSnapshot, ProjectStatus) || project.status;

  const noteDocument = await ProjectProgressNote.create({
    projectId: toObjectId(id),
    authorId: noteAuthorId,
    registeredById: toObjectId(authUserId),
    note: finalNote,
    progressPercent: parsedProgressPercent,
    statusSnapshot: normalizedSnapshot,
    language: "fa",
    direction: "rtl",
    source: "web",
  });

  if (req.file) {
    await ProjectFile.create({
      projectId: toObjectId(id),
      progressNoteId: noteDocument._id,
      uploadedBy: toObjectId(authUserId),
      fileName: req.file.filename,
      originalName: req.file.originalname,
      fileUrl: buildProjectUploadFileUrl(req.file.filename),
      fileType: req.file.mimetype,
      fileSize: req.file.size,
      category: ProjectFileCategory.REPORTS,
      categoryLabel: PROJECT_FILE_CATEGORY_LABELS[ProjectFileCategory.REPORTS],
      ...(transcriptionFields || {}),
      language: "fa",
      direction: "rtl",
      source: "web",
    });
  }

  const populatedNote = await populateNoteQuery(
    ProjectProgressNote.findById(noteDocument._id),
  );

  const [noteWithFiles] = await attachFilesToNotes(
    populatedNote ? [populatedNote] : [],
  );

  return sendSuccess(res, noteWithFiles, "گزارش کار با موفقیت ثبت شد.", 201);
};

export const listProjectFiles = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    return sendValidationError(res, "شناسه پروژه معتبر نیست.");
  }

  const project = await Project.findById(id);

  if (!project) {
    return sendNotFound(res, "پروژه پیدا نشد.");
  }

  if (!employeeHasProjectAccess(req, project)) {
    return sendForbidden(res);
  }

  const standaloneOnly =
    String(req.query.standaloneOnly || "").toLowerCase() === "true";

  const filter: Record<string, unknown> = { projectId: id };

  if (standaloneOnly) {
    filter.$or = [
      { progressNoteId: null },
      { progressNoteId: { $exists: false } },
    ];
  }

  const files = await populateFileQuery(
    ProjectFile.find(filter).sort({ createdAt: -1 }),
  );

  return sendSuccess(res, files, "فایل‌های پروژه با موفقیت دریافت شد.");
};

export const uploadProjectFile = async (req: AuthRequest, res: Response) => {
  if (!isManager(req)) return sendForbidden(res);

  const { id } = req.params;
  const authUserId = getAuthUserId(req);

  if (!isValidObjectId(id)) {
    return sendValidationError(res, "شناسه پروژه معتبر نیست.");
  }

  if (!isValidObjectId(authUserId)) {
    return sendValidationError(res, "شناسه کاربر جاری معتبر نیست.");
  }

  if (!req.file) {
    return sendValidationError(res, "فایل الزامی است.");
  }

  const project = await Project.findById(id);

  if (!project) {
    return sendNotFound(res, "پروژه پیدا نشد.");
  }

  const normalizedCategory =
    normalizeEnumValue(req.body.category, ProjectFileCategory) ||
    ProjectFileCategory.OTHER;

  const rawProgressNoteId =
    typeof req.body.progressNoteId === "string"
      ? req.body.progressNoteId.trim()
      : "";

  let progressNoteObjectId: Types.ObjectId | null = null;

  if (rawProgressNoteId) {
    if (!isValidObjectId(rawProgressNoteId)) {
      return sendValidationError(
        res,
        "گزارش انتخاب‌شده برای این پروژه معتبر نیست.",
      );
    }

    const progressNote = await ProjectProgressNote.findOne({
      _id: rawProgressNoteId,
      projectId: id,
    });

    if (!progressNote) {
      return sendValidationError(
        res,
        "گزارش انتخاب‌شده برای این پروژه معتبر نیست.",
      );
    }

    progressNoteObjectId = toObjectId(rawProgressNoteId);
  }

  const transcriptionFields = await buildTranscriptionFields(req.file);

  const file = await ProjectFile.create({
    projectId: toObjectId(id),
    progressNoteId: progressNoteObjectId,
    uploadedBy: toObjectId(authUserId),
    fileName: req.file.filename,
    originalName: req.file.originalname,
    fileUrl: buildProjectUploadFileUrl(req.file.filename),
    fileType: req.file.mimetype,
    fileSize: req.file.size,
    category: normalizedCategory,
    categoryLabel: PROJECT_FILE_CATEGORY_LABELS[normalizedCategory],
    ...transcriptionFields,
    language: "fa",
    direction: "rtl",
  });

  const populatedFile = await populateFileQuery(ProjectFile.findById(file._id));

  return sendSuccess(res, populatedFile, "فایل پروژه با موفقیت آپلود شد.", 201);
};

export const deleteProjectFile = async (req: AuthRequest, res: Response) => {
  if (!isManager(req)) return sendForbidden(res);

  const { id, fileId } = req.params;

  if (!isValidObjectId(id) || !isValidObjectId(fileId)) {
    return sendValidationError(res, "شناسه پروژه یا فایل معتبر نیست.");
  }

  const file = await ProjectFile.findOneAndDelete({
    _id: fileId,
    projectId: id,
  });

  if (!file) {
    return sendNotFound(res, "فایل پیدا نشد.");
  }

  return sendSuccess(res, null, "فایل با موفقیت حذف شد.");
};

export const getCalendarEvents = async (req: AuthRequest, res: Response) => {
  const { projectId, assignedUserId, status, priority } = req.query;

  const projectFilter: Record<string, unknown> = {
    ...getEmployeeProjectFilter(req),
  };

  const taskFilter: Record<string, unknown> = {};
  const phaseFilter: Record<string, unknown> = {};

  if (getAppRole(req) === "employee") {
    const authUserId = getAuthUserId(req);

    if (isValidObjectId(authUserId)) {
      taskFilter.assignedUserIds = toObjectId(authUserId);
      phaseFilter.assignedUserIds = toObjectId(authUserId);
    }
  }

  if (typeof projectId === "string" && projectId.trim()) {
    if (!isValidObjectId(projectId)) {
      return sendValidationError(res, "شناسه پروژه معتبر نیست.");
    }

    projectFilter._id = toObjectId(projectId);
    taskFilter.projectId = toObjectId(projectId);
    phaseFilter.projectId = toObjectId(projectId);
  }

  if (typeof assignedUserId === "string" && assignedUserId.trim()) {
    if (!isValidObjectId(assignedUserId)) {
      return sendValidationError(res, "شناسه کاربر معتبر نیست.");
    }

    projectFilter.assignedUserIds = toObjectId(assignedUserId);
    taskFilter.assignedUserIds = toObjectId(assignedUserId);
    phaseFilter.assignedUserIds = toObjectId(assignedUserId);
  }

  if (typeof priority === "string" && priority.trim()) {
    const normalizedPriority = normalizeEnumValue(priority, ProjectPriority);

    if (!normalizedPriority) {
      return sendValidationError(res, "اولویت معتبر نیست.");
    }

    projectFilter.priority = normalizedPriority;
    taskFilter.priority = normalizedPriority;
  }

  if (typeof status === "string" && status.trim()) {
    const normalizedProjectStatus = normalizeEnumValue(status, ProjectStatus);
    const normalizedTaskStatus = normalizeEnumValue(status, ProjectTaskStatus);

    if (normalizedProjectStatus) projectFilter.status = normalizedProjectStatus;
    if (normalizedTaskStatus) taskFilter.status = normalizedTaskStatus;
  }

  const [projects, tasks, phases] = await Promise.all([
    Project.find(projectFilter)
      .populate("assignedUserIds", USER_SELECT)
      .populate("projectMembers.userId", USER_SELECT)
      .populate(
        "projectMembers.roleId",
        "title description isActive sortOrder",
      ),
    ProjectTask.find(taskFilter).populate("assignedUserIds", USER_SELECT),
    ProjectPhase.find(phaseFilter).populate("assignedUserIds", USER_SELECT),
  ]);

  const events = [
    ...projects.flatMap((project: any) => {
      const currentProjectId = project._id.toString();

      const projectEvents = [
        {
          id: `${ProjectCalendarEventType.PROJECT_START}-${currentProjectId}`,
          title: `شروع پروژه: ${project.title}`,
          type: ProjectCalendarEventType.PROJECT_START,
          projectId: currentProjectId,
          start: project.startDate,
          status: project.status,
          priority: project.priority,
          assignedUserIds: project.assignedUserIds,
          projectMembers: project.projectMembers || [],
        },
      ];

      if (project.dueDate) {
        projectEvents.push({
          id: `${ProjectCalendarEventType.PROJECT_DUE}-${currentProjectId}`,
          title: `موعد تحویل پروژه: ${project.title}`,
          type: ProjectCalendarEventType.PROJECT_DUE,
          projectId: currentProjectId,
          start: project.dueDate,
          status: project.status,
          priority: project.priority,
          assignedUserIds: project.assignedUserIds,
          projectMembers: project.projectMembers || [],
        });
      }

      return projectEvents;
    }),

    ...phases.flatMap((phase: any) => {
      const currentPhaseId = phase._id.toString();
      const phaseEvents = [
        {
          id: `${ProjectCalendarEventType.PHASE_START}-${currentPhaseId}`,
          title: `شروع فاز: ${phase.title}`,
          type: ProjectCalendarEventType.PHASE_START,
          projectId: phase.projectId.toString(),
          phaseId: currentPhaseId,
          start: phase.startDate,
          assignedUserIds: phase.assignedUserIds,
        },
      ];

      if (phase.endDate) {
        phaseEvents.push({
          id: `${ProjectCalendarEventType.PHASE_END}-${currentPhaseId}`,
          title: `پایان فاز: ${phase.title}`,
          type: ProjectCalendarEventType.PHASE_END,
          projectId: phase.projectId.toString(),
          phaseId: currentPhaseId,
          start: phase.endDate,
          assignedUserIds: phase.assignedUserIds,
        });
      }

      return phaseEvents;
    }),

    ...tasks.flatMap((task: any) => {
      const currentTaskId = task._id.toString();
      const taskEvents = [];

      if (task.startDate) {
        taskEvents.push({
          id: `${ProjectCalendarEventType.TASK_START}-${currentTaskId}`,
          title: `شروع وظیفه: ${task.title}`,
          type: ProjectCalendarEventType.TASK_START,
          projectId: task.projectId.toString(),
          taskId: currentTaskId,
          start: task.startDate,
          status: task.status,
          priority: task.priority,
          assignedUserIds: task.assignedUserIds,
        });
      }

      if (task.dueDate) {
        taskEvents.push({
          id: `${ProjectCalendarEventType.TASK_DUE}-${currentTaskId}`,
          title: `موعد انجام وظیفه: ${task.title}`,
          type: ProjectCalendarEventType.TASK_DUE,
          projectId: task.projectId.toString(),
          taskId: currentTaskId,
          start: task.dueDate,
          status: task.status,
          priority: task.priority,
          assignedUserIds: task.assignedUserIds,
        });
      }

      return taskEvents;
    }),
  ];

  return sendSuccess(res, events, "رویدادهای تقویم با موفقیت دریافت شد.");
};

export const archiveProject = deleteProject;
export const archiveProjectTask = deleteProjectTask;
export const createProjectFile = uploadProjectFile;
export const listProjectCalendarEvents = getCalendarEvents;
