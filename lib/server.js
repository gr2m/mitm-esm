import { EventEmitter } from "node:events";

import NODE_INTERNALS from "./node-internals.js";

export default class MitmServer extends EventEmitter {
  constructor(mitm) {
    super();

    this[NODE_INTERNALS.serverResponseKey] = NODE_INTERNALS.ServerResponse;
    this[NODE_INTERNALS.incomingMessageKey] = NODE_INTERNALS.IncomingMessage;

    this.on("request", (request, response) => {
      // add cross-reference
      // compare https://github.com/nodejs/node/blob/b323cec78f713bc113be7f6030d787804a9af5a0/lib/_http_client.js#L612
      request.res = response;
      response.req = request;

      // re-emit the event on mitm
      mitm.emit("request", request, response);
    });
  }
}
