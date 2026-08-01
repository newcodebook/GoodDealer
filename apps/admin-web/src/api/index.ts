export interface AdminApiTransport {
  request<TResult>(operation: string, payload: unknown): Promise<TResult>;
}
