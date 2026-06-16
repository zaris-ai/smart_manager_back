// src/modules/projects/project.model.ts

import mongoose, { Document, Model, Schema, Types } from 'mongoose';

export enum ProjectStatus {
  NEGOTIATING = 'negotiating',
  PROPOSAL_DRAFTING = 'proposal_drafting',
  CONTRACT_SIGNING = 'contract_signing',
  PLANNING = 'planning',
  ACTIVE = 'active',
  ON_HOLD = 'on_hold',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export enum ProjectPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export enum ProjectTaskStatus {
  TODO = 'todo',
  IN_PROGRESS = 'in_progress',
  BLOCKED = 'blocked',
  DONE = 'done',
  CANCELLED = 'cancelled',
}

export enum ProjectFileCategory {
  REQUIREMENTS = 'requirements',
  CONTRACTS = 'contracts',
  DESIGN = 'design',
  REPORTS = 'reports',
  MEETING_NOTES = 'meeting_notes',
  DELIVERY = 'delivery',
  TASK_ATTACHMENT = 'task_attachment',
  OTHER = 'other',
}

export enum ProjectCalendarEventType {
  PROJECT_START = 'project_start',
  PROJECT_DUE = 'project_due',
  TASK_START = 'task_start',
  TASK_DUE = 'task_due',
}

export enum ProjectSource {
  WEB = 'web',
  TELEGRAM_BOT = 'telegram_bot',
}

export type ProjectFileTranscriptionStatus =
  | 'not_applicable'
  | 'completed'
  | 'failed';

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  [ProjectStatus.NEGOTIATING]: 'در حال مذاکره',
  [ProjectStatus.PROPOSAL_DRAFTING]: 'تدوین پروپوزال',
  [ProjectStatus.CONTRACT_SIGNING]: 'عقد قرارداد',
  [ProjectStatus.PLANNING]: 'برنامه‌ریزی',
  [ProjectStatus.ACTIVE]: 'فعال',
  [ProjectStatus.ON_HOLD]: 'متوقف موقت',
  [ProjectStatus.COMPLETED]: 'تکمیل‌شده',
  [ProjectStatus.CANCELLED]: 'لغوشده',
};

export const PROJECT_PRIORITY_LABELS: Record<ProjectPriority, string> = {
  [ProjectPriority.LOW]: 'کم',
  [ProjectPriority.MEDIUM]: 'متوسط',
  [ProjectPriority.HIGH]: 'زیاد',
  [ProjectPriority.CRITICAL]: 'بحرانی',
};

export const PROJECT_TASK_STATUS_LABELS: Record<ProjectTaskStatus, string> = {
  [ProjectTaskStatus.TODO]: 'برای انجام',
  [ProjectTaskStatus.IN_PROGRESS]: 'در حال انجام',
  [ProjectTaskStatus.BLOCKED]: 'مسدود',
  [ProjectTaskStatus.DONE]: 'انجام‌شده',
  [ProjectTaskStatus.CANCELLED]: 'لغوشده',
};

export const PROJECT_FILE_CATEGORY_LABELS: Record<ProjectFileCategory, string> = {
  [ProjectFileCategory.REQUIREMENTS]: 'نیازمندی‌ها',
  [ProjectFileCategory.CONTRACTS]: 'قراردادها',
  [ProjectFileCategory.DESIGN]: 'طراحی',
  [ProjectFileCategory.REPORTS]: 'گزارش‌ها',
  [ProjectFileCategory.MEETING_NOTES]: 'صورت‌جلسه',
  [ProjectFileCategory.DELIVERY]: 'تحویل',
  [ProjectFileCategory.TASK_ATTACHMENT]: 'پیوست وظیفه',
  [ProjectFileCategory.OTHER]: 'سایر',
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

export interface ProjectDocument extends Document {
  title: string;
  description?: string;
  status: ProjectStatus;
  statusLabel?: string;
  priority: ProjectPriority;
  priorityLabel?: string;
  startDate: Date;
  dueDate?: Date | null;
  ownerId?: Types.ObjectId | null;
  assignedUserIds: Types.ObjectId[];
  createdBy?: Types.ObjectId | null;
  updatedBy?: Types.ObjectId | null;
  language?: 'fa';
  direction?: 'rtl';
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectTaskDocument extends Document {
  projectId: Types.ObjectId;
  title: string;
  description?: string;
  assignedUserIds: Types.ObjectId[];
  status: ProjectTaskStatus;
  statusLabel?: string;
  priority: ProjectPriority;
  priorityLabel?: string;
  startDate?: Date | null;
  dueDate?: Date | null;
  completedAt?: Date | null;
  createdBy?: Types.ObjectId | null;
  updatedBy?: Types.ObjectId | null;
  source?: ProjectSource | string;
  telegramChatId?: string;
  telegramMessageId?: number | null;
  language?: 'fa';
  direction?: 'rtl';
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectProgressNoteDocument extends Document {
  projectId: Types.ObjectId;
  authorId?: Types.ObjectId | null;
  registeredById?: Types.ObjectId | null;
  note: string;
  progressPercent?: number | null;
  statusSnapshot?: ProjectStatus | string;
  source?: ProjectSource | string;
  telegramChatId?: string;
  telegramMessageId?: number | null;
  language?: 'fa';
  direction?: 'rtl';
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectFileDocument extends Document {
  projectId: Types.ObjectId;
  progressNoteId?: Types.ObjectId | null;
  taskId?: Types.ObjectId | null;
  uploadedBy?: Types.ObjectId | null;
  fileName: string;
  originalName: string;
  fileUrl: string;
  fileType?: string;
  fileSize?: number;
  category: ProjectFileCategory;
  categoryLabel?: string;
  source?: ProjectSource | string;
  telegramFileId?: string;
  telegramFileUniqueId?: string;
  telegramMessageId?: number | null;
  telegramChatId?: string;
  telegramAttachmentKind?: string;
  transcriptionStatus?: ProjectFileTranscriptionStatus;
  transcriptionText?: string;
  transcriptionError?: string;
  transcriptionModel?: string;
  transcriptionLanguage?: string;
  transcribedAt?: Date | null;
  language?: 'fa';
  direction?: 'rtl';
  createdAt: Date;
  updatedAt: Date;
}

const ProjectSchema = new Schema<ProjectDocument>(
  {
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
    },
    status: {
      type: String,
      enum: Object.values(ProjectStatus),
      default: ProjectStatus.ACTIVE,
      required: true,
    },
    statusLabel: {
      type: String,
      default: PROJECT_STATUS_LABELS[ProjectStatus.ACTIVE],
    },
    priority: {
      type: String,
      enum: Object.values(ProjectPriority),
      default: ProjectPriority.MEDIUM,
      required: true,
    },
    priorityLabel: {
      type: String,
      default: PROJECT_PRIORITY_LABELS[ProjectPriority.MEDIUM],
    },
    startDate: {
      type: Date,
      default: Date.now,
    },
    dueDate: {
      type: Date,
      default: null,
    },
    ownerId: {
      ...objectIdRef('User'),
      default: null,
    },
    assignedUserIds: [
      {
        ...objectIdRef('User'),
      },
    ],
    createdBy: {
      ...objectIdRef('User'),
      default: null,
    },
    updatedBy: {
      ...objectIdRef('User'),
      default: null,
    },
    language: {
      type: String,
      default: 'fa',
    },
    direction: {
      type: String,
      default: 'rtl',
    },
  },
  {
    timestamps: true,
  },
);

ProjectSchema.pre('validate', function setProjectLabels() {
  this.statusLabel =
    PROJECT_STATUS_LABELS[this.status as ProjectStatus] || this.status;

  this.priorityLabel =
    PROJECT_PRIORITY_LABELS[this.priority as ProjectPriority] || this.priority;
});

ProjectSchema.index(
  { title: 'text', description: 'text' },
  TEXT_INDEX_OPTIONS,
);
ProjectSchema.index({ status: 1, priority: 1 });
ProjectSchema.index({ ownerId: 1 });
ProjectSchema.index({ assignedUserIds: 1 });
ProjectSchema.index({ dueDate: 1 });

setJsonOptions(ProjectSchema);

const ProjectTaskSchema = new Schema<ProjectTaskDocument>(
  {
    projectId: {
      ...objectIdRef('Project', true),
      index: true,
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
    },
    assignedUserIds: [
      {
        ...objectIdRef('User'),
      },
    ],
    status: {
      type: String,
      enum: Object.values(ProjectTaskStatus),
      default: ProjectTaskStatus.TODO,
      required: true,
    },
    statusLabel: {
      type: String,
      default: PROJECT_TASK_STATUS_LABELS[ProjectTaskStatus.TODO],
    },
    priority: {
      type: String,
      enum: Object.values(ProjectPriority),
      default: ProjectPriority.MEDIUM,
      required: true,
    },
    priorityLabel: {
      type: String,
      default: PROJECT_PRIORITY_LABELS[ProjectPriority.MEDIUM],
    },
    startDate: {
      type: Date,
      default: null,
    },
    dueDate: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    createdBy: {
      ...objectIdRef('User'),
      default: null,
    },
    updatedBy: {
      ...objectIdRef('User'),
      default: null,
    },
    source: {
      type: String,
      default: ProjectSource.WEB,
    },
    telegramChatId: {
      type: String,
      default: '',
    },
    telegramMessageId: {
      type: Number,
      default: null,
    },
    language: {
      type: String,
      default: 'fa',
    },
    direction: {
      type: String,
      default: 'rtl',
    },
  },
  {
    timestamps: true,
  },
);

ProjectTaskSchema.pre('validate', function setProjectTaskLabels() {
  this.statusLabel =
    PROJECT_TASK_STATUS_LABELS[this.status as ProjectTaskStatus] || this.status;

  this.priorityLabel =
    PROJECT_PRIORITY_LABELS[this.priority as ProjectPriority] || this.priority;

  if (this.status === ProjectTaskStatus.DONE && !this.completedAt) {
    this.completedAt = new Date();
  }

  if (this.status !== ProjectTaskStatus.DONE) {
    this.completedAt = null;
  }
});

ProjectTaskSchema.index({ projectId: 1, status: 1 });
ProjectTaskSchema.index({ projectId: 1, assignedUserIds: 1 });
ProjectTaskSchema.index({ assignedUserIds: 1, status: 1 });
ProjectTaskSchema.index({ createdBy: 1, status: 1 });
ProjectTaskSchema.index({ dueDate: 1 });
ProjectTaskSchema.index(
  { title: 'text', description: 'text' },
  TEXT_INDEX_OPTIONS,
);

setJsonOptions(ProjectTaskSchema);

const ProjectProgressNoteSchema = new Schema<ProjectProgressNoteDocument>(
  {
    projectId: {
      ...objectIdRef('Project', true),
      index: true,
    },
    authorId: {
      ...objectIdRef('User'),
      default: null,
    },
    registeredById: {
      ...objectIdRef('User'),
      default: null,
    },
    note: {
      type: String,
      required: true,
      trim: true,
    },
    progressPercent: {
      type: Number,
      min: 0,
      max: 100,
      default: null,
    },
    statusSnapshot: {
      type: String,
      default: '',
    },
    source: {
      type: String,
      default: ProjectSource.WEB,
    },
    telegramChatId: {
      type: String,
      default: '',
    },
    telegramMessageId: {
      type: Number,
      default: null,
    },
    language: {
      type: String,
      default: 'fa',
    },
    direction: {
      type: String,
      default: 'rtl',
    },
  },
  {
    timestamps: true,
  },
);

ProjectProgressNoteSchema.index({ projectId: 1, createdAt: -1 });
ProjectProgressNoteSchema.index({ authorId: 1 });
ProjectProgressNoteSchema.index({ registeredById: 1 });
ProjectProgressNoteSchema.index({ note: 'text' }, TEXT_INDEX_OPTIONS);

setJsonOptions(ProjectProgressNoteSchema);

const ProjectFileSchema = new Schema<ProjectFileDocument>(
  {
    projectId: {
      ...objectIdRef('Project', true),
      index: true,
    },
    progressNoteId: {
      ...objectIdRef('ProjectProgressNote'),
      default: null,
      index: true,
    },
    taskId: {
      ...objectIdRef('ProjectTask'),
      default: null,
      index: true,
    },
    uploadedBy: {
      ...objectIdRef('User'),
      default: null,
    },
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
    category: {
      type: String,
      enum: Object.values(ProjectFileCategory),
      default: ProjectFileCategory.OTHER,
      required: true,
    },
    categoryLabel: {
      type: String,
      default: PROJECT_FILE_CATEGORY_LABELS[ProjectFileCategory.OTHER],
    },
    source: {
      type: String,
      default: ProjectSource.WEB,
    },
    telegramFileId: {
      type: String,
      default: '',
    },
    telegramFileUniqueId: {
      type: String,
      default: '',
    },
    telegramMessageId: {
      type: Number,
      default: null,
    },
    telegramChatId: {
      type: String,
      default: '',
    },
    telegramAttachmentKind: {
      type: String,
      default: '',
    },
    transcriptionStatus: {
      type: String,
      enum: ['not_applicable', 'completed', 'failed'],
      default: 'not_applicable',
      index: true,
    },
    transcriptionText: {
      type: String,
      default: '',
      trim: true,
    },
    transcriptionError: {
      type: String,
      default: '',
      trim: true,
    },
    transcriptionModel: {
      type: String,
      default: '',
      trim: true,
    },
    transcriptionLanguage: {
      type: String,
      default: '',
      trim: true,
    },
    transcribedAt: {
      type: Date,
      default: null,
    },
    language: {
      type: String,
      default: 'fa',
    },
    direction: {
      type: String,
      default: 'rtl',
    },
  },
  {
    timestamps: true,
  },
);

ProjectFileSchema.pre('validate', function setProjectFileLabels() {
  this.categoryLabel =
    PROJECT_FILE_CATEGORY_LABELS[this.category as ProjectFileCategory] ||
    this.category ||
    PROJECT_FILE_CATEGORY_LABELS[ProjectFileCategory.OTHER];
});

ProjectFileSchema.index({ projectId: 1, category: 1 });
ProjectFileSchema.index({ projectId: 1, taskId: 1 });
ProjectFileSchema.index({ projectId: 1, progressNoteId: 1 });
ProjectFileSchema.index({ taskId: 1, createdAt: -1 });
ProjectFileSchema.index({ progressNoteId: 1, createdAt: -1 });
ProjectFileSchema.index({ uploadedBy: 1 });
ProjectFileSchema.index(
  { originalName: 'text', fileName: 'text', transcriptionText: 'text' },
  TEXT_INDEX_OPTIONS,
);

setJsonOptions(ProjectFileSchema);

export const Project: Model<ProjectDocument> =
  (mongoose.models.Project as Model<ProjectDocument>) ||
  mongoose.model<ProjectDocument>('Project', ProjectSchema);

export const ProjectTask: Model<ProjectTaskDocument> =
  (mongoose.models.ProjectTask as Model<ProjectTaskDocument>) ||
  mongoose.model<ProjectTaskDocument>('ProjectTask', ProjectTaskSchema);

export const ProjectProgressNote: Model<ProjectProgressNoteDocument> =
  (mongoose.models.ProjectProgressNote as Model<ProjectProgressNoteDocument>) ||
  mongoose.model<ProjectProgressNoteDocument>(
    'ProjectProgressNote',
    ProjectProgressNoteSchema,
  );

export const ProjectFile: Model<ProjectFileDocument> =
  (mongoose.models.ProjectFile as Model<ProjectFileDocument>) ||
  mongoose.model<ProjectFileDocument>('ProjectFile', ProjectFileSchema);

export default Project;