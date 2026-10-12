## Extension: Voiden Sockets / gRPC

Provides WebSocket and gRPC block types via `socket-request`, `surl`, `smethod`, `proto`, `messages-node`, and `grpc-messages-node`.

> **Not singleton:** `socket-request` is explicitly allowed multiple times per file — one WebSocket/gRPC request per `request-separator` section, exactly like REST `request` blocks. A second `socket-request` (in its own section) is intended, not a duplicate to remove.

### socket-request — Socket/gRPC Request Container

Top-level container. For **WebSocket** it holds `smethod` + `surl`. For **gRPC** it holds `smethod` + `surl` + `proto`. That is the whole request — `messages-node` and `grpc-messages-node` are live viewers the app opens in the response panel when you connect, and are never written into the `.void` file (see below).

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

> **`filePath` is relative to the project root, with NO leading slash** — `filePath: "grpc/user.proto"`, not `"/grpc/user.proto"` and not `"./grpc/user.proto"`. This differs from `linkedFile`/`fileLink` elsewhere in `.void` files, where a leading `/` means "relative to the project root": for `proto.filePath` a leading `/` (or a Windows drive letter like `C:\`) means a literal absolute filesystem path, used only for a proto that lives outside the project. It is also **not** relative to the `.void` file's own folder — a `.void` file in `requests/grpc/` pointing at `protos/user.proto` in the project root still writes `filePath: "protos/user.proto"`, never `"../../protos/user.proto"`. `fileName` is just the base name of the same file (`user.proto`).

**The `.proto` file must exist on disk before you reference it.** Check for it first (list the project's `*.proto` files). Then:

- **It exists** — set `fileName` and `filePath` to it, and take `selectedService` / `selectedMethod` / `callType` from the `service` and `rpc` definitions in that file — don't guess names. `packageName` is the file's `package` (or `""`).
- **It doesn't exist and the user gave you the service definition** — create the `.proto` file in the project first, then reference it.
- **It doesn't exist and you don't have the definition** — do **not** invent a `fileName`/`filePath`. Write the block with no proto attached (below) and tell the user to click "Import proto file" on it. A made-up path leaves the block showing "Proto file not found" and the request unable to run.

```yaml
- type: proto          # no proto attached yet — the app shows an "Import proto file" link
  attrs:
    uid: "uid"
    fileName: null
    filePath: null
    packageName: null
    services: []
    selectedService: null
    selectedMethod: null
    callType: null
```

`services` is a parsed proto service tree — **the app populates it automatically** when it reads the file at `filePath` (whenever `fileName` is set and `services` is still empty), so always leave `services: []` when hand-authoring; you don't need to (and can't feasibly) hand-write the parsed tree yourself.

### messages-node — WebSocket Messages Viewer (never hand-author this)

`messages-node` is the live message stream for one open WebSocket connection. The app creates it itself, in the **response panel**, when you connect — bound to that connection's `wsId`. It is not part of a request and must **not** be written into a `.void` file: a WebSocket request is complete with just the `socket-request` block (`smethod` + `surl`), plus optional headers/query/auth blocks. Adding a `messages-node` to the file puts a second viewer inside the document itself, so sent and received messages end up shown in the `.void` file as well as in the response panel. If you find one in a file you're editing with `wsId: null`, remove it.

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

No `messages-node` follows it — connecting from the app opens the message stream in the response panel.

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
