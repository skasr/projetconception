import { config } from './config';
import { createPool } from './db/pool';
import { createApp } from './http/app';

const pool = createPool();
const app = createApp({ pool, clock: () => new Date() });

app.listen(config.port, () => {
  console.log(`API Studio Riff sur http://localhost:${config.port}`);
});
