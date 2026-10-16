import { describe, expect, it } from 'vitest';
import { INITIAL, inGame, next, padOwner, stateName, type Machine, type Signal } from '../../src/host/machine';

const run = (...signals: Signal[]): Machine => signals.reduce(next, INITIAL);

describe('ホストの状態遷移', () => {
  it('boot → connecting → home ⇄ detail → launching → playing ⇄ paused → results → home', () => {
    const seen: string[] = [];
    let m = INITIAL;
    for (const s of ['start', 'welcome', 'open', 'back', 'open', 'launch', 'ready', 'pause', 'continue', 'end', 'home'] as Signal[]) {
      m = next(m, s);
      seen.push(stateName(m));
    }
    expect(seen).toEqual(['connecting', 'home', 'detail', 'home', 'detail', 'launching', 'playing', 'paused', 'playing', 'results', 'home']);
  });

  it('結果から「もう一度」で launching に戻る', () => {
    expect(stateName(run('start', 'welcome', 'open', 'launch', 'ready', 'end', 'launch'))).toBe('launching');
  });

  it('当てはまらない信号は無視する（ホームでいきなり ready・end は来ない扱い）', () => {
    const home = run('start', 'welcome');
    for (const s of ['ready', 'end', 'pause', 'continue', 'back', 'launch'] as Signal[]) expect(next(home, s)).toBe(home);
  });

  it('ready が来ない：slow →「待つ」で none に戻り、ready で playing。始められない：failed → ホームか、もう一度', () => {
    const slow = run('start', 'welcome', 'open', 'launch', 'slow');
    expect(slow).toMatchObject({ phase: 'launching', issue: 'slow' });
    expect(next(slow, 'patience')).toMatchObject({ phase: 'launching', issue: 'none' });
    expect(next(slow, 'ready')).toMatchObject({ phase: 'playing', issue: 'none' });
    const failed = next(slow, 'failed');
    expect(failed).toMatchObject({ phase: 'launching', issue: 'failed' });
    expect(next(failed, 'ready')).toBe(failed);
    expect(next(failed, 'end')).toBe(failed);
    expect(stateName(next(failed, 'home'))).toBe('home');
    expect(next(failed, 'launch')).toMatchObject({ phase: 'launching', issue: 'none' });
  });

  it('遊んでいる最中に枠が止まると failed（ホームへ戻る道を出す）', () => {
    expect(run('start', 'welcome', 'open', 'launch', 'ready', 'failed')).toMatchObject({ phase: 'launching', issue: 'failed' });
  });

  it('offline は覆い：下の画面を覚え、welcome で戻る。覆いの下でも end は結果へ進む', () => {
    const playing = run('start', 'welcome', 'open', 'launch', 'ready');
    const lost = next(playing, 'lost');
    expect(stateName(lost)).toBe('offline');
    expect(lost.phase).toBe('playing');
    expect(stateName(next(lost, 'welcome'))).toBe('playing');
    const ended = next(lost, 'end');
    expect(stateName(ended)).toBe('offline');
    expect(stateName(next(ended, 'welcome'))).toBe('results');
  });

  it('replaced は覆いで、welcome（ここで続ける→つながった）で外れる。lost は replaced を上書きする', () => {
    const r = next(run('start', 'welcome'), 'replaced');
    expect(stateName(r)).toBe('replaced');
    expect(stateName(next(r, 'welcome'))).toBe('home');
    expect(stateName(next(r, 'lost'))).toBe('offline');
  });

  it('部屋を作れない：connecting → busy → retry → connecting。部屋のない状態では lost を覆いにしない', () => {
    const busy = run('start', 'busy');
    expect(stateName(busy)).toBe('busy');
    expect(next(busy, 'lost')).toBe(busy);
    expect(stateName(next(busy, 'retry'))).toBe('connecting');
  });

  it('作りに行けない（回線がない）ときは、connecting の上に offline の覆い', () => {
    expect(stateName(run('start', 'lost'))).toBe('offline');
    expect(stateName(run('start', 'lost', 'welcome'))).toBe('home');
  });

  it('closed はどこからでも。retry で新しい部屋へ', () => {
    for (const before of [run('start', 'welcome'), run('start', 'welcome', 'open', 'launch', 'ready'), run('start', 'welcome', 'lost')]) {
      const c = next(before, 'closed');
      expect(stateName(c)).toBe('closed');
      expect(stateName(next(c, 'retry'))).toBe('connecting');
    }
  });

  it('スマホの画面の担い手：ホーム・詳細・結果・メニューはコンソール、遊んでいる間はゲーム、失敗の画面はコンソール', () => {
    expect(padOwner(run('start', 'welcome'))).toBe('console');
    expect(padOwner(run('start', 'welcome', 'open'))).toBe('console');
    expect(padOwner(run('start', 'welcome', 'open', 'launch'))).toBe('game');
    expect(padOwner(run('start', 'welcome', 'open', 'launch', 'slow'))).toBe('console');
    expect(padOwner(run('start', 'welcome', 'open', 'launch', 'ready'))).toBe('game');
    expect(padOwner(run('start', 'welcome', 'open', 'launch', 'ready', 'pause'))).toBe('console');
    expect(padOwner(run('start', 'welcome', 'open', 'launch', 'ready', 'end'))).toBe('console');
    expect(padOwner(run('start'))).toBe('none');
    expect(padOwner(run('start', 'busy'))).toBe('none');
  });

  it('inGame は枠を持つ状態（覆いの下を含む）', () => {
    expect(inGame(run('start', 'welcome', 'open', 'launch', 'ready', 'lost'))).toBe(true);
    expect(inGame(run('start', 'welcome', 'open'))).toBe(false);
  });
});
