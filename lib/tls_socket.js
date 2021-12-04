import { TLSSocket } from "tls";
import Socket from "./socket.js";

export default TlsSocket;

function TlsSocket() {
  Socket.apply(this, arguments);
}

TlsSocket.prototype = Object.create(TLSSocket.prototype, {
  constructor: { value: TlsSocket, configurable: true, writeable: true },
});

Object.keys(Socket.prototype).forEach(function (key) {
  TlsSocket.prototype[key] = Socket.prototype[key];
});

TlsSocket.prototype.encrypted = true;
TlsSocket.prototype.authorized = true;
