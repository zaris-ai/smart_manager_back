import path from 'path';
import multer from 'multer';
import { env } from '@/config/env';
import { AppError } from '@/shared/http/app-error';

const ALLOWED_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.json',
  '.yaml',
  '.yml',
  '.csv',
  '.xml',
  '.html',
  '.htm',
  '.log',
]);

export const repositoryExpectationsUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: env.repositoryAnalysisMaxExpectationsBytes,
  },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname || '').toLowerCase();

    if (!ALLOWED_EXTENSIONS.has(extension)) {
      callback(
        new AppError(
          'فرمت فایل انتظارات پشتیبانی نمی‌شود. از TXT، Markdown، JSON، YAML، CSV، XML یا HTML استفاده کنید.',
          400,
          'UNSUPPORTED_EXPECTATIONS_FILE_TYPE',
        ),
      );
      return;
    }

    callback(null, true);
  },
});
