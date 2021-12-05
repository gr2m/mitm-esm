// @ts-check

import Net from "net";
import Tls from "tls";
import { ClientRequest, Agent } from "http";
import { EventEmitter } from "events";

import { NODE_INTERNALS } from "./lib/node_internals.js";

import Socket from "./lib/socket.js";
import TlsSocket from "./lib/tls_socket.js";
import { createInternalSocketPair } from "./lib/internal_socket.js";
import Stubs from "./lib/stubs.js";

export default class Mitm extends EventEmitter {
  constructor() {
    super();

    this.stubs = new Stubs();

    // add cross-reference
    this.on("request", (request, response) => {
      request.res = response;
      response.req = request;
    });

    this[NODE_INTERNALS.serverResponseKey] = NODE_INTERNALS.ServerResponse;
    this[NODE_INTERNALS.incomingMessageKey] = NODE_INTERNALS.IncomingMessage;

    this.enable();
  }

  enable() {
    // Connect is called synchronously.
    const netConnect = this.tcpConnect.bind(this, Net.connect);
    const tlsConnect = this.tlsConnect.bind(this, Tls.connect);

    this.stubs.stub(Net, "connect", netConnect);
    this.stubs.stub(Net, "createConnection", netConnect);
    this.stubs.stub(Agent.prototype, "createConnection", netConnect);
    this.stubs.stub(Tls, "connect", tlsConnect);

    // ClientRequest.prototype.onSocket is called synchronously from ClientRequest's constructor
    // and is a convenient place to hook into new ClientRequest instances.
    const origOnSocket = ClientRequest.prototype.onSocket;
    const self = this;
    this.stubs.stub(ClientRequest.prototype, "onSocket", function (socket) {
      origOnSocket.call(this, socket);
      self.request(socket);
    });

    return this;
  }

  disable() {
    return this.stubs.restore(), this;
  }

  connect(orig, Socket, opts, done) {
    const [requestSocket, responseSocket] = createInternalSocketPair();

    // Don't set request.connecting to false because there's nothing setting it
    // back to false later. Originally that was done in Socket.prototype.connect
    // and its afterConnect handler, but we're not calling that.
    const request = new Socket({
      handle: requestSocket,

      // Node v10 expects readable and writable to be set at Socket creation time.
      readable: true,
      writable: true,

      ...opts,
    });

    this.emit("connect", request, opts);
    if (request.bypassed) return orig.call(this, opts, done);

    const response = new Socket({
      handle: responseSocket,
      readable: true,
      writable: true,
    });

    // We use `.mitmResponseSocket` as a means to check if a request is intercepted
    // for net connects and to pass use it as a response when intercepting http(s) requests.
    request.mitmResponseSocket = response;

    this.emit("connection", response, opts);

    // Ensure connect is emitted in next ticks, otherwise it would be impossible
    // to listen to it after calling Net.connect or listening to it after the
    // ClientRequest emits "socket".
    setTimeout(request.emit.bind(request, "connect"));
    setTimeout(response.emit.bind(response, "connect"));

    return request;
  }

  tcpConnect(orig, ...args) {
    const [opts, callback] = NODE_INTERNALS.normalizeConnectArgs(args);

    const client = this.connect(orig, Socket, opts, callback);
    if (client.mitmResponseSocket == null) return client;
    if (callback) client.once("connect", callback);

    return client;
  }

  tlsConnect(orig, ...args) {
    const [opts, callback] = NODE_INTERNALS.normalizeConnectArgs(args);

    const client = this.connect(orig, TlsSocket, opts, callback);
    if (client.mitmResponseSocket == null) return client;
    if (callback) client.once("secureConnect", callback);

    setTimeout(client.emit.bind(client, "secureConnect"));

    return client;
  }

  request(socket) {
    if (!socket.mitmResponseSocket) return socket;

    NODE_INTERNALS.createRequestAndResponse.call(
      this,
      socket.mitmResponseSocket
    );
    return socket;
  }
}
