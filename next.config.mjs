import fs from "node:fs";
import withSerwistInit from "@serwist/next";

const pkg = JSON.parse(fs.readFileSync("./package.json", "utf-8"));

const withSerwist = withSerwistInit({
  swSrc: "src/sw.ts",
  swDest: "public/sw.js",
  // "/" is the app shell and "/offline" the page shown for server pages that need a connection;
  // precache both so the app opens offline right after the first visit.
  additionalPrecacheEntries: [
    { url: "/", revision: pkg.version },
    { url: "/offline", revision: pkg.version },
  ],
  // The app is local-first: coming back online must not reload the page mid-study.
  reloadOnOnline: false,
  disable: process.env.NODE_ENV === "development",
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactCompiler: true,
  env: { NEXT_PUBLIC_APP_VERSION: pkg.version },
  // The FSRS optimizer (fsrs-browser WASM threads) needs SharedArrayBuffer, which browsers only
  // allow on cross-origin isolated pages. `credentialless` keeps cross-origin pictures loading.
  headers: async () => [
    {
      source: "/:path*",
      headers: [
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
      ],
    },
  ],
};

export default withSerwist(nextConfig);
