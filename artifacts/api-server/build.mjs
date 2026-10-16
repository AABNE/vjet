import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { rm } from "node:fs/promises";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

// Banner for the Node.js server target.
const banner = {
  js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
  `,
};

// Native/optional addons that should never be bundled into the server.
const commonExternals = [
  "*.node",
  "sharp",
  "better-sqlite3",
  "sqlite3",
  "canvas",
  "bcrypt",
  "argon2",
  "fsevents",
  "re2",
  "pg-native",
  "@swc/*",
  "@aws-sdk/*",
  "@opentelemetry/*",
  "aws-sdk",
  "dd-trace",
  "newrelic",
  "playwright",
  "puppeteer",
  "puppeteer-core",
  "electron",
];

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });

  // Long-running Node server build (what Render runs).
  await esbuild({
    entryPoints: [path.resolve(artifactDir, "src/index.ts")],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    external: [...commonExternals, "nodemailer"],
    sourcemap: "linked",
    plugins: [esbuildPluginPino({ transports: ["pino-pretty"] })],
    banner,
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
