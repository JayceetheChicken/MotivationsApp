import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

// Fixes the web shell to the light retro design: without an explicit page
// background the browser paints its own canvas colour (black in dark mode).
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="de">
      <head>
        <meta charSet="utf-8" />
        <meta content="IE=edge" httpEquiv="X-UA-Compatible" />
        <meta content="width=device-width, initial-scale=1, shrink-to-fit=no" name="viewport" />
        <meta content="light" name="color-scheme" />
        <meta content="#F4E8D0" name="theme-color" />
        <meta content="no-referrer" name="referrer" />
        {/* Header-only protections (for example frame-ancestors, nosniff and
            DENY) live in public/_headers; browsers ignore them in meta tags. */}
        <meta
          content="default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self' mailto:; img-src 'self' data: blob:; object-src 'none'; script-src 'self' 'sha256-67fhrP0+BkBqmgGGXTtgiVO/9EQs3QruYNU/7fnRkI8='; style-src 'self' 'unsafe-inline'; upgrade-insecure-requests"
          httpEquiv="Content-Security-Policy"
        />
        <ScrollViewStyleReset />
        <style
          dangerouslySetInnerHTML={{
            __html: 'html, body { background-color: #F4E8D0; color-scheme: light; }',
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
