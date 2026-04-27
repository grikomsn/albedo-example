# Albedo Example

A small Vite + React demo that lights a family photo with raw WebGL texture maps.

The photo is presented as a contained, askewed Polaroid-style print. A fragment shader samples four aligned maps:

- `albedo.png` for the visible image
- `normal.png` for surface direction
- `depth.png` for light falloff and optional parallax
- `orm.png` for occlusion, roughness, and metallic channels

The cursor controls the light position relative to the image. The on-page knobs are available in dev and production so the lighting can be tuned live.

## Inspiration

Inspired by this post from Blixt:

https://x.com/blixt/status/2048199166862495897

## Run Locally

```bash
bun install
bun run dev
```

Open:

```text
http://localhost:5173/albedo-example/
```

## Build

```bash
bun run build
bun run lint
```

## Deploy

GitHub Pages deploys from `.github/workflows/pages.yml` on pushes to `main`.

Production URL:

https://grikomsn.github.io/albedo-example/
