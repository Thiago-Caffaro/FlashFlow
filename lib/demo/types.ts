import type { DemoStore } from './store'

export interface DemoRequest {
  method: string
  path: string
  params: Record<string, string>
  query: URLSearchParams
  body: unknown
}

export interface DemoResult {
  status?: number
  json: Record<string, unknown>
}

export type DemoHandler = (req: DemoRequest, store: DemoStore) => DemoResult | Promise<DemoResult>
