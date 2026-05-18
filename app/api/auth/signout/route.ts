import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export async function GET() {
  const store = await cookies()
  for (const name of ['__convexAuthJWT', '__convexAuthRefreshToken', '__convexAuthOAuthVerifier',
    '__Host-__convexAuthJWT', '__Host-__convexAuthRefreshToken', '__Host-__convexAuthOAuthVerifier']) {
    store.delete(name)
  }
  redirect('/')
}
