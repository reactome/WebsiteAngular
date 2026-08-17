// IPv4 forwarder for TinaCMS dev server.
//
// `tinacms dev` binds only to ::1:4001 (IPv6 loopback). Docker's
// port-publish is IPv4-only, so the host's localhost:4001 forwards
// IPv4 -> container IPv4 -> nothing. SSH-tunneling 4001 to a laptop
// hits the same dead end. This script listens on 0.0.0.0:4001 in
// the container (different address family from Tina's ::1, so they
// coexist) and pipes each connection through to [::1]:4001.
//
// Spawned as a background process from the Dockerfile CMD, alongside
// `tinacms dev`. The proxy is lazy -- it only connects to ::1:4001
// when a client connects, so a delayed Tina startup doesn't matter.

const net = require('net');

const LISTEN_PORT = 4001;
const TARGET_HOST = '::1';
const TARGET_PORT = 4001;

net
  .createServer((client) => {
    const upstream = net.connect({ host: TARGET_HOST, port: TARGET_PORT });
    client.pipe(upstream);
    upstream.pipe(client);
    client.on('error', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
  })
  .listen(LISTEN_PORT, '0.0.0.0', () => {
    console.log(`tina-ipv4-proxy: 0.0.0.0:${LISTEN_PORT} -> [${TARGET_HOST}]:${TARGET_PORT}`);
  });
