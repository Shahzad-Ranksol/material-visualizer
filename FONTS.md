# Fonts

Three Google Fonts, loaded via CDN link in `index.html:10-12` — no local font files, no `@font-face` rules:

| Family | Weights loaded | Tailwind class | Used for |
|---|---|---|---|
| Plus Jakarta Sans | 300, 400, 500, 600, 700, 800 | `font-sans` | Body text, UI labels — the default (`<body>` font-family is also set redundantly in `index.html`'s inline `<style>` block as a pre-hydration fallback). |
| Playfair Display | 400, 500, 600, 700, italic 400 | `font-serif` | Headings, e.g. the "Material Visualizer" wordmark in `StudioHeader`. |
| Cinzel | 500, 600, 700 | `font-display` | Reserved for display/ornamental use (Tailwind class exists; not currently applied anywhere in `components/` or `App.tsx`). |

## How it's wired

1. `index.html:10-12` — `<link>` to `fonts.googleapis.com`, with `preconnect` hints for `fonts.googleapis.com`/`fonts.gstatic.com`.
2. `index.html:16-22` — inline Tailwind CDN config maps each family into `theme.extend.fontFamily` as `sans`/`serif`/`display`, each with a system-font fallback chain.
3. Components use the resulting Tailwind classes (`font-sans`, `font-serif`) directly in `className`.

## Adding or replacing a font

Since Tailwind is CDN-loaded (no build-time config file), everything lives in `index.html`:
1. Update the Google Fonts `<link>` href with the new family/weights.
2. Update the `fontFamily` entries in the inline `tailwind.config` script.
3. Apply the new Tailwind class where needed.

If moving off Google Fonts CDN (e.g. for self-hosting or offline builds), this whole setup would need to move to `@font-face` declarations plus a real `tailwind.config.js` — the CDN Tailwind script and `index.html`-only font loading are both scaffolding leftovers from the Google AI Studio export.
