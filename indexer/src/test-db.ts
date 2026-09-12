import { Client } from 'pg';
import * as dotenv from 'dotenv';

// Load environment variables from .env if present
dotenv.config();

async function testPostgresConnection(): Promise<void> {
  // Support either full DATABASE_URL or individual POSTGRES_* env vars
  const connectionString = process.env.DATABASE_URL;
  const clientConfig = connectionString
    ? { connectionString }
    : {
        host: process.env.POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
        user: process.env.POSTGRES_USER || 'postgres',
        password: process.env.POSTGRES_PASSWORD || 'postgres',
        database: process.env.POSTGRES_DB || 'certledger',
      };

  const client = new Client(clientConfig);

  console.log('[PostgreSQL Test] Connecting to PostgreSQL database...');
  await client.connect();

  try {
    const res = await client.query('SELECT 1 AS connected, NOW() AS current_time');
    console.log('[PostgreSQL Test] Query succeeded:', res.rows[0]);
    console.log('[PostgreSQL Test] PostgreSQL connection verified successfully.');
  } finally {
    await client.end();
    console.log('[PostgreSQL Test] Connection closed cleanly.');
  }
}

testPostgresConnection().catch((err) => {
  console.error('[PostgreSQL Test] Connection test failed:', err.message);
  process.exit(1);
});
