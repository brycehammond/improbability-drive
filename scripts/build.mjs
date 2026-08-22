#!/usr/bin/env node
/**
 * Builds `dist/`: the site verbatim plus the generated host configs.
 * A copy and two generates. No transform, no bundle, no network.
 */
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateHeaders } from './gen-headers.mjs';
import { generateSwaConfig } from './gen-swa-config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'site');
const DIST = path.resolve(ROOT, process.argv[2] ?? process.env.BUILD_OUT ?? 'dist');

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });
await cp(SITE, DIST, { recursive: true });
await writeFile(path.join(DIST, '_headers'), generateHeaders(DIST), 'utf8');
await writeFile(path.join(DIST, 'staticwebapp.config.json'), generateSwaConfig(DIST), 'utf8');

process.stdout.write(`built ${path.relative(ROOT, DIST)}/\n`);
