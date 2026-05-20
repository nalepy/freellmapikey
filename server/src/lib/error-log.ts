import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../data');
const ERROR_LOG_FILE = path.join(DATA_DIR, 'error.log');
const MAX_DB_ROWS = 500;
const MAX_MESSAGE_LEN = 8000;

export type ErrorLogEndpoint = 'chat-completions' | 'responses' | 'anthropic' | 'routing';

export interface ErrorLogContext {
  endpoint: ErrorLogEndpoint;
  platform?: string;
  modelId?: string;
  displayName?: string;
  clientModel?: string;
  attempt?: number;
  willRetry?: boolean;
  requiresVision?: boolean;
  hasImages?: boolean;
  stream?: boolean;
  messageCount?: number;
  estimatedInputTokens?: number;
  latencyMs?: number;
  error: unknown;
}

/** Strip secrets and huge base64 blobs before persisting. */
export function sanitizeErrorText(text: string): string {
  let s = text
    .replace(/data:[^;]+;base64,[A-Za-z0-9+/=]+/gi, '[base64-redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/sk-[A-Za-z0-9]{20,}/g, 'sk-[redacted]');
  if (s.length > MAX_MESSAGE_LEN) {
    s = `${s.slice(0, MAX_MESSAGE_LEN)}… [truncated]`;
  }
  return s;
}

export function categorizeErrorMessage(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('429') || m.includes('rate limit') || m.includes('too many') || m.includes('quota')) {
    return 'Rate Limited (429)';
  }
  if (m.includes('401') || m.includes('unauthorized') || m.includes('invalid api key')) {
    return 'Auth Error (401)';
  }
  if (m.includes('403') || m.includes('forbidden')) return 'Forbidden (403)';
  if (m.includes('404') || m.includes('not found')) return 'Not Found (404)';
  if (m.includes('400') || m.includes('bad request') || m.includes('could not process')) {
    return 'Bad Request (400)';
  }
  if (m.includes('422')) return 'Unprocessable (422)';
  if (m.includes('timeout') || m.includes('etimedout') || m.includes('econnrefused') || m.includes('econnreset')) {
    return 'Timeout/Connection';
  }
  if (m.includes('500') || m.includes('internal server')) return 'Server Error (500)';
  if (m.includes('502') || m.includes('bad gateway')) return 'Bad Gateway (502)';
  if (m.includes('503') || m.includes('unavailable')) return 'Unavailable (503)';
  return 'Other';
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function errorToDetail(error: unknown): string | null {
  if (!(error instanceof Error) || !error.stack) return null;
  return sanitizeErrorText(error.stack);
}

export function appendErrorLog(ctx: ErrorLogContext): void {
  const rawMessage = errorToMessage(ctx.error);
  const message = sanitizeErrorText(rawMessage);
  const category = categorizeErrorMessage(message);
  const detail = errorToDetail(ctx.error);
  const createdAt = new Date().toISOString();

  const row = {
    created_at: createdAt,
    endpoint: ctx.endpoint,
    platform: ctx.platform ?? null,
    model_id: ctx.modelId ?? null,
    display_name: ctx.displayName ?? null,
    client_model: ctx.clientModel ?? null,
    attempt: ctx.attempt ?? null,
    will_retry: ctx.willRetry ? 1 : 0,
    requires_vision: ctx.requiresVision ? 1 : 0,
    has_images: ctx.hasImages ? 1 : 0,
    stream: ctx.stream ? 1 : 0,
    message_count: ctx.messageCount ?? null,
    estimated_input_tokens: ctx.estimatedInputTokens ?? null,
    latency_ms: ctx.latencyMs ?? null,
    error_category: category,
    error_message: message,
    error_detail: detail,
  };

  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO error_logs (
        created_at, endpoint, platform, model_id, display_name, client_model,
        attempt, will_retry, requires_vision, has_images, stream, message_count,
        estimated_input_tokens, latency_ms, error_category, error_message, error_detail
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?
      )
    `).run(
      row.created_at, row.endpoint, row.platform, row.model_id, row.display_name, row.client_model,
      row.attempt, row.will_retry, row.requires_vision, row.has_images, row.stream, row.message_count,
      row.estimated_input_tokens, row.latency_ms, row.error_category, row.error_message, row.error_detail,
    );

    const count = db.prepare('SELECT COUNT(*) as n FROM error_logs').get() as { n: number };
    if (count.n > MAX_DB_ROWS) {
      const excess = count.n - MAX_DB_ROWS;
      db.prepare(`
        DELETE FROM error_logs WHERE id IN (
          SELECT id FROM error_logs ORDER BY created_at ASC LIMIT ?
        )
      `).run(excess);
    }
  } catch (e) {
    console.error('[ErrorLog] Failed to write to database:', e);
  }

  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const line = JSON.stringify(row) + '\n';
    fs.appendFileSync(ERROR_LOG_FILE, line, 'utf8');
  } catch (e) {
    console.error('[ErrorLog] Failed to append error.log:', e);
  }
}

export function getErrorLogFilePath(): string {
  return ERROR_LOG_FILE;
}

export function clearErrorLogs(): { deletedDb: number; clearedFile: boolean } {
  const db = getDb();
  const before = db.prepare('SELECT COUNT(*) as n FROM error_logs').get() as { n: number };
  db.prepare('DELETE FROM error_logs').run();

  let clearedFile = false;
  try {
    if (fs.existsSync(ERROR_LOG_FILE)) {
      fs.writeFileSync(ERROR_LOG_FILE, '', 'utf8');
      clearedFile = true;
    }
  } catch (e) {
    console.error('[ErrorLog] Failed to clear error.log:', e);
  }

  return { deletedDb: before.n, clearedFile };
}
