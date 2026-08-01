export interface TauriTransport {
  invoke<TResult>(command: string, payload: unknown): Promise<TResult>;
}
