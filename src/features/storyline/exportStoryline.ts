import JSZip from 'jszip'
import type { StorylineItem, StorylineTest, StorylineTheme, StorylineVersion } from '@/types'

// Bundles the built player shell (public/player-shell/, from player-src/ via
// `npm run build:player`) together with this version's item data into a
// downloadable zip — the artifact an admin manually uploads to the
// WordPress tests folder, then registers as a new wp_teac_test_versions row
// (see Storyline-Replacement/storyline-replacement-spec.md, "Path A"). This
// is deliberately the *only* thing that changes about how a new version
// reaches test centres — WordPress's existing booking/random-assignment/
// exposure-tracking logic needs no changes at all, since it only ever sees
// "a Test_id has a TestUrl," regardless of which tool built the content
// behind it.
//
// Media (images/audio) is downloaded and bundled straight into the zip
// under media/, with version.json rewritten to reference those local
// relative paths instead of the live Firebase Storage URLs — see
// bundleMedia() below. This reverses the original "requires a live
// connection, no offline-first support" decision: once uploaded next to
// examiner.php, every asset a test needs loads same-origin from the WP
// server itself, so a centre losing internet mid-test doesn't lose access
// to already-loaded content (nothing was ever depending on Firebase Storage
// staying reachable during a real sitting in the first place). The player
// itself needed zero changes for this — an <img>/<audio> src doesn't care
// whether it's a relative path or a live URL.
//
// examiner.html gets the same access gate the old Storyline exports had
// prepended by hand (WP session + booking hash + capability check) baked in
// automatically, as examiner.php — this used to be a manual copy-paste step
// per export; automating it removes the one place a busy admin could
// forget it or introduce a typo. candidate.html is left as plain HTML,
// unwrapped: the old Candidate.php was only ever reached via window.open()
// from inside the already-gated examiner session, never navigated to
// directly, so it never needed its own copy of the gate either.
//
// The `../../../wp-load.php` include assumes this ends up 3 folders deep in
// the WordPress install, matching where previous test exports have lived.
// If a version gets placed at a different depth, whoever uploads it needs
// to adjust the number of `../` at the top of examiner.php by hand — see
// HOW-TO-ACTIVATE.txt, bundled in the zip.
const PHP_GATE_HEADER = `<?php
include_once("../../../wp-load.php");
if(
        !array_key_exists("validation",$_SESSION)
        ||!array_key_exists("check",$_GET)
        ||!array_key_exists("id",$_GET)
        ||!array_key_exists("tc",$_GET)
        ||!array_key_exists("in",$_GET)
        ||!array_key_exists("cn",$_GET)
        ||$_SESSION["validation"]!=md5($_GET['check'])
        ||$_GET['check'] != md5(implode("-",array("id"=>$_GET['id'],"tc"=>$_GET['tc'],"in"=>$_GET['in'],"cn"=>$_GET['cn'])))
        ||!current_user_can("administer_tests")
    ) {
    header("Location: ".get_site_url()."/tests/Access-Denied/story.html");
} else {
?>
`

const PHP_GATE_FOOTER = `
<?php } ?>
`

function buildActivationInstructions(test: StorylineTest, version: StorylineVersion): string {
  return `How to activate "${test.name} — ${version.versionLabel}"
${'='.repeat(11 + test.name.length + version.versionLabel.length)}

1. Upload every file in this zip into the WordPress tests folder, in a new
   subfolder (e.g. /tests/${sanitizeFilename(test.name)}-${sanitizeFilename(version.versionLabel)}/) —
   same place previous test exports have lived.

2. Add a new row to wp_teac_test_versions:
     Test_id = the existing Test_id for this test type (e.g. "${test.name}")
     TestUrl = the full URL to examiner.php in the folder you just uploaded
     Active  = true

That's it. The existing booking system will start including this version
in its normal random rotation automatically — no other change is needed,
and nothing about exposure tracking or version selection needs touching.

All images and audio for this test are already bundled into the media/
folder alongside examiner.php — nothing streams from elsewhere once it's
uploaded, so a centre losing internet mid-test won't lose access to
content already on the page.

Note: examiner.php assumes it lives 3 folders deep inside the WordPress
install (matching where previous exports have lived), so it can find
wp-load.php. If this one ends up at a different depth, open examiner.php
and adjust the number of "../" on the first include line to match.
`
}

interface ManifestChunk {
  file: string
  css?: string[]
  assets?: string[]
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
    chunk.assets?.forEach(f => files.add(f))
    chunk.imports?.forEach(visit)
  }
  entryKeys.forEach(visit)
  return files
}

function sanitizeFilename(s: string): string {
  return s.trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '') || 'storyline'
}

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

// Downloads every image/audio URL referenced across `items` exactly once
// (multiple slides can reuse the same upload — combo-image slides always
// do, see resolveItems.ts's deriveComboImages), adds each to `zip` under
// media/, and returns a deep copy of `items` with every media URL rewritten
// to that local relative path. Concurrency isn't capped — a version's
// total media count is small (a handful of clips/images per Part), not
// worth the complexity of a queue.
async function bundleMedia(zip: JSZip, items: StorylineItem[]): Promise<StorylineItem[]> {
  // Keyed by the in-flight *promise*, not the resolved filename — items
  // are processed concurrently below, so two slides sharing one URL (combo-
  // image slides always do) can both reach this before either fetch has
  // resolved. Caching only the resolved value would let both pass the
  // dedup check and download/embed the same file twice under different
  // names; caching the promise itself means the second caller just awaits
  // the first's in-flight fetch instead of starting its own.
  const localPathPromiseByUrl = new Map<string, Promise<string>>()
  let counter = 0

  function localPathFor(url: string, kind: 'image' | 'audio'): Promise<string> {
    const existing = localPathPromiseByUrl.get(url)
    if (existing) return existing
    const promise = (async () => {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Failed to download media for bundling: ${url}`)
      const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
      const ext = EXTENSION_BY_CONTENT_TYPE[contentType] ?? (kind === 'audio' ? 'mp3' : 'jpg')
      const filename = `media/${String(++counter).padStart(3, '0')}.${ext}`
      zip.file(filename, await res.arrayBuffer())
      return filename
    })()
    localPathPromiseByUrl.set(url, promise)
    return promise
  }

  return Promise.all(items.map(async item => {
    if (!item.media) return item
    const media = { ...item.media }
    if (media.images?.length) {
      media.images = await Promise.all(media.images.map(url => localPathFor(url, 'image')))
    }
    if (media.audioClips?.length) {
      media.audioClips = await Promise.all(
        media.audioClips.map(async clip => ({ ...clip, url: await localPathFor(clip.url, 'audio') }))
      )
    }
    return { ...item, media }
  }))
}

export async function exportStorylineVersion(test: StorylineTest, version: StorylineVersion, theme?: StorylineTheme) {
  const manifest = await fetchManifest()
  const assetFiles = collectAssetFiles(manifest, ['examiner.html', 'candidate.html'])

  const zip = new JSZip()
  const filesToFetch = ['examiner.html', 'candidate.html', ...assetFiles]

  for (const name of filesToFetch) {
    const res = await fetch(`${import.meta.env.BASE_URL}player-shell/${name}`)
    if (!res.ok) throw new Error(`Failed to fetch player-shell asset: ${name}`)
    if (name === 'examiner.html') {
      zip.file('examiner.php', PHP_GATE_HEADER + (await res.text()) + PHP_GATE_FOOTER)
    } else {
      zip.file(name, await res.blob())
    }
  }

  const bundledItems = await bundleMedia(zip, version.items)
  zip.file('version.json', JSON.stringify(bundledItems, null, 2))
  // Kept as a separate file from version.json, not a sibling field on it —
  // theme is global template config (see StorylineTheme), not per-item, so
  // an export built before this feature simply has no theme.json at all
  // and the player falls back to its own built-in defaults.
  zip.file('theme.json', JSON.stringify(theme ?? {}, null, 2))
  zip.file('HOW-TO-ACTIVATE.txt', buildActivationInstructions(test, version))

  const zipBlob = await zip.generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(zipBlob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${sanitizeFilename(test.name)}-${sanitizeFilename(version.versionLabel)}.zip`
  a.click()
  URL.revokeObjectURL(url)
}
