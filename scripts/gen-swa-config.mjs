/**
 * Generates `staticwebapp.config.json` for Azure Static Web Apps: routing,
 * MIME types and response headers, from the same CSP `_headers` carries.
 *
 * `/r/<blob>` permalinks are one page, `r.html`, reading the blob from the
 * path. Azure expresses that as a route with a wildcard rewrite. `/api/*` is
 * left alone so it reaches the managed function.
 */
import { contentSecurityPolicy, SECURITY_HEADERS } from './gen-headers.mjs';

const ASSET_EXTENSIONS = ['css', 'js', 'mjs', 'svg', 'json', 'txt', 'ico', 'png', 'webmanifest'];

/**
 * @param {string} dist the built site
 * @returns {string} the complete `staticwebapp.config.json` text
 */
export function generateSwaConfig(dist) {
  const config = {
    routes: [
      { route: '/r/*', rewrite: '/r.html' },
      { route: '/r', rewrite: '/r.html' },
      { route: '/about', rewrite: '/about/index.html' },
    ],
    navigationFallback: {
      rewrite: '/index.html',
      exclude: ['/api/*', '/assets/*', `/*.{${ASSET_EXTENSIONS.join(',')}}`],
    },
    mimeTypes: {
      '.js': 'text/javascript',
      '.svg': 'image/svg+xml',
      '.json': 'application/json',
    },
    globalHeaders: {
      'Content-Security-Policy': contentSecurityPolicy(dist),
      ...SECURITY_HEADERS,
    },
  };
  return `${JSON.stringify(config, null, 2)}\n`;
}
