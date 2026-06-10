> A plugin for [Voiden](https://github.com/VoidenHQ) — the developer-first API client.

# Sockets & gRPC APIs

Comprehensive support for WebSocket (WSS) and gRPC communication — unary, server streaming, client streaming, and bidirectional streaming.

## Features

- WebSocket (WSS) connection support
- gRPC with unary, server streaming, client streaming, and bidirectional streaming
- Proto file import and parsing
- Dynamic service and method selection from proto files
- Real-time message exchange
- Connection state management
- Message history and logging
- Dedicated response panel for socket communication
- Support for multiple concurrent connections
- History API integration: websocat / grpcurl command builder

## Usage

Use `/websocket` or `/grpc` slash commands to insert a socket block.

Paste a `websocat` command to auto-populate a WebSocket block, or a `grpcurl` command to populate a gRPC block.

Import `.proto` files to discover services and methods without typing them manually.
