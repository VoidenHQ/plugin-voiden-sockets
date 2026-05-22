/**
 * Voiden Socket Extension
 */

import type { CorePluginContext } from '@voiden/sdk/ui';
type PluginContext = CorePluginContext;
import { insertSocketNode } from './lib/utils';
import { createMessagesNode } from './nodes/MessagesNode';
import { createGrpcMessagesNode } from './nodes/gRPCMessageNode';
import manifest from "./manifest.json";
import { socketHistoryAdapter } from './historyAdapter';

// ─── gRPC config type ────────────────────────────────────────────────────────

interface GrpcConfig {
  fileName: string;
  filePath: string;
  service: string;
  package: string;
  method: string;
  callType: 'unary' | 'server_streaming' | 'client_streaming' | 'bidirectional_streaming';
  requestType: string;
  responseType: string;
}

// ─── Socket-specific helpers ─────────────────────────────────────────────────

function getSocketMethod(editorJson: any): string {
  const socketNode = editorJson.content?.find((n: any) => n.type === 'socket-request');
  const smethodNode = socketNode?.content?.find((n: any) => n.type === 'smethod');
  return smethodNode?.content?.[0]?.text || smethodNode?.attrs?.method || 'GET';
}

function getSocketUrl(editorJson: any): string {
  const socketNode = editorJson.content?.find((n: any) => n.type === 'socket-request');
  return socketNode?.content?.find((n: any) => n.type === 'surl')?.content?.[0]?.text || '';
}

function getGrpcConfig(editorJson: any): GrpcConfig | null {
  const protoNode = editorJson.content
    ?.find((n: any) => n.type === 'socket-request')
    ?.content?.find((n: any) => n.type === 'proto');

  if (!protoNode?.attrs) return null;

  const { fileName, selectedService, packageName, selectedMethod, callType, services } = protoNode.attrs;
  if (!fileName || !selectedService || !selectedMethod) return null;

  const service = services?.find((s: any) => s.name === selectedService);
  const method = service?.methods?.find((m: any) => m.name === selectedMethod);

  return {
    fileName,
    package: packageName,
    filePath: protoNode.attrs.filePath || fileName,
    service: selectedService,
    method: selectedMethod,
    callType: callType || method?.callType || 'unary',
    requestType: method?.request || '',
    responseType: method?.response || '',
  };
}

function getGrpcMetadata(editorJson: any): Record<string, string> {
  const metadata: Record<string, string> = {};
  editorJson.content?.forEach((node: any) => {
    if (node.type !== 'headers-table') return;
    node.content?.forEach((tableNode: any) => {
      if (tableNode.type !== 'table') return;
      tableNode.content?.forEach((rowNode: any) => {
        if (rowNode.type !== 'tableRow' || rowNode.attrs?.disabled) return;
        const key = (rowNode.content?.[0]?.content?.[0]?.content?.[0]?.text || '').trim();
        const value = (rowNode.content?.[1]?.content?.[0]?.content?.[0]?.text || '').trim();
        if (key && value) metadata[key] = value;
      });
    });
  });
  return metadata;
}

// Captured proto services from the most recent gRPC build request — injected into the response doc.
let _pendingProtoServices: any[] | null = null;

export default function createSocketPlugin(context: PluginContext) {
  return {
    onload: async () => {
      const { SocketRequestNode } = await import('./nodes/RequestNode');
      const { createProtoFileNode } = await import('./nodes/ProtoSelectorNode');
      const { createSocketMethodNode } = await import('./nodes/MethodNode');
      const { SocketUrlNode } = await import('./nodes/UrlNode');
      const { NodeViewWrapper } = context.ui.components;
      const { useSendRestRequest } = context.ui.hooks;

      const ProtoFileNode = createProtoFileNode(NodeViewWrapper);
      const SocketMethodNode = createSocketMethodNode(useSendRestRequest);


      const MessagesNode = createMessagesNode(NodeViewWrapper, context);
      const gRPCMessageNode = createGrpcMessagesNode(NodeViewWrapper, context);
      context.registerVoidenExtension(ProtoFileNode);
      context.registerVoidenExtension(SocketRequestNode);
      context.registerVoidenExtension(SocketMethodNode);
      context.registerVoidenExtension(SocketUrlNode);
      context.registerVoidenExtension(MessagesNode);
      context.registerVoidenExtension(gRPCMessageNode);
      context.registerLinkableNodeTypes(['socket-request', 'smethod', 'surl', 'proto', 'messages-node', "grpc-messages-node",

      ]);
      context.addVoidenSlashGroup({
        name: 'sockets',
        title: 'Sockets',
        commands: [
          {
            name: "web-socket",
            label: "Web Socket",
            aliases: ['websocket', 'ws', "wss"],
            singleton: false,
            compareKeys: ["socket-request", "endpoint", "request"],
            slash: "/wss",
            description: "Insert Web Socket block",
            action: (editor: any) => {
              insertSocketNode(editor, "wss");
            },
          },
          {
            name: "grpcs-socket",
            label: "gRPCS Socket",
            singleton: false,
            compareKeys: ["socket-request", "request", "endpoint"],
            aliases: ['grpcsocket', 'grpc', 'grpcs'],
            slash: "/grpcs",
            description: "Insert gRPCS Socket block",
            action: (editor: any) => {
              insertSocketNode(editor, "grpcs");
            },
          },
        ],
      });


      context.onProcessResponse(async (response) => {
        if (response.protocol !== 'wss' && response.protocol !== 'ws' && response.protocol !== 'grpc' && response.protocol !== 'grpcs') {
          return
        }
        try {
          // Capture the source .void file path BEFORE switching to the connected tab
          let sourceFilePath: string | null = null;
          let capturedTabId: string | null = null;
          try {
            capturedTabId = await (context as any).response.getCurrentTabId();
            if (capturedTabId) {
              const panelData = await (window as any).electron?.state?.getPanelTabs('main');
              const tab = (panelData?.tabs as any[])?.find((t: any) => t.id === capturedTabId && t.type === 'document');
              sourceFilePath = tab?.source ?? null;
            }
          } catch { /* best-effort */ }

          const { convertResponseToVoidenDocWithMessageNode, convertResponseToVoidenDocWithGRPCMessageNode } = await import('./lib/responseConverter');
          let responseDoc;
          if (response.protocol === 'wss' || response.protocol === 'ws') {
            responseDoc = convertResponseToVoidenDocWithMessageNode({
              requestMeta: response.requestMeta
                ? { ...response.requestMeta, sourceFilePath }
                : { url: '', headers: [], sourceFilePath },
              wsId: response.wsId || '',
            });
          } else {
            // If there is no grpcId the connection failed before it was established —
            // clear the loading state and surface the actual error instead of opening
            // a broken tab with the "no identifier provided" message.
            if (!response.grpcId) {
              try {
                await (context as any).response.setError(
                  capturedTabId,
                  response.error || 'gRPC connection could not be established'
                );
              } catch { /* best-effort */ }
              return;
            }
            const capturedServices = _pendingProtoServices;
            _pendingProtoServices = null;
            responseDoc = convertResponseToVoidenDocWithGRPCMessageNode({
              requestMeta: response.requestMeta
                ? { ...response.requestMeta, sourceFilePath, protoServices: capturedServices }
                : { url: '', headers: [], package: '', service: '', callType: '', method: '', sourceFilePath, protoServices: capturedServices },
              grpcId: response.grpcId || '',
            });
          }
          // Forward section metadata for multi-request support
          if (response.__sectionIndex !== undefined) {
            responseDoc.attrs = responseDoc.attrs || {};
            responseDoc.attrs.sectionIndex = response.__sectionIndex;
            responseDoc.attrs.sectionColorIndex = response.__sectionColorIndex;
            responseDoc.attrs.sectionLabel = response.__sectionLabel;
          }

          await context.openVoidenTab(
            `connected`,
            responseDoc,
            { readOnly: true }
          );
        } catch (error) {
        }
      });

      // Register request building handler for socket requests
      context.onBuildRequest(async (request, editor) => {
        try {
          // Get the JSON from the editor (linked blocks are already expanded by the orchestrator)
          const editorJson = editor.getJSON();

          // Skip sections without a socket-request node (e.g. REST or GraphQL sections in multi-request files)
          if (!editorJson.content?.some((n: any) => n.type === 'socket-request')) {
            return request;
          }

          // Skip GraphQL documents — the GraphQL plugin handles its own request building
          if (editorJson.content?.some((n: any) => n.type === 'gqlquery')) {
            return request;
          }

          // Get request-building utilities from voiden-rest-api helpers
          const { buildHeadersWithCookies, getTable, parseAuthNode } = (context as any).helpers.requestUtils;

          // Read the gRPC payload from the json_body node.
          // json_body is owned by voiden-rest-api but is also reused for gRPC payload editing.
          // We read it directly here to avoid a cross-plugin runtime dependency.
          const readGrpcBody = (doc: any): string => {
            const node = doc.content?.find((n: any) => n.type === 'json_body');
            return node?.attrs?.body || '';
          };

          const method = getSocketMethod(editorJson).toLowerCase();

          // Capture proto services for injection into the response doc
          try {
            const socketNode = (editorJson.content as any[])?.find((n: any) => n.type === 'socket-request');
            const protoNode = socketNode?.content?.find((n: any) => n.type === 'proto');
            _pendingProtoServices = Array.isArray(protoNode?.attrs?.services) && protoNode.attrs.services.length > 0
              ? protoNode.attrs.services
              : null;
          } catch { _pendingProtoServices = null; }

          const auth = parseAuthNode(editorJson);

          if (method === 'wss' || method === 'ws') {
            return {
              ...request,
              protocolType: 'wss',
              url: getSocketUrl(editorJson),
              headers: buildHeadersWithCookies(editorJson, undefined),
              params: getTable('query-table', editorJson, undefined),
              auth: auth || request.auth,
            };
          }

          // grpc / grpcs
          const grpcConfig = getGrpcConfig(editorJson);

          if (!grpcConfig) {
            const { convertResponseToVoidenDocWithGRPCMessageNode } = await import('./lib/responseConverter');
            const responseDoc = convertResponseToVoidenDocWithGRPCMessageNode({});
            await context.openVoidenTab('connected', responseDoc, { readOnly: true });
            throw "gRPC configuration incomplete: proto file, service, or method is not selected.";
          }

          const url = getSocketUrl(editorJson);
          const preRequestCodeBlock = editorJson.content?.find((n: any) => n.type === 'pre_request_block')?.attrs?.body;
          const postRequestCodeBlock = editorJson.content
            ?.filter((n: any) => n.type === 'post_request_block')
            ?.map((n: any) => n?.attrs?.body)
            .join('\n');

          const builtRequest: any = {
            ...request,
            protocolType: 'grpc',
            url,
            body: readGrpcBody(editorJson),
            auth: auth || request.auth,
            prescript: preRequestCodeBlock,
            postscript: postRequestCodeBlock,
            grpc: {
              protoFile: grpcConfig.fileName,
              protoFilePath: grpcConfig.filePath,
              package: grpcConfig.package,
              service: grpcConfig.service,
              method: grpcConfig.method,
              callType: grpcConfig.callType,
              requestType: grpcConfig.requestType,
              responseType: grpcConfig.responseType,
              metadata: getGrpcMetadata(editorJson),
              payload: readGrpcBody(editorJson),
            },
          };

          // Resolve relative proto file path to absolute so the electron process can find the file
          if (builtRequest.grpc.protoFilePath && !builtRequest.grpc.protoFilePath.startsWith('/')) {
            try {
              const projectDir = await (window as any).electron?.directories?.getActive();
              if (projectDir) {
                const sep = projectDir.endsWith('/') ? '' : '/';
                builtRequest.grpc.protoFilePath = `${projectDir}${sep}${builtRequest.grpc.protoFilePath}`;
              }
            } catch { /* keep as-is */ }
          }

          return builtRequest;
        } catch (error) {
          console.error("Error building socket request:", error);
          throw error;
        }
      });

      // Register pattern handlers (read from manifest)
      const patterns = manifest.capabilities.paste.patterns;
      const {
        convertWebsocatToSocketRequest,
        convertGrpcurlToSocketRequest,
        updateEditorContent,
        insertParagraphAfterRequestBlocks
      } = await import('./lib/converter');

      patterns.forEach(patternConfig => {
        // Parse regex pattern from manifest string (e.g., "/^websocat\\s+/i" -> /^websocat\s+/i)
        const patternMatch = patternConfig.pattern.match(/^\/(.+)\/([gimuy]*)$/);
        const regex = patternMatch
          ? new RegExp(patternMatch[1], patternMatch[2])
          : new RegExp(patternConfig.pattern);

        context.paste.registerPatternHandler({
          canHandle: (text) => {
            return regex.test(text.trim());
          },

          handle: (text, _html, _view) => {
            try {
              const trimmedText = text.trim();
              let socketRequest;

              // Determine command type and convert
              if (/^websocat\s+/i.test(trimmedText)) {
                socketRequest = convertWebsocatToSocketRequest(trimmedText);
              } else if (/^grpcurl\s+/i.test(trimmedText)) {
                socketRequest = convertGrpcurlToSocketRequest(trimmedText);
              } else {
                return false;
              }

              if (!socketRequest) {
                return false;
              }

              const editor = context.project.getActiveEditor('voiden');

              if (!editor) {
                return false;
              }

              // Multi-request support: if editor has existing content, add as a new section
              if (!editor.isEmpty) {
                updateEditorContent(editor, (editorJsonContent) => {
                  // Add a request-separator before the new request
                  editorJsonContent.push({ type: "request-separator", attrs: {} });
                  // Add the converted socket request
                  editorJsonContent.push(...(socketRequest || []));
                  return insertParagraphAfterRequestBlocks(editorJsonContent);
                });
              } else {
                // Empty editor — just insert directly
                updateEditorContent(editor, (editorJsonContent) => {
                  editorJsonContent.push(...(socketRequest || []));
                  return insertParagraphAfterRequestBlocks(editorJsonContent);
                });
              }

              return true;
            } catch (error) {
              return false;
            }
          },
        });
      });

      // CURL IMPORTER: handle websocat/grpcurl paste/replay in the editor
      if ((context as any).paste?.registerCurlImporter) {
        (context as any).paste.registerCurlImporter(async (curlString: string, editor: any) => {
          const trimmed = curlString.trim();
          const {
            convertWebsocatToSocketRequest,
            convertGrpcurlToSocketRequest,
            updateEditorContent,
            insertParagraphAfterRequestBlocks,
          } = await import('./lib/converter');

          let socketRequest: any;
          if (/^websocat\s+/i.test(trimmed)) {
            socketRequest = convertWebsocatToSocketRequest(trimmed);
          } else if (/^grpcurl\s+/i.test(trimmed)) {
            socketRequest = convertGrpcurlToSocketRequest(trimmed);
          } else {
            return false;
          }

          if (!socketRequest || !editor) return false;

          const hasContent = !editor.isEmpty;
          updateEditorContent(editor, (editorJsonContent: any[]) => {
            if (hasContent) {
              // Multi-request: add separator before new request
              editorJsonContent.push({ type: "request-separator", attrs: {} });
            }
            editorJsonContent.push(...(socketRequest || []));
            return insertParagraphAfterRequestBlocks(editorJsonContent);
          });
          return true;
        });
      }

      // Register socket history adapter with the adapter registry
      context.registerHistoryAdapter(socketHistoryAdapter);

      // Register history curl builder for socket protocols (WS/WSS → websocat, GRPC/GRPCS → grpcurl)
      if ((context as any).history?.registerCurlBuilder) {
        (context as any).history.registerCurlBuilder((entry: any, projectPath?: string) => {
          const method = (entry.request?.method ?? '').toUpperCase();
          const url = entry.request?.url ?? '';
          const headers: Array<{ key: string; value: string }> = entry.request?.headers ?? [];
          const body: string | undefined = entry.request?.body;
          const grpcMeta = entry.request?.grpcMeta ?? {};

          const headerArgs = headers
            .filter((h) => h.key && h.value)
            .map((h) => `-H "${h.key}: ${h.value}"`)
            .join(' ');

          if (/^WSS?$/.test(method)) {
            const parts = ['websocat'];
            if (headerArgs) parts.push(headerArgs);
            parts.push(url);
            if (body) return `echo '${body}' | ${parts.join(' ')}`;
            return parts.join(' ');
          }

          if (/^GRPCS?$/.test(method)) {
            const parts = ['grpcurl'];
            const fullService = grpcMeta.package
              ? `${grpcMeta.package}.${grpcMeta.service ?? ''}`.replace(/\.$/, '')
              : (grpcMeta.service ?? '');
            const fullMethod = fullService && grpcMeta.method
              ? `${fullService}/${grpcMeta.method}`
              : '';

            // grpcurl expects plain host:port, not a URL with scheme
            const host = url.replace(/^grpcs?:\/\//, '');

            if (method === 'GRPC') parts.push('-plaintext');
            if (headerArgs) parts.push(headerArgs);

            // Use -import-path <dir> -proto <filename> so grpcurl can locate the file
            if (grpcMeta.protoFilePath) {
              // Resolve relative proto path to absolute for command-line usability
              let protoPath: string = grpcMeta.protoFilePath;
              if (projectPath && protoPath && !protoPath.startsWith('/')) {
                const sep = projectPath.endsWith('/') ? '' : '/';
                protoPath = `${projectPath}${sep}${protoPath}`;
              }
              const lastSlash = protoPath.lastIndexOf('/');
              if (lastSlash !== -1) {
                const dir = protoPath.slice(0, lastSlash);
                const file = protoPath.slice(lastSlash + 1);
                parts.push(`-import-path "${dir}" -proto "${file}"`);
              } else {
                parts.push(`-proto "${protoPath}"`);
              }
            }

            if (body) parts.push(`-d '${body}'`);
            parts.push(host);
            if (fullMethod) parts.push(fullMethod);
            return parts.join(' ');
          }

          return `# ${method} ${url}`;
        });
      }

    },
    onunload: async () => { },
  };
}
