#!/usr/bin/env node
/**
 * AI Cart Self-Hosted Font Downloader (Bunny Fonts -> Cloudflare R2)
 *
 * Downloads curated e-commerce fonts (.woff2 + @font-face CSS) from Bunny Fonts
 * (https://fonts.bunny.net) and rewrites URLs for self-hosting on Cloudflare R2
 * at https://cdn.aicart.store/fonts/<slug>/font.css
 *
 * Usage:
 *   node fonts-cdn/download-bunny-fonts.mjs
 *   node fonts-cdn/download-bunny-fonts.mjs --cdn-url=https://cdn.aicart.store/fonts
 *   node fonts-cdn/download-bunny-fonts.mjs --all-subsets
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const cdnUrlArg = args.find((a) => a.startsWith("--cdn-url="))?.split("=")[1];
const CDN_BASE_URL = (cdnUrlArg || "https://cdn.aicart.store/fonts").replace(/\/+$/, "");
const INCLUDE_ALL_SUBSETS = args.includes("--all-subsets");
const ALLOWED_SUBSETS = new Set(["latin", "latin-ext", "bengali"]);

const OUTPUT_DIR = path.join(__dirname, "dist", "fonts");
const CONCURRENCY = 6;

/**
 * Curated E-Commerce Font Catalog (34 families across sans-serif, serif, monospace, display, handwriting).
 * Matches all built-in theme presets, AI Storefront Copilot recommendations, and Theme Editor options.
 */
export const CURATED_FONTS = [
  // Sans-Serif
  { family: "Inter", category: "sans-serif", weights: ["400", "500", "600", "700"], variable: true },
  { family: "Plus Jakarta Sans", category: "sans-serif", weights: ["400", "500", "600", "700"], variable: true },
  { family: "DM Sans", category: "sans-serif", weights: ["400", "500", "600", "700"], variable: true },
  { family: "Geist", category: "sans-serif", weights: ["400", "500", "600", "700"], variable: true },
  { family: "Outfit", category: "sans-serif", weights: ["400", "500", "600", "700"], variable: true },
  { family: "Montserrat", category: "sans-serif", weights: ["400", "500", "600", "700"], variable: true },
  { family: "Poppins", category: "sans-serif", weights: ["400", "500", "600", "700"], variable: false },
  { family: "Open Sans", category: "sans-serif", weights: ["400", "500", "600", "700"], variable: true },
  { family: "Roboto", category: "sans-serif", weights: ["400", "500", "700"], variable: false },
  { family: "Quicksand", category: "sans-serif", weights: ["400", "500", "600", "700"], variable: true },
  { family: "Manrope", category: "sans-serif", weights: ["400", "500", "600", "700"], variable: true },
  { family: "Work Sans", category: "sans-serif", weights: ["400", "500", "600", "700"], variable: true },
  { family: "Space Grotesk", category: "sans-serif", weights: ["400", "500", "600", "700"], variable: true },
  { family: "Oxanium", category: "sans-serif", weights: ["400", "500", "600", "700"], variable: true },
  { family: "Antic", category: "sans-serif", weights: ["400"], variable: false },
  { family: "Syne", category: "display", weights: ["400", "500", "600", "700"], variable: true },

  // Serif
  { family: "Lora", category: "serif", weights: ["400", "500", "600", "700"], variable: true },
  { family: "Merriweather", category: "serif", weights: ["400", "700"], variable: false },
  { family: "Playfair Display", category: "serif", weights: ["400", "500", "600", "700"], variable: true },
  { family: "Source Serif 4", category: "serif", weights: ["400", "500", "600", "700"], variable: true },
  { family: "Libre Baskerville", category: "serif", weights: ["400", "700"], variable: false },
  { family: "Cormorant Garamond", category: "serif", weights: ["400", "500", "600", "700"], variable: false },
  { family: "Instrument Serif", category: "serif", weights: ["400"], variable: false },
  { family: "Crimson Pro", category: "serif", weights: ["400", "500", "600", "700"], variable: true },
  { family: "Cinzel", category: "display", weights: ["400", "500", "600", "700"], variable: true },

  // Monospace
  { family: "JetBrains Mono", category: "monospace", weights: ["400", "500", "600", "700"], variable: true },
  { family: "Fira Code", category: "monospace", weights: ["400", "500", "600", "700"], variable: true },
  { family: "IBM Plex Mono", category: "monospace", weights: ["400", "500", "600", "700"], variable: false },
  { family: "Source Code Pro", category: "monospace", weights: ["400", "500", "600", "700"], variable: true },
  { family: "Space Mono", category: "monospace", weights: ["400", "700"], variable: false },
  { family: "Roboto Mono", category: "monospace", weights: ["400", "500", "600", "700"], variable: true },
  { family: "Ubuntu Mono", category: "monospace", weights: ["400", "700"], variable: false },
  { family: "Geist Mono", category: "monospace", weights: ["400", "500", "600", "700"], variable: true },

  // Handwriting
  { family: "Architects Daughter", category: "handwriting", weights: ["400"], variable: false },
];

export function toFontSlug(family) {
  return family
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function fetchWithRetry(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
      return res;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
}

/**
 * Parses Bunny Fonts CSS into individual /* subset * / @font-face blocks,
 * filters to desired subsets, downloads .woff2 files, and rewrites URLs to CDN_BASE_URL.
 */
async function processFont(font) {
  const slug = toFontSlug(font.family);
  const fontDir = path.join(OUTPUT_DIR, slug);
  await fs.mkdir(fontDir, { recursive: true });

  const weightsParam = font.weights.join(",");
  const bunnyCssUrl = `https://fonts.bunny.net/css?family=${encodeURIComponent(slug)}:${weightsParam}&display=swap`;

  const res = await fetchWithRetry(bunnyCssUrl);
  const rawCss = await res.text();

  // Match optional /* subset */ comment followed by @font-face { ... }
  const blockRegex = /(?:\/\*\s*([a-z0-9-]+)\s*\*\/\s*)?@font-face\s*\{([^}]+)\}/gi;
  const keptBlocks = [];
  const downloads = [];

  let match;
  while ((match = blockRegex.exec(rawCss)) !== null) {
    const subset = (match[1] || "latin").toLowerCase();
    const body = match[2];

    if (!INCLUDE_ALL_SUBSETS && !ALLOWED_SUBSETS.has(subset)) {
      continue;
    }

    // Extract .woff2 URL
    const woff2Match = body.match(/url\((https:\/\/fonts\.bunny\.net\/[^)]+\.woff2)\)/i);
    if (!woff2Match) continue;

    const remoteWoff2Url = woff2Match[1];
    const filename = path.basename(new URL(remoteWoff2Url).pathname);
    const localFilePath = path.join(fontDir, filename);
    const cdnWoff2Url = `${CDN_BASE_URL}/${slug}/${filename}`;

    downloads.push({ remoteWoff2Url, localFilePath, filename });

    // Rewrite src line to only include the woff2 file from our CDN
    let updatedBody = body.replace(
      /src:\s*[^;]+;/i,
      `src: url('${cdnWoff2Url}') format('woff2');`
    );

    if (!/font-display\s*:/i.test(updatedBody)) {
      updatedBody = updatedBody.trimEnd() + "\n  font-display: swap;\n";
    }

    keptBlocks.push(`/* ${subset} */\n@font-face {${updatedBody}}`);
  }

  // Deduplicate downloads by filename
  const uniqueDownloads = Array.from(
    new Map(downloads.map((d) => [d.filename, d])).values()
  );

  // Download .woff2 files in batches
  for (let i = 0; i < uniqueDownloads.length; i += CONCURRENCY) {
    const batch = uniqueDownloads.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async ({ remoteWoff2Url, localFilePath }) => {
        try {
          await fs.access(localFilePath);
          // File already exists locally
        } catch {
          const fileRes = await fetchWithRetry(remoteWoff2Url);
          const buffer = Buffer.from(await fileRes.arrayBuffer());
          await fs.writeFile(localFilePath, buffer);
        }
      })
    );
  }

  const finalCss = keptBlocks.join("\n\n") + "\n";
  const cssFilePath = path.join(fontDir, "font.css");
  await fs.writeFile(cssFilePath, finalCss, "utf8");

  return {
    family: font.family,
    slug,
    category: font.category,
    weights: font.weights,
    variable: font.variable,
    cssUrl: `${CDN_BASE_URL}/${slug}/font.css`,
    filesCount: uniqueDownloads.length,
  };
}

async function main() {
  console.log(`Downloading ${CURATED_FONTS.length} curated fonts from Bunny Fonts...`);
  console.log(`Target CDN Base URL: ${CDN_BASE_URL}`);
  console.log(`Output Directory:    ${OUTPUT_DIR}\n`);

  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const manifest = [];
  let totalFiles = 0;

  for (const font of CURATED_FONTS) {
    process.stdout.write(`  -> ${font.family.padEnd(22)} `);
    const info = await processFont(font);
    manifest.push(info);
    totalFiles += info.filesCount;
    console.log(`OK (${info.filesCount} woff2 files, ${info.slug}/font.css)`);
  }

  const manifestPath = path.join(OUTPUT_DIR, "manifest.json");
  await fs.writeFile(
    manifestPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        cdnBaseUrl: CDN_BASE_URL,
        totalFonts: manifest.length,
        totalWoff2Files: totalFiles,
        fonts: manifest,
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  console.log(`\nDone! Downloaded ${manifest.length} font families (${totalFiles} .woff2 files).`);
  console.log(`Manifest written to: ${manifestPath}`);
}

main().catch((err) => {
  console.error("Failed to download fonts:", err);
  process.exit(1);
});

