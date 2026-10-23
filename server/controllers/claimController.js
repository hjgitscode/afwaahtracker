import * as claims from '../services/claimService.js';
import { ValidationError } from '../middleware/errors.js';

export function parseId(value) {
  const id = Number.parseInt(value, 10);
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError('The id must be a positive integer.');
  return id;
}

export const list = async (req, res) => res.json(await claims.listClaims(req.query));
export const search = async (req, res) => res.json(await claims.listClaims({ ...req.query, q: req.query.q || '' }));
export const get = async (req, res) => res.json(await claims.getClaim(parseId(req.params.id)));
export const sources = async (req, res) => res.json(await claims.getClaimSources(parseId(req.params.id)));
export const evidence = async (req, res) => res.json(await claims.getClaimEvidence(parseId(req.params.id)));
export const investigation = async (req, res) =>
  res.json(await claims.getClaimInvestigation(parseId(req.params.id), parseId(req.query.run)));
export const variants = async (req, res) => res.json(await claims.getClaimVariants(parseId(req.params.id)));
export const mutations = async (req, res) => res.json(await claims.getClaimMutations(parseId(req.params.id)));
export const claimLineage = async (req, res) => res.json(await claims.getClaimLineage(parseId(req.params.id)));
export const sourceLineage = async (req, res) => res.json(await claims.getSourceLineage(parseId(req.params.id)));
export const variation = async (req, res) => res.json(await claims.getClaimVariation(parseId(req.params.id)));
export const noveltyDiagnostics = async (req, res) => res.json(await claims.getNoveltyDiagnostics(parseId(req.params.id)));
export const create = async (req, res) => res.status(201).json(await claims.createClaim(req.body));
export const update = async (req, res) => res.json(await claims.updateClaim(parseId(req.params.id), req.body));
export const remove = async (req, res) => res.json(await claims.deleteClaim(parseId(req.params.id)));
export const addVariant = async (req, res) => res.status(201).json(await claims.addVariant(parseId(req.params.id), req.body));
