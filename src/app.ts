import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { registerModules } from '@/modules';
import { UPLOADS_ROOT } from '@/modules/projects/project-upload.middleware';
import { errorHandler } from '@/shared/http/error-handler';
import { notFoundMiddleware } from '@/shared/http/not-found.middleware';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('dev'));
  }

  const uploadsStaticMiddleware = express.static(UPLOADS_ROOT, {
    maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
    setHeaders: (res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  });

  app.use('/uploads', uploadsStaticMiddleware);
  app.use('/api/v1/uploads', uploadsStaticMiddleware);

  app.use('/api/v1', registerModules());

  app.use(notFoundMiddleware);
  app.use(errorHandler);

  return app;
}