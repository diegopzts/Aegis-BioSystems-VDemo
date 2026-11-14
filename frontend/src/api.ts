import { useEffect, useState } from 'react'

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/${path}`, init)
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(typeof body?.detail === 'string' ? body.detail : `Request failed (${response.status}).`)
  }
  return response.json()
}

export function post<T>(path: string, data: unknown): Promise<T> {
  return request<T>(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)})
}

export function useResource<T>(path: string, revision = 0, keepPrevious = false) {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{key: string; data?: T; error?: string}>({key: ''})
  const key = `${path}|${revision}|${attempt}`
  useEffect(() => {
    const controller = new AbortController()
    request<T>(path, {signal: controller.signal})
      .then(data => { if (!controller.signal.aborted) setResult({key, data}) })
      .catch(error => { if (!controller.signal.aborted) setResult(previous => ({key, error: error.message,
        data: keepPrevious && previous.key.split('|')[0] === path ? previous.data : undefined})) })
    return () => controller.abort()
  }, [path, key, keepPrevious])
  return {
    data: result.key === key || (keepPrevious && result.key.split('|')[0] === path) ? result.data : undefined,
    error: result.key === key ? result.error : undefined,
    retry: () => setAttempt(previous => previous + 1),
  }
}
