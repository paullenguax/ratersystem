import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { initializeFirestore } from 'firebase/firestore'
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
// initializeFirestore (not the plain getFirestore) so we can pass
// ignoreUndefinedProperties: true — editor components across the app
// follow a `set(field, value || undefined)` convention to mean "omit this
// optional field when cleared," which produces a literal JS `undefined`
// property. Firestore has no `undefined` type at all (unlike `null`,
// which is a real stored value) and setDoc()/updateDoc() throw
// "Unsupported field value: undefined" the moment one reaches them — this
// flag makes the SDK silently drop such fields instead, which is what
// every one of those call sites actually intended. Must be called before
// any other getFirestore(app) for this app, and only once.
export const db = initializeFirestore(app, { ignoreUndefinedProperties: true })
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
export const benchmarkDb = initializeFirestore(benchmarkApp, { ignoreUndefinedProperties: true })

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
