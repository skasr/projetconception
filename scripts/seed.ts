import { createPool } from '../src/db/pool';
import { resetAndSeed } from '../src/db/seed';

async function run(): Promise<void> {
  const pool = createPool();
  try {
    await resetAndSeed(pool);
    console.log('données de départ insérées');
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
