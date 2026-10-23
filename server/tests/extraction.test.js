/**
 * Deterministic extraction tests (no database, no network):
 *   npm test            (from the server folder or the root)
 * The query parser and the proposition extractor share one action registry
 * (claims/lexicon.js); these tests pin both to the same vocabulary.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractProposition, quantityOf } from '../claims/propositions.js';
import { parseQuery } from '../claims/hypothesis.js';

const ctx = { knownOrg: (t) => (/^(VIT|Vellore Institute of Technology)$/i.test(String(t).trim()) ? { name: 'VIT' } : null), contextOrg: null };
const prop = (s) => extractProposition(s, ctx);
const shape = (p) => p && [p.subject, p.predicate, p.object, p.qualifier || null];

test('1. "The US imposed 50% tariffs on Indian goods." extracts a claim', () => {
  assert.deepEqual(shape(prop('The US imposed 50% tariffs on Indian goods.')), ['United States', 'IMPOSED', '50% tariffs', 'India']);
});

test('2. "The United States raised tariffs on Indian imports to 50 per cent." extracts a claim', () => {
  assert.deepEqual(shape(prop('The United States raised tariffs on Indian imports to 50 per cent.')), ['United States', 'RAISED', 'tariffs', 'India']);
  assert.equal(quantityOf('The United States raised tariffs on Indian imports to 50 per cent.'), '50 per cent');
});

test('3. "Washington slapped tariffs on India." maps the explicit phrase rule to IMPOSED', () => {
  assert.deepEqual(shape(prop('Washington slapped tariffs on India.')), ['United States', 'IMPOSED', 'tariffs', 'India']);
  assert.equal(prop('He slapped the reporter.'), null); // "slapped" without "on <target>" is not IMPOSED
});

test('4. "US imposed tariffs on India" is a claim-like query, not TOPIC_SEARCH', () => {
  const h = parseQuery('US imposed tariffs on India');
  assert.equal(h.queryType, 'CLAIM_QUERY');
  assert.deepEqual([h.subject, h.predicate, h.object, h.qualifier], ['United States', 'IMPOSED', 'tariffs', 'India']);
  assert.equal(parseQuery('Did the US impose tariffs on India?').predicate, 'IMPOSED');
});

test('5. "US Secretary of State Marco Rubio visited India." still works', () => {
  assert.deepEqual(shape(prop('US Secretary of State Marco Rubio visited India.')).slice(1, 3), ['VISITED', 'India']);
  assert.equal(parseQuery('Marco Rubio visited India').predicate, 'VISITED');
});

test('6. "usa tariffs india" stays a TOPIC_SEARCH', () => {
  assert.equal(parseQuery('usa tariffs india').queryType, 'TOPIC_SEARCH');
});

test('common news actions extract with canonical predicates', () => {
  const cases = [
    ['The court suspended the order.', 'Court', 'SUSPENDED', 'order'],
    ['The police arrested three suspects.', 'Police', 'ARRESTED', 'three suspects'],
    ['The company cut 500 jobs.', 'Company', 'CUT', '500 jobs'],
    ['The minister denied the allegation.', 'Minister', 'DENIED', 'allegation'],
    ['The commission approved the proposal.', 'Commission', 'APPROVED', 'proposal'],
    ['The president appointed Rajesh Kumar as minister.', 'President', 'APPOINTED', 'Rajesh Kumar'],
    ['Party X won the election.', 'Party X', 'WON', 'election'],
    ['Marco Rubio visited India.', 'Marco Rubio', 'VISITED', 'India'],
  ];
  for (const [sentence, subject, predicate, object] of cases) {
    assert.deepEqual(shape(prop(sentence)).slice(0, 3), [subject, predicate, object], sentence);
  }
  // a stated denial is not a denied proposition
  assert.equal(prop('The minister denied the allegation.').certainty, 'UNSTATED');
});

test('different actions are never merged', () => {
  assert.notEqual(prop('The US raised tariffs on India.').predicate, prop('The US imposed tariffs on India.').predicate);
  assert.notEqual(prop('The company cut 500 jobs.').predicate, prop('The company removed 500 jobs.').predicate);
});

test('safeguards: other senses and non-objects are rejected', () => {
  for (const s of [
    'The army fired missiles at the border.',
    'The actor passed away on Monday.',
    'Trump won’t attend the summit.',
    'Prices increased sharply in March.',
    'The cabinet will meet on Tuesday.',
  ]) assert.equal(prop(s), null, s);
  assert.equal(parseQuery('Prices increased sharply').queryType, 'TOPIC_SEARCH');
});

test('existing role and event extraction does not regress', () => {
  assert.deepEqual(shape(prop('Dr. G. V. Selvam, Vice President of VIT, Proud of Indians')), ['G. V. Selvam', 'HOLDS_ROLE', 'Vice President', 'VIT']);
  assert.deepEqual(shape(prop('G.V. Selvam, vice-president, VIT, distributed prizes.')), ['G. V. Selvam', 'HOLDS_ROLE', 'Vice President', 'VIT']);
  assert.deepEqual(shape(prop('Sundar Pichai is the CEO of Google.')), ['Sundar Pichai', 'HOLDS_ROLE', 'CEO', 'Google']);
  assert.deepEqual(shape(prop('NASA delayed the Artemis launch to next month.')).slice(0, 3), ['NASA', 'POSTPONED', 'Artemis launch']);
  assert.equal(prop('Vice President Dr. G. V. Selvam announced for receiving the Doctorate.')?.predicate ?? null, null);
  assert.equal(parseQuery('Is GV Selvam director of VIT?').text, 'G. V. Selvam is Director of VIT.');
  assert.equal(parseQuery('Did Apple launch iPhone 17?').predicate, 'LAUNCHED');
  assert.equal(parseQuery('AI education India').queryType, 'TOPIC_SEARCH');
});
