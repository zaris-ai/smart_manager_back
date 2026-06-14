import { isMongoHealthy } from '../../database';

interface HealthStatus {
  service: string;
  status: 'ok' | 'degraded';
  timestamp: string;
  database: {
    type: 'mongodb';
    connected: boolean;
  };
}

export async function getHealthStatus(): Promise<HealthStatus> {
  const mongoConnected = await isMongoHealthy();

  return {
    service: 'avid-backend-service',
    status: mongoConnected ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    database: {
      type: 'mongodb',
      connected: mongoConnected
    }
  };
}
