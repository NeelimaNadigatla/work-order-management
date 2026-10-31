import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DB_FILE = process.env.DB_FILE ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'workorders.db');
