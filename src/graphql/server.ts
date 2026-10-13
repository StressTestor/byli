import { ApolloServer } from '@apollo/server';
import { resolvers } from '@/graphql/resolvers';
import { depthLimit, MAX_QUERY_DEPTH } from '@/graphql/depth-limit';

export interface GraphqlContext {
  authToken: string | null;
  apiKey: string | null;
}

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
    validationRules: [depthLimit(MAX_QUERY_DEPTH)],
  });
}
