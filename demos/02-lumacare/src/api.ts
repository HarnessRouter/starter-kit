export type StreamEvent = { type: string; [key: string]: any };

export class SSEParser {
  private buffer = '';

  push(chunk: string): StreamEvent[] {
    this.buffer += chunk;
    const events: StreamEvent[] = [];
    let boundary = this.buffer.search(/\r?\n\r?\n/);
    while (boundary >= 0) {
      const frame = this.buffer.slice(0, boundary);
      const size = this.buffer.slice(boundary).match(/^\r?\n\r?\n/)?.[0].length || 2;
      this.buffer = this.buffer.slice(boundary + size);
      const event = this.parseFrame(frame);
      if (event) events.push(event);
      boundary = this.buffer.search(/\r?\n\r?\n/);
    }
    return events;
  }

  flush(): StreamEvent[] {
    const event = this.parseFrame(this.buffer);
    this.buffer = '';
    return event ? [event] : [];
  }

  private parseFrame(frame: string): StreamEvent | null {
    const data = frame.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return null;
    try { return JSON.parse(data) as StreamEvent; } catch { return null; }
  }
}

export const apiHeaders = (userId: string, json = false) => ({
  'x-demo-user': userId,
  ...(json ? { 'Content-Type': 'application/json' } : {}),
});

export async function api<T>(path: string, userId: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, headers: { ...apiHeaders(userId, Boolean(init.body)), ...(init.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Request failed');
  return body as T;
}
