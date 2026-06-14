import { Request, Response } from 'express';
import mongoose, { Types } from 'mongoose';
import * as XLSX from 'xlsx';
import {
  Project,
  ProjectPriority,
  PROJECT_PRIORITY_LABELS,
  ProjectStatus,
  PROJECT_STATUS_LABELS,
} from '@/modules/projects/project.model';
import User, { UserStatus } from '@/modules/users/user.model';

type AuthRequest = Request & {
  file?: Express.Multer.File;
  user?: {
    id?: string;
    _id?: string;
    userId?: string;
    role?: string;
  };
};

type RawExcelRow = Record<string, unknown>;

type NormalizedProjectRow = {
  rowNumber: number;
  title: string;
  description: string;
  status: ProjectStatus;
  priority: ProjectPriority;
  startDate: Date;
  dueDate: Date | null;
  ownerUsername: string;
  assignedUsernames: string[];
};

type ImportErrorItem = {
  rowNumber: number;
  title?: string;
  message: string;
};

type ImportCreatedItem = {
  rowNumber: number;
  id: string;
  title: string;
};

const MAX_IMPORT_ROWS = 500;

const getAuthUserId = (req: AuthRequest): string => {
  return String(req.user?.id || req.user?._id || req.user?.userId || '');
};

const isManager = (req: AuthRequest): boolean => {
  const role = String(req.user?.role || '').toLowerCase();

  return role === 'manager' || role === 'admin';
};

const isValidObjectId = (value?: string): boolean => {
  return Boolean(value && mongoose.Types.ObjectId.isValid(value));
};

const toObjectId = (value: string): Types.ObjectId => {
  return new mongoose.Types.ObjectId(value);
};

const normalizeKey = (value: string): string => {
  return value.trim().toLowerCase().replace(/\s+/g, '_');
};

const buildRowMap = (row: RawExcelRow): Record<string, unknown> => {
  return Object.entries(row).reduce<Record<string, unknown>>(
    (acc, [key, value]) => {
      acc[normalizeKey(key)] = value;

      return acc;
    },
    {},
  );
};

const readCell = (row: RawExcelRow, aliases: string[]): unknown => {
  const normalizedRow = buildRowMap(row);

  for (const alias of aliases) {
    const normalizedAlias = normalizeKey(alias);

    if (normalizedAlias in normalizedRow) {
      return normalizedRow[normalizedAlias];
    }
  }

  return '';
};

const cellHasValue = (value: unknown): boolean => {
  return value !== null && value !== undefined && String(value).trim() !== '';
};

const toText = (value: unknown): string => {
  if (value === null || value === undefined) return '';

  return String(value).trim();
};

const normalizeUsername = (value: unknown): string => {
  return toText(value).toLowerCase();
};

const splitUsernames = (value: unknown): string[] => {
  return Array.from(
    new Set(
      toText(value)
        .split(/[,،]/)
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
};

const parseDateValue = (value: unknown): Date | null => {
  if (!cellHasValue(value)) return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);

    if (!parsed) return null;

    return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
  }

  const text = toText(value);

  if (!text) return null;

  const normalized = text.replace(/\//g, '-');

  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(normalized)) {
    const [year, month, day] = normalized.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));

    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(text);

  return Number.isNaN(date.getTime()) ? null : date;
};

const normalizeStatus = (value: unknown): ProjectStatus | null => {
  const text = toText(value).toLowerCase();

  if (!text) return ProjectStatus.PLANNING;

  const map: Record<string, ProjectStatus> = {
    planning: ProjectStatus.PLANNING,
    برنامه‌ریزی: ProjectStatus.PLANNING,
    برنامه_ریزی: ProjectStatus.PLANNING,

    active: ProjectStatus.ACTIVE,
    فعال: ProjectStatus.ACTIVE,

    on_hold: ProjectStatus.ON_HOLD,
    hold: ProjectStatus.ON_HOLD,
    متوقف: ProjectStatus.ON_HOLD,
    'متوقف موقت': ProjectStatus.ON_HOLD,

    completed: ProjectStatus.COMPLETED,
    done: ProjectStatus.COMPLETED,
    تکمیل: ProjectStatus.COMPLETED,
    'تکمیل‌شده': ProjectStatus.COMPLETED,

    cancelled: ProjectStatus.CANCELLED,
    canceled: ProjectStatus.CANCELLED,
    لغو: ProjectStatus.CANCELLED,
    لغوشده: ProjectStatus.CANCELLED,
  };

  return map[text] || null;
};

const normalizePriority = (value: unknown): ProjectPriority | null => {
  const text = toText(value).toLowerCase();

  if (!text) return ProjectPriority.MEDIUM;

  const map: Record<string, ProjectPriority> = {
    low: ProjectPriority.LOW,
    کم: ProjectPriority.LOW,

    medium: ProjectPriority.MEDIUM,
    متوسط: ProjectPriority.MEDIUM,

    high: ProjectPriority.HIGH,
    زیاد: ProjectPriority.HIGH,

    critical: ProjectPriority.CRITICAL,
    بحرانی: ProjectPriority.CRITICAL,
  };

  return map[text] || null;
};

const extractRowsFromWorkbook = (fileBuffer: Buffer): RawExcelRow[] => {
  const workbook = XLSX.read(fileBuffer, {
    type: 'buffer',
    cellDates: true,
  });

  const sheetName = workbook.SheetNames.includes('Projects')
    ? 'Projects'
    : workbook.SheetNames[0];

  if (!sheetName) return [];

  const sheet = workbook.Sheets[sheetName];

  return XLSX.utils.sheet_to_json<RawExcelRow>(sheet, {
    defval: '',
    raw: true,
  });
};

const normalizeProjectRows = (
  rows: RawExcelRow[],
): {
  validRows: NormalizedProjectRow[];
  errors: ImportErrorItem[];
} => {
  const validRows: NormalizedProjectRow[] = [];
  const errors: ImportErrorItem[] = [];

  rows.slice(0, MAX_IMPORT_ROWS).forEach((row, index) => {
    const rowNumber = index + 2;

    const title = toText(
      readCell(row, ['title', 'project_title', 'project title', 'عنوان']),
    );

    const description = toText(
      readCell(row, ['description', 'project_description', 'توضیحات']),
    );

    const rawStatus = readCell(row, ['status', 'وضعیت']);
    const rawPriority = readCell(row, ['priority', 'اولویت']);
    const rawStartDate = readCell(row, [
      'start_date',
      'start date',
      'startDate',
      'تاریخ شروع',
    ]);
    const rawDueDate = readCell(row, [
      'due_date',
      'due date',
      'dueDate',
      'تاریخ تحویل',
      'موعد',
    ]);
    const rawOwnerUsername = readCell(row, [
      'owner_username',
      'owner username',
      'owner',
      'مسئول پروژه',
      'مالک',
    ]);
    const rawAssignedUsernames = readCell(row, [
      'assigned_usernames',
      'assigned usernames',
      'assigned_users',
      'کاربران مسئول',
      'اعضا',
    ]);

    const rowIsEmpty = [
      title,
      description,
      rawStatus,
      rawPriority,
      rawStartDate,
      rawDueDate,
      rawOwnerUsername,
      rawAssignedUsernames,
    ].every((item) => !cellHasValue(item));

    if (rowIsEmpty) return;

    const rowErrors: string[] = [];

    if (!title) {
      rowErrors.push('عنوان پروژه الزامی است.');
    }

    const ownerUsername = normalizeUsername(rawOwnerUsername);

    if (!ownerUsername) {
      rowErrors.push('owner_username الزامی است.');
    }

    const status = normalizeStatus(rawStatus);

    if (!status) {
      rowErrors.push(
        'وضعیت پروژه معتبر نیست. مقدار مجاز: planning, active, on_hold, completed, cancelled',
      );
    }

    const priority = normalizePriority(rawPriority);

    if (!priority) {
      rowErrors.push(
        'اولویت پروژه معتبر نیست. مقدار مجاز: low, medium, high, critical',
      );
    }

    const startDate = parseDateValue(rawStartDate);

    if (!startDate) {
      rowErrors.push('start_date معتبر نیست. فرمت پیشنهادی: YYYY-MM-DD');
    }

    const dueDate = parseDateValue(rawDueDate);

    if (cellHasValue(rawDueDate) && !dueDate) {
      rowErrors.push('due_date معتبر نیست. فرمت پیشنهادی: YYYY-MM-DD');
    }

    if (startDate && dueDate && dueDate < startDate) {
      rowErrors.push('موعد تحویل نمی‌تواند قبل از تاریخ شروع باشد.');
    }

    if (rowErrors.length) {
      errors.push({
        rowNumber,
        title: title || undefined,
        message: rowErrors.join(' '),
      });

      return;
    }

    validRows.push({
      rowNumber,
      title,
      description,
      status: status || ProjectStatus.PLANNING,
      priority: priority || ProjectPriority.MEDIUM,
      startDate: startDate as Date,
      dueDate,
      ownerUsername,
      assignedUsernames: splitUsernames(rawAssignedUsernames),
    });
  });

  return {
    validRows,
    errors,
  };
};

export const importProjectsFromExcel = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const authReq = req as AuthRequest;

  if (!isManager(authReq)) {
    res.status(403).json({
      success: false,
      message: 'شما دسترسی لازم برای ورود گروهی پروژه‌ها را ندارید.',
      code: 'FORBIDDEN',
    });

    return;
  }

  const authUserId = getAuthUserId(authReq);

  if (!isValidObjectId(authUserId)) {
    res.status(400).json({
      success: false,
      message: 'شناسه کاربر جاری معتبر نیست.',
      code: 'VALIDATION_ERROR',
    });

    return;
  }

  if (!authReq.file?.buffer) {
    res.status(400).json({
      success: false,
      message: 'فایل اکسل ارسال نشده است.',
      code: 'EXCEL_FILE_REQUIRED',
    });

    return;
  }

  const rows = extractRowsFromWorkbook(authReq.file.buffer);

  if (!rows.length) {
    res.status(400).json({
      success: false,
      message: 'فایل اکسل خالی است یا ردیف قابل خواندن ندارد.',
      code: 'EMPTY_EXCEL_FILE',
    });

    return;
  }

  const { validRows, errors } = normalizeProjectRows(rows);

  if (!validRows.length) {
    res.status(400).json({
      success: false,
      message: 'هیچ پروژه معتبری برای ورود پیدا نشد.',
      code: 'NO_VALID_PROJECT_ROWS',
      data: {
        totalRows: rows.length,
        createdCount: 0,
        skippedCount: 0,
        failedCount: errors.length,
        created: [],
        errors,
      },
    });

    return;
  }

  const allUsernames = Array.from(
    new Set(
      validRows.flatMap((row) => [
        row.ownerUsername,
        ...row.assignedUsernames,
      ]),
    ),
  );

  const users = await User.find({
    username: { $in: allUsernames },
    status: UserStatus.ACTIVE,
    isActive: true,
  })
    .select('_id username firstName lastName fullName email')
    .lean();

  const userMap = new Map(
    users.map((user: any) => [String(user.username).toLowerCase(), user]),
  );

  const existingProjects = await Project.find({
    title: { $in: validRows.map((row) => row.title) },
  })
    .select('title')
    .lean();

  const existingTitleSet = new Set(
    existingProjects.map((project: any) => String(project.title).trim()),
  );

  const created: ImportCreatedItem[] = [];
  let skippedCount = 0;

  for (const row of validRows) {
    if (existingTitleSet.has(row.title)) {
      skippedCount += 1;

      errors.push({
        rowNumber: row.rowNumber,
        title: row.title,
        message: 'پروژه‌ای با همین عنوان از قبل وجود دارد و این ردیف رد شد.',
      });

      continue;
    }

    const owner = userMap.get(row.ownerUsername);

    if (!owner) {
      errors.push({
        rowNumber: row.rowNumber,
        title: row.title,
        message: `کاربر مسئول با username «${row.ownerUsername}» پیدا نشد یا فعال نیست.`,
      });

      continue;
    }

    const missingAssignedUsernames = row.assignedUsernames.filter(
      (username) => !userMap.has(username),
    );

    if (missingAssignedUsernames.length) {
      errors.push({
        rowNumber: row.rowNumber,
        title: row.title,
        message: `کاربران مسئول زیر پیدا نشدند یا فعال نیستند: ${missingAssignedUsernames.join(', ')}`,
      });

      continue;
    }

    const assignedIds = Array.from(
      new Set([
        String(owner._id),
        ...row.assignedUsernames.map((username) =>
          String(userMap.get(username)._id),
        ),
      ]),
    ).map(toObjectId);

    const project = await Project.create({
      title: row.title,
      description: row.description,
      status: row.status,
      statusLabel: PROJECT_STATUS_LABELS[row.status],
      priority: row.priority,
      priorityLabel: PROJECT_PRIORITY_LABELS[row.priority],
      startDate: row.startDate,
      dueDate: row.dueDate,
      ownerId: toObjectId(String(owner._id)),
      assignedUserIds: assignedIds,
      language: 'fa',
      direction: 'rtl',
      createdBy: toObjectId(authUserId),
      updatedBy: toObjectId(authUserId),
    });

    created.push({
      rowNumber: row.rowNumber,
      id: String(project._id),
      title: project.title,
    });

    existingTitleSet.add(row.title);
  }

  res.status(created.length ? 201 : 400).json({
    success: created.length > 0,
    message: created.length
      ? `${created.length} پروژه با موفقیت از اکسل وارد شد.`
      : 'هیچ پروژه‌ای وارد نشد.',
    data: {
      totalRows: rows.length,
      createdCount: created.length,
      skippedCount,
      failedCount: errors.length,
      created,
      errors,
    },
  });
};