import mongoose from 'mongoose';
import { env } from '@/config/env';

export async function connectMongo(): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }

  mongoose.set('strictQuery', true);

  await mongoose.connect(env.mongoUri, {
    dbName: env.mongoDbName,
    maxPoolSize: 10,
    minPoolSize: 1,
    serverSelectionTimeoutMS: 5000,
  });

  console.log(`MongoDB connected with Mongoose: ${env.mongoDbName}`);

  return mongoose;
}

export function isMongoHealthy(): boolean {
  return mongoose.connection.readyState === 1;
}

export async function closeMongo(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}
