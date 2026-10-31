import { createApp } from './app.js';
import { openDatabase } from './db/index.js';
import { DB_FILE } from './config.js';

const PORT = Number(process.env.PORT ?? 4000);

const db = openDatabase(DB_FILE);
createApp({ db }).listen(PORT, () => {
  console.log(`Work order API listening on http://localhost:${PORT} (db: ${DB_FILE})`);
});
