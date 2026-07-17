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
