import type { Express } from 'express';
import { createApiApp } from '../server/api.js';

let appPromise: Promise<Express> | null = null;

function getApp(): Promise<Express> {
  if (!appPromise) appPromise = createApiApp();
  return appPromise;
}

export default async function handler(req: unknown, res: unknown) {
  const app = await getApp();
  return (app as unknown as (q: unknown, s: unknown) => void)(req, res);
}
