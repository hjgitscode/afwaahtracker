import express from 'express';
import cors from 'cors';
import config from './config/index.js';
import routes from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('json spaces', 0);

  app.use(
    cors({
      origin(origin, cb) {
        // Allow same-origin / tools without an Origin header, and configured dev origins
        if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
        return cb(null, false);
      },
    })
  );
  app.use(express.json({ limit: '200kb' }));

  app.get('/', (req, res) => res.json({ name: 'AfwaahTracker API', docs: '/api/health' }));
  app.use('/api', routes);
  app.use('/api', notFoundHandler);
  app.use(errorHandler);
  return app;
}
