import { canvasOAuthUrl } from '@/lib/canvasAuthUrl'
import logo from '@/assets/lenguax-logo.png'

export function TakeTestPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#B3C8D9]/30">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-lg px-8 py-10 space-y-6 text-center">
          <div className="flex flex-col items-center gap-3">
            <img src={logo} alt="Lenguax" className="w-16 h-16 object-contain" />
            <div>
              <p className="text-lg font-semibold text-[#00528C] leading-tight">Take your rater exam</p>
              <p className="text-sm text-muted-foreground leading-tight mt-1">
                Sign in with your Canvas account to begin. You'll be given 4 tests to score.
              </p>
            </div>
          </div>

          <a
            href={canvasOAuthUrl('self_serve')}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-[#00528C] text-white px-4 py-2.5 text-sm font-medium shadow-sm hover:bg-[#00528C]/90 transition-colors"
          >
            Continue with Canvas
          </a>
        </div>

        <p className="text-center text-xs text-[#00528C]/50 mt-6">
          Lenguax Aviation English © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  )
}
