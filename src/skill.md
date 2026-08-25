## Extension: Voiden Sockets / gRPC

Provides WebSocket and gRPC block types via `socket-request`, `surl`, `smethod`, `proto`, `messages-node`, and `grpc-messages-node`.

> **Not singleton:** `socket-request` is explicitly allowed multiple times per file — one WebSocket/gRPC request per `request-separator` section, exactly like REST `request` blocks. A second `socket-request` (in its own section) is intended, not a duplicate to remove.

### socket-request — Socket/gRPC Request Container

Top-level container. For **WebSocket** it holds `smethod` + `surl` + `messages-node`. For **gRPC** it holds `smethod` + `surl` + `proto` + `grpc-messages-node`.

### smethod — Protocol Method Tag

```yaml
- type: smethod
  attrs:
    uid: "uid"
    method: WSS         # WSS | WS | GRPCS | GRPC (protocol tag, not a service method)
    visible: true
  content: WSS          # display text — matches method value
```

`method` is always a **protocol identifier**, not a gRPC service/method name:
- `WSS` — WebSocket over TLS (`wss://`)
- `WS` — WebSocket plain (`ws://`)
- `GRPCS` — gRPC over TLS (`grpcs://`)
- `GRPC` — gRPC plain (`grpc://`)

### surl — Socket / gRPC URL

```yaml
- type: surl
  attrs:
    uid: "uid"
  content: "wss://echo.example.com/ws"    # wss:// | ws:// | grpcs:// | grpc://
```

> **The scheme prefix is required, not decorative.** Headless execution (`run_request`, `voiden-runner`) determines the protocol purely by checking `surl`'s content for a `wss://`/`ws://`/`grpcs://`/`grpc://` prefix — it does not read `smethod` at all. A bare host:port like `"grpcb.in:9001"` silently falls back to `ws`, which for a gRPC target is wrong and will not connect as a gRPC channel. Always include the scheme, even though the live app UI additionally shows `smethod` for display.

### proto — Protobuf Definition (gRPC only)

```yaml
- type: proto
  attrs:
    uid: "uid"
    fileName: "user.proto"
    filePath: "grpc/user.proto"
    packageName: "com.example.user"
    services: []                  # parsed service/method tree — managed by UI, see below
    selectedService: "UserService"
    selectedMethod: "GetUser"
    callType: "unary"             # unary | server_streaming | client_streaming | bidirectional_streaming (underscored — not hyphenated)
```

> **`filePath` uses a DIFFERENT convention than `linkedFile`/`fileLink` elsewhere in `.void` files — do not carry that convention over here.** For `linkedFile`/`fileLink`, a leading `/` means "relative to the project root" (see the base voiden skill). For `proto.filePath`, a leading `/` (or a Windows drive letter like `C:\`) means the opposite — a literal, absolute filesystem path, resolved exactly as written, NOT joined against the project root. A path with no leading `/` is the one that gets joined against the active project directory. So to reference `grpc/user.proto` inside the project, write `filePath: "grpc/user.proto"` (no leading slash) — writing `filePath: "/grpc/user.proto"` will instead try to read literally from the filesystem root and silently fail to find anything, leaving `services` empty.

`services` is a parsed proto service tree — **the app populates it automatically** the first time it successfully reads the file at `filePath` (whenever `fileName` is set and `services` is still empty), so leave `services: []` when hand-authoring; you don't need to (and can't feasibly) hand-write the parsed tree yourself. Only set `fileName`, `filePath`, `selectedService`, `selectedMethod`, and `callType` — but be aware `selectedService`/`selectedMethod` only mean anything once the file at `filePath` is actually readable and gets parsed; if the path is wrong, they silently point at nothing.

### messages-node — WebSocket Messages Viewer

Standalone block that shows live WebSocket messages during and after a connection. Attrs are managed by the Voiden UI — do not set them manually.

```yaml
---
type: messages-node
attrs:
  uid: "uid"
  wsId: null            # connection ID — set by UI during connection
  url: null             # resolved URL — set by UI
  headers: null         # resolved headers — set by UI
  sourceFilePath: null  # source file path — set by UI
---
```

### grpc-messages-node — gRPC Call Record (never hand-author this)

`grpc-messages-node` is an **atom node — it cannot have child content at all**, and there is no `message` node type registered anywhere in this plugin. Writing `content: [{ type: message, ... }]` (as older versions of this doc incorrectly showed) throws `RangeError: Unknown node type: message` and breaks the whole document.

This node is a **recorded result**, the same convention as a REST `response` block: the app generates it automatically — with real attrs — after you actually run a call from the live UI. Never author one by hand; if you're building a gRPC request from scratch, stop at the `socket-request` block (`smethod` + `surl` + `proto`) and leave this node out entirely.

```yaml
---
type: grpc-messages-node
attrs:
  grpcId: "grpc-123"
  callType: unary                # unary | server_streaming | client_streaming | bidirectional_streaming (underscored — not hyphenated)
  service: UserService
  method: GetUser
  target: "grpcs://api.example.com:443"
  url: "grpcs://api.example.com:443"
  package: "com.example.user"
  headers: "[]"                  # JSON-stringified array
  protoFilePath: "user.proto"
  sourceFilePath: null
  protoServices: null            # JSON-stringified parsed proto tree, set by the app
---
```

**Call types** (note the underscores):
| `callType` | Description |
|------------|-------------|
| `unary` | Single request → single response |
| `server_streaming` | Single request → stream of responses |
| `client_streaming` | Stream of requests → single response |
| `bidirectional_streaming` | Stream of requests → stream of responses |

### Headless execution is connectivity-only, not a real call

Running a `socket-request` gRPC block headlessly (`run_request`, `voiden-runner`) only verifies the channel reaches `READY` state — it does **not** invoke the selected method or send any message, and there is currently no `.void` field anywhere that carries a custom request body through to a headless gRPC call. To actually invoke a method with a real request body and see a real response, open the file in the app and send it interactively — that's what populates a `grpc-messages-node` with genuine data. Don't try to pre-author the "request" for a headless run; there's nowhere for it to go yet.

### Complete WebSocket Example

```markdown
---
version: __VOIDEN_APP_VERSION__
generatedBy: Voiden app
note: This file is auto-generated by the Voiden app
generatedAt: 2025-01-15T10:30:00.000Z
---

# Echo WebSocket

```void
---
type: socket-request
attrs:
  uid: "so1ck2et-e5f6-7890-abcd-ef1234567890"
content:
  - type: smethod
    attrs:
      uid: "sm1eth2-e5f6-7890-abcd-ef1234567890"
      method: WSS
      visible: true
    content: WSS
  - type: surl
    attrs:
      uid: "su1rl23-e5f6-7890-abcd-ef1234567890"
    content: "wss://{{WS_HOST}}/socket"
---
```

```void
---
type: messages-node
attrs:
  uid: "ms1sg23-e5f6-7890-abcd-ef1234567890"
  wsId: null
  url: null
  headers: null
  sourceFilePath: null
---
```

### Complete gRPC Example

A `grpc-messages-node` is deliberately **not** included below — see "gRPC Call Record" above: it's a recorded result the app generates after a real run, not something to author here. This is the complete, correct shape for authoring a gRPC request from scratch; running it (`run_request`) verifies the channel connects, and sending it interactively from the app UI is what actually invokes `GetUser` and records the response.

```void
---
type: socket-request
attrs:
  uid: "s1ocket2-e5f6-7890-abcd-ef1234567890"
content:
  - type: smethod
    attrs:
      uid: "sm1eth2-e5f6-7890-abcd-ef1234567890"
      method: GRPCS
      visible: true
    content: GRPCS
  - type: surl
    attrs:
      uid: "su1rl23-e5f6-7890-abcd-ef1234567890"
    content: "grpcs://{{GRPC_HOST}}:443"
  - type: proto
    attrs:
      uid: "p1rot23-e5f6-7890-abcd-ef1234567890"
      fileName: "user.proto"
      filePath: "grpc/user.proto"
      packageName: ""
      services: []
      selectedService: "UserService"
      selectedMethod: "GetUser"
      callType: "unary"
---
```
