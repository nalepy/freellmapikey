import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageHeader } from '@/components/page-header'
import { UnifiedKeySection } from '@/components/unified-key-section'
import type { ApiKey, Platform } from '../../../shared/types'

const PLATFORMS: { value: Platform; label: string }[] = [
  { value: 'google', label: 'Google AI Studio' },
  { value: 'groq', label: 'Groq' },
  { value: 'cerebras', label: 'Cerebras' },
  { value: 'sambanova', label: 'SambaNova' },
  { value: 'nvidia', label: 'NVIDIA NIM' },
  { value: 'mistral', label: 'Mistral' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'github', label: 'GitHub Models' },
  { value: 'cohere', label: 'Cohere' },
  { value: 'cloudflare', label: 'Cloudflare Workers AI' },
  { value: 'huggingface', label: 'Hugging Face' },
  { value: 'together', label: 'Together AI' },
  { value: 'zhipu', label: 'Zhipu AI (Z.ai)' },
  { value: 'ollama', label: 'Ollama Cloud' },
  { value: 'kilo', label: 'Kilo Gateway (anon ok)' },
  { value: 'pollinations', label: 'Pollinations (anon ok)' },
  { value: 'llm7', label: 'LLM7 (anon ok)' },
]

const statusDot: Record<string, string> = {
  healthy: 'bg-emerald-500',
  rate_limited: 'bg-amber-500',
  invalid: 'bg-rose-500',
  error: 'bg-rose-500',
  unknown: 'bg-muted-foreground/40',
}

const statusLabel: Record<string, string> = {
  healthy: 'healthy',
  rate_limited: 'rate-limited',
  invalid: 'invalid',
  error: 'error',
  unknown: 'unchecked',
}

const PLATFORM_KEY_HELP: Partial<Record<Platform, string>> = {
  huggingface:
    'Token from huggingface.co/settings/tokens with Inference Providers permission (hf_…).',
  together:
    'API key from api.together.ai/settings/api-keys. Prepaid credits — not an unlimited free tier.',
}

interface HealthPlatform {
  platform: string
  totalKeys: number
  healthyKeys: number
  rateLimitedKeys: number
  invalidKeys: number
  errorKeys: number
  unknownKeys: number
}

interface HealthData {
  platforms: HealthPlatform[]
  keys: { id: number; platform: string; status: string; lastCheckedAt: string | null }[]
}

export default function KeysPage() {
  const queryClient = useQueryClient()
  const [platform, setPlatform] = useState<Platform | ''>('')
  const [apiKey, setApiKey] = useState('')
  const [accountId, setAccountId] = useState('')
  const [label, setLabel] = useState('')

  const { data: keys = [], isLoading } = useQuery<ApiKey[]>({
    queryKey: ['keys'],
    queryFn: () => apiFetch('/api/keys'),
  })

  const { data: healthData } = useQuery<HealthData>({
    queryKey: ['health'],
    queryFn: () => apiFetch('/api/health'),
    refetchInterval: 30000,
  })

  const addKey = useMutation({
    mutationFn: (body: { platform: string; key: string; label?: string }) =>
      apiFetch('/api/keys', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['keys'] })
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['fallback'] })
      setPlatform('')
      setApiKey('')
      setAccountId('')
      setLabel('')
    },
  })

  const deleteKey = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['keys'] })
      queryClient.invalidateQueries({ queryKey: ['health'] })
    },
  })

  const checkAll = useMutation({
    mutationFn: () => apiFetch('/api/health/check-all', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['keys'] })
    },
  })

  const checkKey = useMutation({
    mutationFn: (keyId: number) => apiFetch(`/api/health/check/${keyId}`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['keys'] })
    },
  })

  const needsAccountId = platform === 'cloudflare'

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!platform || !apiKey) return
    if (needsAccountId && !accountId) return
    const key = needsAccountId ? `${accountId}:${apiKey}` : apiKey
    addKey.mutate({ platform, key, label: label || undefined })
  }

  const healthKeyMap = new Map<number, { status: string; lastCheckedAt: string | null }>()
  for (const k of healthData?.keys ?? []) healthKeyMap.set(k.id, k)

  const grouped = PLATFORMS.map(p => ({
    ...p,
    keys: keys.filter(k => k.platform === p.value),
  })).filter(p => p.keys.length > 0)

  return (
    <div>
      <PageHeader
        title="Keys"
        description="Add keys for Groq, Google, Hugging Face, Together AI, and other providers. Client setup lives on the Guides tab."
        actions={
          keys.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => checkAll.mutate()} disabled={checkAll.isPending}>
              {checkAll.isPending ? 'Checking…' : 'Check all'}
            </Button>
          )
        }
      />

      <div className="space-y-8">
        <UnifiedKeySection />

        <section>
          <h2 className="text-sm font-medium mb-3">Add a provider key</h2>
          <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3 rounded-lg border p-4 bg-card">
            <div className="space-y-1.5">
              <Label className="text-xs">Platform</Label>
              <Select value={platform} onValueChange={(v) => setPlatform(v as Platform)}>
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORMS.map(p => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {platform && PLATFORM_KEY_HELP[platform] && (
                <p className="text-[11px] text-muted-foreground max-w-[280px] leading-snug">
                  {PLATFORM_KEY_HELP[platform]}
                </p>
              )}
            </div>
            {needsAccountId && (
              <div className="space-y-1.5">
                <Label className="text-xs">Account ID</Label>
                <Input
                  value={accountId}
                  onChange={e => setAccountId(e.target.value)}
                  placeholder="a1b2c3d4…"
                  className="w-[200px] font-mono text-xs"
                />
              </div>
            )}
            <div className="space-y-1.5 flex-1 min-w-[240px]">
              <Label className="text-xs">{needsAccountId ? 'API token' : 'API key'}</Label>
              <Input
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder={needsAccountId ? 'Bearer token' : 'paste key here'}
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Label</Label>
              <Input
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder="optional"
                className="w-[160px]"
              />
            </div>
            <Button type="submit" size="sm" disabled={!platform || !apiKey || (needsAccountId && !accountId) || addKey.isPending}>
              {addKey.isPending ? 'Adding…' : 'Add key'}
            </Button>
          </form>
          {addKey.isError && (
            <p className="text-destructive text-xs mt-2">{(addKey.error as Error).message}</p>
          )}
        </section>

        <section>
          <h2 className="text-sm font-medium mb-3">Configured providers</h2>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : keys.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <p className="text-sm text-muted-foreground">
                No provider keys yet. Add one above to start routing.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {grouped.map(group => (
                <div key={group.value}>
                  <div className="flex items-baseline justify-between mb-2">
                    <h3 className="text-sm font-medium">{group.label}</h3>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {group.keys.length} key{group.keys.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="rounded-lg border divide-y bg-card overflow-hidden">
                    {group.keys.map(k => {
                      const h = healthKeyMap.get(k.id)
                      const status = h?.status ?? k.status
                      const lastChecked = h?.lastCheckedAt
                      return (
                        <div key={k.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors">
                          <span className={`size-1.5 rounded-full flex-shrink-0 ${statusDot[status] ?? statusDot.unknown}`} />
                          <code className="text-xs font-mono flex-shrink-0">{k.maskedKey}</code>
                          {k.label && <span className="text-xs text-muted-foreground">{k.label}</span>}
                          <span className="text-xs text-muted-foreground">{statusLabel[status] ?? status}</span>
                          <div className="flex-1" />
                          {lastChecked && (
                            <span className="text-[11px] text-muted-foreground tabular-nums">
                              {new Date(lastChecked).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                          <Button variant="ghost" size="xs" onClick={() => checkKey.mutate(k.id)} disabled={checkKey.isPending}>
                            Check
                          </Button>
                          <Button variant="ghost" size="xs" className="text-muted-foreground hover:text-destructive" onClick={() => deleteKey.mutate(k.id)} disabled={deleteKey.isPending}>
                            Remove
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
