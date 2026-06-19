// src/modules/project-finance/project-finance.controller.ts

import { Request, Response } from 'express';
import mongoose, { Types } from 'mongoose';
import { Project } from '@/modules/projects/project.model';
import { UserRole } from '@/modules/users/user.model';
import {
  isProjectFinanceActualType,
  isProjectFinanceForecastType,
  isProjectFinanceInvoiceType,
  ProjectFinanceCounterpartySubdocument,
  ProjectFinanceCurrency,
  ProjectFinanceRecord,
  ProjectFinanceRecordDocument,
  ProjectFinanceStatus,
  ProjectFinanceType,
} from './project-finance.model';
import {
  buildProjectCashflowReport,
  buildProjectFinanceFileUrl,
  buildProjectFinanceSummary,
  buildProjectForecastReport,
  buildProjectInvoiceReport,
  buildProjectPeopleFinanceReport,
  getActualTypeForTarget,
  markOverdueFinanceRecords,
  populateFinanceRecordQuery,
  recalculateFinanceRecordAchievement,
  recalculateLinkedFinanceRecords,
} from './project-finance.service';

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

type ProjectAccessResult = {
  allowed: boolean;
  project?: any;
  reason?: 'invalid_project_id' | 'not_found' | 'forbidden';
};

const getAuthUserId = (req: AuthRequest): string => {
  return String(req.user?.id || req.user?._id || req.user?.userId || '');
};

const normalizeRole = (req: AuthRequest): UserRole => {
  const role = String(req.user?.role || '').toLowerCase().trim();

  if (role === UserRole.BOARD) return UserRole.BOARD;
  if (role === UserRole.MANAGER || role === 'admin') return UserRole.MANAGER;

  return UserRole.EXPERT;
};

const isManager = (req: AuthRequest): boolean => {
  return normalizeRole(req) === UserRole.MANAGER;
};

const isBoard = (req: AuthRequest): boolean => {
  return normalizeRole(req) === UserRole.BOARD;
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

const sendNotFound = (res: Response, message = 'رکورد مالی پیدا نشد.') => {
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

const normalizeString = (value: unknown, maxLength = 2000): string => {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
};

const normalizeOptionalDate = (value: unknown): Date | null => {
  if (!value || typeof value !== 'string') return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return null;

  return date;
};

const normalizeAmount = (value: unknown): number | null => {
  const amount = Number(value);

  if (!Number.isFinite(amount) || amount < 0) return null;

  return Math.round(amount * 100) / 100;
};

const normalizeEnumValue = <T extends Record<string, string>>(
  value: unknown,
  enumObject: T,
): T[keyof T] | null => {
  if (!value || typeof value !== 'string') return null;

  const rawValue = value.trim().toLowerCase();
  const enumValues = Object.values(enumObject);

  const matched = enumValues.find((enumValue) => enumValue.toLowerCase() === rawValue);

  return (matched as T[keyof T]) || null;
};

const normalizeCounterparty = (
  body: Record<string, unknown>,
): ProjectFinanceCounterpartySubdocument => {
  const counterparty =
    body.counterparty && typeof body.counterparty === 'object'
      ? (body.counterparty as Record<string, unknown>)
      : body;

  return {
    name:
      normalizeString(counterparty.counterpartyName, 180) ||
      normalizeString(counterparty.name, 180),
    phone:
      normalizeString(counterparty.counterpartyPhone, 40) ||
      normalizeString(counterparty.phone, 40),
    nationalIdOrEconomicCode:
      normalizeString(counterparty.counterpartyNationalIdOrEconomicCode, 80) ||
      normalizeString(counterparty.nationalIdOrEconomicCode, 80),
    address: normalizeString(counterparty.address, 500),
  };
};

const getFinalAmountFromBody = (body: Record<string, unknown>): number | null => {
  const amount = normalizeAmount(body.amount);
  const taxAmount = normalizeAmount(body.taxAmount ?? 0);
  const discountAmount = normalizeAmount(body.discountAmount ?? 0);

  if (amount === null || taxAmount === null || discountAmount === null) return null;

  return Math.max(amount + taxAmount - discountAmount, 0);
};

const isPastDue = (date: Date | null): boolean => {
  return Boolean(date && date.getTime() < Date.now());
};

const requiresNotAchievedReason = (
  type: ProjectFinanceType,
  dueDate: Date | null,
  finalAmount: number,
  achievedAmount = 0,
): boolean => {
  return (
    (isProjectFinanceInvoiceType(type) || isProjectFinanceForecastType(type)) &&
    isPastDue(dueDate) &&
    finalAmount > achievedAmount
  );
};

const getProjectAccess = async (
  req: AuthRequest,
  projectId: string,
): Promise<ProjectAccessResult> => {
  if (!isValidObjectId(projectId)) {
    return { allowed: false, reason: 'invalid_project_id' };
  }

  const project = await Project.findById(projectId).select(
    '_id title ownerId assignedUserIds projectMembers.userId',
  );

  if (!project) {
    return { allowed: false, reason: 'not_found' };
  }

  if (isManager(req) || isBoard(req)) {
    return { allowed: true, project };
  }

  const authUserId = getAuthUserId(req);

  if (!isValidObjectId(authUserId)) {
    return { allowed: false, reason: 'forbidden' };
  }

  const isAssigned = (project.assignedUserIds || []).some((userId: Types.ObjectId) => {
    return String(userId) === authUserId;
  });

  const isMember = (project.projectMembers || []).some((member: any) => {
    return String(member?.userId || '') === authUserId;
  });

  if (!isAssigned && !isMember && String(project.ownerId || '') !== authUserId) {
    return { allowed: false, reason: 'forbidden' };
  }

  return { allowed: true, project };
};

const ensureProjectAccess = async (
  req: AuthRequest,
  res: Response,
): Promise<any | null> => {
  const projectId = String(req.params.projectId || '');
  const access = await getProjectAccess(req, projectId);

  if (access.allowed) return access.project;

  if (access.reason === 'invalid_project_id') {
    sendValidationError(res, 'شناسه پروژه معتبر نیست.');
    return null;
  }

  if (access.reason === 'not_found') {
    sendNotFound(res, 'پروژه پیدا نشد.');
    return null;
  }

  sendForbidden(res);
  return null;
};

const ensureCanWriteFinance = async (
  req: AuthRequest,
  res: Response,
): Promise<any | null> => {
  if (isBoard(req)) {
    sendForbidden(res);
    return null;
  }

  return ensureProjectAccess(req, res);
};

const findFinanceRecordForProject = async (
  projectId: string,
  financeId: string,
): Promise<ProjectFinanceRecordDocument | null> => {
  if (!isValidObjectId(projectId) || !isValidObjectId(financeId)) return null;

  return ProjectFinanceRecord.findOne({
    _id: toObjectId(financeId),
    projectId: toObjectId(projectId),
  });
};

const validateLinkedRecords = async ({
  projectId,
  type,
  linkedForecastId,
  linkedInvoiceId,
}: {
  projectId: string;
  type: ProjectFinanceType;
  linkedForecastId?: string;
  linkedInvoiceId?: string;
}): Promise<string | null> => {
  if (linkedForecastId) {
    if (!isValidObjectId(linkedForecastId)) {
      return 'شناسه پیش‌بینی مالی معتبر نیست.';
    }

    const forecast = await ProjectFinanceRecord.findOne({
      _id: toObjectId(linkedForecastId),
      projectId: toObjectId(projectId),
      type: {
        $in: [
          ProjectFinanceType.INCOME_FORECAST,
          ProjectFinanceType.EXPENSE_FORECAST,
        ],
      },
      status: { $ne: ProjectFinanceStatus.CANCELLED },
    }).select('_id direction');

    if (!forecast) {
      return 'پیش‌بینی مالی انتخاب‌شده پیدا نشد.';
    }
  }

  if (linkedInvoiceId) {
    if (!isValidObjectId(linkedInvoiceId)) {
      return 'شناسه فاکتور معتبر نیست.';
    }

    const invoice = await ProjectFinanceRecord.findOne({
      _id: toObjectId(linkedInvoiceId),
      projectId: toObjectId(projectId),
      type: {
        $in: [
          ProjectFinanceType.RECEIVABLE_INVOICE,
          ProjectFinanceType.PAYABLE_INVOICE,
        ],
      },
      status: { $ne: ProjectFinanceStatus.CANCELLED },
    }).select('_id direction');

    if (!invoice) {
      return 'فاکتور انتخاب‌شده پیدا نشد.';
    }
  }

  if (isProjectFinanceActualType(type) && !linkedForecastId && !linkedInvoiceId) {
    return 'برای دریافت یا پرداخت واقعی باید فاکتور یا پیش‌بینی مرتبط انتخاب شود.';
  }

  return null;
};

export const listProjectFinanceRecords = async (req: AuthRequest, res: Response) => {
  const project = await ensureProjectAccess(req, res);
  if (!project) return null;

  await markOverdueFinanceRecords(req.params.projectId);

  const {
    page = '1',
    limit = '20',
    search,
    type,
    status,
    direction,
    registeredById,
    from,
    to,
  } = req.query;

  const pageNumber = Math.max(Number(page) || 1, 1);
  const limitNumber = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const skip = (pageNumber - 1) * limitNumber;

  const filter: Record<string, unknown> = {
    projectId: toObjectId(req.params.projectId),
  };

  if (typeof search === 'string' && search.trim()) {
    filter.$or = [
      { title: { $regex: search.trim(), $options: 'i' } },
      { description: { $regex: search.trim(), $options: 'i' } },
      { invoiceNumber: { $regex: search.trim(), $options: 'i' } },
      { 'counterparty.name': { $regex: search.trim(), $options: 'i' } },
    ];
  }

  if (typeof type === 'string' && type.trim()) {
    const normalizedType = normalizeEnumValue(type, ProjectFinanceType);
    if (!normalizedType) return sendValidationError(res, 'نوع رکورد مالی معتبر نیست.');
    filter.type = normalizedType;
  }

  if (typeof status === 'string' && status.trim()) {
    const normalizedStatus = normalizeEnumValue(status, ProjectFinanceStatus);
    if (!normalizedStatus) return sendValidationError(res, 'وضعیت مالی معتبر نیست.');
    filter.status = normalizedStatus;
  }

  if (typeof direction === 'string' && direction.trim()) {
    if (!['income', 'expense'].includes(direction)) {
      return sendValidationError(res, 'جهت مالی معتبر نیست.');
    }
    filter.direction = direction;
  }

  if (typeof registeredById === 'string' && registeredById.trim()) {
    if (!isValidObjectId(registeredById)) {
      return sendValidationError(res, 'شناسه ثبت‌کننده معتبر نیست.');
    }
    filter.registeredById = toObjectId(registeredById);
  }

  const fromDate = normalizeOptionalDate(typeof from === 'string' ? from : '');
  const toDate = normalizeOptionalDate(typeof to === 'string' ? to : '');

  if (fromDate || toDate) {
    filter.createdAt = {
      ...(fromDate ? { $gte: fromDate } : {}),
      ...(toDate ? { $lte: toDate } : {}),
    };
  }

  const [items, total, summary] = await Promise.all([
    populateFinanceRecordQuery(
      ProjectFinanceRecord.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNumber),
    ),
    ProjectFinanceRecord.countDocuments(filter),
    buildProjectFinanceSummary(req.params.projectId),
  ]);

  return res.json({
    success: true,
    message: 'فهرست مالی پروژه با موفقیت دریافت شد.',
    data: items,
    items,
    summary,
    pagination: {
      page: pageNumber,
      limit: limitNumber,
      total,
      totalPages: Math.ceil(total / limitNumber),
    },
  });
};

export const createProjectFinanceRecord = async (req: AuthRequest, res: Response) => {
  const project = await ensureCanWriteFinance(req, res);
  if (!project) return null;

  const projectId = String(req.params.projectId || '');
  const authUserId = getAuthUserId(req);

  if (!isValidObjectId(authUserId)) {
    return sendValidationError(res, 'شناسه کاربر جاری معتبر نیست.');
  }

  const body = req.body as Record<string, unknown>;
  const type = normalizeEnumValue(body.type, ProjectFinanceType);

  if (!type) {
    return sendValidationError(res, 'نوع رکورد مالی الزامی و باید معتبر باشد.');
  }

  const title = normalizeString(body.title, 220);
  if (!title) {
    return sendValidationError(res, 'عنوان رکورد مالی الزامی است.');
  }

  const amount = normalizeAmount(body.amount);
  const taxAmount = normalizeAmount(body.taxAmount ?? 0);
  const discountAmount = normalizeAmount(body.discountAmount ?? 0);

  if (amount === null || taxAmount === null || discountAmount === null) {
    return sendValidationError(res, 'مبلغ، مالیات و تخفیف باید عدد معتبر و نامنفی باشند.');
  }

  const finalAmount = getFinalAmountFromBody(body) || 0;
  const dueDate = normalizeOptionalDate(body.dueDate);
  const notAchievedReason = normalizeString(body.notAchievedReason);

  if (requiresNotAchievedReason(type, dueDate, finalAmount) && !notAchievedReason) {
    return sendValidationError(
      res,
      'برای فاکتور یا پیش‌بینی سررسید گذشته که هنوز محقق نشده، دلیل عدم تحقق الزامی است.',
    );
  }

  const linkedForecastId = normalizeString(body.linkedForecastId, 80);
  const linkedInvoiceId = normalizeString(body.linkedInvoiceId, 80);
  const linkedError = await validateLinkedRecords({
    projectId,
    type,
    linkedForecastId,
    linkedInvoiceId,
  });

  if (linkedError) {
    return sendValidationError(res, linkedError);
  }

  const requestedStatus = normalizeEnumValue(body.status, ProjectFinanceStatus);
  const initialStatus =
    isManager(req) && requestedStatus
      ? requestedStatus
      : ProjectFinanceStatus.SUBMITTED;

  const currency =
    normalizeEnumValue(body.currency, ProjectFinanceCurrency) ||
    ProjectFinanceCurrency.IRR;

  const record = await ProjectFinanceRecord.create({
    projectId: toObjectId(projectId),
    type,
    status: initialStatus,
    title,
    description: normalizeString(body.description),
    amount,
    taxAmount,
    discountAmount,
    currency,
    forecastDate: normalizeOptionalDate(body.forecastDate),
    dueDate,
    actualDate: normalizeOptionalDate(body.actualDate),
    invoiceNumber: normalizeString(body.invoiceNumber, 120),
    invoiceDate: normalizeOptionalDate(body.invoiceDate),
    counterparty: normalizeCounterparty(body),
    linkedForecastId: linkedForecastId ? toObjectId(linkedForecastId) : null,
    linkedInvoiceId: linkedInvoiceId ? toObjectId(linkedInvoiceId) : null,
    notAchievedReason,
    delayReason: normalizeString(body.delayReason),
    managerNote: normalizeString(body.managerNote),
    registeredById: toObjectId(authUserId),
    approvedById:
      initialStatus === ProjectFinanceStatus.APPROVED ? toObjectId(authUserId) : null,
    approvedAt: initialStatus === ProjectFinanceStatus.APPROVED ? new Date() : null,
  });

  await recalculateFinanceRecordAchievement(record._id as Types.ObjectId);
  await recalculateLinkedFinanceRecords(record);

  const populated = await populateFinanceRecordQuery(
    ProjectFinanceRecord.findById(record._id),
  );

  return sendSuccess(res, populated, 'رکورد مالی پروژه با موفقیت ثبت شد.', 201);
};

export const getProjectFinanceRecordById = async (req: AuthRequest, res: Response) => {
  const project = await ensureProjectAccess(req, res);
  if (!project) return null;

  if (!isValidObjectId(req.params.financeId)) {
    return sendValidationError(res, 'شناسه رکورد مالی معتبر نیست.');
  }

  await recalculateFinanceRecordAchievement(req.params.financeId);

  const record = await populateFinanceRecordQuery(
    ProjectFinanceRecord.findOne({
      _id: toObjectId(req.params.financeId),
      projectId: toObjectId(req.params.projectId),
    }),
  );

  if (!record) {
    return sendNotFound(res);
  }

  return sendSuccess(res, record, 'جزئیات رکورد مالی با موفقیت دریافت شد.');
};

export const updateProjectFinanceRecord = async (req: AuthRequest, res: Response) => {
  const project = await ensureCanWriteFinance(req, res);
  if (!project) return null;

  const record = await findFinanceRecordForProject(
    String(req.params.projectId || ''),
    String(req.params.financeId || ''),
  );

  if (!record) {
    return sendNotFound(res);
  }

  const authUserId = getAuthUserId(req);
  const isOwner = String(record.registeredById || '') === authUserId;

  if (!isManager(req) && !isOwner) {
    return sendForbidden(res);
  }

  if (
    !isManager(req) &&
    ![ProjectFinanceStatus.DRAFT, ProjectFinanceStatus.SUBMITTED].includes(record.status)
  ) {
    return sendValidationError(
      res,
      'فقط رکوردهای پیش‌نویس یا ثبت‌شده توسط ثبت‌کننده قابل ویرایش هستند.',
    );
  }

  const body = req.body as Record<string, unknown>;

  if (body.type !== undefined) {
    const type = normalizeEnumValue(body.type, ProjectFinanceType);
    if (!type) return sendValidationError(res, 'نوع رکورد مالی معتبر نیست.');
    record.type = type;
  }

  if (body.title !== undefined) {
    const title = normalizeString(body.title, 220);
    if (!title) return sendValidationError(res, 'عنوان رکورد مالی الزامی است.');
    record.title = title;
  }

  if (body.description !== undefined) {
    record.description = normalizeString(body.description);
  }

  if (body.amount !== undefined) {
    const amount = normalizeAmount(body.amount);
    if (amount === null) return sendValidationError(res, 'مبلغ باید عدد معتبر و نامنفی باشد.');
    record.amount = amount;
  }

  if (body.taxAmount !== undefined) {
    const taxAmount = normalizeAmount(body.taxAmount);
    if (taxAmount === null) return sendValidationError(res, 'مالیات باید عدد معتبر و نامنفی باشد.');
    record.taxAmount = taxAmount;
  }

  if (body.discountAmount !== undefined) {
    const discountAmount = normalizeAmount(body.discountAmount);
    if (discountAmount === null) return sendValidationError(res, 'تخفیف باید عدد معتبر و نامنفی باشد.');
    record.discountAmount = discountAmount;
  }

  if (body.currency !== undefined) {
    const currency = normalizeEnumValue(body.currency, ProjectFinanceCurrency);
    if (!currency) return sendValidationError(res, 'واحد پول معتبر نیست.');
    record.currency = currency;
  }

  if (body.forecastDate !== undefined) {
    record.forecastDate = normalizeOptionalDate(body.forecastDate);
  }

  if (body.dueDate !== undefined) {
    record.dueDate = normalizeOptionalDate(body.dueDate);
  }

  if (body.actualDate !== undefined) {
    record.actualDate = normalizeOptionalDate(body.actualDate);
  }

  if (body.invoiceNumber !== undefined) {
    record.invoiceNumber = normalizeString(body.invoiceNumber, 120);
  }

  if (body.invoiceDate !== undefined) {
    record.invoiceDate = normalizeOptionalDate(body.invoiceDate);
  }

  if (body.counterparty !== undefined || body.counterpartyName !== undefined) {
    record.counterparty = normalizeCounterparty(body);
  }

  if (body.linkedForecastId !== undefined) {
    const linkedForecastId = normalizeString(body.linkedForecastId, 80);
    const linkedError = await validateLinkedRecords({
      projectId: req.params.projectId,
      type: record.type as ProjectFinanceType,
      linkedForecastId,
      linkedInvoiceId: record.linkedInvoiceId ? String(record.linkedInvoiceId) : '',
    });
    if (linkedError) return sendValidationError(res, linkedError);
    record.linkedForecastId = linkedForecastId ? toObjectId(linkedForecastId) : null;
  }

  if (body.linkedInvoiceId !== undefined) {
    const linkedInvoiceId = normalizeString(body.linkedInvoiceId, 80);
    const linkedError = await validateLinkedRecords({
      projectId: req.params.projectId,
      type: record.type as ProjectFinanceType,
      linkedForecastId: record.linkedForecastId ? String(record.linkedForecastId) : '',
      linkedInvoiceId,
    });
    if (linkedError) return sendValidationError(res, linkedError);
    record.linkedInvoiceId = linkedInvoiceId ? toObjectId(linkedInvoiceId) : null;
  }

  if (body.notAchievedReason !== undefined) {
    record.notAchievedReason = normalizeString(body.notAchievedReason);
  }

  if (body.delayReason !== undefined) {
    record.delayReason = normalizeString(body.delayReason);
  }

  if (body.managerNote !== undefined && isManager(req)) {
    record.managerNote = normalizeString(body.managerNote);
  }

  if (body.status !== undefined) {
    if (!isManager(req)) {
      return sendForbidden(res);
    }

    const status = normalizeEnumValue(body.status, ProjectFinanceStatus);
    if (!status) return sendValidationError(res, 'وضعیت مالی معتبر نیست.');
    record.status = status;
  }

  const nextFinalAmount = Math.max(
    (Number(record.amount) || 0) +
      (Number(record.taxAmount) || 0) -
      (Number(record.discountAmount) || 0),
    0,
  );

  if (
    requiresNotAchievedReason(
      record.type as ProjectFinanceType,
      record.dueDate || null,
      nextFinalAmount,
      Number(record.achievedAmount) || 0,
    ) &&
    !String(record.notAchievedReason || '').trim()
  ) {
    return sendValidationError(
      res,
      'برای فاکتور یا پیش‌بینی سررسید گذشته که هنوز محقق نشده، دلیل عدم تحقق الزامی است.',
    );
  }

  await record.save();
  await recalculateFinanceRecordAchievement(record._id as Types.ObjectId);
  await recalculateLinkedFinanceRecords(record);

  const populated = await populateFinanceRecordQuery(
    ProjectFinanceRecord.findById(record._id),
  );

  return sendSuccess(res, populated, 'رکورد مالی پروژه با موفقیت ویرایش شد.');
};

export const cancelProjectFinanceRecord = async (req: AuthRequest, res: Response) => {
  const project = await ensureCanWriteFinance(req, res);
  if (!project) return null;

  if (!isManager(req)) {
    return sendForbidden(res);
  }

  const record = await findFinanceRecordForProject(
    String(req.params.projectId || ''),
    String(req.params.financeId || ''),
  );

  if (!record) {
    return sendNotFound(res);
  }

  record.status = ProjectFinanceStatus.CANCELLED;
  record.managerNote =
    normalizeString(req.body?.managerNote) || record.managerNote || 'رکورد مالی لغو شد.';

  await record.save();
  await recalculateLinkedFinanceRecords(record);

  return sendSuccess(res, record, 'رکورد مالی پروژه با موفقیت لغو شد.');
};

export const approveProjectFinanceRecord = async (req: AuthRequest, res: Response) => {
  const project = await ensureCanWriteFinance(req, res);
  if (!project) return null;

  if (!isManager(req)) {
    return sendForbidden(res);
  }

  const record = await findFinanceRecordForProject(
    String(req.params.projectId || ''),
    String(req.params.financeId || ''),
  );

  if (!record) {
    return sendNotFound(res);
  }

  const authUserId = getAuthUserId(req);

  if (!isValidObjectId(authUserId)) {
    return sendValidationError(res, 'شناسه کاربر جاری معتبر نیست.');
  }

  if (String(record.registeredById || '') === authUserId) {
    return sendValidationError(res, 'ثبت‌کننده رکورد مالی نمی‌تواند رکورد خودش را تأیید کند.');
  }

  if (
    requiresNotAchievedReason(
      record.type as ProjectFinanceType,
      record.dueDate || null,
      Number(record.finalAmount) || 0,
      Number(record.achievedAmount) || 0,
    ) &&
    !String(record.notAchievedReason || '').trim()
  ) {
    return sendValidationError(
      res,
      'قبل از تأیید، دلیل عدم تحقق برای آیتم سررسید گذشته الزامی است.',
    );
  }

  record.status = ProjectFinanceStatus.APPROVED;
  record.approvedById = toObjectId(authUserId);
  record.approvedAt = new Date();
  record.managerNote = normalizeString(req.body?.managerNote) || record.managerNote;

  await record.save();
  await recalculateFinanceRecordAchievement(record._id as Types.ObjectId);
  await recalculateLinkedFinanceRecords(record);

  const populated = await populateFinanceRecordQuery(
    ProjectFinanceRecord.findById(record._id),
  );

  return sendSuccess(res, populated, 'رکورد مالی پروژه با موفقیت تأیید شد.');
};

export const rejectProjectFinanceRecord = async (req: AuthRequest, res: Response) => {
  const project = await ensureCanWriteFinance(req, res);
  if (!project) return null;

  if (!isManager(req)) {
    return sendForbidden(res);
  }

  const record = await findFinanceRecordForProject(
    String(req.params.projectId || ''),
    String(req.params.financeId || ''),
  );

  if (!record) {
    return sendNotFound(res);
  }

  const rejectionReason = normalizeString(req.body?.rejectionReason);

  if (!rejectionReason) {
    return sendValidationError(res, 'دلیل رد رکورد مالی الزامی است.');
  }

  record.status = ProjectFinanceStatus.REJECTED;
  record.rejectionReason = rejectionReason;
  record.managerNote = normalizeString(req.body?.managerNote) || record.managerNote;
  record.approvedById = null;
  record.approvedAt = null;

  await record.save();
  await recalculateLinkedFinanceRecords(record);

  return sendSuccess(res, record, 'رکورد مالی پروژه رد شد.');
};

export const settleProjectFinanceRecord = async (req: AuthRequest, res: Response) => {
  const project = await ensureCanWriteFinance(req, res);
  if (!project) return null;

  const target = await findFinanceRecordForProject(
    String(req.params.projectId || ''),
    String(req.params.financeId || ''),
  );

  if (!target) {
    return sendNotFound(res, 'فاکتور یا پیش‌بینی مالی پیدا نشد.');
  }

  if (isProjectFinanceActualType(target.type as ProjectFinanceType)) {
    return sendValidationError(res, 'رکورد واقعی را نمی‌توان دوباره تسویه کرد.');
  }

  if (
    !isProjectFinanceForecastType(target.type as ProjectFinanceType) &&
    !isProjectFinanceInvoiceType(target.type as ProjectFinanceType)
  ) {
    return sendValidationError(res, 'فقط فاکتور یا پیش‌بینی مالی قابل تسویه است.');
  }

  const body = req.body as Record<string, unknown>;
  const amount = normalizeAmount(body.amount);

  if (amount === null || amount <= 0) {
    return sendValidationError(res, 'مبلغ تسویه باید عدد معتبر و بزرگ‌تر از صفر باشد.');
  }

  const authUserId = getAuthUserId(req);

  if (!isValidObjectId(authUserId)) {
    return sendValidationError(res, 'شناسه کاربر جاری معتبر نیست.');
  }

  const actualType = getActualTypeForTarget(target);
  const linkedInvoiceId = isProjectFinanceInvoiceType(target.type as ProjectFinanceType)
    ? target._id
    : null;
  const linkedForecastId = isProjectFinanceForecastType(target.type as ProjectFinanceType)
    ? target._id
    : target.linkedForecastId || null;

  const actualRecord = await ProjectFinanceRecord.create({
    projectId: target.projectId,
    type: actualType,
    status: isManager(req) ? ProjectFinanceStatus.APPROVED : ProjectFinanceStatus.SUBMITTED,
    title:
      normalizeString(body.title, 220) ||
      (actualType === ProjectFinanceType.ACTUAL_RECEIPT
        ? `دریافت بابت ${target.title}`
        : `پرداخت بابت ${target.title}`),
    description: normalizeString(body.description),
    amount,
    taxAmount: 0,
    discountAmount: 0,
    currency: target.currency,
    actualDate: normalizeOptionalDate(body.actualDate) || new Date(),
    counterparty: target.counterparty || {},
    linkedInvoiceId,
    linkedForecastId,
    registeredById: toObjectId(authUserId),
    approvedById: isManager(req) ? toObjectId(authUserId) : null,
    approvedAt: isManager(req) ? new Date() : null,
    managerNote: normalizeString(body.managerNote),
  });

  await recalculateFinanceRecordAchievement(actualRecord._id as Types.ObjectId);
  await recalculateFinanceRecordAchievement(target._id as Types.ObjectId);
  await recalculateLinkedFinanceRecords(actualRecord);

  const populated = await populateFinanceRecordQuery(
    ProjectFinanceRecord.findById(actualRecord._id),
  );
  const updatedTarget = await populateFinanceRecordQuery(
    ProjectFinanceRecord.findById(target._id),
  );

  return res.status(201).json({
    success: true,
    message: 'تسویه مالی با موفقیت ثبت شد.',
    data: populated,
    actualRecord: populated,
    target: updatedTarget,
  });
};

export const uploadProjectFinanceAttachment = async (req: AuthRequest, res: Response) => {
  const project = await ensureCanWriteFinance(req, res);
  if (!project) return null;

  const record = await findFinanceRecordForProject(
    String(req.params.projectId || ''),
    String(req.params.financeId || ''),
  );

  if (!record) {
    return sendNotFound(res);
  }

  if (!req.file) {
    return sendValidationError(res, 'فایل پیوست ارسال نشده است.');
  }

  const authUserId = getAuthUserId(req);

  record.attachments.push({
    fileName: req.file.filename,
    originalName: req.file.originalname,
    fileUrl: buildProjectFinanceFileUrl(req.file.filename),
    fileType: req.file.mimetype,
    fileSize: req.file.size,
    uploadedBy: isValidObjectId(authUserId) ? toObjectId(authUserId) : null,
    uploadedAt: new Date(),
    description: normalizeString(req.body?.description, 500),
  });

  await record.save();

  const populated = await populateFinanceRecordQuery(
    ProjectFinanceRecord.findById(record._id),
  );

  return sendSuccess(res, populated, 'پیوست مالی با موفقیت بارگذاری شد.', 201);
};

export const deleteProjectFinanceAttachment = async (req: AuthRequest, res: Response) => {
  const project = await ensureCanWriteFinance(req, res);
  if (!project) return null;

  const record = await findFinanceRecordForProject(
    String(req.params.projectId || ''),
    String(req.params.financeId || ''),
  );

  if (!record) {
    return sendNotFound(res);
  }

  const attachmentId = String(req.params.attachmentId || '');

  if (!isValidObjectId(attachmentId)) {
    return sendValidationError(res, 'شناسه پیوست معتبر نیست.');
  }

  const beforeCount = record.attachments.length;
  record.attachments = record.attachments.filter((attachment: any) => {
    return String(attachment._id || '') !== attachmentId;
  });

  if (record.attachments.length === beforeCount) {
    return sendNotFound(res, 'پیوست مالی پیدا نشد.');
  }

  await record.save();

  return sendSuccess(res, record, 'پیوست مالی با موفقیت حذف شد.');
};

export const getProjectFinanceSummary = async (req: AuthRequest, res: Response) => {
  const project = await ensureProjectAccess(req, res);
  if (!project) return null;

  const summary = await buildProjectFinanceSummary(req.params.projectId);

  return sendSuccess(res, summary, 'خلاصه مالی پروژه با موفقیت دریافت شد.');
};

export const getProjectFinanceInvoiceReport = async (
  req: AuthRequest,
  res: Response,
) => {
  const project = await ensureProjectAccess(req, res);
  if (!project) return null;

  const items = await buildProjectInvoiceReport(req.params.projectId);

  return res.json({
    success: true,
    message: 'گزارش فاکتورهای پروژه با موفقیت دریافت شد.',
    data: items,
    items,
    total: items.length,
  });
};

export const getProjectFinanceForecastReport = async (
  req: AuthRequest,
  res: Response,
) => {
  const project = await ensureProjectAccess(req, res);
  if (!project) return null;

  const items = await buildProjectForecastReport(req.params.projectId);

  return res.json({
    success: true,
    message: 'گزارش پیش‌بینی‌های مالی پروژه با موفقیت دریافت شد.',
    data: items,
    items,
    total: items.length,
  });
};

export const getProjectFinanceCashflowReport = async (
  req: AuthRequest,
  res: Response,
) => {
  const project = await ensureProjectAccess(req, res);
  if (!project) return null;

  const items = await buildProjectCashflowReport(req.params.projectId);

  return res.json({
    success: true,
    message: 'گزارش جریان نقدی پروژه با موفقیت دریافت شد.',
    data: items,
    items,
    total: items.length,
  });
};

export const getProjectFinancePeopleReport = async (
  req: AuthRequest,
  res: Response,
) => {
  const project = await ensureProjectAccess(req, res);
  if (!project) return null;

  const items = await buildProjectPeopleFinanceReport(req.params.projectId);

  return res.json({
    success: true,
    message: 'گزارش عملکرد مالی افراد پروژه با موفقیت دریافت شد.',
    data: items,
    items,
    total: items.length,
  });
};

export const getProjectFinanceFullReport = async (req: AuthRequest, res: Response) => {
  const project = await ensureProjectAccess(req, res);
  if (!project) return null;

  const [summary, invoices, forecasts, cashflow, people] = await Promise.all([
    buildProjectFinanceSummary(req.params.projectId),
    buildProjectInvoiceReport(req.params.projectId),
    buildProjectForecastReport(req.params.projectId),
    buildProjectCashflowReport(req.params.projectId),
    buildProjectPeopleFinanceReport(req.params.projectId),
  ]);

  return res.json({
    success: true,
    message: 'گزارش کامل مالی پروژه با موفقیت دریافت شد.',
    data: {
      summary,
      invoices,
      forecasts,
      cashflow,
      people,
    },
  });
};
