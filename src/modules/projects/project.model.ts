import mongoose, { Document, Model, Types } from 'mongoose';

export enum ProjectStatus {
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
  OTHER = 'other',
}

export enum ProjectCalendarEventType {
  PROJECT_START = 'project_start',
  PROJECT_DUE = 'project_due',
  TASK_START = 'task_start',
  TASK_DUE = 'task_due',
}

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
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
  [ProjectFileCategory.MEETING_NOTES]: 'صورت‌جلسه‌ها',
  [ProjectFileCategory.DELIVERY]: 'تحویل',
  [ProjectFileCategory.OTHER]: 'سایر',
};

export interface ProjectDocument extends Document {
  title: string;
  description: string;
  status: ProjectStatus;
  statusLabel: string;
  priority: ProjectPriority;
  priorityLabel: string;
  startDate: Date;
  dueDate: Date | null;
  ownerId: Types.ObjectId;
  assignedUserIds: Types.ObjectId[];
  language: 'fa';
  direction: 'rtl';
  createdBy?: Types.ObjectId | null;
  updatedBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectTaskDocument extends Document {
  projectId: Types.ObjectId;
  title: string;
  description: string;
  assignedUserIds: Types.ObjectId[];
  status: ProjectTaskStatus;
  statusLabel: string;
  priority: ProjectPriority;
  priorityLabel: string;
  startDate: Date | null;
  dueDate: Date | null;
  completedAt: Date | null;
  language: 'fa';
  direction: 'rtl';
  createdBy?: Types.ObjectId | null;
  updatedBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectProgressNoteDocument extends Document {
  projectId: Types.ObjectId;
  authorId: Types.ObjectId;
  note: string;
  progressPercent: number | null;
  statusSnapshot: ProjectStatus | string;
  language: 'fa';
  direction: 'rtl';
  source: 'web' | 'telegram_bot';
  telegramChatId?: string;
  telegramMessageId?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectFileDocument extends Document {
  projectId: Types.ObjectId;
  uploadedBy: Types.ObjectId;
  fileName: string;
  originalName: string;
  fileUrl: string;
  fileType: string;
  fileSize: number;
  category: ProjectFileCategory;
  categoryLabel: string;
  language: 'fa';
  direction: 'rtl';
  source: 'web' | 'telegram_bot';
  telegramFileId?: string;
  telegramFileUniqueId?: string;
  telegramMessageId?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const projectSchema = new mongoose.Schema<ProjectDocument>(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 180,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    status: {
      type: String,
      enum: Object.values(ProjectStatus),
      default: ProjectStatus.PLANNING,
      index: true,
    },
    statusLabel: {
      type: String,
      default: PROJECT_STATUS_LABELS[ProjectStatus.PLANNING],
      trim: true,
    },
    priority: {
      type: String,
      enum: Object.values(ProjectPriority),
      default: ProjectPriority.MEDIUM,
      index: true,
    },
    priorityLabel: {
      type: String,
      default: PROJECT_PRIORITY_LABELS[ProjectPriority.MEDIUM],
      trim: true,
    },
    startDate: {
      type: Date,
      required: true,
      index: true,
    },
    dueDate: {
      type: Date,
      default: null,
      index: true,
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    assignedUserIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        index: true,
      },
    ],
    language: {
      type: String,
      enum: ['fa'],
      default: 'fa',
    },
    direction: {
      type: String,
      enum: ['rtl'],
      default: 'rtl',
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

const projectTaskSchema = new mongoose.Schema<ProjectTaskDocument>(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 180,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    assignedUserIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        index: true,
      },
    ],
    status: {
      type: String,
      enum: Object.values(ProjectTaskStatus),
      default: ProjectTaskStatus.TODO,
      index: true,
    },
    statusLabel: {
      type: String,
      default: PROJECT_TASK_STATUS_LABELS[ProjectTaskStatus.TODO],
      trim: true,
    },
    priority: {
      type: String,
      enum: Object.values(ProjectPriority),
      default: ProjectPriority.MEDIUM,
      index: true,
    },
    priorityLabel: {
      type: String,
      default: PROJECT_PRIORITY_LABELS[ProjectPriority.MEDIUM],
      trim: true,
    },
    startDate: {
      type: Date,
      default: null,
      index: true,
    },
    dueDate: {
      type: Date,
      default: null,
      index: true,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    language: {
      type: String,
      enum: ['fa'],
      default: 'fa',
    },
    direction: {
      type: String,
      enum: ['rtl'],
      default: 'rtl',
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

const projectProgressNoteSchema =
  new mongoose.Schema<ProjectProgressNoteDocument>(
    {
      projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Project',
        required: true,
        index: true,
      },
      authorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
      },
      note: {
        type: String,
        required: true,
        trim: true,
        maxlength: 3000,
      },
      progressPercent: {
        type: Number,
        min: 0,
        max: 100,
        default: null,
      },
      statusSnapshot: {
        type: String,
        default: ProjectStatus.PLANNING,
        trim: true,
      },
      source: {
        type: String,
        enum: ['web', 'telegram_bot'],
        default: 'web',
        index: true,
      },
      telegramChatId: {
        type: String,
        default: '',
        trim: true,
        index: true,
      },
      telegramMessageId: {
        type: Number,
        default: null,
      },
      language: {
        type: String,
        enum: ['fa'],
        default: 'fa',
      },
      direction: {
        type: String,
        enum: ['rtl'],
        default: 'rtl',
      },
    },
    {
      timestamps: true,
    },
  );

const projectFileSchema = new mongoose.Schema<ProjectFileDocument>(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
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
    },
    category: {
      type: String,
      enum: Object.values(ProjectFileCategory),
      default: ProjectFileCategory.OTHER,
      index: true,
    },
    categoryLabel: {
      type: String,
      default: PROJECT_FILE_CATEGORY_LABELS[ProjectFileCategory.OTHER],
      trim: true,
    },
    language: {
      type: String,
      enum: ['fa'],
      default: 'fa',
    },
    direction: {
      type: String,
      enum: ['rtl'],
      default: 'rtl',
    },
    source: {
      type: String,
      enum: ['web', 'telegram_bot'],
      default: 'web',
      index: true,
    },
    telegramFileId: {
      type: String,
      default: '',
      trim: true,
    },
    telegramFileUniqueId: {
      type: String,
      default: '',
      trim: true,
    },
    telegramMessageId: {
      type: Number,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

projectSchema.index({ status: 1, priority: 1, dueDate: 1 });
projectSchema.index({ assignedUserIds: 1, status: 1 });
projectSchema.index({ ownerId: 1, status: 1 });

projectTaskSchema.index({ projectId: 1, status: 1 });
projectTaskSchema.index({ assignedUserIds: 1, status: 1 });
projectTaskSchema.index({ dueDate: 1, status: 1 });

projectProgressNoteSchema.index({ projectId: 1, source: 1, createdAt: -1 });
projectFileSchema.index({ projectId: 1, source: 1, createdAt: -1 });

export const Project =
  (mongoose.models.Project as Model<ProjectDocument>) ||
  mongoose.model<ProjectDocument>('Project', projectSchema);

export const ProjectTask =
  (mongoose.models.ProjectTask as Model<ProjectTaskDocument>) ||
  mongoose.model<ProjectTaskDocument>('ProjectTask', projectTaskSchema);

export const ProjectProgressNote =
  (mongoose.models.ProjectProgressNote as Model<ProjectProgressNoteDocument>) ||
  mongoose.model<ProjectProgressNoteDocument>(
    'ProjectProgressNote',
    projectProgressNoteSchema,
  );

export const ProjectFile =
  (mongoose.models.ProjectFile as Model<ProjectFileDocument>) ||
  mongoose.model<ProjectFileDocument>('ProjectFile', projectFileSchema);

export default Project;