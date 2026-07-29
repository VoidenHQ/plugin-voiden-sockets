export const SocketRequestHelp = () => (
  <div className="space-y-4">
    <section>
      <h3 className="font-semibold mb-2 text-text">WebSocket &amp; gRPC</h3>
      <p className="text-sm text-comment mb-3">
        This block covers two protocols, picked by the connection URL's scheme — WebSocket
        (<code className="bg-accent/10 px-1 rounded text-text">ws://</code>/<code className="bg-accent/10 px-1 rounded text-text">wss://</code>)
        for real-time, two-way messaging over a single long-lived connection, and gRPC
        (<code className="bg-accent/10 px-1 rounded text-text">grpc://</code>/<code className="bg-accent/10 px-1 rounded text-text">grpcs://</code>)
        for fast, strongly-typed service-to-service calls over HTTP/2 + Protocol Buffers.
      </p>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">WebSocket — How to Use</h4>
      <ol className="list-decimal list-inside space-y-1 text-sm text-comment">
        <li>Insert with <code className="bg-accent/10 px-1 rounded text-text">/wss</code></li>
        <li>Run to connect — the Response panel shows a connection status (Disconnected / Connecting / Connected / Closed)</li>
        <li>Compose messages as Plain Text, JSON, HTML, or XML and send them once connected</li>
        <li>The message log timestamps every message, marking outbound (→) vs inbound (←)</li>
      </ol>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">gRPC — How to Use</h4>
      <ol className="list-decimal list-inside space-y-1 text-sm text-comment">
        <li>Insert with <code className="bg-accent/10 px-1 rounded text-text">/grpcs</code></li>
        <li>Upload or reference a <code className="bg-accent/10 px-1 rounded text-text">.proto</code> file to define the service contract</li>
        <li>Supports unary, server-streaming, client-streaming, and bidirectional streaming calls</li>
        <li>Run and check results in the Response panel</li>
      </ol>
    </section>
  </div>
);
