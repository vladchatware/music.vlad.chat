import { NextResponse, NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { supabase } from '../../utils/supabase'

const { CLIENT_ID, CLIENT_SECRET } = process.env;

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const params = new URLSearchParams(url.search)
  const redirect = new URL('http://localhost:3000')
  if (params.has('code')) {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: 'http://localhost:3000/auth',
      code: params.get('code')
    })
    const res = await fetch(`https://secure.soundcloud.com/oauth/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: body.toString()
    })
    const payload = await res.json()
    const me = await fetch(`https://api.soundcloud.com/me`, {
      headers: {
        Authorization: `Bearer ${payload.access_token}`
      }
    })
    const store = await cookies()
    const profile = await me.json()
    store.set('id', profile.id)
    const { data, error } = await supabase
      .from('users')
      .upsert({
        sc_id: profile.id,
        access_token: payload.access_token,
        refresh_token: payload.refresh_token,
        expires_in: payload.expires_in
      }, { onConflict: 'sc_id' })
      .select()
    if (error) console.log(error)
    redirect.searchParams.set('access_token', payload.access_token)
    redirect.searchParams.set('expires_in', payload.expires_in)
  }
  return NextResponse.redirect(redirect)
}
