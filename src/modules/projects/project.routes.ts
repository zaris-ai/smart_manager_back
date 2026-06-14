import { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { requireAuth } from '@/modules/auth/auth.middleware';
import {
  archiveProject,
  archiveProjectTask,
  assignUsersToProject,
  createProject,
  createProjectFile,
  createProjectNote,
  createProjectTask,
  deleteProjectFile,
  getProjectById,
  listProjectCalendarEvents,
  listProjectFiles,
  listProjectNotes,
  listProjects,
  listProjectTasks,
  removeUserFromProject,
  updateProject,
  updateProjectTask,
} from '@/modules/projects/project.controller';
import { importProjectsFromExcel } from '@/modules/projects/project-import.controller';

type AsyncController = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<unknown> | unknown;

/**
 * Project controllers currently return Response in many places:
 * return sendSuccess(...)
 * return sendValidationError(...)
 *
 * The shared asyncHandler expects Promise<void>, so passing these controllers
 * directly to asyncHandler creates TypeScript errors.
 *
 * This local adapter accepts any controller return value, awaits it, and returns
 * void to Express.
 */
const routeHandler = (controller: AsyncController): RequestHandler => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await controller(req, res, next);
    } catch (error) {
      next(error);
    }
  };
};

const router = Router();

const uploadDir = path.join(process.cwd(), 'uploads', 'projects');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const projectFileStorage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    callback(null, uploadDir);
  },
  filename: (_req, file, callback) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');

    callback(null, `${Date.now()}-${safeName}`);
  },
});

const projectFileUpload = multer({
  storage: projectFileStorage,
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
});

const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();

    if (['.xlsx', '.xls'].includes(extension)) {
      callback(null, true);
      return;
    }

    callback(new Error('فقط فایل اکسل با فرمت .xlsx یا .xls قابل قبول است.'));
  },
});

router.use(requireAuth);

/**
 * Static / special routes must be before /:id routes.
 */
router.get('/calendar/events', routeHandler(listProjectCalendarEvents));

router.post(
  '/import/excel',
  excelUpload.single('file'),
  routeHandler(importProjectsFromExcel),
);

/**
 * Project CRUD
 */
router.get('/', routeHandler(listProjects));
router.post('/', routeHandler(createProject));

router.get('/:id', routeHandler(getProjectById));
router.patch('/:id', routeHandler(updateProject));
router.delete('/:id', routeHandler(archiveProject));

/**
 * Project users
 */
router.post('/:id/users', routeHandler(assignUsersToProject));
router.delete('/:id/users/:userId', routeHandler(removeUserFromProject));

/**
 * Project tasks
 */
router.get('/:id/tasks', routeHandler(listProjectTasks));
router.post('/:id/tasks', routeHandler(createProjectTask));
router.patch('/:id/tasks/:taskId', routeHandler(updateProjectTask));
router.delete('/:id/tasks/:taskId', routeHandler(archiveProjectTask));

/**
 * Project notes
 */
router.get('/:id/notes', routeHandler(listProjectNotes));
router.post('/:id/notes', routeHandler(createProjectNote));

/**
 * Project files
 */
router.get('/:id/files', routeHandler(listProjectFiles));
router.post(
  '/:id/files',
  projectFileUpload.single('file'),
  routeHandler(createProjectFile),
);
router.delete('/:id/files/:fileId', routeHandler(deleteProjectFile));

export default router;