import { useEffect, useRef, useCallback, useState } from 'react'
import { SSEClient, type SSEMessageHandler } from '@/lib/sse'

interface UseSSEOptions {
  url: string
  body?: unknown
  enabled?: boolean
  onMessage?: SSEMessageHandler
  onError?: (error: Error) => void
}

export function useSSE({ url, body, enabled = false, onMessage, onError }: UseSSEOptions) {
  const clientRef = useRef<SSEClient | null>(null)
  const [connected, setConnected] = useState(false)

  const connect = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.disconnect()
    }

    const client = new SSEClient({
      url,
      body,
      onMessage,
      onError,
      onOpen: () => setConnected(true),
      onClose: () => setConnected(false),
    })

    clientRef.current = client
    void client.connect()
  }, [url, body, onMessage, onError])

  const disconnect = useCallback(() => {
    clientRef.current?.disconnect()
    clientRef.current = null
    setConnected(false)
  }, [])

  useEffect(() => {
    if (enabled) {
      connect()
    } else {
      disconnect()
    }
    return () => disconnect()
  }, [enabled, connect, disconnect])

  return { connected, connect, disconnect, client: clientRef.current }
}
