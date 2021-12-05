// @ts-check

import net from "net";
import tls from "tls";
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

  /**
   * @returns {Mitm}
   */
  enable() {
    // Connect is called synchronously.
    const netConnect = this.onNetConnect.bind(this, net.connect);
    const tlsConnect = this.onTlsConnect.bind(this, tls.connect);

    this.stubs.stub(net, "connect", netConnect);
    this.stubs.stub(net, "createConnection", netConnect);
    this.stubs.stub(Agent.prototype, "createConnection", netConnect);
    this.stubs.stub(tls, "connect", tlsConnect);

    // ClientRequest.prototype.onSocket is called synchronously from ClientRequest's constructor
    // and is a convenient place to hook into new ClientRequest instances.
    const originalOnSocket = ClientRequest.prototype.onSocket;
    const self = this;
    this.stubs.stub(ClientRequest.prototype, "onSocket", function (socket) {
      originalOnSocket.call(this, socket);
      self.clientRequestOnSocket(socket);
    });

    return this;
  }

  /**
   * @returns {Mitm}
   */
  disable() {
    this.stubs.restore();
    return this;
  }

  /**
   * @param {typeof net.connect} originalNetConnect
   * @param  {...any} args
   * @returns {Socket}
   */
  onNetConnect(originalNetConnect, ...args) {
    const [options, callback] = NODE_INTERNALS.normalizeConnectArgs(args);

    const request = this.connect(originalNetConnect, Socket, options, callback);
    if (request.mitmResponseSocket == null) return request;
    if (callback) request.once("connect", callback);

    return request;
  }

  /**
   * @param {typeof tls.connect} originalTlsConnect
   * @param  {...any} args
   * @returns {TlsSocket}
   */
  onTlsConnect(originalTlsConnect, ...args) {
    const [options, callback] = NODE_INTERNALS.normalizeConnectArgs(args);

    const request = this.connect(
      originalTlsConnect,
      TlsSocket,
      options,
      callback
    );
    if (request.mitmResponseSocket == null) return request;
    if (callback) request.once("secureConnect", callback);

    setTimeout(request.emit.bind(request, "secureConnect"));

    return request;
  }

  clientRequestOnSocket(socket) {
    if (!socket.mitmResponseSocket) return socket;

    NODE_INTERNALS.createRequestAndResponse.call(
      this,
      socket.mitmResponseSocket
    );
    return socket;
  }

  connect(originalConnect, Socket, options, callback) {
    const [requestSocket, responseSocket] = createInternalSocketPair();

    // Don't set request.connecting to false because there's nothing setting it
    // back to false later. Originally that was done in Socket.prototype.connect
    // and its afterConnect handler, but we're not calling that.
    const request = new Socket({
      handle: requestSocket,
      ...options,
    });

    this.emit("connect", request, options);
    if (request.bypassed) return originalConnect.call(this, options, callback);

    const response = new Socket({
      handle: responseSocket,
      readable: true,
      writable: true,
    });

    // We use `.mitmResponseSocket` as a means to check if a request is intercepted
    // for net connects and to pass use it as a response when intercepting http(s) requests.
    request.mitmResponseSocket = response;

    this.emit("connection", response, options);

    // Ensure connect is emitted asynchronously, otherwise it would be impossible
    // to listen to it after calling net.connect or listening to it after the
    // ClientRequest emits "socket".
    setTimeout(() => {
      request.emit("connect");
      response.emit("connect");
    });

    return request;
  }
}
