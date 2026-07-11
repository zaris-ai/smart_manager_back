import Joi from 'joi';
import { UserPermission, UserRole, UserStatus } from '@/modules/users/user.constants';

const objectIdSchema = Joi.string().hex().length(24).messages({
  'string.hex': 'شناسه واردشده معتبر نیست.',
  'string.length': 'شناسه باید ۲۴ کاراکتر باشد.',
});

const usernameSchema = Joi.string()
  .trim()
  .lowercase()
  .min(3)
  .max(50)
  .pattern(/^[a-zA-Z0-9._-]+$/)
  .messages({
    'string.empty': 'نام کاربری الزامی است.',
    'string.min': 'نام کاربری باید حداقل ۳ کاراکتر باشد.',
    'string.max': 'نام کاربری نباید بیشتر از ۵۰ کاراکتر باشد.',
    'string.pattern.base': 'نام کاربری فقط می‌تواند شامل حروف انگلیسی، عدد، نقطه، خط تیره و آندرلاین باشد.',
  });

const profileSchema = Joi.object({
  jobTitle: Joi.string().trim().max(100).allow('').messages({
    'string.max': 'عنوان شغلی نباید بیشتر از ۱۰۰ کاراکتر باشد.',
  }),
  domain: Joi.string().trim().max(100).allow('').messages({
    'string.max': 'دامنه کاری نباید بیشتر از ۱۰۰ کاراکتر باشد.',
  }),
  specialtyChapter: Joi.string().trim().max(100).allow('').messages({
    'string.max': 'حوزه تخصصی نباید بیشتر از ۱۰۰ کاراکتر باشد.',
  }),
  responsibilityScope: Joi.string().trim().max(1000).allow('').messages({
    'string.max': 'شرح مسئولیت نباید بیشتر از ۱۰۰۰ کاراکتر باشد.',
  }),
  bio: Joi.string().trim().max(1000).allow('').messages({
    'string.max': 'توضیحات کاربر نباید بیشتر از ۱۰۰۰ کاراکتر باشد.',
  }),
});

const workUnitSchema = Joi.object({
  isIndependentWorkUnit: Joi.boolean().default(true),
  unitCode: Joi.string().trim().max(50).allow('').messages({
    'string.max': 'کد واحد کاری نباید بیشتر از ۵۰ کاراکتر باشد.',
  }),
  responsibilities: Joi.array().items(Joi.string().trim().max(300)).default([]).messages({
    'array.base': 'مسئولیت‌ها باید به صورت آرایه ارسال شوند.',
  }),
  limits: Joi.array().items(Joi.string().trim().max(300)).default([]).messages({
    'array.base': 'محدودیت‌ها باید به صورت آرایه ارسال شوند.',
  }),
  defaultReportRequired: Joi.boolean().default(true),
});

export const createUserSchema = {
  body: Joi.object({
    firstName: Joi.string().trim().min(2).max(80).required().messages({
      'any.required': 'نام الزامی است.',
      'string.empty': 'نام الزامی است.',
      'string.min': 'نام باید حداقل ۲ کاراکتر باشد.',
      'string.max': 'نام نباید بیشتر از ۸۰ کاراکتر باشد.',
    }),

    lastName: Joi.string().trim().min(2).max(80).required().messages({
      'any.required': 'نام خانوادگی الزامی است.',
      'string.empty': 'نام خانوادگی الزامی است.',
      'string.min': 'نام خانوادگی باید حداقل ۲ کاراکتر باشد.',
      'string.max': 'نام خانوادگی نباید بیشتر از ۸۰ کاراکتر باشد.',
    }),

    username: usernameSchema.required().messages({
      'any.required': 'نام کاربری الزامی است.',
    }),

    email: Joi.string().trim().lowercase().email().required().messages({
      'any.required': 'ایمیل الزامی است.',
      'string.empty': 'ایمیل الزامی است.',
      'string.email': 'فرمت ایمیل معتبر نیست.',
    }),

    phone: Joi.string().trim().max(30).allow('').messages({
      'string.max': 'شماره تماس نباید بیشتر از ۳۰ کاراکتر باشد.',
    }),

    password: Joi.string().min(8).max(128).required().messages({
      'any.required': 'رمز عبور الزامی است.',
      'string.empty': 'رمز عبور الزامی است.',
      'string.min': 'رمز عبور باید حداقل ۸ کاراکتر باشد.',
      'string.max': 'رمز عبور نباید بیشتر از ۱۲۸ کاراکتر باشد.',
    }),

    role: Joi.string()
      .valid(...Object.values(UserRole))
      .default(UserRole.EMPLOYEE)
      .messages({
        'any.only': 'نقش انتخاب‌شده معتبر نیست.',
      }),

    accessLevel: Joi.number().integer().min(1).max(100).optional().messages({
      'number.base': 'سطح دسترسی باید عدد باشد.',
      'number.integer': 'سطح دسترسی باید عدد صحیح باشد.',
      'number.min': 'سطح دسترسی نمی‌تواند کمتر از ۱ باشد.',
      'number.max': 'سطح دسترسی نمی‌تواند بیشتر از ۱۰۰ باشد.',
    }),

    permissions: Joi.array()
      .items(Joi.string().valid(...Object.values(UserPermission)))
      .optional()
      .messages({
        'array.base': 'دسترسی‌ها باید به صورت آرایه ارسال شوند.',
        'any.only': 'یکی از دسترسی‌های ارسال‌شده معتبر نیست.',
      }),

    telegramUserId: Joi.forbidden().messages({
      'any.unknown': 'شناسه تلگرام فقط از طریق کد اتصال ربات ثبت می‌شود.',
    }),

    telegramChatId: Joi.forbidden().messages({
      'any.unknown': 'شناسه چت تلگرام فقط از طریق کد اتصال ربات ثبت می‌شود.',
    }),

    telegramUsername: Joi.forbidden().messages({
      'any.unknown': 'نام کاربری تلگرام فقط از طریق کد اتصال ربات ثبت می‌شود.',
    }),
    profile: profileSchema.default({}),

    workUnit: workUnitSchema.default({
      isIndependentWorkUnit: true,
      responsibilities: [],
      limits: [],
      defaultReportRequired: true,
    }),

    managerId: objectIdSchema.allow(null).optional(),
  }),
};

export const updateUserSchema = {
  params: Joi.object({
    id: objectIdSchema.required().messages({
      'any.required': 'شناسه کاربر الزامی است.',
    }),
  }),

  body: Joi.object({
    firstName: Joi.string().trim().min(2).max(80).optional(),
    lastName: Joi.string().trim().min(2).max(80).optional(),
    username: usernameSchema.optional(),
    email: Joi.string().trim().lowercase().email().optional().messages({
      'string.email': 'فرمت ایمیل معتبر نیست.',
    }),
    phone: Joi.string().trim().max(30).allow('').optional(),

    role: Joi.string()
      .valid(...Object.values(UserRole))
      .optional()
      .messages({
        'any.only': 'نقش انتخاب‌شده معتبر نیست.',
      }),

    accessLevel: Joi.number().integer().min(1).max(100).optional(),

    permissions: Joi.array()
      .items(Joi.string().valid(...Object.values(UserPermission)))
      .optional(),

    profile: profileSchema.optional(),
    workUnit: workUnitSchema.optional(),
    managerId: objectIdSchema.allow(null).optional(),
    telegramUserId: Joi.forbidden(),
    telegramChatId: Joi.forbidden(),
    telegramUsername: Joi.forbidden(),
  })
    .min(1)
    .messages({
      'object.min': 'حداقل یک فیلد برای ویرایش باید ارسال شود.',
    }),
};

export const listUsersSchema = {
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1).messages({
      'number.base': 'شماره صفحه باید عدد باشد.',
      'number.min': 'شماره صفحه نمی‌تواند کمتر از ۱ باشد.',
    }),

    limit: Joi.number().integer().min(1).max(100).default(20).messages({
      'number.base': 'تعداد آیتم‌ها باید عدد باشد.',
      'number.max': 'تعداد آیتم‌ها در هر صفحه نمی‌تواند بیشتر از ۱۰۰ باشد.',
    }),

    search: Joi.string().trim().max(100).allow('').optional(),

    role: Joi.string()
      .valid(...Object.values(UserRole))
      .optional()
      .messages({
        'any.only': 'نقش انتخاب‌شده معتبر نیست.',
      }),

    status: Joi.string()
      .valid(...Object.values(UserStatus))
      .optional()
      .messages({
        'any.only': 'وضعیت انتخاب‌شده معتبر نیست.',
      }),

    isActive: Joi.boolean().optional(),
  }),
};

export const getUserByIdSchema = {
  params: Joi.object({
    id: objectIdSchema.required(),
  }),
};

export const changeUserStatusSchema = {
  params: Joi.object({
    id: objectIdSchema.required(),
  }),

  body: Joi.object({
    status: Joi.string()
      .valid(UserStatus.ACTIVE, UserStatus.INACTIVE, UserStatus.SUSPENDED)
      .required()
      .messages({
        'any.required': 'وضعیت کاربر الزامی است.',
        'any.only': 'وضعیت انتخاب‌شده معتبر نیست.',
      }),
  }),
};

export const deleteUserSchema = {
  params: Joi.object({
    id: objectIdSchema.required(),
  }),
};