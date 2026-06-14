import bcrypt from 'bcryptjs';
import User, {
  UserRole,
  USER_ROLE_LABELS,
  UserStatus,
  USER_STATUS_LABELS,
} from '@/modules/users/user.model';

const getDefaultManagerConfig = () => {
  return {
    enabled: process.env.DEFAULT_ADMIN_ENABLED !== 'false',

    username: (
      process.env.DEFAULT_ADMIN_USERNAME ||
      process.env.DEFAULT_MANAGER_USERNAME ||
      'manager'
    )
      .trim()
      .toLowerCase(),

    email: (
      process.env.DEFAULT_ADMIN_EMAIL ||
      process.env.DEFAULT_MANAGER_EMAIL ||
      'manager@avid.local'
    )
      .trim()
      .toLowerCase(),

    password:
      process.env.DEFAULT_ADMIN_PASSWORD ||
      process.env.DEFAULT_MANAGER_PASSWORD ||
      'Manager123456!',

    firstName:
      process.env.DEFAULT_ADMIN_FIRST_NAME ||
      process.env.DEFAULT_MANAGER_FIRST_NAME ||
      'مدیر',

    lastName:
      process.env.DEFAULT_ADMIN_LAST_NAME ||
      process.env.DEFAULT_MANAGER_LAST_NAME ||
      'سامانه',
  };
};

/**
 * Kept the old function name because src/main.ts already calls createDefaultAdmin().
 * Business meaning is now: create the first default MANAGER.
 */
export const createDefaultAdmin = async (): Promise<void> => {
  const config = getDefaultManagerConfig();

  if (!config.enabled) {
    return;
  }

  const existingUser = await User.findOne({
    $or: [{ username: config.username }, { email: config.email }],
  });

  if (existingUser) {
    let changed = false;

    if (existingUser.role !== UserRole.MANAGER) {
      existingUser.role = UserRole.MANAGER;
      existingUser.roleLabel = USER_ROLE_LABELS[UserRole.MANAGER];
      existingUser.managerId = null;
      changed = true;
    }

    if (existingUser.status !== UserStatus.ACTIVE) {
      existingUser.status = UserStatus.ACTIVE;
      existingUser.statusLabel = USER_STATUS_LABELS[UserStatus.ACTIVE];
      existingUser.isActive = true;
      changed = true;
    }

    if (existingUser.language !== 'fa') {
      existingUser.language = 'fa';
      changed = true;
    }

    if (existingUser.direction !== 'rtl') {
      existingUser.direction = 'rtl';
      changed = true;
    }

    if (changed) {
      await existingUser.save();
      console.log('Default manager user normalized.');
    }

    return;
  }

  const passwordHash = await bcrypt.hash(config.password, 12);

  await User.create({
    firstName: config.firstName,
    lastName: config.lastName,
    fullName: `${config.firstName} ${config.lastName}`.trim(),

    username: config.username,
    email: config.email,
    phone: '',

    passwordHash,

    role: UserRole.MANAGER,
    roleLabel: USER_ROLE_LABELS[UserRole.MANAGER],

    status: UserStatus.ACTIVE,
    statusLabel: USER_STATUS_LABELS[UserStatus.ACTIVE],
    isActive: true,

    profile: {
      jobTitle: 'مدیر سامانه',
      domain: 'مدیریت',
      specialtyChapter: 'مدیریت سیستم',
      responsibilityScope: 'مدیریت کاربران، پروژه‌ها و وظایف',
      bio: 'کاربر پیش‌فرض مدیریتی سامانه',
    },

    managerId: null,

    language: 'fa',
    direction: 'rtl',

    createdBy: null,
    updatedBy: null,
    lastLoginAt: null,
  });

  console.log(`Default manager user created: ${config.username}`);
};