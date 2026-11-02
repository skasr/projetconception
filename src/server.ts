import { config } from './config';
import { createPool } from './db/pool';
import { createApp } from './http/app';
import { createPlanningCache } from './cache/planningCache';

const pool = createPool();
const cache = createPlanningCache(config.valkeyUrl);
const app = createApp({ pool, clock: () => new Date(), cache });

app.listen(config.port, () => {
  console.log(`API Studio Riff sur http://localhost:${config.port}`);
});
