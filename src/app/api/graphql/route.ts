import { startServerAndCreateNextHandler } from '@as-integrations/next';
import { readFileSync } from 'fs';
import { join } from 'path';
import { NextRequest } from 'next/server';
import { createGraphqlServer, type GraphqlContext } from '@/graphql/server';

// Load schema from .graphql file
const typeDefs = readFileSync(
  join(process.cwd(), 'src/graphql/schema.graphql'),
  'utf-8'
);

const server = createGraphqlServer(typeDefs);

const handler = startServerAndCreateNextHandler<NextRequest, GraphqlContext>(server, {
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

// POST only: the site's gql() helper always POSTs, and without a GET export
// Next answers GET with 405.
export async function POST(req: NextRequest) {
  return handler(req);
}
