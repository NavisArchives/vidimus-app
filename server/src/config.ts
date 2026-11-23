import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..', '..');

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v == null || v === '') return fallback;
  return v === 'true' || v === '1';
}

export interface AppConfig {
  port: number;
  host: string;
  nodeEnv: string;
  dataDir: string;
  dbPath: string;
  uploadsDir: string;
  sessionSecret: string;
  sessionTtlHours: number;
  cookieSecure: boolean;
  corsOrigin: string;
  maxUploadBytes: number;
  maxConcurrentReviews: number;
  seedDemo: boolean;
  providers: {
    anthropicApiKey: string | null;
    anthropicModel: string;
    openaiApiKey: string | null;
    openaiModel: string;
    geminiApiKey: string | null;
    geminiModel: string;
    languagetoolUrl: string | null;
  };
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const dataDir = path.resolve(REPO_ROOT, process.env.VIDIMUS_DATA_DIR || './data');
  const dbPath = overrides.dbPath
    ? path.resolve(overrides.dbPath)
    : path.resolve(REPO_ROOT, process.env.VIDIMUS_DB_PATH || path.join(dataDir, 'vidimus.sqlite'));
  const uploadsDir = overrides.uploadsDir
    ? path.resolve(overrides.uploadsDir)
    : path.resolve(REPO_ROOT, process.env.VIDIMUS_UPLOADS_DIR || path.join(dataDir, 'uploads'));

  const base: AppConfig = {
    port: envInt('PORT', 8777),
    host: process.env.HOST || '127.0.0.1',
    nodeEnv: process.env.NODE_ENV || 'development',
    dataDir,
    dbPath,
    uploadsDir,
    sessionSecret: process.env.SESSION_SECRET || 'vidimus-dev-session-secret-change-in-production',
    sessionTtlHours: envInt('SESSION_TTL_HOURS', 168),
    cookieSecure: envBool('COOKIE_SECURE', false),
    corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    maxUploadBytes: envInt('MAX_UPLOAD_MB', 25) * 1024 * 1024,
    maxConcurrentReviews: envInt('MAX_CONCURRENT_REVIEWS', 2),
    seedDemo: envBool('VIDIMUS_SEED_DEMO', true),
    providers: {
      anthropicApiKey: process.env.ANTHROPIC_API_KEY?.trim() || null,
      anthropicModel: process.env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-4-20250514',
      openaiApiKey: process.env.OPENAI_API_KEY?.trim() || null,
      openaiModel: process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini',
      geminiApiKey: process.env.GEMINI_API_KEY?.trim() || null,
      geminiModel: process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash',
      languagetoolUrl: process.env.LANGUAGETOOL_URL?.trim() || null,
    },
  };

  return {
    ...base,
    ...overrides,
    providers: {
      ...base.providers,
      ...(overrides.providers || {}),
    },
  };
}
