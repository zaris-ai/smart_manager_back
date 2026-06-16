import fs from 'fs';
import path from 'path';
import multer from 'multer';

export const UPLOADS_ROOT = path.resolve(process.cwd(), 'uploads');
export const PROJECT_UPLOADS_ROOT = path.join(UPLOADS_ROOT, 'projects');

if (!fs.existsSync(PROJECT_UPLOADS_ROOT)) {
  fs.mkdirSync(PROJECT_UPLOADS_ROOT, { recursive: true });
}

const normalizeOriginalName = (originalName: string): string => {
  const decodedName = Buffer.from(originalName, 'latin1').toString('utf8');
  const candidateName = decodedName.includes('�') ? originalName : decodedName;

  const safeName = candidateName
    .trim()
    .replace(/[\/\\]/g, '-')
    .replace(/[^\w.\-\u0600-\u06FF]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  return safeName || 'file';
};

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    callback(null, PROJECT_UPLOADS_ROOT);
  },
  filename: (_req, file, callback) => {
    const safeOriginalName = normalizeOriginalName(file.originalname);

    const uniqueName = `${Date.now()}-${Math.round(
      Math.random() * 1_000_000_000,
    )}-${safeOriginalName}`;

    callback(null, uniqueName);
  },
});

export const projectUpload = multer({
  storage,
  limits: {
    fileSize: 1024 * 1024 * 500,
    files: 20,
  },
});
