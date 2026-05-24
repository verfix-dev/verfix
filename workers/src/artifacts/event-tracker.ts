import { Page } from 'playwright';
import { ExecutionEvent, ExecutionEventType } from '../assertions/types';
import * as path from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs';

export class EventTracker {
  private events: ExecutionEvent[] = [];
  private executionId: string;
  private artifactsDir: string;
  private execDir: string;
  private mode: string;

  constructor(executionId: string, artifactsDir: string, mode: string) {
    this.executionId = executionId;
    this.artifactsDir = artifactsDir;
    this.execDir = path.join(artifactsDir, executionId);
    if (!fs.existsSync(this.execDir)) {
      fs.mkdirSync(this.execDir, { recursive: true });
    }
    this.mode = mode;
  }

  getEvents(): ExecutionEvent[] {
    return this.events;
  }


  /**
   * Push a synchronous event into the timeline.
   */
  pushEvent(
    type: ExecutionEventType,
    message: string,
    metadata?: Record<string, unknown>,
    options?: {
      category?: 'signal' | 'summary' | 'info';
      capture_reason?: 'failure' | 'retry' | 'step';
      signal_flags?: string[];
      summary?: string;
    },
  ): ExecutionEvent {
    const event: ExecutionEvent = {
      id: crypto.randomUUID(),
      type,
      timestamp: new Date().toISOString(),
      message,
      metadata,
      category: options?.category,
      capture_reason: options?.capture_reason,
      signal_flags: options?.signal_flags,
      summary: options?.summary,
    };
    this.events.push(event);
    return event;
  }

  /**
   * Capture a signal snapshot and attach it to the event.
   */
  async captureSignalState(page: Page, eventId: string, reason: 'failure' | 'retry' | 'step'): Promise<void> {
    const targetEvent = this.events.find(e => e.id === eventId);
    if (!targetEvent) return;

    targetEvent.capture_reason = reason;
    targetEvent.signal_flags = Array.from(new Set([...(targetEvent.signal_flags || []), reason]));

    const screenshotName = `${targetEvent.id}.png`;
    const domName = `${targetEvent.id}.html`;
    const screenshotPath = path.join(this.execDir, screenshotName);
    const domPath = path.join(this.execDir, domName);

    try {
      await page.screenshot({ path: screenshotPath, type: 'png', scale: 'css' });
      targetEvent.screenshot = screenshotPath;
    } catch (e: any) {
      console.warn(`[EventTracker] Signal screenshot failed: ${e.message}`);
    }

    try {
      const content = await page.content();
      fs.writeFileSync(domPath, content);
      targetEvent.dom_snapshot = domPath;
    } catch (e: any) {
      console.warn(`[EventTracker] DOM snapshot failed: ${e.message}`);
    }

    page.evaluate(() => {
      const interactive = document.querySelectorAll('a, button, input, select, textarea, [role="button"], [aria-label]');
      const snippets: string[] = [];
      interactive.forEach((el, i) => {
        if (i > 50) return;
        snippets.push(el.outerHTML.substring(0, 150) + '...');
      });
      return snippets.join('\n');
    }).then(domSnippet => {
      targetEvent.dom_snippet = domSnippet;
    }).catch(() => undefined);
  }

  /**
   * Synchronous capture used for failures or critical checkpoints
   */
  async captureStateSync(page: Page, eventId?: string, reason: 'failure' | 'retry' | 'step' = 'failure'): Promise<void> {
    const targetEvent = eventId 
      ? this.events.find(e => e.id === eventId)
      : this.events[this.events.length - 1];

    if (!targetEvent) return;

    targetEvent.capture_reason = reason;
    targetEvent.signal_flags = Array.from(new Set([...(targetEvent.signal_flags || []), reason]));

    const screenshotName = `${targetEvent.id}.png`;
    const domName = `${targetEvent.id}.html`;
    const screenshotPath = path.join(this.execDir, screenshotName);
    const domPath = path.join(this.execDir, domName);

    try {
      await page.screenshot({ path: screenshotPath, type: 'png', scale: 'css' });
      targetEvent.screenshot = screenshotPath;
    } catch (e: any) {
      console.warn(`[EventTracker] Sync screenshot failed: ${e.message}`);
    }

    try {
      const content = await page.content();
      fs.writeFileSync(domPath, content);
      targetEvent.dom_snapshot = domPath;
    } catch (e: any) {
      console.warn(`[EventTracker] DOM snapshot failed: ${e.message}`);
    }
  }

}
