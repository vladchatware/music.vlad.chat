import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server"
import { ConvexClientProvider } from "./ConvexContextProvider"
import type { Metadata, Viewport } from 'next'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#000000',
}

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://music.vlad.chat'),
  title: 'music.vlad.chat',
  description: 'An AI-powered virtual DJ for discovering and mixing music from SoundCloud.',
  openGraph: {
    type: 'website',
    siteName: 'music.vlad.chat',
    title: 'music.vlad.chat',
    description: 'An AI-powered virtual DJ for discovering and mixing music from SoundCloud.',
    images: [{
      url: '/tracks/2260180544/opengraph-image',
      width: 1200,
      height: 630,
      alt: 'Revibe track analysis',
    }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'music.vlad.chat',
    description: 'An AI-powered virtual DJ for discovering and mixing music from SoundCloud.',
    images: ['/tracks/2260180544/opengraph-image'],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Music Player',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConvexAuthNextjsServerProvider>
      <html lang="en" suppressHydrationWarning style={{ height: '100%', width: '100%', overflow: 'hidden' }}>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no" />
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
          <script
            defer
            src="https://cloud.umami.is/script.js"
            data-website-id="3287c25e-42c3-480b-8161-ebda17a92e30"
          />
        </head>
        <body style={{ margin: 0, height: '100%', width: '100%', overflow: 'hidden', backgroundColor: 'black' }}>
          <ConvexClientProvider>
            {children}
          </ConvexClientProvider>
        </body>
      </html>
    </ConvexAuthNextjsServerProvider>
  )
}
