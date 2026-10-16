export class Line {
  static start(targetPort: number, port: number): Promise<Line>;
  readonly port: number;
  readonly url: string;
  readonly liveSockets: number;
  wsOpened: number;
  blockNew: boolean;
  freeze(): number;
  cutServer(): number;
  drop(): number;
  unblock(): void;
  close(): Promise<void>;
}
