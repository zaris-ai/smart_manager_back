import { Request, Response } from 'express';
import mongoose from 'mongoose';
import {
  ProjectFile,
  ProjectFileCategory,
  PROJECT_FILE_CATEGORY_LABELS,
  ProjectTask,
} from './project.model';
import { transcribeAudioFile } from './audio-transcription.service';

type RequestWithUserAndFiles = Request & {
  user?: {
    id?: string;
    _id?: string;
    userId?: string;
  };
  files?: Express.Multer.File[] | Record<string, Express.Multer.File[]>;
};

const isValidObjectId = (value: unknown): boolean => {
  return typeof value === 'string' && mongoose.Types.ObjectId.isValid(value);
};

const getProjectIdFromParams = (req: Request): string | undefined => {
  return req.params.id || req.params.projectId;
};

const getCurrentUserId = (req: Request): string | null => {
  const requestWithUser = req as RequestWithUserAndFiles;

  return (
    requestWithUser.user?.id ||
    requestWithUser.user?._id ||
    requestWithUser.user?.userId ||
    null
  );
};

const getUploadedFiles = (req: Request): Express.Multer.File[] => {
  const requestWithFiles = req as RequestWithUserAndFiles;
  const files = requestWithFiles.files;

  if (!files) {
    return [];
  }

  if (Array.isArray(files)) {
    return files;
  }

  return Object.values(files).flat();
};

const populateTask = () => {
  return [
    {
      path: 'assignedUserIds',
      select:
        'firstName lastName fullName username email role isActive telegramChatId',
    },
    {
      path: 'createdBy',
      select:
        'firstName lastName fullName username email role isActive telegramChatId',
    },
    {
      path: 'updatedBy',
      select:
        'firstName lastName fullName username email role isActive telegramChatId',
    },
  ];
};

const formatTaskWithFiles = async (task: any) => {
  const taskObject = task?.toObject ? task.toObject() : task;

  if (!taskObject) {
    return null;
  }

  const files = await ProjectFile.find({
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
    id: String(taskObject._id),
    files: files.map((file: any) => ({
      ...file,
      id: String(file._id),
    })),
    attachmentCount: files.length,
  };
};

const buildProjectUploadFileUrl = (fileName: string): string => {
  return `/api/v1/uploads/projects/${fileName}`;
};

const buildTranscriptionFields = async (file: Express.Multer.File) => {
  const transcription = await transcribeAudioFile(file);

  return {
    transcriptionStatus: transcription.status,
    transcriptionText: transcription.text,
    transcriptionError: transcription.error || '',
    transcriptionModel: transcription.model || '',
    transcriptionLanguage: transcription.language || '',
    transcribedAt: transcription.transcribedAt || null,
  };
};

const createTaskFiles = async (
  req: Request,
  projectId: string,
  taskId: string,
) => {
  const files = getUploadedFiles(req);
  const uploadedBy = getCurrentUserId(req);

  if (!files.length) {
    return {
      completedTranscriptText: '',
    };
  }

  const records = await Promise.all(
    files.map(async (file: Express.Multer.File) => {
      const transcriptionFields = await buildTranscriptionFields(file);

      return ProjectFile.create({
        projectId: new mongoose.Types.ObjectId(projectId),
        taskId: new mongoose.Types.ObjectId(taskId),
        progressNoteId: null,
        uploadedBy:
          uploadedBy && isValidObjectId(uploadedBy)
            ? new mongoose.Types.ObjectId(uploadedBy)
            : null,
        fileName: file.filename,
        originalName: file.originalname,
        fileUrl: buildProjectUploadFileUrl(file.filename),
        fileType: file.mimetype,
        fileSize: file.size,
        category: ProjectFileCategory.TASK_ATTACHMENT,
        categoryLabel:
          PROJECT_FILE_CATEGORY_LABELS[ProjectFileCategory.TASK_ATTACHMENT],
        ...transcriptionFields,
      });
    }),
  );

  const completedTranscriptText = records
    .map((record: any) => String(record.transcriptionText || '').trim())
    .filter(Boolean)
    .join('\n\n');

  return {
    completedTranscriptText,
  };
};

export const uploadProjectTaskFiles = async (req: Request, res: Response) => {
  const projectId = getProjectIdFromParams(req);
  const { taskId } = req.params;

  if (!isValidObjectId(projectId) || !isValidObjectId(taskId)) {
    return res.status(400).json({
      success: false,
      message: 'شناسه پروژه یا وظیفه معتبر نیست.',
      code: 'INVALID_ID',
    });
  }

  const safeProjectId = String(projectId);
  const safeTaskId = String(taskId);

  const task = await ProjectTask.findOne({
    _id: safeTaskId,
    projectId: safeProjectId,
  });

  if (!task) {
    return res.status(404).json({
      success: false,
      message: 'وظیفه پیدا نشد.',
      code: 'TASK_NOT_FOUND',
    });
  }

  const files = getUploadedFiles(req);

  if (!files.length) {
    return res.status(400).json({
      success: false,
      message: 'هیچ فایلی ارسال نشده است.',
      code: 'NO_FILES',
    });
  }

  const { completedTranscriptText } = await createTaskFiles(
    req,
    safeProjectId,
    safeTaskId,
  );

  if (!String(task.description || '').trim() && completedTranscriptText) {
    task.description = completedTranscriptText;
    await task.save();
  }

  const populatedTask = await ProjectTask.findById(task._id).populate(
    populateTask(),
  );

  return res.status(201).json({
    success: true,
    message: 'فایل‌های وظیفه با موفقیت ارسال شد.',
    data: await formatTaskWithFiles(populatedTask),
  });
};