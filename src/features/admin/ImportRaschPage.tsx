import { useState } from 'react'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { BarChart2 } from 'lucide-react'
import { db } from '@/lib/firebase'
import { parseFacetsOutput, type RaschRun } from '@/lib/parseFacets'
import { Button } from '@/components/ui/button'

export function ImportRaschPage() {
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<RaschRun | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  function handleParse() {
    setError('')
    setSaved(false)
    try {
      const result = parseFacetsOutput(text)
      if (result.raters.length === 0) {
        setError('No rater rows found. Make sure the text includes Table 7 from the Facets output.')
        setParsed(null)
      } else {
        setParsed(result)
      }
    } catch (e) {
      setError(String(e))
      setParsed(null)
    }
  }

  async function handleSave() {
    if (!parsed) return
    setSaving(true)
    try {
      await addDoc(collection(db, 'rasch_runs'), {
        importedAt: serverTimestamp(),
        raterCount: parsed.raters.length,
        meanMeasure: parsed.meanMeasure,
        reliability: parsed.reliability,
        separation: parsed.separation,
        rmse: parsed.rmse,
        raters: parsed.raters,
        criteria: parsed.criteria,
        candidateDensity: parsed.candidateDensity,
      })
      setSaved(true)
      setText('')
      setParsed(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold">Import Rasch Results</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Paste the full Facets <code>.out</code> file. Table 7 (rater measures) and Table 6 (Wright map) will be extracted.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Facets output</label>
        <textarea
          value={text}
          onChange={e => { setText(e.target.value); setParsed(null); setSaved(false) }}
          placeholder="Paste the full contents of the .out file here…"
          rows={12}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-y"
        />
      </div>

      <Button onClick={handleParse} disabled={!text.trim()}>
        <BarChart2 className="size-4 mr-2" />
        Parse file
      </Button>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {parsed && (
        <div className="space-y-4">
          <div className="rounded-lg border p-4 space-y-3">
            <p className="text-sm font-medium">Parsed successfully</p>
            <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Raters found</span>
                <span className="font-mono font-semibold">{parsed.raters.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Criteria found</span>
                <span className="font-mono font-semibold">{parsed.criteria.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Mean measure</span>
                <span className="font-mono">{parsed.meanMeasure.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Reliability</span>
                <span className="font-mono">{parsed.reliability.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Separation</span>
                <span className="font-mono">{parsed.separation.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">RMSE</span>
                <span className="font-mono">{parsed.rmse.toFixed(2)}</span>
              </div>
            </div>

            {parsed.criteria.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Criteria calibrations</p>
                <div className="flex flex-wrap gap-2">
                  {parsed.criteria.map(c => (
                    <span key={c.name} className="text-xs border rounded px-2 py-0.5 font-mono">
                      {c.name} {c.logit > 0 ? '+' : ''}{c.logit.toFixed(0)}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {parsed.raters.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">
                  Sample — first 5 raters by number
                </p>
                <div className="rounded border overflow-x-auto">
                  <table className="text-xs w-full">
                    <thead className="bg-muted/40 border-b">
                      <tr>
                        <th className="px-2 py-1 text-left font-medium">#</th>
                        <th className="px-2 py-1 text-left font-medium">Name</th>
                        <th className="px-2 py-1 text-right font-medium">Measure</th>
                        <th className="px-2 py-1 text-right font-medium">SE</th>
                        <th className="px-2 py-1 text-right font-medium">Infit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.raters.slice(0, 5).map(r => (
                        <tr key={r.raterNumber} className="border-t">
                          <td className="px-2 py-1 font-mono">{r.raterNumber}</td>
                          <td className="px-2 py-1">{r.raterName}</td>
                          <td className="px-2 py-1 text-right font-mono">{r.measure.toFixed(2)}</td>
                          <td className="px-2 py-1 text-right font-mono">{r.se.toFixed(2)}</td>
                          <td className="px-2 py-1 text-right font-mono">{r.infitMnSq.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-3 items-center">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save to Firestore'}
            </Button>
            {saved && <p className="text-sm text-green-700">Saved. Reports page will now show Wright maps.</p>}
          </div>
        </div>
      )}
    </div>
  )
}
