import * as web from '../services/webSearchService.js';
import { parseId } from './claimController.js';

export const investigate = async (req, res) => {
  const out = await web.startInvestigation(req.body || {});
  res.status(out.status === 'RUNNING' ? 202 : 200).json(out);
};
export const status = async (req, res) => res.json(await web.getRunStatus(parseId(req.params.runId)));
export const results = async (req, res) => res.json(await web.getRunResults(parseId(req.params.runId)));
export const list = async (req, res) => res.json(await web.listRuns(req.query.limit));
export const diagnostics = async (req, res) => res.json(await web.getRunDiagnostics(parseId(req.params.runId)));
