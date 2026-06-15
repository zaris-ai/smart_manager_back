import mongoose, { Schema, Types } from 'mongoose';

export type ProjectFileCategory =
  | 'requirements'
  | 'contracts'
  | 'design'
  | 'reports'
  | 'meeting_notes'
  | 'delivery'
  | 'task_attachment'
  | 'other';

export interface ProjectFileDocument {
  _id: Types.ObjectId;
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
  createdAt: Date;
  updatedAt: Date;
}

const ProjectFileSchema = new Schema<ProjectFileDocument>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    progressNoteId: {
      type: Schema.Types.ObjectId,
      ref: 'ProjectProgressNote',
      default: null,
      index: true,
    },
    taskId: {
      type: Schema.Types.ObjectId,
      ref: 'ProjectTask',
      default: null,
      index: true,
    },
    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
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
    },
    fileSize: {
      type: Number,
      default: 0,
    },
    category: {
      type: String,
      enum: [
        'requirements',
        'contracts',
        'design',
        'reports',
        'meeting_notes',
        'delivery',
        'task_attachment',
        'other',
      ],
      default: 'other',
      index: true,
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

export const ProjectFileModel =
  mongoose.models.ProjectFile ||
  mongoose.model<ProjectFileDocument>('ProjectFile', ProjectFileSchema);