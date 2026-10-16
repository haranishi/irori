// 日本語の折り返しの部品は、ホストの画面と共有する（apps/web/src/shared/phrase.ts）。この名前は、スマホの画面の import を保つための再公開。
import { phrase } from '../shared/phrase';

export { chunks, phrase, softBreaks } from '../shared/phrase';

/** 句読点のあとで文を分ける（閉じかっこは前の節に付ける）。 */
const CLAUSE = /[^、。！？]*[、。！？]+[」』）]*|[^、。！？]+$/gu;

/**
 * 句読点（、。！？）で区切った節ごとに包む（.pp-cl）。節の中は phrase() の塊のあいだで折る。
 * 一行に入りきらない節は次の行から始まるので、文は句読点のあとで折れ、「声を／かけて」のような折れ方を避けられる。
 */
export function clauses(text: string): Node[] {
  const parts = text.match(CLAUSE);
  if (!parts || parts.length < 2 || parts.join('') !== text) return phrase(text);
  const out: Node[] = [];
  parts.forEach((p, i) => {
    if (i > 0) out.push(document.createElement('wbr'));
    const span = document.createElement('span');
    span.className = 'pp-cl';
    span.append(...phrase(p));
    out.push(span);
  });
  return out;
}
