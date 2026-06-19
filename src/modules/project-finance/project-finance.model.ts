// src/modules/project-finance/project-finance.model.ts

import mongoose, { Document, Model, Schema, Types } from 'mongoose';

export enum ProjectFinanceType {
  INCOME_FORECAST = 'income_forecast',
  EXPENSE_FORECAST = 'expense_forecast',
  RECEIVABLE_INVOICE = 'receivable_invoice',
  PAYABLE_INVOICE = 'payable_invoice',
  ACTUAL_RECEIPT = 'actual_receipt',
  ACTUAL_PAYMENT = 'actual_payment',
}

export enum ProjectFinanceDirection {
  INCOME = 'income',
  EXPENSE = 'expense',
}

export enum ProjectFinanceStatus {
  DRAFT = 'draft',
  SUBMITTED = 'submitted',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  PARTIALLY_ACHIEVED = 'partially_achieved',
  ACHIEVED = 'achieved',
  OVERDUE = 'overdue',
  CANCELLED = 'cancelled',
}

export enum ProjectFinanceCurrency {
  IRR = 'IRR',
  USD = 'USD',
  EUR = 'EUR',
  AED = 'AED',
}

export const PROJECT_FINANCE_TYPE_LABELS: Record<ProjectFinanceType, string> = {
  [ProjectFinanceType.INCOME_FORECAST]: 'پیش‌بینی دریافت',
  [ProjectFinanceType.EXPENSE_FORECAST]: 'پیش‌بینی هزینه',
  [ProjectFinanceType.RECEIVABLE_INVOICE]: 'فاکتور دریافتنی',
  [ProjectFinanceType.PAYABLE_INVOICE]: 'فاکتور پرداختنی',
  [ProjectFinanceType.ACTUAL_RECEIPT]: 'دریافت واقعی',
  [ProjectFinanceType.ACTUAL_PAYMENT]: 'پرداخت واقعی',
};

export const PROJECT_FINANCE_DIRECTION_LABELS: Record<ProjectFinanceDirection, string> = {
  [ProjectFinanceDirection.INCOME]: 'درآمد / دریافت',
  [ProjectFinanceDirection.EXPENSE]: 'هزینه / پرداخت',
};

export const PROJECT_FINANCE_STATUS_LABELS: Record<ProjectFinanceStatus, string> = {
  [ProjectFinanceStatus.DRAFT]: 'پیش‌نویس',
  [ProjectFinanceStatus.SUBMITTED]: 'ثبت‌شده',
  [ProjectFinanceStatus.APPROVED]: 'تأییدشده',
  [ProjectFinanceStatus.REJECTED]: 'ردشده',
  [ProjectFinanceStatus.PARTIALLY_ACHIEVED]: 'بخشی محقق‌شده',
  [ProjectFinanceStatus.ACHIEVED]: 'محقق‌شده',
  [ProjectFinanceStatus.OVERDUE]: 'سررسید گذشته',
  [ProjectFinanceStatus.CANCELLED]: 'لغوشده',
};

const TEXT_INDEX_OPTIONS = {
  default_language: 'none',
  language_override: '__textLanguage',
};

const objectIdRef = (ref: string, required = false) => ({
  type: Schema.Types.ObjectId,
  ref,
  required,
});

const setJsonOptions = (schema: Schema): void => {
  schema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform: (_doc, ret) => {
      ret.id = ret._id?.toString();
      return ret;
    },
  });

  schema.set('toObject', {
    virtuals: true,
    versionKey: false,
    transform: (_doc, ret) => {
      ret.id = ret._id?.toString();
      return ret;
    },
  });
};

export interface ProjectFinanceAttachmentSubdocument {
  _id?: Types.ObjectId;
  fileName: string;
  originalName: string;
  fileUrl: string;
  fileType?: string;
  fileSize?: number;
  uploadedBy?: Types.ObjectId | null;
  uploadedAt: Date;
  description?: string;
}

export interface ProjectFinanceCounterpartySubdocument {
  name?: string;
  phone?: string;
  nationalIdOrEconomicCode?: string;
  address?: string;
}

export interface ProjectFinanceRecordDocument extends Document {
  projectId: Types.ObjectId;
  type: ProjectFinanceType;
  typeLabel?: string;
  direction: ProjectFinanceDirection;
  directionLabel?: string;
  status: ProjectFinanceStatus;
  statusLabel?: string;
  title: string;
  description?: string;
  amount: number;
  taxAmount: number;
  discountAmount: number;
  finalAmount: number;
  currency: ProjectFinanceCurrency;
  forecastDate?: Date | null;
  dueDate?: Date | null;
  actualDate?: Date | null;
  invoiceNumber?: string;
  invoiceDate?: Date | null;
  counterparty?: ProjectFinanceCounterpartySubdocument;
  linkedForecastId?: Types.ObjectId | null;
  linkedInvoiceId?: Types.ObjectId | null;
  achievedAmount: number;
  remainingAmount: number;
  achievementPercent: number;
  notAchievedReason?: string;
  delayReason?: string;
  rejectionReason?: string;
  managerNote?: string;
  registeredById?: Types.ObjectId | null;
  approvedById?: Types.ObjectId | null;
  approvedAt?: Date | null;
  attachments: ProjectFinanceAttachmentSubdocument[];
  language?: 'fa';
  directionUi?: 'rtl';
  createdAt: Date;
  updatedAt: Date;
}

export const getProjectFinanceDirectionByType = (
  type: ProjectFinanceType,
): ProjectFinanceDirection => {
  if (
    type === ProjectFinanceType.EXPENSE_FORECAST ||
    type === ProjectFinanceType.PAYABLE_INVOICE ||
    type === ProjectFinanceType.ACTUAL_PAYMENT
  ) {
    return ProjectFinanceDirection.EXPENSE;
  }

  return ProjectFinanceDirection.INCOME;
};

export const isProjectFinanceForecastType = (type: ProjectFinanceType): boolean => {
  return (
    type === ProjectFinanceType.INCOME_FORECAST ||
    type === ProjectFinanceType.EXPENSE_FORECAST
  );
};

export const isProjectFinanceInvoiceType = (type: ProjectFinanceType): boolean => {
  return (
    type === ProjectFinanceType.RECEIVABLE_INVOICE ||
    type === ProjectFinanceType.PAYABLE_INVOICE
  );
};

export const isProjectFinanceActualType = (type: ProjectFinanceType): boolean => {
  return (
    type === ProjectFinanceType.ACTUAL_RECEIPT ||
    type === ProjectFinanceType.ACTUAL_PAYMENT
  );
};

const ProjectFinanceAttachmentSchema = new Schema<ProjectFinanceAttachmentSubdocument>(
  {
    fileName: {
      type: String,
      required: true,
      trim: true,
    },
    originalName: {
      type: String,
      required: true,
      trim: true,
    },
    fileUrl: {
      type: String,
      required: true,
      trim: true,
    },
    fileType: {
      type: String,
      default: '',
      trim: true,
    },
    fileSize: {
      type: Number,
      default: 0,
      min: 0,
    },
    uploadedBy: {
      ...objectIdRef('User'),
      default: null,
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
    },
    description: {
      type: String,
      default: '',
      trim: true,
      maxlength: 500,
    },
  },
  {
    timestamps: false,
  },
);

const ProjectFinanceCounterpartySchema = new Schema<ProjectFinanceCounterpartySubdocument>(
  {
    name: {
      type: String,
      default: '',
      trim: true,
      maxlength: 180,
    },
    phone: {
      type: String,
      default: '',
      trim: true,
      maxlength: 40,
    },
    nationalIdOrEconomicCode: {
      type: String,
      default: '',
      trim: true,
      maxlength: 80,
    },
    address: {
      type: String,
      default: '',
      trim: true,
      maxlength: 500,
    },
  },
  {
    _id: false,
  },
);

const ProjectFinanceRecordSchema = new Schema<ProjectFinanceRecordDocument>(
  {
    projectId: {
      ...objectIdRef('Project', true),
      index: true,
    },
    type: {
      type: String,
      enum: Object.values(ProjectFinanceType),
      required: true,
      index: true,
    },
    typeLabel: {
      type: String,
      default: '',
      trim: true,
    },
    direction: {
      type: String,
      enum: Object.values(ProjectFinanceDirection),
      required: true,
      index: true,
    },
    directionLabel: {
      type: String,
      default: '',
      trim: true,
    },
    status: {
      type: String,
      enum: Object.values(ProjectFinanceStatus),
      default: ProjectFinanceStatus.SUBMITTED,
      index: true,
    },
    statusLabel: {
      type: String,
      default: PROJECT_FINANCE_STATUS_LABELS[ProjectFinanceStatus.SUBMITTED],
      trim: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 220,
    },
    description: {
      type: String,
      default: '',
      trim: true,
      maxlength: 2000,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    taxAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    discountAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    finalAmount: {
      type: Number,
      default: 0,
      min: 0,
      index: true,
    },
    currency: {
      type: String,
      enum: Object.values(ProjectFinanceCurrency),
      default: ProjectFinanceCurrency.IRR,
    },
    forecastDate: {
      type: Date,
      default: null,
      index: true,
    },
    dueDate: {
      type: Date,
      default: null,
      index: true,
    },
    actualDate: {
      type: Date,
      default: null,
      index: true,
    },
    invoiceNumber: {
      type: String,
      default: '',
      trim: true,
      maxlength: 120,
      index: true,
    },
    invoiceDate: {
      type: Date,
      default: null,
    },
    counterparty: {
      type: ProjectFinanceCounterpartySchema,
      default: {},
    },
    linkedForecastId: {
      ...objectIdRef('ProjectFinanceRecord'),
      default: null,
      index: true,
    },
    linkedInvoiceId: {
      ...objectIdRef('ProjectFinanceRecord'),
      default: null,
      index: true,
    },
    achievedAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    remainingAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    achievementPercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    notAchievedReason: {
      type: String,
      default: '',
      trim: true,
      maxlength: 2000,
    },
    delayReason: {
      type: String,
      default: '',
      trim: true,
      maxlength: 2000,
    },
    rejectionReason: {
      type: String,
      default: '',
      trim: true,
      maxlength: 2000,
    },
    managerNote: {
      type: String,
      default: '',
      trim: true,
      maxlength: 2000,
    },
    registeredById: {
      ...objectIdRef('User'),
      default: null,
      index: true,
    },
    approvedById: {
      ...objectIdRef('User'),
      default: null,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    attachments: {
      type: [ProjectFinanceAttachmentSchema],
      default: [],
    },
    language: {
      type: String,
      enum: ['fa'],
      default: 'fa',
    },
    directionUi: {
      type: String,
      enum: ['rtl'],
      default: 'rtl',
    },
  },
  {
    timestamps: true,
  },
);

ProjectFinanceRecordSchema.pre('validate', function setProjectFinanceComputedFields() {
  const financeType = this.type as ProjectFinanceType;
  const financeDirection = getProjectFinanceDirectionByType(financeType);

  this.direction = financeDirection;
  this.typeLabel = PROJECT_FINANCE_TYPE_LABELS[financeType] || financeType;
  this.directionLabel =
    PROJECT_FINANCE_DIRECTION_LABELS[financeDirection] || financeDirection;
  this.statusLabel =
    PROJECT_FINANCE_STATUS_LABELS[this.status as ProjectFinanceStatus] || this.status;

  const amount = Number(this.amount) || 0;
  const taxAmount = Number(this.taxAmount) || 0;
  const discountAmount = Number(this.discountAmount) || 0;
  const finalAmount = Math.max(amount + taxAmount - discountAmount, 0);

  this.amount = amount;
  this.taxAmount = taxAmount;
  this.discountAmount = discountAmount;
  this.finalAmount = finalAmount;

  if (isProjectFinanceActualType(financeType)) {
    this.achievedAmount = finalAmount;
    this.remainingAmount = 0;
    this.achievementPercent = finalAmount > 0 ? 100 : 0;
  } else {
    const achievedAmount = Math.min(Number(this.achievedAmount) || 0, finalAmount);
    this.achievedAmount = achievedAmount;
    this.remainingAmount = Math.max(finalAmount - achievedAmount, 0);
    this.achievementPercent = finalAmount
      ? Math.min(Math.round((achievedAmount / finalAmount) * 10000) / 100, 100)
      : 0;
  }
});

ProjectFinanceRecordSchema.index({ projectId: 1, createdAt: -1 });
ProjectFinanceRecordSchema.index({ projectId: 1, type: 1, status: 1 });
ProjectFinanceRecordSchema.index({ projectId: 1, direction: 1, dueDate: 1 });
ProjectFinanceRecordSchema.index({ projectId: 1, registeredById: 1 });
ProjectFinanceRecordSchema.index({ projectId: 1, invoiceNumber: 1 });
ProjectFinanceRecordSchema.index(
  {
    title: 'text',
    description: 'text',
    invoiceNumber: 'text',
    'counterparty.name': 'text',
    notAchievedReason: 'text',
    delayReason: 'text',
    managerNote: 'text',
  },
  TEXT_INDEX_OPTIONS,
);

setJsonOptions(ProjectFinanceRecordSchema);

export const ProjectFinanceRecord: Model<ProjectFinanceRecordDocument> =
  (mongoose.models.ProjectFinanceRecord as Model<ProjectFinanceRecordDocument>) ||
  mongoose.model<ProjectFinanceRecordDocument>(
    'ProjectFinanceRecord',
    ProjectFinanceRecordSchema,
  );

export default ProjectFinanceRecord;
