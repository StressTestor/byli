import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildSchema, getIntrospectionQuery, parse, validate } from 'graphql';
import { depthLimit, MAX_QUERY_DEPTH } from './depth-limit';
import { ALL_FRONTEND_OPERATIONS, FE_FEED, FE_HOME_FEED } from './test-fixtures/frontend-operations';

const schema = buildSchema(readFileSync(join(process.cwd(), 'src/graphql/schema.graphql'), 'utf-8'));

function errors(query: string, max = MAX_QUERY_DEPTH) {
  return validate(schema, parse(query), [depthLimit(max)]).map((e) => e.message);
}

// author > articles > edges > node > (author > articles > edges > node >)* id
function nested(levels: number) {
  // Each extra author/articles/edges/node hop adds 4 levels.
  let inner = 'id';
  for (let i = 0; i < levels; i++) inner = `author { articles { edges { node { ${inner} } } } }`;
  return `query { article(id: "x") { ${inner} } }`;
}

describe('depthLimit', () => {
  it('passes every in-repo frontend operation', () => {
    for (const op of ALL_FRONTEND_OPERATIONS) expect(errors(op)).toEqual([]);
  });

  it('the deepest in-repo operation sits two levels under the limit', () => {
    // articles > edges > node > author > handle
    expect(errors(FE_FEED, 5)).toEqual([]);
    expect(errors(FE_FEED, 4)).toEqual(['Query depth 5 exceeds the maximum of 4.']);
    expect(errors(FE_HOME_FEED, 5)).toEqual([]);
    expect(MAX_QUERY_DEPTH).toBe(7);
  });

  it('allows exactly the max and rejects one more', () => {
    // article(1) > author(2) > articles(3) > edges(4) > node(5) > author(6) > handle(7)
    const atMax = `query { article(id: "x") { author { articles { edges { node { author { handle } } } } } } }`;
    const overMax = `query { article(id: "x") { author { articles { edges { node { author { articles { totalCount } } } } } } } }`;
    expect(errors(atMax)).toEqual([]);
    expect(errors(overMax)).toEqual(['Query depth 8 exceeds the maximum of 7.']);
  });

  it('counts depth through named and inline fragments', () => {
    const viaFragments = `
      query { article(id: "x") { ...A } }
      fragment A on Article { author { ...B } }
      fragment B on Author { articles { edges { node { ... on Article { author { articles { totalCount } } } } } } }
    `;
    expect(errors(viaFragments)).toEqual(['Query depth 8 exceeds the maximum of 7.']);
  });

  it('checks each operation in a document separately', () => {
    const doc = `
      query Shallow { categories { slug } }
      query Deep ${nested(2).slice('query '.length)}
    `;
    expect(errors(doc)).toEqual(['Query depth 10 exceeds the maximum of 7.']);
  });

  it('terminates on fragment cycles (graphql-js reports the cycle itself)', () => {
    const cyclic = `
      query { article(id: "x") { ...A } }
      fragment A on Article { author { articles { edges { node { ...A } } } } }
    `;
    expect(() => errors(cyclic)).not.toThrow();
  });

  it('stays linear when fragments fan out', () => {
    // Each fragment spreads the next one twice; walking every path would be 2^20.
    const frags = Array.from({ length: 20 }, (_, i) =>
      `fragment F${i} on Article { ...F${i + 1} ...F${i + 1} }`).join('\n');
    const doc = `query { article(id: "x") { ...F0 } }\n${frags}\nfragment F20 on Article { id }`;
    const started = Date.now();
    expect(errors(doc)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('ignores the introspection subtree', () => {
    expect(errors(getIntrospectionQuery())).toEqual([]);
  });
});
