import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { ProjectTaskModel } from './project-task.model';
import { ProjectFileModel } from './project-file.model';

const isValidObjectId = (value?: string) => {
  return Boolean(value && mongoose.Types.ObjectId.isValid(value));
};

const getCurrentUserId = (req: Request): string | null => {
  const requestWithUser = req as Request & {
    user?: {
      id?: string;
      _id?: string;
    };
  };

  return requestWithUser.user?.id || requestWithUser.user?._id || null;
};

const parseDate = (value?: string | null) => {
  if (!value) return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return null;

  return date;
};

const normalizeAssignedUserIds = (value: unknown): string[] => {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value.map(String).filter(isValidObjectId);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(isValidObjectId);
  }

  return [];
};

const populateTask = () => {
  return [
    {
      path: 'assignedUserIds',
      select: 'firstName lastName fullName username email role isActive telegramChatId',
    },
    {
      path: 'createdBy',
      select: 'firstName lastName fullName username email role isActive telegramChatId',
    },
    {
      path: 'updatedBy',
      select: 'firstName lastName fullName username email role isActive telegramChatId',
    },
  ];
};

const formatTaskWithFiles = async (task: any) => {
  const taskObject = task.toObject ? task.toObject() : task;
  const taskId = String(taskObject._id);

  const files = await ProjectFileModel.find({
    taskId: taskObject._id,
  })
    .populate(
      'uploadedBy',
      'firstName lastName fullName username email role isActive telegramChatId',
    )
    .sort({ createdAt: -1 })
    .lean();

  return {
    ...taskObject,
    id: taskId,
    files: files.map((file) => ({
      ...file,
      id: String(file._id),
    })),
    attachmentCount: files.length,
  };
};

const createTaskFiles = async (
  req: Request,
  projectId: string,
  taskId: string,
) => {
  const files = (req.files || []) as Express.Multer.File[];
  const uploadedBy = getCurrentUserId(req);

  if (!files.length) return [];

  const records = await ProjectFileModel.insertMany(
    files.map((file) => ({
      projectId: new mongoose.Types.ObjectId(projectId),
      taskId: new mongoose.Types.ObjectId(taskId),
      progressNoteId: null,
      uploadedBy:
        uploadedBy && isValidObjectId(uploadedBy)
          ? new mongoose.Types.ObjectId(uploadedBy)
          : null,
      fileName: file.filename,
      originalName: file.originalname,
      fileUrl: `/uploads/projects/${file.filename}`,
      fileType: file.mimetype,
      fileSize: file.size,
      category: 'task_attachment',
    })),
  );

  return records;
};

export const projectTaskController = {
  async listTasks(req: Request, res: Response) {
    const { projectId } = req.params;

    if (!isValidObjectId(projectId)) {
      return res.status(400).json({
        success: false,
        message: 'شناسه پروژه معتبر نیست.',
        code: 'INVALID_PROJECT_ID',
      });
    }

    const tasks = await ProjectTaskModel.find({ projectId })
      .populate(populateTask())
      .sort({ createdAt: -1 });

    const data = await Promise.all(tasks.map(formatTaskWithFiles));

    return res.json({
      success: true,
      data,
    });
  },

  async createTask(req: Request, res: Response) {
    const { projectId } = req.params;
    const {
      title,
      description,
      assignedUserIds,
      status,
      priority,
      startDate,
      dueDate,
    } = req.body;

    if (!isValidObjectId(projectId)) {
      return res.status(400).json({
        success: false,
        message: 'شناسه پروژه معتبر نیست.',
        code: 'INVALID_PROJECT_ID',
      });
    }

    if (!title || !String(title).trim()) {
      return res.status(400).json({
        success: false,
        message: 'عنوان وظیفه الزامی است.',
        code: 'VALIDATION_ERROR',
      });
    }

    const currentUserId = getCurrentUserId(req);
    const nextStatus = status || 'todo';

    const task = await ProjectTaskModel.create({
      projectId,
      title: String(title).trim(),
      description: description ? String(description).trim() : '',
      assignedUserIds: normalizeAssignedUserIds(assignedUserIds),
      status: nextStatus,
      priority: priority || 'medium',
      startDate: parseDate(startDate),
      dueDate: parseDate(dueDate),
      completedAt: nextStatus === 'done' ? new Date() : null,
      createdBy: currentUserId,
      updatedBy: currentUserId,
    });

    const populatedTask = await ProjectTaskModel.findById(task._id).populate(
      populateTask(),
    );

    return res.status(201).json({
      success: true,
      message: 'وظیفه با موفقیت ایجاد شد.',
      data: await formatTaskWithFiles(populatedTask),
    });
  },

  async updateTask(req: Request, res: Response) {
    const { projectId, taskId } = req.params;

    if (!isValidObjectId(projectId) || !isValidObjectId(taskId)) {
      return res.status(400).json({
        success: false,
        message: 'شناسه پروژه یا وظیفه معتبر نیست.',
        code: 'INVALID_ID',
      });
    }

    const task = await ProjectTaskModel.findOne({ _id: taskId, projectId });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'وظیفه پیدا نشد.',
        code: 'TASK_NOT_FOUND',
      });
    }

    const previousStatus = task.status;
    const nextStatus = req.body.status || task.status;

    if (req.body.title !== undefined) {
      if (!String(req.body.title).trim()) {
        return res.status(400).json({
          success: false,
          message: 'عنوان وظیفه الزامی است.',
          code: 'VALIDATION_ERROR',
        });
      }

      task.title = String(req.body.title).trim();
    }

    if (req.body.description !== undefined) {
      task.description = String(req.body.description || '').trim();
    }

    if (req.body.assignedUserIds !== undefined) {
      task.assignedUserIds = normalizeAssignedUserIds(req.body.assignedUserIds).map(
        (id) => new mongoose.Types.ObjectId(id),
      );
    }

    if (req.body.priority !== undefined) {
      task.priority = req.body.priority;
    }

    if (req.body.status !== undefined) {
      task.status = req.body.status;
    }

    if (req.body.startDate !== undefined) {
      task.startDate = parseDate(req.body.startDate);
    }

    if (req.body.dueDate !== undefined) {
      task.dueDate = parseDate(req.body.dueDate);
    }

    if (nextStatus === 'done' && previousStatus !== 'done') {
      task.completedAt = new Date();
    }

    if (nextStatus !== 'done') {
      task.completedAt = null;
    }

    const currentUserId = getCurrentUserId(req);

    if (currentUserId && isValidObjectId(currentUserId)) {
      task.updatedBy = new mongoose.Types.ObjectId(currentUserId);
    }

    await task.save();

    const populatedTask = await ProjectTaskModel.findById(task._id).populate(
      populateTask(),
    );

    return res.json({
      success: true,
      message: 'وظیفه با موفقیت ویرایش شد.',
      data: await formatTaskWithFiles(populatedTask),
    });
  },

  async uploadTaskFiles(req: Request, res: Response) {
    const { projectId, taskId } = req.params;

    if (!isValidObjectId(projectId) || !isValidObjectId(taskId)) {
      return res.status(400).json({
        success: false,
        message: 'شناسه پروژه یا وظیفه معتبر نیست.',
        code: 'INVALID_ID',
      });
    }

    const task = await ProjectTaskModel.findOne({ _id: taskId, projectId });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'وظیفه پیدا نشد.',
        code: 'TASK_NOT_FOUND',
      });
    }

    const files = (req.files || []) as Express.Multer.File[];

    if (!files.length) {
      return res.status(400).json({
        success: false,
        message: 'هیچ فایلی ارسال نشده است.',
        code: 'NO_FILES',
      });
    }

    await createTaskFiles(req, projectId, taskId);

    const populatedTask = await ProjectTaskModel.findById(task._id).populate(
      populateTask(),
    );

    return res.status(201).json({
      success: true,
      message: 'فایل‌های وظیفه با موفقیت ارسال شد.',
      data: await formatTaskWithFiles(populatedTask),
    });
  },

  async deleteTask(req: Request, res: Response) {
    const { projectId, taskId } = req.params;

    if (!isValidObjectId(projectId) || !isValidObjectId(taskId)) {
      return res.status(400).json({
        success: false,
        message: 'شناسه پروژه یا وظیفه معتبر نیست.',
        code: 'INVALID_ID',
      });
    }

    const task = await ProjectTaskModel.findOneAndDelete({
      _id: taskId,
      projectId,
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'وظیفه پیدا نشد.',
        code: 'TASK_NOT_FOUND',
      });
    }

    await ProjectFileModel.deleteMany({ taskId });

    return res.json({
      success: true,
      message: 'وظیفه با موفقیت حذف شد.',
    });
  },
};