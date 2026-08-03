import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Request, type Response } from 'express';
import { authenticate, DEMO_USERS } from './auth.js';
import { OwnershipStore } from './store.js';
import type { RunRecord } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const agentMap = JSON.parse(fs.readFileSync(path.join(root, 'config/agents.json'), 'utf8')) as Record<string, string>;
const store = new OwnershipStore(path.join(root, 'data/ownership.json'));
const apiBase = 'https://api.harnessrouter.ai';
const apiKey = process.env.HR_API_KEY;

if (!apiKey) throw new Error('HR_API_KEY is missing. Add it to the server-only .env file.');

export const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

function upstreamHeaders(extra: Record<string, string> = {}) {
  return { Authorization: `Bearer ${apiKey}`, ...extra };
}

async function upstreamJson(urlPath: string, init: RequestInit = {}) {
  const response = await fetch(`${apiBase}${urlPath}`, {
    ...init,
    headers: upstreamHeaders({ ...(init.headers as Record<string, string> || {}) }),
  });
  const data = await response.json().catch(() => ({ detail: 'HarnessRouter returned an unreadable response.' }));
  if (!response.ok) {
    const error = new Error(String((data as { detail?: string }).detail || `HarnessRouter request failed (${response.status})`));
    Object.assign(error, { status: response.status });
    throw error;
  }
  return data;
}

function errorResponse(res: Response, error: unknown) {
  const value = error as { status?: number; message?: string };
  const status = value.status && value.status >= 400 && value.status < 600 ? value.status : 502;
  res.status(status).json({ error: value.message || 'LumaCare could not be reached.' });
}

function requireOwnership(req: Request, res: Response): RunRecord | null {
  const record = store.getAuthorized(String(req.params.sessionId), req.productUser.id);
  if (!record) {
    res.status(404).json({ error: 'Session not found' });
    return null;
  }
  return record;
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api', authenticate);

app.get('/api/config', (req, res) => {
  res.json({
    user: req.productUser,
    users: Object.values(DEMO_USERS),
    features: Object.keys(agentMap),
    agent: { name: 'LumaCare Pediatric Oncology Companion', model: 'GPT-5.6 Sol' },
  });
});

app.get('/api/sessions', (req, res) => {
  res.json({ sessions: store.list(req.productUser.id) });
});

app.post('/api/runs', async (req, res) => {
  const featureKey = String(req.body.featureKey || '');
  const input = String(req.body.input || '').trim();
  const previousResponseId = req.body.previousResponseId ? String(req.body.previousResponseId) : null;
  const sessionId = req.body.sessionId ? String(req.body.sessionId) : null;
  const harnessId = agentMap[featureKey];

  if (!harnessId) return res.status(400).json({ error: 'Unknown feature' });
  if (!input || input.length > 20_000) return res.status(400).json({ error: 'Enter a task under 20,000 characters.' });
  if ((previousResponseId || sessionId) && !(previousResponseId && sessionId)) {
    return res.status(400).json({ error: 'A continuation requires both recovery identifiers.' });
  }
  if (sessionId && !store.getAuthorized(sessionId, req.productUser.id)) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const requestBody: Record<string, unknown> = { input, stream: true };
  if (previousResponseId && sessionId) {
    requestBody.previous_response_id = previousResponseId;
    requestBody.metadata = { session_id: sessionId };
  }

  let upstream: globalThis.Response;
  try {
    upstream = await fetch(`${apiBase}/${harnessId}/v1/responses`, {
      method: 'POST',
      headers: upstreamHeaders({
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      }),
      body: JSON.stringify(requestBody),
    });
  } catch {
    return res.status(502).json({ error: 'HarnessRouter could not be reached.' });
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.json().catch(() => ({ detail: 'Agent request failed.' })) as { detail?: string };
    return res.status(upstream.status || 502).json({ error: detail.detail || 'Agent request failed.' });
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let recoveredSessionId = sessionId;
  let recoveredResponseId = previousResponseId;

  const handleFrame = (frame: string) => {
    const dataLines = frame.split(/\r?\n/).filter((line) => line.startsWith('data:'));
    if (!dataLines.length) return;
    const raw = dataLines.map((line) => line.slice(5).trimStart()).join('\n');
    if (raw === '[DONE]') return;
    try {
      const event = JSON.parse(raw) as any;
      if (event.type === 'response.created') {
        recoveredResponseId = event.response?.id || recoveredResponseId;
        recoveredSessionId = event.response?.metadata?.session_id || recoveredSessionId;
        if (recoveredResponseId && recoveredSessionId) {
          const now = new Date().toISOString();
          const existing = store.getAuthorized(recoveredSessionId, req.productUser.id);
          store.save({
            sessionId: recoveredSessionId,
            responseId: recoveredResponseId,
            userId: req.productUser.id,
            featureKey,
            title: existing?.title || (input.length > 62 ? `${input.slice(0, 62)}…` : input),
            prompt: existing?.prompt || input,
            createdAt: existing?.createdAt || now,
            updatedAt: now,
            status: 'running',
          });
        }
      }
      const statusMap: Record<string, string> = {
        'response.completed': 'completed',
        'response.incomplete': 'incomplete',
        'response.failed': event.response?.status === 'cancelled' ? 'cancelled' : 'failed',
      };
      if (recoveredSessionId && statusMap[event.type]) {
        store.update(recoveredSessionId, {
          responseId: event.response?.id || recoveredResponseId || '',
          status: statusMap[event.type],
        });
      }
    } catch {
      // Unknown or malformed upstream frames are forwarded but never crash the stream.
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      if (!res.closed) res.write(text);
      buffer += text;
      let boundary = buffer.search(/\r?\n\r?\n/);
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/)?.[0].length || 2;
        buffer = buffer.slice(boundary + separator);
        handleFrame(frame);
        boundary = buffer.search(/\r?\n\r?\n/);
      }
    }
    if (buffer.trim()) handleFrame(buffer);
  } catch {
    if (!res.closed) {
      res.write(`data: ${JSON.stringify({ type: 'lumacare.stream.disconnected', response: { id: recoveredResponseId, metadata: { session_id: recoveredSessionId } } })}\n\n`);
    }
  } finally {
    if (!res.closed) res.end();
  }
});

app.get('/api/sessions/:sessionId', async (req, res) => {
  const record = requireOwnership(req, res);
  if (!record) return;
  try {
    const [session, turns, files] = await Promise.all([
      upstreamJson(`/v1/sessions/${encodeURIComponent(record.sessionId)}`),
      upstreamJson(`/v1/sessions/${encodeURIComponent(record.sessionId)}/turns`),
      upstreamJson(`/v1/sessions/${encodeURIComponent(record.sessionId)}/files?changed=true`),
    ]);
    const upstreamStatus = String((session as any).status || '');
    const mapped = upstreamStatus === 'done' ? 'completed' : upstreamStatus;
    if (mapped && mapped !== 'running' && mapped !== 'starting') store.update(record.sessionId, { status: mapped });
    res.json({ record: { ...record, status: mapped || record.status }, session, turns, files });
  } catch (error) {
    errorResponse(res, error);
  }
});

app.post('/api/sessions/:sessionId/cancel', async (req, res) => {
  const record = requireOwnership(req, res);
  if (!record) return;
  try {
    const result = await upstreamJson(`/v1/sessions/${encodeURIComponent(record.sessionId)}/cancel`, { method: 'POST' });
    store.update(record.sessionId, { status: 'cancelled' });
    res.json(result);
  } catch (error) {
    errorResponse(res, error);
  }
});

async function getAuthorizedFile(req: Request, res: Response) {
  const record = requireOwnership(req, res);
  if (!record) return null;
  const listing = await upstreamJson(`/v1/sessions/${encodeURIComponent(record.sessionId)}/files`) as any;
  const file = (listing.files || []).find((item: any) => item.file_id === req.params.fileId);
  if (!file) {
    res.status(404).json({ error: 'File not found' });
    return null;
  }
  return { record, file };
}

app.get('/api/sessions/:sessionId/files/:fileId/preview', async (req, res) => {
  try {
    const found = await getAuthorizedFile(req, res);
    if (!found) return;
    const officeTypes = new Set([
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ]);
    const suffix = officeTypes.has(found.file.media_type) ? '/pdf' : '/content';
    const upstream = await fetch(`${apiBase}/v1/containers/${encodeURIComponent(found.record.sessionId)}/files/${encodeURIComponent(found.file.file_id)}${suffix}`, { headers: upstreamHeaders() });
    if (!upstream.ok || !upstream.body) return res.status(upstream.status).json({ error: 'Preview unavailable' });
    const mediaType = officeTypes.has(found.file.media_type) ? 'application/pdf' : found.file.media_type || 'application/octet-stream';
    res.setHeader('Content-Type', mediaType);
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(found.file.path).replace(/["\r\n]/g, '_')}"`);
    const bytes = Buffer.from(await upstream.arrayBuffer());
    res.send(bytes);
  } catch (error) {
    errorResponse(res, error);
  }
});

app.get('/api/sessions/:sessionId/files/:fileId/download', async (req, res) => {
  try {
    const found = await getAuthorizedFile(req, res);
    if (!found) return;
    const upstream = await fetch(`${apiBase}/v1/containers/${encodeURIComponent(found.record.sessionId)}/files/${encodeURIComponent(found.file.file_id)}/content`, { headers: upstreamHeaders() });
    if (!upstream.ok || !upstream.body) return res.status(upstream.status).json({ error: 'Download unavailable' });
    const filename = path.basename(found.file.path).replace(/["\r\n]/g, '_');
    res.setHeader('Content-Type', found.file.media_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    errorResponse(res, error);
  }
});

app.get('/api/sessions/:sessionId/archive', async (req, res) => {
  const record = requireOwnership(req, res);
  if (!record) return;
  try {
    const upstream = await fetch(`${apiBase}/v1/sessions/${encodeURIComponent(record.sessionId)}/files/archive?changed=true`, { headers: upstreamHeaders() });
    if (!upstream.ok || !upstream.body) return res.status(upstream.status).json({ error: 'Archive unavailable' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="lumacare-guides.zip"');
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    errorResponse(res, error);
  }
});

const port = Number(process.env.PORT || 3000);
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(root, 'dist')));
  app.get('*splat', (_req, res) => res.sendFile(path.join(root, 'dist/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'spa' });
  app.use(vite.middlewares);
}

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => console.log(`LumaCare is running at http://localhost:${port}`));
}
