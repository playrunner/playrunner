import pg from 'pg';

// Match the API's database schema selection, including isolated test schemas.
export function createRenewalPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is required.');
  const url = new URL(connectionString);
  const schema = url.searchParams.get('schema')?.trim();
  if (schema && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema))
    throw new Error('Invalid database schema.');
  url.searchParams.delete('schema');
  return new pg.Pool({
    connectionString: url.toString(),
    max: 2,
    ...(schema ? { options: `-c search_path=${schema}` } : {}),
  });
}
