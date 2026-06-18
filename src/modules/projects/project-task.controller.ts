import { Request, Response } from 'express';
import mongoose from 'mongoose';
import {
  ProjectFile,
  ProjectFileCategory,
  PROJECT_FILE_CATEGORY_LABELS,
  ProjectTask,
} from './project.model';
import { transcribeAudioFile } from './audio-transcription.service';

type AuthRequest = Request & {
  files?: Express.Multer.File[];
  user?: {
    id?: string;
    _id?: string;
    userId?: string;
  };
};

const isValidObjectId = (value?: string): boolean => {
  return Boolean(value && mongoose.Types.ObjectId.isValid(value));
};

const getCurrentUserId = (req: AuthRequest): string | null => {
  return req.user?.id || req.user?._id || req.user?.userId || null;
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

const formatTaskWithFiles = async (task: any) => {
  const taskObject = task.toObject ? task.toObject() : task;
  const taskId = String(taskObject._id);

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
    id: taskId,
    files: files.map((file: any) => ({
      ...file,
      id: String(file._id),
    })),
    attachmentCount: files.length,
  };
};

const createTaskFiles = async (
  req: AuthRequest,
  projectId: string,
  taskId: string,
) => {
  const files = (req.files || []) as Express.Multer.File[];
  const uploadedBy = getCurrentUserId(req);

  if (!files.length) {
    return {
      completedTranscriptText: '',
    };
  }

  const records = await Promise.all(
    files.map(async (file) => {
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

export const uploadProjectTaskFiles = async (
  req: AuthRequest,
  res: Response,
) => {
  const { id: projectId, taskId } = req.params;

  if (!isValidObjectId(projectId) || !isValidObjectId(taskId)) {
    return res.status(400).json({
      success: false,
      message: 'شناسه پروژه یا وظیفه معتبر نیست.',
      code: 'INVALID_ID',
    });
  }

  const task = await ProjectTask.findOne({ _id: taskId, projectId });

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

  const { completedTranscriptText } = await createTaskFiles(
    req,
    projectId,
    taskId,
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