# AI Cart Self-Hosted Fonts (`https://cdn.aicart.store/fonts`)

This folder contains the downloader script that fetches our 34 curated e-commerce font families (`.woff2` binaries + `@font-face` CSS) from [Bunny Fonts](https://fonts.bunny.net) and rewrites all URLs for self-hosting on Cloudflare R2 at **`https://cdn.aicart.store/fonts`**.

## 1. Download Fonts Locally

From the workspace root (`/Users/rakib/Projects/ai_cart_project`):

```bash
node fonts-cdn/download-bunny-fonts.mjs
```

This creates `fonts-cdn/dist/fonts/` with the following structure:

```text
fonts-cdn/dist/fonts/
├── manifest.json
├── inter/
│   ├── font.css
│   ├── inter-latin-400-normal.woff2
│   ├── inter-latin-500-normal.woff2
│   ├── inter-latin-600-normal.woff2
│   ├── inter-latin-700-normal.woff2
│   └── ...
├── plus-jakarta-sans/
│   ├── font.css
│   └── *.woff2
└── ... (34 font families)
```

Each `<slug>/font.css` contains `font-display: swap` and points directly to:
`https://cdn.aicart.store/fonts/<slug>/<filename>.woff2`

## 2. Upload to Cloudflare R2 (`https://cdn.aicart.store/fonts`)

### Option A: Using `rclone` (Recommended for fast bulk upload)
Assuming an R2 remote named `r2` and bucket name `aicart-cdn`:

```bash
rclone sync ./fonts-cdn/dist/fonts r2:aicart-cdn/fonts \
  --header-upload "Cache-Control: public, max-age=31536000, immutable" \
  --transfers 16
```

### Option B: Using AWS CLI (S3-compatible Cloudflare R2 endpoint)

```bash
aws s3 sync ./fonts-cdn/dist/fonts s3://aicart-cdn/fonts \
  --endpoint-url https://<ACCOUNT_ID>.r2.cloudflarestorage.com \
  --cache-control "public, max-age=31536000, immutable"
```

> **CORS Requirement on Cloudflare R2**: Ensure the `aicart-cdn` bucket (`https://cdn.aicart.store`) has CORS `Access-Control-Allow-Origin: *` (or `GET`/`HEAD` allowed) so browsers allow cross-origin `@font-face` `.woff2` loading across custom merchant domains.

