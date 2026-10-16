// 入力の間引き（SEND_RATE_HZ）。値が変わらないあいだは送らず、間隔の内側で来た値は最後の1つだけを残して、
// 間隔が空いたら必ず送る。止まった位置（スティックを離した0,0など）を取りこぼさないため。
//
// 押したままの送り直し（HELD_REPEAT_MS）：axis と ptr は、押している間は値が変わらなくても一定の間隔で送り直す。
// 離した知らせが届かないまま接続が死んでも、ゲームが「しばらく来なければ止める」と判断できるようにするため。
// 送り直しも、ふつうの送信と同じ間引きを通る。送信のたびに、次の送り直しまでの時間を数え直す。

export interface HeldRepeat<T> {
  ms: number;
  /** 最後に送った値から、送り直す値を決める。押していない（中立・離した）なら null で、送り直しを止める。 */
  value: (last: T) => T | null;
}

export class Throttle<T> {
  private last: T | undefined;
  private lastAt = Number.NEGATIVE_INFINITY;
  private pending: T | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private repeatTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly intervalMs: number,
    private readonly emit: (value: T) => void,
    private readonly same: (a: T, b: T) => boolean,
    initial?: T,
    private readonly repeat?: HeldRepeat<T>,
  ) {
    this.last = initial;
  }

  /** 間引いて送る。 */
  push(value: T): void {
    if (this.timer !== undefined) {
      this.pending = value;
      return;
    }
    if (this.last !== undefined && this.same(value, this.last)) return;
    const wait = this.lastAt + this.intervalMs - performance.now();
    if (wait <= 0) {
      this.send(value);
      return;
    }
    this.pending = value;
    // setTimeout は小数を切り捨てる。切り上げないと、66.7ms の間隔が66msになって上限をわずかに超える。
    this.timer = setTimeout(() => this.flush(), Math.ceil(wait));
  }

  /** 間引かずに、すぐ送る（なぞりの始まりと終わり）。待っている値は捨てる。 */
  now(value: T): void {
    this.cancel();
    this.send(value);
  }

  /** 押したままの入力を終わらせる。最後に送った値と同じなら送らない。 */
  settle(value: T): void {
    this.cancel();
    if (this.last === undefined || !this.same(value, this.last)) this.send(value);
  }

  /** 待っている値と送り直しを捨てる。 */
  cancel(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = undefined;
    this.stopRepeat();
  }

  private flush(): void {
    this.timer = undefined;
    const value = this.pending;
    this.pending = undefined;
    if (value !== undefined && (this.last === undefined || !this.same(value, this.last))) this.send(value);
  }

  private send(value: T): void {
    this.last = value;
    this.lastAt = performance.now();
    this.emit(value);
    this.armRepeat(value);
  }

  private stopRepeat(): void {
    if (this.repeatTimer !== undefined) clearTimeout(this.repeatTimer);
    this.repeatTimer = undefined;
  }

  /** 送ったばかりの値を起点に、次の送り直しを数え直す。押していなければ止める。 */
  private armRepeat(sent: T): void {
    this.stopRepeat();
    const next = this.repeat?.value(sent) ?? null;
    if (next === null || !this.repeat) return;
    this.repeatTimer = setTimeout(() => this.fireRepeat(next), this.repeat.ms);
  }

  private fireRepeat(next: T): void {
    this.repeatTimer = undefined;
    // ふつうの送信と同じく、間引きの間隔は守る。新しい値が待っていれば、その送信で数え直しになる。
    const wait = this.timer !== undefined ? this.intervalMs : this.lastAt + this.intervalMs - performance.now();
    if (wait > 0) {
      this.repeatTimer = setTimeout(() => this.fireRepeat(next), Math.ceil(wait));
      return;
    }
    this.send(next);
  }
}
