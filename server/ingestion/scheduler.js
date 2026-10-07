/**
 * Background ingestion scheduler (node-cron).
 * Every INGESTION_INTERVAL_MINUTES the scheduler runs all enabled sources
 * whose own fetch_interval_minutes has elapsed. Only one run at a time.
 */
import cron from 'node-cron';
import config from '../config/index.js';
import { runIngestion } from './pipeline.js';

const state = {
  running: false,
  current: null,
  trigger: null,
  startedAt: null,
  lastCompletedAt: null,
  lastResults: [],
  lastError: null,
  task: null,
  cronExpression: null,
  nextRunAt: null,
};

export function cronFor(minutes) {
  if (minutes < 60 && 60 % minutes === 0) return `*/${minutes} * * * *`;
  if (minutes % 60 === 0 && minutes / 60 <= 23) return `0 */${minutes / 60} * * *`;
  return null;
}

/** Starts an ingestion run, or returns the run already in progress. */
export function triggerIngestion({ force = false, trigger = 'manual' } = {}) {
  if (state.current) return state.current;
  state.running = true;
  state.trigger = trigger;
  state.startedAt = new Date();
  state.lastError = null;
  state.current = runIngestion({ force })
    .then((results) => {
      state.lastResults = results;
      return results;
    })
    .catch((err) => {
      state.lastError = err.code === 'DB_UNAVAILABLE' ? err.message : err.message || String(err);
      console.error('[ingestion] run failed:', state.lastError);
      return [];
    })
    .finally(() => {
      state.running = false;
      state.current = null;
      state.lastCompletedAt = new Date();
    });
  return state.current;
}

export function schedulerState() {
  return {
    enabled: config.ingestion.enabled,
    running: state.running,
    trigger: state.trigger,
    startedAt: state.startedAt,
    lastCompletedAt: state.lastCompletedAt,
    lastError: state.lastError,
    intervalMinutes: config.ingestion.intervalMinutes,
    cronExpression: state.cronExpression,
    nextRunAt: state.nextRunAt,
  };
}

export function startScheduler() {
  if (!config.ingestion.enabled) {
    console.log('[scheduler] automated ingestion disabled (INGESTION_ENABLED=false)');
    return;
  }
  const minutes = config.ingestion.intervalMinutes;
  const expr = cronFor(minutes);
  const tick = () => {
    state.nextRunAt = new Date(Date.now() + minutes * 60000);
    triggerIngestion({ force: false, trigger: 'scheduled' });
  };

  if (expr) {
    state.cronExpression = expr;
    state.task = cron.schedule(expr, tick, { name: 'afwaah-ingestion', noOverlap: true });
  } else {
    state.cronExpression = `every ${minutes} minutes`;
    state.task = setInterval(tick, minutes * 60000);
    state.task.unref?.();
  }
  state.nextRunAt = new Date(Date.now() + minutes * 60000);
  console.log(`[scheduler] ingestion scheduled (${state.cronExpression})`);

  if (config.ingestion.runOnStart) {
    setTimeout(() => triggerIngestion({ force: false, trigger: 'startup' }), 8000).unref?.();
  }
}

export function stopScheduler() {
  if (!state.task) return;
  if (typeof state.task.stop === 'function') state.task.stop();
  else clearInterval(state.task);
  state.task = null;
}
