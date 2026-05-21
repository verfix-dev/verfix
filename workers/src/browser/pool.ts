import { Browser, chromium } from 'playwright';

/**
 * A simple browser pool that reuses a single Browser instance across jobs.
 * Each job gets its own isolated BrowserContext and Page.
 * The Browser is restarted if it crashes.
 */
class BrowserPool {
  private browser: Browser | null = null;
  private launching = false;
  private waiters: Array<() => void> = [];
  private maxConcurrency: number;
  private active = 0;

  constructor(maxConcurrency = 3) {
    this.maxConcurrency = maxConcurrency;
  }

  async acquire(): Promise<Browser> {
    // Wait if at concurrency limit
    while (this.active >= this.maxConcurrency) {
      await new Promise<void>(r => this.waiters.push(r));
    }
    this.active++;
    return this.getBrowser();
  }

  release(): void {
    this.active = Math.max(0, this.active - 1);
    const waiter = this.waiters.shift();
    if (waiter) waiter();
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) return this.browser;

    if (this.launching) {
      await new Promise<void>(r => {
        const check = setInterval(() => {
          if (!this.launching) { clearInterval(check); r(); }
        }, 100);
      });
      return this.getBrowser();
    }

    this.launching = true;
    try {
      // headless: true  → required in Docker/CI (no display server)
      // headless: false → set PLAYWRIGHT_HEADLESS=false in local .env to watch the browser
      const headless = process.env.PLAYWRIGHT_HEADLESS !== 'false';
      this.browser = await chromium.launch({
        headless,
        args: [
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-extensions',
          '--disable-background-networking',
        ],
      });

      this.browser.on('disconnected', () => {
        console.warn('⚠ Browser disconnected. Will relaunch on next job.');
        this.browser = null;
      });

      console.log('🌐 Browser pool: browser launched');
      return this.browser;
    } finally {
      this.launching = false;
    }
  }

  async shutdown(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

export const pool = new BrowserPool(parseInt(process.env.MAX_CONCURRENCY || '3'));
