import { loadConfig } from '../config.js';
import { openDatabase } from './database.js';
import { runMigrations } from './migrations.js';

const cfg = loadConfig();
const db = openDatabase(cfg.dbPath);
const applied = runMigrations(db);
console.log(
  applied.length
    ? `Applied migrations: ${applied.join(', ')} (${cfg.dbPath})`
    : `Database up to date (${cfg.dbPath})`
);
db.close();
