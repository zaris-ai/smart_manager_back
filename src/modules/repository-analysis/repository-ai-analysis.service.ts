import { randomUUID } from 'crypto';
import { env } from '@/config/env';
import { AppError } from '@/shared/http/app-error';
import type {
  RepositoryAnalysisQuality,
  RepositoryArchitectureResult,
  RepositoryCodeReviewAssessment,
  RepositoryCodeReviewFinding,
  RepositoryExpectationsSnapshot,
  RepositoryInventory,
  RepositoryPackageRecord,
  RepositoryReadinessAssessment,
  RepositoryRecommendation,
  RepositoryRequirementMatch,
  RepositoryScalabilityAssessment,
} from './repository-analysis.model';
import {
  runPythonRepositoryAiPipeline,
  PythonRepositoryAiMetadata,
  PythonRepositoryAiProgress,
} from './repository-ai-python.service';
import type { RepositoryFileContent } from './repository-static-analysis.service';

export interface AiRepositoryAnalysisResult {
  architecture: RepositoryArchitectureResult;
  readinessAssessment: RepositoryReadinessAssessment;
  scalabilityAssessment: RepositoryScalabilityAssessment;
  codeReviewAssessment: RepositoryCodeReviewAssessment;
  analysisQuality: RepositoryAnalysisQuality;
  executiveReport: string;
  technicalReport: string;
  model: string;
  warnings: string[];
}

interface OpenAiChatCompletionResponse {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
    type?: string;
    code?: string | null;
    param?: unknown;
  };
}

const clampConfidence = (value: unknown, fallback: number): number => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(1, Math.max(0, number));
};

const clampScore = (value: unknown, fallback: number): number => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(Math.min(100, Math.max(0, number)));
};

const clampInteger = (value: unknown, fallback: number, max = 1_000_000): number => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(Math.min(max, Math.max(0, number)));
};

const stringArray = (value: unknown, fallback: string[]): string[] => {
  if (!Array.isArray(value)) return fallback;

  const normalized = value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 200);

  return normalized.length > 0 ? [...new Set(normalized)] : fallback;
};

const stringValue = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

const booleanValue = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

const objectValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const enumValue = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T =>
  typeof value === 'string' && allowed.includes(value as T)
    ? (value as T)
    : fallback;

const extractJsonObject = (content: string): Record<string, unknown> => {
  const trimmed = content.trim();

  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');

    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as Record<
        string,
        unknown
      >;
    }

    throw new AppError(
      'پاسخ مدل تحلیل مخزن JSON معتبر نبود.',
      502,
      'OPENAI_INVALID_REPOSITORY_ANALYSIS_RESPONSE',
    );
  }
};

const normalizeRequirementMatches = (
  value: unknown,
  fallback: RepositoryRequirementMatch[],
): RepositoryRequirementMatch[] => {
  if (!Array.isArray(value)) return fallback;

  const normalized = value
    .map((item): RepositoryRequirementMatch | null => {
      const record = objectValue(item);
      const expectation = stringValue(record.expectation, '');
      if (!expectation) return null;

      return {
        id: stringValue(record.id, ''),
        category: stringValue(record.category, 'general'),
        priority: enumValue(
          record.priority,
          ['critical', 'high', 'medium', 'low'] as const,
          'medium',
        ),
        hardGate: booleanValue(record.hardGate, false),
        expectation,
        status: enumValue(
          record.status,
          ['met', 'partial', 'not_met', 'unknown'] as const,
          'unknown',
        ),
        evidence: stringArray(record.evidence, []),
        explanation: stringValue(record.explanation, ''),
      };
    })
    .filter((item): item is RepositoryRequirementMatch => Boolean(item))
    .slice(0, 180);

  return normalized.length > 0 ? normalized : fallback;
};

const normalizeRecommendations = (
  value: unknown,
  fallback: RepositoryRecommendation[],
): RepositoryRecommendation[] => {
  if (!Array.isArray(value)) return fallback;

  const normalized = value
    .map((item): RepositoryRecommendation | null => {
      const record = objectValue(item);
      const title = stringValue(record.title, '');
      if (!title) return null;

      return {
        priority: enumValue(
          record.priority,
          ['critical', 'high', 'medium', 'low'] as const,
          'medium',
        ),
        title,
        description: stringValue(record.description, ''),
        suggestedSolution: stringValue(record.suggestedSolution, ''),
        evidence: stringArray(record.evidence, []),
      };
    })
    .filter((item): item is RepositoryRecommendation => Boolean(item))
    .slice(0, 60);

  return normalized.length > 0 ? normalized : fallback;
};

const normalizeCodeFindings = (
  value: unknown,
  fallback: RepositoryCodeReviewFinding[],
): RepositoryCodeReviewFinding[] => {
  if (!Array.isArray(value)) return fallback;

  const normalized = value
    .map((item): RepositoryCodeReviewFinding | null => {
      const record = objectValue(item);
      const title = stringValue(record.title, '');
      if (!title) return null;

      return {
        severity: enumValue(
          record.severity,
          ['critical', 'high', 'medium', 'low', 'info'] as const,
          'info',
        ),
        category: stringValue(record.category, 'general'),
        title,
        description: stringValue(record.description, ''),
        evidencePaths: stringArray(record.evidencePaths, []),
        recommendation: stringValue(record.recommendation, ''),
      };
    })
    .filter((item): item is RepositoryCodeReviewFinding => Boolean(item))
    .slice(0, 100);

  return normalized.length > 0 ? normalized : fallback;
};

const buildPromptContext = (input: {
  inventory: RepositoryInventory;
  packages: RepositoryPackageRecord[];
  frameworks: string[];
  deterministicArchitecture: RepositoryArchitectureResult;
  expectations: RepositoryExpectationsSnapshot;
  expectationsContent: string;
  deterministicReadinessAssessment: RepositoryReadinessAssessment;
  deterministicScalabilityAssessment: RepositoryScalabilityAssessment;
  deterministicCodeReviewAssessment: RepositoryCodeReviewAssessment;
  deterministicExecutiveReport: string;
  deterministicTechnicalReport: string;
  files: RepositoryFileContent[];
  repositoryPaths: string[];
}): Record<string, unknown> => ({
  expectations: {
    metadata: input.expectations,
    content: input.expectationsContent.slice(0, 250_000),
  },
  inventory: input.inventory,
  packages: input.packages.slice(0, 800),
  frameworks: input.frameworks,
  deterministicArchitecture: input.deterministicArchitecture,
  deterministicReadinessAssessment: input.deterministicReadinessAssessment,
  deterministicScalabilityAssessment: input.deterministicScalabilityAssessment,
  deterministicCodeReviewAssessment: input.deterministicCodeReviewAssessment,
  deterministicExecutiveReport: input.deterministicExecutiveReport,
  deterministicTechnicalReport: input.deterministicTechnicalReport,
  repositoryPaths: input.repositoryPaths.slice(0, env.repositoryAnalysisMaxFiles),
  inspectedFiles: input.files.map((file) => ({
    path: file.path,
    purpose: file.purpose,
    content: file.content,
  })),
});

const selectedOpenAiHeaders = (headers: Headers): Record<string, string> => {
  const names = [
    'x-request-id',
    'openai-organization',
    'openai-processing-ms',
    'openai-version',
    'retry-after',
    'x-ratelimit-limit-requests',
    'x-ratelimit-limit-tokens',
    'x-ratelimit-remaining-requests',
    'x-ratelimit-remaining-tokens',
    'x-ratelimit-reset-requests',
    'x-ratelimit-reset-tokens',
  ];

  return names.reduce<Record<string, string>>((result, name) => {
    const value = headers.get(name);
    if (value !== null) result[name] = value;
    return result;
  }, {});
};

const callOpenAiSinglePass = async (
  context: Record<string, unknown>,
): Promise<OpenAiChatCompletionResponse> => {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    env.openaiRepositoryAnalysisTimeoutMs,
  );
  const endpoint = `${env.openaiBaseUrl}/chat/completions`;
  const clientRequestId = randomUUID();

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.openaiApiKey}`,
        'Content-Type': 'application/json',
        'X-Client-Request-Id': clientRequestId,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: env.openaiRepositoryAnalysisModel,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: [
              'You are a principal software architect and strict code reviewer performing an evidence-driven static repository audit.',
              'Use only the supplied expectations, repository inventory, manifests and inspected files.',
              'Do not claim that code was built, executed, load-tested, penetration-tested or deployed.',
              'Never invent paths, features or runtime measurements. Use unknown whenever evidence cannot prove a requirement.',
              'Every critical/high finding must cite one or more exact paths from repositoryPaths.',
              'Return one JSON object with exactly these top-level fields:',
              'classification, confidence, summary, layers, modules, strengths, concerns, evidence, readinessAssessment, scalabilityAssessment, codeReviewAssessment, executiveReport, technicalReport.',
              'Each matchedExpectations item fields: id, category, priority, hardGate, expectation, status, evidence, explanation.',
              'Readiness cannot be stronger than conditionally_ready because no execution tests were run.',
              'Scalability cannot be stronger than conditionally_sufficient because no load tests were run.',
              'Write every explanatory value in professional, natural Persian (Farsi).',
              'Keep packages, framework names, paths, filenames, identifiers and technical acronyms unchanged.',
              'Return valid JSON only, without Markdown fences.',
            ].join(' '),
          },
          {
            role: 'user',
            content: JSON.stringify(context),
          },
        ],
      }),
    });

    const rawBody = await response.text();
    let body: OpenAiChatCompletionResponse = {};

    try {
      body = rawBody ? (JSON.parse(rawBody) as OpenAiChatCompletionResponse) : {};
    } catch (error) {
      throw new AppError(
        'OpenAI پاسخ HTTP داد اما بدنه پاسخ JSON معتبر نبود.',
        502,
        'OPENAI_INVALID_HTTP_RESPONSE',
        {
          source: 'openai',
          stage: 'typescript_single_pass',
          endpoint,
          model: env.openaiRepositoryAnalysisModel,
          httpStatus: response.status,
          requestId: response.headers.get('x-request-id'),
          clientRequestId,
          headers: selectedOpenAiHeaders(response.headers),
          rawResponseBody: rawBody.slice(0, 12000),
          retryable: false,
          exceptionType: error instanceof Error ? error.name : 'JSONParseError',
          exceptionMessage: error instanceof Error ? error.message : String(error),
        },
      );
    }

    if (!response.ok) {
      const apiCode = body.error?.code || '';
      const backendCode = apiCode
        ? `OPENAI_${String(apiCode).toUpperCase()}`
        : `OPENAI_HTTP_${response.status}`;
      throw new AppError(
        body.error?.message ||
          `OpenAI repository analysis failed with status ${response.status}.`,
        response.status,
        backendCode,
        {
          source: 'openai',
          stage: 'typescript_single_pass',
          endpoint,
          model: env.openaiRepositoryAnalysisModel,
          httpStatus: response.status,
          openaiError: {
            message: body.error?.message || null,
            type: body.error?.type || null,
            code: body.error?.code || null,
            param: body.error?.param ?? null,
          },
          requestId: response.headers.get('x-request-id'),
          clientRequestId,
          organization: response.headers.get('openai-organization'),
          processingMs: response.headers.get('openai-processing-ms'),
          headers: selectedOpenAiHeaders(response.headers),
          rawResponseBody: rawBody.slice(0, 12000),
          retryable:
            response.status === 429 && apiCode !== 'insufficient_quota'
              ? true
              : [408, 409, 500, 502, 503, 504].includes(response.status),
          attempt: 1,
          maxAttempts: 1,
        },
      );
    }

    return body;
  } catch (error) {
    if (error instanceof AppError) throw error;

    if (error instanceof Error && error.name === 'AbortError') {
      throw new AppError(
        'تحلیل معماری توسط OpenAI بیش از زمان مجاز طول کشید.',
        504,
        'OPENAI_REPOSITORY_ANALYSIS_TIMEOUT',
        {
          source: 'network',
          stage: 'typescript_single_pass',
          endpoint,
          model: env.openaiRepositoryAnalysisModel,
          clientRequestId,
          retryable: true,
          timeoutSeconds: Math.round(
            env.openaiRepositoryAnalysisTimeoutMs / 1000,
          ),
          exceptionType: error.name,
          exceptionMessage: error.message,
        },
      );
    }

    throw new AppError(
      `ارتباط با OpenAI ناموفق بود: ${
        error instanceof Error ? error.message : String(error)
      }`,
      502,
      'OPENAI_NETWORK_ERROR',
      {
        source: 'network',
        stage: 'typescript_single_pass',
        endpoint,
        model: env.openaiRepositoryAnalysisModel,
        clientRequestId,
        retryable: true,
        exceptionType: error instanceof Error ? error.name : typeof error,
        exceptionMessage: error instanceof Error ? error.message : String(error),
      },
    );
  } finally {
    clearTimeout(timeout);
  }
};

const evidenceCandidate = (value: string): string =>
  value
    .trim()
    .replace(/^`|`$/g, '')
    .replace(/#L\d+(?:-L\d+)?$/i, '')
    .replace(/:\d+(?::\d+)?$/, '')
    .replace(/\s+\(\d+\s+lines?\)$/i, '')
    .trim();

const filterValidPaths = (values: string[], validPaths: Set<string>): string[] =>
  [...new Set(values.map(evidenceCandidate).filter((item) => validPaths.has(item)))];

const applyEvidenceGate = (input: {
  architecture: RepositoryArchitectureResult;
  readinessAssessment: RepositoryReadinessAssessment;
  scalabilityAssessment: RepositoryScalabilityAssessment;
  codeReviewAssessment: RepositoryCodeReviewAssessment;
  quality: RepositoryAnalysisQuality;
  validPaths: Set<string>;
  expectationsProvided: boolean;
}): void => {
  input.architecture.evidence = filterValidPaths(
    input.architecture.evidence,
    input.validPaths,
  );

  const downgradedRequirementIds: string[] = [];
  input.readinessAssessment.matchedExpectations =
    input.readinessAssessment.matchedExpectations.map((item, index) => {
      const evidence = filterValidPaths(item.evidence, input.validPaths);
      const status = item.status !== 'unknown' && evidence.length === 0
        ? 'unknown'
        : item.status;
      const requirementId = item.id || `REQ-${String(index + 1).padStart(3, '0')}`;
      if (status === 'unknown' && item.status !== 'unknown') {
        downgradedRequirementIds.push(requirementId);
      }

      return {
        ...item,
        id: requirementId,
        category: item.category || 'general',
        priority: item.priority || 'medium',
        hardGate: Boolean(item.hardGate),
        status,
        evidence,
        explanation:
          status === 'unknown' && item.status !== 'unknown'
            ? `${item.explanation} شواهد مسیر فایل برای تایید این نتیجه کافی نبود؛ وضعیت به نامشخص تغییر یافت.`
            : item.explanation,
      };
    });

  input.readinessAssessment.recommendations =
    input.readinessAssessment.recommendations.map((item) => ({
      ...item,
      evidence: filterValidPaths(item.evidence, input.validPaths),
    }));

  const removedFindings = input.codeReviewAssessment.findings.filter((item) => {
    const evidence = filterValidPaths(item.evidencePaths, input.validPaths);
    return item.evidencePaths.length > 0 && evidence.length === 0;
  }).length;

  input.codeReviewAssessment.findings = input.codeReviewAssessment.findings
    .map((item) => ({
      ...item,
      evidencePaths: filterValidPaths(item.evidencePaths, input.validPaths),
    }))
    .filter((item) => item.evidencePaths.length > 0);

  input.quality.unsupportedClaimsRemoved +=
    removedFindings + downgradedRequirementIds.length;
  input.quality.missingEvidenceItems = [
    ...new Set([
      ...input.quality.missingEvidenceItems,
      ...downgradedRequirementIds.map(
        (id) => `برای الزام ${id} مسیر فایل معتبر کافی ثبت نشده است.`,
      ),
    ]),
  ];
  input.quality.referencedFiles = [...new Set([
    ...input.architecture.evidence,
    ...input.readinessAssessment.matchedExpectations.flatMap((item) => item.evidence),
    ...input.readinessAssessment.recommendations.flatMap((item) => item.evidence),
    ...input.codeReviewAssessment.findings.flatMap((item) => item.evidencePaths),
  ])];

  const matches = input.readinessAssessment.matchedExpectations;
  const evidenceBacked = matches.filter(
    (item) => item.status !== 'unknown' && item.evidence.length > 0,
  ).length;
  input.quality.evidenceCoveragePercent = matches.length
    ? Math.round((evidenceBacked / matches.length) * 100)
    : 0;

  const weightByPriority = {
    critical: 5,
    high: 3,
    medium: 2,
    low: 1,
  } as const;
  const valueByStatus = {
    met: 1,
    partial: 0.5,
    not_met: 0,
    unknown: 0.2,
  } as const;

  if (!input.expectationsProvided || matches.length === 0) {
    input.readinessAssessment.verdict = 'insufficient_evidence';
    input.readinessAssessment.score = 0;
    input.readinessAssessment.confidence = 0.2;
  } else {
    const totals = matches.reduce(
      (accumulator, item) => {
        const priority = item.priority || 'medium';
        const weight = weightByPriority[priority];
        accumulator.weight += weight;
        accumulator.score += weight * valueByStatus[item.status];
        return accumulator;
      },
      { weight: 0, score: 0 },
    );
    input.readinessAssessment.score = totals.weight
      ? Math.round((totals.score / totals.weight) * 100)
      : 0;

    const hardGateFailure = matches.some(
      (item) => item.hardGate && item.status === 'not_met',
    );
    const criticalGap = matches.some(
      (item) =>
        item.priority === 'critical' &&
        ['partial', 'not_met', 'unknown'].includes(item.status),
    );
    const unknownRatio =
      matches.filter((item) => item.status === 'unknown').length / matches.length;

    if (hardGateFailure) {
      input.readinessAssessment.verdict = 'not_ready';
    } else if (criticalGap || input.readinessAssessment.score < 60) {
      input.readinessAssessment.verdict = 'not_ready';
    } else if (unknownRatio > 0.45) {
      input.readinessAssessment.verdict = 'insufficient_evidence';
    } else {
      input.readinessAssessment.verdict = 'conditionally_ready';
    }

    input.readinessAssessment.confidence = Math.min(
      0.85,
      Math.max(0.25, input.quality.evidenceCoveragePercent / 100),
    );
  }

  const readinessVerdictLabel = {
    ready: 'آماده',
    conditionally_ready: 'آماده مشروط',
    not_ready: 'آماده نیست',
    insufficient_evidence: 'شواهد ناکافی',
  }[input.readinessAssessment.verdict];
  input.readinessAssessment.summary = `${input.readinessAssessment.summary} نتیجه کنترل شواهد سرور: ${readinessVerdictLabel} با امتیاز ${input.readinessAssessment.score} از ۱۰۰.`;

  if (input.scalabilityAssessment.verdict === 'likely_sufficient') {
    input.scalabilityAssessment.verdict = 'conditionally_sufficient';
  }
  input.scalabilityAssessment.confidence = Math.min(
    0.65,
    input.scalabilityAssessment.confidence,
  );
};

const normalizeAnalysisQuality = (
  value: PythonRepositoryAiMetadata | Record<string, unknown> | undefined,
  engine: RepositoryAnalysisQuality['engine'],
): RepositoryAnalysisQuality => {
  const record = objectValue(value);
  return {
    engine,
    pipelineVersion: stringValue(
      record.pipelineVersion,
      engine === 'python_multi_pass' ? '2.0.0' : '1.0.0',
    ),
    passes: stringArray(
      record.passes,
      engine === 'python_multi_pass'
        ? [
            'requirements_extraction',
            'module_evidence_review',
            'candidate_synthesis',
            'adversarial_critic',
            'final_evidence_gate',
          ]
        : ['single_pass_review', 'server_evidence_gate'],
    ),
    moduleBatches: clampInteger(record.moduleBatches, engine === 'python_multi_pass' ? 1 : 0, 100),
    requirementCount: clampInteger(record.requirementCount, 0, 1000),
    evidenceCoveragePercent: clampScore(record.evidenceCoveragePercent, 0),
    referencedFiles: stringArray(record.referencedFiles, []),
    criticVerdict: enumValue(
      record.criticVerdict,
      ['approved', 'approved_with_caveats', 'rejected', 'not_run'] as const,
      engine === 'python_multi_pass' ? 'approved_with_caveats' : 'not_run',
    ),
    unsupportedClaimsRemoved: clampInteger(record.unsupportedClaimsRemoved, 0, 10_000),
    missingEvidenceItems: stringArray(record.missingEvidenceItems, []),
    durationMs: clampInteger(record.durationMs, 0, 24 * 60 * 60 * 1000),
    modelCalls: clampInteger(record.modelCalls, engine === 'deterministic' ? 0 : 1, 100),
  };
};

const normalizeAiResult = (input: {
  parsed: Record<string, unknown>;
  model: string;
  engine: RepositoryAnalysisQuality['engine'];
  metadata?: PythonRepositoryAiMetadata | Record<string, unknown>;
  deterministicArchitecture: RepositoryArchitectureResult;
  deterministicReadinessAssessment: RepositoryReadinessAssessment;
  deterministicScalabilityAssessment: RepositoryScalabilityAssessment;
  deterministicCodeReviewAssessment: RepositoryCodeReviewAssessment;
  deterministicExecutiveReport: string;
  deterministicTechnicalReport: string;
  repositoryPaths: string[];
  expectationsProvided: boolean;
  warnings?: string[];
}): AiRepositoryAnalysisResult => {
  const architecture: RepositoryArchitectureResult = {
    classification: stringValue(
      input.parsed.classification,
      input.deterministicArchitecture.classification,
    ),
    confidence: clampConfidence(
      input.parsed.confidence,
      input.deterministicArchitecture.confidence,
    ),
    summary: stringValue(
      input.parsed.summary,
      input.deterministicArchitecture.summary,
    ),
    layers: stringArray(
      input.parsed.layers,
      input.deterministicArchitecture.layers,
    ),
    modules: input.deterministicArchitecture.modules,
    strengths: stringArray(
      input.parsed.strengths,
      input.deterministicArchitecture.strengths,
    ),
    concerns: stringArray(
      input.parsed.concerns,
      input.deterministicArchitecture.concerns,
    ),
    evidence: stringArray(
      input.parsed.evidence,
      input.deterministicArchitecture.evidence,
    ),
  };

  const readinessValue = objectValue(input.parsed.readinessAssessment);
  const readinessAssessment: RepositoryReadinessAssessment = {
    verdict: enumValue(
      readinessValue.verdict,
      ['ready', 'conditionally_ready', 'not_ready', 'insufficient_evidence'] as const,
      input.deterministicReadinessAssessment.verdict,
    ),
    score: clampScore(
      readinessValue.score,
      input.deterministicReadinessAssessment.score,
    ),
    confidence: clampConfidence(
      readinessValue.confidence,
      input.deterministicReadinessAssessment.confidence,
    ),
    summary: stringValue(
      readinessValue.summary,
      input.deterministicReadinessAssessment.summary,
    ),
    matchedExpectations: normalizeRequirementMatches(
      readinessValue.matchedExpectations,
      input.deterministicReadinessAssessment.matchedExpectations,
    ),
    blockers: stringArray(
      readinessValue.blockers,
      input.deterministicReadinessAssessment.blockers,
    ),
    gaps: stringArray(
      readinessValue.gaps,
      input.deterministicReadinessAssessment.gaps,
    ),
    recommendations: normalizeRecommendations(
      readinessValue.recommendations,
      input.deterministicReadinessAssessment.recommendations,
    ),
  };

  const scalabilityValue = objectValue(input.parsed.scalabilityAssessment);
  const scalabilityAssessment: RepositoryScalabilityAssessment = {
    verdict: enumValue(
      scalabilityValue.verdict,
      [
        'likely_sufficient',
        'conditionally_sufficient',
        'unlikely_sufficient',
        'insufficient_evidence',
      ] as const,
      input.deterministicScalabilityAssessment.verdict,
    ),
    confidence: clampConfidence(
      scalabilityValue.confidence,
      input.deterministicScalabilityAssessment.confidence,
    ),
    summary: stringValue(
      scalabilityValue.summary,
      input.deterministicScalabilityAssessment.summary,
    ),
    workloadAssumptions: stringArray(
      scalabilityValue.workloadAssumptions,
      input.deterministicScalabilityAssessment.workloadAssumptions,
    ),
    strengths: stringArray(
      scalabilityValue.strengths,
      input.deterministicScalabilityAssessment.strengths,
    ),
    bottlenecks: stringArray(
      scalabilityValue.bottlenecks,
      input.deterministicScalabilityAssessment.bottlenecks,
    ),
    capacityRisks: stringArray(
      scalabilityValue.capacityRisks,
      input.deterministicScalabilityAssessment.capacityRisks,
    ),
    recommendedArchitecture: stringArray(
      scalabilityValue.recommendedArchitecture,
      input.deterministicScalabilityAssessment.recommendedArchitecture,
    ),
    validationPlan: stringArray(
      scalabilityValue.validationPlan,
      input.deterministicScalabilityAssessment.validationPlan,
    ),
  };

  const codeReviewValue = objectValue(input.parsed.codeReviewAssessment);
  const codeReviewAssessment: RepositoryCodeReviewAssessment = {
    overallScore: clampScore(
      codeReviewValue.overallScore,
      input.deterministicCodeReviewAssessment.overallScore,
    ),
    summary: stringValue(
      codeReviewValue.summary,
      input.deterministicCodeReviewAssessment.summary,
    ),
    maintainabilityScore: clampScore(
      codeReviewValue.maintainabilityScore,
      input.deterministicCodeReviewAssessment.maintainabilityScore,
    ),
    reliabilityScore: clampScore(
      codeReviewValue.reliabilityScore,
      input.deterministicCodeReviewAssessment.reliabilityScore,
    ),
    securityScore: clampScore(
      codeReviewValue.securityScore,
      input.deterministicCodeReviewAssessment.securityScore,
    ),
    performanceScore: clampScore(
      codeReviewValue.performanceScore,
      input.deterministicCodeReviewAssessment.performanceScore,
    ),
    strengths: stringArray(
      codeReviewValue.strengths,
      input.deterministicCodeReviewAssessment.strengths,
    ),
    findings: normalizeCodeFindings(
      codeReviewValue.findings,
      input.deterministicCodeReviewAssessment.findings,
    ),
  };

  const analysisQuality = normalizeAnalysisQuality(input.metadata, input.engine);
  analysisQuality.requirementCount = Math.max(
    analysisQuality.requirementCount,
    readinessAssessment.matchedExpectations.length,
  );

  applyEvidenceGate({
    architecture,
    readinessAssessment,
    scalabilityAssessment,
    codeReviewAssessment,
    quality: analysisQuality,
    validPaths: new Set(input.repositoryPaths),
    expectationsProvided: input.expectationsProvided,
  });

  return {
    architecture,
    readinessAssessment,
    scalabilityAssessment,
    codeReviewAssessment,
    analysisQuality,
    executiveReport: stringValue(
      input.parsed.executiveReport,
      input.deterministicExecutiveReport,
    ),
    technicalReport: stringValue(
      input.parsed.technicalReport,
      input.deterministicTechnicalReport,
    ),
    model: input.model || env.openaiRepositoryAnalysisModel,
    warnings: input.warnings || [],
  };
};

const runTypescriptSinglePass = async (input: {
  context: Record<string, unknown>;
  deterministicArchitecture: RepositoryArchitectureResult;
  deterministicReadinessAssessment: RepositoryReadinessAssessment;
  deterministicScalabilityAssessment: RepositoryScalabilityAssessment;
  deterministicCodeReviewAssessment: RepositoryCodeReviewAssessment;
  deterministicExecutiveReport: string;
  deterministicTechnicalReport: string;
  repositoryPaths: string[];
  expectationsProvided: boolean;
}): Promise<AiRepositoryAnalysisResult> => {
  const startedAt = Date.now();
  const response = await callOpenAiSinglePass(input.context);
  const content = response.choices?.[0]?.message?.content;

  if (!content) {
    throw new AppError(
      'OpenAI پاسخ قابل استفاده‌ای برای تحلیل مخزن برنگرداند.',
      502,
      'OPENAI_EMPTY_REPOSITORY_ANALYSIS_RESPONSE',
    );
  }

  return normalizeAiResult({
    parsed: extractJsonObject(content),
    model: response.model || env.openaiRepositoryAnalysisModel,
    engine: 'typescript_single_pass',
    metadata: {
      pipelineVersion: '1.1.0',
      passes: ['single_pass_review', 'server_evidence_gate'],
      moduleBatches: 0,
      criticVerdict: 'not_run',
      durationMs: Date.now() - startedAt,
    },
    deterministicArchitecture: input.deterministicArchitecture,
    deterministicReadinessAssessment: input.deterministicReadinessAssessment,
    deterministicScalabilityAssessment: input.deterministicScalabilityAssessment,
    deterministicCodeReviewAssessment: input.deterministicCodeReviewAssessment,
    deterministicExecutiveReport: input.deterministicExecutiveReport,
    deterministicTechnicalReport: input.deterministicTechnicalReport,
    repositoryPaths: input.repositoryPaths,
    expectationsProvided: input.expectationsProvided,
  });
};

export const enhanceRepositoryAnalysisWithAi = async (input: {
  inventory: RepositoryInventory;
  packages: RepositoryPackageRecord[];
  frameworks: string[];
  deterministicArchitecture: RepositoryArchitectureResult;
  expectations: RepositoryExpectationsSnapshot;
  expectationsContent: string;
  deterministicReadinessAssessment: RepositoryReadinessAssessment;
  deterministicScalabilityAssessment: RepositoryScalabilityAssessment;
  deterministicCodeReviewAssessment: RepositoryCodeReviewAssessment;
  deterministicExecutiveReport: string;
  deterministicTechnicalReport: string;
  files: RepositoryFileContent[];
  repositoryPaths: string[];
  onProgress?: (progress: PythonRepositoryAiProgress) => Promise<void> | void;
}): Promise<AiRepositoryAnalysisResult> => {
  const context = buildPromptContext(input);
  const usePython = env.repositoryAnalysisAiEngine === 'python_multi_pass';

  if (!usePython && !env.openaiApiKey) {
    throw new AppError(
      'OPENAI_API_KEY برای تحلیل معماری مخزن تنظیم نشده است.',
      503,
      'OPENAI_API_KEY_NOT_CONFIGURED',
      {
        source: 'configuration',
        stage: 'typescript_single_pass',
        model: env.openaiRepositoryAnalysisModel,
        retryable: false,
      },
    );
  }

  if (usePython) {
    try {
      const pythonResponse = await runPythonRepositoryAiPipeline({
        context,
        onProgress: input.onProgress,
      });

      return normalizeAiResult({
        parsed: pythonResponse.result,
        model: pythonResponse.model || env.openaiRepositoryAnalysisModel,
        engine: 'python_multi_pass',
        metadata: pythonResponse.metadata,
        deterministicArchitecture: input.deterministicArchitecture,
        deterministicReadinessAssessment: input.deterministicReadinessAssessment,
        deterministicScalabilityAssessment: input.deterministicScalabilityAssessment,
        deterministicCodeReviewAssessment: input.deterministicCodeReviewAssessment,
        deterministicExecutiveReport: input.deterministicExecutiveReport,
        deterministicTechnicalReport: input.deterministicTechnicalReport,
        repositoryPaths: input.repositoryPaths,
        expectationsProvided: input.expectations.provided,
      });
    } catch (error) {
      const errorDetails =
        error instanceof AppError &&
        error.details &&
        typeof error.details === 'object'
          ? (error.details as Record<string, unknown>)
          : {};
      const openAiError =
        errorDetails.openaiError && typeof errorDetails.openaiError === 'object'
          ? (errorDetails.openaiError as Record<string, unknown>)
          : {};
      const permanentOpenAiCodes = new Set([
        'insufficient_quota',
        'billing_hard_limit_reached',
        'invalid_api_key',
        'model_not_found',
      ]);
      const openAiCode =
        typeof openAiError.code === 'string' ? openAiError.code : '';
      const retryable = errorDetails.retryable;

      if (
        !env.repositoryAnalysisAiFallbackToTypescript ||
        permanentOpenAiCodes.has(openAiCode) ||
        retryable === false
      ) {
        throw error;
      }

      const failure = error instanceof AppError
        ? `${error.code}: ${error.message}`
        : error instanceof Error
          ? error.message
          : String(error);

      await input.onProgress?.({
        stage: 'ai_fallback_review',
        percent: 78,
        message: 'Python multi-pass pipeline failed; using the single-pass fallback.',
      });

      const fallback = await runTypescriptSinglePass({
        context,
        deterministicArchitecture: input.deterministicArchitecture,
        deterministicReadinessAssessment: input.deterministicReadinessAssessment,
        deterministicScalabilityAssessment: input.deterministicScalabilityAssessment,
        deterministicCodeReviewAssessment: input.deterministicCodeReviewAssessment,
        deterministicExecutiveReport: input.deterministicExecutiveReport,
        deterministicTechnicalReport: input.deterministicTechnicalReport,
        repositoryPaths: input.repositoryPaths,
        expectationsProvided: input.expectations.provided,
      });
      fallback.warnings.push(
        `خط لوله چندمرحله‌ای Python اجرا نشد و تحلیل تک‌مرحله‌ای جایگزین شد: ${failure}`,
      );
      return fallback;
    }
  }

  return runTypescriptSinglePass({
    context,
    deterministicArchitecture: input.deterministicArchitecture,
    deterministicReadinessAssessment: input.deterministicReadinessAssessment,
    deterministicScalabilityAssessment: input.deterministicScalabilityAssessment,
    deterministicCodeReviewAssessment: input.deterministicCodeReviewAssessment,
    deterministicExecutiveReport: input.deterministicExecutiveReport,
    deterministicTechnicalReport: input.deterministicTechnicalReport,
    repositoryPaths: input.repositoryPaths,
    expectationsProvided: input.expectations.provided,
  });
};
