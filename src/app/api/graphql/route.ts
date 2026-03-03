import { ApolloServer } from '@apollo/server';
import { startServerAndCreateNextHandler } from '@as-integrations/next';
import { readFileSync } from 'fs';
import { join } from 'path';
import { NextRequest } from 'next/server';
import { resolvers } from '@/graphql/resolvers';

// Load schema from .graphql file
const typeDefs = readFileSync(
  join(process.cwd(), 'src/graphql/schema.graphql'),
  'utf-8'
);

const server = new ApolloServer({
  typeDefs,
  resolvers,
  introspection: true, // Enable GraphQL Playground in dev
});

const handler = startServerAndCreateNextHandler<NextRequest>(server, {
  context: async (req) => {
    // Extract auth token from Authorization header or cookie
    const authHeader = req.headers.get('authorization');
    const apiKey = req.headers.get('x-api-key');

    return {
      authToken: authHeader?.replace('Bearer ', '') || null,
      apiKey: apiKey || null,
    };
  },
});

export async function GET(req: NextRequest) {
  return handler(req);
}

export async function POST(req: NextRequest) {
  return handler(req);
}
