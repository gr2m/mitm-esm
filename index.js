const Net = require("net");
const Tls = require("tls");
const Http = require("http");
const ClientRequest = Http.ClientRequest;
const Socket = require("./lib/socket");
const TlsSocket = require("./lib/tls_socket");
const EventEmitter = require("events").EventEmitter;
const InternalSocket = require("./lib/internal_socket");
const Stubs = require("./lib/stubs");
const slice = Function.call.bind(Array.prototype.slice);
const normalizeConnectArgs = Net._normalizeArgs;
const createRequestAndResponse = Http._connectionListener;
module.exports = Mitm;

function Mitm() {
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

const IncomingMessage = require("_http_incoming").IncomingMessage;
const ServerResponse = require("_http_server").ServerResponse;
const incomingMessageKey = require("_http_common").kIncomingMessage;
const serverResponseKey = require("_http_server").kServerResponse;
Mitm.prototype[serverResponseKey] = ServerResponse;
Mitm.prototype[incomingMessageKey] = IncomingMessage;

Mitm.prototype.enable = function () {
  // Connect is called synchronously.
  const netConnect = this.tcpConnect.bind(this, Net.connect);
  const tlsConnect = this.tlsConnect.bind(this, Tls.connect);

  this.stubs.stub(Net, "connect", netConnect);
  this.stubs.stub(Net, "createConnection", netConnect);
  this.stubs.stub(Http.Agent.prototype, "createConnection", netConnect);
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
  const sockets = InternalSocket.pair();

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

Mitm.prototype.tcpConnect = function (orig, opts, done) {
  const args = normalizeConnectArgs(slice(arguments, 1));
  opts = args[0];
  done = args[1];

  // The callback is originally bound to the connect event in
  // Socket.prototype.connect.
  const client = this.connect(orig, Socket, opts, done);
  if (client.mitmServerSocket == null) {
    return client;
  }
  if (done) client.once("connect", done);

  return client;
};

Mitm.prototype.tlsConnect = function (orig, opts, done) {
  const args = normalizeConnectArgs(slice(arguments, 1));
  opts = args[0];
  done = args[1];

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
