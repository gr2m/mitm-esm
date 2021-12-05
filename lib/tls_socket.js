import { TLSSocket } from "tls";
import Socket from "./socket.js";

export default class TlsSocket extends Socket {
  constructor(...args) {
    super(...args);
    Object.assign(this, TLSSocket.prototype);
  }

  encrypted = true;
  authorized = true;
}
