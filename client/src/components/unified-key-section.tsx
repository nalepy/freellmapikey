import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api'
import { getOpenAiBaseUrl } from '@/lib/proxy-url'

export function UnifiedKeySection() {
  const queryClient = useQueryClient()
  const [showKey, setShowKey] = useState(false)
  const [copied, setCopied] = useState(false)

  const { data } = useQuery<{ apiKey: string }>({
    queryKey: ['unified-key'],
    queryFn: () => apiFetch('/api/settings/api-key'),
  })

  const regenerate = useMutation({
    mutationFn: () => apiFetch('/api/settings/api-key/regenerate', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['unified-key'] }),
  })

  const apiKey = data?.apiKey ?? ''
  const masked = apiKey ? apiKey.slice(0, 13) + '•'.repeat(32) : '…'
  const baseUrl = getOpenAiBaseUrl()

  function copy() {
    navigator.clipboard.writeText(apiKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <section className="rounded-lg border bg-card p-5">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <h2 className="text-sm font-medium">Your unified API key</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            One key for Continue, Cline, the OpenAI SDK, Cursor, and other OpenAI-compatible clients (
            <code className="font-mono">api_key</code> at the base URL below). Claude Code and Codex stay on factory
            Anthropic/OpenAI sign-in — see restore guides on this tab.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => regenerate.mutate()}
          disabled={regenerate.isPending}
        >
          Regenerate
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <code className="flex-1 font-mono text-xs bg-muted px-3 py-2 rounded-md select-all truncate tabular-nums">
          {showKey ? apiKey : masked}
        </code>
        <Button variant="outline" size="sm" onClick={() => setShowKey(!showKey)}>
          {showKey ? 'Hide' : 'Show'}
        </Button>
        <Button variant="outline" size="sm" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>

      <div className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
        <span className="text-muted-foreground">Base URL</span>
        <code className="font-mono">{baseUrl}</code>
        <span className="text-muted-foreground">Endpoints</span>
        <span className="font-mono text-[11px] leading-relaxed">
          /v1/chat/completions (primary) · /v1/messages · /v1/responses (advanced; not used by IDE guides here)
        </span>
      </div>
    </section>
  )
}
