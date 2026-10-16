export interface JsFile {
  path: string;
  bytes: number;
  gzip: number;
}

export function padJsSizes(distDir: string): { files: JsFile[]; totalBytes: number; totalGzip: number };
