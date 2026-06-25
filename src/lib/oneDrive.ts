import { getGraphToken } from './msal'

const SHAREPOINT_FOLDER = 'UKCAA Candidates/Completed CAA5012 Forms'

let cachedSiteId: string | null = null

async function getSiteId(token: string): Promise<string> {
  if (cachedSiteId) return cachedSiteId
  const res = await fetch(
    'https://graph.microsoft.com/v1.0/sites/lxuk.sharepoint.com:/sites/SUPERADMIN',
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!res.ok) throw new Error(`Could not find SharePoint site (${res.status})`)
  const data = await res.json()
  cachedSiteId = data.id as string
  return cachedSiteId
}

export async function uploadCaaToOneDrive(blob: Blob, filename: string): Promise<string> {
  const token = await getGraphToken()
  const siteId = await getSiteId(token)

  const fullPath = `${SHAREPOINT_FOLDER}/${filename}`
  const encodedPath = fullPath.split('/').map(encodeURIComponent).join('/')
  const url = `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/root:/${encodedPath}:/content`

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
