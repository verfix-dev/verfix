import { Page, BrowserContext } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { AssertionResult, ConsoleLine, NetworkRequest } from '../assertions/types';

export interface CollectedArtifacts {
  screenshot?: string;
  failed_screenshot?: string;
  trace?: string;
  har?: string;
  console_log?: string;
  network_log?: string;
  dom_snapshot?: string;
}

export async function collectArtifacts(
  page: Page,
  context: BrowserContext,
  artifactsDir: string,
  executionId: string,
  consoleLogs: ConsoleLine[],
  networkRequests: NetworkRequest[],
  failed: boolean,
): Promise<CollectedArtifacts> {
  const artifacts: CollectedArtifacts = {};

  // Screenshot
  try {
    const screenshotPath = path.join(artifactsDir, `${executionId}${failed ? '_failed' : ''}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    if (failed) {
      artifacts.failed_screenshot = screenshotPath;
    } else {
      artifacts.screenshot = screenshotPath;
    }
  } catch (e) {
    console.warn('Could not capture screenshot:', e);
  }

  // DOM snapshot
  try {
    const domPath = path.join(artifactsDir, `${executionId}.html`);
    const content = await page.content();
    fs.writeFileSync(domPath, content);
    artifacts.dom_snapshot = domPath;
  } catch (e) {
    console.warn('Could not capture DOM snapshot:', e);
  }

  // Stop trace
  try {
    const tracePath = path.join(artifactsDir, `${executionId}_trace.zip`);
    await context.tracing.stop({ path: tracePath });
    artifacts.trace = tracePath;
  } catch (e) {
    console.warn('Could not stop tracing:', e);
  }

  // Console log
  try {
    const consoleLogPath = path.join(artifactsDir, `${executionId}_console.json`);
    fs.writeFileSync(consoleLogPath, JSON.stringify(consoleLogs, null, 2));
    artifacts.console_log = consoleLogPath;
  } catch (e) {
    console.warn('Could not write console log:', e);
  }

  // Network log
  try {
    const networkLogPath = path.join(artifactsDir, `${executionId}_network.json`);
    fs.writeFileSync(networkLogPath, JSON.stringify(networkRequests, null, 2));
    artifacts.network_log = networkLogPath;
  } catch (e) {
    console.warn('Could not write network log:', e);
  }

  // HAR is intentionally not collected here: recordHar only flushes the file
  // to disk when the BrowserContext closes, which happens after this runs.
  // The caller assigns artifacts.har once the context has been closed.

  return artifacts;
}
