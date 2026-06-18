import mongoose, { Document, Model, Types } from 'mongoose';

export enum UserRole {
  BOARD = 'board',
  MANAGER = 'manager',
  EXPERT = 'expert',
}

export enum UserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended',
}

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.BOARD]: 'هیئت مدیره',
  [UserRole.MANAGER]: 'مدیر',
  [UserRole.EXPERT]: 'کارشناس',
};

export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  [UserStatus.ACTIVE]: 'فعال',
  [UserStatus.INACTIVE]: 'غیرفعال',
  [UserStatus.SUSPENDED]: 'تعلیق‌شده',
};

export interface UserProfile {
  jobTitle?: string;
  domain?: string;
  specialtyChapter?: string;
  responsibilityScope?: string;
  bio?: string;
}

export interface UserDocument extends Document {
  firstName: string;
  lastName: string;
  fullName: string;
  username: string;
  email: string;
  phone?: string;
  passwordHash: string;
  role: UserRole;
  roleLabel: string;
  status: UserStatus;
  statusLabel: string;
  isActive: boolean;
  profile: UserProfile;
  managerId?: Types.ObjectId | null;
  language: 'fa';
  direction: 'rtl';
  lastLoginAt?: Date | null;
  createdBy?: Types.ObjectId | null;
  updatedBy?: Types.ObjectId | null;
  telegramUserId?: string;
  telegramChatId?: string;
  telegramUsername?: string;
  createdAt: Date;
  updatedAt: Date;
}

const userProfileSchema = new mongoose.Schema<UserProfile>(
  {
    jobTitle: {
      type: String,
      default: '',
      trim: true,
    },
    domain: {
      type: String,
      default: '',
      trim: true,
    },
    specialtyChapter: {
      type: String,
      default: '',
      trim: true,
    },
    responsibilityScope: {
      type: String,
      default: '',
      trim: true,
    },
    bio: {
      type: String,
      default: '',
      trim: true,
      maxlength: 1000,
    },
  },
  {
    _id: false,
  },
);

const userSchema = new mongoose.Schema<UserDocument>(
  {
    firstName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    lastName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      minlength: 3,
      maxlength: 60,
      index: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    phone: {
      type: String,
      default: '',
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    role: {
      type: String,
      enum: Object.values(UserRole),
      default: UserRole.EXPERT,
      index: true,
    },
    roleLabel: {
      type: String,
      default: USER_ROLE_LABELS[UserRole.EXPERT],
      trim: true,
    },
    status: {
      type: String,
      enum: Object.values(UserStatus),
      default: UserStatus.ACTIVE,
      index: true,
    },
    statusLabel: {
      type: String,
      default: USER_STATUS_LABELS[UserStatus.ACTIVE],
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    profile: {
      type: userProfileSchema,
      default: {},
    },
    managerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
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
    lastLoginAt: {
      type: Date,
      default: null,
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
    telegramUserId: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    telegramChatId: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    telegramUsername: {
      type: String,
      default: '',
      trim: true,
      lowercase: true,
    },
  },
  {
    timestamps: true,
  },
);

userSchema.index(
  {
    telegramUserId: 1,
  },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: {
      telegramUserId: {
        $type: 'string',
        $ne: '',
      },
    },
  },
);

userSchema.index(
  {
    telegramChatId: 1,
  },
  {
    sparse: true,
    partialFilterExpression: {
      telegramChatId: {
        $type: 'string',
        $ne: '',
      },
    },
  },
);

userSchema.pre('validate', function setDerivedFields() {
  const user = this as UserDocument;

  user.fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
  user.roleLabel = USER_ROLE_LABELS[user.role] || USER_ROLE_LABELS[UserRole.EXPERT];
  user.statusLabel =
    USER_STATUS_LABELS[user.status] || USER_STATUS_LABELS[UserStatus.ACTIVE];
  user.isActive = user.status === UserStatus.ACTIVE;
  user.language = 'fa';
  user.direction = 'rtl';

  if (user.role !== UserRole.EXPERT) {
    user.managerId = null;
  }
});

userSchema.index({ role: 1, status: 1 });
userSchema.index({ isActive: 1, role: 1 });
userSchema.index({ managerId: 1, status: 1 });

const User =
  (mongoose.models.User as Model<UserDocument>) ||
  mongoose.model<UserDocument>('User', userSchema);

export default User;