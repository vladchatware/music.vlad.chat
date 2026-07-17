import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { fetchMutation, fetchQuery } from "convex/nextjs"
import { api } from '@/convex/_generated/api';
import { convexAuthNextjsToken } from '@convex-dev/auth/nextjs/server';

import { stripe } from '../../../lib/stripe'

const CHECKOUT_PRICE_USD = 5
const CHECKOUT_TOKENS = Math.floor((CHECKOUT_PRICE_USD / 0.30) * 1_000_000)

export async function POST() {
  const startedAt = performance.now()
  const token = await convexAuthNextjsToken()
  const user = await fetchQuery(api.users.viewer, {}, { token })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  Sentry.setUser({ id: user._id, ...(user.email ? { email: user.email } : {}) })
  const metricAttributes = {
    package: 'tokens_5_usd',
    user_kind: user.isAnonymous ? 'anonymous' : 'authenticated',
  }
  try {
    let stripeId = user.stripeId
    if (!stripeId) {
      const customer = await stripe.customers.create({ email: user.email })
      stripeId = customer.id
      await fetchMutation(api.users.connect, { stripeId }, { token })
    }
    const origin = process.env.NEXT_PUBLIC_SITE_URL
    if (!origin) throw new Error('Site origin is not configured')

    const session = await stripe.checkout.sessions.create({
      customer: stripeId,
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'AI Tokens'
          },
          unit_amount: CHECKOUT_PRICE_USD * 100,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${origin}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}?canceled=true`,
      metadata: { userId: String(user._id), tokens: String(CHECKOUT_TOKENS) }
    });
    const durationMs = performance.now() - startedAt
    Sentry.metrics.count('commerce.checkout.created', 1, { attributes: metricAttributes })
    Sentry.metrics.distribution('commerce.checkout.duration', durationMs, {
      unit: 'millisecond',
      attributes: { ...metricAttributes, status: 'created' },
    })
    Sentry.logger.info('Checkout session created', metricAttributes)
    return NextResponse.json(session)
  } catch (error) {
    const durationMs = performance.now() - startedAt
    const message = error instanceof Error ? error.message : String(error)
    Sentry.captureException(error)
    Sentry.logger.error('Checkout session creation failed', { ...metricAttributes, message })
    Sentry.metrics.count('commerce.checkout.failed', 1, { attributes: metricAttributes })
    Sentry.metrics.distribution('commerce.checkout.duration', durationMs, {
      unit: 'millisecond',
      attributes: { ...metricAttributes, status: 'failed' },
    })
    await Sentry.flush(2_000)
    return NextResponse.json(
      { error: 'Failed to create checkout session' },
      { status: 500 }
    )
  }
}
