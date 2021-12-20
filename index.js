// @ts-check

import net from "node:net";
import tls from "node:tls";
import { ClientRequest, Agent } from "node:http";
import { EventEmitter } from "node:events";

import NODE_INTERNALS from "./lib/node_internals.js";

import MitmNetSocket from "./lib/net_socket.js";
import MitmTlsSocket from "./lib/tls_socket.js";
import MitmServer from "./lib/server.js";
import createRequestResponseHandlePair from "./lib/stream_handles.js";
import Stubs from "./lib/stubs.js";

export default class Mitm extends EventEmitter {
  constructor() {
    super();

    this.stubs = new Stubs();
    this.server = new MitmServer(this);

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
   * Create the fake `request` object and give the opportunity
   * to bypass the interception.
   *
   * @param {typeof net.connect} originalNetConnect
   * @param  {...any} args
   * @returns {MitmNetSocket}
   */
  onNetConnect(originalNetConnect, ...args) {
    const [options, callback] = NODE_INTERNALS.normalizeConnectArgs(args);

    const request = this.connect(
      originalNetConnect,
      MitmNetSocket,
      options,
      callback
    );

    if (request.mitmResponseSocket == null) return request;
    if (callback) request.once("connect", callback);

    return request;
  }

  /**
   * Create the fake `request` object and give the opportunity
   * to bypass the interception.
   *
   * If the request is intercepted, we simulate a successful
   * TLS handshake by emiting a "secureConnect" event asyncronously.
   *
   * @param {typeof tls.connect} originalTlsConnect
   * @param  {...any} args
   * @returns {MitmTlsSocket}
   */
  onTlsConnect(originalTlsConnect, ...args) {
    const [options, callback] = NODE_INTERNALS.normalizeConnectArgs(args);

    const request = this.connect(
      originalTlsConnect,
      MitmTlsSocket,
      options,
      callback
    );

    if (request.mitmResponseSocket == null) return request;
    if (callback) request.once("secureConnect", callback);

    setTimeout(request.emit.bind(request, "secureConnect"));

    return request;
  }

  /**
   * This is our hook into the `http.ClientRequest` constructor.
   * Unless the interception is bypassed, we setup the socket handlers
   * for the response using Node's internal connectionListener method.
   *
   * @see see https://github.com/nodejs/node/blob/b323cec78f713bc113be7f6030d787804a9af5a0/lib/_http_server.js#L440-L545
   * @param {MitmNetSocket} requestSocket
   * @returns
   */
  clientRequestOnSocket(requestSocket) {
    if (!requestSocket.mitmResponseSocket) return requestSocket;

    NODE_INTERNALS.httpConnectionListener.call(
      this.server,
      requestSocket.mitmResponseSocket
    );

    return requestSocket;
  }

  /**
   * This method is called when a socket is established, either through `net`,
   * `tls`, or an `http.Agent` prototype. We create a fake `request` object
   * and give the opportunity to bypass the interception in a `connect` hanler.
   *
   * If the request is intercepted, we call the original connect method
   */
  connect(originalConnect, Socket, options, callback) {
    const { requestHandle, responseHandle } = createRequestResponseHandlePair();

    // request
    const request = new Socket({
      handle: requestHandle,
      ...options,
    });

    // give opportunity to bypass the intercept
    this.emit("connect", request, options);
    if (request.bypassed) return originalConnect.call(this, options, callback);

    // response
    const response = new Socket({ handle: responseHandle });

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
