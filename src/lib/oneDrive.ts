import { getGraphToken } from './msal'

const SHAREPOINT_SITE   = 'lxuk.sharepoint.com:/sites/SUPERADMIN'
const SHAREPOINT_FOLDER = 'UKCAA Candidates/Completed CAA5012 Forms'

export async function uploadCaaToOneDrive(blob: Blob, filename: string): Promise<string> {
  const token = await getGraphToken()
  const fullPath = `${SHAREPOINT_FOLDER}/${filename}`
  const encodedPath = fullPath.split('/').map(encodeURIComponent).join('/')
  const url = `https://graph.microsoft.com/v1.0/sites/${SHAREPOINT_SITE}:/drive/root:/${encodedPath}:/content`

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
