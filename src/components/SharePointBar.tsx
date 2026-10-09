import { CloudUpload, LogOut } from 'lucide-react'
import type { MsConnection } from '@/lib/useMsConnection'

export function SharePointBar({ ms, signedOutText }: { ms: MsConnection; signedOutText: string }) {
  const { account, status, signInErr, signIn, signOut } = ms
  return (
    <>
      {signInErr && <p className="text-xs text-red-600">{signInErr}</p>}
      <div className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm ${
        status === 'connected' ? 'border-green-400 bg-green-100 dark:bg-green-950 dark:border-green-700'
        : status === 'stale' ? 'border-amber-400 bg-amber-100 dark:bg-amber-950 dark:border-amber-700'
        : 'border-red-400 bg-red-100 dark:bg-red-950 dark:border-red-700'
      }`}>
        {account ? (
          <>
            <span className={status === 'connected' ? 'text-green-900 dark:text-green-200' : 'text-amber-900 dark:text-amber-200'}>
              SharePoint: <span className="font-medium">{account.username}</span>
              {status === 'stale' && <span className="font-normal"> — session needs refreshing</span>}
            </span>
            {status === 'stale' ? (
              <button type="button" onClick={signIn} className="flex items-center gap-1.5 text-xs font-semibold text-amber-900 dark:text-amber-200 hover:underline">
                <CloudUpload className="size-3.5" /> Reconnect
              </button>
            ) : (
              <button type="button" onClick={signOut} className="flex items-center gap-1 text-xs text-green-900 dark:text-green-200 hover:underline">
                <LogOut className="size-3" /> Disconnect
              </button>
            )}
          </>
        ) : (
          <>
            <span className="font-medium text-red-900 dark:text-red-200">{signedOutText}</span>
            <button type="button" onClick={signIn} className="flex items-center gap-1.5 text-xs font-semibold text-red-900 dark:text-red-200 hover:underline">
              <CloudUpload className="size-3.5" /> Connect
            </button>
          </>
        )}
      </div>
    </>
  )
}
