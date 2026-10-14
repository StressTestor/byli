import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { buildSchema, getOperationAST, parse, validate } from 'graphql';
import { ALL_FRONTEND_OPERATIONS, FE_FEED } from './test-fixtures/frontend-operations';
import {
  documentLimits, enforceOperationBudget, MAX_ALIASES, MAX_EXPANDED_FIELDS,
  MAX_QUERY_TOKENS, MAX_ROOT_FIELDS,
} from './resource-limits';

const schema = buildSchema(readFileSync(join(process.cwd(), 'src/graphql/schema.graphql'), 'utf8'));
const variables = { first: 20, id: 'test', score: 4, input: { url: 'https://x.com/i/article/123' } };
const messages = (query: string) => validate(schema, parse(query), [documentLimits]).map(error => error.message);
function budget(query: string, values = {}) {
  const document = parse(query);
  const operation = getOperationAST(document)!;
  return enforceOperationBudget(schema, document, operation, values);
}
const nested = (first: string) => `{
  articles(first: ${first}) { edges { node { author { articles(first: ${first}) { totalCount } } } } }
}`;

describe('GraphQL request resource limits', () => {
  it('accepts every real frontend operation and a maximum-size feed', () => {
    for (const operation of ALL_FRONTEND_OPERATIONS) {
      expect(messages(operation)).toEqual([]);
      expect(() => budget(operation, variables)).not.toThrow();
    }
    expect(() => budget(FE_FEED, { first: 50 })).not.toThrow();
  });

  it('rejects multiple operations and multiple mutation root fields', () => {
    expect(messages('query A { categories { id } } query B { categories { id } }'))
      .toContain('Send exactly one GraphQL operation per request.');
    expect(messages('mutation { a: revokeApiKey(id: "a") b: revokeApiKey(id: "b") }'))
      .toContain('GraphQL operations support at most 1 root fields.');
  });

  it('bounds shallow root breadth and aliases within a single root', () => {
    const roots = Array.from({ length: MAX_ROOT_FIELDS + 1 }, (_, i) => `a${i}: article(id: "x") { id }`);
    expect(messages(`{ ${roots.join(' ')} }`)).toContain(`GraphQL operations support at most ${MAX_ROOT_FIELDS} root fields.`);
    const aliases = Array.from({ length: MAX_ALIASES + 1 }, (_, i) => `a${i}: id`);
    expect(messages(`{ article(id: "x") { ${aliases.join(' ')} } }`))
      .toContain(`GraphQL operations support at most ${MAX_ALIASES} aliases.`);
  });

  it('counts breadth through root and nested fragments', () => {
    const fragments = Array.from({ length: 30 }, (_, i) => `fragment F${i} on Article { ...F${i + 1} ...F${i + 1} }`).join('\n');
    const started = Date.now();
    expect(messages(`{ article(id: "x") { ...F0 } } ${fragments} fragment F30 on Article { id }`))
      .toContain(`GraphQL operations support at most ${MAX_EXPANDED_FIELDS} expanded fields.`);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(messages('mutation { ...M } fragment M on Mutation { a: revokeApiKey(id: "a") b: revokeApiKey(id: "b") }'))
      .toContain('GraphQL operations support at most 1 root fields.');
  });

  it('terminates on cycles while normal validation rejects them', () => {
    const query = '{ article(id: "x") { ...A } } fragment A on Article { id ...A }';
    expect(() => messages(query)).not.toThrow();
    expect(() => budget(query)).not.toThrow();
    expect(validate(schema, parse(query)).length).toBeGreaterThan(0);
  });

  it('charges nested list database work even when only totalCount is selected', () => {
    expect(() => budget(nested('1'))).not.toThrow();
    expect(() => budget(nested('50'))).toThrow('resource budget');
    expect(() => budget(`query($n: Int = 50) ${nested('$n')}`)).toThrow('resource budget');
    expect(() => budget(`query($n: Int!) ${nested('$n')}`, { n: 50 })).toThrow('resource budget');
    expect(() => budget(`query($n: Int!) ${nested('$n')}`, { n: 1 })).not.toThrow();
  });

  it('uses coerced values and rejects invalid page sizes before execution', () => {
    for (const first of [-1, 0, 51, 1.5, '50']) {
      expect(() => budget('query($first: Int) { articles(first: $first) { totalCount } }', { first })).toThrow();
    }
    expect(budget('{ articles { totalCount } }')?.data).toBe(21);
    expect(budget('{ author(handle: "x") { articles { totalCount } } }')?.data).toBe(12);
  });

  it('charges fragment and inline-fragment fanout and conditional branches', () => {
    const query = `query($n: Int!) { articles(first: $n) { ...Connection } }
      fragment Connection on ArticleConnection { edges { node { ... on Article {
        author { articles(first: $n) @skip(if: true) { totalCount } }
      } } } }`;
    expect(() => budget(query, { n: 50 })).toThrow('resource budget');
  });

  it('counts large result sets independently of database reads', () => {
    const query = `{ articles(first: 50) { edges { node { categories {
      id slug label icon
    } } } } }`;
    expect(() => budget(query)).toThrow('resource budget');
  });

  it('bounds parsing tokens before validation', () => {
    expect(() => parse(`{ article(id: "x") { ${'id '.repeat(MAX_QUERY_TOKENS)} } }`, { maxTokens: MAX_QUERY_TOKENS }))
      .toThrow('3000 tokens');
  });
});
