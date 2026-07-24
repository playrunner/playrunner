import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.cts';

declare global {
  var prisma: PrismaClient | undefined;
}

function getDatabaseAdapterConfig() {
  const rawDatabaseUrl = process.env.DATABASE_URL?.trim();
  if (!rawDatabaseUrl) {
    return {
      connectionString: undefined,
      schema: undefined,
    };
  }

  const databaseUrl = new URL(rawDatabaseUrl);
  const schema = databaseUrl.searchParams.get('schema')?.trim() || undefined;
  if (schema && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) {
    throw new Error(`DATABASE_URL contains an invalid schema: "${schema}".`);
  }
  databaseUrl.searchParams.delete('schema');

  return {
    connectionString: databaseUrl.toString(),
    schema,
  };
}

const databaseConfig = getDatabaseAdapterConfig();

export const prisma =
  globalThis.prisma ||
  new PrismaClient({
    adapter: new PrismaPg(
      {
        connectionString: databaseConfig.connectionString,
        ...(databaseConfig.schema
          ? { options: `-c search_path=${databaseConfig.schema}` }
          : {}),
      },
      databaseConfig.schema ? { schema: databaseConfig.schema } : undefined,
    ),
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'warn', 'error']
        : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.prisma = prisma;
}
