import fs from 'fs';
import path from 'path';
import multer from 'multer';

const uploadRoot = path.resolve(process.cwd(), 'uploads', 'projects');

if (!fs.existsSync(uploadRoot)) {
  fs.mkdirSync(uploadRoot, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    callback(null, uploadRoot);
  },
  filename: (_req, file, callback) => {
    const safeOriginalName = Buffer.from(file.originalname, 'latin1')
      .toString('utf8')
      .replace(/[^\w.\-\u0600-\u06FF]+/g, '-');

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