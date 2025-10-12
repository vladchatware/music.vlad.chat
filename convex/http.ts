import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { httpAction } from "./_generated/server";
import Stripe from "stripe";
import { internal } from "./_generated/api";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const webhook_secret = process.env.STRIPE_WEBHOOK_SECRET

const http = httpRouter();

auth.addHttpRoutes(http);

http.route({
  path: '/webhook',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    const signature = req.headers.get('stripe-signature')
    try {
      const payload = await req.text()
      const event = await stripe.webhooks.constructEventAsync(payload, signature, webhook_secret)

      switch (event.type) {
        case 'checkout.session.completed':
          const { stripeId, tokens } = event.data.object.metadata
          await ctx.runMutation(internal.users.topup, { stripeId, tokens: parseInt(tokens) })
          break;
        default:
          console.log(event.type)
      }
    } catch (e) {
      console.log(e.message)
      return new Response(null, { status: 400 })
    }
    return new Response(null, { status: 200 })
  })
})

export default http;

