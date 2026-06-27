import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'
import { getFunctions } from 'firebase/functions'

const firebaseConfig = {
  apiKey: 'AIzaSyDBVB-gdCCd4iLlq7oIRtxWKAjPXGfK3tc',
  authDomain: 'ratersystem.firebaseapp.com',
  projectId: 'ratersystem',
  storageBucket: 'ratersystem.firebasestorage.app',
  messagingSenderId: '6406948731',
  appId: '1:6406948731:web:7b269951ffe2fe57d61fde',
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
export const storage = getStorage(app)
export const functions = getFunctions(app)

const benchmarkConfig = {
  apiKey: 'AIzaSyARP1AErdsWl3GBjIScdbQWX4rNre5fU30',
  authDomain: 'lenguax-benchmark-32392.firebaseapp.com',
  projectId: 'lenguax-benchmark-32392',
  storageBucket: 'lenguax-benchmark-32392.firebasestorage.app',
  messagingSenderId: '665162910038',
  appId: '1:665162910038:web:9442ea8f7b1b666e34eef7',
}

const benchmarkApp = initializeApp(benchmarkConfig, 'benchmark')
export const benchmarkDb = getFirestore(benchmarkApp)
