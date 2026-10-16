import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft } from 'lucide-react'
import { fetchMaterials } from '@/lib/courseMaterials'
import { MaterialsSection } from './MaterialsSection'

// Materials shared by every run of a course type — the rater course's
// teacher notes, standing refresher handouts. Per-run material lives on
// each course's own page.
export function SharedMaterialsPage() {
  const { data: materials = [], isLoading } = useQuery({ queryKey: ['course-materials'], queryFn: fetchMaterials })

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link to="/courses" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> Courses
        </Link>
        <h1 className="text-2xl font-semibold">Shared materials</h1>
        <p className="text-sm text-muted-foreground">Shown on every course of that type. Trainers only.</p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="grid gap-8 lg:grid-cols-2">
          <MaterialsSection
            title="Rater courses"
            materials={materials.filter(m => m.scope === 'rater')}
            addTargets={[{ label: 'All rater courses', target: { scope: 'rater' } }]}
            allowDay
            returnTo="/courses/materials"
          />
          <MaterialsSection
            title="Refresher courses"
            materials={materials.filter(m => m.scope === 'refresher')}
            addTargets={[{ label: 'All refresher courses', target: { scope: 'refresher' } }]}
            allowDay={false}
            returnTo="/courses/materials"
          />
        </div>
      )}
    </div>
  )
}
