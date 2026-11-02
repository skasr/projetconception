import { Pool } from 'pg';
import { config } from '../config';

export function createPool(connectionString: string = config.databaseUrl): Pool {
  return new Pool({ connectionString });
}
