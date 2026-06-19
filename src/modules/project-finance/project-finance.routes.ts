// src/modules/project-finance/project-finance.routes.ts

import { NextFunction, RequestHandler, Response, Router } from 'express';
import { requireAuth } from '@/modules/auth/auth.middleware';
import { projectUpload } from '@/modules/projects/project-upload.middleware';
import {
  approveProjectFinanceRecord,
  cancelProjectFinanceRecord,
  createProjectFinanceRecord,
  deleteProjectFinanceAttachment,
  getProjectFinanceCashflowReport,
  getProjectFinanceForecastReport,
  getProjectFinanceFullReport,
  getProjectFinanceInvoiceReport,
  getProjectFinancePeopleReport,
  getProjectFinanceRecordById,
  getProjectFinanceSummary,
  listProjectFinanceRecords,
  rejectProjectFinanceRecord,
  settleProjectFinanceRecord,
  updateProjectFinanceRecord,
  uploadProjectFinanceAttachment,
} from './project-finance.controller';

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

const router = Router({ mergeParams: true });

router.use(requireAuth);

/**
 * Reports must be before /:financeId routes.
 */
router.get('/summary', routeHandler(getProjectFinanceSummary));
router.get('/report', routeHandler(getProjectFinanceFullReport));
router.get('/invoices/report', routeHandler(getProjectFinanceInvoiceReport));
router.get('/forecasts/report', routeHandler(getProjectFinanceForecastReport));
router.get('/cashflow', routeHandler(getProjectFinanceCashflowReport));
router.get('/people/report', routeHandler(getProjectFinancePeopleReport));

/**
 * Finance CRUD
 */
router.get('/', routeHandler(listProjectFinanceRecords));
router.post('/', routeHandler(createProjectFinanceRecord));
router.get('/:financeId', routeHandler(getProjectFinanceRecordById));
router.patch('/:financeId', routeHandler(updateProjectFinanceRecord));
router.delete('/:financeId', routeHandler(cancelProjectFinanceRecord));

/**
 * Approval lifecycle
 */
router.post('/:financeId/approve', routeHandler(approveProjectFinanceRecord));
router.post('/:financeId/reject', routeHandler(rejectProjectFinanceRecord));
router.post('/:financeId/settle', routeHandler(settleProjectFinanceRecord));

/**
 * Attachments
 */
router.post(
  '/:financeId/files',
  projectUpload.single('file'),
  routeHandler(uploadProjectFinanceAttachment),
);
router.delete(
  '/:financeId/files/:attachmentId',
  routeHandler(deleteProjectFinanceAttachment),
);

export default router;
