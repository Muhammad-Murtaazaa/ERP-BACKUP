// Vercel API entry point (esbuild source - lives outside api/ to avoid route conflicts)
// Built by: npm run build:vercel-api → api/index.js
import { createApp } from '../apps/api/dist/app.js';

const app = createApp();

export default app;
