import fs from 'fs';
import path from 'path';
import { env } from '@/config/env';
import {
  PythonProcessError,
  runPythonJsonProcess,
  type PythonProcessEvent,
} from '@/shared/python';
import { AppError } from '@/shared/http/app-error';

export interface PythonRepositoryAiProgress {
  stage: string;
  percent: number;
  message?: string;
}

export interface PythonRepositoryAiMetadata {
  engine?: string;
  pipelineVersion?: string;
  passes?: unknown;
  moduleBatches?: unknown;
  requirementCount?: unknown;
  evidenceCoveragePercent?: unknown;
  referencedFiles?: unknown;
  criticVerdict?: unknown;
  unsupportedClaimsRemoved?: unknown;
  missingEvidenceItems?: unknown;
  durationMs?: unknown;
  modelCalls?: unknown;
}

export interface PythonRepositoryAiResponse {
  result: Record<string, unknown>;
  metadata: PythonRepositoryAiMetadata;
  model?: string;
}

const resolvePythonPackagePath = (): string => {
  const configured = env.repositoryAnalysisPythonPath.trim();
  const pythonPath = path.isAbsolute(configured)
    ? configured
    : path.resolve(process.cwd(), configured);
  const modulePath = path.join(
    pythonPath,
    ...env.repositoryAnalysisPythonModule.split('.'),
    '__main__.py',
  );

  if (!fs.existsSync(modulePath)) {
    throw new AppError(
      `پکیج Python تحلیل مخزن یافت نشد: ${modulePath}`,
      500,
      'REPOSITORY_AI_PYTHON_MODULE_NOT_FOUND',
      {
        pythonPath,
        module: env.repositoryAnalysisPythonModule,
        expectedEntrypoint: modulePath,
      },
    );
  }

  return pythonPath;
};

const toProgress = (
  event: PythonProcessEvent,
): PythonRepositoryAiProgress | null => {
  if (event.type !== 'progress') return null;
  const stage = typeof event.stage === 'string' ? event.stage : '';
  const percent = Number(event.percent);
  if (!stage || !Number.isFinite(percent)) return null;

  return {
    stage,
    percent: Math.max(0, Math.min(100, Math.round(percent))),
    message: typeof event.message === 'string' ? event.message : undefined,
  };
};

const validatePythonResponse = (value: unknown): PythonRepositoryAiResponse => {
  if (!value || typeof value !== 'object') {
    throw new Error('Python result must be an object.');
  }

  const response = value as Partial<PythonRepositoryAiResponse>;
  if (!response.result || typeof response.result !== 'object') {
    throw new Error('Python result object is missing.');
  }

  return {
    result: response.result,
    metadata:
      response.metadata && typeof response.metadata === 'object'
        ? response.metadata
        : {},
    model: typeof response.model === 'string' ? response.model : undefined,
  };
};

const mapPythonError = (error: PythonProcessError): AppError => {
  const rawDetails = error.event?.details;
  const details =
    rawDetails && typeof rawDetails === 'object'
      ? { ...(rawDetails as Record<string, unknown>) }
      : rawDetails === undefined
        ? {}
        : { rawDetails };
  const httpStatus = Number(details.httpStatus);
  const statusCode =
    Number.isFinite(httpStatus) && httpStatus >= 400 && httpStatus < 600
      ? httpStatus
      : error.code === 'PYTHON_PROCESS_TIMEOUT'
        ? 504
        : 502;

  return new AppError(
    error.message,
    statusCode,
    error.code,
    {
      ...details,
      childProcess: error.diagnostics,
      pythonModule: env.repositoryAnalysisPythonModule,
    },
  );
};

export const runPythonRepositoryAiPipeline = async (input: {
  context: Record<string, unknown>;
  onProgress?: (progress: PythonRepositoryAiProgress) => Promise<void> | void;
}): Promise<PythonRepositoryAiResponse> => {
  const pythonPath = resolvePythonPackagePath();
  const existingPythonPath = process.env.PYTHONPATH?.trim();
  const effectivePythonPath = existingPythonPath
    ? `${pythonPath}${path.delimiter}${existingPythonPath}`
    : pythonPath;

  try {
    return await runPythonJsonProcess<PythonRepositoryAiResponse>({
      command: env.repositoryAnalysisPythonBin,
      args: ['-m', env.repositoryAnalysisPythonModule],
      cwd: process.cwd(),
      timeoutMs: Math.max(30_000, env.repositoryAnalysisAiChildTimeoutMs),
      maxOutputBytes: Math.max(
        256 * 1024,
        env.repositoryAnalysisAiMaxOutputBytes,
      ),
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        LANG: process.env.LANG || 'C.UTF-8',
        LC_ALL: process.env.LC_ALL,
        SSL_CERT_FILE: process.env.SSL_CERT_FILE,
        HTTPS_PROXY: process.env.HTTPS_PROXY,
        HTTP_PROXY: process.env.HTTP_PROXY,
        NO_PROXY: process.env.NO_PROXY,
        OPENAI_BASE_URL: env.openaiBaseUrl,
        OPENAI_REPOSITORY_ANALYSIS_MODEL:
          env.openaiRepositoryAnalysisModel,
        PYTHONPATH: effectivePythonPath,
        PYTHONUNBUFFERED: '1',
        PYTHONDONTWRITEBYTECODE: '1',
      },
      input: {
        config: {
          baseUrl: env.openaiBaseUrl,
          model: env.openaiRepositoryAnalysisModel,
          requestTimeoutMs: env.openaiRepositoryAnalysisTimeoutMs,
          maxBatches: env.repositoryAnalysisAiMaxBatches,
          batchChars: env.repositoryAnalysisAiBatchChars,
          criticEnabled: env.repositoryAnalysisAiCriticEnabled,
          maxRetries: 2,
        },
        context: input.context,
      },
      onEvent: async (event) => {
        const progress = toProgress(event);
        if (progress && input.onProgress) {
          await input.onProgress(progress);
        }
      },
      validateResult: validatePythonResponse,
    });
  } catch (error) {
    if (error instanceof PythonProcessError) {
      throw mapPythonError(error);
    }
    throw error;
  }
};
