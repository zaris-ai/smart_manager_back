import mongoose, { Document, Model, Schema, Types } from 'mongoose';

export type TelegramTaskSessionStep =
  | 'select_project'
  | 'select_assignee'
  | 'select_priority'
  | 'enter_task'
  | 'select_due_date'
  | 'optional_file';

export type TelegramTaskSessionDocument = Document & {
  chatId: string;
  telegramUserId?: string;
  actorUserId: Types.ObjectId;
  step: TelegramTaskSessionStep;
  selectedProjectId?: Types.ObjectId;
  selectedAssigneeId?: Types.ObjectId;
  /** Backward compatibility with sessions created by the previous bot. */
  selectedManagerId?: Types.ObjectId;
  taskTitle?: string;
  taskDescription?: string;
  taskPriority?: 'low' | 'medium' | 'high' | 'critical';
  taskDueDate?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const telegramTaskSessionSchema = new Schema<TelegramTaskSessionDocument>(
  {
    chatId: {
      type: String,
      required: true,
      index: true,
    },
    telegramUserId: {
      type: String,
      index: true,
    },
    actorUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    step: {
      type: String,
      enum: [
        'select_project',
        'select_assignee',
        'select_priority',
        'enter_task',
        'select_due_date',
        'optional_file',
      ],
      required: true,
    },
    selectedProjectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
    },
    selectedAssigneeId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    selectedManagerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    taskTitle: {
      type: String,
      trim: true,
      maxlength: 220,
    },
    taskDescription: {
      type: String,
      trim: true,
      maxlength: 5000,
    },
    taskPriority: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium',
    },
    taskDueDate: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

telegramTaskSessionSchema.index({ chatId: 1, actorUserId: 1 }, { unique: true });
telegramTaskSessionSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

const TelegramTaskSession: Model<TelegramTaskSessionDocument> =
  (mongoose.models.TelegramTaskSession as Model<TelegramTaskSessionDocument>) ||
  mongoose.model<TelegramTaskSessionDocument>(
    'TelegramTaskSession',
    telegramTaskSessionSchema,
  );

export default TelegramTaskSession;
