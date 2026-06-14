export enum UserRole {
    SUPER_ADMIN = 'SUPER_ADMIN',
    ADMIN = 'ADMIN',
    MANAGER = 'MANAGER',
    PROJECT_OWNER = 'PROJECT_OWNER',
    SPECIALTY_OWNER = 'SPECIALTY_OWNER',
    EMPLOYEE = 'EMPLOYEE',
}

export enum UserStatus {
    ACTIVE = 'ACTIVE',
    INACTIVE = 'INACTIVE',
    SUSPENDED = 'SUSPENDED',
    ARCHIVED = 'ARCHIVED',
}

export enum UserPermission {
    USERS_READ = 'users.read',
    USERS_CREATE = 'users.create',
    USERS_UPDATE = 'users.update',
    USERS_DEACTIVATE = 'users.deactivate',
    USERS_DELETE = 'users.delete',

    ROLES_MANAGE = 'roles.manage',

    PROJECTS_READ = 'projects.read',
    PROJECTS_CREATE = 'projects.create',
    PROJECTS_UPDATE = 'projects.update',
    PROJECTS_MANAGE = 'projects.manage',

    REPORTS_READ = 'reports.read',
    REPORTS_CREATE = 'reports.create',
    REPORTS_REVIEW = 'reports.review',

    CONTRACTS_READ = 'contracts.read',
    CONTRACTS_CREATE = 'contracts.create',
    CONTRACTS_UPDATE = 'contracts.update',
    CONTRACTS_MANAGE = 'contracts.manage',

    EVIDENCE_READ = 'evidence.read',
    EVIDENCE_CREATE = 'evidence.create',
    EVIDENCE_REVIEW = 'evidence.review',

    RISKS_READ = 'risks.read',
    RISKS_MANAGE = 'risks.manage',

    DECISIONS_READ = 'decisions.read',
    DECISIONS_APPROVE = 'decisions.approve',

    ADMIN_OVERVIEW = 'admin.overview',
}

export const USER_ROLE_LABELS: Record<UserRole, string> = {
    [UserRole.SUPER_ADMIN]: 'مدیر کل سامانه',
    [UserRole.ADMIN]: 'مدیر سامانه',
    [UserRole.MANAGER]: 'مدیر',
    [UserRole.PROJECT_OWNER]: 'مالک / هماهنگ‌کننده پروژه',
    [UserRole.SPECIALTY_OWNER]: 'مسئول تخصص',
    [UserRole.EMPLOYEE]: 'کارمند / واحد کاری مستقل',
};

export const USER_STATUS_LABELS: Record<UserStatus, string> = {
    [UserStatus.ACTIVE]: 'فعال',
    [UserStatus.INACTIVE]: 'غیرفعال',
    [UserStatus.SUSPENDED]: 'تعلیق‌شده',
    [UserStatus.ARCHIVED]: 'آرشیوشده',
};

export const ROLE_ACCESS_LEVEL: Record<UserRole, number> = {
    [UserRole.SUPER_ADMIN]: 100,
    [UserRole.ADMIN]: 90,
    [UserRole.MANAGER]: 70,
    [UserRole.PROJECT_OWNER]: 60,
    [UserRole.SPECIALTY_OWNER]: 50,
    [UserRole.EMPLOYEE]: 10,
};

export const ACCESS_LEVEL_LABELS = [
    {
        value: 100,
        label: 'دسترسی کامل',
        description: 'کنترل کامل سامانه، کاربران، نقش‌ها و تنظیمات اصلی',
    },
    {
        value: 90,
        label: 'مدیریت سامانه',
        description: 'مدیریت کاربران، پروژه‌ها، گزارش‌ها و تنظیمات اجرایی',
    },
    {
        value: 70,
        label: 'مدیریت سازمانی',
        description: 'مشاهده و بررسی پروژه‌ها، گزارش‌ها، ریسک‌ها و تصمیمات',
    },
    {
        value: 60,
        label: 'مالک پروژه',
        description: 'مدیریت پروژه‌های تحت مسئولیت و پیگیری واحدهای کاری',
    },
    {
        value: 50,
        label: 'مسئول تخصص',
        description: 'مدیریت استانداردها، قراردادهای دامنه و کیفیت تخصصی',
    },
    {
        value: 10,
        label: 'واحد کاری مستقل',
        description: 'ثبت گزارش روزانه، شواهد، برنامه کاری و پیگیری وظایف خود',
    },
];

export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, UserPermission[]> = {
    [UserRole.SUPER_ADMIN]: Object.values(UserPermission),

    [UserRole.ADMIN]: [
        UserPermission.USERS_READ,
        UserPermission.USERS_CREATE,
        UserPermission.USERS_UPDATE,
        UserPermission.USERS_DEACTIVATE,
        UserPermission.PROJECTS_READ,
        UserPermission.PROJECTS_CREATE,
        UserPermission.PROJECTS_UPDATE,
        UserPermission.PROJECTS_MANAGE,
        UserPermission.REPORTS_READ,
        UserPermission.REPORTS_REVIEW,
        UserPermission.CONTRACTS_READ,
        UserPermission.CONTRACTS_CREATE,
        UserPermission.CONTRACTS_UPDATE,
        UserPermission.EVIDENCE_READ,
        UserPermission.EVIDENCE_REVIEW,
        UserPermission.RISKS_READ,
        UserPermission.RISKS_MANAGE,
        UserPermission.DECISIONS_READ,
        UserPermission.DECISIONS_APPROVE,
        UserPermission.ADMIN_OVERVIEW,
    ],

    [UserRole.MANAGER]: [
        UserPermission.USERS_READ,
        UserPermission.PROJECTS_READ,
        UserPermission.PROJECTS_UPDATE,
        UserPermission.REPORTS_READ,
        UserPermission.REPORTS_REVIEW,
        UserPermission.CONTRACTS_READ,
        UserPermission.EVIDENCE_READ,
        UserPermission.EVIDENCE_REVIEW,
        UserPermission.RISKS_READ,
        UserPermission.RISKS_MANAGE,
        UserPermission.DECISIONS_READ,
        UserPermission.DECISIONS_APPROVE,
        UserPermission.ADMIN_OVERVIEW,
    ],

    [UserRole.PROJECT_OWNER]: [
        UserPermission.PROJECTS_READ,
        UserPermission.PROJECTS_UPDATE,
        UserPermission.REPORTS_READ,
        UserPermission.REPORTS_REVIEW,
        UserPermission.EVIDENCE_READ,
        UserPermission.EVIDENCE_REVIEW,
        UserPermission.RISKS_READ,
        UserPermission.RISKS_MANAGE,
        UserPermission.DECISIONS_READ,
    ],

    [UserRole.SPECIALTY_OWNER]: [
        UserPermission.CONTRACTS_READ,
        UserPermission.CONTRACTS_CREATE,
        UserPermission.CONTRACTS_UPDATE,
        UserPermission.REPORTS_READ,
        UserPermission.REPORTS_REVIEW,
        UserPermission.EVIDENCE_READ,
        UserPermission.EVIDENCE_REVIEW,
        UserPermission.RISKS_READ,
    ],

    [UserRole.EMPLOYEE]: [
        UserPermission.PROJECTS_READ,
        UserPermission.REPORTS_CREATE,
        UserPermission.EVIDENCE_CREATE,
        UserPermission.RISKS_READ,
    ],
};