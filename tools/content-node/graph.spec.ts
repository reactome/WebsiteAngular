// @vitest-environment node
//
// The graph connection's socket, without a database.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import net from 'node:net';
import { READ_TIMEOUT_MS, poolSize } from './graph.ts';

describe('the connections graph.ts opens', () => {
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

describe('the time a read may take', () => {
  // Above the slowest query the service needs (~10s, the content tables at
  // startup), and far below the minutes a runaway in-depth query held the
  // shared database for on 15 Oct 2026 before it ran out of memory.
  it('is limited, to 30 seconds', () => {
    expect(READ_TIMEOUT_MS).toBe(30_000);
  });
});

describe('GRAPH_POOL_SIZE', () => {
  it('takes a whole number from 1 to 100, and 32 for anything else', () => {
    expect(poolSize('16')).toBe(16);
    for (const setting of [undefined, '', '-1', '0', '2.5', 'many', '1000']) {
      expect(poolSize(setting), String(setting)).toBe(32);
    }
  });
});
