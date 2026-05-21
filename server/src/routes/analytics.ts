import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDb } from '../db/index.js';
import { clearErrorLogs, getErrorLogFilePath } from '../lib/error-log.js';
import { modelSupportsVision } from '../lib/message-content.js';

export const analyticsRouter = Router();

/** Shared with error-log categories; used in SQL CASE for analytics charts. */
const ERROR_CATEGORY_CASE = `
  CASE
    WHEN error LIKE '%429%' OR error LIKE '%rate limit%' OR error LIKE '%too many%' OR error LIKE '%quota%' THEN 'Rate Limited (429)'
    WHEN error LIKE '%400%' OR error LIKE '%bad request%' OR error LIKE '%could not process%'
      OR error LIKE '%invalid json payload%' OR error LIKE '%unknown name%' THEN 'Bad Request (400)'
    WHEN error LIKE '%422%' OR error LIKE '%unprocessable%' THEN 'Unprocessable (422)'
    WHEN error LIKE '%401%' OR error LIKE '%unauthorized%' OR error LIKE '%invalid%key%' THEN 'Auth Error (401)'
    WHEN error LIKE '%403%' OR error LIKE '%forbidden%' THEN 'Forbidden (403)'
    WHEN error LIKE '%404%' OR error LIKE '%not found%' THEN 'Not Found (404)'
    WHEN error LIKE '%timeout%' OR error LIKE '%ETIMEDOUT%' OR error LIKE '%ECONNREFUSED%' THEN 'Timeout/Connection'
    WHEN error LIKE '%500%' OR error LIKE '%internal server%' THEN 'Server Error (500)'
    WHEN error LIKE '%502%' OR error LIKE '%bad gateway%' THEN 'Bad Gateway (502)'
    WHEN error LIKE '%503%' OR error LIKE '%unavailable%' THEN 'Unavailable (503)'
    ELSE 'Other'
  END`;

// Map range to a JS-computed ISO timestamp passed as a bind parameter,
// so the SQL string never includes user-controlled fragments.
function getSinceTimestamp(range: string): string {
  const now = Date.now();
  switch (range) {
    case '24h':
      return new Date(now - 24 * 60 * 60 * 1000).toISOString();
    case '30d':
      return new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
    case '7d':
    default:
      return new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  }
}

// Summary stats
analyticsRouter.get('/summary', (req: Request, res: Response) => {
  const range = (req.query.range as string) ?? '7d';
  const since = getSinceTimestamp(range);
  const db = getDb();

  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_requests,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
      SUM(input_tokens) as total_input_tokens,
      SUM(output_tokens) as total_output_tokens,
      AVG(latency_ms) as avg_latency_ms
    FROM requests
    WHERE created_at >= ?
  `).get(since) as any;

  const totalRequests = stats.total_requests ?? 0;
  const successRate = totalRequests > 0 ? (stats.success_count / totalRequests) * 100 : 0;
  const totalTokens = (stats.total_input_tokens ?? 0) + (stats.total_output_tokens ?? 0);

  // Estimate cost savings: average ~$3/M input + $15/M output tokens (GPT-4o pricing)
  const inputCost = ((stats.total_input_tokens ?? 0) / 1_000_000) * 3;
  const outputCost = ((stats.total_output_tokens ?? 0) / 1_000_000) * 15;

  res.json({
    totalRequests,
    successRate: Math.round(successRate * 10) / 10,
    totalInputTokens: stats.total_input_tokens ?? 0,
    totalOutputTokens: stats.total_output_tokens ?? 0,
    avgLatencyMs: Math.round(stats.avg_latency_ms ?? 0),
    estimatedCostSavings: Math.round((inputCost + outputCost) * 100) / 100,
  });
});

// Stats grouped by model
analyticsRouter.get('/by-model', (req: Request, res: Response) => {
  const range = (req.query.range as string) ?? '7d';
  const since = getSinceTimestamp(range);
  const db = getDb();

  const rows = db.prepare(`
    SELECT
      r.platform,
      r.model_id,
      m.display_name,
      COUNT(*) as requests,
      SUM(CASE WHEN r.status = 'success' THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as success_rate,
      AVG(r.latency_ms) as avg_latency_ms,
      SUM(r.input_tokens) as total_input_tokens,
      SUM(r.output_tokens) as total_output_tokens
    FROM requests r
    LEFT JOIN models m ON m.platform = r.platform AND m.model_id = r.model_id
    WHERE r.created_at >= ?
    GROUP BY r.platform, r.model_id
    ORDER BY requests DESC
  `).all(since) as any[];

  res.json(rows.map(r => ({
    platform: r.platform,
    modelId: r.model_id,
    displayName: r.display_name ?? r.model_id,
    supportsVision: modelSupportsVision(r.platform, r.model_id),
    requests: r.requests,
    successRate: Math.round(r.success_rate * 10) / 10,
    avgLatencyMs: Math.round(r.avg_latency_ms),
    totalInputTokens: r.total_input_tokens ?? 0,
    totalOutputTokens: r.total_output_tokens ?? 0,
  })));
});

// Stats grouped by platform
analyticsRouter.get('/by-platform', (req: Request, res: Response) => {
  const range = (req.query.range as string) ?? '7d';
  const since = getSinceTimestamp(range);
  const db = getDb();

  const rows = db.prepare(`
    SELECT
      platform,
      COUNT(*) as requests,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as success_rate,
      AVG(latency_ms) as avg_latency_ms,
      SUM(input_tokens) as total_input_tokens,
      SUM(output_tokens) as total_output_tokens
    FROM requests
    WHERE created_at >= ?
    GROUP BY platform
    ORDER BY requests DESC
  `).all(since) as any[];

  res.json(rows.map(r => ({
    platform: r.platform,
    requests: r.requests,
    successRate: Math.round(r.success_rate * 10) / 10,
    avgLatencyMs: Math.round(r.avg_latency_ms),
    totalInputTokens: r.total_input_tokens ?? 0,
    totalOutputTokens: r.total_output_tokens ?? 0,
  })));
});

// Timeline data
analyticsRouter.get('/timeline', (req: Request, res: Response) => {
  const range = (req.query.range as string) ?? '7d';
  const interval = (req.query.interval as string) ?? (range === '24h' ? 'hour' : 'day');
  const since = getSinceTimestamp(range);
  const db = getDb();

  // dateFormat is a hardcoded whitelist — never user-controlled.
  const dateFormat = interval === 'hour' ? '%Y-%m-%dT%H:00:00' : '%Y-%m-%d';

  const rows = db.prepare(`
    SELECT
      strftime('${dateFormat}', created_at) as timestamp,
      COUNT(*) as requests,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as failure_count
    FROM requests
    WHERE created_at >= ?
    GROUP BY strftime('${dateFormat}', created_at)
    ORDER BY timestamp ASC
  `).all(since) as any[];

  res.json(rows.map(r => ({
    timestamp: r.timestamp,
    requests: r.requests,
    successCount: r.success_count,
    failureCount: r.failure_count,
  })));
});

// Error distribution (grouped by error type and platform)
analyticsRouter.get('/error-distribution', (req: Request, res: Response) => {
  const range = (req.query.range as string) ?? '7d';
  const since = getSinceTimestamp(range);
  const db = getDb();

  // Group errors by category (extract the key part of the error message)
  const rows = db.prepare(`
    SELECT
      platform,
      model_id,
      ${ERROR_CATEGORY_CASE} as error_category,
      COUNT(*) as count
    FROM requests
    WHERE status = 'error' AND created_at >= ?
    GROUP BY platform, error_category
    ORDER BY count DESC
  `).all(since) as any[];

  // Also get totals by category
  const byCategory = db.prepare(`
    SELECT
      ${ERROR_CATEGORY_CASE} as category,
      COUNT(*) as count
    FROM requests
    WHERE status = 'error' AND created_at >= ?
    GROUP BY category
    ORDER BY count DESC
  `).all(since) as any[];

  // Errors by platform
  const byPlatform = db.prepare(`
    SELECT platform, COUNT(*) as count
    FROM requests
    WHERE status = 'error' AND created_at >= ?
    GROUP BY platform
    ORDER BY count DESC
  `).all(since) as any[];

  res.json({
    byCategory,
    byPlatform,
    detailed: rows,
  });
});

// Successful requests with timestamps (usage log)
analyticsRouter.get('/usage-log', (req: Request, res: Response) => {
  const range = (req.query.range as string) ?? '7d';
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '100'), 10) || 100, 1), 500);
  const since = getSinceTimestamp(range);
  const db = getDb();

  const rows = db.prepare(`
    SELECT
      r.id,
      r.platform,
      r.model_id,
      m.display_name,
      r.input_tokens,
      r.output_tokens,
      r.latency_ms,
      r.created_at
    FROM requests r
    LEFT JOIN models m ON m.platform = r.platform AND m.model_id = r.model_id
    WHERE r.status = 'success' AND r.created_at >= ?
    ORDER BY r.created_at DESC
    LIMIT ?
  `).all(since, limit) as any[];

  res.json({
    entries: rows.map(r => ({
      id: r.id,
      createdAt: r.created_at,
      platform: r.platform,
      modelId: r.model_id,
      displayName: r.display_name ?? r.model_id,
      supportsVision: modelSupportsVision(r.platform, r.model_id),
      inputTokens: r.input_tokens ?? 0,
      outputTokens: r.output_tokens ?? 0,
      latencyMs: r.latency_ms ?? 0,
    })),
  });
});

// Recent errors
analyticsRouter.get('/errors', (req: Request, res: Response) => {
  const range = (req.query.range as string) ?? '7d';
  const since = getSinceTimestamp(range);
  const db = getDb();

  const rows = db.prepare(`
    SELECT id, platform, model_id, error, latency_ms, created_at
    FROM requests
    WHERE status = 'error' AND created_at >= ?
    ORDER BY created_at DESC
    LIMIT 50
  `).all(since) as any[];

  res.json(rows.map(r => ({
    id: r.id,
    platform: r.platform,
    modelId: r.model_id,
    error: r.error,
    latencyMs: r.latency_ms,
    createdAt: r.created_at,
  })));
});

// Detailed error log (kept when analytics is reset)
analyticsRouter.get('/error-log', (req: Request, res: Response) => {
  const range = (req.query.range as string) ?? '7d';
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '100'), 10) || 100, 1), 500);
  const since = getSinceTimestamp(range);
  const db = getDb();

  const rows = db.prepare(`
    SELECT *
    FROM error_logs
    WHERE created_at >= ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(since, limit) as any[];

  res.json({
    filePath: getErrorLogFilePath(),
    entries: rows.map(r => ({
      id: r.id,
      createdAt: r.created_at,
      endpoint: r.endpoint,
      platform: r.platform,
      modelId: r.model_id,
      displayName: r.display_name,
      clientModel: r.client_model,
      attempt: r.attempt,
      willRetry: r.will_retry === 1,
      requiresVision: r.requires_vision === 1,
      hasImages: r.has_images === 1,
      stream: r.stream === 1,
      messageCount: r.message_count,
      estimatedInputTokens: r.estimated_input_tokens,
      latencyMs: r.latency_ms,
      errorCategory: r.error_category,
      errorMessage: r.error_message,
      errorDetail: r.error_detail,
    })),
  });
});

analyticsRouter.post('/error-log/reset', (_req: Request, res: Response) => {
  res.json(clearErrorLogs());
});

// Clear request stats only (error log is kept for debugging)
analyticsRouter.post('/reset', (_req: Request, res: Response) => {
  const db = getDb();
  const before = db.prepare('SELECT COUNT(*) as n FROM requests').get() as { n: number };
  db.prepare('DELETE FROM requests').run();
  res.json({ deleted: before.n, errorLogKept: true, errorLogFile: getErrorLogFilePath() });
});
