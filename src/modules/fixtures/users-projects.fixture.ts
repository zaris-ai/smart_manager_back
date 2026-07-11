import {
  ProjectFileCategory,
  ProjectPriority,
  ProjectStatus,
  ProjectTaskStatus,
} from '@/modules/projects/project.model';
import { UserRole, UserStatus } from '@/modules/users/user.model';

export type UserFixture = {
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  phone: string;
  role: UserRole;
  status: UserStatus;
  profile: {
    jobTitle: string;
    domain: string;
    specialtyChapter: string;
    responsibilityScope: string;
    bio: string;
  };
};

export type ProjectPhaseFixture = {
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  order: number;
  assignedUserUsernames: string[];
};

export type ProjectFixture = {
  title: string;
  description: string;
  status: ProjectStatus;
  priority: ProjectPriority;
  startDate: string;
  dueDate: string;
  ownerUsername: string;
  memberUsernames: string[];
  phases: ProjectPhaseFixture[];
};

export const FIXTURE_DEFAULT_PASSWORD = 'Fixture123456!';

export const userFixtures: UserFixture[] = [
  {
    firstName: 'مریم',
    lastName: 'احمدی',
    username: 'fixture.manager.maryam',
    email: 'fixture.manager.maryam@avid.local',
    phone: '09120000001',
    role: UserRole.MANAGER,
    status: UserStatus.ACTIVE,
    profile: {
      jobTitle: 'مدیر پروژه‌های سازمانی',
      domain: 'مدیریت پروژه',
      specialtyChapter: 'PMO',
      responsibilityScope: 'تعریف پروژه، تخصیص نیرو و کنترل وضعیت اجرا',
      bio: 'داده آزمایشی برای نقش مدیر پروژه.',
    },
  },
  {
    firstName: 'علی',
    lastName: 'رضایی',
    username: 'fixture.manager.ali',
    email: 'fixture.manager.ali@avid.local',
    phone: '09120000002',
    role: UserRole.MANAGER,
    status: UserStatus.ACTIVE,
    profile: {
      jobTitle: 'مدیر محصول',
      domain: 'محصول و عملیات',
      specialtyChapter: 'Product Management',
      responsibilityScope: 'اولویت‌بندی پروژه‌ها، کنترل تحویل و هماهنگی با تیم‌ها',
      bio: 'داده آزمایشی برای نقش مدیر محصول.',
    },
  },
  {
    firstName: 'سارا',
    lastName: 'کریمی',
    username: 'fixture.expert.sara',
    email: 'fixture.expert.sara@avid.local',
    phone: '09120000003',
    role: UserRole.EXPERT,
    status: UserStatus.ACTIVE,
    profile: {
      jobTitle: 'تحلیلگر کسب‌وکار',
      domain: 'تحلیل نیازمندی',
      specialtyChapter: 'Business Analysis',
      responsibilityScope: 'جمع‌آوری نیازمندی و مستندسازی فرایندها',
      bio: 'داده آزمایشی برای نقش تحلیلگر.',
    },
  },
  {
    firstName: 'رضا',
    lastName: 'موسوی',
    username: 'fixture.expert.reza',
    email: 'fixture.expert.reza@avid.local',
    phone: '09120000004',
    role: UserRole.EXPERT,
    status: UserStatus.ACTIVE,
    profile: {
      jobTitle: 'برنامه‌نویس بک‌اند',
      domain: 'توسعه نرم‌افزار',
      specialtyChapter: 'Backend',
      responsibilityScope: 'پیاده‌سازی API، مدل داده و منطق سمت سرور',
      bio: 'داده آزمایشی برای توسعه بک‌اند.',
    },
  },
  {
    firstName: 'نرگس',
    lastName: 'شریفی',
    username: 'fixture.expert.narges',
    email: 'fixture.expert.narges@avid.local',
    phone: '09120000005',
    role: UserRole.EXPERT,
    status: UserStatus.ACTIVE,
    profile: {
      jobTitle: 'برنامه‌نویس فرانت‌اند',
      domain: 'توسعه رابط کاربری',
      specialtyChapter: 'Frontend',
      responsibilityScope: 'پیاده‌سازی صفحات، فرم‌ها و اتصال به API',
      bio: 'داده آزمایشی برای توسعه فرانت‌اند.',
    },
  },
  {
    firstName: 'حسین',
    lastName: 'محمدی',
    username: 'fixture.expert.hossein',
    email: 'fixture.expert.hossein@avid.local',
    phone: '09120000006',
    role: UserRole.EXPERT,
    status: UserStatus.ACTIVE,
    profile: {
      jobTitle: 'طراح UI/UX',
      domain: 'طراحی محصول',
      specialtyChapter: 'Design',
      responsibilityScope: 'طراحی جریان کاربری، وایرفریم و کامپوننت‌های رابط کاربری',
      bio: 'داده آزمایشی برای طراحی محصول.',
    },
  },
  {
    firstName: 'فاطمه',
    lastName: 'حیدری',
    username: 'fixture.expert.fatemeh',
    email: 'fixture.expert.fatemeh@avid.local',
    phone: '09120000007',
    role: UserRole.EXPERT,
    status: UserStatus.ACTIVE,
    profile: {
      jobTitle: 'کارشناس تست و کیفیت',
      domain: 'کنترل کیفیت',
      specialtyChapter: 'QA',
      responsibilityScope: 'طراحی سناریوی تست، کنترل خطاها و تایید تحویل',
      bio: 'داده آزمایشی برای کیفیت نرم‌افزار.',
    },
  },
  {
    firstName: 'امیر',
    lastName: 'نادری',
    username: 'fixture.expert.amir',
    email: 'fixture.expert.amir@avid.local',
    phone: '09120000008',
    role: UserRole.EXPERT,
    status: UserStatus.ACTIVE,
    profile: {
      jobTitle: 'کارشناس DevOps',
      domain: 'زیرساخت',
      specialtyChapter: 'DevOps',
      responsibilityScope: 'استقرار، مانیتورینگ، پشتیبان‌گیری و تنظیم محیط‌ها',
      bio: 'داده آزمایشی برای زیرساخت و استقرار.',
    },
  },
  {
    firstName: 'مهسا',
    lastName: 'قاسمی',
    username: 'fixture.expert.mahsa',
    email: 'fixture.expert.mahsa@avid.local',
    phone: '09120000009',
    role: UserRole.EXPERT,
    status: UserStatus.ACTIVE,
    profile: {
      jobTitle: 'کارشناس محتوا و مستندات',
      domain: 'مستندسازی',
      specialtyChapter: 'Documentation',
      responsibilityScope: 'مستندسازی فرایندها، راهنماها و گزارش‌های پروژه',
      bio: 'داده آزمایشی برای مستندات پروژه.',
    },
  },
  {
    firstName: 'کیوان',
    lastName: 'صادقی',
    username: 'fixture.expert.keyvan',
    email: 'fixture.expert.keyvan@avid.local',
    phone: '09120000010',
    role: UserRole.EXPERT,
    status: UserStatus.ACTIVE,
    profile: {
      jobTitle: 'کارشناس داده',
      domain: 'داده و گزارش‌گیری',
      specialtyChapter: 'Data',
      responsibilityScope: 'مدل‌سازی داده، داشبورد و گزارش‌های مدیریتی',
      bio: 'داده آزمایشی برای تحلیل داده.',
    },
  },
];

export const projectFixtures: ProjectFixture[] = [
  {
    title: 'داده آزمایشی | سامانه مدیریت پروژه داخلی',
    description: 'پیاده‌سازی نسخه داخلی سامانه مدیریت پروژه با تعریف فاز، اعضا و تقویم اجرایی.',
    status: ProjectStatus.ACTIVE,
    priority: ProjectPriority.HIGH,
    startDate: '2026-07-01',
    dueDate: '2026-09-30',
    ownerUsername: 'fixture.manager.maryam',
    memberUsernames: ['fixture.expert.sara', 'fixture.expert.reza', 'fixture.expert.narges'],
    phases: [
      {
        title: 'تحلیل و طراحی',
        description: 'جمع‌آوری نیازمندی‌ها و طراحی ساختار پروژه.',
        startDate: '2026-07-01',
        endDate: '2026-07-15',
        order: 1,
        assignedUserUsernames: ['fixture.expert.sara'],
      },
      {
        title: 'توسعه و تحویل اولیه',
        description: 'پیاده‌سازی بک‌اند و فرانت‌اند اولیه.',
        startDate: '2026-07-16',
        endDate: '2026-08-20',
        order: 2,
        assignedUserUsernames: ['fixture.expert.reza', 'fixture.expert.narges'],
      },
    ],
  },
  {
    title: 'داده آزمایشی | داشبورد گزارش مدیران',
    description: 'ساخت داشبورد مدیریتی برای مشاهده وضعیت پروژه‌ها، وظایف و تاخیرها.',
    status: ProjectStatus.PLANNING,
    priority: ProjectPriority.MEDIUM,
    startDate: '2026-07-05',
    dueDate: '2026-08-25',
    ownerUsername: 'fixture.manager.ali',
    memberUsernames: ['fixture.expert.keyvan', 'fixture.expert.narges'],
    phases: [
      {
        title: 'مدل‌سازی شاخص‌ها',
        description: 'تعریف شاخص‌های گزارش‌گیری و منابع داده.',
        startDate: '2026-07-05',
        endDate: '2026-07-18',
        order: 1,
        assignedUserUsernames: ['fixture.expert.keyvan'],
      },
      {
        title: 'پیاده‌سازی داشبورد',
        description: 'طراحی و اتصال ویجت‌های داشبورد.',
        startDate: '2026-07-19',
        endDate: '2026-08-25',
        order: 2,
        assignedUserUsernames: ['fixture.expert.narges'],
      },
    ],
  },
  {
    title: 'داده آزمایشی | پورتال مشتریان سازمانی',
    description: 'پورتال ثبت درخواست، پیگیری وضعیت و ارسال مستندات برای مشتریان.',
    status: ProjectStatus.NEGOTIATING,
    priority: ProjectPriority.HIGH,
    startDate: '2026-07-10',
    dueDate: '2026-10-10',
    ownerUsername: 'fixture.manager.maryam',
    memberUsernames: ['fixture.expert.hossein', 'fixture.expert.reza', 'fixture.expert.fatemeh'],
    phases: [
      {
        title: 'طراحی تجربه کاربری',
        description: 'طراحی مسیرهای اصلی کاربر و وایرفریم صفحات.',
        startDate: '2026-07-10',
        endDate: '2026-07-28',
        order: 1,
        assignedUserUsernames: ['fixture.expert.hossein'],
      },
      {
        title: 'توسعه و تست',
        description: 'پیاده‌سازی API و کنترل کیفیت جریان‌های اصلی.',
        startDate: '2026-07-29',
        endDate: '2026-09-25',
        order: 2,
        assignedUserUsernames: ['fixture.expert.reza', 'fixture.expert.fatemeh'],
      },
    ],
  },
  {
    title: 'داده آزمایشی | سیستم اعلان و یادآوری وظایف',
    description: 'ارسال اعلان‌های روزانه و یادآوری وظایف نزدیک به سررسید.',
    status: ProjectStatus.ACTIVE,
    priority: ProjectPriority.MEDIUM,
    startDate: '2026-07-03',
    dueDate: '2026-08-15',
    ownerUsername: 'fixture.manager.ali',
    memberUsernames: ['fixture.expert.amir', 'fixture.expert.reza'],
    phases: [
      {
        title: 'طراحی سرویس اعلان',
        description: 'طراحی سناریوهای ارسال و تنظیمات زمان‌بندی.',
        startDate: '2026-07-03',
        endDate: '2026-07-20',
        order: 1,
        assignedUserUsernames: ['fixture.expert.amir'],
      },
      {
        title: 'اتصال به پروژه‌ها',
        description: 'اتصال اعلان‌ها به وظایف و پروژه‌ها.',
        startDate: '2026-07-21',
        endDate: '2026-08-15',
        order: 2,
        assignedUserUsernames: ['fixture.expert.reza'],
      },
    ],
  },
  {
    title: 'داده آزمایشی | مرکز مستندات پروژه',
    description: 'ساخت بخش مستندات برای نگهداری فایل‌ها، توضیحات و راهنمای استفاده.',
    status: ProjectStatus.PLANNING,
    priority: ProjectPriority.LOW,
    startDate: '2026-07-12',
    dueDate: '2026-09-01',
    ownerUsername: 'fixture.manager.maryam',
    memberUsernames: ['fixture.expert.mahsa', 'fixture.expert.narges'],
    phases: [
      {
        title: 'ساختار مستندات',
        description: 'تعریف دسته‌بندی‌ها و قالب مستندات.',
        startDate: '2026-07-12',
        endDate: '2026-07-26',
        order: 1,
        assignedUserUsernames: ['fixture.expert.mahsa'],
      },
      {
        title: 'پیاده‌سازی صفحات',
        description: 'پیاده‌سازی بخش نمایش و مدیریت مستندات.',
        startDate: '2026-07-27',
        endDate: '2026-09-01',
        order: 2,
        assignedUserUsernames: ['fixture.expert.narges'],
      },
    ],
  },
  {
    title: 'داده آزمایشی | ماژول نقش‌های پروژه',
    description: 'تعریف نقش‌های قابل استفاده در پروژه و اتصال آن‌ها به اعضا.',
    status: ProjectStatus.ACTIVE,
    priority: ProjectPriority.MEDIUM,
    startDate: '2026-07-07',
    dueDate: '2026-08-30',
    ownerUsername: 'fixture.manager.ali',
    memberUsernames: ['fixture.expert.sara', 'fixture.expert.reza'],
    phases: [
      {
        title: 'تعریف مدل نقش',
        description: 'طراحی موجودیت نقش و قواعد اتصال آن به اعضای پروژه.',
        startDate: '2026-07-07',
        endDate: '2026-07-21',
        order: 1,
        assignedUserUsernames: ['fixture.expert.sara'],
      },
      {
        title: 'API و تست',
        description: 'پیاده‌سازی مسیرها و تست رفتار نقش‌ها.',
        startDate: '2026-07-22',
        endDate: '2026-08-30',
        order: 2,
        assignedUserUsernames: ['fixture.expert.reza'],
      },
    ],
  },
  {
    title: 'داده آزمایشی | بهینه‌سازی تقویم پروژه‌ها',
    description: 'نمایش شروع و پایان پروژه، وظیفه و فاز در تقویم مدیریتی.',
    status: ProjectStatus.ACTIVE,
    priority: ProjectPriority.HIGH,
    startDate: '2026-07-15',
    dueDate: '2026-09-15',
    ownerUsername: 'fixture.manager.maryam',
    memberUsernames: ['fixture.expert.narges', 'fixture.expert.keyvan'],
    phases: [
      {
        title: 'تحلیل رویدادهای تقویم',
        description: 'تعریف انواع رویداد و فیلترهای تقویم.',
        startDate: '2026-07-15',
        endDate: '2026-07-30',
        order: 1,
        assignedUserUsernames: ['fixture.expert.keyvan'],
      },
      {
        title: 'نمایش در فرانت‌اند',
        description: 'پیاده‌سازی UI و اتصال رویدادها.',
        startDate: '2026-07-31',
        endDate: '2026-09-15',
        order: 2,
        assignedUserUsernames: ['fixture.expert.narges'],
      },
    ],
  },
  {
    title: 'داده آزمایشی | بهبود امنیت پنل',
    description: 'بازبینی نقش‌ها، دسترسی‌ها و کنترل عملیات حساس در پنل مدیریتی.',
    status: ProjectStatus.ON_HOLD,
    priority: ProjectPriority.CRITICAL,
    startDate: '2026-07-20',
    dueDate: '2026-10-20',
    ownerUsername: 'fixture.manager.ali',
    memberUsernames: ['fixture.expert.amir', 'fixture.expert.reza', 'fixture.expert.fatemeh'],
    phases: [
      {
        title: 'ممیزی دسترسی',
        description: 'بررسی مسیرها، نقش‌ها و نقاط حساس امنیتی.',
        startDate: '2026-07-20',
        endDate: '2026-08-10',
        order: 1,
        assignedUserUsernames: ['fixture.expert.amir'],
      },
      {
        title: 'اصلاح و تست امنیت',
        description: 'اعمال کنترل‌ها و تست خطاهای دسترسی.',
        startDate: '2026-08-11',
        endDate: '2026-10-20',
        order: 2,
        assignedUserUsernames: ['fixture.expert.reza', 'fixture.expert.fatemeh'],
      },
    ],
  },
  {
    title: 'داده آزمایشی | سیستم ورود اطلاعات از اکسل',
    description: 'بهبود فرایند ورود پروژه‌ها از فایل اکسل و کنترل خطاهای اعتبارسنجی.',
    status: ProjectStatus.PROPOSAL_DRAFTING,
    priority: ProjectPriority.MEDIUM,
    startDate: '2026-08-01',
    dueDate: '2026-09-20',
    ownerUsername: 'fixture.manager.maryam',
    memberUsernames: ['fixture.expert.sara', 'fixture.expert.keyvan'],
    phases: [
      {
        title: 'اعتبارسنجی داده‌ها',
        description: 'تعریف قواعد بررسی فایل اکسل و پیام‌های خطا.',
        startDate: '2026-08-01',
        endDate: '2026-08-20',
        order: 1,
        assignedUserUsernames: ['fixture.expert.sara'],
      },
      {
        title: 'گزارش نتیجه ورود',
        description: 'نمایش آیتم‌های موفق، ناموفق و هشدارها.',
        startDate: '2026-08-21',
        endDate: '2026-09-20',
        order: 2,
        assignedUserUsernames: ['fixture.expert.keyvan'],
      },
    ],
  },
  {
    title: 'داده آزمایشی | آماده‌سازی نسخه پایدار',
    description: 'پاک‌سازی خطاهای شناخته‌شده، بهبود UX و آماده‌سازی نسخه قابل ارائه.',
    status: ProjectStatus.CONTRACT_SIGNING,
    priority: ProjectPriority.HIGH,
    startDate: '2026-08-05',
    dueDate: '2026-10-01',
    ownerUsername: 'fixture.manager.ali',
    memberUsernames: ['fixture.expert.hossein', 'fixture.expert.fatemeh', 'fixture.expert.mahsa'],
    phases: [
      {
        title: 'بازبینی تجربه کاربری',
        description: 'بررسی صفحات اصلی و حذف پیچیدگی‌های غیرضروری.',
        startDate: '2026-08-05',
        endDate: '2026-08-22',
        order: 1,
        assignedUserUsernames: ['fixture.expert.hossein'],
      },
      {
        title: 'تست و مستندسازی نسخه',
        description: 'تست نهایی و آماده‌سازی مستندات تحویل.',
        startDate: '2026-08-23',
        endDate: '2026-10-01',
        order: 2,
        assignedUserUsernames: ['fixture.expert.fatemeh', 'fixture.expert.mahsa'],
      },
    ],
  },
];

export type ProjectRoleFixture = {
  title: string;
  description: string;
  sortOrder: number;
};

export type ProjectChartDateProfile = {
  projectTitle: string;
  status: ProjectStatus;
  priority: ProjectPriority;
  startOffsetDays: number;
  dueOffsetDays: number;
};

export type ProjectTaskFixture = {
  projectTitle: string;
  title: string;
  description: string;
  status: ProjectTaskStatus;
  priority: ProjectPriority;
  assigneeUsernames: string[];
  startOffsetDays: number;
  dueOffsetDays: number;
  completedOffsetDays?: number;
};

export type ProjectReportFixture = {
  projectTitle: string;
  authorUsername: string;
  note: string;
  progressPercent: number;
  createdOffsetDays: number;
  fileSizeBytes?: number;
};

export type ProjectFileFixture = {
  projectTitle: string;
  uploadedByUsername: string;
  originalName: string;
  category: ProjectFileCategory;
  fileType: string;
  fileSizeBytes: number;
  createdOffsetDays: number;
};

export const projectRoleFixtures: ProjectRoleFixture[] = [
  {
    title: 'مدیر پروژه',
    description: 'مسئول هماهنگی، پیگیری و کنترل وضعیت پروژه.',
    sortOrder: 1,
  },
  {
    title: 'تحلیلگر کسب‌وکار',
    description: 'مسئول تحلیل نیازمندی‌ها و مستندسازی فرایندها.',
    sortOrder: 2,
  },
  {
    title: 'توسعه بک‌اند',
    description: 'مسئول API، مدل داده و منطق سمت سرور.',
    sortOrder: 3,
  },
  {
    title: 'توسعه فرانت‌اند',
    description: 'مسئول پیاده‌سازی صفحات و اتصال به API.',
    sortOrder: 4,
  },
  {
    title: 'طراحی تجربه کاربری',
    description: 'مسئول تجربه کاربری، وایرفریم و ساده‌سازی جریان‌ها.',
    sortOrder: 5,
  },
  {
    title: 'کنترل کیفیت',
    description: 'مسئول تست، اعتبارسنجی و بررسی خطاهای تحویل.',
    sortOrder: 6,
  },
  {
    title: 'زیرساخت و DevOps',
    description: 'مسئول استقرار، مانیتورینگ و پایداری سرویس‌ها.',
    sortOrder: 7,
  },
  {
    title: 'داده و گزارش‌گیری',
    description: 'مسئول مدل‌سازی شاخص‌ها، گزارش‌ها و داشبوردها.',
    sortOrder: 8,
  },
  {
    title: 'مستندسازی',
    description: 'مسئول مستندات، راهنما و محتوای تحویل.',
    sortOrder: 9,
  },
];

export const userProjectRoleMap: Record<string, string> = {
  'fixture.manager.maryam': 'مدیر پروژه',
  'fixture.manager.ali': 'مدیر پروژه',
  'fixture.expert.sara': 'تحلیلگر کسب‌وکار',
  'fixture.expert.reza': 'توسعه بک‌اند',
  'fixture.expert.narges': 'توسعه فرانت‌اند',
  'fixture.expert.hossein': 'طراحی تجربه کاربری',
  'fixture.expert.fatemeh': 'کنترل کیفیت',
  'fixture.expert.amir': 'زیرساخت و DevOps',
  'fixture.expert.mahsa': 'مستندسازی',
  'fixture.expert.keyvan': 'داده و گزارش‌گیری',
};

export const projectChartDateProfiles: ProjectChartDateProfile[] = [
  {
    projectTitle: 'داده آزمایشی | سامانه مدیریت پروژه داخلی',
    status: ProjectStatus.ACTIVE,
    priority: ProjectPriority.HIGH,
    startOffsetDays: -45,
    dueOffsetDays: -12,
  },
  {
    projectTitle: 'داده آزمایشی | داشبورد گزارش مدیران',
    status: ProjectStatus.PLANNING,
    priority: ProjectPriority.MEDIUM,
    startOffsetDays: -10,
    dueOffsetDays: 4,
  },
  {
    projectTitle: 'داده آزمایشی | پورتال مشتریان سازمانی',
    status: ProjectStatus.NEGOTIATING,
    priority: ProjectPriority.HIGH,
    startOffsetDays: 2,
    dueOffsetDays: 55,
  },
  {
    projectTitle: 'داده آزمایشی | سیستم اعلان و یادآوری وظایف',
    status: ProjectStatus.ACTIVE,
    priority: ProjectPriority.MEDIUM,
    startOffsetDays: -18,
    dueOffsetDays: 22,
  },
  {
    projectTitle: 'داده آزمایشی | مرکز مستندات پروژه',
    status: ProjectStatus.COMPLETED,
    priority: ProjectPriority.LOW,
    startOffsetDays: -70,
    dueOffsetDays: -5,
  },
  {
    projectTitle: 'داده آزمایشی | ماژول نقش‌های پروژه',
    status: ProjectStatus.CONTRACT_SIGNING,
    priority: ProjectPriority.MEDIUM,
    startOffsetDays: -5,
    dueOffsetDays: 30,
  },
  {
    projectTitle: 'داده آزمایشی | بهینه‌سازی تقویم پروژه‌ها',
    status: ProjectStatus.ACTIVE,
    priority: ProjectPriority.HIGH,
    startOffsetDays: -14,
    dueOffsetDays: 6,
  },
  {
    projectTitle: 'داده آزمایشی | بهبود امنیت پنل',
    status: ProjectStatus.ON_HOLD,
    priority: ProjectPriority.CRITICAL,
    startOffsetDays: -55,
    dueOffsetDays: -20,
  },
  {
    projectTitle: 'داده آزمایشی | سیستم ورود اطلاعات از اکسل',
    status: ProjectStatus.PROPOSAL_DRAFTING,
    priority: ProjectPriority.MEDIUM,
    startOffsetDays: 1,
    dueOffsetDays: 45,
  },
  {
    projectTitle: 'داده آزمایشی | آماده‌سازی نسخه پایدار',
    status: ProjectStatus.CANCELLED,
    priority: ProjectPriority.HIGH,
    startOffsetDays: -40,
    dueOffsetDays: -10,
  },
];

export const projectTaskFixtures: ProjectTaskFixture[] = [
  {
    projectTitle: 'داده آزمایشی | سامانه مدیریت پروژه داخلی',
    title: 'تکمیل API فازها',
    description: 'کنترل مسیرهای ایجاد، ویرایش و دریافت فازهای پروژه.',
    status: ProjectTaskStatus.IN_PROGRESS,
    priority: ProjectPriority.HIGH,
    assigneeUsernames: ['fixture.expert.reza'],
    startOffsetDays: -20,
    dueOffsetDays: -3,
  },
  {
    projectTitle: 'داده آزمایشی | سامانه مدیریت پروژه داخلی',
    title: 'بازبینی جریان تعریف پروژه',
    description: 'حذف اطلاعات اضافی و ساده‌سازی تعریف پروژه.',
    status: ProjectTaskStatus.TODO,
    priority: ProjectPriority.MEDIUM,
    assigneeUsernames: ['fixture.expert.sara'],
    startOffsetDays: -12,
    dueOffsetDays: 0,
  },
  {
    projectTitle: 'داده آزمایشی | داشبورد گزارش مدیران',
    title: 'تعریف شاخص‌های داشبورد',
    description: 'آماده‌سازی داده برای کارت‌ها و نمودارهای اصلی.',
    status: ProjectTaskStatus.DONE,
    priority: ProjectPriority.MEDIUM,
    assigneeUsernames: ['fixture.expert.keyvan'],
    startOffsetDays: -8,
    dueOffsetDays: -6,
    completedOffsetDays: -6,
  },
  {
    projectTitle: 'داده آزمایشی | داشبورد گزارش مدیران',
    title: 'طراحی نمودار وضعیت پروژه',
    description: 'نمایش وضعیت پروژه‌ها با نمودار و رنگ‌های خوانا.',
    status: ProjectTaskStatus.DONE,
    priority: ProjectPriority.HIGH,
    assigneeUsernames: ['fixture.expert.narges'],
    startOffsetDays: -6,
    dueOffsetDays: -5,
    completedOffsetDays: -5,
  },
  {
    projectTitle: 'داده آزمایشی | پورتال مشتریان سازمانی',
    title: 'تهیه وایرفریم مسیر درخواست',
    description: 'طراحی مسیر ثبت درخواست و پیگیری وضعیت.',
    status: ProjectTaskStatus.TODO,
    priority: ProjectPriority.HIGH,
    assigneeUsernames: ['fixture.expert.hossein'],
    startOffsetDays: 1,
    dueOffsetDays: 8,
  },
  {
    projectTitle: 'داده آزمایشی | سیستم اعلان و یادآوری وظایف',
    title: 'اتصال سرویس اعلان به وظایف',
    description: 'ارسال یادآوری برای وظایف امروز و عقب‌افتاده.',
    status: ProjectTaskStatus.BLOCKED,
    priority: ProjectPriority.HIGH,
    assigneeUsernames: ['fixture.expert.amir'],
    startOffsetDays: -9,
    dueOffsetDays: -1,
  },
  {
    projectTitle: 'داده آزمایشی | مرکز مستندات پروژه',
    title: 'انتشار راهنمای کاربری اولیه',
    description: 'آماده‌سازی نسخه اول راهنمای استفاده از سامانه.',
    status: ProjectTaskStatus.DONE,
    priority: ProjectPriority.LOW,
    assigneeUsernames: ['fixture.expert.mahsa'],
    startOffsetDays: -10,
    dueOffsetDays: -4,
    completedOffsetDays: -4,
  },
  {
    projectTitle: 'داده آزمایشی | ماژول نقش‌های پروژه',
    title: 'تعریف نقش‌های پایه پروژه',
    description: 'ایجاد نقش‌های استاندارد برای اعضای پروژه.',
    status: ProjectTaskStatus.DONE,
    priority: ProjectPriority.MEDIUM,
    assigneeUsernames: ['fixture.expert.sara'],
    startOffsetDays: -4,
    dueOffsetDays: -3,
    completedOffsetDays: -3,
  },
  {
    projectTitle: 'داده آزمایشی | بهینه‌سازی تقویم پروژه‌ها',
    title: 'افزودن رویدادهای شروع و پایان فاز',
    description: 'نمایش فازها در تقویم پروژه‌ها.',
    status: ProjectTaskStatus.IN_PROGRESS,
    priority: ProjectPriority.HIGH,
    assigneeUsernames: ['fixture.expert.narges'],
    startOffsetDays: -5,
    dueOffsetDays: 5,
  },
  {
    projectTitle: 'داده آزمایشی | بهبود امنیت پنل',
    title: 'ممیزی دسترسی‌های حساس',
    description: 'بررسی مسیرهای مدیریتی و عملیات حساس.',
    status: ProjectTaskStatus.BLOCKED,
    priority: ProjectPriority.CRITICAL,
    assigneeUsernames: ['fixture.expert.amir', 'fixture.expert.fatemeh'],
    startOffsetDays: -22,
    dueOffsetDays: -10,
  },
  {
    projectTitle: 'داده آزمایشی | سیستم ورود اطلاعات از اکسل',
    title: 'تعریف پیام‌های خطای اکسل',
    description: 'شفاف‌سازی خطاهای فایل ورودی برای کاربر.',
    status: ProjectTaskStatus.TODO,
    priority: ProjectPriority.MEDIUM,
    assigneeUsernames: ['fixture.expert.sara'],
    startOffsetDays: 2,
    dueOffsetDays: 12,
  },
  {
    projectTitle: 'داده آزمایشی | آماده‌سازی نسخه پایدار',
    title: 'بستن تسک‌های منسوخ نسخه پایدار',
    description: 'حذف وظایف غیرقابل اجرا از چرخه تحویل.',
    status: ProjectTaskStatus.CANCELLED,
    priority: ProjectPriority.MEDIUM,
    assigneeUsernames: ['fixture.expert.fatemeh'],
    startOffsetDays: -15,
    dueOffsetDays: -8,
  },
  {
    projectTitle: 'داده آزمایشی | بهینه‌سازی تقویم پروژه‌ها',
    title: 'کنترل نمایش رویدادهای روز جاری',
    description: 'بررسی نمایش وظایفی که امروز سررسید دارند.',
    status: ProjectTaskStatus.DONE,
    priority: ProjectPriority.MEDIUM,
    assigneeUsernames: ['fixture.expert.keyvan'],
    startOffsetDays: -2,
    dueOffsetDays: -1,
    completedOffsetDays: -1,
  },
  {
    projectTitle: 'داده آزمایشی | سیستم اعلان و یادآوری وظایف',
    title: 'ثبت نتیجه تست اعلان روزانه',
    description: 'ثبت خروجی تست برای اعلان‌های روزانه مدیران.',
    status: ProjectTaskStatus.DONE,
    priority: ProjectPriority.MEDIUM,
    assigneeUsernames: ['fixture.expert.reza'],
    startOffsetDays: -1,
    dueOffsetDays: 0,
    completedOffsetDays: 0,
  },
];

export const projectReportFixtures: ProjectReportFixture[] = [
  {
    projectTitle: 'داده آزمایشی | سامانه مدیریت پروژه داخلی',
    authorUsername: 'fixture.manager.maryam',
    note: 'جلسه کنترل وضعیت برگزار شد و مسیر ساده‌سازی تعریف پروژه تایید شد.',
    progressPercent: 35,
    createdOffsetDays: -6,
    fileSizeBytes: 820_000,
  },
  {
    projectTitle: 'داده آزمایشی | داشبورد گزارش مدیران',
    authorUsername: 'fixture.expert.keyvan',
    note: 'مدل داده نمودارها بررسی شد و شاخص‌های وضعیت پروژه آماده شد.',
    progressPercent: 55,
    createdOffsetDays: -5,
    fileSizeBytes: 1_250_000,
  },
  {
    projectTitle: 'داده آزمایشی | پورتال مشتریان سازمانی',
    authorUsername: 'fixture.expert.hossein',
    note: 'وایرفریم اولیه مسیر ثبت درخواست مشتری تهیه شد.',
    progressPercent: 20,
    createdOffsetDays: -4,
    fileSizeBytes: 680_000,
  },
  {
    projectTitle: 'داده آزمایشی | سیستم اعلان و یادآوری وظایف',
    authorUsername: 'fixture.expert.amir',
    note: 'مشکل اتصال زمان‌بندی اعلان‌ها شناسایی و نیازمند رفع وابستگی است.',
    progressPercent: 40,
    createdOffsetDays: -3,
    fileSizeBytes: 950_000,
  },
  {
    projectTitle: 'داده آزمایشی | مرکز مستندات پروژه',
    authorUsername: 'fixture.expert.mahsa',
    note: 'نسخه اول راهنمای کاربری آماده و برای بازبینی ارسال شد.',
    progressPercent: 100,
    createdOffsetDays: -2,
    fileSizeBytes: 1_850_000,
  },
  {
    projectTitle: 'داده آزمایشی | بهبود امنیت پنل',
    authorUsername: 'fixture.expert.fatemeh',
    note: 'سناریوهای تست امنیتی تعریف شد و چند مسیر نیازمند محدودسازی است.',
    progressPercent: 25,
    createdOffsetDays: -1,
    fileSizeBytes: 2_400_000,
  },
  {
    projectTitle: 'داده آزمایشی | بهینه‌سازی تقویم پروژه‌ها',
    authorUsername: 'fixture.expert.narges',
    note: 'رویدادهای مربوط به فازها در تقویم تست شد و نمایش آن تایید شد.',
    progressPercent: 60,
    createdOffsetDays: 0,
    fileSizeBytes: 1_100_000,
  },
  {
    projectTitle: 'داده آزمایشی | سیستم اعلان و یادآوری وظایف',
    authorUsername: 'fixture.expert.reza',
    note: 'تست اعلان روز جاری انجام شد و نتیجه در داشبورد قابل مشاهده است.',
    progressPercent: 45,
    createdOffsetDays: 0,
    fileSizeBytes: 740_000,
  },
];

export const projectFileFixtures: ProjectFileFixture[] = [
  {
    projectTitle: 'داده آزمایشی | سامانه مدیریت پروژه داخلی',
    uploadedByUsername: 'fixture.expert.sara',
    originalName: 'requirements-phase-model.pdf',
    category: ProjectFileCategory.REQUIREMENTS,
    fileType: 'application/pdf',
    fileSizeBytes: 420_000,
    createdOffsetDays: -6,
  },
  {
    projectTitle: 'داده آزمایشی | داشبورد گزارش مدیران',
    uploadedByUsername: 'fixture.expert.keyvan',
    originalName: 'dashboard-kpi-model.xlsx',
    category: ProjectFileCategory.REPORTS,
    fileType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    fileSizeBytes: 2_200_000,
    createdOffsetDays: -5,
  },
  {
    projectTitle: 'داده آزمایشی | پورتال مشتریان سازمانی',
    uploadedByUsername: 'fixture.expert.hossein',
    originalName: 'customer-portal-wireframe.png',
    category: ProjectFileCategory.DESIGN,
    fileType: 'image/png',
    fileSizeBytes: 1_450_000,
    createdOffsetDays: -4,
  },
  {
    projectTitle: 'داده آزمایشی | بهبود امنیت پنل',
    uploadedByUsername: 'fixture.expert.fatemeh',
    originalName: 'security-test-report.pdf',
    category: ProjectFileCategory.REPORTS,
    fileType: 'application/pdf',
    fileSizeBytes: 3_200_000,
    createdOffsetDays: -1,
  },
  {
    projectTitle: 'داده آزمایشی | مرکز مستندات پروژه',
    uploadedByUsername: 'fixture.expert.mahsa',
    originalName: 'user-guide-draft.docx',
    category: ProjectFileCategory.REPORTS,
    fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    fileSizeBytes: 1_900_000,
    createdOffsetDays: -2,
  },
];

