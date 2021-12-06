/**
 * Based on code by @alejo90
 * @see https://github.com/DefinitelyTyped/DefinitelyTyped/blob/1d58999ab82c14bed518d0aec2ab2a5343e9f83b/types/mitm/index.d.ts
 * @license MIT
 */

import * as http from "http";
import * as net from "net";

interface SocketOptions {
  port: number;
  host?: string | undefined;
  localAddress?: string | undefined;
  localPort?: string | undefined;
  family?: number | undefined;
  allowHalfOpen?: boolean | undefined;
}

interface BypassableSocket extends net.Socket {
  bypass(): void;
}

type SocketConnectCallback = (
  socket: BypassableSocket,
  opts: SocketOptions
) => void;

type SocketConnectionCallback = (
  socket: net.Socket,
  opts: SocketOptions
) => void;

type HttpCallback = (
  request: http.IncomingMessage,
  response: http.ServerResponse
) => void;

type Event = "connect" | "connection" | "request";

type Callback = SocketConnectCallback | SocketConnectionCallback | HttpCallback;

export default interface Mitm {
  disable(): void;
  on(event: Event, callback: Callback): void;
  on(event: "connect", callback: SocketConnectCallback): void;
  on(event: "connection", callback: SocketConnectionCallback): void;
  on(event: "request", callback: HttpCallback): void;
}
