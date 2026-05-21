import { PageHeader } from '@/components/page-header'
import { IntegrationsGuide } from '@/components/integrations-guide'
import { UnifiedKeySection } from '@/components/unified-key-section'

export default function GuidesPage() {
  return (
    <div>
      <PageHeader
        title="Guides"
        description="VS Code and OpenAI-compatible clients use your local proxy. Claude Code and Codex guides restore factory Anthropic/OpenAI settings."
      />

      <div className="space-y-8">
        <UnifiedKeySection />
        <IntegrationsGuide />
      </div>
    </div>
  )
}
