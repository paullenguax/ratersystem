import { useState } from 'react'
import { ref, listAll, uploadBytes, getDownloadURL } from 'firebase/storage'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { storage, db } from '@/lib/firebase'
import { CheckCircle2, Upload, RefreshCw, ExternalLink } from 'lucide-react'

// ─── Language metadata (mirrors GPronTool/src/languages.js) ─────────────────
// Update this list when adding/removing languages in GPronTool.
const LANGUAGES: { code: string; name: string; flag: string }[] = [
  { code: 'english',           name: 'English (British RP)',       flag: '🇬🇧' },
  { code: 'american_english',  name: 'English (General American)', flag: '🇺🇸' },
  { code: 'australian_english',name: 'English (General Australian)',flag: '🇦🇺' },
  { code: 'spanish',           name: 'Spanish (Castilian)',         flag: '🇪🇸' },
  { code: 'french',            name: 'French (Parisian)',           flag: '🇫🇷' },
  { code: 'italian',           name: 'Italian (Standard)',          flag: '🇮🇹' },
  { code: 'turkish',           name: 'Turkish',                    flag: '🇹🇷' },
  { code: 'russian',           name: 'Russian',                    flag: '🇷🇺' },
  { code: 'portuguese',        name: 'Portuguese (Brazilian)',      flag: '🇧🇷' },
  { code: 'mandarin',          name: 'Mandarin Chinese',           flag: '🇨🇳' },
  { code: 'japanese',          name: 'Japanese (Tokyo)',            flag: '🇯🇵' },
  { code: 'arabic',            name: 'Arabic (MSA)',               flag: '🇸🇦' },
  { code: 'hindi',             name: 'Hindi (Standard)',            flag: '🇮🇳' },
  { code: 'korean',            name: 'Korean (Seoul)',              flag: '🇰🇷' },
]

type Voice = 'male' | 'female'

// ─── Language Toggles ────────────────────────────────────────────────────────
function LanguageToggles() {
  const qc = useQueryClient()

  const { data: status = {}, isLoading } = useQuery({
    queryKey: ['pron-status'],
    queryFn: async () => {
      const snap = await getDoc(doc(db, 'pronunciation_config', 'status'))
      return snap.exists() ? (snap.data() as Record<string, string>) : {}
    },
  })

  const toggle = async (code: string) => {
    const current = (status as Record<string, string>)[code] ?? 'active'
    const next = current === 'active' ? 'coming_soon' : 'active'
    await setDoc(
      doc(db, 'pronunciation_config', 'status'),
      { ...status, [code]: next },
      { merge: true }
    )
    qc.invalidateQueries({ queryKey: ['pron-status'] })
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground mb-4">
        Controls which languages appear as active on{' '}
        <a href="https://lenguax.com/pronunciation/" target="_blank" rel="noreferrer" className="underline">
          lenguax.com/pronunciation
        </a>.
        Changes take effect immediately.
      </p>
      {LANGUAGES.map(({ code, name, flag }) => {
        const s = (status as Record<string, string>)[code] ?? 'active'
        const active = s !== 'coming_soon'
        return (
          <div key={code} className="flex items-center justify-between p-3 rounded-lg border">
            <div className="flex items-center gap-2">
              <span className="text-xl">{flag}</span>
              <span className="text-sm font-medium">{name}</span>
              <span className="text-xs text-muted-foreground font-mono">({code})</span>
            </div>
            <button
              onClick={() => void toggle(code)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                active
                  ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
                  : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
              }`}
            >
              {active ? 'Active' : 'Coming soon'}
            </button>
          </div>
        )
      })}
    </div>
  )
}

// ─── Audio Manager ───────────────────────────────────────────────────────────
// Lists files in Firebase Storage phoneme-audio/ and allows direct upload.
// Filter by language prefix to see what's present.

interface StorageFile {
  name: string
  path: string
}

function AudioManager() {
  const [filterLang, setFilterLang] = useState('')
  const [filterVoice, setFilterVoice] = useState<Voice | ''>('')
  const [uploading, setUploading] = useState<string | null>(null)
  const qc = useQueryClient()

  const { data: files = [], isLoading, isFetching } = useQuery<StorageFile[]>({
    queryKey: ['pron-audio-files'],
    queryFn: async () => {
      const result = await listAll(ref(storage, 'phoneme-audio'))
      return result.items.map(item => ({ name: item.name, path: item.fullPath }))
    },
    staleTime: 30_000,
  })

  const handleUpload = async (uploadFile: File) => {
    const name = uploadFile.name
    setUploading(name)
    try {
      await uploadBytes(ref(storage, `phoneme-audio/${name}`), uploadFile)
      qc.invalidateQueries({ queryKey: ['pron-audio-files'] })
    } finally {
      setUploading(null)
    }
  }

  const filtered = files.filter(f => {
    if (filterLang && !f.name.startsWith(filterLang + '-')) return false
    if (filterVoice && !f.name.endsWith(`-${filterVoice}.mp3`)) return false
    return true
  })

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Files are stored at <code className="text-xs bg-muted px-1 rounded">phoneme-audio/</code> in Firebase Storage
        using the convention <code className="text-xs bg-muted px-1 rounded">{'{lang}-{type}-{ipa}-{voice}.mp3'}</code>.
      </p>

      {/* Filters + upload */}
      <div className="flex gap-3 flex-wrap items-center">
        <select
          value={filterLang}
          onChange={e => setFilterLang(e.target.value)}
          className="border rounded-lg px-3 py-1.5 text-sm bg-background"
        >
          <option value="">All languages</option>
          {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.flag} {l.name}</option>)}
        </select>

        <div className="flex rounded-lg overflow-hidden border">
          {(['', 'female', 'male'] as const).map(v => (
            <button
              key={v}
              onClick={() => setFilterVoice(v)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                filterVoice === v ? 'bg-sky-600 text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {v === '' ? 'Both' : v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>

        <button
          onClick={() => qc.invalidateQueries({ queryKey: ['pron-audio-files'] })}
          disabled={isFetching}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border hover:bg-muted transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </button>

        <label className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-sky-600 text-white hover:bg-sky-700 cursor-pointer transition-colors">
          <Upload className="w-3.5 h-3.5" />
          {uploading ? `Uploading ${uploading}…` : 'Upload MP3'}
          <input
            type="file"
            accept="audio/mpeg,.mp3"
            multiple
            className="hidden"
            onChange={e => {
              if (!e.target.files) return
              void Promise.all(Array.from(e.target.files).map(handleUpload))
            }}
          />
        </label>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!isLoading && (
        <div>
          <p className="text-xs text-muted-foreground mb-2">
            Showing {filtered.length} of {files.length} files
          </p>
          <div className="border rounded-lg divide-y max-h-[500px] overflow-y-auto">
            {filtered.length === 0 && (
              <p className="text-sm text-muted-foreground p-4 text-center">No files found</p>
            )}
            {filtered.map(f => (
              <AudioFileRow key={f.name} file={f} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function AudioFileRow({ file }: { file: StorageFile }) {
  const [url, setUrl] = useState<string | null>(null)

  const handlePlay = async () => {
    if (!url) {
      const u = await getDownloadURL(ref(storage, file.path))
      setUrl(u)
    }
    new Audio(url || await getDownloadURL(ref(storage, file.path))).play()
  }

  // Derive metadata from filename: {lang}-{type}-{ipa}-{voice}.mp3
  const parts = file.name.replace('.mp3', '').split('-')
  const voice = parts[parts.length - 1]

  return (
    <div className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/40">
      <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
      <span className="font-mono text-xs text-muted-foreground flex-1 min-w-0 truncate">{file.name}</span>
      <span className={`text-xs px-1.5 py-0.5 rounded-full ${voice === 'female' ? 'bg-pink-50 text-pink-700' : 'bg-blue-50 text-blue-700'}`}>
        {voice}
      </span>
      <button
        onClick={() => void handlePlay()}
        className="text-xs text-sky-600 hover:underline flex-shrink-0"
      >
        ▶ play
      </button>
    </div>
  )
}

// ─── Script Generator ────────────────────────────────────────────────────────
// The voice actor script is generated by GPronTool's CLI:
//   node make_voice_recording_pack.js --lang english --voice female
// This tab provides instructions and lets you download pre-generated scripts
// once audio is recorded and uploaded via the Audio Manager tab.

function ScriptGenerator() {
  const [selectedLang, setSelectedLang] = useState('')
  const [voice, setVoice] = useState<Voice>('female')

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Voice actor scripts are generated by the GPronTool CLI tool on your machine.
        Run the command below, then send the <code className="text-xs bg-muted px-1 rounded">.txt</code> file
        to the voice actor and upload the returned MP3s using the Audio Manager tab.
      </p>

      <div className="flex gap-3 flex-wrap">
        <select
          value={selectedLang}
          onChange={e => setSelectedLang(e.target.value)}
          className="border rounded-lg px-3 py-1.5 text-sm bg-background"
        >
          <option value="">Select language…</option>
          {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.flag} {l.name}</option>)}
        </select>

        <div className="flex rounded-lg overflow-hidden border">
          {(['female', 'male'] as Voice[]).map(v => (
            <button
              key={v}
              onClick={() => setVoice(v)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors capitalize ${
                voice === v ? 'bg-sky-600 text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {selectedLang && (
        <div className="rounded-lg border bg-muted/40 p-4 space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Run this in your terminal</p>
          <pre className="text-sm font-mono bg-gray-900 text-green-400 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">
{`cd ~/Programs/GPronTool
node make_voice_recording_pack.js --lang ${selectedLang} --voice ${voice}`}
          </pre>
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>This creates two files in ~/Programs/GPronTool/:</p>
            <ul className="list-disc list-inside space-y-0.5 text-xs font-mono">
              <li>voice_actor_script.txt — send this to the voice actor</li>
              <li>filenames_for_upload.csv — your reference for uploading MP3s</li>
            </ul>
          </div>
          <p className="text-sm text-muted-foreground">
            Once you have the MP3s back, upload them in the{' '}
            <strong>Audio Manager</strong> tab above.
          </p>
        </div>
      )}

      <div className="rounded-lg border p-4 space-y-2">
        <div className="flex items-center gap-2">
          <ExternalLink className="w-4 h-4 text-muted-foreground" />
          <p className="text-sm font-medium">Firebase Storage rules</p>
        </div>
        <p className="text-xs text-muted-foreground">
          Make sure the <code className="bg-muted px-1 rounded">phoneme-audio/</code> path has public read access so
          the pronunciation app can fetch audio without auth. In the Firebase Console → Storage → Rules:
        </p>
        <pre className="text-xs font-mono bg-gray-900 text-green-400 rounded-lg p-3 overflow-x-auto">
{`match /phoneme-audio/{file} {
  allow read;
}`}
        </pre>
      </div>
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

const TABS = ['Languages', 'Audio Manager', 'Script Generator'] as const
type Tab = typeof TABS[number]

export function PronunciationAdminPage() {
  const [tab, setTab] = useState<Tab>('Languages')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Pronunciation Tool Admin</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage languages, audio files, and voice actor packs for{' '}
          <a href="https://lenguax.com/pronunciation/" target="_blank" rel="noreferrer" className="underline inline-flex items-center gap-1">
            lenguax.com/pronunciation <ExternalLink className="w-3 h-3" />
          </a>
        </p>
      </div>

      <div className="flex border-b border-border">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? 'border-sky-600 text-sky-700'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div>
        {tab === 'Languages'        && <LanguageToggles />}
        {tab === 'Audio Manager'    && <AudioManager />}
        {tab === 'Script Generator' && <ScriptGenerator />}
      </div>
    </div>
  )
}
