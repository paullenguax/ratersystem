import { analyze, analyzeDrift, type AnalysisInput } from './analysis'
import type { DriftInput } from './raschData'

// Runs analyses off the main thread so the page stays responsive
export type RaschJob =
  | { id: number; kind: 'analyze'; input: AnalysisInput }
  | { id: number; kind: 'drift'; input: DriftInput }

const ctx = self as unknown as { onmessage: (e: MessageEvent<RaschJob>) => void; postMessage: (m: unknown) => void }

ctx.onmessage = e => {
  const job = e.data
  try {
    const result = job.kind === 'analyze' ? analyze(job.input) : analyzeDrift(job.input)
    ctx.postMessage({ id: job.id, result })
  } catch (err) {
    ctx.postMessage({ id: job.id, error: String(err) })
  }
}
