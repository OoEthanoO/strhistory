// The browser behind the package's headless checks (scripts/screenshots.mjs,
// scripts/recipes.mjs, src/timeline/demo.screenshot.mjs). playwright-core downloads no
// browser; it drives an installed one, chosen by the ALEXS_ATLAS_BROWSER env var:
//
//   ALEXS_ATLAS_BROWSER=msedge | chrome | chromium | …   a Playwright channel (chromium:
//                                                        after `npx playwright-core install chromium`)
//   ALEXS_ATLAS_BROWSER=/abs/path/to/browser             a Chromium-based executable
//   unset                                                 Microsoft Edge, or Google Chrome
//                                                         when Edge is not installed
import path from 'node:path';
import { chromium } from 'playwright-core';

/** playwright-core's "Chromium distribution 'msedge' is not found at …" (or "… is not supported on <platform>"). */
const notInstalled = (err) => /Chromium distribution '[^']*' is not (found|supported)/.test(String(err?.message ?? err));

/**
 * `chromium.launch(options)` with the browser chosen above. `options` are the caller's
 * own launch options (headless, SwiftShader args, …) without `channel`/`executablePath`.
 */
export async function launchBrowser(options = {}) {
  const choice = process.env.ALEXS_ATLAS_BROWSER?.trim();
  if (choice) return chromium.launch({ ...options, ...(path.isAbsolute(choice) ? { executablePath: choice } : { channel: choice }) });
  try {
    return await chromium.launch({ ...options, channel: 'msedge' });
  } catch (err) {
    if (!notInstalled(err)) throw err;
  }
  console.warn('Microsoft Edge is not installed: using Google Chrome (ALEXS_ATLAS_BROWSER chooses another browser).');
  try {
    return await chromium.launch({ ...options, channel: 'chrome' });
  } catch (err) {
    if (!notInstalled(err)) throw err;
    throw new Error('Neither Microsoft Edge nor Google Chrome is installed: set ALEXS_ATLAS_BROWSER to a Playwright channel or a browser executable path.', { cause: err });
  }
}
