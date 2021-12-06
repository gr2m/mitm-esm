import * as net from "net";
import * as http from "http";

import { expectType } from "tsd";

import Mitm from "./index.js";

export function test(mitm: Mitm) {
  mitm.disable();

  mitm.on("connect", (bypassableSocket, opts): void => {
    expectType<() => void>(bypassableSocket.bypass);

    expectType<number>(opts.port);
    expectType<string | undefined>(opts.host);
  });

  mitm.on("connection", (socket, opts): void => {
    expectType<net.Socket>(socket);

    expectType<number>(opts.port);
    expectType<string | undefined>(opts.host);
  });

  mitm.on("request", (request, response): void => {
    expectType<http.IncomingMessage>(request);
    expectType<http.ServerResponse>(response);
  });
}
