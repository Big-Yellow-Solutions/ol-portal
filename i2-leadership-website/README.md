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
- **Laura's updated photo** — save as `assets/img/laura.jpg`; a ready-to-use
  `<figure>` snippet is in a comment at the top of the Laura section in
  `team.html`.
- **Season 5 episode links** — guests are listed on `podcast.html`; add
  per-episode URLs if you want each name to link to its episode.

## Design notes

- Type: [Fraunces](https://fonts.google.com/specimen/Fraunces) for display,
  [Public Sans](https://fonts.google.com/specimen/Public+Sans) for body
  (16px / 1.6).
- One accent color as a semantic token: `--accent: #B23A26` (≥4.5:1 contrast
  on the paper background and under white button text).
- Sections sit ~96px apart (`--space-section`); groups keep tight gaps.
- Animations touch only `transform` and `opacity`, ease-out, and respect
  `prefers-reduced-motion`.
