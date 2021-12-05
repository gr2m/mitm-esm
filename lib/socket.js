// @ts-check

import net from "net";

export default class Socket extends net.Socket {
  bypass() {
    this.bypassed = true;
  }
}
