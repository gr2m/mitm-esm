// @ts-check

import net from "node:net";

export default class MitmNetSocket extends net.Socket {
  /** @type {boolean} */
  bypassed = false;

  /** @type {MitmNetSocket} */
  mitmResponseSocket;

  bypass() {
    this.bypassed = true;
  }
}
