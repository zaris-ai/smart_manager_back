import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { registerModules } from '@/modules';
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

  app.use('/api/v1', registerModules());

  app.use(notFoundMiddleware);
  app.use(errorHandler);

  return app;
}
