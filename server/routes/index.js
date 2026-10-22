import { Router } from 'express';
import { asyncHandler as h } from '../middleware/errors.js';
import * as claims from '../controllers/claimController.js';
import * as sources from '../controllers/sourceController.js';
import * as meta from '../controllers/metaController.js';
import * as ingestion from '../controllers/ingestionController.js';
import * as web from '../controllers/webSearchController.js';
import { investigateLimiter, investigationQuota, requireAdmin } from '../middleware/security.js';

const router = Router();

router.get('/health', h(meta.health));
router.get('/overview', h(meta.dashboard));
router.get('/dashboard', h(meta.dashboard));
router.get('/search', h(claims.search));

router.get('/claims', h(claims.list));
router.post('/claims', requireAdmin, h(claims.create));
router.get('/claims/:id', h(claims.get));
router.put('/claims/:id', requireAdmin, h(claims.update));
router.delete('/claims/:id', requireAdmin, h(claims.remove));
router.get('/claims/:id/sources', h(claims.sources));
router.get('/claims/:id/variants', h(claims.variants));
router.get('/claims/:id/evidence', h(claims.evidence));
router.get('/claims/:id/investigation', h(claims.investigation));
router.post('/claims/:id/variants', requireAdmin, h(claims.addVariant));
router.get('/claims/:id/mutations', h(claims.mutations));
router.get('/claims/:id/claim-lineage', h(claims.claimLineage));
router.get('/claims/:id/source-lineage', h(claims.sourceLineage));
router.get('/claims/:id/novelty-diagnostics', h(claims.noveltyDiagnostics));

router.get('/sources', h(sources.list));
router.post('/sources', requireAdmin, h(sources.create));
router.get('/sources/:id', h(sources.get));
router.put('/sources/:id', requireAdmin, h(sources.update));

router.get('/platforms', h(meta.platforms));
router.get('/categories', h(meta.categories));
router.get('/entities', h(meta.entities));

router.get('/ingestion/status', h(ingestion.status));
router.post('/ingestion/refresh', requireAdmin, h(ingestion.refresh));

// Live web investigation (web search provider key never leaves the server)
router.post('/investigate-web', investigateLimiter, investigationQuota, h(web.investigate));
router.get('/web-search', h(web.list));
router.get('/web-search/:runId/status', h(web.status));
router.get('/web-search/:runId/results', h(web.results));
router.get('/web-search/:runId/novelty-diagnostics', h(web.diagnostics));

router.get('/lab', h(meta.lab));
router.get('/lab/queries/:key', h(meta.labQuery));

export default router;
