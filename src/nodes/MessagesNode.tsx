/**
 * Messages Node — WebSocket streaming viewer
 *
 * Document-native, collapsible message log for WebSocket connections.
 * Uses shared StreamingUI components for consistent rendering.
 */

import * as React from "react";
import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { PluginContext } from "@voiden/sdk";
import { AlertCircle } from "lucide-react";
import { saveSessionToHistory } from '../lib/historyHelper';
import {
  StreamItem,
  StreamMessageRow,
  StreamEventRow,
  StreamHeader,
  StreamActionBtn,
  StreamExportMenu,
  formatDataSimple,
  formatTime,
} from '../components/StreamingUI';

// ── Attributes & Types ─────────────────────────────────────────────────────────

export interface MessagesAttrs {
  wsId?: string | null;
  url?: string | null;
  headers?: string | null;
  sourceFilePath?: string | null;
}

type ChatItem =
  | { kind: "system-open"; ts: number; wsId: string; url?: string | null }
  | { kind: "system-pause"; ts: number; wsId: string; url?: string | null; code?: number; reason?: string; message?: string }
  | { kind: "system-close"; ts: number; wsId: string; code?: number; reason?: string; wasClean?: boolean }
  | { kind: "system-error"; ts: number; wsId?: string; message: string; code?: any; cause?: any; name?: string }
  | { kind: "recv"; ts: number; wsId: string; data: any }
  | { kind: "sent"; ts: number; wsId: string; data: any };

// ── Data Renderer ──────────────────────────────────────────────────────────────

interface RenderResult {
  text: string;
  type: 'text' | 'json' | 'xml' | 'html' | 'binary' | 'base64' | 'buffer' | 'error';
  isFormatted: boolean;
  originalSize?: number;
}

function dataToRenderableText(data: any): RenderResult {
  if (data === null) return { text: 'null', type: 'text', isFormatted: false };
  if (data === undefined) return { text: 'undefined', type: 'text', isFormatted: false };

  if (typeof data === 'string') return analyzeAndFormatString(data);

  if (data?.type === "Buffer" && Array.isArray(data.data)) return handleBufferData(data.data);

  if (data instanceof ArrayBuffer) {
    const uint8 = new Uint8Array(data);
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(uint8);
      return analyzeAndFormatString(text);
    } catch {
      return { text: `[ArrayBuffer ${data.byteLength} bytes]`, type: 'binary', isFormatted: false, originalSize: data.byteLength };
    }
  }

  if (ArrayBuffer.isView(data)) {
    const uint8 = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(uint8);
      return analyzeAndFormatString(text);
    } catch {
      return { text: `[${data.constructor.name} ${data.byteLength} bytes]`, type: 'binary', isFormatted: false, originalSize: data.byteLength };
    }
  }

  if (typeof data === 'object') {
    try {
      const jsonString = JSON.stringify(data, null, 2);
      return { text: jsonString, type: 'json', isFormatted: true, originalSize: jsonString.length };
    } catch {
      return { text: `[Object: ${Object.prototype.toString.call(data)}]`, type: 'error', isFormatted: false };
    }
  }

  return { text: String(data), type: 'text', isFormatted: false };
}

function analyzeAndFormatString(str: string): RenderResult {
  const trimmed = str.trim();
  if (!trimmed) return { text: '(empty string)', type: 'text', isFormatted: false };

  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      const parsed = JSON.parse(trimmed);
      return { text: JSON.stringify(parsed, null, 2), type: 'json', isFormatted: true, originalSize: str.length };
    } catch { }
  }

  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    return {
      text: str,
      type: trimmed.toLowerCase().includes('<!doctype html') || trimmed.toLowerCase().includes('<html') ? 'html' : 'xml',
      isFormatted: false, originalSize: str.length,
    };
  }

  return { text: str, type: 'text', isFormatted: false, originalSize: str.length };
}

function handleBufferData(bufferData: number[]): RenderResult {
  const uint8 = new Uint8Array(bufferData);
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(uint8);
    return { ...analyzeAndFormatString(text), originalSize: bufferData.length };
  } catch {
    if (bufferData.length <= 1024) {
      const hex = Array.from(uint8).map(b => b.toString(16).padStart(2, '0')).join(' ');
      return { text: `[Buffer ${bufferData.length} bytes - Hex]\n${hex}`, type: 'buffer', isFormatted: true, originalSize: bufferData.length };
    } else {
      const base64 = btoa(String.fromCharCode(...uint8));
      return { text: `[Buffer ${bufferData.length} bytes - Base64]\n${base64}`, type: 'buffer', isFormatted: true, originalSize: bufferData.length };
    }
  }
}

function formatFullDateTime(ts: number) {
  try { return new Date(ts).toISOString(); } catch { return ""; }
}

type MessageFormat = 'text' | 'json' | 'html' | 'xml';

// ── Module-level guards ────────────────────────────────────────────────────────

export const activeWsConnections = new Set<string>();
const savedWsSessions = new Set<string>();

export async function closeAllActiveWsConnections(): Promise<void> {
  const ids = Array.from(activeWsConnections);
  await Promise.all(ids.map(async (id) => {
    try { await (window as any)?.electron?.request?.closeWss({ wsId: id, code: 4000, reason: 'Reconnecting' }); } catch { }
  }));
}

// ── Normalize ChatItem → StreamItem ────────────────────────────────────────────

function normalizeItems(items: ChatItem[]): StreamItem[] {
  return items.map((it): StreamItem => {
    switch (it.kind) {
      case 'system-open':
        return { type: 'event', item: { kind: 'connected', ts: it.ts, message: `Connected${it.url ? ' · ' + it.url : ''}` } };
      case 'system-pause':
        return { type: 'event', item: { kind: 'paused', ts: it.ts, message: `Paused${it.reason ? ' · ' + it.reason : ''}${it.code ? ` (${it.code})` : ''}` } };
      case 'system-close':
        return { type: 'event', item: { kind: 'disconnected', ts: it.ts, message: `Closed${it.reason ? ' · ' + it.reason : ''}${it.code ? ` · code ${it.code}` : ''}` } };
      case 'system-error': {
        const isCleanupWarning = it.code === 'CLEANUP_WARNING';
        return {
          type: 'event',
          item: {
            kind: isCleanupWarning ? 'info' : 'error',
            ts: it.ts,
            message: isCleanupWarning ? it.message : `Error: ${it.message}${it.code && it.code !== 'CLEANUP_WARNING' ? ` · code:${it.code}` : ''}${it.cause ? ` · cause:${it.cause}` : ''}`,
          },
        };
      }
      case 'sent': {
        const result = dataToRenderableText(it.data);
        return { type: 'message', item: { direction: 'sent', ts: it.ts, data: it.data, format: result.type !== 'text' ? result.type : undefined, size: result.originalSize } };
      }
      case 'recv': {
        const result = dataToRenderableText(it.data);
        return { type: 'message', item: { direction: 'received', ts: it.ts, data: it.data, format: result.type !== 'text' ? result.type : undefined, size: result.originalSize } };
      }
    }
  });
}

// ── Component Factory ──────────────────────────────────────────────────────────

export const createMessagesNode = (NodeViewWrapper: any, context: PluginContext) => {
  const MessagesComponent = ({ node }: any) => {
    const attrs = (node.attrs || {}) as MessagesAttrs;
    const [wsId, setWsId] = React.useState<string | null>(attrs.wsId || null);
    const [connected, setConnected] = React.useState<boolean>(false);
    const [isPaused, setIsPaused] = React.useState<boolean>(false);
    const [hasError, setHasError] = React.useState<boolean>(false);
    const [url, setUrl] = React.useState<string | null>(attrs.url || null);
    const [items, setItems] = React.useState<ChatItem[]>([]);
    const [expanded, setExpanded] = React.useState<boolean>(true);
    const isConnected = React.useRef<boolean>(false);

    const itemsRef = React.useRef<ChatItem[]>([]);
    React.useEffect(() => { itemsRef.current = items; }, [items]);
    const sessionStartRef = React.useRef<number | null>(null);
    const savedRef = React.useRef<boolean>(false);
    const isReplayRef = React.useRef<boolean>(false);
    const lastErrorRef = React.useRef<string | null>(null);

    const parsedHeaders: Array<{ key: string; value: string }> = React.useMemo(() => {
      try { return JSON.parse(attrs.headers || '[]'); } catch { return []; }
    }, [attrs.headers]);

    const [messageFormat, setMessageFormat] = React.useState<MessageFormat>('text');
    const [messageContent, setMessageContent] = React.useState<string>("");
    const [copiedIndex, setCopiedIndex] = React.useState<number | null>(null);

    const handleLangChange = (value: MessageFormat) => { setMessageFormat(value); setMessageContent(''); };

    // Copy individual message
    const handleCopyMessage = async (item: ChatItem, index: number) => {
      try {
        let textToCopy = '';
        if (item.kind === 'sent' || item.kind === 'recv') {
          textToCopy = dataToRenderableText(item.data).text;
        } else if (item.kind === 'system-error') {
          textToCopy = `ERROR: ${item.message}`;
        } else {
          textToCopy = JSON.stringify(item, null, 2);
        }
        await navigator.clipboard.writeText(textToCopy);
        setCopiedIndex(index);
        setTimeout(() => setCopiedIndex(null), 2000);
      } catch { }
    };

    // Export CSV
    const handleExportCSV = () => {
      try {
        const headers = ['Timestamp', 'Type', 'Direction', 'Content', 'Format', 'Size'];
        const rows = [headers];
        items.forEach(item => {
          const timestamp = formatFullDateTime(item.ts);
          let type = item.kind, direction = '', content = '', format = '', size = '';
          if (item.kind === 'sent' || item.kind === 'recv') {
            direction = item.kind === 'sent' ? 'Outgoing' : 'Incoming';
            const result = dataToRenderableText(item.data);
            content = result.text.replace(/"/g, '""');
            format = result.type;
            size = result.originalSize ? `${result.originalSize} bytes` : '';
          } else if (item.kind === 'system-error') {
            content = item.message.replace(/"/g, '""');
          } else if (item.kind === 'system-open') {
            content = `Connected to ${item.url || 'WebSocket'}`;
          } else if (item.kind === 'system-close') {
            content = `Closed: ${item.reason || 'Unknown reason'} (code: ${item.code})`;
          } else if (item.kind === 'system-pause') {
            content = `Paused: ${item.reason || 'Unknown reason'}`;
          }
          rows.push([timestamp, type, direction, `"${content}"`, format, size]);
        });
        const csvContent = rows.map(row => row.join(',')).join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `websocket-messages-${Date.now()}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } catch (err) {
        setItems((prev) => [...prev, { kind: "system-error", ts: Date.now(), message: `Export failed: ${err}` }]);
      }
    };

    // Export JSON
    const handleExportJSON = () => {
      try {
        const exportData = items.map(item => {
          const base = { ...item, timestamp: formatFullDateTime(item.ts), kind: item.kind };
          if (item.kind === 'sent' || item.kind === 'recv') {
            const result = dataToRenderableText(item.data);
            return { ...base, data: result.text, dataType: result.type, dataSize: result.originalSize };
          }
          return base;
        });
        const jsonContent = JSON.stringify(exportData, null, 2);
        const blob = new Blob([jsonContent], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `websocket-messages-${Date.now()}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } catch { }
    };

    // Auto-scroll
    const listRef = React.useRef<HTMLDivElement | null>(null);
    React.useEffect(() => {
      const el = listRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    }, [items.length]);

    // ── IPC Listeners ──────────────────────────────────────────────────────────
    React.useEffect(() => {
      const listen = (window as any)?.electron?.request?.listenSecure;
      if (!listen) {
        setItems((prev) => [...prev, { kind: "system-error", ts: Date.now(), message: "IPC not available" }]);
        return;
      }

      const offOpen = listen("ws-open", (_e: any, d: any) => {
        if (!wsId || d.wsId === wsId) {
          setWsId(d.wsId);
          setConnected(true);
          setIsPaused(false);
          setHasError(false);
          if (d?.url && !url) setUrl(d.url);
          if (!sessionStartRef.current) sessionStartRef.current = Date.now();
          if (isReplayRef.current) { isReplayRef.current = false; } else { savedRef.current = false; savedWsSessions.delete(d.wsId); }
          lastErrorRef.current = null;
          setItems((prev) => [...prev, { kind: "system-open", ts: Date.now(), wsId: d.wsId, url: d?.url }]);
        }
      });

      const offMsg = listen("ws-message", (_e: any, d: any) => {
        if (!wsId || d.wsId === wsId) {
          setWsId(d.wsId); setConnected(true); setHasError(false);
          setItems((prev) => [...prev, { kind: "recv", ts: Date.now(), wsId: d.wsId, data: d.data }]);
        }
      });

      const offSent = listen("ws-message-sent", (_e: any, d: any) => {
        if (!wsId || d.wsId === wsId) {
          setWsId(d.wsId); setConnected(true); setHasError(false);
          setItems((prev) => [...prev, { kind: "sent", ts: Date.now(), wsId: d.wsId, data: d.data }]);
        }
      });

      const offErr = listen("ws-error", (_e: any, d: any) => {
        if (!wsId || d.wsId === wsId) {
          if (d?.code === 'CLEANUP_WARNING') {
            setItems((prev) => [...prev, { kind: "system-error", ts: Date.now(), wsId: d?.wsId, message: d?.message || "Message history cleanup pending", code: d?.code }]);
          } else {
            setHasError(true);
            setItems((prev) => [...prev, { kind: "system-error", ts: Date.now(), wsId: d?.wsId, message: d?.message || "Connection error", code: d?.code, cause: d?.cause, name: d?.name }]);
            setConnected(false);
            isConnected.current = false;
            lastErrorRef.current = d?.message || 'Connection error';
          }
        }
      });

      const offClose = listen("ws-close", (_e: any, d: any) => {
        if (!wsId || d.wsId === wsId) {
          setConnected(false); setIsPaused(false);
          const closeItem: ChatItem = { kind: "system-close", ts: Date.now(), wsId: d.wsId, code: d.code, reason: d.reason, wasClean: d.wasClean };
          setItems((prev) => [...prev, closeItem]);
          isConnected.current = false;
          const wsIdValue = d.wsId as string;
          if (!savedRef.current && !savedWsSessions.has(wsIdValue)) {
            savedRef.current = true;
            savedWsSessions.add(wsIdValue);
            activeWsConnections.delete(wsIdValue);
            saveSessionToHistory(context, {
              method: 'WSS', url: attrs.url || '', headers: parsedHeaders,
              messages: [...itemsRef.current, closeItem],
              error: lastErrorRef.current ?? undefined,
              sessionStart: sessionStartRef.current ?? undefined,
              sessionEnd: Date.now(),
              sourceFilePath: attrs.sourceFilePath || null,
            });
            lastErrorRef.current = null;
          }
        }
      });

      const offPause = listen("ws-pause", (_e: any, d: any) => {
        if (!wsId || d.wsId === wsId) {
          setConnected(false); setIsPaused(true);
          setItems((prev) => [...prev, { kind: "system-pause", ts: Date.now(), wsId: d.wsId, code: d.code, reason: d.reason }]);
        }
      });

      return () => {
        try { offOpen && offOpen(); } catch { }
        try { offSent && offSent(); } catch { }
        try { offMsg && offMsg(); } catch { }
        try { offErr && offErr(); } catch { }
        try { offClose && offClose(); } catch { }
        try { offPause && offPause(); } catch { }
      };
    }, []);

    // ── Connection logic ───────────────────────────────────────────────────────
    const connectWebSocket = React.useCallback(async () => {
      if (isConnected.current || !wsId) return;
      if (activeWsConnections.has(wsId)) return;
      activeWsConnections.add(wsId);
      isConnected.current = true;
      try {
        const result = await (window as any)?.electron?.request?.connectWss(wsId);
        if (result?.wasPaused) {
          isConnected.current = false; activeWsConnections.delete(wsId); setConnected(false);
          return;
        }
        if (result?.wasClosed) {
          isConnected.current = false; activeWsConnections.delete(wsId); setConnected(false);
          savedRef.current = true; isReplayRef.current = true;
        }
      } catch (error) {
        isConnected.current = false; activeWsConnections.delete(wsId);
        setItems((prev) => [...prev, { kind: "system-error", ts: Date.now(), wsId, message: `Failed to connect: ${error}` }]);
      }
    }, [wsId]);

    const handleConnect = async () => {
      if (connected) {
        await (window as any)?.electron?.request?.pauseWss({ wsId, reason: "User paused" });
        isConnected.current = false;
      } else if (isPaused) {
        await (window as any)?.electron?.request?.resumeWss?.(wsId);
        isConnected.current = true;
        setIsPaused(false);
      }
    };

    const handleClose = async () => {
      if (!wsId) return;
      await (window as any)?.electron?.request?.closeWss({ wsId, code: 4000, reason: "User closed connection" });
      isConnected.current = false; setConnected(false); setIsPaused(false);
    };

    React.useEffect(() => { connectWebSocket(); }, [wsId]);

    const handleSend = React.useCallback(() => {
      const sendMessage = (window as any)?.electron?.request?.sendMessage;
      if (!sendMessage) {
        setItems((prev) => [...prev, { kind: "system-error", ts: Date.now(), message: "IPC not available" }]);
        return;
      }
      if (!wsId) {
        setItems((prev) => [...prev, { kind: "system-error", ts: Date.now(), message: "Not connected" }]);
        return;
      }
      const text = messageContent ?? "";
      if (text.trim().length === 0) return;
      setItems((prev) => [...prev, { kind: "sent", ts: Date.now(), wsId, data: text }]);
      setMessageContent("");
      try {
        sendMessage(wsId, text);
      } catch (err: any) {
        setItems((prev) => [...prev, { kind: "system-error", ts: Date.now(), wsId, message: err?.message || "Failed to send" }]);
      }
    }, [messageContent, wsId]);

    // ── Derived state ──────────────────────────────────────────────────────────
    const streamItems = React.useMemo(() => normalizeItems(items), [items]);

    const statusDot = connected ? 'connected' : hasError ? 'error' : 'closed';
    const statusText = connected ? 'Connected' : isPaused ? 'Paused' : hasError ? 'Error' : 'Disconnected';

    // ── Render ─────────────────────────────────────────────────────────────────

    if (!wsId) {
      return (
        <NodeViewWrapper>
          <div className="bg-bg flex items-center justify-center p-6">
            <div className="flex items-center gap-2 text-red-400 text-sm">
              <AlertCircle size={16} />
              <span>WebSocket connection could not be initialized — no identifier provided.</span>
            </div>
          </div>
        </NodeViewWrapper>
      );
    }

    return (
      <NodeViewWrapper className="messages-node" style={{ userSelect: "text" }} contentEditable={false}>
        {/* Collapsible Header */}
        <StreamHeader
          expanded={expanded}
          onToggle={() => setExpanded((v) => !v)}
          protocol="WebSocket"
          items={streamItems}
          statusDot={statusDot}
          statusText={statusText}
          actions={
            <>
              {connected && (
                <StreamActionBtn onClick={(e) => { e.stopPropagation(); handleConnect(); }}>
                  Pause
                </StreamActionBtn>
              )}
              {isPaused && (
                <StreamActionBtn onClick={(e) => { e.stopPropagation(); handleConnect(); }}>
                  Resume
                </StreamActionBtn>
              )}
              {(connected || isPaused) && (
                <StreamActionBtn danger onClick={(e) => { e.stopPropagation(); handleClose(); }}>
                  Disconnect
                </StreamActionBtn>
              )}
              <StreamExportMenu
                onExportJSON={handleExportJSON}
                onExportCSV={handleExportCSV}
                hasMessages={items.length > 0}
              />
            </>
          }
        />

        {/* Message List */}
        {expanded && (
          <>
            <div
              ref={listRef}
              className="bg-editor"
              style={{ maxHeight: '60vh', overflowY: 'auto' }}
            >
              {items.length === 0 ? (
                <div className="px-3 py-3 text-sm text-comment">
                  Waiting for connection…
                </div>
              ) : (
                items.map((it, idx) => {
                  const si = streamItems[idx];
                  if (si.type === 'event') {
                    return <StreamEventRow key={idx} event={si.item} />;
                  }
                  return (
                    <StreamMessageRow
                      key={idx}
                      message={si.item}
                      onCopy={() => handleCopyMessage(it, idx)}
                      isCopied={copiedIndex === idx}
                    />
                  );
                })
              )}
            </div>

            {/* Compact Input — only when connected */}
            {connected && (
              <div className="border-t border-border">
                <div className="flex items-center gap-2 py-2 px-3">
                  <select
                    value={messageFormat}
                    onChange={(e) => handleLangChange(e.target.value as MessageFormat)}
                    className="bg-bg text-text border border-border rounded px-[6px] py-[3px] text-[10px] font-mono font-semibold outline-none cursor-pointer"
                  >
                    {(['text', 'json', 'html', 'xml'] as MessageFormat[]).map((f) => (
                      <option key={f} value={f}>{f.toUpperCase()}</option>
                    ))}
                  </select>
                  <div
                    className="flex-1"
                    onKeyDown={(e) => {
                      // Cmd/Ctrl+Enter sends the message
                      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                        e.preventDefault();
                        e.stopPropagation();
                        handleSend();
                        return;
                      }
                      e.stopPropagation();
                    }}
                    onKeyUp={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {context.ui.components.CodeEditor ? (
                      <context.ui.components.CodeEditor
                        lang={messageFormat === 'json' ? 'json' : messageFormat === 'html' ? 'html' : messageFormat === 'xml' ? 'xml' : 'plaintext'}
                        onChange={(val: string) => setMessageContent(val)}
                        value={messageContent}
                        readOnly={!connected || !wsId}
                      />
                    ) : (
                      <textarea
                        className="w-full bg-bg text-text border border-border rounded px-2 py-1 text-[11px] font-mono outline-none resize-none"
                        rows={2}
                        value={messageContent}
                        onChange={(e) => setMessageContent(e.target.value)}
                        placeholder='{ "type": "ping" }'
                      />
                    )}
                  </div>
                  <button
                    className="px-4 py-1.5 text-[11px] font-bold font-mono text-comment
                      border border-border rounded cursor-pointer transition-colors
                      hover:text-accent hover:border-accent
                      disabled:opacity-40 disabled:cursor-not-allowed"
                    onClick={handleSend}
                    disabled={!messageContent.trim()}
                  >
                    SEND
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </NodeViewWrapper>
    );
  };

  return Node.create({
    name: "messages-node",
    group: "block",
    atom: true,
    addAttributes() {
      return {
        wsId: { default: null },
        url: { default: null },
        headers: { default: null },
        sourceFilePath: { default: null },
      };
    },
    parseHTML() {
      return [{ tag: 'div[data-type="messages-node"]' }];
    },
    renderHTML({ HTMLAttributes }) {
      return ["div", { "data-type": "messages-node", ...HTMLAttributes }];
    },
    addNodeView() {
      return ReactNodeViewRenderer(MessagesComponent);
    },
  });
};
