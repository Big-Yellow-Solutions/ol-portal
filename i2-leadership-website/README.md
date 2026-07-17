# i2 Leadership — website

Static site for [i2 Leadership](https://www.i2leadership.com), built from the
*i2 Leadership Website Copy (v5)* document. Plain HTML/CSS/JS — no build step,
no dependencies.

## Pages

| File | Page |
| --- | --- |
| `index.html` | Home — kicker + stacked headline; each phrase anchors its service section |
| `services.html` | Services overview |
| `executive-coaching.html` | Executive Coaching (six-month engagement) |
| `team-coaching.html` | Team Coaching |
| `accelerator.html` | The Intentional Leadership Accelerator (nav: "Training") |
| `team.html` | Meet the Team + See Laura in Action |
| `clients.html` | Client roster (v5 edits applied: Opera Solutions & Constellation Brands removed; Shiseido, GoodRx, JP Morgan added) |
| `podcast.html` | Mojo Mondays Bootcamp — Listen now + Season 5 guests + Intentionality at Work signup |
| `links.html` | QR-code landing page (point the QR code at `/links.html`) |
| `404.html` | Not-found page |

## Run locally

```sh
python3 -m http.server 8080
# open http://localhost:8080
```

## Deploy to GitHub Pages

Settings → Pages → "Deploy from a branch" → branch `main`, folder `/ (root)`.
`.nojekyll` is included so files are served as-is. All internal links are
relative, so the site works under `https://<owner>.github.io/i2Leadershipwebsite/`
or a custom domain.

## Things to update when you have them

- **Calendly URL** — every "Book the call" button reads its link from one
  constant, `BOOKING_URL`, at the top of `assets/js/site.js` (the same URL is
  also in each button's `href` for no-JS visitors). Replace it in `site.js` and
  find-and-replace the old URL across the `.html` files.
- ~~Laura's updated photo~~ — done: `assets/img/laura.jpg` shows on the
  Meet the Team page. Replace that file to swap the photo.
- **Logo artwork** — the header/footer wordmark is a live-text recreation of
  the i2 Leadership logo (Archivo Black + gold starburst SVG), which stays
  crisp at any size. To use the original logo file instead, add it as
  `assets/img/logo.png` and replace the `.brand` lockup markup in each page's
  header with `<img src="assets/img/logo.png" alt="i2 Leadership" height="40">`.
- **Season 5 episode links** — guests are listed on `podcast.html`; add
  per-episode URLs if you want each name to link to its episode.

## Design notes

- Type: [Fraunces](https://fonts.google.com/specimen/Fraunces) for display,
  [Public Sans](https://fonts.google.com/specimen/Public+Sans) for body
  (16px / 1.6), [Archivo Black](https://fonts.google.com/specimen/Archivo+Black)
  for the brand lockup only.
- Brand colors from the i2 Leadership logo: `--accent: #1D4C7C` (navy — 8.3:1
  on the paper background, 8.8:1 under white button text) with the gold
  starburst `#E8A81E`/`#F0B02E` reserved for decoration and text on the dark
  navy bands.
- Sections sit ~96px apart (`--space-section`); groups keep tight gaps.
- Animations touch only `transform` and `opacity`, ease-out, and respect
  `prefers-reduced-motion`.
