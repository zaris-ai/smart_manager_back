import mongoose, { Document, Model, Types } from 'mongoose';

export interface AuthRefreshTokenDocument extends Document {
  userId: Types.ObjectId;
  refreshTokenHash: string;
  userAgent: string;
  ipAddress: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const authRefreshTokenSchema = new mongoose.Schema<AuthRefreshTokenDocument>(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    refreshTokenHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    userAgent: {
      type: String,
      default: '',
      trim: true,
    },

    ipAddress: {
      type: String,
      default: '',
      trim: true,
    },

    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },

    revokedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

authRefreshTokenSchema.index({ userId: 1, revokedAt: 1 });
authRefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const AuthRefreshToken =
  (mongoose.models.AuthRefreshToken as Model<AuthRefreshTokenDocument>) ||
  mongoose.model<AuthRefreshTokenDocument>(
    'AuthRefreshToken',
    authRefreshTokenSchema,
  );

export default AuthRefreshToken;