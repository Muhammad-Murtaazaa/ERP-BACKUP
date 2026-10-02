import type { Request, Response } from 'express';
import { createApp } from '../apps/api/dist/app.js';

let appInstance: any = null;

function getApp() {
  if (!appInstance) {
    appInstance = createApp();
  }
  return appInstance;
}

export default function handler(req: Request, res: Response) {
  try {
    const app = getApp();
    return app(req, res);
  } catch (err: any) {
    console.error('[Vercel Serverless Function Crash]:', err);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: {
          code: 'SERVERLESS_FUNCTION_ERROR',
          message: err?.message || String(err),
          stack: err?.stack,
        },
      });
    }
  }
}
