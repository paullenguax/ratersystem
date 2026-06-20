import { ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function CertificatesPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Certificates</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Generate and validate Lenguax certificates.
        </p>
      </div>

      <div className="rounded-lg border p-6 space-y-3 max-w-md">
        <p className="text-sm">
          Certificate generation is currently handled by the standalone tool at lenguax.com.
          Click below to open it.
        </p>
        <Button render={<a href="https://lenguax.com/cert_generator" target="_blank" rel="noreferrer" />}>
          <ExternalLink className="size-4 mr-2" />
          Open Certificate Generator
        </Button>
      </div>
    </div>
  )
}
