// src/modules/project-roles/project-role.model.ts

import mongoose, { Document, Model, Schema, Types } from 'mongoose';

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

export interface ProjectRoleDocument extends Document {
  title: string;
  normalizedTitle: string;
  description?: string;
  isActive: boolean;
  sortOrder: number;
  createdBy?: Types.ObjectId | null;
  updatedBy?: Types.ObjectId | null;
  language?: 'fa';
  direction?: 'rtl';
  createdAt: Date;
  updatedAt: Date;
}

const ProjectRoleSchema = new Schema<ProjectRoleDocument>(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    normalizedTitle: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    description: {
      type: String,
      default: '',
      trim: true,
      maxlength: 500,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
      index: true,
    },
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

ProjectRoleSchema.pre('validate', function normalizeProjectRoleTitle() {
  this.title = String(this.title || '').trim().replace(/\s+/g, ' ');
  this.normalizedTitle = this.title.toLowerCase();
});

ProjectRoleSchema.index({ normalizedTitle: 1 }, { unique: true });
ProjectRoleSchema.index({ isActive: 1, sortOrder: 1, title: 1 });

setJsonOptions(ProjectRoleSchema);

export const ProjectRole: Model<ProjectRoleDocument> =
  (mongoose.models.ProjectRole as Model<ProjectRoleDocument>) ||
  mongoose.model<ProjectRoleDocument>('ProjectRole', ProjectRoleSchema);

export default ProjectRole;
