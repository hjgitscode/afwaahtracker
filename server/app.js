import express from 'express';
import cors from 'cors';
import config from './config/index.js';
import routes from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { requestLogger } from './middleware/logger.js';
import { apiLimiter } from './middleware/security.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('json spaces', 0);
  // Behind Nginx: take the visitor address from X-Forwarded-For (one hop)
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  app.use(requestLogger);

  // Cross-origin access only for configured origins (CORS_ORIGINS). Same-origin
  // requests through the bundled Nginx do not need CORS at all.
  if (config.corsOrigins.length) {
    app.use(
      '/api',
      cors({
        origin(origin, cb) {
          if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
          return cb(null, false);
        },
      })
    );
  }
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });
  app.use(express.json({ limit: '20kb' }));

  app.get('/', (req, res) => res.json({ name: 'AfwaahTracker API', health: '/api/health' }));
  app.use('/api', apiLimiter, routes);
  app.use('/api', notFoundHandler);
  app.use(errorHandler);
  return app;
}
