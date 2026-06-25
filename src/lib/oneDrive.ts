import { getGraphToken } from './msal'

const SHAREPOINT_FOLDER = 'UKCAA Candidates/Completed CAA5012 Forms'

let cachedDriveId: string | null = null

async function getDriveId(token: string): Promise<string> {
  if (cachedDriveId) return cachedDriveId
  const headers = { Authorization: `Bearer ${token}` }

  // Resolve site to get its stable GUID-based ID
  const siteRes = await fetch(
    'https://graph.microsoft.com/v1.0/sites/lxuk.sharepoint.com:/sites/SUPERADMIN',
    { headers }
  )
  if (!siteRes.ok) throw new Error(`Could not find SharePoint site (${siteRes.status})`)
  const { id: siteId } = await siteRes.json()

  // Get the default document library drive for that site
  const driveRes = await fetch(
    `https://graph.microsoft.com/v1.0/sites/${siteId}/drive`,
    { headers }
  )
  if (!driveRes.ok) throw new Error(`Could not find SharePoint drive (${driveRes.status})`)
  const { id: driveId } = await driveRes.json()

  cachedDriveId = driveId
  return driveId
}

export async function uploadCaaToOneDrive(blob: Blob, filename: string): Promise<string> {
  const token = await getGraphToken()
  const driveId = await getDriveId(token)

  const fullPath = `${SHAREPOINT_FOLDER}/${filename}`
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
  return data.webUrl as string
}
