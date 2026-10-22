import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { env } from './config/env.js';
import apiRouter from './routes/index.js';
import { identifyUser } from './auth/auth.middleware.js';
import { apiRateLimiter } from './middleware/rate-limit.middleware.js';
import { errorHandler } from './middleware/error.middleware.js';

export const app = express();

// Security & Headers
app.use(
  helmet({
    contentSecurityPolicy: false, // Allows SSE and local previews
  })
);

app.use(
  cors({
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN,
    credentials: true,
  })
);

// Body Parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Auth & Identification
app.use(identifyUser);

// Global Rate Limiting
if (env.NODE_ENV !== 'test') {
  app.use('/api', apiRateLimiter);
}

// Routes
app.use('/api', apiRouter);

// Serve built React frontend
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const candidates = [
  path.resolve(__dirname, '../../web/dist'),      // running from apps/api/src
  path.resolve(__dirname, '../../../web/dist'),   // running from apps/api/dist/src
  path.resolve(process.cwd(), 'apps/web/dist'),   // started from repo root
  path.resolve(process.cwd(), '../web/dist'),     // started from apps/api
  path.resolve('/app/apps/web/dist'),             // Docker path
];
const webDist = candidates.find((p) => fs.existsSync(path.join(p, 'index.html')));

if (webDist) {
  console.log(`Serving frontend from: ${webDist}`);
  app.use(express.static(webDist));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    res.sendFile(path.join(webDist, 'index.html'));
  });
} else {
  console.warn('Frontend build NOT found. Tried:', candidates);
}

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    type: 'https://api.web2apk.dev/errors/not-found',
    title: 'Resource Not Found',
    status: 404,
    detail: `Route "${req.method} ${req.originalUrl}" does not exist.`,
    code: 'ROUTE_NOT_FOUND',
  });
});

// Centralized Error Handler
app.use(errorHandler);

export default app;