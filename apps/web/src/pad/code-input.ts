// 4つの枠のコード入力。小文字・全角は直し、使えない文字は入れない。貼り付けは枠に振り分け、打つと次の枠へ進む。
// 変換中（日本語のキーボード）は値に触らず、変換が終わってから直す。
import { LIMITS } from '@irori/protocol';
import { h } from '../shared/dom';
import { t } from '../shared/i18n';
import { codeChars } from './room';

export interface CodeInput {
  readonly el: HTMLElement;
  focus(): void;
  value(): string;
  setError(message: string | null): void;
}

export function codeInput(opts: {
  prefill: string;
  onComplete: (code: string) => void;
  onBadChar: () => void;
  onChange?: (value: string) => void;
}): CodeInput {
  const n = LIMITS.CODE_LENGTH;
  const boxes: HTMLInputElement[] = [];
  const group = h('div', { class: 'pp-code', attrs: { role: 'group', 'aria-label': t('pad.entry.group') } });

  const value = () => boxes.map((b) => b.value).join('');
  const mark = () => {
    for (const b of boxes) {
      if (b.value) b.dataset.filled = '';
      else delete b.dataset.filled;
    }
    opts.onChange?.(value());
  };
  const complete = () => {
    const v = value();
    if (v.length === n) opts.onComplete(v);
  };
  /** i 番目から順に chars を入れ、次に打つ枠へ移る。 */
  const fill = (from: number, chars: string) => {
    let i = from;
    for (const c of chars) {
      if (i >= n) break;
      boxes[i]!.value = c;
      i++;
    }
    mark();
    const next = boxes.find((b) => b.value === '') ?? boxes[Math.min(i, n - 1)]!;
    next.focus();
    complete();
  };

  for (let i = 0; i < n; i++) {
    const box = h('input', {
      class: 'pp-code__box',
      attrs: {
        type: 'text',
        inputmode: 'text',
        autocomplete: 'off',
        autocapitalize: 'characters',
        autocorrect: 'off',
        spellcheck: 'false',
        enterkeyhint: i === n - 1 ? 'go' : 'next',
        'aria-label': t('pad.entry.box', { n: i + 1 }),
      },
    });
    const take = () => {
      const raw = box.value;
      const chars = codeChars(raw);
      if (chars === '') {
        box.value = '';
        mark();
        if (raw !== '') opts.onBadChar();
        return;
      }
      box.value = '';
      fill(i, chars);
    };
    box.addEventListener('input', (e) => {
      if ((e as InputEvent).isComposing) return;
      take();
    });
    box.addEventListener('compositionend', take);
    box.addEventListener('paste', (e) => {
      const text = e.clipboardData?.getData('text') ?? '';
      e.preventDefault();
      const chars = codeChars(text);
      if (chars === '') {
        if (text !== '') opts.onBadChar();
        return;
      }
      if (chars.length >= n) for (const b of boxes) b.value = '';
      fill(chars.length >= n ? 0 : i, chars);
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && box.value === '' && i > 0) {
        e.preventDefault();
        const prev = boxes[i - 1]!;
        prev.value = '';
        mark();
        prev.focus();
      } else if (e.key === 'ArrowLeft' && i > 0) {
        e.preventDefault();
        boxes[i - 1]!.focus();
      } else if (e.key === 'ArrowRight' && i < n - 1) {
        e.preventDefault();
        boxes[i + 1]!.focus();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        complete();
      }
    });
    // 打ち直しやすいように、枠に入ったら中身を選ぶ。
    box.addEventListener('focus', () => box.select());
    boxes.push(box);
    group.append(box);
  }

  const pre = codeChars(opts.prefill).slice(0, n);
  for (let i = 0; i < pre.length; i++) boxes[i]!.value = pre[i]!;
  mark();

  return {
    el: group,
    focus: () => (boxes.find((b) => b.value === '') ?? boxes[n - 1]!).focus(),
    value,
    setError: (message) => {
      if (message) group.dataset.error = '';
      else delete group.dataset.error;
      for (const b of boxes) b.setAttribute('aria-invalid', message ? 'true' : 'false');
    },
  };
}
