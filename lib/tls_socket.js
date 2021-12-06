// @ts-check

import tls from "tls";
import Socket from "./net_socket.js";

/**
 * TlsSocket is extending `tls.TLSSocket` because the
 * logic is a lot different to `net.Socket`. So we inherit
 * from `net.Socket` instead and then only apply the instances
 * methods from `tls.TLSSocket`.
 */
export default class MitmTlsSocket extends Socket {
  encrypted = true;
  authorized = true;

  constructor(...args) {
    super(...args);
    Object.assign(this, tls.TLSSocket.prototype);
  }
}
