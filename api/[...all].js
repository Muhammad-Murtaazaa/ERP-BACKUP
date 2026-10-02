import app from './index.js';

// Vercel passes req/res directly to the default export.
// The Express app already has all /api/* routes registered,
// so we just forward the raw request to it.
export default app;
