// 指：押したまま・なぞる・離すを、時間を指定して行う。Chromium は CDP のタッチ（pointerType が touch になる）、
// WebKit は CDP が無いのでマウス（Pointer Events としては同じ経路。pad-ui は pointerdown/move/up だけを見る）。
// 1回のタップは、どちらのエンジンでも page.touchscreen（hasTouch の文脈）で行う。
import type { CDPSession, Page } from '@playwright/test';

export interface Finger {
  readonly kind: 'touch' | 'mouse';
  down(x: number, y: number): Promise<void>;
  move(x: number, y: number): Promise<void>;
  up(): Promise<void>;
  detach(): Promise<void>;
}

class TouchFinger implements Finger {
  readonly kind = 'touch' as const;
  constructor(private readonly cdp: CDPSession) {}
  async down(x: number, y: number): Promise<void> {
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  }
  async move(x: number, y: number): Promise<void> {
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] });
  }
  async up(): Promise<void> {
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  async detach(): Promise<void> {
    await this.cdp.detach().catch(() => undefined);
  }
}

class MouseFinger implements Finger {
  readonly kind = 'mouse' as const;
  constructor(private readonly page: Page) {}
  async down(x: number, y: number): Promise<void> {
    await this.page.mouse.move(x, y);
    await this.page.mouse.down();
  }
  async move(x: number, y: number): Promise<void> {
    await this.page.mouse.move(x, y);
  }
  async up(): Promise<void> {
    await this.page.mouse.up();
  }
  async detach(): Promise<void> {}
}

export async function fingerOn(page: Page, engine: string): Promise<Finger> {
  if (engine === 'chromium') return new TouchFinger(await page.context().newCDPSession(page));
  return new MouseFinger(page);
}
