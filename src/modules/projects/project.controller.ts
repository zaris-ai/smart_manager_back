import { Request, Response } from 'express';
import mongoose, { Types } from 'mongoose';
import User, { UserRole } from '../users/user.model';
import {
  Project,
  ProjectCalendarEventType,
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
} from './project.model';

type AppRole = 'manager' | 'employee';

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

const USER_SELECT =
  'firstName lastName fullName username email role roleLabel isActive';

const getAuthUserId = (req: AuthRequest): string => {
  return String(req.user?.id || req.user?._id || req.user?.userId || '');
};

const getAppRole = (req: AuthRequest): AppRole => {
  const rawRole = String(req.user?.role || '').toLowerCase();

  /**
   * Legacy compatibility:
   * If your old default user still has role "admin", it is treated as manager.
   * New business model remains only manager/employee.
   */
  if (rawRole === 'manager' || rawRole === 'admin') return 'manager';

  return 'employee';
};

const isManager = (req: AuthRequest): boolean => {
  return getAppRole(req) === 'manager';
};

const isValidObjectId = (value?: string): boolean => {
  return Boolean(value && mongoose.Types.ObjectId.isValid(value));
};

const toObjectId = (value: string): Types.ObjectId => {
  return new mongoose.Types.ObjectId(value);
};

const sendValidationError = (res: Response, message: string, details?: unknown) => {
  return res.status(400).json({
    success: false,
    message,
    code: 'VALIDATION_ERROR',
    details,
  });
};

const sendForbidden = (res: Response) => {
  return res.status(403).json({
    success: false,
    message: 'شما دسترسی لازم برای این عملیات را ندارید.',
    code: 'FORBIDDEN',
  });
};

const sendNotFound = (res: Response, message: string) => {
  return res.status(404).json({
    success: false,
    message,
    code: 'NOT_FOUND',
  });
};

const sendSuccess = <T>(
  res: Response,
  data: T,
  message = 'عملیات با موفقیت انجام شد.',
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
  if (!value || typeof value !== 'string') return null;

  const rawValue = value.trim();
  const lowerValue = rawValue.toLowerCase();

  const enumValues = Object.values(enumObject);

  const matchedValue = enumValues.find((enumValue) => {
    return enumValue.toLowerCase() === lowerValue;
  });

  return (matchedValue as T[keyof T]) || null;
};

const normalizeOptionalDate = (value: unknown): Date | null => {
  if (!value || typeof value !== 'string') return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return null;

  return date;
};

const normalizeRequiredDate = (value: unknown): Date | null => {
  if (!value || typeof value !== 'string') return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return null;

  return date;
};

const normalizeObjectIdArray = (value: unknown): Types.ObjectId[] => {
  if (!Array.isArray(value)) return [];

  const uniqueIds = Array.from(
    new Set(
      value
        .filter((item) => typeof item === 'string' && isValidObjectId(item))
        .map((item) => String(item)),
    ),
  );

  return uniqueIds.map(toObjectId);
};

const populateProjectQuery = (query: any) => {
  return query
    .populate('ownerId', USER_SELECT)
    .populate('assignedUserIds', USER_SELECT)
    .populate('createdBy', USER_SELECT)
    .populate('updatedBy', USER_SELECT);
};

const populateTaskQuery = (query: any) => {
  return query
    .populate('assignedUserIds', USER_SELECT)
    .populate('createdBy', USER_SELECT)
    .populate('updatedBy', USER_SELECT);
};

const populateNoteQuery = (query: any) => {
  return query
    .populate('authorId', USER_SELECT)
    .populate('registeredById', USER_SELECT);
};

const populateFileQuery = (query: any) => {
  return query
    .populate('uploadedBy', USER_SELECT)
    .populate('progressNoteId', 'note progressPercent statusSnapshot source createdAt');
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

  const groupedFiles = (files as any[]).reduce((acc: Record<string, any[]>, file: any) => {
    const fileObject = serializeDocument(file);
    const progressNoteId = fileObject.progressNoteId;
    const noteId =
      typeof progressNoteId === 'object' && progressNoteId?._id
        ? String(progressNoteId._id)
        : String(progressNoteId || '');

    if (!noteId) return acc;

    acc[noteId] = acc[noteId] || [];
    acc[noteId].push(fileObject);

    return acc;
  }, {} as Record<string, any[]>);

  return noteObjects.map((note) => {
    const noteFiles = groupedFiles[String(note._id)] || [];

    return {
      ...note,
      files: noteFiles,
      attachmentCount: noteFiles.length,
    };
  });
};

const getEmployeeProjectFilter = (req: AuthRequest): Record<string, unknown> => {
  if (getAppRole(req) !== 'employee') return {};

  const authUserId = getAuthUserId(req);

  if (!isValidObjectId(authUserId)) return { _id: null };

  return {
    assignedUserIds: toObjectId(authUserId),
  };
};

const employeeHasProjectAccess = (req: AuthRequest, project: any): boolean => {
  if (getAppRole(req) === 'manager') return true;

  const authUserId = getAuthUserId(req);

  if (!isValidObjectId(authUserId)) return false;

  return project.assignedUserIds?.some((userId: Types.ObjectId) => {
    return String(userId) === authUserId;
  });
};

const employeeHasTaskAccess = (req: AuthRequest, task: any): boolean => {
  if (getAppRole(req) === 'manager') return true;

  const authUserId = getAuthUserId(req);

  if (!isValidObjectId(authUserId)) return false;

  return task.assignedUserIds?.some((userId: Types.ObjectId) => {
    return String(userId) === authUserId;
  });
};


const resolveProjectNoteAuthorId = async (
  req: AuthRequest,
  _project: any,
  requestedAuthorId: unknown,
): Promise<Types.ObjectId> => {
  const authUserId = getAuthUserId(req);

  if (!isValidObjectId(authUserId)) {
    throw new Error('شناسه کاربر جاری معتبر نیست.');
  }

  const targetAuthorId =
    typeof requestedAuthorId === 'string' && requestedAuthorId.trim()
      ? requestedAuthorId.trim()
      : authUserId;

  if (!isValidObjectId(targetAuthorId)) {
    throw new Error('شناسه مدیر انجام‌دهنده معتبر نیست.');
  }

  const managerUser = await User.findOne({
    _id: targetAuthorId,
    role: UserRole.MANAGER,
    isActive: true,
  }).select('_id role isActive');

  if (!managerUser) {
    throw new Error('مدیر انتخاب‌شده معتبر یا فعال نیست.');
  }

  return managerUser._id as Types.ObjectId;
};

const resolveManagerTaskAssigneeIds = async (
  req: AuthRequest,
  requestedAssignedUserIds: unknown,
): Promise<Types.ObjectId[]> => {
  const authUserId = getAuthUserId(req);

  if (!isValidObjectId(authUserId)) {
    throw new Error('شناسه کاربر جاری معتبر نیست.');
  }

  const rawIds = Array.isArray(requestedAssignedUserIds)
    ? requestedAssignedUserIds
    : [];

  const uniqueIds = Array.from(
    new Set(
      rawIds
        .filter((item) => typeof item === 'string' && isValidObjectId(item))
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
  }).select('_id role isActive');

  if (managers.length !== uniqueIds.length) {
    throw new Error('همه مسئولان انتخاب‌شده باید مدیر فعال باشند.');
  }

  return managers.map((manager) => manager._id as Types.ObjectId);
};

export const listProjects = async (req: AuthRequest, res: Response) => {
  const {
    page = '1',
    limit = '20',
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

  if (typeof search === 'string' && search.trim()) {
    filter.$or = [
      { title: { $regex: search.trim(), $options: 'i' } },
      { description: { $regex: search.trim(), $options: 'i' } },
    ];
  }

  if (typeof status === 'string' && status.trim()) {
    const normalizedStatus = normalizeEnumValue(status, ProjectStatus);

    if (!normalizedStatus) {
      return sendValidationError(res, 'وضعیت پروژه معتبر نیست.');
    }

    filter.status = normalizedStatus;
  }

  if (typeof priority === 'string' && priority.trim()) {
    const normalizedPriority = normalizeEnumValue(priority, ProjectPriority);

    if (!normalizedPriority) {
      return sendValidationError(res, 'اولویت پروژه معتبر نیست.');
    }

    filter.priority = normalizedPriority;
  }

  if (typeof assignedUserId === 'string' && assignedUserId.trim()) {
    if (!isValidObjectId(assignedUserId)) {
      return sendValidationError(res, 'شناسه کاربر معتبر نیست.');
    }

    filter.assignedUserIds = toObjectId(assignedUserId);
  }

  const [items, total] = await Promise.all([
    populateProjectQuery(
      Project.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNumber),
    ),
    Project.countDocuments(filter),
  ]);

  return res.json({
    success: true,
    message: 'فهرست پروژه‌ها با موفقیت دریافت شد.',
    data: items,
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
    return sendValidationError(res, 'شناسه کاربر جاری معتبر نیست.');
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
  } = req.body;

  if (!title || typeof title !== 'string' || !title.trim()) {
    return sendValidationError(res, 'عنوان پروژه الزامی است.');
  }

  if (!ownerId || typeof ownerId !== 'string' || !isValidObjectId(ownerId)) {
    return sendValidationError(res, 'مسئول پروژه معتبر نیست.');
  }

  const parsedStartDate = normalizeRequiredDate(startDate);

  if (!parsedStartDate) {
    return sendValidationError(res, 'تاریخ شروع پروژه معتبر نیست.');
  }

  const parsedDueDate = normalizeOptionalDate(dueDate);

  if (parsedDueDate && parsedDueDate < parsedStartDate) {
    return sendValidationError(
      res,
      'موعد تحویل نمی‌تواند قبل از تاریخ شروع باشد.',
    );
  }

  const normalizedStatus =
    normalizeEnumValue(status, ProjectStatus) || ProjectStatus.PLANNING;

  const normalizedPriority =
    normalizeEnumValue(priority, ProjectPriority) || ProjectPriority.MEDIUM;

  const normalizedOwnerId = toObjectId(ownerId);
  const normalizedAssignedUserIds = normalizeObjectIdArray(assignedUserIds);

  const finalAssignedUserIds = Array.from(
    new Set([
      normalizedOwnerId.toString(),
      ...normalizedAssignedUserIds.map((item) => item.toString()),
    ]),
  ).map(toObjectId);

  const project = await Project.create({
    title: title.trim(),
    description: typeof description === 'string' ? description.trim() : '',
    status: normalizedStatus,
    statusLabel: PROJECT_STATUS_LABELS[normalizedStatus],
    priority: normalizedPriority,
    priorityLabel: PROJECT_PRIORITY_LABELS[normalizedPriority],
    startDate: parsedStartDate,
    dueDate: parsedDueDate,
    ownerId: normalizedOwnerId,
    assignedUserIds: finalAssignedUserIds,
    language: 'fa',
    direction: 'rtl',
    createdBy: toObjectId(authUserId),
    updatedBy: toObjectId(authUserId),
  });

  const populatedProject = await populateProjectQuery(Project.findById(project._id));

  return sendSuccess(res, populatedProject, 'پروژه با موفقیت ایجاد شد.', 201);
};

export const getProjectById = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    return sendValidationError(res, 'شناسه پروژه معتبر نیست.');
  }

  const project = await populateProjectQuery(Project.findById(id));

  if (!project) {
    return sendNotFound(res, 'پروژه پیدا نشد.');
  }

  if (!employeeHasProjectAccess(req, project)) {
    return sendForbidden(res);
  }

  return sendSuccess(res, project, 'اطلاعات پروژه با موفقیت دریافت شد.');
};

export const updateProject = async (req: AuthRequest, res: Response) => {
  if (!isManager(req)) return sendForbidden(res);

  const { id } = req.params;
  const authUserId = getAuthUserId(req);

  if (!isValidObjectId(id)) {
    return sendValidationError(res, 'شناسه پروژه معتبر نیست.');
  }

  if (!isValidObjectId(authUserId)) {
    return sendValidationError(res, 'شناسه کاربر جاری معتبر نیست.');
  }

  const project = await Project.findById(id);

  if (!project) {
    return sendNotFound(res, 'پروژه پیدا نشد.');
  }

  const update: Record<string, unknown> = {
    updatedBy: toObjectId(authUserId),
  };

  if ('title' in req.body) {
    if (!req.body.title || typeof req.body.title !== 'string') {
      return sendValidationError(res, 'عنوان پروژه معتبر نیست.');
    }

    update.title = req.body.title.trim();
  }

  if ('description' in req.body) {
    update.description =
      typeof req.body.description === 'string' ? req.body.description.trim() : '';
  }

  if ('status' in req.body) {
    const normalizedStatus = normalizeEnumValue(req.body.status, ProjectStatus);

    if (!normalizedStatus) {
      return sendValidationError(res, 'وضعیت پروژه معتبر نیست.');
    }

    update.status = normalizedStatus;
    update.statusLabel = PROJECT_STATUS_LABELS[normalizedStatus];
  }

  if ('priority' in req.body) {
    const normalizedPriority = normalizeEnumValue(
      req.body.priority,
      ProjectPriority,
    );

    if (!normalizedPriority) {
      return sendValidationError(res, 'اولویت پروژه معتبر نیست.');
    }

    update.priority = normalizedPriority;
    update.priorityLabel = PROJECT_PRIORITY_LABELS[normalizedPriority];
  }

  if ('startDate' in req.body) {
    const parsedStartDate = normalizeRequiredDate(req.body.startDate);

    if (!parsedStartDate) {
      return sendValidationError(res, 'تاریخ شروع پروژه معتبر نیست.');
    }

    update.startDate = parsedStartDate;
  }

  if ('dueDate' in req.body) {
    update.dueDate = normalizeOptionalDate(req.body.dueDate);
  }

  if ('ownerId' in req.body) {
    if (
      !req.body.ownerId ||
      typeof req.body.ownerId !== 'string' ||
      !isValidObjectId(req.body.ownerId)
    ) {
      return sendValidationError(res, 'مسئول پروژه معتبر نیست.');
    }

    update.ownerId = toObjectId(req.body.ownerId);
  }

  if ('assignedUserIds' in req.body) {
    const assignedIds = normalizeObjectIdArray(req.body.assignedUserIds);

    const ownerId =
      update.ownerId instanceof Types.ObjectId ? update.ownerId : project.ownerId;

    update.assignedUserIds = Array.from(
      new Set([
        ownerId.toString(),
        ...assignedIds.map((item) => item.toString()),
      ]),
    ).map(toObjectId);
  }

  const nextStartDate =
    update.startDate instanceof Date ? update.startDate : project.startDate;

  const nextDueDate =
    'dueDate' in update ? (update.dueDate as Date | null) : project.dueDate;

  if (nextDueDate && nextStartDate && nextDueDate < nextStartDate) {
    return sendValidationError(
      res,
      'موعد تحویل نمی‌تواند قبل از تاریخ شروع باشد.',
    );
  }

  const updatedProject = await populateProjectQuery(
    Project.findByIdAndUpdate(id, update, {
      new: true,
      runValidators: true,
    }),
  );

  return sendSuccess(res, updatedProject, 'پروژه با موفقیت ویرایش شد.');
};

export const deleteProject = async (req: AuthRequest, res: Response) => {
  if (!isManager(req)) return sendForbidden(res);

  const { id } = req.params;

  if (!isValidObjectId(id)) {
    return sendValidationError(res, 'شناسه پروژه معتبر نیست.');
  }

  const project = await Project.findByIdAndDelete(id);

  if (!project) {
    return sendNotFound(res, 'پروژه پیدا نشد.');
  }

  await Promise.all([
    ProjectTask.deleteMany({ projectId: project._id }),
    ProjectProgressNote.deleteMany({ projectId: project._id }),
    ProjectFile.deleteMany({ projectId: project._id }),
  ]);

  return sendSuccess(res, null, 'پروژه با موفقیت حذف شد.');
};

export const assignUsersToProject = async (req: AuthRequest, res: Response) => {
  if (!isManager(req)) return sendForbidden(res);

  const { id } = req.params;
  const { userIds } = req.body;
  const authUserId = getAuthUserId(req);

  if (!isValidObjectId(id)) {
    return sendValidationError(res, 'شناسه پروژه معتبر نیست.');
  }

  if (!isValidObjectId(authUserId)) {
    return sendValidationError(res, 'شناسه کاربر جاری معتبر نیست.');
  }

  const normalizedUserIds = normalizeObjectIdArray(userIds);

  const project = await populateProjectQuery(
    Project.findByIdAndUpdate(
      id,
      {
        $addToSet: {
          assignedUserIds: { $each: normalizedUserIds },
        },
        $set: {
          updatedBy: toObjectId(authUserId),
        },
      },
      {
        new: true,
        runValidators: true,
      },
    ),
  );

  if (!project) {
    return sendNotFound(res, 'پروژه پیدا نشد.');
  }

  return sendSuccess(res, project, 'کاربران با موفقیت به پروژه اضافه شدند.');
};

export const removeUserFromProject = async (req: AuthRequest, res: Response) => {
  if (!isManager(req)) return sendForbidden(res);

  const { id, userId } = req.params;
  const authUserId = getAuthUserId(req);

  if (!isValidObjectId(id) || !isValidObjectId(userId)) {
    return sendValidationError(res, 'شناسه پروژه یا کاربر معتبر نیست.');
  }

  if (!isValidObjectId(authUserId)) {
    return sendValidationError(res, 'شناسه کاربر جاری معتبر نیست.');
  }

  const project = await Project.findById(id);

  if (!project) {
    return sendNotFound(res, 'پروژه پیدا نشد.');
  }

  if (project.ownerId.toString() === userId) {
    return sendValidationError(res, 'مسئول پروژه را نمی‌توان از اعضا حذف کرد.');
  }

  const updatedProject = await populateProjectQuery(
    Project.findByIdAndUpdate(
      id,
      {
        $pull: { assignedUserIds: toObjectId(userId) },
        $set: { updatedBy: toObjectId(authUserId) },
      },
      {
        new: true,
        runValidators: true,
      },
    ),
  );

  return sendSuccess(res, updatedProject, 'کاربر با موفقیت از پروژه حذف شد.');
};

export const listProjectTasks = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    return sendValidationError(res, 'شناسه پروژه معتبر نیست.');
  }

  const project = await Project.findById(id);

  if (!project) {
    return sendNotFound(res, 'پروژه پیدا نشد.');
  }

  if (!employeeHasProjectAccess(req, project)) {
    return sendForbidden(res);
  }

  const filter: Record<string, unknown> = { projectId: id };

  if (getAppRole(req) === 'employee') {
    filter.assignedUserIds = toObjectId(getAuthUserId(req));
  }

  const tasks = await populateTaskQuery(
    ProjectTask.find(filter).sort({ dueDate: 1, createdAt: -1 }),
  );

  return sendSuccess(res, tasks, 'وظایف پروژه با موفقیت دریافت شد.');
};

export const createProjectTask = async (req: AuthRequest, res: Response) => {
  if (!isManager(req)) return sendForbidden(res);

  const { id } = req.params;
  const authUserId = getAuthUserId(req);

  if (!isValidObjectId(id)) {
    return sendValidationError(res, 'شناسه پروژه معتبر نیست.');
  }

  if (!isValidObjectId(authUserId)) {
    return sendValidationError(res, 'شناسه کاربر جاری معتبر نیست.');
  }

  const project = await Project.findById(id);

  if (!project) {
    return sendNotFound(res, 'پروژه پیدا نشد.');
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

  if (!title || typeof title !== 'string' || !title.trim()) {
    return sendValidationError(res, 'عنوان وظیفه الزامی است.');
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
        : 'مسئولان انتخاب‌شده برای وظیفه معتبر نیستند.',
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
      'موعد انجام وظیفه نمی‌تواند قبل از تاریخ شروع باشد.',
    );
  }

  const task = await ProjectTask.create({
    projectId: toObjectId(id),
    title: title.trim(),
    description: typeof description === 'string' ? description.trim() : '',
    assignedUserIds: resolvedAssignedUserIds,
    status: normalizedStatus,
    statusLabel: PROJECT_TASK_STATUS_LABELS[normalizedStatus],
    priority: normalizedPriority,
    priorityLabel: PROJECT_PRIORITY_LABELS[normalizedPriority],
    startDate: parsedStartDate,
    dueDate: parsedDueDate,
    completedAt: normalizedStatus === ProjectTaskStatus.DONE ? new Date() : null,
    language: 'fa',
    direction: 'rtl',
    createdBy: toObjectId(authUserId),
    updatedBy: toObjectId(authUserId),
  });

  const populatedTask = await populateTaskQuery(ProjectTask.findById(task._id));

  return sendSuccess(res, populatedTask, 'وظیفه با موفقیت ایجاد شد.', 201);
};

export const updateProjectTask = async (req: AuthRequest, res: Response) => {
  const { id, taskId } = req.params;
  const authUserId = getAuthUserId(req);

  if (!isValidObjectId(id) || !isValidObjectId(taskId)) {
    return sendValidationError(res, 'شناسه پروژه یا وظیفه معتبر نیست.');
  }

  if (!isValidObjectId(authUserId)) {
    return sendValidationError(res, 'شناسه کاربر جاری معتبر نیست.');
  }

  const task = await ProjectTask.findOne({ _id: taskId, projectId: id });

  if (!task) {
    return sendNotFound(res, 'وظیفه پیدا نشد.');
  }

  if (!employeeHasTaskAccess(req, task)) {
    return sendForbidden(res);
  }

  const update: Record<string, unknown> = {
    updatedBy: toObjectId(authUserId),
  };

  if (isManager(req)) {
    if ('title' in req.body) {
      if (!req.body.title || typeof req.body.title !== 'string') {
        return sendValidationError(res, 'عنوان وظیفه معتبر نیست.');
      }

      update.title = req.body.title.trim();
    }

    if ('description' in req.body) {
      update.description =
        typeof req.body.description === 'string'
          ? req.body.description.trim()
          : '';
    }

    if ('priority' in req.body) {
      const normalizedPriority = normalizeEnumValue(
        req.body.priority,
        ProjectPriority,
      );

      if (!normalizedPriority) {
        return sendValidationError(res, 'اولویت وظیفه معتبر نیست.');
      }

      update.priority = normalizedPriority;
      update.priorityLabel = PROJECT_PRIORITY_LABELS[normalizedPriority];
    }

    if ('startDate' in req.body) {
      update.startDate = normalizeOptionalDate(req.body.startDate);
    }

    if ('dueDate' in req.body) {
      update.dueDate = normalizeOptionalDate(req.body.dueDate);
    }

    if ('assignedUserIds' in req.body) {
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
            : 'مسئولان انتخاب‌شده برای وظیفه معتبر نیستند.',
        );
      }
    }
  }

  if ('status' in req.body) {
    const normalizedStatus = normalizeEnumValue(req.body.status, ProjectTaskStatus);

    if (!normalizedStatus) {
      return sendValidationError(res, 'وضعیت وظیفه معتبر نیست.');
    }

    update.status = normalizedStatus;
    update.statusLabel = PROJECT_TASK_STATUS_LABELS[normalizedStatus];
    update.completedAt =
      normalizedStatus === ProjectTaskStatus.DONE ? new Date() : null;
  }

  const nextStartDate =
    update.startDate instanceof Date ? update.startDate : task.startDate;

  const nextDueDate =
    'dueDate' in update ? (update.dueDate as Date | null) : task.dueDate;

  if (nextStartDate && nextDueDate && nextDueDate < nextStartDate) {
    return sendValidationError(
      res,
      'موعد انجام وظیفه نمی‌تواند قبل از تاریخ شروع باشد.',
    );
  }

  const updatedTask = await populateTaskQuery(
    ProjectTask.findOneAndUpdate(
      { _id: taskId, projectId: id },
      update,
      { new: true, runValidators: true },
    ),
  );

  return sendSuccess(res, updatedTask, 'وظیفه با موفقیت ویرایش شد.');
};

export const deleteProjectTask = async (req: AuthRequest, res: Response) => {
  if (!isManager(req)) return sendForbidden(res);

  const { id, taskId } = req.params;

  if (!isValidObjectId(id) || !isValidObjectId(taskId)) {
    return sendValidationError(res, 'شناسه پروژه یا وظیفه معتبر نیست.');
  }

  const task = await ProjectTask.findOneAndDelete({ _id: taskId, projectId: id });

  if (!task) {
    return sendNotFound(res, 'وظیفه پیدا نشد.');
  }

  return sendSuccess(res, null, 'وظیفه با موفقیت حذف شد.');
};

export const listProjectNotes = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    return sendValidationError(res, 'شناسه پروژه معتبر نیست.');
  }

  const project = await Project.findById(id);

  if (!project) {
    return sendNotFound(res, 'پروژه پیدا نشد.');
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
    'یادداشت‌های پروژه با موفقیت دریافت شد.',
  );
};


export const createProjectNote = async (req: AuthRequest, res: Response) => {
  if (!isManager(req)) return sendForbidden(res);

  const { id } = req.params;
  const authUserId = getAuthUserId(req);

  if (!isValidObjectId(id)) {
    return sendValidationError(res, 'شناسه پروژه معتبر نیست.');
  }

  if (!isValidObjectId(authUserId)) {
    return sendValidationError(res, 'شناسه کاربر جاری معتبر نیست.');
  }

  const project = await Project.findById(id);

  if (!project) {
    return sendNotFound(res, 'پروژه پیدا نشد.');
  }

  const { note, progressPercent, statusSnapshot, authorId } = req.body;

  if (!note || typeof note !== 'string' || !note.trim()) {
    return sendValidationError(res, 'متن گزارش کار الزامی است.');
  }

  let noteAuthorId: Types.ObjectId;

  try {
    noteAuthorId = await resolveProjectNoteAuthorId(req, project, authorId);
  } catch (error) {
    return sendValidationError(
      res,
      error instanceof Error
        ? error.message
        : 'مدیر انجام‌دهنده گزارش معتبر نیست.',
    );
  }

  const parsedProgressPercent =
    progressPercent === undefined ||
    progressPercent === null ||
    progressPercent === ''
      ? null
      : Number(progressPercent);

  if (
    parsedProgressPercent !== null &&
    (Number.isNaN(parsedProgressPercent) ||
      parsedProgressPercent < 0 ||
      parsedProgressPercent > 100)
  ) {
    return sendValidationError(res, 'درصد پیشرفت باید عددی بین ۰ تا ۱۰۰ باشد.');
  }

  const normalizedSnapshot =
    normalizeEnumValue(statusSnapshot, ProjectStatus) || project.status;

  const noteDocument = await ProjectProgressNote.create({
    projectId: toObjectId(id),
    authorId: noteAuthorId,
    registeredById: toObjectId(authUserId),
    note: note.trim(),
    progressPercent: parsedProgressPercent,
    statusSnapshot: normalizedSnapshot,
    language: 'fa',
    direction: 'rtl',
    source: 'web',
  });

  if (req.file) {
    await ProjectFile.create({
      projectId: toObjectId(id),
      progressNoteId: noteDocument._id,
      uploadedBy: toObjectId(authUserId),
      fileName: req.file.filename,
      originalName: req.file.originalname,
      fileUrl: `/api/v1/uploads/projects/${req.file.filename}`,
      fileType: req.file.mimetype,
      fileSize: req.file.size,
      category: ProjectFileCategory.REPORTS,
      categoryLabel: PROJECT_FILE_CATEGORY_LABELS[ProjectFileCategory.REPORTS],
      language: 'fa',
      direction: 'rtl',
      source: 'web',
    });
  }

  const populatedNote = await populateNoteQuery(
    ProjectProgressNote.findById(noteDocument._id),
  );

  const [noteWithFiles] = await attachFilesToNotes(
    populatedNote ? [populatedNote] : [],
  );

  return sendSuccess(
    res,
    noteWithFiles,
    'گزارش کار با موفقیت ثبت شد.',
    201,
  );
};

export const listProjectFiles = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    return sendValidationError(res, 'شناسه پروژه معتبر نیست.');
  }

  const project = await Project.findById(id);

  if (!project) {
    return sendNotFound(res, 'پروژه پیدا نشد.');
  }

  if (!employeeHasProjectAccess(req, project)) {
    return sendForbidden(res);
  }

  const standaloneOnly = String(req.query.standaloneOnly || '').toLowerCase() === 'true';

  const filter: Record<string, unknown> = { projectId: id };

  if (standaloneOnly) {
    filter.$or = [{ progressNoteId: null }, { progressNoteId: { $exists: false } }];
  }

  const files = await populateFileQuery(
    ProjectFile.find(filter).sort({ createdAt: -1 }),
  );

  return sendSuccess(res, files, 'فایل‌های پروژه با موفقیت دریافت شد.');
};

export const uploadProjectFile = async (req: AuthRequest, res: Response) => {
  if (!isManager(req)) return sendForbidden(res);

  const { id } = req.params;
  const authUserId = getAuthUserId(req);

  if (!isValidObjectId(id)) {
    return sendValidationError(res, 'شناسه پروژه معتبر نیست.');
  }

  if (!isValidObjectId(authUserId)) {
    return sendValidationError(res, 'شناسه کاربر جاری معتبر نیست.');
  }

  if (!req.file) {
    return sendValidationError(res, 'فایل الزامی است.');
  }

  const project = await Project.findById(id);

  if (!project) {
    return sendNotFound(res, 'پروژه پیدا نشد.');
  }

  const normalizedCategory =
    normalizeEnumValue(req.body.category, ProjectFileCategory) ||
    ProjectFileCategory.OTHER;

  const rawProgressNoteId =
    typeof req.body.progressNoteId === 'string' ? req.body.progressNoteId.trim() : '';

  let progressNoteObjectId: Types.ObjectId | null = null;

  if (rawProgressNoteId) {
    if (!isValidObjectId(rawProgressNoteId)) {
      return sendValidationError(res, 'گزارش انتخاب‌شده برای این پروژه معتبر نیست.');
    }

    const progressNote = await ProjectProgressNote.findOne({
      _id: rawProgressNoteId,
      projectId: id,
    });

    if (!progressNote) {
      return sendValidationError(res, 'گزارش انتخاب‌شده برای این پروژه معتبر نیست.');
    }

    progressNoteObjectId = toObjectId(rawProgressNoteId);
  }

  const file = await ProjectFile.create({
    projectId: toObjectId(id),
    progressNoteId: progressNoteObjectId,
    uploadedBy: toObjectId(authUserId),
    fileName: req.file.filename,
    originalName: req.file.originalname,
    fileUrl: `/api/v1/uploads/projects/${req.file.filename}`,
    fileType: req.file.mimetype,
    fileSize: req.file.size,
    category: normalizedCategory,
    categoryLabel: PROJECT_FILE_CATEGORY_LABELS[normalizedCategory],
    language: 'fa',
    direction: 'rtl',
  });

  const populatedFile = await populateFileQuery(ProjectFile.findById(file._id));

  return sendSuccess(res, populatedFile, 'فایل پروژه با موفقیت آپلود شد.', 201);
};

export const deleteProjectFile = async (req: AuthRequest, res: Response) => {
  if (!isManager(req)) return sendForbidden(res);

  const { id, fileId } = req.params;

  if (!isValidObjectId(id) || !isValidObjectId(fileId)) {
    return sendValidationError(res, 'شناسه پروژه یا فایل معتبر نیست.');
  }

  const file = await ProjectFile.findOneAndDelete({ _id: fileId, projectId: id });

  if (!file) {
    return sendNotFound(res, 'فایل پیدا نشد.');
  }

  return sendSuccess(res, null, 'فایل با موفقیت حذف شد.');
};

export const getCalendarEvents = async (req: AuthRequest, res: Response) => {
  const { projectId, assignedUserId, status, priority } = req.query;

  const projectFilter: Record<string, unknown> = {
    ...getEmployeeProjectFilter(req),
  };

  const taskFilter: Record<string, unknown> = {};

  if (getAppRole(req) === 'employee') {
    const authUserId = getAuthUserId(req);

    if (isValidObjectId(authUserId)) {
      taskFilter.assignedUserIds = toObjectId(authUserId);
    }
  }

  if (typeof projectId === 'string' && projectId.trim()) {
    if (!isValidObjectId(projectId)) {
      return sendValidationError(res, 'شناسه پروژه معتبر نیست.');
    }

    projectFilter._id = toObjectId(projectId);
    taskFilter.projectId = toObjectId(projectId);
  }

  if (typeof assignedUserId === 'string' && assignedUserId.trim()) {
    if (!isValidObjectId(assignedUserId)) {
      return sendValidationError(res, 'شناسه کاربر معتبر نیست.');
    }

    projectFilter.assignedUserIds = toObjectId(assignedUserId);
    taskFilter.assignedUserIds = toObjectId(assignedUserId);
  }

  if (typeof priority === 'string' && priority.trim()) {
    const normalizedPriority = normalizeEnumValue(priority, ProjectPriority);

    if (!normalizedPriority) {
      return sendValidationError(res, 'اولویت معتبر نیست.');
    }

    projectFilter.priority = normalizedPriority;
    taskFilter.priority = normalizedPriority;
  }

  if (typeof status === 'string' && status.trim()) {
    const normalizedProjectStatus = normalizeEnumValue(status, ProjectStatus);
    const normalizedTaskStatus = normalizeEnumValue(status, ProjectTaskStatus);

    if (normalizedProjectStatus) projectFilter.status = normalizedProjectStatus;
    if (normalizedTaskStatus) taskFilter.status = normalizedTaskStatus;
  }

  const [projects, tasks] = await Promise.all([
    Project.find(projectFilter).populate('assignedUserIds', USER_SELECT),
    ProjectTask.find(taskFilter).populate('assignedUserIds', USER_SELECT),
  ]);

  const events = [
    ...projects.flatMap((project) => {
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
        });
      }

      return projectEvents;
    }),

    ...tasks.flatMap((task) => {
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

  return sendSuccess(res, events, 'رویدادهای تقویم با موفقیت دریافت شد.');
};


export const archiveProject = deleteProject;
export const archiveProjectTask = deleteProjectTask;
export const createProjectFile = uploadProjectFile;
export const listProjectCalendarEvents = getCalendarEvents;