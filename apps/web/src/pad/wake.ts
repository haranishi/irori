// 画面の消灯を防ぐ（Screen Wake Lock）。取れない端末・ブラウザでは何もしない。
// 画面が隠れるとブラウザが自動で手放すので、見えるようになったら取り直す（visibilitychange で refresh を呼ぶ）。

export interface WakeSentinel {
  readonly released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

export interface WakeApi {
  request(type: 'screen'): Promise<WakeSentinel>;
}

export class WakeKeeper {
  private want = false;
  private sentinel: WakeSentinel | null = null;
  private pending = false;

  constructor(
    private readonly api: WakeApi | undefined,
    private readonly visible: () => boolean,
  ) {}

  /** 部屋に入るとき（参加のタップ）に呼ぶ。 */
  hold(): void {
    this.want = true;
    void this.acquire();
  }

  /** 画面に戻ったとき・操作のたびに呼ぶ。手放していたら取り直す。 */
  refresh(): void {
    if (this.want && this.sentinel === null) void this.acquire();
  }

  /** 部屋を出たとき。 */
  release(): void {
    this.want = false;
    const s = this.sentinel;
    this.sentinel = null;
    if (s && !s.released) s.release().catch(() => undefined);
  }

  get held(): boolean {
    return this.sentinel !== null;
  }

  private async acquire(): Promise<void> {
    if (!this.api || this.pending || this.sentinel !== null || !this.visible()) return;
    this.pending = true;
    try {
      const s = await this.api.request('screen');
      if (!this.want) {
        s.release().catch(() => undefined);
        return;
      }
      this.sentinel = s;
      s.addEventListener('release', () => {
        if (this.sentinel === s) this.sentinel = null;
      });
    } catch {
      // 省電力モード・非対応・画面が隠れている。次の refresh でまた試す。
    } finally {
      this.pending = false;
    }
  }
}
