import { ApolloServer } from '@apollo/server';
import { resolvers } from '@/graphql/resolvers';
import { depthLimit, MAX_QUERY_DEPTH } from '@/graphql/depth-limit';
import { documentLimits, enforceOperationBudget, MAX_QUERY_TOKENS } from '@/graphql/resource-limits';
import type { GraphqlContext } from '@/graphql/request-cache';

export type { GraphqlContext } from '@/graphql/request-cache';

// Shared by the route handler and the contract tests so both run the same
// server configuration. The caller supplies the SDL (the route reads it from
// src/graphql/schema.graphql).
export function createGraphqlServer(typeDefs: string) {
  return new ApolloServer<GraphqlContext>({
    typeDefs,
    resolvers,
    // Only expose introspection (schema dump / Playground) outside production.
    // In prod it hands attackers a full map of the API surface.
    introspection: process.env.NODE_ENV !== 'production',
    allowBatchedHttpRequests: false,
    parseOptions: { maxTokens: MAX_QUERY_TOKENS },
    validationRules: [depthLimit(MAX_QUERY_DEPTH), documentLimits],
    plugins: [{
      async requestDidStart({ contextValue }) {
        contextValue.requestCache = new Map();
        return {
          async didResolveOperation({ schema, document, operation, request }) {
            if (operation) enforceOperationBudget(schema, document, operation, request.variables);
          },
        };
      },
    }],
  });
}
