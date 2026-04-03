import { getValidToken } from './auth'

export type SSEMessageType =
  | 'text_chunk'
  | 'text_complete'
  | 'tool_call_start'
  | 'tool_call_result'
  | 'confirmation_card'
  | 'data_card'
  | 'process_indicator'
  | 'thinking'
  | 'error'
  | 'escalate'
  | 'context_summary'
  | 'stream_end'

export interface SSEMessage {
  type: SSEMessageType
  data: unknown
  id?: string
}

export type SSEMessageHandler = (message: SSEMessage) => void

interface SSEClientOptions {
  url: string
  body?: unknown
  onMessage?: SSEMessageHandler
  onError?: (error: Error) => void
  onOpen?: () => void
  onClose?: () => void
  maxRetries?: number
  retryDelay?: number
}

export class SSEClient {
  private abortController: AbortController | null = null
  private handlers = new Map<string, SSEMessageHandler[]>()
  private globalHandler: SSEMessageHandler | null = null
  private retryCount = 0
  private options: SSEClientOptions
  private _connected = false

  get connected(): boolean {
    return this._connected
  }

  constructor(options: SSEClientOptions) {
    this.options = options
    if (options.onMessage) {
      this.globalHandler = options.onMessage
    }
  }

  on(type: SSEMessageType, handler: SSEMessageHandler): () => void {
    const existing = this.handlers.get(type) || []
    existing.push(handler)
    this.handlers.set(type, existing)
    return () => {
      const handlers = this.handlers.get(type)
      if (handlers) {
        const idx = handlers.indexOf(handler)
        if (idx >= 0) handlers.splice(idx, 1)
      }
    }
  }

  async connect(): Promise<void> {
    const token = await getValidToken()
    this.abortController = new AbortController()

    const baseUrl = import.meta.env.VITE_API_BASE_URL || ''
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    }
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    try {
      const response = await fetch(`${baseUrl}${this.options.url}`, {
        method: 'POST',
        headers,
        body: this.options.body ? JSON.stringify(this.options.body) : undefined,
        signal: this.abortController.signal,
      })

      if (!response.ok) {
        throw new Error(`SSE connection failed: ${response.status}`)
      }

      if (!response.body) {
        throw new Error('Response body is null')
      }

      this._connected = true
      this.retryCount = 0
      this.options.onOpen?.()

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        let currentEvent = ''
        let currentData = ''

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim()
          } else if (line.startsWith('data: ')) {
            currentData = line.slice(6)
          } else if (line === '' && currentData) {
            this.dispatchEvent(currentEvent, currentData)
            currentEvent = ''
            currentData = ''
          }
        }
      }

      this._connected = false
      this.options.onClose?.()
    } catch (err) {
      this._connected = false
      if ((err as Error).name === 'AbortError') return

      this.options.onError?.(err as Error)
      this.maybeRetry()
    }
  }

  private dispatchEvent(event: string, data: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch {
      parsed = data
    }

    const type = (event || 'text_chunk') as SSEMessageType
    const message: SSEMessage = { type, data: parsed }

    this.globalHandler?.(message)

    const typeHandlers = this.handlers.get(type)
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        handler(message)
      }
    }
  }

  private maybeRetry(): void {
    const maxRetries = this.options.maxRetries ?? 3
    const retryDelay = this.options.retryDelay ?? 3000

    if (this.retryCount < maxRetries) {
      this.retryCount++
      setTimeout(() => void this.connect(), retryDelay * this.retryCount)
    }
  }

  disconnect(): void {
    this.abortController?.abort()
    this.abortController = null
    this._connected = false
  }
}
