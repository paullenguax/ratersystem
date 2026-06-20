import { Link } from 'react-router-dom'
import { Upload, FileAudio, History, RefreshCw, Shuffle } from 'lucide-react'

const tools = [
  {
    to: '/admin/canvas-sync',
    icon: RefreshCw,
    label: 'Canvas Sync',
    description: 'Match Canvas course enrollments to people in RaterSystem. Add new people or link existing ones to their Canvas email.',
  },
  {
    to: '/admin/auto-assign',
    icon: Shuffle,
    label: 'Auto-assign Tests',
    description: 'Generate balanced test assignments: one anchor, difficulty spread, minimal overlap within cohort.',
  },
  {
    to: '/admin/import-raters',
    icon: Upload,
    label: 'Import Raters',
    description: 'Bulk-import raters from a certificate CSV file with deduplication review.',
  },
  {
    to: '/admin/import-tests',
    icon: FileAudio,
    label: 'Import Test Bank',
    description: 'Import tests from the migration JSON export. Review and fix test types before committing.',
  },
  {
    to: '/admin/import-historical-scores',
    icon: History,
    label: 'Import Historical Scores',
    description: 'Import legacy scores from two CSVs: a scores sheet and a rater number-to-name map.',
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
