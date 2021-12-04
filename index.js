// Native Node APIs
import Net from "net";
import Tls from "tls";
import { ClientRequest, Agent } from "http";
import { EventEmitter } from "events";

// Internal APIs
import { _connectionListener as createRequestAndResponse } from "http";
import { _normalizeArgs as normalizeConnectArgs } from "net";
import { IncomingMessage } from "_http_incoming";
import { ServerResponse } from "_http_server";
import { kIncomingMessage as incomingMessageKey } from "_http_common";
import { kServerResponse as serverResponseKey } from "_http_server";

import Socket from "./lib/socket.js";
import TlsSocket from "./lib/tls_socket.js";
import { createInternalSocketPair } from "./lib/internal_socket.js";
import Stubs from "./lib/stubs.js";

export default function Mitm() {
  if (!(this instanceof Mitm))
    return Mitm.apply(Object.create(Mitm.prototype), arguments).enable();

  this.stubs = new Stubs();
  this.on("request", addCrossReferences);

  return this;
}

Mitm.prototype.on = EventEmitter.prototype.on;
Mitm.prototype.once = EventEmitter.prototype.once;
Mitm.prototype.off = EventEmitter.prototype.removeListener;
Mitm.prototype.addListener = EventEmitter.prototype.addListener;
Mitm.prototype.removeListener = EventEmitter.prototype.removeListener;
Mitm.prototype.emit = EventEmitter.prototype.emit;

Mitm.prototype[serverResponseKey] = ServerResponse;
Mitm.prototype[incomingMessageKey] = IncomingMessage;

Mitm.prototype.enable = function () {
  // Connect is called synchronously.
  const netConnect = this.tcpConnect.bind(this, Net.connect);
  const tlsConnect = this.tlsConnect.bind(this, Tls.connect);

  this.stubs.stub(Net, "connect", netConnect);
  this.stubs.stub(Net, "createConnection", netConnect);
  this.stubs.stub(Agent.prototype, "createConnection", netConnect);
  this.stubs.stub(Tls, "connect", tlsConnect);

  // ClientRequest.prototype.onSocket is called synchronously from
  // ClientRequest's constructor and is a convenient place to hook into new
  // ClientRequests.
  const origOnSocket = ClientRequest.prototype.onSocket;
  const self = this;
  this.stubs.stub(ClientRequest.prototype, "onSocket", function (socket) {
    origOnSocket.call(this, socket);
    self.request(socket);
  });

  return this;
};

Mitm.prototype.disable = function () {
  return this.stubs.restore(), this;
};

Mitm.prototype.connect = function connect(orig, Socket, opts, done) {
  const sockets = createInternalSocketPair();

  // Don't set client.connecting to false because there's nothing setting it
  // back to false later. Originally that was done in Socket.prototype.connect
  // and its afterConnect handler, but we're not calling that.
  const client = new Socket({
    handle: sockets[0],

    // Node v10 expects readable and writable to be set at Socket creation time.
    readable: true,
    writable: true,

    ...opts,
  });

  this.emit("connect", client, opts);
  if (client.bypassed) return orig.call(this, opts, done);

  // Don't use just "server" because socket.server is used in Node v8.12 and
  // Node v9.6 and later for modifying the HTTP server response and parser
  // classes. If unset, it's set to the used HTTP server (Mitm instance in our
  // case) in _http_server.js.
  // See also: https://github.com/nodejs/node/issues/13435.
  const server = (client.mitmServerSocket = new Socket({
    handle: sockets[1],
    readable: true,
    writable: true,
  }));

  this.emit("connection", server, opts);

  // Ensure connect is emitted in next ticks, otherwise it would be impossible
  // to listen to it after calling Net.connect or listening to it after the
  // ClientRequest emits "socket".
  setTimeout(client.emit.bind(client, "connect"));
  setTimeout(server.emit.bind(server, "connect"));

  return client;
};

Mitm.prototype.tcpConnect = function (orig, ...args) {
  const [opts, done] = normalizeConnectArgs(args);

  // The callback is originally bound to the connect event in
  // Socket.prototype.connect.
  const client = this.connect(orig, Socket, opts, done);
  if (client.mitmServerSocket == null) {
    return client;
  }
  if (done) client.once("connect", done);

  return client;
};

Mitm.prototype.tlsConnect = function (orig, ...args) {
  const [opts, done] = normalizeConnectArgs(args);

  const client = this.connect(orig, TlsSocket, opts, done);
  if (client.mitmServerSocket == null) return client;
  if (done) client.once("secureConnect", done);

  setTimeout(client.emit.bind(client, "secureConnect"));

  return client;
};

Mitm.prototype.request = function request(socket) {
  if (!socket.mitmServerSocket) return socket;

  createRequestAndResponse.call(this, socket.mitmServerSocket);
  return socket;
};

function addCrossReferences(req, res) {
  req.res = res;
  res.req = req;
}
