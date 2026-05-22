/**
 * Socket History Renderer
 *
 * Renders completed WebSocket and gRPC sessions in the history panel.
 * Uses shared StreamingUI components for consistent rendering.
 */

import React from 'react';
import { StreamItem, StreamMessageRow, StreamEventRow, formatDataSimple } from './StreamingUI';

// ── Types ──────────────────────────────────────────────────────────────────────

interface HistoryEntry {
  request: {
    method: string;
    url: string;
    headers?: Array<{ key: string; value: string }>;
    body?: string;
    grpcMeta?: {
      service: string;
      method: string;
      callType: string;
      package: string;
    };
  };
  response: {
    body?: string;
    error?: string | null;
  };
}

type WsItem =
  | { kind: 'system-open'; ts: number; url?: string | null }
  | { kind: 'system-close'; ts: number; code?: number; reason?: string }
  | { kind: 'system-error'; ts: number; message: string }
  | { kind: 'system-pause'; ts: number; reason?: string }
  | { kind: 'sent'; ts: number; data: any }
  | { kind: 'recv'; ts: number; data: any };

type GrpcItem =
  | { kind: 'stream-open'; ts: number; target?: string; method?: string; callType?: string }
  | { kind: 'stream-data'; ts: number; data: any; type: 'request' | 'response' }
  | { kind: 'stream-response'; ts: number; data: any }
  | { kind: 'stream-error'; ts: number; error: string; code?: number; details?: string }
  | { kind: 'stream-end'; ts: number; reason?: string }
  | { kind: 'stream-cancelled'; ts: number }
  | { kind: 'stream-closed'; ts: number }
  | { kind: 'unary-response'; ts: number; data: any; duration?: number };

// ── Normalize ──────────────────────────────────────────────────────────────────

function normalizeWsItems(items: WsItem[]): StreamItem[] {
  return items.map((it): StreamItem => {
    switch (it.kind) {
      case 'system-open':
        return { type: 'event', item: { kind: 'connected', ts: it.ts, message: `Connected${it.url ? ' · ' + it.url : ''}` } };
      case 'system-close':
        return { type: 'event', item: { kind: 'disconnected', ts: it.ts, message: `Closed${it.reason ? ' · ' + it.reason : ''}${it.code ? ` · code ${it.code}` : ''}` } };
      case 'system-error':
        return { type: 'event', item: { kind: 'error', ts: it.ts, message: `Error: ${it.message}` } };
      case 'system-pause':
        return { type: 'event', item: { kind: 'paused', ts: it.ts, message: `Paused${it.reason ? ' · ' + it.reason : ''}` } };
      case 'sent':
        return { type: 'message', item: { direction: 'sent', ts: it.ts, data: it.data } };
      case 'recv':
        return { type: 'message', item: { direction: 'received', ts: it.ts, data: it.data } };
    }
  });
}

function normalizeGrpcItems(items: GrpcItem[]): StreamItem[] {
  return items.map((it): StreamItem => {
    switch (it.kind) {
      case 'stream-open':
        return { type: 'event', item: { kind: 'connected', ts: it.ts, message: `Stream opened${it.method ? ' · ' + it.method : ''}` } };
      case 'stream-data':
        return { type: 'message', item: { direction: it.type === 'request' ? 'sent' : 'received', ts: it.ts, data: it.data, label: it.type === 'request' ? 'request' : 'response' } };
      case 'stream-response':
        return { type: 'message', item: { direction: 'received', ts: it.ts, data: it.data, label: 'response' } };
      case 'unary-response':
        return { type: 'message', item: { direction: 'received', ts: it.ts, data: it.data, label: it.duration ? `response · ${it.duration}ms` : 'response' } };
      case 'stream-error':
        return { type: 'event', item: { kind: 'error', ts: it.ts, message: `Error: ${it.error}${it.details ? ' · ' + it.details : ''}${it.code !== undefined ? ` (${it.code})` : ''}` } };
      case 'stream-end':
        return { type: 'event', item: { kind: 'ended', ts: it.ts, message: `Stream ended${it.reason ? ' · ' + it.reason : ''}` } };
      case 'stream-cancelled':
        return { type: 'event', item: { kind: 'cancelled', ts: it.ts, message: 'Stream cancelled' } };
      case 'stream-closed':
        return { type: 'event', item: { kind: 'disconnected', ts: it.ts, message: 'Stream closed' } };
    }
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseMessages(body: string | undefined): any[] {
  if (!body) return [];
  try {
    const parsed = JSON.parse(body);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ── Renderers ──────────────────────────────────────────────────────────────────

function WsRenderer({ messages }: { messages: WsItem[] }) {
  const items = normalizeWsItems(messages);
  const dataMessages = messages.filter((m) => m.kind === 'sent' || m.kind === 'recv');

  return (
    <div>
      {items.map((si, i) => {
        if (si.type === 'event') {
          return <StreamEventRow key={i} event={si.item} />;
        }
        return <StreamMessageRow key={i} message={si.item} />;
      })}
      {dataMessages.length === 0 && (
        <p className="text-[10px] text-comment italic px-[10px] py-1">No messages exchanged</p>
      )}
    </div>
  );
}

function GrpcRenderer({ messages, grpcMeta }: { messages: GrpcItem[]; grpcMeta?: any }) {
  const items = normalizeGrpcItems(messages);

  return (
    <div>
      {/* gRPC method info */}
      {grpcMeta?.service && (
        <div className="text-[9px] font-mono text-comment bg-muted/40 rounded px-2 py-1 mx-[10px] mt-1 flex items-center gap-1.5 flex-wrap">
          <span className="text-accent">{grpcMeta.package ? `${grpcMeta.package}.${grpcMeta.service}` : grpcMeta.service}</span>
          <span>/</span>
          <span className="text-text">{grpcMeta.method}</span>
          {grpcMeta.callType && (
            <span className="ml-auto bg-muted/60 rounded px-1 py-0.5 text-[8px] uppercase tracking-wide">{grpcMeta.callType}</span>
          )}
        </div>
      )}

      {items.map((si, i) => {
        if (si.type === 'event') {
          return <StreamEventRow key={i} event={si.item} />;
        }
        return <StreamMessageRow key={i} message={si.item} />;
      })}
    </div>
  );
}

// ── Main Export ─────────────────────────────────────────────────────────────────

export function SocketHistoryRenderer({ entry }: { entry: HistoryEntry }) {
  const method = (entry.request.method ?? '').toUpperCase();
  const isGrpc = method === 'GRPC' || method === 'GRPCS';
  const messages = parseMessages(entry.response.body);

  return (
    <div className="max-h-72 overflow-y-auto pr-0.5">
      {entry.response.error && (
        <div className="text-[10px] text-red-400 bg-red-500/10 rounded px-2 py-1.5 mx-[10px] mt-1 break-all">
          {entry.response.error}
        </div>
      )}
      {isGrpc ? (
        <GrpcRenderer messages={messages as GrpcItem[]} grpcMeta={entry.request.grpcMeta} />
      ) : (
        <WsRenderer messages={messages as WsItem[]} />
      )}
    </div>
  );
}
