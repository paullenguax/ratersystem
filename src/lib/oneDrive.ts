import { getGraphToken } from './msal'

const ONEDRIVE_FOLDER = 'SUPER ADMIN/UKCAA Candidates/Completed CAA5012 Forms'

export async function uploadCaaToOneDrive(blob: Blob, filename: string): Promise<string> {
  const token = await getGraphToken()
  const fullPath = `${ONEDRIVE_FOLDER}/${filename}`
  const encodedPath = fullPath.split('/').map(encodeURIComponent).join('/')
  const url = `https://graph.microsoft.com/v1.0/me/drive/root:/${encodedPath}:/content`

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
    throw new Error(`OneDrive upload failed (${res.status}): ${msg}`)
  }

  const data = await res.json()
  return data.webUrl as string
}
