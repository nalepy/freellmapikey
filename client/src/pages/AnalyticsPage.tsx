import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend,
} from 'recharts'
import { apiFetch } from '@/lib/api'
import { formatLocalDateTime, formatLocalTime, formatTimelineLabel } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PageHeader } from '@/components/page-header'

type TimeRange = '24h' | '7d' | '30d'

function formatTokens(n?: number): string {
  if (!n) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function Stat({ label, value, className }: { label: string; value: string | number; className?: string }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <p className="text-[11px] text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className={`text-xl font-semibold tabular-nums mt-1 ${className ?? ''}`}>{value}</p>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card">
      <div className="px-4 py-3 border-b">
        <h3 className="text-sm font-medium">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

const axisStyle = { fontSize: 11, fill: 'var(--muted-foreground)' } as const
const gridStyle = 'var(--border)'
const primaryFill = 'var(--foreground)'

export default function AnalyticsPage() {
  const queryClient = useQueryClient()
  const [range, setRange] = useState<TimeRange>('7d')

  const resetMutation = useMutation({
    mutationFn: () => apiFetch<{ deleted: number }>('/api/analytics/reset', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['analytics'] })
      queryClient.invalidateQueries({ queryKey: ['fallback', 'token-usage'] })
    },
  })

  const clearErrorLogMutation = useMutation({
    mutationFn: () => apiFetch<{ deletedDb: number; clearedFile: boolean }>('/api/analytics/error-log/reset', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['analytics', 'error-log'] })
    },
  })

  function handleResetAnalytics() {
    const ok = window.confirm(
      'Delete all request history? Analytics charts and the Fallback monthly token bar will reset to zero. The detailed error log is kept so you can still debug failures. API keys and fallback order are not changed.',
    )
    if (!ok) return
    resetMutation.mutate()
  }

  function handleClearErrorLog() {
    const ok = window.confirm('Delete the detailed error log (database + error.log file)?')
    if (!ok) return
    clearErrorLogMutation.mutate()
  }

  const { data: summary } = useQuery({
    queryKey: ['analytics', 'summary', range],
    queryFn: () => apiFetch<any>(`/api/analytics/summary?range=${range}`),
  })

  const { data: byPlatform = [] } = useQuery({
    queryKey: ['analytics', 'by-platform', range],
    queryFn: () => apiFetch<any[]>(`/api/analytics/by-platform?range=${range}`),
  })

  const { data: timeline = [] } = useQuery({
    queryKey: ['analytics', 'timeline', range],
    queryFn: () => apiFetch<any[]>(`/api/analytics/timeline?range=${range}`),
  })

  const { data: byModel = [] } = useQuery({
    queryKey: ['analytics', 'by-model', range],
    queryFn: () => apiFetch<any[]>(`/api/analytics/by-model?range=${range}`),
  })

  const { data: errors = [] } = useQuery({
    queryKey: ['analytics', 'errors', range],
    queryFn: () => apiFetch<any[]>(`/api/analytics/errors?range=${range}`),
  })

  const { data: errorDist } = useQuery({
    queryKey: ['analytics', 'error-distribution', range],
    queryFn: () => apiFetch<{ byCategory: any[]; byPlatform: any[]; detailed: any[] }>(`/api/analytics/error-distribution?range=${range}`),
  })

  const { data: fallbackSettings } = useQuery({
    queryKey: ['fallback'],
    queryFn: () => apiFetch<{ visionOnlyRouting: boolean }>('/api/fallback'),
  })

  const { data: usageLog } = useQuery({
    queryKey: ['analytics', 'usage-log', range],
    queryFn: () => apiFetch<{ entries: any[] }>(`/api/analytics/usage-log?range=${range}&limit=100`),
  })

  const { data: errorLog } = useQuery({
    queryKey: ['analytics', 'error-log', range],
    queryFn: () => apiFetch<{ filePath: string; entries: any[] }>(`/api/analytics/error-log?range=${range}&limit=100`),
  })

  return (
    <div>
      <PageHeader
        title="Analytics"
        description="Request volume, latency, token usage, and failures. Vision column shows which models can accept images (same list as Fallback)."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 rounded-md border p-0.5">
              {(['24h', '7d', '30d'] as TimeRange[]).map(r => (
                <Button
                  key={r}
                  variant={range === r ? 'secondary' : 'ghost'}
                  size="xs"
                  onClick={() => setRange(r)}
                >
                  {r}
                </Button>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearErrorLog}
              disabled={clearErrorLogMutation.isPending}
            >
              {clearErrorLogMutation.isPending ? 'Clearing…' : 'Clear error log'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetAnalytics}
              disabled={resetMutation.isPending}
            >
              {resetMutation.isPending ? 'Resetting…' : 'Reset analytics'}
            </Button>
          </div>
        }
      />

      <div className="space-y-6">
        {fallbackSettings?.visionOnlyRouting && (
          <p className="text-sm text-muted-foreground rounded-lg border bg-card px-4 py-3">
            <span className="font-medium text-foreground">Vision-only routing is on.</span>{' '}
            Only models marked Vision below are used for all API traffic (including Codex). Text-only models in this table are historical requests from before the setting was enabled.
          </p>
        )}

        {/* Summary stats */}
        <p className="text-xs text-muted-foreground">
          Token counts for the selected time range ({range}). Streaming requests use estimated input size unless the provider reports usage.
          Failed fallback hops no longer add duplicate input. The Fallback budget bar uses calendar-month usage and may differ.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Stat label="Requests" value={summary?.totalRequests ?? 0} />
          <Stat label="Success rate" value={`${summary?.successRate ?? 0}%`} />
          <Stat label="Input tokens" value={formatTokens(summary?.totalInputTokens)} />
          <Stat label="Output tokens" value={formatTokens(summary?.totalOutputTokens)} />
          <Stat label="Avg latency" value={`${summary?.avgLatencyMs ?? 0} ms`} />
          <Stat label="Est. savings" value={`$${summary?.estimatedCostSavings ?? '0.00'}`} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Panel title="Requests by provider">
            {byPlatform.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No data yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={byPlatform} margin={{ top: 6, right: 6, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke={gridStyle} />
                  <XAxis dataKey="platform" tick={axisStyle} tickLine={false} axisLine={{ stroke: gridStyle }} />
                  <YAxis tick={axisStyle} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="requests" fill={primaryFill} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Panel>

          <Panel title="Avg latency by provider">
            {byPlatform.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No data yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={byPlatform} margin={{ top: 6, right: 6, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke={gridStyle} />
                  <XAxis dataKey="platform" tick={axisStyle} tickLine={false} axisLine={{ stroke: gridStyle }} />
                  <YAxis unit="ms" tick={axisStyle} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="avgLatencyMs" name="Latency (ms)" fill="var(--muted-foreground)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Panel>

          <div className="lg:col-span-2">
            <Panel title="Requests over time">
              {timeline.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No data yet</p>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={timeline} margin={{ top: 6, right: 6, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="2 4" stroke={gridStyle} />
                    <XAxis
                      dataKey="timestamp"
                      tick={axisStyle}
                      tickLine={false}
                      axisLine={{ stroke: gridStyle }}
                      tickFormatter={(v) => formatTimelineLabel(String(v), range === '24h')}
                    />
                    <YAxis tick={axisStyle} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{ backgroundColor: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                      labelFormatter={(v) => formatTimelineLabel(String(v), range === '24h')}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} iconType="line" />
                    <Line type="monotone" dataKey="successCount" name="Success" stroke={primaryFill} strokeWidth={1.5} dot={false} />
                    <Line type="monotone" dataKey="failureCount" name="Failures" stroke="var(--destructive)" strokeWidth={1.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </Panel>
          </div>

          <div className="lg:col-span-2">
            <Panel title="Per-model breakdown">
              {byModel.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No data yet</p>
              ) : (
                <div className="max-h-[360px] overflow-y-auto -mx-4">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-4">Model</TableHead>
                        <TableHead>Vision</TableHead>
                        <TableHead>Provider</TableHead>
                        <TableHead className="text-right">Requests</TableHead>
                        <TableHead className="text-right">Success</TableHead>
                        <TableHead className="text-right">Latency</TableHead>
                        <TableHead className="text-right">In tokens</TableHead>
                        <TableHead className="text-right pr-4">Out tokens</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {byModel.map((m: any, i: number) => (
                        <TableRow key={i}>
                          <TableCell className="pl-4 text-sm font-medium">{m.displayName}</TableCell>
                          <TableCell>
                            {m.supportsVision ? (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal">
                                Yes
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{m.platform}</TableCell>
                          <TableCell className="text-right tabular-nums">{m.requests}</TableCell>
                          <TableCell className="text-right tabular-nums">{m.successRate}%</TableCell>
                          <TableCell className="text-right tabular-nums">{m.avgLatencyMs} ms</TableCell>
                          <TableCell className="text-right tabular-nums">{formatTokens(m.totalInputTokens)}</TableCell>
                          <TableCell className="text-right tabular-nums pr-4">{formatTokens(m.totalOutputTokens)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Panel>
          </div>

          <Panel title="Errors by provider">
            {!errorDist?.byPlatform?.length ? (
              <p className="text-sm text-muted-foreground text-center py-8">No errors</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={errorDist.byPlatform} margin={{ top: 6, right: 6, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke={gridStyle} />
                  <XAxis dataKey="platform" tick={axisStyle} tickLine={false} axisLine={{ stroke: gridStyle }} />
                  <YAxis tick={axisStyle} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="count" fill="var(--destructive)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Panel>

          <Panel title="Recent errors">
            {errors.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No errors</p>
            ) : (
              <div className="max-h-[240px] overflow-y-auto -mx-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">Provider</TableHead>
                      <TableHead>Message</TableHead>
                      <TableHead className="text-right pr-4">Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {errors.slice(0, 20).map((e: any) => (
                      <TableRow key={e.id}>
                        <TableCell className="pl-4 text-xs">{e.platform}</TableCell>
                        <TableCell className="text-xs max-w-[200px] truncate">{e.error}</TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground tabular-nums pr-4">
                          {formatLocalTime(e.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Panel>
        </div>

        <Panel title="Usage log">
          <p className="text-xs text-muted-foreground mb-3">
            Each successful routed request in the selected range ({range}), newest first. Use this to confirm when
            Claude Code, Codex, or other clients hit the proxy and which provider/model served the call.
            Cleared when you reset analytics.
          </p>
          {!usageLog?.entries?.length ? (
            <p className="text-sm text-muted-foreground text-center py-8">No successful requests yet</p>
          ) : (
            <div className="max-h-[420px] overflow-y-auto -mx-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Time</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Vision</TableHead>
                    <TableHead className="text-right">In</TableHead>
                    <TableHead className="text-right">Out</TableHead>
                    <TableHead className="text-right pr-4">Latency</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usageLog.entries.map((e: any) => (
                    <TableRow key={e.id}>
                      <TableCell className="pl-4 text-xs text-muted-foreground whitespace-nowrap">
                        {formatLocalDateTime(e.createdAt)}
                      </TableCell>
                      <TableCell className="text-xs font-medium">{e.displayName}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{e.platform}</TableCell>
                      <TableCell className="text-xs">
                        {e.supportsVision ? (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal">
                            Yes
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{formatTokens(e.inputTokens)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{formatTokens(e.outputTokens)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums pr-4">{e.latencyMs} ms</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Panel>

        <Panel title="Error log (debug)">
          <p className="text-xs text-muted-foreground mb-3">
            Full failure details for troubleshooting (endpoint, vision flags, retry, complete message).
            Also saved to{' '}
            <code className="text-[11px] bg-muted px-1 py-0.5 rounded">{errorLog?.filePath ?? 'server/data/error.log'}</code>
            . Not cleared when you reset analytics.
          </p>
          {!errorLog?.entries?.length ? (
            <p className="text-sm text-muted-foreground text-center py-8">No error log entries</p>
          ) : (
            <div className="max-h-[420px] overflow-y-auto -mx-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Time</TableHead>
                    <TableHead>Endpoint</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Flags</TableHead>
                    <TableHead className="pr-4">Message</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {errorLog.entries.map((e: any) => (
                    <TableRow key={e.id}>
                      <TableCell className="pl-4 text-xs text-muted-foreground whitespace-nowrap">
                        {formatLocalDateTime(e.createdAt)}
                      </TableCell>
                      <TableCell className="text-xs">{e.endpoint}</TableCell>
                      <TableCell className="text-xs">
                        {e.displayName ?? e.platform ?? '—'}
                        {e.attempt != null && (
                          <span className="text-muted-foreground"> · try {e.attempt + 1}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">{e.errorCategory}</TableCell>
                      <TableCell className="text-xs">
                        <div className="flex flex-wrap gap-1">
                          {e.hasImages && <Badge variant="outline" className="text-[10px]">img</Badge>}
                          {e.requiresVision && <Badge variant="outline" className="text-[10px]">vision</Badge>}
                          {e.willRetry && <Badge variant="outline" className="text-[10px]">retry</Badge>}
                          {e.stream && <Badge variant="outline" className="text-[10px]">stream</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs pr-4 max-w-md whitespace-pre-wrap break-words">
                        {e.errorMessage}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}
