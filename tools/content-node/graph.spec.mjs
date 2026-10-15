// @vitest-environment node
//
// The graph connection's socket, without a database.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import net from 'node:net';
import './graph.mjs';

describe('the connections graph.mjs opens', () => {
  let server;
  let port;
  beforeAll(async () => {
    server = net.createServer((socket) => socket.end());
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });
  afterAll(() => server.close());

  // The driver never sets it. Without it a request over one segment (~1.4KB of
  // Cypher and parameters) waits for the server's delayed ACK: 43ms against
  // 2ms, measured on beta's graph container, 15 Oct 2026.
  it('turn Nagle off: TCP_NODELAY on every socket opened', async () => {
    const setNoDelay = vi.spyOn(net.Socket.prototype, 'setNoDelay');
    const socket = net.connect(port, '127.0.0.1');
    await new Promise((resolve) => socket.on('close', resolve));
    expect(setNoDelay).toHaveBeenCalledWith(true);
    setNoDelay.mockRestore();
  });
});
