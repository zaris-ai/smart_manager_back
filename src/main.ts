import { createApp } from '@/app';
import { createDefaultAdmin } from '@/modules/admin/admin-default.service';
import { startDailyWorkAlertScheduler } from '@/modules/alerts/daily-work-alert.service';
import { env } from '@/config/env';
import { connectMongo } from '@/database/mongodb';

async function main(): Promise<void> {
  await connectMongo();
  await createDefaultAdmin();

  startDailyWorkAlertScheduler();

  const app = createApp();

  app.listen(env.port, () => {
    console.log(`Avid backend service is running on port ${env.port}`);
  });
}

main().catch((error) => {
  console.error('Failed to start Avid backend service:', error);
  process.exit(1);
});