import { Link } from 'react-router-dom'
import { RefreshCw, Shuffle, BarChart2, Award, UserPlus, ClipboardList, Search, Mic2, Radio } from 'lucide-react'

const tools = [
  {
    to: '/admin/canvas-enroll',
    icon: UserPlus,
    label: 'Enrol in Canvas',
    description: 'Add someone to a Canvas course section. Looks up existing accounts, detects duplicates, and optionally moves them from a previous section.',
  },
  {
    to: '/admin/enrollment-log',
    icon: ClipboardList,
    label: 'Enrolment Log',
    description: 'Unified log of all Canvas enrolments — WooCommerce purchases and manual enrolments. Flags probable duplicates and name-matched accounts for review.',
  },
  {
    to: '/admin/canvas-sync',
    icon: RefreshCw,
    label: 'Canvas Sync',
    description: 'Match Canvas course enrolments to people in RaterSystem. Add new people or link existing ones to their Canvas email.',
  },
  {
    to: '/admin/canvas-audit',
    icon: Search,
    label: 'Canvas Audit',
    description: 'Health checks: scan for probable duplicate Canvas accounts and students enrolled in multiple sections of the same course.',
  },
  {
    to: '/admin/auto-assign',
    icon: Shuffle,
    label: 'Auto-assign Tests',
    description: 'Generate balanced test assignments: one anchor, difficulty spread, minimal overlap within cohort.',
  },
  {
    to: '/admin/import-rasch',
    icon: BarChart2,
    label: 'Import Rasch Results',
    description: 'Paste a Facets .out file to extract rater measures and Wright map data for Reports.',
  },
  {
    to: '/admin/cert-assets',
    icon: Award,
    label: 'Certificate Assets',
    description: 'Upload and manage certificate templates, display images, and PSD source files per cert type.',
  },
  {
    to: '/admin/pronunciation',
    icon: Mic2,
    label: 'Pronunciation Tool',
    description: 'Manage language status, check Firebase Storage for missing audio files, and generate voice actor scripts.',
  },
  {
    to: '/practice',
    icon: Radio,
    label: 'Practice Sessions',
    description: 'Run live in-class scoring exercises. Share a link with trainees, collect scores in real time, and toggle name visibility for class discussion.',
  },
]

export function AdminPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Admin Tools</h1>
        <p className="text-sm text-muted-foreground mt-1">Utilities for managing the system.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {tools.map(tool => (
          <Link
            key={tool.to}
            to={tool.to}
            className="flex items-start gap-4 p-4 rounded-lg border hover:bg-muted/50 transition-colors"
          >
            <tool.icon className="size-5 mt-0.5 text-muted-foreground shrink-0" />
            <div>
              <p className="font-medium text-sm">{tool.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{tool.description}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
