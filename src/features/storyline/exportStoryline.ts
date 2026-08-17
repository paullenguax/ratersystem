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
// candidate.html ships alongside it unchanged — practice.ts opens a real
// second window with it (same as the real exam), reused as-is since it
// has no WordPress calls or violation reporting of its own to strip.
async function bundlePracticeShellFiles(zip: JSZip): Promise<void> {
  const manifest = await fetchManifest()
  const assetFiles = collectAssetFiles(manifest, ['practice.html', 'candidate.html'])
  const filesToFetch = ['practice.html', 'candidate.html', ...assetFiles]

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
//
// "Flight Strip" design — each linked test reads like an ATC flight
// progress strip (colored tab, plain-text link, generated arrow), styled
// after the physical strips controllers use, since most candidates here
// are pilots/ATCOs. The Lenguax mark is embedded as base64 so the page
// stays one self-contained file with nothing else to lose when it's copied
// around by hand. HOME_SHELL_HEAD/FOOT wrap whatever <li><a> lines go
// between them, so the one generated line and a hand-maintained master
// index.html (built from the same shell) never visually drift apart.
const HOME_LOGO_BASE64 = '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'

const HOME_SHELL_HEAD = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Sample Tests</title>
  <style>
    :root {
      --bg: #eef5fb;
      --surface: #ffffff;
      --surface-2: #e3edf6;
      --ink: #0f2a44;
      --ink-muted: #52708c;
      --blue: #00528c;
      --blue-deep: #073a61;
      --amber: #b8721a;
      --rule: #c7dbe9;
      --shadow: rgba(7, 58, 97, 0.08);
    }
    @media (prefers-color-scheme: dark) {
      :root:not([data-theme="light"]) {
        --bg: #0a1420; --surface: #111e2f; --surface-2: #17293d;
        --ink: #dce8f2; --ink-muted: #8ba3ba; --blue: #4fa3da;
        --blue-deep: #2e6fa0; --amber: #e8a33d; --rule: #223349;
        --shadow: rgba(0, 0, 0, 0.35);
      }
    }
    :root[data-theme="dark"] {
      --bg: #0a1420; --surface: #111e2f; --surface-2: #17293d;
      --ink: #dce8f2; --ink-muted: #8ba3ba; --blue: #4fa3da;
      --blue-deep: #2e6fa0; --amber: #e8a33d; --rule: #223349;
      --shadow: rgba(0, 0, 0, 0.35);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; background: var(--bg); color: var(--ink);
      font-family: "Segoe UI", ui-sans-serif, system-ui, -apple-system, sans-serif;
      font-variant-numeric: tabular-nums; -webkit-font-smoothing: antialiased;
    }
    .page { max-width: 720px; margin: 0 auto; padding: clamp(32px, 6vw, 72px) 24px 96px; }
    header { position: relative; padding: 8px 4px 28px; }
    header::before, header::after {
      content: ""; position: absolute; top: 0; width: 14px; height: 14px;
      border-top: 1.5px solid var(--rule);
    }
    header::before { left: 0; border-left: 1.5px solid var(--rule); }
    header::after { right: 0; border-right: 1.5px solid var(--rule); }
    .brandmark { display: block; width: 40px; height: 40px; margin: 0 0 20px; border-radius: 8px; }
    .eyebrow {
      display: flex; align-items: center; gap: 10px;
      font-family: ui-monospace, "SF Mono", "Cascadia Code", "JetBrains Mono", Menlo, Consolas, monospace;
      font-size: 0.78rem; letter-spacing: 0.16em; text-transform: uppercase;
      color: var(--amber); margin: 0 0 16px;
    }
    .eyebrow::before {
      content: ""; display: inline-block; width: 7px; height: 7px; border-radius: 50%;
      background: var(--amber); box-shadow: 0 0 0 3px color-mix(in srgb, var(--amber) 20%, transparent);
    }
    h1 {
      font-family: Georgia, "Iowan Old Style", "Palatino Linotype", ui-serif, serif;
      font-weight: 400; font-size: clamp(2rem, 5vw, 2.75rem); line-height: 1.15;
      letter-spacing: -0.01em; margin: 0 0 14px; text-wrap: balance; color: var(--blue-deep);
    }
    .lede { max-width: 46ch; font-size: 1.05rem; line-height: 1.6; color: var(--ink-muted); margin: 0; }
    .rule { border: none; border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); height: 3px; margin: 8px 0 36px; }
    .board-label {
      font-family: ui-monospace, "SF Mono", "Cascadia Code", "JetBrains Mono", Menlo, Consolas, monospace;
      font-size: 0.72rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink-muted); margin: 0 0 12px 4px;
    }
    ul.strip-board { list-style: none; margin: 0 0 48px; padding: 0; display: flex; flex-direction: column; gap: 10px; }
    .strip-board li {
      border-radius: 3px; background: var(--surface); box-shadow: 0 1px 2px var(--shadow);
      border-left: 4px solid var(--blue); transition: border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
    }
    .strip-board a {
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
      padding: 18px 22px; text-decoration: none; color: var(--ink);
      font-size: 1.05rem; font-weight: 600; letter-spacing: 0.005em;
    }
    /* The arrow is generated, not typed — every hand-added <li><a> line stays
       plain text, no markup to get wrong when copying a new one in. */
    .strip-board a::after {
      content: "\\2192";
      font-family: ui-monospace, "SF Mono", "Cascadia Code", "JetBrains Mono", Menlo, Consolas, monospace;
      color: var(--amber); font-weight: 400; flex: none; transition: transform 0.18s ease;
    }
    .strip-board li:hover, .strip-board a:focus-visible { border-left-color: var(--amber); }
    .strip-board li:hover { background: var(--surface-2); box-shadow: 0 2px 8px var(--shadow); }
    .strip-board a:focus-visible { outline: 2px solid var(--amber); outline-offset: -2px; border-radius: 2px; }
    .strip-board li:hover a::after, .strip-board a:focus-visible::after { transform: translateX(4px); }
    @media (prefers-reduced-motion: reduce) {
      .strip-board li, .strip-board a::after { transition: none; }
    }
    footer {
      display: flex; align-items: baseline; justify-content: space-between; gap: 16px;
      padding-top: 20px; border-top: 1px solid var(--rule);
      font-family: ui-monospace, "SF Mono", "Cascadia Code", "JetBrains Mono", Menlo, Consolas, monospace;
      font-size: 0.72rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-muted);
    }
    footer strong { color: var(--blue); font-weight: 600; }
    @media (max-width: 480px) { .strip-board a { font-size: 0.98rem; padding: 16px 18px; } }
  </style>
</head>
<body>
  <div class="page">
    <header>
      <img class="brandmark" src="data:image/png;base64,${HOME_LOGO_BASE64}" alt="Lenguax" />
      <p class="eyebrow">TEAC &middot; Sample Test Board</p>
      <h1>Choose a sample test to try</h1>
      <p class="lede">
        Each link below opens a full sample test in one window — no login,
        no booking, nothing to install. Play through it at your own pace to
        get familiar with the format before your real test.
      </p>
    </header>

    <hr class="rule" />

    <p class="board-label">Available now</p>
    <ul class="strip-board">
`

const HOME_SHELL_FOOT = `    </ul>

    <footer>
      <span>Test of English for Aeronautical Communication</span>
      <strong>Lenguax</strong>
    </footer>
  </div>
</body>
</html>
`

function buildHomeTemplate(test: StorylineTest, version: StorylineVersion): string {
  const folder = `${sanitizeFilename(test.name)}-${sanitizeFilename(version.versionLabel)}`
  const line = `      <!-- Add one line like this per sample test you publish: -->\n      <li><a href="./${folder}/story.html">${test.name} &mdash; ${version.versionLabel}</a></li>\n`
  return HOME_SHELL_HEAD + line + HOME_SHELL_FOOT
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
