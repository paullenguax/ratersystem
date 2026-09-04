import { ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Quick-access mirror of whatever's linked from lenguax.com/sample/index.html
// (see sample-site/index.html and buildHomeTemplate() in exportStoryline.ts)
// — hand-maintained here too, same reason: this list reflects whatever an
// admin has actually published to that folder, not something derivable from
// Firestore (a Practice-typed StorylineVersion isn't necessarily uploaded
// yet, and this folder can contain older exports too).
//
// `kind: 'practice'` — the plain, ungated candidate-facing samples ("try the
// format before your real test"). `kind: 'training'` — a "Training run"
// export (see exportStorylinePractice()'s trainingRun option): pre-test
// screens kept and gated, audio must play to the end, booking identity
// baked in (SALLY SMITH / Lenguax Centre / SAMPLE 001). Built for
// familiarising interlocutors with the new console and for real-candidate
// sample gathering — a different audience/purpose from the plain samples,
// so it's listed separately rather than folded into the same group.
const SAMPLE_TESTS = [
  { label: 'Airline', folder: 'Airline', kind: 'practice' },
  { label: 'AbI', folder: 'AbI', kind: 'practice' },
  { label: 'Aerodrome', folder: 'Aerodrome', kind: 'practice' },
  { label: 'Approach', folder: 'Approach', kind: 'practice' },
  { label: 'Area', folder: 'Area', kind: 'practice' },
  { label: 'PPL', folder: 'PPL', kind: 'practice' },
  { label: 'Airline', folder: 'Airline-Training', kind: 'training' },
] as const

const SAMPLE_BASE_URL = 'https://www.lenguax.com/sample'

function SampleGroup({ items }: { items: readonly (typeof SAMPLE_TESTS)[number][] }) {
  return (
    <div className="rounded-md border divide-y">
      {items.map(t => (
        <div key={`${t.kind}-${t.folder}`} className="flex items-center justify-between px-4 py-3">
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
  )
}

export function SampleCollectionPage() {
  const practice = SAMPLE_TESTS.filter(t => t.kind === 'practice')
  const training = SAMPLE_TESTS.filter(t => t.kind === 'training')

  return (
    <div className="space-y-6">
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

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">Practice samples</h2>
        <p className="text-xs text-muted-foreground">
          Plain, ungated — for a candidate trying the format before their real test.
        </p>
        <SampleGroup items={practice} />
      </div>

      {training.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Training runs</h2>
          <p className="text-xs text-muted-foreground">
            Dressed up to feel like a real sitting — pre-test screens, play-to-the-end
            audio, pre-filled booking details. For familiarising interlocutors with the
            console and for real-candidate sample gathering. Still records nothing.
          </p>
          <SampleGroup items={training} />
        </div>
      )}
    </div>
  )
}
