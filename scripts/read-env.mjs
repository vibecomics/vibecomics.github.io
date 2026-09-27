/**
 * The Google client config, read only from the dotenv files (.env, then
 * .env.local which wins). Shell / process environment variables are
 * deliberately ignored. Shared by vite.config.js (the web build) and
 * scripts/build-cli.mjs (the CLI bundle), so both bake in the same values.
 */
import dotenv from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';

export function readDotenv() {
  const values = {};
  for (const file of ['.env', '.env.local']) {
    if (existsSync(file)) Object.assign(values, dotenv.parse(readFileSync(file)));
  }
  return values;
}

/** The compile-time constants for the Google client (declared in src/globals.d.ts). */
export function googleDefines(env = readDotenv()) {
  return {
    GOOGLE_DEVICE_CLIENT_ID: JSON.stringify(env.GOOGLE_DEVICE_CLIENT_ID || ''),
    GOOGLE_DEVICE_CLIENT_SECRET: JSON.stringify(env.GOOGLE_DEVICE_CLIENT_SECRET || ''),
  };
}
