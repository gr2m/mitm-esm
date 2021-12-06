import { _connectionListener as httpConnectionListener } from "node:http";
import { _normalizeArgs as normalizeConnectArgs } from "node:net";
import { IncomingMessage } from "node:_http_incoming";
import { ServerResponse } from "node:_http_server";
import { kIncomingMessage as incomingMessageKey } from "node:_http_common";
import { kServerResponse as serverResponseKey } from "node:_http_server";

const UV_EOF = process.binding("uv").UV_EOF;
const STREAM_STATE = process.binding("stream_wrap").streamBaseState;
const STREAM_BYTES_READ = process.binding("stream_wrap").kReadBytesOrError;

export default {
  httpConnectionListener,
  normalizeConnectArgs,
  IncomingMessage,
  ServerResponse,
  incomingMessageKey,
  serverResponseKey,
  UV_EOF,
  STREAM_STATE,
  STREAM_BYTES_READ,
};
