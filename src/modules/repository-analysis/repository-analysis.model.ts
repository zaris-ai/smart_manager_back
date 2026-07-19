import mongoose, { Document, Model, Schema, Types } from 'mongoose';

export enum RepositoryAnalysisProvider {
  GITLAB = 'gitlab',
}

export enum RepositoryAnalysisRunStatus {
  QUEUED = 'queued',
  SCANNING = 'scanning',
  ANALYZING = 'analyzing',
  COMPLETED = 'completed',
  PARTIALLY_COMPLETED = 'partially_completed',
  FAILED = 'failed',
}

export interface RepositoryConnectionDocument extends Document {
  projectId: Types.ObjectId;
  name: string;
  provider: RepositoryAnalysisProvider;
  repositoryUrl: string;
  gitlabBaseUrl: string;
  gitlabProjectPath: string;
  defaultBranch: string;
  enabled: boolean;
  createdBy?: Types.ObjectId | null;
  updatedBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RepositoryPackageRecord {
  name: string;
  version: string;
  ecosystem: string;
  category: 'runtime' | 'development' | 'peer' | 'optional' | 'unknown';
  manifestPath: string;
}

export interface RepositoryLanguageRecord {
  name: string;
  fileCount: number;
}

export interface RepositoryArchitectureResult {
  classification: string;
  confidence: number;
  summary: string;
  layers: string[];
  modules: string[];
  strengths: string[];
  concerns: string[];
  evidence: string[];
}

export interface RepositoryInventory {
  totalEntries: number;
  totalFiles: number;
  totalDirectories: number;
  truncated: boolean;
  topLevelDirectories: string[];
  topLevelFiles: string[];
  manifestFiles: string[];
  selectedSourceFiles: string[];
  languages: RepositoryLanguageRecord[];
}


export type RepositoryExpectationSource =
  | 'none'
  | 'text'
  | 'file'
  | 'file_and_text';

export interface RepositoryWorkloadTargets {
  concurrentUsers?: number | null;
  requestsPerSecond?: number | null;
  targetLatencyMs?: number | null;
  availabilityPercent?: number | null;
  dataVolume?: string;
  growthHorizonMonths?: number | null;
}

export interface RepositoryExpectationsSnapshot {
  source: RepositoryExpectationSource;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  contentLength: number;
  provided: boolean;
  workloadTargets: RepositoryWorkloadTargets;
}

export type RepositoryRequirementStatus =
  | 'met'
  | 'partial'
  | 'not_met'
  | 'unknown';

export interface RepositoryRequirementMatch {
  id?: string;
  category?: string;
  priority?: 'critical' | 'high' | 'medium' | 'low';
  hardGate?: boolean;
  expectation: string;
  status: RepositoryRequirementStatus;
  evidence: string[];
  explanation: string;
}

export interface RepositoryRecommendation {
  priority: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  suggestedSolution: string;
  evidence: string[];
}

export interface RepositoryReadinessAssessment {
  verdict:
    | 'ready'
    | 'conditionally_ready'
    | 'not_ready'
    | 'insufficient_evidence';
  score: number;
  confidence: number;
  summary: string;
  matchedExpectations: RepositoryRequirementMatch[];
  blockers: string[];
  gaps: string[];
  recommendations: RepositoryRecommendation[];
}

export interface RepositoryScalabilityAssessment {
  verdict:
    | 'likely_sufficient'
    | 'conditionally_sufficient'
    | 'unlikely_sufficient'
    | 'insufficient_evidence';
  confidence: number;
  summary: string;
  workloadAssumptions: string[];
  strengths: string[];
  bottlenecks: string[];
  capacityRisks: string[];
  recommendedArchitecture: string[];
  validationPlan: string[];
}

export interface RepositoryCodeReviewFinding {
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: string;
  title: string;
  description: string;
  evidencePaths: string[];
  recommendation: string;
}

export interface RepositoryCodeReviewAssessment {
  overallScore: number;
  summary: string;
  maintainabilityScore: number;
  reliabilityScore: number;
  securityScore: number;
  performanceScore: number;
  strengths: string[];
  findings: RepositoryCodeReviewFinding[];
}


export interface RepositoryAnalysisQuality {
  engine: 'deterministic' | 'typescript_single_pass' | 'python_multi_pass';
  pipelineVersion: string;
  passes: string[];
  moduleBatches: number;
  requirementCount: number;
  evidenceCoveragePercent: number;
  referencedFiles: string[];
  criticVerdict: 'approved' | 'approved_with_caveats' | 'rejected' | 'not_run';
  unsupportedClaimsRemoved: number;
  missingEvidenceItems: string[];
  durationMs: number;
  modelCalls: number;
}


export interface RepositoryAiErrorDetails {
  source: string;
  stage: string;
  endpoint?: string;
  model?: string;
  httpStatus?: number;
  openaiError?: {
    message?: string | null;
    type?: string | null;
    code?: string | null;
    param?: unknown;
  } | null;
  requestId?: string | null;
  clientRequestId?: string | null;
  organization?: string | null;
  processingMs?: string | null;
  headers?: Record<string, string>;
  rawResponseBody?: string;
  rawModelContent?: string;
  attempt?: number;
  maxAttempts?: number;
  retryable?: boolean;
  timeoutSeconds?: number;
  exceptionType?: string;
  exceptionMessage?: string;
  childProcess?: {
    exitCode?: number | null;
    signal?: string | null;
    stderrTail?: string;
  };
}


export interface RepositoryAnalysisRunDocument extends Document {
  repositoryId: Types.ObjectId;
  projectId: Types.ObjectId;
  requestedRef: string;
  resolvedRef: string;
  commitSha: string;
  status: RepositoryAnalysisRunStatus;
  currentStage: string;
  progressPercent: number;
  inventory?: RepositoryInventory | null;
  packages: RepositoryPackageRecord[];
  frameworks: string[];
  architecture?: RepositoryArchitectureResult | null;
  expectations?: RepositoryExpectationsSnapshot | null;
  expectationsContent: string;
  readinessAssessment?: RepositoryReadinessAssessment | null;
  scalabilityAssessment?: RepositoryScalabilityAssessment | null;
  codeReviewAssessment?: RepositoryCodeReviewAssessment | null;
  analysisQuality?: RepositoryAnalysisQuality | null;
  executiveReport: string;
  technicalReport: string;
  aiEnabled: boolean;
  aiUsed: boolean;
  aiModel: string;
  aiError?: RepositoryAiErrorDetails | null;
  warnings: string[];
  errorCode: string;
  errorMessage: string;
  requestedBy?: Types.ObjectId | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const repositoryConnectionSchema = new Schema<RepositoryConnectionDocument>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
    },
    provider: {
      type: String,
      enum: Object.values(RepositoryAnalysisProvider),
      default: RepositoryAnalysisProvider.GITLAB,
      required: true,
      index: true,
    },
    repositoryUrl: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },
    gitlabBaseUrl: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    gitlabProjectPath: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
      index: true,
    },
    defaultBranch: {
      type: String,
      default: '',
      trim: true,
      maxlength: 255,
    },
    enabled: {
      type: Boolean,
      default: true,
      index: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform: (_doc: unknown, ret: Record<string, any>) => {
        ret.id = ret._id?.toString();
        delete ret._id;
        return ret;
      },
    },
  },
);

repositoryConnectionSchema.index(
  { projectId: 1, gitlabBaseUrl: 1, gitlabProjectPath: 1 },
  { unique: true },
);

const repositoryAnalysisRunSchema = new Schema<RepositoryAnalysisRunDocument>(
  {
    repositoryId: {
      type: Schema.Types.ObjectId,
      ref: 'RepositoryConnection',
      required: true,
      index: true,
    },
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    requestedRef: {
      type: String,
      default: '',
      trim: true,
      maxlength: 255,
    },
    resolvedRef: {
      type: String,
      default: '',
      trim: true,
      maxlength: 255,
    },
    commitSha: {
      type: String,
      default: '',
      trim: true,
      maxlength: 100,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(RepositoryAnalysisRunStatus),
      default: RepositoryAnalysisRunStatus.QUEUED,
      required: true,
      index: true,
    },
    currentStage: {
      type: String,
      default: 'queued',
      trim: true,
      maxlength: 100,
    },
    progressPercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    inventory: {
      type: Schema.Types.Mixed,
      default: null,
    },
    packages: {
      type: [Schema.Types.Mixed],
      default: [],
    },
    frameworks: {
      type: [String],
      default: [],
    },
    architecture: {
      type: Schema.Types.Mixed,
      default: null,
    },
    expectations: {
      type: Schema.Types.Mixed,
      default: null,
    },
    expectationsContent: {
      type: String,
      default: '',
      select: false,
    },
    readinessAssessment: {
      type: Schema.Types.Mixed,
      default: null,
    },
    scalabilityAssessment: {
      type: Schema.Types.Mixed,
      default: null,
    },
    codeReviewAssessment: {
      type: Schema.Types.Mixed,
      default: null,
    },
    analysisQuality: {
      type: Schema.Types.Mixed,
      default: null,
    },
    executiveReport: {
      type: String,
      default: '',
    },
    technicalReport: {
      type: String,
      default: '',
    },
    aiEnabled: {
      type: Boolean,
      default: true,
    },
    aiUsed: {
      type: Boolean,
      default: false,
    },
    aiModel: {
      type: String,
      default: '',
      trim: true,
    },
    aiError: {
      type: Schema.Types.Mixed,
      default: null,
    },
    warnings: {
      type: [String],
      default: [],
    },
    errorCode: {
      type: String,
      default: '',
      trim: true,
    },
    errorMessage: {
      type: String,
      default: '',
    },
    requestedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    startedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform: (_doc: unknown, ret: Record<string, any>) => {
        ret.id = ret._id?.toString();
        delete ret._id;
        delete ret.expectationsContent;
        return ret;
      },
    },
  },
);

repositoryAnalysisRunSchema.index({ repositoryId: 1, createdAt: -1 });
repositoryAnalysisRunSchema.index({ projectId: 1, createdAt: -1 });
repositoryAnalysisRunSchema.index({ status: 1, createdAt: -1 });

export const RepositoryConnection: Model<RepositoryConnectionDocument> =
  (mongoose.models.RepositoryConnection as Model<RepositoryConnectionDocument>) ||
  mongoose.model<RepositoryConnectionDocument>(
    'RepositoryConnection',
    repositoryConnectionSchema,
  );

export const RepositoryAnalysisRun: Model<RepositoryAnalysisRunDocument> =
  (mongoose.models.RepositoryAnalysisRun as Model<RepositoryAnalysisRunDocument>) ||
  mongoose.model<RepositoryAnalysisRunDocument>(
    'RepositoryAnalysisRun',
    repositoryAnalysisRunSchema,
  );
