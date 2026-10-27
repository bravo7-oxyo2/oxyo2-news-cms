import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'

// Node does not automatically read .env files. Keep production environment-only,
// but make local API and dedicated worker commands use the repository .env file.
if (process.env.NODE_ENV !== 'production') {
  for (const candidate of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../.env'), resolve(process.cwd(), '../../.env')]) {
    if (existsSync(candidate)) { process.loadEnvFile(candidate); break }
  }
}

const parsedConfig = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000), HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1), SESSION_SECRET: z.string().min(32),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:5174'),
  ADMIN_ORIGIN: z.string().url().default('http://localhost:5173'),
  UPLOAD_DIR: z.string().default('./uploads'), MAX_UPLOAD_BYTES: z.coerce.number().default(524288000),
  SMTP_HOST: z.string().optional(), SMTP_PORT: z.coerce.number().default(587), SMTP_USER: z.string().optional(), SMTP_PASSWORD: z.string().optional(), SMTP_FROM: z.string().default('CMS <no-reply@example.com>'),
  DEEPSEEK_API_KEY: z.string().optional(), DEEPSEEK_API_URL: z.string().url().default('https://api.deepseek.com'), DEEPSEEK_MODEL: z.string().default('deepseek-chat'),
  OLLAMA_URL: z.string().url().default('http://localhost:11434'), OLLAMA_MODEL: z.string().default('deepseek-r1:latest'),
  PEXELS_API_KEY: z.string().optional(), PIXABAY_API_KEY: z.string().optional(), UNSPLASH_ACCESS_KEY: z.string().optional(),
  NEWS_BOT_POLL_INTERVAL_SECONDS: z.coerce.number().int().min(15).default(60), NEWS_BOT_TIMEZONE: z.string().default('Asia/Kuala_Lumpur'),
  INDEXNOW_KEY: z.string().optional(),
  GSC_OAUTH_CLIENT_ID: z.string().optional(), GSC_OAUTH_CLIENT_SECRET: z.string().optional(),
  GSC_TOKEN_ENCRYPTION_KEY: z.string().optional(), GSC_TOKEN_STORE_PATH: z.string().default('./gsc-connection.enc'),
  GSC_OAUTH_REDIRECT_URI: z.preprocess(value => value === '' ? undefined : value, z.string().url().optional()),
  GSC_AUTOMATION_EXPORT_TOKEN: z.preprocess(value => value === '' ? undefined : value, z.string().min(32).optional()),
  TELEGRAM_BOT_TOKEN: z.preprocess(value => value === '' ? undefined : value, z.string().min(1).optional()),
  TELEGRAM_CHAT_ID: z.preprocess(value => value === '' ? undefined : value, z.string().min(1).optional()),
}).parse(process.env)

export const config = {
  ...parsedConfig,
  GSC_OAUTH_REDIRECT_URI: parsedConfig.GSC_OAUTH_REDIRECT_URI ?? `${parsedConfig.ADMIN_ORIGIN.replace(/\/$/, '')}/api/admin/search-console/oauth/callback`,
}
