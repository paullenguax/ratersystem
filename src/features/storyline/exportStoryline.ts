import JSZip from 'jszip'
import type { StorylineTest, StorylineVersion } from '@/types'

// Bundles the built player shell (public/player-shell/, from player-src/ via
// `npm run build:player`) together with this version's item data into a
// downloadable zip — the v1 "publish" artifact an admin manually uploads to
// the WordPress tests folder, pasting the resulting URL into the existing
// TEAC-Plugin admin (see Storyline-Replacement/storyline-replacement-spec.md).
//
// Media stays as live Firebase Storage download-URLs in version.json — no
// re-hosting — matching the already-confirmed "requires a live connection"
// posture (no offline-first support for v1).

interface ManifestChunk {
  file: string
  css?: string[]
  imports?: string[]
}
type Manifest = Record<string, ManifestChunk>

async function fetchManifest(): Promise<Manifest> {
  const res = await fetch(`${import.meta.env.BASE_URL}player-shell/.vite/manifest.json`)
  if (!res.ok) {
    throw new Error('player-shell manifest not found — run `npm run build:player` (or `npm run build`) at least once.')
  }
  return res.json()
}

// Walks the manifest's entry -> imports/css graph to discover every built
// asset file, instead of hardcoding shared-chunk filenames that can change
// between builds.
function collectAssetFiles(manifest: Manifest, entryKeys: string[]): Set<string> {
  const files = new Set<string>()
  function visit(key: string) {
    const chunk = manifest[key]
    if (!chunk || files.has(chunk.file)) return
    files.add(chunk.file)
    chunk.css?.forEach(f => files.add(f))
    chunk.imports?.forEach(visit)
  }
  entryKeys.forEach(visit)
  return files
}

function sanitizeFilename(s: string): string {
  return s.trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '') || 'storyline'
}

export async function exportStorylineVersion(test: StorylineTest, version: StorylineVersion) {
  const manifest = await fetchManifest()
  const assetFiles = collectAssetFiles(manifest, ['examiner.html', 'candidate.html'])

  const zip = new JSZip()
  const filesToFetch = ['examiner.html', 'candidate.html', ...assetFiles]

  for (const name of filesToFetch) {
    const res = await fetch(`${import.meta.env.BASE_URL}player-shell/${name}`)
    if (!res.ok) throw new Error(`Failed to fetch player-shell asset: ${name}`)
    zip.file(name, await res.blob())
  }

  zip.file('version.json', JSON.stringify(version.items, null, 2))

  const zipBlob = await zip.generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(zipBlob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${sanitizeFilename(test.name)}-${sanitizeFilename(version.versionLabel)}.zip`
  a.click()
  URL.revokeObjectURL(url)
}
