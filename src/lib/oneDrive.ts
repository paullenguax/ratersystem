import { getGraphToken } from './msal'

export const SP_FOLDER_CAA  = 'UKCAA Candidates/Completed CAA5012 Forms'
export const SP_FOLDER_DGAC = 'DGAC France Candidates/Completed DGAC Forms'
export const SP_FOLDERS_CERT: Record<string, string> = {
  '1': 'Course Certificates/Rater',
  '2': 'Course Certificates/RaterInt',
  '3': 'Course Certificates/Refresher',
  '4': 'Course Certificates/Teacher',
  '6': 'Course Certificates/RefresherInt',
}

let cachedDriveId: string | null = null

async function getDriveId(token: string): Promise<string> {
  if (cachedDriveId) return cachedDriveId
  const headers = { Authorization: `Bearer ${token}` }

  const siteRes = await fetch(
    'https://graph.microsoft.com/v1.0/sites/lxuk.sharepoint.com:/sites/SUPERADMIN',
    { headers }
  )
  if (!siteRes.ok) throw new Error(`Could not find SharePoint site (${siteRes.status})`)
  const { id: siteId } = await siteRes.json()

  const driveRes = await fetch(
    `https://graph.microsoft.com/v1.0/sites/${siteId}/drive`,
    { headers }
  )
  if (!driveRes.ok) throw new Error(`Could not find SharePoint drive (${driveRes.status})`)
  const { id: driveId } = await driveRes.json()

  cachedDriveId = driveId
  return driveId
}

export interface SharePointUploadResult {
  itemId: string
  webUrl: string
}

export async function uploadToSharePoint(blob: Blob, filename: string, folder: string): Promise<SharePointUploadResult> {
  const token = await getGraphToken()
  const driveId = await getDriveId(token)

  const fullPath = `${folder}/${filename}`
  const encodedPath = fullPath.split('/').map(encodeURIComponent).join('/')
  const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodedPath}:/content`

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/pdf',
    },
    body: blob,
  })

  if (!res.ok) {
    const msg = await res.text()
    throw new Error(`SharePoint upload failed (${res.status}): ${msg}`)
  }

  const data = await res.json()
  return { itemId: data.id as string, webUrl: data.webUrl as string }
}

// ── Anonymous ("Anyone") share links ─────────────────────────────────────
//
// Per-file, read-only, no-sign-in links for sending certificates to
// candidates who aren't in our tenant. Microsoft enforces a tenant-wide
// default/maximum expiry on anonymous links, so always set one explicitly —
// don't assume a permanent link is possible. If this fails with a
// permissions/policy error, anonymous links are disabled at the tenant or
// SUPERADMIN site level — that's a SharePoint admin setting, not a code fix.

export const SHARE_LINK_DEFAULT_EXPIRY_DAYS = 90

export interface ShareLinkResult {
  url: string
  expiresAt: string // ISO 8601 — the actual expiry Graph applied (may be clamped by tenant policy)
}

export async function createAnonymousViewLink(itemId: string, expiryDays = SHARE_LINK_DEFAULT_EXPIRY_DAYS): Promise<ShareLinkResult> {
  const token = await getGraphToken()
  const driveId = await getDriveId(token)
  const requestedExpiry = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString()

  const res = await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/createLink`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'view',
      scope: 'anonymous',
      expirationDateTime: requestedExpiry,
    }),
  })

  if (!res.ok) {
    const msg = await res.text()
    if (res.status === 403 || res.status === 400) {
      throw new Error(
        `Could not create a shareable link (${res.status}): ${msg}\n\n` +
        `This usually means anonymous ("Anyone") links are blocked by SharePoint policy — ` +
        `check that anonymous sharing is enabled both tenant-wide and on the SUPERADMIN site ` +
        `(Site settings → Site permissions → external sharing). This needs a SharePoint admin ` +
        `to fix, not a code change.`
      )
    }
    throw new Error(`Could not create a shareable link (${res.status}): ${msg}`)
  }

  const data = await res.json()
  return {
    url: data.link.webUrl as string,
    expiresAt: (data.expirationDateTime as string | undefined) ?? requestedExpiry,
  }
}
