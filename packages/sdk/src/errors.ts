export type IroriErrorCode =
  | 'handshake-timeout'
  | 'bad-pad'
  | 'bad-target'
  | 'bad-vibrate'
  | 'bad-results'
  | 'unsupported-feature'
  | 'storage-key'
  | 'storage-too-large'
  | 'storage-quota'
  | 'storage-unavailable'
  | 'storage-timeout';

export class IroriError extends Error {
  readonly code: IroriErrorCode;

  constructor(code: IroriErrorCode, message?: string) {
    super(message ? `${code}: ${message}` : code);
    this.name = 'IroriError';
    this.code = code;
  }
}
