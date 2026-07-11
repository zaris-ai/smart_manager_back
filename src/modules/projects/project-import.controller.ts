import { Request, Response } from "express";
import mongoose, { Types } from "mongoose";
import * as XLSX from "xlsx";
import {
  Project,
  ProjectPhase,
  ProjectPriority,
  PROJECT_PRIORITY_LABELS,
  ProjectStatus,
  PROJECT_STATUS_LABELS,
} from "@/modules/projects/project.model";

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
};

type NormalizedPhaseRow = {
  rowNumber: number;
  projectTitle: string;
  title: string;
  description: string;
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

type ImportErrorItem = {
  sheet: "Projects" | "Phases";
  rowNumber: number;
  title?: string;
  message: string;
};

type ImportCreatedItem = {
  rowNumber: number;
  id: string;
  title: string;
  phaseCount: number;
  staffingRequired: true;
};

type ExtractedWorkbookRows = {
  projectRows: RawExcelRow[];
  phaseRows: RawExcelRow[];
};

const MAX_IMPORT_PROJECT_ROWS = 500;
const MAX_IMPORT_PHASE_ROWS = 2500;

const getAuthUserId = (req: AuthRequest): string => {
  return String(req.user?.id || req.user?._id || req.user?.userId || "");
};

const isManager = (req: AuthRequest): boolean => {
  const role = String(req.user?.role || "").toLowerCase();

  return role === "manager" || role === "admin";
};

const isValidObjectId = (value?: string): boolean => {
  return Boolean(value && mongoose.Types.ObjectId.isValid(value));
};

const toObjectId = (value: string): Types.ObjectId => {
  return new mongoose.Types.ObjectId(value);
};

const normalizeDigits = (value: string): string => {
  const persianDigits = "۰۱۲۳۴۵۶۷۸۹";
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";

  return value
    .replace(/[۰-۹]/g, (digit) => String(persianDigits.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)));
};

const normalizeKey = (value: string): string => {
  return normalizeDigits(value)
    .trim()
    .toLowerCase()
    .replace(/[\s\u200c-]+/g, "_")
    .replace(/^_+|_+$/g, "");
};

const normalizeProjectTitleKey = (value: string): string => {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
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

  return "";
};

const cellHasValue = (value: unknown): boolean => {
  return value !== null && value !== undefined && String(value).trim() !== "";
};

const toText = (value: unknown): string => {
  if (value === null || value === undefined) return "";

  return String(value).trim();
};

const parseDateValue = (value: unknown): Date | null => {
  if (!cellHasValue(value)) return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);

    if (!parsed) return null;

    return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
  }

  const text = normalizeDigits(toText(value));

  if (!text) return null;

  const normalized = text.replace(/\//g, "-");

  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(normalized)) {
    const [year, month, day] = normalized.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));

    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return null;
    }

    return date;
  }

  const date = new Date(text);

  return Number.isNaN(date.getTime()) ? null : date;
};

const parseNonNegativeNumber = (value: unknown): number | null => {
  if (!cellHasValue(value)) return 0;

  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0
      ? Math.round(value * 100) / 100
      : null;
  }

  const normalized = normalizeDigits(toText(value))
    .replace(/[,_\s]/g, "")
    .replace(/٬/g, "")
    .replace(/٫/g, ".");
  const amount = Number(normalized);

  if (!Number.isFinite(amount) || amount < 0) return null;

  return Math.round(amount * 100) / 100;
};

const normalizeCurrency = (value: unknown): string => {
  const currency = toText(value).toUpperCase();

  return currency ? currency.slice(0, 12) : "IRR";
};

const normalizeStatus = (value: unknown): ProjectStatus | null => {
  const text = toText(value).toLowerCase();

  if (!text) return ProjectStatus.PLANNING;

  const map: Record<string, ProjectStatus> = {
    negotiating: ProjectStatus.NEGOTIATING,
    negotiation: ProjectStatus.NEGOTIATING,
    مذاکره: ProjectStatus.NEGOTIATING,
    "در حال مذاکره": ProjectStatus.NEGOTIATING,

    proposal_drafting: ProjectStatus.PROPOSAL_DRAFTING,
    drafting_proposal: ProjectStatus.PROPOSAL_DRAFTING,
    proposal: ProjectStatus.PROPOSAL_DRAFTING,
    پروپوزال: ProjectStatus.PROPOSAL_DRAFTING,
    "تدوین پروپوزال": ProjectStatus.PROPOSAL_DRAFTING,
    "تهیه پروپوزال": ProjectStatus.PROPOSAL_DRAFTING,
    "پیش نویس پروپوزال": ProjectStatus.PROPOSAL_DRAFTING,
    "پیش‌نویس پروپوزال": ProjectStatus.PROPOSAL_DRAFTING,
    "پیشنهاد فنی": ProjectStatus.PROPOSAL_DRAFTING,

    contract_signing: ProjectStatus.CONTRACT_SIGNING,
    signing_contract: ProjectStatus.CONTRACT_SIGNING,
    contract: ProjectStatus.CONTRACT_SIGNING,
    قرارداد: ProjectStatus.CONTRACT_SIGNING,
    "عقد قرارداد": ProjectStatus.CONTRACT_SIGNING,
    "امضای قرارداد": ProjectStatus.CONTRACT_SIGNING,
    "در حال عقد قرارداد": ProjectStatus.CONTRACT_SIGNING,

    planning: ProjectStatus.PLANNING,
    "برنامه ریزی": ProjectStatus.PLANNING,
    "برنامه‌ریزی": ProjectStatus.PLANNING,
    برنامه_ریزی: ProjectStatus.PLANNING,

    active: ProjectStatus.ACTIVE,
    فعال: ProjectStatus.ACTIVE,

    on_hold: ProjectStatus.ON_HOLD,
    hold: ProjectStatus.ON_HOLD,
    متوقف: ProjectStatus.ON_HOLD,
    "متوقف موقت": ProjectStatus.ON_HOLD,

    completed: ProjectStatus.COMPLETED,
    done: ProjectStatus.COMPLETED,
    تکمیل: ProjectStatus.COMPLETED,
    "تکمیل شده": ProjectStatus.COMPLETED,
    "تکمیل‌شده": ProjectStatus.COMPLETED,

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

const getSheetByName = (
  workbook: XLSX.WorkBook,
  expectedName: string,
): XLSX.WorkSheet | null => {
  const matchedName = workbook.SheetNames.find(
    (sheetName) => normalizeKey(sheetName) === normalizeKey(expectedName),
  );

  return matchedName ? workbook.Sheets[matchedName] : null;
};

const sheetToRows = (sheet: XLSX.WorkSheet | null): RawExcelRow[] => {
  if (!sheet) return [];

  return XLSX.utils.sheet_to_json<RawExcelRow>(sheet, {
    defval: "",
    raw: true,
  });
};

const extractRowsFromWorkbook = (fileBuffer: Buffer): ExtractedWorkbookRows => {
  const workbook = XLSX.read(fileBuffer, {
    type: "buffer",
    cellDates: true,
  });

  const projectsSheet =
    getSheetByName(workbook, "Projects") ||
    (workbook.SheetNames[0] ? workbook.Sheets[workbook.SheetNames[0]] : null);
  const phasesSheet = getSheetByName(workbook, "Phases");

  return {
    projectRows: sheetToRows(projectsSheet),
    phaseRows: sheetToRows(phasesSheet),
  };
};

const normalizeProjectRows = (
  rows: RawExcelRow[],
): {
  validRows: NormalizedProjectRow[];
  errors: ImportErrorItem[];
} => {
  const validRows: NormalizedProjectRow[] = [];
  const errors: ImportErrorItem[] = [];
  const fileTitleKeys = new Set<string>();

  rows.slice(0, MAX_IMPORT_PROJECT_ROWS).forEach((row, index) => {
    const rowNumber = index + 2;
    const title = toText(
      readCell(row, ["title", "project_title", "project title", "عنوان"]),
    );
    const description = toText(
      readCell(row, ["description", "project_description", "توضیحات"]),
    );
    const rawStatus = readCell(row, ["status", "وضعیت"]);
    const rawPriority = readCell(row, ["priority", "اولویت"]);
    const rawStartDate = readCell(row, [
      "start_date",
      "start date",
      "startDate",
      "تاریخ شروع",
    ]);
    const rawDueDate = readCell(row, [
      "due_date",
      "due date",
      "dueDate",
      "تاریخ تحویل",
      "موعد",
    ]);

    const rowIsEmpty = [
      title,
      description,
      rawStatus,
      rawPriority,
      rawStartDate,
      rawDueDate,
    ].every((item) => !cellHasValue(item));

    if (rowIsEmpty) return;

    const rowErrors: string[] = [];
    const titleKey = normalizeProjectTitleKey(title);

    if (!title) {
      rowErrors.push("عنوان پروژه الزامی است.");
    } else if (fileTitleKeys.has(titleKey)) {
      rowErrors.push("عنوان پروژه در فایل اکسل تکراری است.");
    }

    const status = normalizeStatus(rawStatus);

    if (!status) {
      rowErrors.push(
        "وضعیت پروژه معتبر نیست. مقادیر مجاز: negotiating, proposal_drafting, contract_signing, planning, active, on_hold, completed, cancelled",
      );
    }

    const priority = normalizePriority(rawPriority);

    if (!priority) {
      rowErrors.push(
        "اولویت پروژه معتبر نیست. مقادیر مجاز: low, medium, high, critical",
      );
    }

    const startDate = parseDateValue(rawStartDate);

    if (!startDate) {
      rowErrors.push("start_date معتبر نیست. فرمت پیشنهادی: YYYY-MM-DD");
    }

    const dueDate = parseDateValue(rawDueDate);

    if (cellHasValue(rawDueDate) && !dueDate) {
      rowErrors.push("due_date معتبر نیست. فرمت پیشنهادی: YYYY-MM-DD");
    }

    if (startDate && dueDate && dueDate < startDate) {
      rowErrors.push("موعد تحویل نمی‌تواند قبل از تاریخ شروع باشد.");
    }

    if (rowErrors.length) {
      errors.push({
        sheet: "Projects",
        rowNumber,
        title: title || undefined,
        message: rowErrors.join(" "),
      });
      return;
    }

    fileTitleKeys.add(titleKey);
    validRows.push({
      rowNumber,
      title,
      description,
      status: status || ProjectStatus.PLANNING,
      priority: priority || ProjectPriority.MEDIUM,
      startDate: startDate as Date,
      dueDate,
    });
  });

  if (rows.length > MAX_IMPORT_PROJECT_ROWS) {
    errors.push({
      sheet: "Projects",
      rowNumber: MAX_IMPORT_PROJECT_ROWS + 2,
      message: `حداکثر ${MAX_IMPORT_PROJECT_ROWS} پروژه در هر فایل پردازش می‌شود. ردیف‌های بعدی نادیده گرفته شدند.`,
    });
  }

  return { validRows, errors };
};

const normalizePhaseRows = (
  rows: RawExcelRow[],
  projectsByTitleKey: Map<string, NormalizedProjectRow>,
): {
  validRows: NormalizedPhaseRow[];
  errors: ImportErrorItem[];
  blockedProjectKeys: Set<string>;
} => {
  const validRows: NormalizedPhaseRow[] = [];
  const errors: ImportErrorItem[] = [];
  const blockedProjectKeys = new Set<string>();
  const phaseIdentityKeys = new Set<string>();

  rows.slice(0, MAX_IMPORT_PHASE_ROWS).forEach((row, index) => {
    const rowNumber = index + 2;
    const projectTitle = toText(
      readCell(row, [
        "project_title",
        "project title",
        "project",
        "عنوان پروژه",
      ]),
    );
    const title = toText(
      readCell(row, ["phase_title", "phase title", "title", "عنوان فاز"]),
    );
    const description = toText(
      readCell(row, [
        "phase_description",
        "phase description",
        "description",
        "توضیحات فاز",
      ]),
    );
    const rawStartDate = readCell(row, [
      "phase_start_date",
      "start_date",
      "start date",
      "تاریخ شروع فاز",
    ]);
    const rawEndDate = readCell(row, [
      "phase_end_date",
      "end_date",
      "end date",
      "تاریخ پایان فاز",
    ]);
    const rawOrder = readCell(row, [
      "phase_order",
      "order",
      "ترتیب فاز",
      "ترتیب",
    ]);
    const rawExpectedRevenue = readCell(row, [
      "expected_revenue",
      "potential_revenue",
      "potential_revenue_amount",
      "درآمد پیش بینی شده",
      "درآمد احتمالی",
    ]);
    const rawExpectedExpense = readCell(row, [
      "expected_expense",
      "potential_expense",
      "potential_cost",
      "potential_cost_amount",
      "هزینه پیش بینی شده",
      "هزینه احتمالی",
    ]);
    const rawRealizedRevenue = readCell(row, [
      "realized_revenue",
      "actual_revenue",
      "درآمد محقق شده",
    ]);
    const rawRealizedExpense = readCell(row, [
      "realized_expense",
      "actual_expense",
      "actual_cost",
      "هزینه محقق شده",
    ]);
    const rawCurrency = readCell(row, ["currency", "واحد پول", "ارز"]);
    const financialNote = toText(
      readCell(row, [
        "financial_note",
        "finance_note",
        "note",
        "یادداشت مالی",
      ]),
    );

    const rowIsEmpty = [
      projectTitle,
      title,
      description,
      rawStartDate,
      rawEndDate,
      rawOrder,
      rawExpectedRevenue,
      rawExpectedExpense,
      rawRealizedRevenue,
      rawRealizedExpense,
      rawCurrency,
      financialNote,
    ].every((item) => !cellHasValue(item));

    if (rowIsEmpty) return;

    const rowErrors: string[] = [];
    const projectTitleKey = normalizeProjectTitleKey(projectTitle);
    const parentProject = projectsByTitleKey.get(projectTitleKey);

    if (!projectTitle) {
      rowErrors.push("project_title الزامی است.");
    } else if (!parentProject) {
      rowErrors.push(
        "پروژه مرجع در شیت Projects پیدا نشد یا ردیف پروژه معتبر نیست.",
      );
    }

    if (!title) {
      rowErrors.push("عنوان فاز الزامی است.");
    }

    const startDate = parseDateValue(rawStartDate);
    const endDate = parseDateValue(rawEndDate);

    if (!startDate || !endDate) {
      rowErrors.push(
        "تاریخ شروع و پایان فاز معتبر نیست. فرمت پیشنهادی: YYYY-MM-DD",
      );
    } else if (endDate < startDate) {
      rowErrors.push("تاریخ پایان فاز نمی‌تواند قبل از تاریخ شروع باشد.");
    }

    if (parentProject && startDate && startDate < parentProject.startDate) {
      rowErrors.push("تاریخ شروع فاز نمی‌تواند قبل از شروع پروژه باشد.");
    }

    if (
      parentProject?.dueDate &&
      endDate &&
      endDate > parentProject.dueDate
    ) {
      rowErrors.push("تاریخ پایان فاز نمی‌تواند بعد از موعد پروژه باشد.");
    }

    const parsedOrder = cellHasValue(rawOrder) ? Number(rawOrder) : 1;

    if (!Number.isInteger(parsedOrder) || parsedOrder < 1) {
      rowErrors.push("phase_order باید عدد صحیح بزرگ‌تر از صفر باشد.");
    }

    const expectedRevenue = parseNonNegativeNumber(rawExpectedRevenue);
    const expectedExpense = parseNonNegativeNumber(rawExpectedExpense);
    const realizedRevenue = parseNonNegativeNumber(rawRealizedRevenue);
    const realizedExpense = parseNonNegativeNumber(rawRealizedExpense);

    if (
      expectedRevenue === null ||
      expectedExpense === null ||
      realizedRevenue === null ||
      realizedExpense === null
    ) {
      rowErrors.push("مبالغ مالی فاز باید عدد مثبت یا صفر باشند.");
    }

    const phaseIdentityKey = `${projectTitleKey}::${parsedOrder}::${title.toLowerCase()}`;

    if (title && phaseIdentityKeys.has(phaseIdentityKey)) {
      rowErrors.push("این فاز با همین عنوان و ترتیب در فایل تکراری است.");
    }

    if (rowErrors.length) {
      errors.push({
        sheet: "Phases",
        rowNumber,
        title: title || projectTitle || undefined,
        message: rowErrors.join(" "),
      });

      if (projectTitleKey && projectsByTitleKey.has(projectTitleKey)) {
        blockedProjectKeys.add(projectTitleKey);
      }
      return;
    }

    phaseIdentityKeys.add(phaseIdentityKey);
    validRows.push({
      rowNumber,
      projectTitle,
      title,
      description,
      startDate: startDate as Date,
      endDate: endDate as Date,
      order: parsedOrder,
      financial: {
        expectedRevenue: expectedRevenue as number,
        expectedExpense: expectedExpense as number,
        realizedRevenue: realizedRevenue as number,
        realizedExpense: realizedExpense as number,
        currency: normalizeCurrency(rawCurrency),
        note: financialNote,
        updatedAt:
          (realizedRevenue as number) > 0 || (realizedExpense as number) > 0
            ? new Date()
            : null,
      },
    });
  });

  if (rows.length > MAX_IMPORT_PHASE_ROWS) {
    errors.push({
      sheet: "Phases",
      rowNumber: MAX_IMPORT_PHASE_ROWS + 2,
      message: `حداکثر ${MAX_IMPORT_PHASE_ROWS} فاز در هر فایل پردازش می‌شود. ردیف‌های بعدی نادیده گرفته شدند.`,
    });
  }

  return { validRows, errors, blockedProjectKeys };
};

export const importProjectsFromExcel = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const authReq = req as AuthRequest;

  if (!isManager(authReq)) {
    res.status(403).json({
      success: false,
      message: "شما دسترسی لازم برای ورود گروهی پروژه‌ها را ندارید.",
      code: "FORBIDDEN",
    });
    return;
  }

  const authUserId = getAuthUserId(authReq);

  if (!isValidObjectId(authUserId)) {
    res.status(400).json({
      success: false,
      message: "شناسه کاربر جاری معتبر نیست.",
      code: "VALIDATION_ERROR",
    });
    return;
  }

  if (!authReq.file?.buffer) {
    res.status(400).json({
      success: false,
      message: "فایل اکسل ارسال نشده است.",
      code: "EXCEL_FILE_REQUIRED",
    });
    return;
  }

  let extractedRows: ExtractedWorkbookRows;

  try {
    extractedRows = extractRowsFromWorkbook(authReq.file.buffer);
  } catch (_error) {
    res.status(400).json({
      success: false,
      message: "فایل اکسل قابل خواندن نیست یا ساختار آن معتبر نیست.",
      code: "INVALID_EXCEL_FILE",
    });
    return;
  }

  if (!extractedRows.projectRows.length) {
    res.status(400).json({
      success: false,
      message: "شیت Projects خالی است یا ردیف قابل خواندن ندارد.",
      code: "EMPTY_PROJECTS_SHEET",
    });
    return;
  }

  const normalizedProjects = normalizeProjectRows(extractedRows.projectRows);
  const projectsByTitleKey = new Map(
    normalizedProjects.validRows.map((project) => [
      normalizeProjectTitleKey(project.title),
      project,
    ]),
  );
  const normalizedPhases = normalizePhaseRows(
    extractedRows.phaseRows,
    projectsByTitleKey,
  );
  const errors: ImportErrorItem[] = [
    ...normalizedProjects.errors,
    ...normalizedPhases.errors,
  ];

  if (!normalizedProjects.validRows.length) {
    res.status(400).json({
      success: false,
      message: "هیچ پروژه معتبری برای ورود پیدا نشد.",
      code: "NO_VALID_PROJECT_ROWS",
      data: {
        staffingMode: "post_import",
        totalProjectRows: extractedRows.projectRows.length,
        totalPhaseRows: extractedRows.phaseRows.length,
        createdCount: 0,
        createdPhaseCount: 0,
        skippedCount: 0,
        failedCount: errors.length,
        created: [],
        errors,
      },
    });
    return;
  }

  const phasesByProjectKey = new Map<string, NormalizedPhaseRow[]>();

  normalizedPhases.validRows.forEach((phase) => {
    const projectKey = normalizeProjectTitleKey(phase.projectTitle);
    const currentPhases = phasesByProjectKey.get(projectKey) || [];
    currentPhases.push(phase);
    phasesByProjectKey.set(projectKey, currentPhases);
  });

  const existingProjects = await Project.find({
    title: { $in: normalizedProjects.validRows.map((row) => row.title) },
  })
    .select("title")
    .lean();

  const existingTitleSet = new Set(
    existingProjects.map((project: any) =>
      normalizeProjectTitleKey(String(project.title)),
    ),
  );

  const created: ImportCreatedItem[] = [];
  let createdPhaseCount = 0;
  let skippedCount = 0;

  for (const row of normalizedProjects.validRows) {
    const projectKey = normalizeProjectTitleKey(row.title);
    const projectPhases = (phasesByProjectKey.get(projectKey) || []).sort(
      (a, b) => a.order - b.order || a.startDate.getTime() - b.startDate.getTime(),
    );

    if (normalizedPhases.blockedProjectKeys.has(projectKey)) {
      skippedCount += 1;
      errors.push({
        sheet: "Projects",
        rowNumber: row.rowNumber,
        title: row.title,
        message:
          "پروژه به دلیل وجود خطا در یکی از فازهای مرتبط وارد نشد. خطای شیت Phases را اصلاح کنید.",
      });
      continue;
    }

    if (existingTitleSet.has(projectKey)) {
      skippedCount += 1;
      errors.push({
        sheet: "Projects",
        rowNumber: row.rowNumber,
        title: row.title,
        message: "پروژه‌ای با همین عنوان از قبل وجود دارد و این ردیف رد شد.",
      });
      continue;
    }

    let projectId: Types.ObjectId | null = null;

    try {
      const project = await Project.create({
        title: row.title,
        description: row.description,
        status: row.status,
        statusLabel: PROJECT_STATUS_LABELS[row.status],
        priority: row.priority,
        priorityLabel: PROJECT_PRIORITY_LABELS[row.priority],
        startDate: row.startDate,
        dueDate: row.dueDate,
        // Staffing is intentionally completed inside the application after import.
        ownerId: null,
        assignedUserIds: [],
        projectMembers: [],
        language: "fa",
        direction: "rtl",
        createdBy: toObjectId(authUserId),
        updatedBy: toObjectId(authUserId),
      });

      projectId = project._id as Types.ObjectId;

      if (projectPhases.length) {
        await ProjectPhase.insertMany(
          projectPhases.map((phase) => ({
            projectId: project._id,
            title: phase.title,
            description: phase.description,
            assignedUserIds: [],
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

      created.push({
        rowNumber: row.rowNumber,
        id: String(project._id),
        title: project.title,
        phaseCount: projectPhases.length,
        staffingRequired: true,
      });
      createdPhaseCount += projectPhases.length;
      existingTitleSet.add(projectKey);
    } catch (error) {
      if (projectId) {
        await Promise.all([
          ProjectPhase.deleteMany({ projectId }),
          Project.deleteOne({ _id: projectId }),
        ]);
      }

      errors.push({
        sheet: "Projects",
        rowNumber: row.rowNumber,
        title: row.title,
        message:
          error instanceof Error
            ? `ورود پروژه ناموفق بود: ${error.message}`
            : "ورود پروژه به دلیل خطای ناشناخته ناموفق بود.",
      });
    }
  }

  res.status(created.length ? 201 : 400).json({
    success: created.length > 0,
    message: created.length
      ? `${created.length} پروژه و ${createdPhaseCount} فاز بدون تخصیص افراد از اکسل وارد شد.`
      : "هیچ پروژه‌ای وارد نشد.",
    data: {
      staffingMode: "post_import",
      totalProjectRows: extractedRows.projectRows.length,
      totalPhaseRows: extractedRows.phaseRows.length,
      createdCount: created.length,
      createdPhaseCount,
      skippedCount,
      failedCount: errors.length,
      created,
      errors,
    },
  });
};
