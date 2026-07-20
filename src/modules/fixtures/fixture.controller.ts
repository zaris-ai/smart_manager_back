import { Request, Response } from 'express';
import {
  getUsersProjectsFixturePreview,
  seedUsersAndProjects,
} from '@/modules/fixtures/users-projects-seed.service';

const fixtureRoutesEnabled = (): boolean => {
  return (
    process.env.NODE_ENV !== 'production' ||
    process.env.ENABLE_FIXTURE_ROUTES === 'true'
  );
};

const sendDisabled = (res: Response): void => {
  res.status(403).json({
    success: true,
    message:
      'مسیرهای داده آزمایشی در محیط production غیرفعال هستند. برای فعال‌سازی آگاهانه ENABLE_FIXTURE_ROUTES=true را تنظیم کنید.',
    code: 'FIXTURE_ROUTES_DISABLED',
  });
};

export const previewUsersProjectsFixtures = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  if (!fixtureRoutesEnabled()) {
    sendDisabled(res);
    return;
  }

  res.status(200).json({
    success: true,
    message: 'پیش‌نمایش داده‌های آزمایشی کاربران و پروژه‌ها آماده است.',
    data: getUsersProjectsFixturePreview(),
  });
};

export const createUsersProjectsFixtures = async (
  req: Request,
  res: Response,
): Promise<void> => {
  if (!fixtureRoutesEnabled()) {
    sendDisabled(res);
    return;
  }

  const result = await seedUsersAndProjects({
    reset: req.body?.reset === true,
  });

  res.status(201).json({
    success: true,
    message: 'داده‌های آزمایشی کاربران و پروژه‌ها با موفقیت ایجاد شدند.',
    data: result,
  });
};
