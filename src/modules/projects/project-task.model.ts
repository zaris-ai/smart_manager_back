import mongoose, { Schema, Types } from 'mongoose';

export type ProjectTaskStatus =
  | 'todo'
  | 'in_progress'
  | 'blocked'
  | 'done'
  | 'cancelled';

export type ProjectPriority = 'low' | 'medium' | 'high' | 'critical';

export interface ProjectTaskDocument {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  title: string;
  description?: string;
  assignedUserIds: Types.ObjectId[];
  status: ProjectTaskStatus;
  priority: ProjectPriority;
  startDate?: Date | null;
  dueDate?: Date | null;
  completedAt?: Date | null;
  createdBy?: Types.ObjectId | null;
  updatedBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const ProjectTaskSchema = new Schema<ProjectTaskDocument>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    assignedUserIds: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    status: {
      type: String,
      enum: ['todo', 'in_progress', 'blocked', 'done', 'cancelled'],
      default: 'todo',
      index: true,
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium',
      index: true,
    },
    startDate: {
      type: Date,
      default: null,
    },
    dueDate: {
      type: Date,
      default: null,
      index: true,
    },
    completedAt: {
      type: Date,
      default: null,
      index: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        const output = ret as Record<string, any>;
        output.id = output._id?.toString();
        return output;
      },
    },
    toObject: {
      virtuals: true,
      transform: (_doc, ret) => {
        const output = ret as Record<string, any>;
        output.id = output._id?.toString();
        return output;
      },
    },
  },
);

export const ProjectTaskModel =
  mongoose.models.ProjectTask ||
  mongoose.model<ProjectTaskDocument>('ProjectTask', ProjectTaskSchema);