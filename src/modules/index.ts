import express, { Router } from 'express';
import path from 'path';
import alertRoutes from '@/modules/alerts/alert.routes';
import authRoutes from '@/modules/auth/auth.routes';
import dashboardRoutes from '@/modules/dashboard/dashboard.routes';
import healthRoutes from '@/modules/health/health.routes';
import projectRoutes from '@/modules/projects/project.routes';
import userRoutes from '@/modules/users/user.routes';
import telegramRoutes from '@/modules/telegram/telegram.routes';
import projectRoleRoutes from './project-roles/project-role.routes';
import projectOverviewRoutes from './project-overview/project-overview.routes';
import fixtureRoutes from './fixtures/fixture.routes';
import repositoryAnalysisRoutes from './repository-analysis/repository-analysis.routes';

export function registerModules(): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.status(200).json({
      success: true,
      message: 'سرویس پنل مدیریتی آوید فعال است.',
      service: 'avid-backend-service',
    });
  });

  router.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

  router.use('/health', healthRoutes);
  router.use('/auth', authRoutes);
  router.use('/alerts', alertRoutes);
  router.use('/dashboard', dashboardRoutes);
  router.use('/users', userRoutes);
  router.use('/fixtures', fixtureRoutes);

  router.use('/projects', projectRoutes);
  router.use('/telegram', telegramRoutes);
  router.use('/project-roles', projectRoleRoutes);
  router.use('/project-overview', projectOverviewRoutes);
  router.use('/repository-analysis', repositoryAnalysisRoutes);

  return router;
}