// 変異試験の1コマンドを、時間切れつきで走らせる。終わったあと（時間切れでも、普通の終わりでも）、
// 残った子孫のプロセスをプロセスグループごと止める。npm だけを止めると、その下の vitest の作業プロセスや
// wrangler の子が孤児になって、何分も残る（実害：2026-10-16 に約17分、2本）。
//
// 使い方：node guard.mjs <時間切れのミリ秒> <作業フォルダ> <コマンド> [引数…]
// 終了コード：コマンドの終了コード。時間切れは 124。起動できなければ 127。
import { spawn } from 'node:child_process';

const [timeoutArg, cwd, ...command] = process.argv.slice(2);
const timeoutMs = Number(timeoutArg);
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !cwd || command.length === 0) {
  console.error('guard: 使い方 node guard.mjs <ミリ秒> <作業フォルダ> <コマンド…>');
  process.exit(2);
}

// detached にすると、子が新しいプロセスグループの先頭になる。孫もそのグループに入る。
const child = spawn(command[0], command.slice(1), { cwd, detached: true, stdio: ['ignore', 'inherit', 'inherit'] });
let timedOut = false;

function killGroup() {
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    // もう誰も残っていない
  }
}

const timer = setTimeout(() => {
  timedOut = true;
  killGroup();
}, timeoutMs);

child.on('error', (err) => {
  clearTimeout(timer);
  console.error(`guard: 起動できません: ${err.message}`);
  process.exit(127);
});

child.on('exit', (code, signal) => {
  clearTimeout(timer);
  killGroup();
  process.exit(timedOut ? 124 : (code ?? (signal ? 128 : 1)));
});
