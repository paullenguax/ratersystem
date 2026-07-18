import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'
import { getFunctions } from 'firebase/functions'

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
export const storage = getStorage(app)
export const functions = getFunctions(app)

const benchmarkConfig = {
  apiKey:            import.meta.env.VITE_BENCHMARK_API_KEY,
  authDomain:        import.meta.env.VITE_BENCHMARK_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_BENCHMARK_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_BENCHMARK_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_BENCHMARK_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_BENCHMARK_APP_ID,
}

const benchmarkApp = initializeApp(benchmarkConfig, 'benchmark')
export const benchmarkDb = getFirestore(benchmarkApp)

// getAuth() validates the API key format synchronously and throws if it's
// missing/malformed — unlike getFirestore/getStorage, which stay lazy until
// first use. This app config is a secondary, optional integration (the
// Benchmark admin tab), so a bad VITE_BENCHMARK_* value must not be able to
// take down every other page in the app.
export let benchmarkAuth: ReturnType<typeof getAuth> | undefined
export let benchmarkStorage: ReturnType<typeof getStorage> | undefined
try {
  benchmarkAuth = getAuth(benchmarkApp)
  benchmarkStorage = getStorage(benchmarkApp)
} catch (err) {
  console.error('Benchmark Firebase app failed to initialize — check VITE_BENCHMARK_* env vars:', err)
}
