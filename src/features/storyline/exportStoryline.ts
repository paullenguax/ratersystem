import JSZip from 'jszip'
import type { StorylineItem, StorylineTest, StorylineTheme, StorylineVersion, StorylinePart, StorylineTemplate, StorylineSlotContent } from '@/types'

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

// Fetches examiner.html (gated into examiner.php)/candidate.html and every
// asset the manifest says they depend on, straight into `zip` at its root —
// shared by exportStorylineVersion() (the legacy one-zip-per-Version path)
// and exportPlayerShell() (the new dynamic-pooling path, where this is
// uploaded once and reused by every candidate instead of once per Version).
async function bundlePlayerShellFiles(zip: JSZip): Promise<void> {
  const manifest = await fetchManifest()
  const assetFiles = collectAssetFiles(manifest, ['examiner.html', 'candidate.html'])
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
}

// Same idea as bundlePlayerShellFiles(), but for the self-service practice
// player (player-src/practice.ts/practice.html) instead of the examiner/
// candidate pair — no PHP gate (no WordPress session/booking hash exists
// for a self-service visitor to be checked against), so this ships as
// plain static files. Written into the zip as story.html, not practice.html
// — matching the filename the old pre-RaterSystemNew Storyline system's
// sample-test exports used, since admins are already used to that name.
async function bundlePracticeShellFiles(zip: JSZip): Promise<void> {
  const manifest = await fetchManifest()
  const assetFiles = collectAssetFiles(manifest, ['practice.html'])
  const filesToFetch = ['practice.html', ...assetFiles]

  for (const name of filesToFetch) {
    const res = await fetch(`${import.meta.env.BASE_URL}player-shell/${name}`)
    if (!res.ok) throw new Error(`Failed to fetch player-shell asset: ${name}`)
    if (name === 'practice.html') {
      zip.file('story.html', await res.text())
    } else {
      zip.file(name, await res.blob())
    }
  }
}

function buildPracticeInstructions(test: StorylineTest, version: StorylineVersion): string {
  return `How to publish "${test.name} — ${version.versionLabel}" as a sample test
${'='.repeat(30 + test.name.length + version.versionLabel.length)}

1. Upload every file in this zip into its own subfolder on the website
   (e.g. /sample/${sanitizeFilename(test.name)}-${sanitizeFilename(version.versionLabel)}/).
   No WordPress install needed — story.html is a plain static page, safe to
   host anywhere.

2. Link to that folder's story.html from your sample-tests landing page
   (e.g. /sample/home.html — see home.html included in this zip for a
   starting point if you don't have one yet). Just add one more <li><a>
   line per sample test you publish.

That's it — story.html plays the test start to finish on its own, in one
window, with no login and nothing to report anywhere. All images and audio
are already bundled into the media/ folder alongside it, so nothing streams
from elsewhere once it's uploaded.

This is deliberately the simple path: no violation tracking, no exposure/
part-counting, no examiner console, no WordPress booking system involved —
that machinery is reserved for versions exported as Live or Backup (see
"How to activate" instructions in that export instead). If this test ever
needs any of that, export it as Live/Backup instead of Practice.
`
}

// A hand-maintained landing page, not something the app regenerates — bundled
// as a starting point the first time, then edited directly on the server by
// hand (add one <li><a> per sample test) exactly like the old pre-
// RaterSystemNew Storyline system's home.html worked. Deliberately not
// wired up to auto-list published Practice versions from Firestore: this
// folder can contain tests from any test type/edition an admin has chosen
// to publish here, in whatever order/grouping they want, which a purely
// generated list can't express as simply as a hand-edited page can.
function buildHomeTemplate(test: StorylineTest, version: StorylineVersion): string {
  const folder = `${sanitizeFilename(test.name)}-${sanitizeFilename(version.versionLabel)}`
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Sample Tests</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 640px; margin: 60px auto; padding: 0 20px; }
    h1 { font-size: 1.5rem; }
    ul { line-height: 2.2; font-size: 1.1rem; }
  </style>
</head>
<body>
  <h1>Choose which sample test to open</h1>
  <ul>
    <!-- Add one line like this per sample test you publish: -->
    <li><a href="./${folder}/story.html">${test.name} — ${version.versionLabel}</a></li>
  </ul>
</body>
</html>
`
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

// Downloads a media URL into `zip` under media/ (deduped by in-flight
// *promise*, not resolved filename — callers can run concurrently against
// the same URL, e.g. a combo-image slide reusing an upload; caching only
// the resolved value would let both pass the dedup check and download/embed
// the same file twice under different names) and returns the local relative
// path to use in its place. Shared by bundleMedia() (resolved StorylineItem
// media, the legacy per-Version export) and bundleSlotContentMedia() (raw
// StorylineSlotContent media, the new per-Test/per-Part exports) — each
// export call creates its own instance, so dedup only ever applies within
// one export, never stale across separate calls.
function createLocalMediaResolver(zip: JSZip) {
  const localPathPromiseByUrl = new Map<string, Promise<string>>()
  let counter = 0
  return function localPathFor(url: string, kind: 'image' | 'audio'): Promise<string> {
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
}

// Downloads every image/audio URL referenced across `items` exactly once
// (multiple slides can reuse the same upload — combo-image slides always
// do, see resolveItems.ts's deriveComboImages), adds each to `zip` under
// media/, and returns a deep copy of `items` with every media URL rewritten
// to that local relative path. Concurrency isn't capped — a version's
// total media count is small (a handful of clips/images per Part), not
// worth the complexity of a queue.
async function bundleMedia(zip: JSZip, items: StorylineItem[]): Promise<StorylineItem[]> {
  const localPathFor = createLocalMediaResolver(zip)

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

// Same idea as bundleMedia() above, but over raw (unresolved)
// StorylineSlotContent instead of resolved StorylineItem media — needed
// because exportStorylineTest()/exportStorylinePart() ship raw slotContent
// for the player to resolve client-side (see player-src/shared/
// resolveItems.ts), not a pre-resolved item list.
async function bundleSlotContentMedia(
  zip: JSZip,
  slotContent: Record<string, StorylineSlotContent>,
): Promise<Record<string, StorylineSlotContent>> {
  const localPathFor = createLocalMediaResolver(zip)

  const entries = await Promise.all(
    Object.entries(slotContent).map(async ([slideId, slot]) => {
      const next: StorylineSlotContent = { ...slot }
      if (slot.images?.length) {
        next.images = await Promise.all(slot.images.map(url => (url ? localPathFor(url, 'image') : url)))
      }
      if (slot.audio) {
        const audio = { ...slot.audio }
        if (audio.intro) audio.intro = await localPathFor(audio.intro, 'audio')
        if (audio.recordings?.length) {
          audio.recordings = await Promise.all(audio.recordings.map(url => (url ? localPathFor(url, 'audio') : url)))
        }
        if (audio.volumeCheck) audio.volumeCheck = await localPathFor(audio.volumeCheck, 'audio')
        next.audio = audio
      }
      return [slideId, next] as const
    }),
  )
  return Object.fromEntries(entries)
}

function downloadZip(zip: JSZip, filename: string): Promise<void> {
  return zip.generateAsync({ type: 'blob' }).then(zipBlob => {
    const url = URL.createObjectURL(zipBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  })
}

export async function exportStorylineVersion(test: StorylineTest, version: StorylineVersion, theme?: StorylineTheme) {
  const zip = new JSZip()
  await bundlePlayerShellFiles(zip)

  const bundledItems = await bundleMedia(zip, version.items)
  zip.file('version.json', JSON.stringify(bundledItems, null, 2))
  // Kept as a separate file from version.json, not a sibling field on it —
  // theme is global template config (see StorylineTheme), not per-item, so
  // an export built before this feature simply has no theme.json at all
  // and the player falls back to its own built-in defaults.
  zip.file('theme.json', JSON.stringify(theme ?? {}, null, 2))
  // Same "separate small file, absent = default" pattern as theme.json —
  // an export built before this feature has no flags.json at all, and the
  // player treats that identically to `{ungated: false}` (full gating,
  // today's only behavior). See StorylineVersion.ungated for what this
  // actually changes in the player.
  zip.file('flags.json', JSON.stringify({ ungated: !!version.ungated }, null, 2))
  zip.file('HOW-TO-ACTIVATE.txt', buildActivationInstructions(test, version))

  await downloadZip(zip, `${sanitizeFilename(test.name)}-${sanitizeFilename(version.versionLabel)}.zip`)
}

// Practice/sample-test export — deliberately the simple counterpart to
// exportStorylineVersion() above. No PHP gate, no flags.json (no gating
// concept at all in practice.ts — see its file header), no WordPress
// involvement whatsoever. Only ever called for versionType === 'practice'
// (StorylineVersionsPage enforces this at the call site) — Live and Backup
// versions keep going through exportStorylineVersion()'s full gated path,
// since that's real proctored-exam machinery this export intentionally
// doesn't carry.
export async function exportStorylinePractice(test: StorylineTest, version: StorylineVersion, theme?: StorylineTheme) {
  const zip = new JSZip()
  await bundlePracticeShellFiles(zip)

  const bundledItems = await bundleMedia(zip, version.items)
  zip.file('version.json', JSON.stringify(bundledItems, null, 2))
  zip.file('theme.json', JSON.stringify(theme ?? {}, null, 2))
  zip.file('HOW-TO-PUBLISH.txt', buildPracticeInstructions(test, version))
  zip.file('home.html', buildHomeTemplate(test, version))

  await downloadZip(zip, `${sanitizeFilename(test.name)}-${sanitizeFilename(version.versionLabel)}-practice.zip`)
}

// --- Dynamic Part-pooling exports (see /home/paul/.claude/plans/
// encapsulated-drifting-corbato.md §2) ---
//
// Instead of one hand-assembled Version exported as one zip, the shell,
// the shared template, each Test's whole-test content, and each Part are
// exported independently — WordPress assigns a candidate's 4 Parts at
// booking time (not built yet — see the plan doc) and the player composes
// the final content client-side from whichever small static fragments that
// assignment points at (player-src/shared/dataSource.ts's loadDynamicItems,
// via a &testId=&p1=&p2=&p3=&p4= launch URL). Each of the 4 functions below
// is uploaded once per publish/re-publish of the thing it exports, not once
// per candidate — the whole point being nothing runs at booking-accept
// time, preserving the same offline-resilience property the original
// per-Version zip had.

// Uploaded once to a fixed WP location (e.g. /tests/player/), re-run only
// when the shell itself is rebuilt/redeployed — not per Test, not per Part.
export async function exportPlayerShell(theme?: StorylineTheme) {
  const zip = new JSZip()
  await bundlePlayerShellFiles(zip)
  zip.file('theme.json', JSON.stringify(theme ?? {}, null, 2))
  await downloadZip(zip, 'player-shell.zip')
}

// Uploaded once to a fixed shared location (e.g. /tests/player/), re-run
// whenever the template changes. A single JSON file, not a zip — the
// template has no media of its own (images/audio live on slotContent, i.e.
// Test/Part content, not the template).
export function exportStorylineTemplate(template: StorylineTemplate) {
  const blob = new Blob([JSON.stringify({ slides: template.slides }, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'template.json'
  a.click()
  URL.revokeObjectURL(url)
}

// The whole-test (partNumber-undefined) slide content half of what
// exportStorylineVersion() used to bundle — uploaded once per Test-content
// publish, to e.g. /tests/player/tests/<testId>/. Ships raw slotContent,
// not a pre-resolved item list: the player already needs template.json raw
// (for previewParts/combo-image derivation against whichever 4 Parts it
// gets), so it's simpler — and avoids reconciling a partial pre-resolve
// against live Part data — to have it run resolveItems() exactly once,
// client-side, over everything together.
export async function exportStorylineTest(test: StorylineTest) {
  const zip = new JSZip()
  const bundledSlotContent = await bundleSlotContentMedia(zip, test.slotContent ?? {})
  const fragment = { name: test.name, variables: test.variables ?? {}, slotContent: bundledSlotContent }
  zip.file('test.json', JSON.stringify(fragment, null, 2))
  await downloadZip(zip, `test-${sanitizeFilename(test.name)}.zip`)
}

// The main workhorse — one already-published Part, exported once, ever,
// per publish/re-publish (~90 times for the initial legacy migration, then
// incrementally after). Uploaded to e.g.
// /tests/player/parts/<partNumber>/<partId>/. Each Part's media now
// downloads/bundles exactly once, permanently — a strict improvement over
// the old per-Version bundleMedia(), which re-downloaded/re-bundled a
// Part's media into every Version that ever referenced it.
export async function exportStorylinePart(part: StorylinePart) {
  const zip = new JSZip()
  const bundledSlotContent = await bundleSlotContentMedia(zip, part.slotContent)
  const fragment = { slotContent: bundledSlotContent }
  zip.file('part.json', JSON.stringify(fragment, null, 2))
  await downloadZip(zip, `part-${part.partNumber}-${sanitizeFilename(part.label)}.zip`)
}
