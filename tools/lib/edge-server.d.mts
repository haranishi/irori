export const ROOT: string;
export const QUIET_ENV: Record<string, string>;

export function pickPorts(n: number, range: { from: number; to: number }): Promise<number[]>;

export function buildWeb(opts?: { outDir?: string }): { outDir: string; cleanup(): void };

export interface EdgeServer {
  name: string;
  url: string;
  port: number;
  stop(): Promise<void>;
  output(): string;
}

export function startEdge(opts: {
  name: string;
  assetsDir: string;
  port: number;
  inspectorPort: number;
  vars?: Record<string, string>;
  timeoutMs?: number;
}): Promise<EdgeServer>;
