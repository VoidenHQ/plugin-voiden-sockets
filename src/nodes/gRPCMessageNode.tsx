/**
 * gRPC Messages Node
 *
 * Document-native, collapsible message log for gRPC calls.
 * Handles all call types: unary, server/client/bidirectional streaming.
 * Uses shared StreamingUI components for consistent rendering.
 */

import * as React from "react";
import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { PluginContext } from "@voiden/sdk";
import {
  ArrowRight, ArrowDown, ArrowUp, ArrowLeftRight,
  AlertCircle, Loader2,
} from "lucide-react";
import { saveSessionToHistory } from '../lib/historyHelper';
import {
  StreamItem,
  StreamMessageRow,
  StreamEventRow,
  StreamHeader,
  StreamActionBtn,
  StreamExportMenu,
  formatTime,
} from '../components/StreamingUI';

// ── Module-level dedup ─────────────────────────────────────────────────────────

const savedGrpcSessions = new Set<string>();

// ── Attributes & Types ─────────────────────────────────────────────────────────

export interface GrpcMessagesAttrs {
  grpcId?: string | null;
  callType?: 'unary' | 'server_streaming' | 'client_streaming' | 'bidirectional_streaming' | null;
  service?: string | null;
  method?: string | null;
  target?: string | null;
  url?: string | null;
  package?: string | null;
  headers?: string | null;
  protoFilePath?: string | null;
  sourceFilePath?: string | null;
  protoServices?: string | null;
}

type GrpcMessageItem =
  | { kind: "stream-open"; ts: number; grpcId: string; target?: string; method?: string; callType?: string }
  | { kind: "stream-data"; ts: number; grpcId: string; data: any; type: 'request' | 'response' }
  | { kind: "stream-response"; ts: number; grpcId: string; data: any }
  | { kind: "stream-error"; ts: number; grpcId: string; error: string; code?: number; details?: string }
  | { kind: "stream-end"; ts: number; grpcId: string; reason?: string }
  | { kind: "stream-cancelled"; ts: number; grpcId: string }
  | { kind: "unary-response"; ts: number; grpcId: string; data: any; duration?: number }
  | { kind: "stream-closed"; ts: number; grpcId: string };

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatJson(data: any): string {
  try { return JSON.stringify(data, null, 2); } catch { return String(data); }
}

// ── Normalize GrpcMessageItem → StreamItem ─────────────────────────────────────

function normalizeItems(items: GrpcMessageItem[]): StreamItem[] {
  return items.map((msg): StreamItem => {
    switch (msg.kind) {
      case 'stream-open':
        return {
          type: 'event',
          item: {
            kind: 'connected',
            ts: msg.ts,
            message: `Stream opened${msg.method ? ' · ' + msg.method : ''}${msg.callType ? ' · ' + msg.callType : ''}`,
          },
        };
      case 'stream-data':
        return {
          type: 'message',
          item: {
            direction: msg.type === 'request' ? 'sent' : 'received',
            ts: msg.ts,
            data: msg.data,
            label: msg.type === 'request' ? 'request' : 'response',
          },
        };
      case 'stream-response':
        return {
          type: 'message',
          item: { direction: 'received', ts: msg.ts, data: msg.data, label: 'Final Response' },
        };
      case 'unary-response':
        return {
          type: 'message',
          item: {
            direction: 'received',
            ts: msg.ts,
            data: msg.data,
            label: 'Final Response',
            durationLabel: msg.duration ? formatDuration(msg.duration) : undefined,
          },
        };
      case 'stream-error':
        return {
          type: 'event',
          item: {
            kind: 'error',
            ts: msg.ts,
            message: `Error: ${msg.error}${msg.details ? ' · ' + msg.details : ''}${msg.code !== undefined ? ` (${msg.code})` : ''}`,
          },
        };
      case 'stream-end':
        return {
          type: 'event',
          item: { kind: 'ended', ts: msg.ts, message: `Stream ended${msg.reason ? ' · ' + msg.reason : ''}` },
        };
      case 'stream-cancelled':
        return {
          type: 'event',
          item: { kind: 'cancelled', ts: msg.ts, message: 'Stream cancelled' },
        };
      case 'stream-closed':
        return {
          type: 'event',
          item: { kind: 'disconnected', ts: msg.ts, message: 'Stream closed' },
        };
    }
  });
}

// ── Component Factory ──────────────────────────────────────────────────────────

export const createGrpcMessagesNode = (NodeViewWrapper: any, context: PluginContext) => {
  const GrpcMessagesComponent = ({ node }: any) => {
    const attrs = (node.attrs || {}) as GrpcMessagesAttrs;

    const [grpcId, setGrpcId] = React.useState<string | null>(attrs.grpcId || null);
    const [callType, setCallType] = React.useState<string | null>(attrs.callType || null);
    const [connected, setConnected] = React.useState<boolean>(false);
    const [loading, setLoading] = React.useState<boolean>(false);
    const [service, setService] = React.useState<string | null>(attrs.service || null);
    const [method, setMethod] = React.useState<string | null>(attrs.method || null);
    const [target, setTarget] = React.useState<string | null>(attrs.target || null);
    const [unaryError, setUnaryError] = React.useState<boolean>(false);

    const [messages, setMessages] = React.useState<GrpcMessageItem[]>([]);
    const [requestInput, setRequestInput] = React.useState<string>("{}");
    const [messageFormat, setMessageFormat] = React.useState<'json' | 'text'>('json');
    const [copiedIndex, setCopiedIndex] = React.useState<number | null>(null);
    const [streamEnded, setStreamEnded] = React.useState<boolean>(false);
    const [expanded, setExpanded] = React.useState<boolean>(true);

    const listRef = React.useRef<HTMLDivElement | null>(null);
    const firstLoad = React.useRef<boolean>(false);
    const connectCalledRef = React.useRef<boolean>(false);
    const ipcListenersSetupRef = React.useRef<boolean>(false);

    const messagesRef = React.useRef<GrpcMessageItem[]>([]);
    React.useEffect(() => { messagesRef.current = messages; }, [messages]);
    const sessionStartRef = React.useRef<number | null>(null);
    const savedRef = React.useRef<boolean>(false);
    const isReplayRef = React.useRef<boolean>(false);
    const lastErrorRef = React.useRef<string | null>(null);

    const parsedHeaders: Array<{ key: string; value: string }> = React.useMemo(() => {
      try { return JSON.parse(attrs.headers || '[]'); } catch { return []; }
    }, [attrs.headers]);

    const handleLangChange = (value: 'text' | 'json') => {
      setMessageFormat(value);
      setRequestInput(value === 'text' ? '' : '{}');
    };

    // Auto-scroll
    React.useEffect(() => {
      const el = listRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    }, [messages.length]);

    // ── gRPC connection ────────────────────────────────────────────────────────
    const connectGrpc = React.useCallback(async () => {
      if (!grpcId || connectCalledRef.current) return;
      connectCalledRef.current = true;
      firstLoad.current = true;
      try {
        const result = await (window as any).electron.request.connectGrpc(grpcId);
        if (result?.wasClosed) {
          savedRef.current = true;
          isReplayRef.current = true;
          connectCalledRef.current = false;
          setConnected(false);
          return;
        }
        setConnected(true);
      } catch (error) {
        setMessages((prev) => [...prev, { kind: "stream-error", ts: Date.now(), grpcId: grpcId, error: `Connection failed: ${error}` }]);
        setStreamEnded(true);
        firstLoad.current = false;
        connectCalledRef.current = false;
      }
    }, [grpcId]);

    // ── IPC Listeners ──────────────────────────────────────────────────────────
    React.useEffect(() => {
      if (ipcListenersSetupRef.current) return;
      const listen = (window as any)?.electron?.request?.listenSecure;
      if (!listen) {
        setMessages((prev) => [...prev, { kind: "stream-error", ts: Date.now(), grpcId: "", error: "IPC not available" }]);
        return;
      }
      ipcListenersSetupRef.current = true;

      const offOpen = listen("grpc-stream-open", (_e: any, d: any) => {
        if (!grpcId || d.grpcId === grpcId) {
          setGrpcId(d.grpcId); setConnected(true); setLoading(false);
          setCallType(d.callType); setTarget(d.target); setMethod(d.method);
          setStreamEnded(false);
          if (!sessionStartRef.current) sessionStartRef.current = Date.now();
          if (isReplayRef.current) { isReplayRef.current = false; } else { savedRef.current = false; }
          lastErrorRef.current = null;
          setMessages((prev) => [...prev, { kind: "stream-open", ts: Date.now(), grpcId: d.grpcId, target: d.target, method: d.method, callType: d.callType }]);
        }
      });

      const offData = listen("grpc-stream-data", (_e: any, d: any) => {
        if (!grpcId || d.grpcId === grpcId) {
          if (d.type === 'response' && callType === 'unary') setLoading(false);
          setMessages((prev) => [...prev, { kind: "stream-data", ts: Date.now(), grpcId: d.grpcId, data: d.data, type: d.type || 'response' }]);
        }
      });

      const offResponse = listen("grpc-stream-response", (_e: any, d: any) => {
        if (!grpcId || d.grpcId === grpcId) {
          setLoading(false);
          setMessages((prev) => [...prev, { kind: "stream-response", ts: Date.now(), grpcId: d.grpcId, data: d.data }]);
        }
      });

      const offError = listen("grpc-stream-error", (_e: any, d: any) => {
        if (!grpcId || d.grpcId === grpcId) {
          setLoading(false); setConnected(false); setStreamEnded(true);
          if (callType === 'unary') setUnaryError(true);
          setMessages((prev) => [...prev, { kind: "stream-error", ts: Date.now(), grpcId: d.grpcId, error: d.error || "gRPC error", code: d.code, details: d.details }]);
          lastErrorRef.current = d.error || 'gRPC error';
        }
      });

      const saveSession = (endItem: GrpcMessageItem, endGrpcId: string) => {
        if (!savedRef.current && !savedGrpcSessions.has(endGrpcId)) {
          savedRef.current = true;
          savedGrpcSessions.add(endGrpcId);
          const endError = lastErrorRef.current;
          lastErrorRef.current = null;
          saveSessionToHistory(context, {
            method: attrs.url?.startsWith('grpcs://') ? 'GRPCS' : 'GRPC',
            url: attrs.target || attrs.url || '',
            headers: parsedHeaders,
            messages: [...messagesRef.current, endItem],
            error: endError ?? undefined,
            sessionStart: sessionStartRef.current ?? undefined,
            sessionEnd: Date.now(),
            sourceFilePath: attrs.sourceFilePath || null,
            grpcService: attrs.service || null,
            grpcMethod: attrs.method || null,
            grpcCallType: attrs.callType || null,
            grpcPackage: attrs.package || null,
            protoFilePath: attrs.protoFilePath || null,
            protoServices: (() => { try { const s = attrs.protoServices; return s ? (typeof s === 'string' ? JSON.parse(s) : s) : null; } catch { return null; } })(),
          });
        }
      };

      const offEnd = listen("grpc-stream-end", (_e: any, d: any) => {
        if (!grpcId || d.grpcId === grpcId) {
          setConnected(false); setStreamEnded(true);
          const endItem: GrpcMessageItem = { kind: "stream-end", ts: Date.now(), grpcId: d.grpcId, reason: d.reason };
          setMessages((prev) => [...prev, endItem]);
          saveSession(endItem, d.grpcId);
        }
      });

      const offCancelled = listen("grpc-stream-cancelled", (_e: any, d: any) => {
        if (!grpcId || d.grpcId === grpcId) {
          setConnected(false); setStreamEnded(true);
          const cancelItem: GrpcMessageItem = { kind: "stream-cancelled", ts: Date.now(), grpcId: d.grpcId };
          setMessages((prev) => [...prev, cancelItem]);
          lastErrorRef.current = null;
          saveSession(cancelItem, d.grpcId);
        }
      });

      const offClosed = listen("grpc-stream-closed", (_e: any, d: any) => {
        if (!grpcId || d.grpcId === grpcId) {
          setConnected(false); setStreamEnded(true);
          const closedItem: GrpcMessageItem = { kind: "stream-closed", ts: Date.now(), grpcId: d.grpcId };
          setMessages((prev) => [...prev, closedItem]);
          saveSession(closedItem, d.grpcId);
        }
      });

      return () => {
        try { offOpen && offOpen(); } catch { }
        try { offData && offData(); } catch { }
        try { offResponse && offResponse(); } catch { }
        try { offError && offError(); } catch { }
        try { offEnd && offEnd(); } catch { }
        try { offCancelled && offCancelled(); } catch { }
        try { offClosed && offClosed(); } catch { }
        ipcListenersSetupRef.current = false;
      };
    }, [grpcId]);

    // Initial connection
    React.useEffect(() => {
      if (!grpcId) return;
      if (callType === 'unary') { firstLoad.current = true; return; }
      if (!connected && !connectCalledRef.current) connectGrpc();
    }, [grpcId, connected, callType, connectGrpc]);

    // ── Send / End / Cancel ────────────────────────────────────────────────────
    const handleSendMessage = React.useCallback(() => {
      const sendGrpcMessage = (window as any)?.electron?.request?.sendGrpcMessage;
      if (!sendGrpcMessage) {
        setMessages((prev) => [...prev, { kind: "stream-error", ts: Date.now(), grpcId: grpcId || "", error: "IPC not available" }]);
        return;
      }
      const canSend = callType === "unary" ? !loading : connected && !streamEnded;
      if (!grpcId || !canSend) {
        setMessages((prev) => [...prev, { kind: "stream-error", ts: Date.now(), grpcId: grpcId || "", error: "Cannot send: Not connected or stream ended" }]);
        return;
      }

      if (callType === 'unary') {
        try {
          const payload = messageFormat === 'json' ? JSON.parse(requestInput) : requestInput;
          setMessages((prev) => [...prev, { kind: "stream-data", ts: Date.now(), grpcId, data: payload, type: 'request' }]);
          setUnaryError(false); setLoading(true);
          sendGrpcMessage(grpcId, payload);
        } catch (err: any) {
          setMessages(prev => [...prev, { kind: "stream-error", ts: Date.now(), grpcId, error: err.message }]);
        }
        return;
      }

      if (!requestInput.trim()) return;
      try {
        const payload = messageFormat === 'json' ? JSON.parse(requestInput) : requestInput;
        setMessages((prev) => [...prev, { kind: "stream-data", ts: Date.now(), grpcId, data: payload, type: 'request' }]);
        sendGrpcMessage(grpcId, payload);
        setRequestInput(messageFormat === 'json' ? '{}' : '');
      } catch (err: any) {
        setMessages((prev) => [...prev, { kind: "stream-error", ts: Date.now(), grpcId, error: `Invalid JSON: ${err.message}` }]);
      }
    }, [requestInput, grpcId, connected, messageFormat, callType, streamEnded, loading]);

    const handleEndStream = React.useCallback(() => {
      const endGrpcStream = (window as any)?.electron?.request?.endGrpc;
      if (!endGrpcStream || !grpcId) return;
      if (connected && !streamEnded) endGrpcStream(grpcId);
    }, [grpcId, connected, streamEnded]);

    const handleCancel = React.useCallback(() => {
      const cancelGrpc = (window as any)?.electron?.request?.cancelGrpc;
      if (!cancelGrpc || !grpcId) return;
      if (connected && !streamEnded) cancelGrpc(grpcId);
    }, [grpcId, connected, streamEnded]);

    // Copy
    const handleCopyMessage = async (item: GrpcMessageItem, index: number) => {
      try {
        let textToCopy = '';
        if (item.kind === 'stream-data' || item.kind === 'stream-response' || item.kind === 'unary-response') {
          textToCopy = formatJson(item.data);
        } else {
          textToCopy = JSON.stringify(item, null, 2);
        }
        await navigator.clipboard.writeText(textToCopy);
        setCopiedIndex(index);
        setTimeout(() => setCopiedIndex(null), 2000);
      } catch { }
    };

    // Export JSON
    const handleExportJSON = () => {
      try {
        const exportData = messages.map(msg => ({ ...msg, timestamp: new Date(msg.ts).toISOString() }));
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url; link.download = `grpc-messages-${Date.now()}.json`;
        document.body.appendChild(link); link.click();
        document.body.removeChild(link); URL.revokeObjectURL(url);
      } catch { }
    };

    // Export CSV
    const handleExportCSV = () => {
      try {
        const csvRows: string[] = ['Timestamp,ISO Time,Kind,Type,Data,Error,Code,Details,Reason,Method,Call Type,Target'];
        messages.forEach(msg => {
          const isoTime = new Date(msg.ts).toISOString();
          let type = '', data = '', error = '', code = '', details = '', reason = '', method = '', callTypeVal = '', targetVal = '';
          if (msg.kind === 'stream-data') { type = msg.type; data = JSON.stringify(msg.data).replace(/"/g, '""'); }
          else if (msg.kind === 'stream-response' || msg.kind === 'unary-response') { data = JSON.stringify(msg.data).replace(/"/g, '""'); }
          else if (msg.kind === 'stream-error') { error = msg.error.replace(/"/g, '""'); code = msg.code ? String(msg.code) : ''; details = msg.details ? msg.details.replace(/"/g, '""') : ''; }
          else if (msg.kind === 'stream-end') { reason = msg.reason ? msg.reason.replace(/"/g, '""') : ''; }
          else if (msg.kind === 'stream-open') { method = msg.method || ''; callTypeVal = msg.callType || ''; targetVal = msg.target || ''; }
          csvRows.push(`${msg.ts},"${isoTime}","${msg.kind}","${type}","${data}","${error}","${code}","${details}","${reason}","${method}","${callTypeVal}","${targetVal}"`);
        });
        const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url; link.download = `grpc-messages-${Date.now()}.csv`;
        document.body.appendChild(link); link.click();
        document.body.removeChild(link); URL.revokeObjectURL(url);
      } catch { }
    };

    // ── Derived state ──────────────────────────────────────────────────────────
    const streamItems = React.useMemo(() => normalizeItems(messages), [messages]);

    const showInputUI = React.useCallback(() => {
      if (streamEnded) return false;
      if (callType === 'unary') return true;
      if (callType !== 'unary' && !connected) return false;
      return true;
    }, [callType, connected, streamEnded]);

    const canSendMessages = React.useMemo(() => {
      if (callType === "unary") return !loading;
      return connected && !streamEnded;
    }, [callType, connected, streamEnded, loading]);

    // Call type icon
    const getCallTypeIcon = () => {
      switch (callType) {
        case 'unary': return <ArrowRight size={12} style={{ color: 'var(--info, #7dc4e4)' }} />;
        case 'server_streaming': return <ArrowDown size={12} style={{ color: 'var(--success, #7fd0b2)' }} />;
        case 'client_streaming': return <ArrowUp size={12} style={{ color: 'var(--syntax-keyword, #c3a6ff)' }} />;
        case 'bidirectional_streaming': return <ArrowLeftRight size={12} style={{ color: 'var(--warning, #d7b56d)' }} />;
        default: return null;
      }
    };

    // Status
    const statusDot: 'connected' | 'error' | 'closed' | 'ready' | 'loading' = (() => {
      if (callType === 'unary') {
        if (loading) return 'loading';
        if (unaryError) return 'error';
        return 'ready';
      }
      if (loading) return 'loading';
      if (connected && !streamEnded) return 'connected';
      if (streamEnded) return 'closed';
      return 'closed';
    })();

    const statusText = (() => {
      if (callType === 'unary') {
        if (loading) return 'Sending...';
        if (unaryError) return 'Error';
        return 'Ready';
      }
      if (loading) return 'Loading...';
      if (connected && !streamEnded) return 'Connected';
      if (streamEnded) return 'Ended';
      return 'Disconnected';
    })();

    const methodLabel = service && method ? `${service}.${method}` : undefined;

    // ── Render ─────────────────────────────────────────────────────────────────

    if (!grpcId) {
      return (
        <NodeViewWrapper>
          <div className="bg-bg flex items-center justify-center p-6">
            <div className="flex items-center gap-2 text-red-400 text-sm">
              <AlertCircle size={16} />
              <span>gRPC connection could not be initialized — no identifier provided.</span>
            </div>
          </div>
        </NodeViewWrapper>
      );
    }

    // Loading state for initial streaming connection
    if (!firstLoad.current && callType !== 'unary') {
      return (
        <NodeViewWrapper>
          <StreamHeader
            expanded={true}
            onToggle={() => {}}
            protocol="gRPC"
            callTypeIcon={getCallTypeIcon()}
            methodLabel={methodLabel}
            items={[]}
            statusDot="loading"
            statusText="Connecting..."
          />
          <div className="bg-editor flex items-center gap-2 px-3 py-4">
            <Loader2 size={14} className="animate-spin text-comment" />
            <span className="text-sm text-comment">Making connection...</span>
          </div>
        </NodeViewWrapper>
      );
    }

    return (
      <NodeViewWrapper className="grpc-messages-node" contentEditable={false}>
        {/* Collapsible Header */}
        <StreamHeader
          expanded={expanded}
          onToggle={() => setExpanded((v) => !v)}
          protocol="gRPC"
          callTypeIcon={getCallTypeIcon()}
          methodLabel={methodLabel}
          items={streamItems}
          statusDot={statusDot}
          statusText={statusText}
          actions={
            <>
              {callType !== 'unary' && connected && !streamEnded && (
                <StreamActionBtn onClick={(e) => { e.stopPropagation(); handleEndStream(); }}>
                  End Stream
                </StreamActionBtn>
              )}
              {connected && !streamEnded && callType !== 'unary' && (
                <StreamActionBtn danger onClick={(e) => { e.stopPropagation(); handleCancel(); }}>
                  Cancel
                </StreamActionBtn>
              )}
              <StreamExportMenu
                onExportJSON={handleExportJSON}
                onExportCSV={handleExportCSV}
                hasMessages={messages.length > 0}
              />
            </>
          }
        />

        {expanded && (
          <>
            {/* Message List */}
            <div
              ref={listRef}
              className="bg-editor"
              style={{ maxHeight: '60vh', overflowY: 'auto' }}
            >
              {messages.length === 0 ? (
                <div className="px-3 py-3 text-sm text-comment">
                  {callType === 'unary'
                    ? "Ready to send. Enter your request below."
                    : "Waiting for connection..."}
                </div>
              ) : (
                <>
                  {messages.map((msg, idx) => {
                    const si = streamItems[idx];
                    if (si.type === 'event') {
                      return <StreamEventRow key={idx} event={si.item} />;
                    }
                    return (
                      <StreamMessageRow
                        key={idx}
                        message={si.item}
                        onCopy={() => handleCopyMessage(msg, idx)}
                        isCopied={copiedIndex === idx}
                      />
                    );
                  })}
                  {/* Loading indicator for unary */}
                  {callType === 'unary' && loading && (
                    <div className="flex items-center gap-2 px-[10px] py-2 text-[11px] text-comment font-mono">
                      <span className="ml-[17px]"><Loader2 size={12} className="animate-spin" /></span>
                      Waiting for response...
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Compact Input */}
            {showInputUI() && (
              <div className="border-t border-border">
                <div className="flex items-center gap-2 py-2 px-3">
                  <select
                    value={messageFormat}
                    onChange={(e) => handleLangChange(e.target.value as 'json' | 'text')}
                    className="bg-bg text-text border border-border rounded px-[6px] py-[3px] text-[10px] font-mono font-semibold outline-none cursor-pointer"
                    disabled={!canSendMessages}
                  >
                    <option value="json">JSON</option>
                    <option value="text">TEXT</option>
                  </select>
                  <div
                    className="flex-1"
                    onKeyDown={(e) => {
                      // Cmd/Ctrl+Enter sends the message
                      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                        e.preventDefault();
                        e.stopPropagation();
                        handleSendMessage();
                        return;
                      }
                      e.stopPropagation();
                    }}
                    onKeyUp={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {context.ui.components.CodeEditor ? (
                      <context.ui.components.CodeEditor
                        lang={messageFormat}
                        value={requestInput}
                        onChange={(val: string) => setRequestInput(val)}
                        readOnly={!canSendMessages}
                      />
                    ) : (
                      <textarea
                        className="w-full bg-bg text-text border border-border rounded px-2 py-1 text-[11px] font-mono outline-none resize-none"
                        rows={2}
                        value={requestInput}
                        onChange={(e) => setRequestInput(e.target.value)}
                        placeholder="{}"
                      />
                    )}
                  </div>
                  {callType !== 'unary' && (
                    <button
                      className="px-3 py-1.5 text-[11px] font-semibold font-mono text-comment
                        border border-border rounded cursor-pointer transition-colors
                        hover:text-yellow-400 hover:border-yellow-400
                        disabled:opacity-40 disabled:cursor-not-allowed"
                      onClick={handleEndStream}
                      disabled={!canSendMessages}
                    >
                      END
                    </button>
                  )}
                  <button
                    className="px-4 py-1.5 text-[11px] font-bold font-mono text-comment
                      border border-border rounded cursor-pointer transition-colors
                      hover:text-accent hover:border-accent
                      disabled:opacity-40 disabled:cursor-not-allowed"
                    onClick={handleSendMessage}
                    disabled={!canSendMessages}
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
    name: "grpc-messages-node",
    group: "block",
    atom: true,
    addAttributes() {
      return {
        grpcId: { default: null },
        callType: { default: null },
        service: { default: null },
        method: { default: null },
        target: { default: null },
        url: { default: null },
        package: { default: null },
        headers: { default: null },
        protoFilePath: { default: null },
        sourceFilePath: { default: null },
        protoServices: { default: null },
      };
    },
    parseHTML() {
      return [{ tag: 'div[data-type="grpc-messages-node"]' }];
    },
    renderHTML({ HTMLAttributes }) {
      return ["div", { "data-type": "grpc-messages-node", ...HTMLAttributes }];
    },
    addNodeView() {
      return ReactNodeViewRenderer(GrpcMessagesComponent);
    },
  });
};
