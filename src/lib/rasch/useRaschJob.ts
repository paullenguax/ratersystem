import { useEffect, useRef, useState } from 'react'
import type { RaschJob } from './rasch.worker'
import type { RaschAnalysis, DriftRater } from './analysis'

type Job = Omit<RaschJob, 'id'>
type Result<J extends Job> = J['kind'] extends 'analyze' ? RaschAnalysis : DriftRater[]

// Runs a Rasch job in a web worker whenever `job` changes (pass null to skip).
// Stale results from superseded jobs are ignored.
export function useRaschJob<J extends Job>(job: J | null): { data: Result<J> | null; loading: boolean; error: string } {
  const workerRef = useRef<Worker | null>(null)
  const seq = useRef(0)
  const [state, setState] = useState<{ data: Result<J> | null; loading: boolean; error: string }>({ data: null, loading: false, error: '' })

  useEffect(() => {
    const w = new Worker(new URL('./rasch.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = w
    return () => { w.terminate(); workerRef.current = null }
  }, [])

  useEffect(() => {
    const w = workerRef.current
    if (!w || !job) { setState({ data: null, loading: false, error: '' }); return }
    const id = ++seq.current
    setState(s => ({ ...s, loading: true, error: '' }))
    const onMessage = (e: MessageEvent<{ id: number; result?: Result<J>; error?: string }>) => {
      if (e.data.id !== id) return
      setState({ data: e.data.result ?? null, loading: false, error: e.data.error ?? '' })
    }
    w.addEventListener('message', onMessage)
    w.postMessage({ ...job, id })
    return () => w.removeEventListener('message', onMessage)
  }, [job])

  return state
}
