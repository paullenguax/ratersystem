import type { Timestamp } from 'firebase/firestore'

export interface Person {
  id: string
  name: string
  email: string
  role: 'admin' | 'senior_rater' | 'trainee'
  status: 'active' | 'inactive' | 'suspended'
  notes?: string
  createdAt?: Timestamp
}

export interface Test {
  id: string
  recordingUrl: string
  candidateName: string
  candidateNationality: string
  testType: 'PPL' | 'Airline Pilot' | 'Helicopter Pilot' | 'Student Pilot' | 'Aerodrome ATC' | 'Approach ATC' | 'Area ATC' | 'Student ATCO' | 'Airport Operations' | 'ADP Driver'
  promptType: 'interview' | 'read-aloud' | 'roleplay'
  durationSeconds?: number
  targetLevel: number
  status: 'active' | 'retired'
  canonicalDifficulty?: number | null
  canonicalSE?: number | null
  notes?: string
  createdAt?: Timestamp
}
