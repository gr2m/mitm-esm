// @ts-check

import net from "net";

export default class MitmNetSocket extends net.Socket {
  /** @type {boolean} */
  bypassed = false;

  /** @type {MitmNetSocket} */
  mitmResponseSocket;

  bypass() {
    this.bypassed = true;
  }
}
