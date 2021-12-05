import { _connectionListener as createRequestAndResponse } from "http";
import { _normalizeArgs as normalizeConnectArgs } from "net";
import { IncomingMessage } from "_http_incoming";
import { ServerResponse } from "_http_server";
import { kIncomingMessage as incomingMessageKey } from "_http_common";
import { kServerResponse as serverResponseKey } from "_http_server";

const UV_EOF = process.binding("uv").UV_EOF;
const STREAM_STATE = process.binding("stream_wrap").streamBaseState;
const STREAM_BYTES_READ = process.binding("stream_wrap").kReadBytesOrError;

export const NODE_INTERNALS = {
  createRequestAndResponse,
  normalizeConnectArgs,
  IncomingMessage,
  ServerResponse,
  incomingMessageKey,
  serverResponseKey,
  UV_EOF,
  STREAM_STATE,
  STREAM_BYTES_READ,
};
