import type { RunnerFactory, RunnerContext, Block, CliRequestState } from '@voiden/sdk/runner'

/**
 * voiden-sockets — headless block parser.
 *
 * Parses WebSocket (ws/wss) and gRPC (grpc/grpcs) socket-request blocks and
 * returns a RestApiRequestState ready for executeRequestPipeline.
 *
 * No RunnerContext, no React — pure Node.js-compatible parsing logic.
 *
 * Default export: RunnerFactory — called by voiden-runner's plugin loader.
 * Named export:   buildRequest  — available for direct use / testing.
 */

type RestApiRequestState = CliRequestState

export function buildRequest(blocks: Block[]): RestApiRequestState | null {
  const socketBlock = blocks.find((b: any) => b.type === 'socket-request')
  if (!socketBlock) return null

  let url = ''
  if (Array.isArray(socketBlock.content)) {
    for (const node of socketBlock.content) {
      if (node.type === 'surl' && typeof node.content === 'string')
        url = node.content.trim()
    }
  }
  if (!url) return null

  const lower = url.toLowerCase()
  let protocol = 'ws'
  if      (lower.startsWith('wss://'))  protocol = 'wss'
  else if (lower.startsWith('ws://'))   protocol = 'ws'
  else if (lower.startsWith('grpcs://')) protocol = 'grpcs'
  else if (lower.startsWith('grpc://')) protocol = 'grpc'

  const headersBlock = blocks.find((b: any) => b.type === 'headers-table')
  const headers: Array<{ key: string; value: string; enabled: boolean }> = []
  if (headersBlock && Array.isArray(headersBlock.content)) {
    for (const child of headersBlock.content as any[]) {
      if (child.type === 'table' && Array.isArray(child.rows)) {
        for (const r of child.rows) {
          if (!r.attrs?.disabled && Array.isArray(r.row) && r.row[0]) {
            headers.push({
              key:     String(r.row[0]).trim(),
              value:   String(r.row[1] ?? '').trim(),
              enabled: true,
            })
          }
        }
      }
    }
  }

  // gRPC metadata — stored in requestState.grpc so executeSecureRequest can
  // pass them directly to executeGrpc (which reads requestState.grpc, not metadata).
  const protoBlock = (socketBlock.content as any[] | undefined)?.find?.((n: any) => n.type === 'proto')
  const grpc: Record<string, any> = {}
  if (protoBlock?.attrs) {
    const a = protoBlock.attrs
    if (a.protoFilePath) grpc.protoFilePath = a.protoFilePath
    if (a.service)       grpc.service       = a.service
    if (a.method)        grpc.method        = a.method   // 'method' matches executeSecureRequest
    if (a.package)       grpc.package       = a.package
    if (a.callType)      grpc.callType      = a.callType
  }

  return {
    // Use the protocol as the "method" so CLI output shows WSS/WS/GRPC/GRPCS.
    method:      protocol.toUpperCase(),
    url,
    headers,
    queryParams: [],
    pathParams:  [],
    grpc:        Object.keys(grpc).length ? grpc : undefined,
    metadata:    { protocol },
  } as any
}

// ─── RunnerFactory ────────────────────────────────────────────────────────────
// voiden-runner loads this default export and calls onload() with a headless
// context.  The plugin registers its buildRequest function so the runner can
// convert WebSocket / gRPC blocks into a request state without hardcoded imports.

const createSocketsRunner: RunnerFactory = (context: RunnerContext) => {
  return {
    onload() {
      // ── Request container registration ────────────────────────────────────
      // Tells voiden-runner's MCP tools (list_requests/write_result) how to
      // find "the request" block and its URL/method (protocol tag) for
      // WebSocket/gRPC. Cast to any: registerRequestContainer is a host
      // capability not yet in the published @voiden/sdk RunnerContext type.
      ;(context as any).registerRequestContainer?.({
        type: 'socket-request',
        urlType: 'surl',
        methodType: 'smethod',
      })

      // ── Request builder ───────────────────────────────────────────────────
      // onBuildRequest handlers run in plugin-load order (registry order — not
      // guaranteed before/after voiden-advanced-auth's own handler), each
      // receiving the previous handler's output as `request`. buildRequest()
      // always returns a fresh headers array built only from headers-table, so
      // we append it onto whatever's already in `request` instead of replacing
      // it — otherwise an auth-block header contributed by voiden-advanced-auth's
      // handler running first would be silently dropped (these headers also
      // become the gRPC call's metadata downstream, so this covers both).
      context.onBuildRequest((request, blocks) => {
        const built = buildRequest(blocks)
        if (!built) return request
        const priorHeaders = Array.isArray((request as any)?.headers) ? (request as any).headers : []
        return {
          ...built,
          headers: [...priorHeaders, ...(built as any).headers],
        }
      })

      // ── Handoff handler: connect WS/gRPC after executeSecureRequest handoff ─
      // executeSecureRequest returns { kind: 'handoff' } for WS/gRPC (same as
      // Electron). cliElectron surfaces this as response.metadata.handoff.
      // This handler picks it up, establishes the actual connection, and
      // replaces the response body with a connection report for CLI display.
      context.onProcessResponse(async (response) => {
        const handoff = response?.metadata?.handoff
        if (!handoff) return

        const { protocol, url, headers: resolvedHeaders, grpc: grpcConfig, body } = handoff
        const headersList = Object.entries(resolvedHeaders as Record<string, string>)
          .map(([key, value]) => ({ key, value, enabled: true }))

        if (protocol === 'ws' || protocol === 'wss') {
          const result = await context.protocols?.executeWebSocket({ protocol, url, headers: headersList })
          if (!result) return
          
          const report = {
            connected:  result.connected ?? false,
            protocol,
            url,
            durationMs: result.durationMs,
            ...(result.error ? { error: result.error } : {}),
          }
          const res = response as any
          res.statusCode    = result.connected ? 101 : 0
          res.statusMessage = result.connected ? 'Switching Protocols' : (result.error ?? 'Connection Failed')
          // Backward-compat for older executors/runners
          res.status    = res.statusCode
          res.statusText = res.statusMessage
          response.body          = JSON.stringify(report, null, 2)
          // response.contentType   = 'application/json' // CliResponseState doesn't have contentType
          if (response.metadata) delete response.metadata.handoff

        } else if (protocol === 'grpc' || protocol === 'grpcs') {
          const result = await context.protocols?.executeGrpc({
            protocol, url,
            metadata: resolvedHeaders,
            body,
            ...(grpcConfig ?? {}),
          })
          if (!result) return

          const report = {
            connected:  result.connected ?? false,
            protocol,
            url,
            durationMs: result.durationMs,
            ...(grpcConfig?.service ? { service: grpcConfig.service } : {}),
            ...(grpcConfig?.method  ? { method:  grpcConfig.method  } : {}),
            ...(result.error ? { error: result.error } : {}),
          }
          const res = response as any
          res.statusCode    = result.connected ? 200 : 0
          res.statusMessage = result.connected ? 'Connected' : (result.error ?? 'Connection Failed')
          // Backward-compat
          res.status    = res.statusCode
          res.statusText = res.statusMessage
          response.body          = JSON.stringify(report, null, 2)
          // response.contentType   = 'application/json'
          if (response.metadata) delete response.metadata.handoff
        }
      })
    },
  }
}

export default createSocketsRunner

