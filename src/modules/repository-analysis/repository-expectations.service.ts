import crypto from 'crypto';
import { env } from '@/config/env';
import { AppError } from '@/shared/http/app-error';
import type {
  RepositoryExpectationSource,
  RepositoryExpectationsSnapshot,
  RepositoryWorkloadTargets,
} from './repository-analysis.model';

const normalizeOriginalName = (originalName: string): string => {
  const rawName = originalName || '';
  const decodedName = Buffer.from(rawName, 'latin1').toString('utf8');
  const rawHasUnicode = /[^\x00-\x7F]/.test(rawName);
  const candidate = rawHasUnicode || decodedName.includes('�') ? rawName : decodedName;

  return candidate
    .trim()
    .replace(/[\\/]/g, '-')
    .replace(/[^\w.\-\u0600-\u06FF ]+/g, '-')
    .slice(0, 220) || 'expectations.txt';
};

const normalizeText = (value: string): string =>
  value
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .trim();

const assertReadableText = (buffer: Buffer): string => {
  if (buffer.includes(0)) {
    throw new AppError(
      'فایل انتظارات باید متنی باشد و محتوای باینری قابل پردازش نیست.',
      400,
      'EXPECTATIONS_FILE_NOT_TEXT',
    );
  }

  const decoded = normalizeText(buffer.toString('utf8'));
  const replacementCount = (decoded.match(/�/g) || []).length;

  if (decoded && replacementCount / decoded.length > 0.01) {
    throw new AppError(
      'کدگذاری فایل انتظارات قابل تشخیص نیست. فایل را با UTF-8 ذخیره کنید.',
      400,
      'EXPECTATIONS_FILE_ENCODING_INVALID',
    );
  }

  return decoded;
};

const normalizeOptionalNumber = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const buildRepositoryExpectationsInput = (input: {
  file?: Express.Multer.File;
  expectationsText?: string;
  concurrentUsers?: unknown;
  requestsPerSecond?: unknown;
  targetLatencyMs?: unknown;
  availabilityPercent?: unknown;
  dataVolume?: string;
  growthHorizonMonths?: unknown;
}): {
  metadata: RepositoryExpectationsSnapshot;
  content: string;
} => {
  const fileContent = input.file ? assertReadableText(input.file.buffer) : '';
  const manualText = normalizeText(String(input.expectationsText || ''));
  const source: RepositoryExpectationSource = input.file
    ? manualText
      ? 'file_and_text'
      : 'file'
    : manualText
      ? 'text'
      : 'none';

  const combinedContent = [
    fileContent ? `## محتوای فایل انتظارات\n${fileContent}` : '',
    manualText ? `## توضیحات تکمیلی ثبت‌شده توسط کاربر\n${manualText}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
    .trim();

  const contentBytes = Buffer.byteLength(combinedContent, 'utf8');

  if (contentBytes > env.repositoryAnalysisMaxExpectationsBytes) {
    throw new AppError(
      'حجم متن انتظارات از سقف مجاز بیشتر است.',
      413,
      'EXPECTATIONS_CONTENT_TOO_LARGE',
    );
  }

  const workloadTargets: RepositoryWorkloadTargets = {
    concurrentUsers: normalizeOptionalNumber(input.concurrentUsers),
    requestsPerSecond: normalizeOptionalNumber(input.requestsPerSecond),
    targetLatencyMs: normalizeOptionalNumber(input.targetLatencyMs),
    availabilityPercent: normalizeOptionalNumber(input.availabilityPercent),
    dataVolume: String(input.dataVolume || '').trim().slice(0, 500),
    growthHorizonMonths: normalizeOptionalNumber(input.growthHorizonMonths),
  };

  const workloadText = [
    workloadTargets.concurrentUsers
      ? `کاربران همزمان هدف: ${workloadTargets.concurrentUsers}`
      : '',
    workloadTargets.requestsPerSecond
      ? `نرخ درخواست هدف: ${workloadTargets.requestsPerSecond} درخواست در ثانیه`
      : '',
    workloadTargets.targetLatencyMs
      ? `تاخیر پاسخ هدف: ${workloadTargets.targetLatencyMs} میلی‌ثانیه`
      : '',
    workloadTargets.availabilityPercent
      ? `دسترس‌پذیری هدف: ${workloadTargets.availabilityPercent} درصد`
      : '',
    workloadTargets.dataVolume
      ? `حجم داده هدف: ${workloadTargets.dataVolume}`
      : '',
    workloadTargets.growthHorizonMonths
      ? `افق رشد: ${workloadTargets.growthHorizonMonths} ماه`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const finalContent = [combinedContent, workloadText ? `## اهداف بار و ظرفیت\n${workloadText}` : '']
    .filter(Boolean)
    .join('\n\n')
    .trim();

  const fileName = input.file ? normalizeOriginalName(input.file.originalname) : '';

  return {
    metadata: {
      source,
      fileName,
      mimeType: input.file?.mimetype || '',
      sizeBytes: input.file?.size || 0,
      sha256: input.file
        ? crypto.createHash('sha256').update(input.file.buffer).digest('hex')
        : '',
      contentLength: finalContent.length,
      provided: Boolean(finalContent),
      workloadTargets,
    },
    content: finalContent,
  };
};
