import { Request, Response } from 'express';
import { getHealthStatus } from './health.service';

export async function healthCheck(_req: Request, res: Response): Promise<void> {
  const health = await getHealthStatus();
  res.status(health.status === 'ok' ? 200 : 503).json(health);
}
