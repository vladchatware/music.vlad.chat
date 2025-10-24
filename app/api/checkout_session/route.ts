import { NextResponse } from 'next/server'
import { fetchQuery } from "convex/nextjs"
import { api } from '@/convex/_generated/api';
import { convexAuthNextjsToken } from '@convex-dev/auth/nextjs/server';
import { headers } from 'next/headers'

import { stripe } from '../../../lib/stripe'

export async function POST(req) {
  const body = await req.json()
  const user = await fetchQuery(api.users.viewer, {}, { token: await convexAuthNextjsToken() })
  const unit_amount = Math.round(body.price * 100)
  const pricePerMil = 0.30
  const tokens = Math.floor((body.price / pricePerMil) * 1_000_000)
  try {
    const headersList = await headers()
    const origin = headersList.get('origin')

    const session = await stripe.checkout.sessions.create({
      customer: user.stripeId,
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'AI Tokens'
          },
          unit_amount
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${origin}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}?canceled=true`,
      metadata: { stripeId: user.stripeId, tokens }
    });
    return NextResponse.json(session)
  } catch (err) {
    console.log(err)
    return NextResponse.json(
      { error: err.message },
      { status: err.statusCode || 500 }
    )
  }
}
