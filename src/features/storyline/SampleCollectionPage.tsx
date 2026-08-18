import { ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Quick-access mirror of whatever's linked from lenguax.com/sample/index.html
// (see sample-site/index.html and buildHomeTemplate() in exportStoryline.ts)
// — hand-maintained here too, same reason: this list reflects whatever an
// admin has actually published to that folder, not something derivable from
// Firestore (a Practice-typed StorylineVersion isn't necessarily uploaded
// yet, and this folder can contain older exports too).
const SAMPLE_TESTS = [
  { label: 'Airline', folder: 'Airline' },
  { label: 'AbI', folder: 'AbI' },
  { label: 'Aerodrome', folder: 'Aerodrome' },
  { label: 'Approach', folder: 'Approach' },
  { label: 'Area', folder: 'Area' },
  { label: 'PPL', folder: 'PPL' },
] as const

const SAMPLE_BASE_URL = 'https://www.lenguax.com/sample'

export function SampleCollectionPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Sample Collection</h1>
        <p className="text-sm text-muted-foreground">
          Quick links to the published sample tests at{' '}
          <a href={`${SAMPLE_BASE_URL}/`} target="_blank" rel="noreferrer" className="underline">
            lenguax.com/sample
          </a>
          , for trying one out without leaving RaterSystem.
        </p>
      </div>

      <div className="rounded-md border divide-y">
        {SAMPLE_TESTS.map(t => (
          <div key={t.folder} className="flex items-center justify-between px-4 py-3">
            <span className="font-medium">{t.label}</span>
            <Button
              variant="outline"
              size="sm"
              render={<a href={`${SAMPLE_BASE_URL}/${t.folder}/story.html`} target="_blank" rel="noreferrer" />}
            >
              <ExternalLink className="size-4 mr-2" /> Open
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
