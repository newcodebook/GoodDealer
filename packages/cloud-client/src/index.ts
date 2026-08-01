export interface CloudTransport {
  send<TResult>(endpointId: string, payload: unknown): Promise<TResult>;
}
