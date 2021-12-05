import stream from "stream";

import { NODE_INTERNALS } from "./node_internals.js";

const NO_ERROR = 0;
const UV_EOF = NODE_INTERNALS.UV_EOF;

let uniqueId = 0;
let STREAM_STATE = NODE_INTERNALS.STREAM_STATE;
let STREAM_BYTES_READ = NODE_INTERNALS.STREAM_BYTES_READ;

/**
 * Sockets write to InternalSocket via write*String functions. The
 * WritableStream.prototype.write function is just used internally by
 * InternalSocket to queue data before pushing it to the other end via
 * ReadableStream.prototype.push. The receiver will then forward it to its
 * owner Socket via the onread property.
 *
 * InternalSocket is created for both the client side and the server side.
 */
class InternalSocket extends stream.Duplex {
  constructor() {
    super();
    this.id = ++uniqueId;

    // The "end" event follows ReadableStream.prototype.push(null).
    this.on("data", readData.bind(this));
    this.on("end", readEof.bind(this));

    // The "finish" event follows  WritableStream.prototype.end.
    //
    // There's WritableStream.prototype._final for processing before "finish" is
    // emitted, but that's only available in Node v8 and later.
    this.on(
      "finish",
      this._write.bind(this, null, null, () => {})
    );

    this.pause();
  }

  // Node v0.11's ReadableStream.prototype.resume and
  // ReadableStream.prototype.pause return self. InternalSocket's API states that
  // they should return error codes instead.
  //
  // Node v0.11.13 called ReadableStream.prototype.read(0) synchronously, but
  // v0.11.14 does it in the next tick. For easier sync use, call it here.
  readStart() {
    this.resume();
  }
  readStop() {
    this.pause();
  }

  _read() {}
  ref() {}
  unref() {}

  // Node v8 added "getAsyncId".
  getAsyncId() {
    return this.id;
  }

  _write(data, encoding, done) {
    const remote = this.remote;
    process.nextTick(function () {
      remote.push(data, encoding);
      done();
    });
  }

  // Node v10 requires writev to be set on the handler because, while
  // WritableStream expects _writev, internal/stream_base_commons.js calls
  // req.handle.writev directly. It's given a flat array of data+type pairs.
  writev(_req, data) {
    for (let i = 0; i < data.length; ++i)
      this._write(data[i], data[++i], () => {});
    return NO_ERROR;
  }

  // InternalSocket.prototype.writeLatin1String was introduced in Node v6.4.
  writeLatin1String(_req, data) {
    this.write(data, "latin1");
    return NO_ERROR;
  }

  writeBuffer(req, data) {
    /* eslint consistent-return: 0 */
    this.write(data);
    return NO_ERROR;
  }

  writeUtf8String(req, data) {
    /* eslint consistent-return: 0 */
    this.write(data, "utf8");
    return NO_ERROR;
  }

  writeAsciiString(req, data) {
    /* eslint consistent-return: 0 */
    this.write(data, "ascii");
    return NO_ERROR;
  }

  writeUcs2String(req, data) {
    /* eslint consistent-return: 0 */
    this.write(data, "ucs2");
    return NO_ERROR;
  }

  // While it seems to have existed since Node v0.10, Node v11.2 requires
  // "shutdown". AFAICT, "shutdown" is for shutting the writable side down and
  // hence the use of WritableStream.prototype.end and waiting for the "finish"
  // event.
  shutdown(req) {
    this.once("finish", req.oncomplete.bind(req, NO_ERROR, req.handle));
    this.end();

    // Note v11.8 requires "shutdown" to return an error value, with "1"
    // indicating a "synchronous finish" (as per Node's net.js) and "0"
    // presumably success.
    return 0;
  }

  // I'm unsure of the relationship between InternalSocket.prototype.shutdown and
  // InternalSocket.prototype.close.
  close(done) {
    if (!this._writableState.finished) {
      this.end(done);
      return;
    }

    /* istanbul ignore next */
    if (done) done();
  }
}

export function createInternalSocketPair() {
  const a = new InternalSocket();
  const b = new InternalSocket();
  a.remote = b;
  b.remote = a;
  return [a, b];
}

function readData(data) {
  // A system written not in 1960 that passes arguments to functions through
  // _global_ mutable data structures…
  STREAM_STATE[STREAM_BYTES_READ] = data.length;
  this.onread(data);
}

function readEof() {
  STREAM_STATE[STREAM_BYTES_READ] = UV_EOF;
  this.onread();
}
