import 'server-only'

import Stripe from 'stripe'

let client: Stripe | undefined

function getStripe(): Stripe {
  return (client ??= new Stripe(process.env.STRIPE_SECRET_KEY))
}

// Lazily initialized so importing this module (e.g. during Next.js build
// page-data collection for API routes) doesn't require STRIPE_SECRET_KEY to
// be present in the build environment. The error surfaces at request time
// instead, with a clear message from the Stripe SDK.
export const stripe: Stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    const stripeClient = getStripe()
    const value = Reflect.get(stripeClient, prop)
    return typeof value === 'function' ? value.bind(stripeClient) : value
  },
})
