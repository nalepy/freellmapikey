import { PageHeader } from '@/components/page-header'
import { IntegrationsGuide } from '@/components/integrations-guide'
import { UnifiedKeySection } from '@/components/unified-key-section'

export default function GuidesPage() {
  return (
    <div>
      <PageHeader
        title="Guides"
        description="Client setup for local proxy and factory rollback — VS Code, Claude Code CLI, Codex, and OpenAI SDK."
      />

      <div className="space-y-8">
        <UnifiedKeySection />
        <IntegrationsGuide />
      </div>
    </div>
  )
}
