import * as sources from '../services/sourceService.js';
import { parseId } from './claimController.js';

export const list = async (req, res) => res.json(await sources.listSources(req.query));
export const get = async (req, res) => res.json(await sources.getSource(parseId(req.params.id)));
export const create = async (req, res) => res.status(201).json(await sources.createSource(req.body));
export const update = async (req, res) => res.json(await sources.updateSource(parseId(req.params.id), req.body));
