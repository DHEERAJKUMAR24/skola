import fs from "node:fs";
import withSerwistInit from "@serwist/next";

const pkg = JSON.parse(fs.readFileSync("./package.json", "utf-8"));

const withSerwist = withSerwistInit({
  swSrc: "src/sw.ts",
  swDest: "public/sw.js",
  // "/" is the app shell; precache it so the app opens offline after the first visit.
  additionalPrecacheEntries: [{ url: "/", revision: pkg.version }],
  disable: process.env.NODE_ENV === "development",
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactCompiler: true,
  env: { NEXT_PUBLIC_APP_VERSION: pkg.version },
};

export default withSerwist(nextConfig);
