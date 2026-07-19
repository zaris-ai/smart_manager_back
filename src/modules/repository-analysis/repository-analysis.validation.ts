import Joi from 'joi';
import { RepositoryAnalysisRunStatus } from './repository-analysis.model';

const objectIdSchema = Joi.string().hex().length(24).messages({
  'string.hex': 'شناسه واردشده معتبر نیست.',
  'string.length': 'شناسه باید ۲۴ کاراکتر باشد.',
});

export const createRepositoryConnectionSchema = {
  body: Joi.object({
    projectId: objectIdSchema.required().messages({
      'any.required': 'شناسه پروژه الزامی است.',
    }),
    name: Joi.string().trim().min(2).max(160).optional(),
    repositoryUrl: Joi.string().trim().max(1000).required().messages({
      'any.required': 'آدرس مخزن GitLab الزامی است.',
      'string.empty': 'آدرس مخزن GitLab الزامی است.',
    }),
    defaultBranch: Joi.string().trim().max(255).allow('').optional(),
  }),
};

export const listRepositoryConnectionsSchema = {
  query: Joi.object({
    projectId: objectIdSchema.optional(),
    enabled: Joi.boolean().optional(),
  }),
};

export const repositoryIdParamSchema = {
  params: Joi.object({
    repositoryId: objectIdSchema.required(),
  }),
};

export const updateRepositoryConnectionSchema = {
  params: Joi.object({
    repositoryId: objectIdSchema.required(),
  }),
  body: Joi.object({
    name: Joi.string().trim().min(2).max(160).optional(),
    repositoryUrl: Joi.string().trim().max(1000).optional(),
    defaultBranch: Joi.string().trim().max(255).allow('').optional(),
    enabled: Joi.boolean().optional(),
  })
    .min(1)
    .messages({
      'object.min': 'حداقل یک فیلد برای ویرایش باید ارسال شود.',
    }),
};

export const startRepositoryAnalysisSchema = {
  params: Joi.object({
    repositoryId: objectIdSchema.required(),
  }),
  body: Joi.object({
    ref: Joi.string().trim().max(255).allow('').optional(),
    useAi: Joi.boolean().default(true),
    expectationsText: Joi.string().trim().max(500000).allow('').optional(),
    concurrentUsers: Joi.number().integer().min(1).max(1_000_000_000).allow(null, '').optional(),
    requestsPerSecond: Joi.number().min(0.01).max(100_000_000).allow(null, '').optional(),
    targetLatencyMs: Joi.number().integer().min(1).max(3_600_000).allow(null, '').optional(),
    availabilityPercent: Joi.number().min(0).max(100).allow(null, '').optional(),
    dataVolume: Joi.string().trim().max(500).allow('').optional(),
    growthHorizonMonths: Joi.number().integer().min(1).max(1200).allow(null, '').optional(),
  }).default({ useAi: true }),
};

export const analysisRunIdParamSchema = {
  params: Joi.object({
    runId: objectIdSchema.required(),
  }),
};

export const listRepositoryAnalysisRunsSchema = {
  query: Joi.object({
    repositoryId: objectIdSchema.optional(),
    projectId: objectIdSchema.optional(),
    status: Joi.string()
      .valid(...Object.values(RepositoryAnalysisRunStatus))
      .optional(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
  }),
};
