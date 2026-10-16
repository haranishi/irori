export declare const ENV: {
  readonly main: string;
  readonly extra: string;
  readonly dev: string;
  readonly external: string;
  readonly dist: string;
  readonly shelf: string;
};
export declare function env(key: keyof typeof ENV): string;
