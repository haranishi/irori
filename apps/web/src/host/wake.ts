// 部屋があるあいだ、画面の消灯を防ぐ（Screen Wake Lock）。取れないブラウザでは何もしない。
// 画面が裏に回ると、ブラウザが自動で放すので、見えるようになったら取り直す。

type WakeSentinel = { released: boolean; release(): Promise<void>; addEventListener(type: 'release', fn: () => void): void };
type WakeNavigator = { wakeLock?: { request(type: 'screen'): Promise<WakeSentinel> } };

export class WakeKeeper {
  private sentinel: WakeSentinel | null = null;
  private wanted = false;
  private pending = false;

  constructor(
    private readonly nav: WakeNavigator,
    private readonly doc: Pick<Document, 'visibilityState' | 'addEventListener'>,
  ) {
    doc.addEventListener('visibilitychange', () => {
      if (doc.visibilityState === 'visible') void this.acquire();
    });
  }

  get held(): boolean {
    return this.sentinel !== null && !this.sentinel.released;
  }

  want(on: boolean): void {
    this.wanted = on;
    if (on) void this.acquire();
    else if (this.sentinel) {
      const s = this.sentinel;
      this.sentinel = null;
      void s.release().catch(() => undefined);
    }
  }

  /** 利用者の操作のあとにも呼ぶ（操作を求めるブラウザのため）。 */
  async acquire(): Promise<void> {
    if (!this.wanted || this.held || this.pending || !this.nav.wakeLock || this.doc.visibilityState !== 'visible') return;
    this.pending = true;
    try {
      const s = await this.nav.wakeLock.request('screen');
      s.addEventListener('release', () => {
        if (this.sentinel === s) this.sentinel = null;
      });
      if (this.wanted) this.sentinel = s;
      else void s.release().catch(() => undefined);
    } catch {
      // 省電力の設定・権限・対応していないブラウザ。黙って続ける。
    } finally {
      this.pending = false;
    }
  }
}
