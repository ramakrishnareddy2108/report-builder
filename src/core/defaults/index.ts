// Shipped defaults, validated on load like any persisted JSON.

import { RulesFileSchema, type RulesFile } from '../schemas';
import rulesDefaultJson from './rules.default.json';

/** The default rules.json seeded into a new workspace. Returns a fresh copy each call. */
export function loadDefaultRules(): RulesFile {
  return RulesFileSchema.parse(structuredClone(rulesDefaultJson));
}
