// 試験の前に wrangler dev を3つ起動し、URL を試験に渡す。
// main  : 上書きあり。短い猶予（1〜2秒）、席3つ、作成と存在確認の回数を小さくした栓。
// caps  : 上書きなし。運営者の値 MAX_ROOMS_PER_DAY=3（503 の試験）と、開発用の DEV_FRAMES=1。
//         PUBLIC_URL は不正な値（リクエストのオリジンに戻ること）。
// plain : ALLOW_TEST_OVERRIDES が "1" でない。上書きの値を渡しても効かないこと、PUBLIC_URL が効くこと、
//         不正な MAX_ROOMS_PER_DAY が既定に戻ること、DEV_FRAMES が "1" 以外では効かないことを見る。
import type { TestProject } from 'vitest/node';
import { pickPorts, startEdge, type EdgeServer } from './server';

declare module 'vitest' {
  export interface ProvidedContext {
    edge: { main: string; caps: string; plain: string };
  }
}

export const MAIN_VARS = {
  ALLOW_TEST_OVERRIDES: '1',
  HELLO_TIMEOUT_MS: '1000',
  PAD_GRACE_MS: '1500',
  HOST_GRACE_MS: '2000',
  MAX_PLAYERS: '3',
  CREATE_TTL_S: '30',
  CREATE_PER_IP_PER_MINUTE: '3',
  LOOKUP_PER_IP_PER_MINUTE: '4',
  MAX_ROOMS_PER_DAY: '1000',
};

export const PLAIN_VARS = {
  ALLOW_TEST_OVERRIDES: 'true',
  PUBLIC_URL: 'https://irori.example',
  HELLO_TIMEOUT_MS: '100',
  PAD_GRACE_MS: '100',
  HOST_GRACE_MS: '100',
  ROOM_IDLE_MS: '100',
  MAX_PLAYERS: '2',
  CREATE_TTL_S: '5',
  CREATE_PER_IP_PER_MINUTE: '1',
  LOOKUP_PER_IP_PER_MINUTE: '1',
  MAX_ROOMS_PER_DAY: '0',
  DEV_FRAMES: 'true',
};

export const CAPS_VARS = { MAX_ROOMS_PER_DAY: '3', PUBLIC_URL: 'javascript:alert(1)', DEV_FRAMES: '1' };

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const ports = await pickPorts(6);
  const specs = [
    { name: 'main', vars: MAIN_VARS },
    { name: 'caps', vars: CAPS_VARS },
    { name: 'plain', vars: PLAIN_VARS },
  ];
  const started = await Promise.allSettled(
    specs.map((s, i) => startEdge({ name: s.name, vars: s.vars, port: ports[i * 2]!, inspectorPort: ports[i * 2 + 1]! })),
  );
  const servers = started.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  const failed = started.find((r) => r.status === 'rejected');
  if (failed) {
    await Promise.all(servers.map((s) => s.stop()));
    throw (failed as PromiseRejectedResult).reason;
  }
  const by = Object.fromEntries(servers.map((s) => [s.name, s])) as Record<string, EdgeServer>;
  project.provide('edge', { main: by.main!.url, caps: by.caps!.url, plain: by.plain!.url });
  return async () => {
    await Promise.all(servers.map((s) => s.stop()));
  };
}
