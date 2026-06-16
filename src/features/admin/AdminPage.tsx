import { Link } from 'react-router-dom'
import { Upload, FileAudio, History } from 'lucide-react'

const tools = [
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
