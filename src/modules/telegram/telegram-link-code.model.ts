import crypto from 'crypto';
import mongoose, { Document, Model, Types } from 'mongoose';

export interface TelegramLinkCodeDocument extends Document {
  userId: Types.ObjectId;
  codeHash: string;
  expiresAt: Date;
  createdBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

export const hashTelegramLinkCode = (value: string): string => {
  return crypto
    .createHash('sha256')
    .update(String(value || '').trim().toUpperCase())
    .digest('hex');
};

const telegramLinkCodeSchema = new mongoose.Schema<TelegramLinkCodeDocument>(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    codeHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true },
);

telegramLinkCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const TelegramLinkCode =
  (mongoose.models.TelegramLinkCode as Model<TelegramLinkCodeDocument>) ||
  mongoose.model<TelegramLinkCodeDocument>(
    'TelegramLinkCode',
    telegramLinkCodeSchema,
  );

export default TelegramLinkCode;
