import mongoose from 'mongoose';
import { env } from '@/config/env';
import { Project } from '@/modules/projects/project.model';
import { AppError } from '@/shared/http/app-error';
import {
  fetchGitLabCommit,
  fetchGitLabProjectMetadata,
  listGitLabRepositoryTree,
  parseGitLabRepositoryUrl,
} from './gitlab-repository.service';
import { enhanceRepositoryAnalysisWithAi } from './repository-ai-analysis.service';
import { buildDeterministicRepositoryAssessments } from './repository-assessment.service';
import {
  RepositoryAiErrorDetails,
  RepositoryAnalysisQuality,
  RepositoryAnalysisRun,
  RepositoryAnalysisRunDocument,
  RepositoryAnalysisRunStatus,
  RepositoryConnection,
  RepositoryConnectionDocument,
  RepositoryExpectationsSnapshot,
} from './repository-analysis.model';
import { runDeterministicRepositoryAnalysis } from './repository-static-analysis.service';

const assertObjectId = (value: string, fieldName: string): void => {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw new AppError(
      `${fieldName} معتبر نیست.`,
      400,
      'INVALID_OBJECT_ID',
      { field: fieldName },
    );
  }
};

const asObjectIdOrNull = (value?: string | null): mongoose.Types.ObjectId | null => {
  if (!value || !mongoose.Types.ObjectId.isValid(value)) return null;
  return new mongoose.Types.ObjectId(value);
};

export const createRepositoryConnection = async (input: {
  projectId: string;
  name?: string;
  repositoryUrl: string;
  defaultBranch?: string;
  actorId?: string;
}): Promise<RepositoryConnectionDocument> => {
  if (!env.repositoryAnalysisEnabled) {
    throw new AppError(
      'ماژول تحلیل مخزن غیرفعال است.',
      503,
      'REPOSITORY_ANALYSIS_DISABLED',
    );
  }

  assertObjectId(input.projectId, 'projectId');

  const project = await Project.findById(input.projectId).select('_id title');

  if (!project) {
    throw new AppError('پروژه یافت نشد.', 404, 'PROJECT_NOT_FOUND');
  }

  const parsed = parseGitLabRepositoryUrl(input.repositoryUrl);
  const existing = await RepositoryConnection.findOne({
    projectId: project._id,
    gitlabBaseUrl: parsed.baseUrl,
    gitlabProjectPath: parsed.projectPath,
  });

  if (existing) {
    throw new AppError(
      'این مخزن قبلاً برای پروژه ثبت شده است.',
      409,
      'REPOSITORY_ALREADY_CONNECTED',
    );
  }

  const repository = await RepositoryConnection.create({
    projectId: project._id,
    name: input.name?.trim() || parsed.projectPath.split('/').pop() || project.title,
    repositoryUrl: parsed.repositoryUrl,
    gitlabBaseUrl: parsed.baseUrl,
    gitlabProjectPath: parsed.projectPath,
    defaultBranch: input.defaultBranch?.trim() || '',
    enabled: true,
    createdBy: asObjectIdOrNull(input.actorId),
    updatedBy: asObjectIdOrNull(input.actorId),
  });

  return repository;
};

export const listRepositoryConnections = async (input: {
  projectId?: string;
  enabled?: boolean;
}): Promise<RepositoryConnectionDocument[]> => {
  const filter: Record<string, unknown> = {};

  if (input.projectId) {
    assertObjectId(input.projectId, 'projectId');
    filter.projectId = input.projectId;
  }

  if (typeof input.enabled === 'boolean') {
    filter.enabled = input.enabled;
  }

  return RepositoryConnection.find(filter)
    .sort({ createdAt: -1 })
    .populate('projectId', 'title status priority')
    .lean(false);
};

export const getRepositoryConnection = async (
  repositoryId: string,
): Promise<RepositoryConnectionDocument> => {
  assertObjectId(repositoryId, 'repositoryId');

  const repository = await RepositoryConnection.findById(repositoryId).populate(
    'projectId',
    'title status priority',
  );

  if (!repository) {
    throw new AppError('مخزن ثبت‌شده یافت نشد.', 404, 'REPOSITORY_NOT_FOUND');
  }

  return repository;
};

export const updateRepositoryConnection = async (input: {
  repositoryId: string;
  name?: string;
  repositoryUrl?: string;
  defaultBranch?: string;
  enabled?: boolean;
  actorId?: string;
}): Promise<RepositoryConnectionDocument> => {
  assertObjectId(input.repositoryId, 'repositoryId');

  const repository = await RepositoryConnection.findById(input.repositoryId);

  if (!repository) {
    throw new AppError('مخزن ثبت‌شده یافت نشد.', 404, 'REPOSITORY_NOT_FOUND');
  }

  if (input.repositoryUrl !== undefined) {
    const parsed = parseGitLabRepositoryUrl(input.repositoryUrl);
    const duplicate = await RepositoryConnection.findOne({
      _id: { $ne: repository._id },
      projectId: repository.projectId,
      gitlabBaseUrl: parsed.baseUrl,
      gitlabProjectPath: parsed.projectPath,
    });

    if (duplicate) {
      throw new AppError(
        'این مخزن قبلاً برای پروژه ثبت شده است.',
        409,
        'REPOSITORY_ALREADY_CONNECTED',
      );
    }

    repository.repositoryUrl = parsed.repositoryUrl;
    repository.gitlabBaseUrl = parsed.baseUrl;
    repository.gitlabProjectPath = parsed.projectPath;
  }

  if (input.name !== undefined) repository.name = input.name.trim();
  if (input.defaultBranch !== undefined) {
    repository.defaultBranch = input.defaultBranch.trim();
  }
  if (input.enabled !== undefined) repository.enabled = input.enabled;
  repository.updatedBy = asObjectIdOrNull(input.actorId);

  await repository.save();
  return repository;
};

export const deleteRepositoryConnection = async (
  repositoryId: string,
): Promise<void> => {
  assertObjectId(repositoryId, 'repositoryId');

  const activeRun = await RepositoryAnalysisRun.exists({
    repositoryId,
    status: {
      $in: [
        RepositoryAnalysisRunStatus.QUEUED,
        RepositoryAnalysisRunStatus.SCANNING,
        RepositoryAnalysisRunStatus.ANALYZING,
      ],
    },
  });

  if (activeRun) {
    throw new AppError(
      'تا پایان تحلیل فعال امکان حذف مخزن وجود ندارد.',
      409,
      'REPOSITORY_ANALYSIS_IN_PROGRESS',
    );
  }

  const repository = await RepositoryConnection.findByIdAndDelete(repositoryId);

  if (!repository) {
    throw new AppError('مخزن ثبت‌شده یافت نشد.', 404, 'REPOSITORY_NOT_FOUND');
  }
};

const updateRunProgress = async (
  runId: string,
  values: Partial<RepositoryAnalysisRunDocument>,
): Promise<void> => {
  await RepositoryAnalysisRun.updateOne({ _id: runId }, { $set: values });
};

const normalizeFailure = (error: unknown): {
  code: string;
  message: string;
  details?: unknown;
} => {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message, details: error.details };
  }

  if (error instanceof Error) {
    return {
      code: 'REPOSITORY_ANALYSIS_FAILED',
      message: error.message,
      details: {
        exceptionType: error.name,
        exceptionMessage: error.message,
      },
    };
  }

  return {
    code: 'REPOSITORY_ANALYSIS_FAILED',
    message: 'Unknown repository analysis error.',
    details: { rawError: String(error) },
  };
};

const normalizeAiErrorDetails = (input: {
  code: string;
  message: string;
  details?: unknown;
}): RepositoryAiErrorDetails => {
  const rawDetails =
    input.details && typeof input.details === 'object'
      ? (input.details as Record<string, unknown>)
      : {};
  const rawOpenAiError =
    rawDetails.openaiError && typeof rawDetails.openaiError === 'object'
      ? (rawDetails.openaiError as Record<string, unknown>)
      : null;

  return {
    ...rawDetails,
    source:
      typeof rawDetails.source === 'string' ? rawDetails.source : 'repository_ai',
    stage:
      typeof rawDetails.stage === 'string'
        ? rawDetails.stage
        : 'ai_architecture_review',
    openaiError: rawOpenAiError
      ? {
          message:
            typeof rawOpenAiError.message === 'string'
              ? rawOpenAiError.message
              : input.message,
          type:
            typeof rawOpenAiError.type === 'string'
              ? rawOpenAiError.type
              : null,
          code:
            typeof rawOpenAiError.code === 'string'
              ? rawOpenAiError.code
              : input.code,
          param: rawOpenAiError.param,
        }
      : {
          message: input.message,
          type: null,
          code: input.code,
          param: null,
        },
  } as RepositoryAiErrorDetails;
};

export const executeRepositoryAnalysis = async (runId: string): Promise<void> => {
  const run = await RepositoryAnalysisRun.findById(runId).select('+expectationsContent');

  if (!run) return;

  const repository = await RepositoryConnection.findById(run.repositoryId);

  if (!repository || !repository.enabled) {
    await updateRunProgress(runId, {
      status: RepositoryAnalysisRunStatus.FAILED,
      currentStage: 'failed',
      progressPercent: 100,
      errorCode: repository
        ? 'REPOSITORY_DISABLED'
        : 'REPOSITORY_NOT_FOUND',
      errorMessage: repository
        ? 'Repository connection is disabled.'
        : 'Repository connection no longer exists.',
      completedAt: new Date(),
    });
    return;
  }

  try {
    const parsedRepository = parseGitLabRepositoryUrl(repository.repositoryUrl);

    if (
      parsedRepository.baseUrl !== repository.gitlabBaseUrl ||
      parsedRepository.projectPath !== repository.gitlabProjectPath
    ) {
      repository.gitlabBaseUrl = parsedRepository.baseUrl;
      repository.gitlabProjectPath = parsedRepository.projectPath;
      await repository.save();
    }

    await updateRunProgress(runId, {
      status: RepositoryAnalysisRunStatus.SCANNING,
      currentStage: 'resolving_repository',
      progressPercent: 5,
      startedAt: new Date(),
      errorCode: '',
      errorMessage: '',
      aiError: null,
    });

    const projectMetadata = await fetchGitLabProjectMetadata(
      parsedRepository.baseUrl,
      parsedRepository.projectPath,
    );
    const gitlabProjectId = String(projectMetadata.id);
    let resolvedRef =
      run.requestedRef ||
      repository.defaultBranch ||
      projectMetadata.default_branch ||
      'main';

    await updateRunProgress(runId, {
      resolvedRef,
      currentStage: 'resolving_commit',
      progressPercent: 12,
    });

    let commit: Awaited<ReturnType<typeof fetchGitLabCommit>>;

    try {
      commit = await fetchGitLabCommit(
        parsedRepository.baseUrl,
        gitlabProjectId,
        resolvedRef,
      );
    } catch (error) {
      const canRetryDefaultBranch =
        error instanceof AppError &&
        error.code === 'GITLAB_REF_NOT_FOUND' &&
        !run.requestedRef &&
        Boolean(projectMetadata.default_branch) &&
        projectMetadata.default_branch !== resolvedRef;

      if (!canRetryDefaultBranch) throw error;

      resolvedRef = projectMetadata.default_branch as string;
      commit = await fetchGitLabCommit(
        parsedRepository.baseUrl,
        gitlabProjectId,
        resolvedRef,
      );

      repository.defaultBranch = resolvedRef;
      await repository.save();

      await updateRunProgress(runId, {
        resolvedRef,
        currentStage: 'resolving_commit',
        progressPercent: 15,
      });
    }

    await updateRunProgress(runId, {
      commitSha: commit.id,
      currentStage: 'reading_repository_tree',
      progressPercent: 22,
    });

    const tree = await listGitLabRepositoryTree(
      parsedRepository.baseUrl,
      gitlabProjectId,
      commit.id,
    );

    await updateRunProgress(runId, {
      currentStage: 'detecting_packages_and_architecture',
      progressPercent: 42,
    });

    const deterministic = await runDeterministicRepositoryAnalysis({
      baseUrl: parsedRepository.baseUrl,
      projectPath: gitlabProjectId,
      ref: commit.id,
      entries: tree.entries,
      truncated: tree.truncated,
    });
    const expectations = run.expectations || {
      source: 'none' as const,
      fileName: '',
      mimeType: '',
      sizeBytes: 0,
      sha256: '',
      contentLength: 0,
      provided: false,
      workloadTargets: {},
    };
    const deterministicAssessments = buildDeterministicRepositoryAssessments({
      expectations,
      expectationsContent: run.expectationsContent || '',
      inventory: deterministic.inventory,
      packages: deterministic.packages,
      frameworks: deterministic.frameworks,
      architecture: deterministic.architecture,
      files: deterministic.files,
      repositoryPaths: tree.entries.map((entry) => entry.path),
    });
    const deterministicExecutiveReport = [
      deterministic.executiveReport,
      `ارزیابی آمادگی: ${deterministicAssessments.readinessAssessment.summary}`,
      `ارزیابی ظرفیت: ${deterministicAssessments.scalabilityAssessment.summary}`,
      `بازبینی کد: ${deterministicAssessments.codeReviewAssessment.summary}`,
    ].join('\n');
    const deterministicTechnicalReport = [
      deterministic.technicalReport,
      `شکاف‌های آمادگی: ${deterministicAssessments.readinessAssessment.gaps.join(' ') || 'مورد قطعی شناسایی نشد.'}`,
      `ریسک‌های ظرفیت: ${deterministicAssessments.scalabilityAssessment.capacityRisks.join(' ')}`,
      `یافته‌های بازبینی کد: ${deterministicAssessments.codeReviewAssessment.findings.map((item) => item.title).join('، ') || 'یافته قطعی شناسایی نشد.'}`,
    ].join('\n');

    let finalArchitecture = deterministic.architecture;
    let finalReadinessAssessment = deterministicAssessments.readinessAssessment;
    let finalScalabilityAssessment = deterministicAssessments.scalabilityAssessment;
    let finalCodeReviewAssessment = deterministicAssessments.codeReviewAssessment;
    let finalAnalysisQuality: RepositoryAnalysisQuality = {
      engine: 'deterministic',
      pipelineVersion: '1.0.0',
      passes: ['deterministic_repository_scan'],
      moduleBatches: 0,
      requirementCount:
        deterministicAssessments.readinessAssessment.matchedExpectations.length,
      evidenceCoveragePercent: 0,
      referencedFiles: [] as string[],
      criticVerdict: 'not_run',
      unsupportedClaimsRemoved: 0,
      missingEvidenceItems: [] as string[],
      durationMs: 0,
      modelCalls: 0,
    };

    await updateRunProgress(runId, {
      inventory: deterministic.inventory,
      packages: deterministic.packages,
      frameworks: deterministic.frameworks,
      architecture: deterministic.architecture,
      readinessAssessment: deterministicAssessments.readinessAssessment,
      scalabilityAssessment: deterministicAssessments.scalabilityAssessment,
      codeReviewAssessment: deterministicAssessments.codeReviewAssessment,
      analysisQuality: finalAnalysisQuality,
      executiveReport: deterministicExecutiveReport,
      technicalReport: deterministicTechnicalReport,
      warnings: deterministic.warnings,
      currentStage: run.aiEnabled ? 'ai_architecture_review' : 'finalizing',
      progressPercent: run.aiEnabled ? 70 : 92,
    });
    let finalExecutiveReport = deterministicExecutiveReport;
    let finalTechnicalReport = deterministicTechnicalReport;
    let finalWarnings = [...deterministic.warnings];
    let aiUsed = false;
    let aiModel = '';
    let finalAiError: RepositoryAiErrorDetails | null = null;
    let finalStatus = RepositoryAnalysisRunStatus.COMPLETED;

    if (run.aiEnabled) {
      await updateRunProgress(runId, {
        status: RepositoryAnalysisRunStatus.ANALYZING,
        currentStage: 'ai_architecture_review',
        progressPercent: 72,
      });

      if (
        env.repositoryAnalysisAiEngine !== 'python_multi_pass' &&
        !env.openaiApiKey
      ) {
        finalAiError = {
          source: 'configuration',
          stage: 'ai_architecture_review',
          model: env.openaiRepositoryAnalysisModel,
          openaiError: {
            message: 'OPENAI_API_KEY برای مسیر TypeScript تنظیم نشده است.',
            type: 'configuration_error',
            code: 'OPENAI_API_KEY_NOT_CONFIGURED',
            param: null,
          },
          retryable: false,
        };
        finalWarnings.push(
          'کلید OpenAI برای مسیر انتخاب‌شده تنظیم نشده است؛ گزارش فقط بر اساس تحلیل ایستای قطعی تولید شد.',
        );
        finalStatus = RepositoryAnalysisRunStatus.PARTIALLY_COMPLETED;
      } else {
        try {
          const aiResult = await enhanceRepositoryAnalysisWithAi({
            inventory: deterministic.inventory,
            packages: deterministic.packages,
            frameworks: deterministic.frameworks,
            deterministicArchitecture: deterministic.architecture,
            expectations,
            expectationsContent: run.expectationsContent || '',
            deterministicReadinessAssessment:
              deterministicAssessments.readinessAssessment,
            deterministicScalabilityAssessment:
              deterministicAssessments.scalabilityAssessment,
            deterministicCodeReviewAssessment:
              deterministicAssessments.codeReviewAssessment,
            deterministicExecutiveReport,
            deterministicTechnicalReport,
            files: deterministic.files,
            repositoryPaths: tree.entries.map((entry) => entry.path),
            onProgress: async (progress) => {
              await updateRunProgress(runId, {
                status: RepositoryAnalysisRunStatus.ANALYZING,
                currentStage: progress.stage,
                progressPercent: Math.max(72, Math.min(98, progress.percent)),
              });
            },
          });

          finalArchitecture = aiResult.architecture;
          finalReadinessAssessment = aiResult.readinessAssessment;
          finalScalabilityAssessment = aiResult.scalabilityAssessment;
          finalCodeReviewAssessment = aiResult.codeReviewAssessment;
          finalAnalysisQuality = aiResult.analysisQuality;
          finalExecutiveReport = aiResult.executiveReport;
          finalTechnicalReport = aiResult.technicalReport;
          finalWarnings.push(...aiResult.warnings);
          aiUsed = true;
          aiModel = aiResult.model;
          finalAiError = null;
        } catch (error) {
          const failure = normalizeFailure(error);
          finalAiError = normalizeAiErrorDetails(failure);
          const apiCode = finalAiError.openaiError?.code || failure.code;
          const requestId = finalAiError.requestId
            ? ` | request_id=${finalAiError.requestId}`
            : '';
          finalWarnings.push(
            `تکمیل تحلیل معماری با هوش مصنوعی ناموفق بود (${apiCode}): ${
              finalAiError.openaiError?.message || failure.message
            }${requestId}`,
          );
          finalStatus = RepositoryAnalysisRunStatus.PARTIALLY_COMPLETED;
        }
      }
    }

    const scopeStatement =
      'محدوده تحلیل: بررسی مخزن و مقایسه با انتظارات به‌صورت ایستا انجام شده است؛ پروژه نصب، Build، اجرا، تست بار یا تست نفوذ نشده و ظرفیت عددی فقط با آزمون عملی قابل تایید است.';
    if (!finalExecutiveReport.includes(scopeStatement)) {
      finalExecutiveReport = `${scopeStatement}\n${finalExecutiveReport}`;
    }
    if (!finalTechnicalReport.includes(scopeStatement)) {
      finalTechnicalReport = `${scopeStatement}\n${finalTechnicalReport}`;
    }

    await updateRunProgress(runId, {
      status: finalStatus,
      currentStage: 'completed',
      progressPercent: 100,
      inventory: deterministic.inventory,
      packages: deterministic.packages,
      frameworks: deterministic.frameworks,
      architecture: finalArchitecture,
      readinessAssessment: finalReadinessAssessment,
      scalabilityAssessment: finalScalabilityAssessment,
      codeReviewAssessment: finalCodeReviewAssessment,
      analysisQuality: finalAnalysisQuality,
      executiveReport: finalExecutiveReport,
      technicalReport: finalTechnicalReport,
      aiUsed,
      aiModel,
      aiError: finalAiError,
      warnings: finalWarnings,
      completedAt: new Date(),
    });

    if (!repository.defaultBranch && projectMetadata.default_branch) {
      repository.defaultBranch = projectMetadata.default_branch;
      await repository.save();
    }
  } catch (error) {
    const failure = normalizeFailure(error);

    await updateRunProgress(runId, {
      status: RepositoryAnalysisRunStatus.FAILED,
      currentStage: 'failed',
      progressPercent: 100,
      errorCode: failure.code,
      errorMessage: failure.message,
      completedAt: new Date(),
    });
  }
};

export const startRepositoryAnalysis = async (input: {
  repositoryId: string;
  ref?: string;
  useAi?: boolean;
  expectations: RepositoryExpectationsSnapshot;
  expectationsContent: string;
  actorId?: string;
}): Promise<RepositoryAnalysisRunDocument> => {
  if (!env.repositoryAnalysisEnabled) {
    throw new AppError(
      'ماژول تحلیل مخزن غیرفعال است.',
      503,
      'REPOSITORY_ANALYSIS_DISABLED',
    );
  }

  assertObjectId(input.repositoryId, 'repositoryId');

  const repository = await RepositoryConnection.findById(input.repositoryId);

  if (!repository) {
    throw new AppError('مخزن ثبت‌شده یافت نشد.', 404, 'REPOSITORY_NOT_FOUND');
  }

  if (!repository.enabled) {
    throw new AppError(
      'این اتصال مخزن غیرفعال است.',
      409,
      'REPOSITORY_DISABLED',
    );
  }

  const staleBefore = new Date(
    Date.now() - Math.max(60_000, env.repositoryAnalysisStaleAfterMs),
  );
  await RepositoryAnalysisRun.updateMany(
    {
      repositoryId: repository._id,
      status: {
        $in: [
          RepositoryAnalysisRunStatus.QUEUED,
          RepositoryAnalysisRunStatus.SCANNING,
          RepositoryAnalysisRunStatus.ANALYZING,
        ],
      },
      updatedAt: { $lt: staleBefore },
    },
    {
      $set: {
        status: RepositoryAnalysisRunStatus.FAILED,
        currentStage: 'failed',
        progressPercent: 100,
        errorCode: 'REPOSITORY_ANALYSIS_INTERRUPTED',
        errorMessage:
          'The previous analysis stopped updating and was marked as interrupted.',
        completedAt: new Date(),
      },
    },
  );

  const activeRun = await RepositoryAnalysisRun.findOne({
    repositoryId: repository._id,
    status: {
      $in: [
        RepositoryAnalysisRunStatus.QUEUED,
        RepositoryAnalysisRunStatus.SCANNING,
        RepositoryAnalysisRunStatus.ANALYZING,
      ],
    },
  }).sort({ createdAt: -1 });

  if (activeRun) {
    throw new AppError(
      'یک تحلیل برای این مخزن در حال اجرا است.',
      409,
      'REPOSITORY_ANALYSIS_ALREADY_RUNNING',
      { analysisRunId: activeRun._id.toString() },
    );
  }

  const run = await RepositoryAnalysisRun.create({
    repositoryId: repository._id,
    projectId: repository.projectId,
    requestedRef: input.ref?.trim() || '',
    resolvedRef: '',
    commitSha: '',
    status: RepositoryAnalysisRunStatus.QUEUED,
    currentStage: 'queued',
    progressPercent: 0,
    packages: [],
    frameworks: [],
    expectations: input.expectations,
    expectationsContent: input.expectationsContent,
    readinessAssessment: null,
    scalabilityAssessment: null,
    codeReviewAssessment: null,
    analysisQuality: null,
    executiveReport: '',
    technicalReport: '',
    aiEnabled: input.useAi !== false,
    aiUsed: false,
    aiModel: '',
    aiError: null,
    warnings: [],
    requestedBy: asObjectIdOrNull(input.actorId),
  });

  setTimeout(() => {
    void executeRepositoryAnalysis(run._id.toString()).catch((error) => {
      console.error('Unhandled repository analysis execution error:', error);
    });
  });

  return run;
};

export const getRepositoryAnalysisRun = async (
  runId: string,
): Promise<RepositoryAnalysisRunDocument> => {
  assertObjectId(runId, 'analysisRunId');

  const run = await RepositoryAnalysisRun.findById(runId)
    .populate('repositoryId', 'name repositoryUrl gitlabProjectPath defaultBranch enabled')
    .populate('projectId', 'title status priority')
    .populate('requestedBy', 'firstName lastName fullName username');

  if (!run) {
    throw new AppError('نتیجه تحلیل مخزن یافت نشد.', 404, 'ANALYSIS_RUN_NOT_FOUND');
  }

  return run;
};

export const listRepositoryAnalysisRuns = async (input: {
  repositoryId?: string;
  projectId?: string;
  status?: RepositoryAnalysisRunStatus;
  page?: number;
  limit?: number;
}): Promise<{
  items: RepositoryAnalysisRunDocument[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> => {
  const filter: Record<string, unknown> = {};

  if (input.repositoryId) {
    assertObjectId(input.repositoryId, 'repositoryId');
    filter.repositoryId = input.repositoryId;
  }

  if (input.projectId) {
    assertObjectId(input.projectId, 'projectId');
    filter.projectId = input.projectId;
  }

  if (input.status) filter.status = input.status;

  const page = Math.max(1, input.page || 1);
  const limit = Math.min(100, Math.max(1, input.limit || 20));
  const [items, total] = await Promise.all([
    RepositoryAnalysisRun.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('repositoryId', 'name repositoryUrl gitlabProjectPath defaultBranch enabled')
      .populate('projectId', 'title status priority'),
    RepositoryAnalysisRun.countDocuments(filter),
  ]);

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
};
