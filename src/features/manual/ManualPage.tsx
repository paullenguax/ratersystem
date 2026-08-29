import { useMemo } from 'react'
import { NavLink, useParams, Navigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useAuth, type Role } from '@/context/AuthContext'

// Content lives in /docs/manual/*.md — plain Markdown, editable in a PR and
// readable straight on GitHub. This page just renders it. To add a section:
// drop a new .md file in that folder and add a row to SECTIONS below.
const FILES = import.meta.glob('/docs/manual/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

interface Section {
  slug: string
  title: string
  file: string
  roles: Role[] | 'all'
}

// Order here is the order in the sidebar.
const SECTIONS: Section[] = [
  { slug: 'overview', title: 'Overview', file: 'overview.md', roles: 'all' },
  { slug: 'dashboard', title: 'Dashboard', file: 'dashboard.md', roles: 'all' },
  { slug: 'scoring', title: 'Scoring', file: 'scoring.md', roles: ['admin', 'senior_rater', 'trainee'] },
  { slug: 'standardization', title: 'Standardization', file: 'standardization.md', roles: ['admin', 'senior_rater', 'trainee', 'examiner'] },
  { slug: 'sample-collection', title: 'Sample Collection', file: 'sample-collection.md', roles: ['admin', 'senior_rater', 'trainee'] },
  { slug: 'feedback-reports', title: 'Feedback Reports', file: 'feedback-reports.md', roles: ['admin', 'senior_rater'] },
  { slug: 'people', title: 'People', file: 'people.md', roles: ['admin'] },
  { slug: 'test-bank', title: 'Test Bank', file: 'test-bank.md', roles: ['admin'] },
  { slug: 'events-sessions', title: 'Events (Sessions)', file: 'events-sessions.md', roles: ['admin'] },
  { slug: 'assignments', title: 'Assignments', file: 'assignments.md', roles: ['admin'] },
  { slug: 'scores', title: 'Scores', file: 'scores.md', roles: ['admin'] },
  { slug: 'statistics', title: 'Statistics', file: 'statistics.md', roles: ['admin'] },
  { slug: 'reports', title: 'Reports', file: 'reports.md', roles: ['admin'] },
  { slug: 'certificates', title: 'Certificates & Official Forms', file: 'certificates.md', roles: ['admin'] },
  { slug: 'benchmark', title: 'Benchmark Check', file: 'benchmark.md', roles: ['admin'] },
  { slug: 'practice-sessions', title: 'Practice Sessions', file: 'practice-sessions.md', roles: ['admin'] },
  { slug: 'test-versions', title: 'Test Versions', file: 'test-versions.md', roles: ['admin'] },
  { slug: 'admin-tools', title: 'Admin tools', file: 'admin-tools.md', roles: ['admin'] },
]

function bodyFor(file: string): string {
  const key = Object.keys(FILES).find(k => k.endsWith('/' + file))
  return key ? FILES[key] : `# Not written yet\n\nThis section (\`${file}\`) hasn't been documented yet.`
}

function visibleTo(role: Role | null): Section[] {
  return SECTIONS.filter(s => s.roles === 'all' || (role != null && s.roles.includes(role)))
}

export function ManualPage() {
  const { role } = useAuth()
  const { slug } = useParams()
  const sections = useMemo(() => visibleTo(role), [role])
  const current = sections.find(s => s.slug === slug) ?? sections[0]

  if (slug && !sections.some(s => s.slug === slug)) {
    return <Navigate to="/manual" replace />
  }

  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <nav className="md:w-56 shrink-0">
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">User manual</h2>
        <ul className="space-y-0.5">
          {sections.map(s => (
            <li key={s.slug}>
              <NavLink
                to={`/manual/${s.slug}`}
                className={({ isActive }) =>
                  `block rounded px-2 py-1.5 text-sm ${
                    isActive || (!slug && s === current)
                      ? 'bg-muted font-medium'
                      : 'text-muted-foreground hover:bg-muted/50'
                  }`
                }
              >
                {s.title}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <article className="manual-prose min-w-0 max-w-3xl flex-1">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{bodyFor(current.file)}</ReactMarkdown>
      </article>
    </div>
  )
}
