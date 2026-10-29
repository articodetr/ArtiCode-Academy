import { createRequire } from 'node:module';

// `../../package.json` resolves to backend/package.json both when running from
// src/ (vitest) and from dist/ (nest build), because both trees share the same depth.
const loadJson = createRequire(import.meta.url);
const packageJson = loadJson('../../package.json') as {
  name: string;
  version: string;
};

export const PACKAGE_NAME: string = packageJson.name;
export const PACKAGE_VERSION: string = packageJson.version;

/** Stable identifier reported by the health endpoint and Swagger. */
export const SERVICE_NAME = 'articode-academy-api';
