import { NextFunction, RequestHandler, Response, Router } from 'express';
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
import { uploadProjectTaskFiles } from './project-task.controller';
import { projectUpload } from './project-upload.middleware';

type RouteController = (
  req: any,
  res: Response,
  next?: NextFunction,
) => Promise<unknown> | unknown;

const routeHandler = (controller: RouteController): RequestHandler => {
  return async (req, res, next): Promise<void> => {
    try {
      await controller(req, res, next);
    } catch (error) {
      next(error);
    }
  };
};

const router = Router();

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
router.post(
  '/:id/tasks/:taskId/files',
  projectUpload.array('files', 20),
  routeHandler(uploadProjectTaskFiles),
);

/**
 * Project notes
 */
router.get('/:id/notes', routeHandler(listProjectNotes));
router.post(
  '/:id/notes',
  projectUpload.single('file'),
  routeHandler(createProjectNote),
);

/**
 * Project files
 */
router.get('/:id/files', routeHandler(listProjectFiles));
router.post(
  '/:id/files',
  projectUpload.single('file'),
  routeHandler(createProjectFile),
);
router.delete('/:id/files/:fileId', routeHandler(deleteProjectFile));

export default router;