import { Request, Response } from 'express';
import { AuthenticatedRequest } from '@/modules/auth/auth.middleware';
import {
  createRepositoryConnection,
  deleteRepositoryConnection,
  getRepositoryAnalysisRun,
  getRepositoryConnection,
  listRepositoryAnalysisRuns,
  listRepositoryConnections,
  startRepositoryAnalysis,
  updateRepositoryConnection,
} from './repository-analysis.service';
import { RepositoryAnalysisRunStatus } from './repository-analysis.model';
import { buildRepositoryExpectationsInput } from './repository-expectations.service';

const getActorId = (req: Request): string =>
  String((req as AuthenticatedRequest).user?.id || '');

export const createRepositoryConnectionController = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const repository = await createRepositoryConnection({
    projectId: req.body.projectId,
    name: req.body.name,
    repositoryUrl: req.body.repositoryUrl,
    defaultBranch: req.body.defaultBranch,
    actorId: getActorId(req),
  });

  res.status(201).json({
    success: true,
    message: 'مخزن GitLab با موفقیت به پروژه متصل شد.',
    data: repository,
  });
};

export const listRepositoryConnectionsController = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const repositories = await listRepositoryConnections({
    projectId: req.query.projectId as string | undefined,
    enabled:
      typeof req.query.enabled === 'boolean'
        ? req.query.enabled
        : req.query.enabled === 'true'
          ? true
          : req.query.enabled === 'false'
            ? false
            : undefined,
  });

  res.status(200).json({
    success: true,
    message: 'فهرست مخازن با موفقیت دریافت شد.',
    data: repositories,
  });
};

export const getRepositoryConnectionController = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const repository = await getRepositoryConnection(req.params.repositoryId);

  res.status(200).json({
    success: true,
    message: 'اطلاعات مخزن با موفقیت دریافت شد.',
    data: repository,
  });
};

export const updateRepositoryConnectionController = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const repository = await updateRepositoryConnection({
    repositoryId: req.params.repositoryId,
    name: req.body.name,
    repositoryUrl: req.body.repositoryUrl,
    defaultBranch: req.body.defaultBranch,
    enabled: req.body.enabled,
    actorId: getActorId(req),
  });

  res.status(200).json({
    success: true,
    message: 'تنظیمات مخزن با موفقیت ویرایش شد.',
    data: repository,
  });
};

export const deleteRepositoryConnectionController = async (
  req: Request,
  res: Response,
): Promise<void> => {
  await deleteRepositoryConnection(req.params.repositoryId);

  res.status(200).json({
    success: true,
    message: 'اتصال مخزن با موفقیت حذف شد.',
  });
};

export const startRepositoryAnalysisController = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const expectationsInput = buildRepositoryExpectationsInput({
    file: req.file,
    expectationsText: req.body?.expectationsText,
    concurrentUsers: req.body?.concurrentUsers,
    requestsPerSecond: req.body?.requestsPerSecond,
    targetLatencyMs: req.body?.targetLatencyMs,
    availabilityPercent: req.body?.availabilityPercent,
    dataVolume: req.body?.dataVolume,
    growthHorizonMonths: req.body?.growthHorizonMonths,
  });
  const run = await startRepositoryAnalysis({
    repositoryId: req.params.repositoryId,
    ref: req.body?.ref,
    useAi: req.body?.useAi,
    expectations: expectationsInput.metadata,
    expectationsContent: expectationsInput.content,
    actorId: getActorId(req),
  });

  res.status(202).json({
    success: true,
    message: 'تحلیل ایستای مخزن در صف اجرا قرار گرفت.',
    data: run,
  });
};

export const getRepositoryAnalysisRunController = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const run = await getRepositoryAnalysisRun(req.params.runId);

  res.status(200).json({
    success: true,
    message: 'نتیجه تحلیل مخزن با موفقیت دریافت شد.',
    data: run,
  });
};

export const listRepositoryAnalysisRunsController = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const result = await listRepositoryAnalysisRuns({
    repositoryId: req.query.repositoryId as string | undefined,
    projectId: req.query.projectId as string | undefined,
    status: req.query.status as RepositoryAnalysisRunStatus | undefined,
    page: Number(req.query.page || 1),
    limit: Number(req.query.limit || 20),
  });

  res.status(200).json({
    success: true,
    message: 'تاریخچه تحلیل مخازن با موفقیت دریافت شد.',
    data: result.items,
    pagination: result.pagination,
  });
};
