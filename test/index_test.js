import net from "net";
import tls from "tls";
import http from "http";
import https from "https";
import stream from "stream";
import { EventEmitter } from "events";

import sinon from "sinon";
import { test } from "uvu";
import * as assert from "uvu/assert";

import Mitm from "../index.js";

let mitm;

test.before.each(() => {
  mitm = new Mitm();
});
test.after.each(() => {
  mitm.disable();
  sinon.restore();
});

test("must return an instance of Mitm when called as a function", () => {
  assert.instance(mitm, Mitm);
});

function mustConnect(moduleName, module) {
  test(`${moduleName}: must return an instance of net.Socket`, () => {
    const socket = module.connect({ host: "foo", port: 80 });
    assert.instance(socket, net.Socket);
  });

  test(`${moduleName}: must return an instance of net.Socket given port`, () => {
    assert.instance(module.connect(80), net.Socket);
  });

  test(`${moduleName}: must return an instance of net.Socket given port and host`, () => {
    assert.instance(module.connect(80, "10.0.0.1"), net.Socket);
  });

  test(`${moduleName}: must emit connect on Mitm`, () => {
    const onConnect = sinon.spy();
    mitm.on("connect", onConnect);
    const opts = { host: "foo" };
    const socket = module.connect(opts);

    assert.equal(onConnect.callCount, 1);
    assert.equal(onConnect.firstCall.args[0], socket);
    assert.equal(onConnect.firstCall.args[1], opts);
  });

  test(`${moduleName}: must emit connect on Mitm with options object given host and port`, () => {
    const onConnect = sinon.spy();
    mitm.on("connect", onConnect);
    const socket = module.connect(9, "127.0.0.1");

    assert.equal(onConnect.callCount, 1);
    assert.equal(onConnect.firstCall.args[0], socket);
    assert.equal(onConnect.firstCall.args[1], { host: "127.0.0.1", port: 9 });
  });

  test(`${moduleName}: must emit connection on Mitm`, () => {
    const onConnection = sinon.spy();
    mitm.on("connection", onConnection);
    const opts = { host: "foo" };
    const socket = module.connect(opts);

    assert.equal(onConnection.callCount, 1);
    assert.instance(onConnection.firstCall.args[0], net.Socket);
    assert.not.equal(onConnection.firstCall.args[0], socket);
    assert.equal(onConnection.firstCall.args[1], opts);
  });

  test(`${moduleName}: must emit connect on socket in next ticks`, () => {
    return new Promise((resolve) => {
      const socket = module.connect({ host: "foo" });
      socket.on("connect", resolve);
    });
  });

  test(`${moduleName}: must call back on connect given callback`, () => {
    return new Promise((resolve) => {
      module.connect({ host: "foo" }, resolve);
    });
  });

  test(`${moduleName}: must call back on connect given port and callback`, () => {
    return new Promise((resolve) => {
      module.connect(80, resolve);
    });
  });

  // This was a bug found on Apr 26, 2014 where the host argument was taken
  // to be the callback because arguments weren't normalized to an options
  // object.
  test(`${moduleName}: must call back on connect given port, host and callback`, () => {
    return new Promise((resolve) => {
      module.connect(80, "localhost", resolve);
    });
  });

  // The "close" event broke on Node v12.16.3 as the
  // InternalSocket.prototype.close method didn't call back if
  // the WritableStream had already been closed.
  test(`${moduleName}: must emit close on socket if ended immediately`, () => {
    return new Promise((resolve) => {
      mitm.on("connection", function (socket) {
        socket.end();
      });
      const socket = module.connect({ host: "foo" });
      socket.on("close", resolve);
    });
  });

  test(`${moduleName}: must emit close on socket if ended in next tick`, () => {
    return new Promise((resolve) => {
      mitm.on("connection", function (socket) {
        process.nextTick(socket.end.bind(socket));
      });

      const socket = module.connect({ host: "foo" });
      socket.on("close", resolve);
    });
  });

  test(`${moduleName}: must intercept 127.0.0.1`, () => {
    return new Promise((resolve) => {
      let server;
      mitm.on("connection", function (s) {
        server = s;
      });
      const client = module.connect({ host: "127.0.0.1" });
      server.write("Hello");

      client.setEncoding("utf8");
      client.on("data", function (data) {
        assert.equal(data, "Hello");
      });
      client.on("data", resolve);
    });
  });

  test(`${moduleName}: when bypassed must not intercept`, () => {
    return new Promise((resolve) => {
      mitm.on("connect", function (client) {
        client.bypass();
      });

      module
        .connect({ host: "127.0.0.1", port: 9 })
        .on("error", function (err) {
          assert.instance(err, Error);
          assert.match(err.message, /ECONNREFUSED/);
          resolve();
        });
    });
  });

  test(`${moduleName}: when bypassed must call original module.connect`, () => {
    mitm.disable();

    const connect = sinon.spy(module, "connect");
    const testMitm = new Mitm();
    testMitm.on("connect", function (client) {
      client.bypass();
    });

    try {
      module.connect({ host: "127.0.0.1", port: 9 }).on("error", noop);
      assert.equal(connect.callCount, 1);
      assert.equal(connect.firstCall.args[0], { host: "127.0.0.1", port: 9 });
    } finally {
      // Working around Mocha's context bug(s) and poor design decision
      // with a manual `finally`.
      testMitm.disable();
    }
  });

  test(`${moduleName}: when bypassed must not call back twice on connect given callback`, () => {
    return new Promise((resolve) => {
      mitm.on("connect", function (client) {
        client.bypass();
      });

      const onConnect = sinon.spy();
      const client = module.connect({ host: "127.0.0.1", port: 9 }, onConnect);

      client.on(
        "error",
        process.nextTick.bind(null, () => {
          assert.equal(onConnect.callCount, 0);
          resolve();
        })
      );
    });
  });

  test(`${moduleName}: when bypassed must not emit connection`, () => {
    mitm.on("connect", function (client) {
      client.bypass();
    });
    const onConnection = sinon.spy();
    mitm.on("connection", onConnection);
    module.connect({ host: "127.0.0.1", port: 9 }).on("error", noop);
    assert.equal(onConnection.callCount, 0);
  });
}

mustConnect("net.connect", net);

test("net.connect must not return an instance of tls.TLSSocket", () => {
  const client = net.connect({ host: "foo", port: 80 });
  // we don't use `instanceof(tls.TLSSocket)` here because our TlsSocket
  // implementation doesn't extend tls.TLSSocket.
  assert.not.ok("getCertificate" in client);
});

test("net.connect must not set the encrypted property", () => {
  assert.not.ok("encrypted" in net.connect({ host: "foo" }));
});

test("net.connect must not set the authorized property", () => {
  assert.not.ok("authorized" in net.connect({ host: "foo" }));
});

test("net.connect must not emit secureConnect on client", () => {
  return new Promise((resolve) => {
    const client = net.connect({ host: "foo" });
    client.on("secureConnect", resolve);
    resolve();
  });
});

test("net.connect must not emit secureConnect on server", () => {
  return new Promise((resolve) => {
    let server;
    mitm.on("connection", function (s) {
      server = s;
    });
    net.connect({ host: "foo" });
    server.on("secureConnect", resolve);
    resolve();
  });
});

test("Socket.prototype.write must write to client from server", () => {
  return new Promise((resolve) => {
    let server;
    mitm.on("connection", function (s) {
      server = s;
    });
    const client = net.connect({ host: "foo" });
    server.write("Hello ☺️");

    client.setEncoding("utf8");
    client.on("data", function (data) {
      assert.equal(data, "Hello ☺️");
    });
    client.on("data", resolve);
  });
});

test("Socket.prototype.write must write to client from server in the next tick", () => {
  return new Promise((resolve) => {
    let server;
    mitm.on("connection", function (s) {
      server = s;
    });
    const client = net.connect({ host: "foo" });

    let ticked = false;
    client.once("data", () => {
      assert.equal(ticked, true);
      resolve();
    });
    server.write("Hello");
    ticked = true;
  });
});

test("Socket.prototype.write must write to server from client", () => {
  return new Promise((resolve) => {
    let server;
    mitm.on("connection", function (s) {
      server = s;
    });
    const client = net.connect({ host: "foo" });
    client.write("Hello ☺️");

    server.setEncoding("utf8");
    process.nextTick(() => {
      assert.equal(server.read(), "Hello ☺️");
    });
    process.nextTick(resolve);
  });
});

test("Socket.prototype.write must write to server from client in the next tick", () => {
  return new Promise((resolve) => {
    let server;
    mitm.on("connection", function (s) {
      server = s;
    });
    const client = net.connect({ host: "foo" });

    let ticked = false;
    server.once("data", () => {
      assert.equal(ticked, true);
      resolve();
    });
    client.write("Hello");
    ticked = true;
  });
});

// Writing binary strings was introduced in Node v0.11.14.
// The test still passes for Node v0.10 and newer v0.11s, so let it be.
test("Socket.prototype.write must write to server from client given binary", () => {
  return new Promise((resolve) => {
    let server;
    mitm.on("connection", function (s) {
      server = s;
    });
    const client = net.connect({ host: "foo" });
    client.write("Hello", "utf-8");

    server.setEncoding("binary");
    process.nextTick(() => {
      assert.equal(server.read(), "Hello");
    });
    process.nextTick(resolve);
  });
});

test("Socket.prototype.write must write to server from client given latin1", () => {
  return new Promise((resolve) => {
    let server;
    mitm.on("connection", function (s) {
      server = s;
    });
    const client = net.connect({ host: "foo" });
    client.write("Hello", "latin1");

    server.setEncoding("latin1");
    process.nextTick(() => {
      assert.equal(server.read(), "Hello");
    });
    process.nextTick(resolve);
  });
});

test("Socket.prototype.write must write to server from client given a buffer", () => {
  return new Promise((resolve) => {
    let server;
    mitm.on("connection", function (s) {
      server = s;
    });
    const client = net.connect({ host: "foo" });
    client.write(Buffer.from("Hello", "utf-8"));

    process.nextTick(() => {
      assert.equal(server.read(), Buffer.from("Hello", "utf-8"));
      resolve();
    });
  });
});

test("Socket.prototype.write must write to server from client given a UTF-8 string", () => {
  return new Promise((resolve) => {
    let server;
    mitm.on("connection", function (s) {
      server = s;
    });
    const client = net.connect({ host: "foo" });
    client.write("Hello", "utf8");

    process.nextTick(() => {
      assert.equal(server.read(), Buffer.from("Hello", "utf-8"));
      resolve();
    });
  });
});

test("Socket.prototype.write must write to server from client given a ASCII string", () => {
  return new Promise((resolve) => {
    let server;
    mitm.on("connection", function (s) {
      server = s;
    });
    const client = net.connect({ host: "foo" });
    client.write("Hello", "ascii");

    process.nextTick(() => {
      assert.equal(server.read(), Buffer.from("Hello", "utf-8"));
      resolve();
    });
  });
});

test("Socket.prototype.write must write to server from client given a UCS-2 string", () => {
  return new Promise((resolve) => {
    let server;
    mitm.on("connection", function (s) {
      server = s;
    });
    const client = net.connect({ host: "foo" });
    client.write("Hello", "ucs2");

    process.nextTick(() => {
      assert.equal(
        server.read(),
        Buffer.from("H\u0000e\u0000l\u0000l\u0000o\u0000", "utf-8")
      );

      resolve();
    });
  });
});

test("Socket.prototype.end() must emit end when closed on server", () => {
  return new Promise((resolve) => {
    let server;
    mitm.on("connection", function (s) {
      server = s;
    });
    const client = net.connect({ host: "foo" });
    server.end();
    client.on("end", resolve);
  });
});

test("Socket.prototype.ref must allow calling on client", () => {
  net.connect({ host: "foo" }).ref();
});

test("Socket.prototype.ref must allow calling on server", () => {
  let server;
  mitm.on("connection", function (s) {
    server = s;
  });
  net.connect({ host: "foo" });
  server.ref();
});

test("Socket.prototype.unref must allow calling on client", () => {
  net.connect({ host: "foo" }).unref();
});

test("Socket.prototype.unref must allow calling on server", () => {
  let server;
  mitm.on("connection", function (s) {
    server = s;
  });
  net.connect({ host: "foo" });
  server.unref();
});

// To confirm https://github.com/moll/node-mitm/issues/47 won't become
// an issue.
test("Socket.prototype.pipe must allow piping to itself", () => {
  return new Promise((resolve) => {
    mitm.on("connection", function (server) {
      server.pipe(new Upcase()).pipe(server);
    });

    const client = net.connect({ host: "foo" });
    client.write("Hello");

    client.setEncoding("utf8");
    client.on("data", function (data) {
      assert.equal(data, "HELLO");
    });
    client.on("data", resolve);
  });
});

// Bug report from Io.js v3 days:
// https://github.com/moll/node-mitm/issues/26
test("Socket.prototype.destroy must emit end when destroyed on server", () => {
  return new Promise((resolve) => {
    let server;
    mitm.on("connection", function (s) {
      server = s;
    });
    const client = net.connect({ host: "foo" });
    server.destroy();
    client.on("end", resolve);
  });
});

test("net.createConnection must be equal to net.connect", () => {
  assert.equal(net.createConnection, net.connect);
});

mustConnect("tls.connect", tls);

test("tls.connect must return an instance of tls.TLSSocket", () => {
  // we don't use `instanceof(tls.TLSSocket)` here because our TlsSocket
  // implementation doesn't extend tls.TLSSocket.
  assert.ok("getCertificate" in tls.connect({ host: "foo", port: 80 }));
});

test("tls.connect must return an instance of tls.TLSSocket given port", () => {
  // we don't use `instanceof(tls.TLSSocket)` here because our TlsSocket
  // implementation doesn't extend tls.TLSSocket.
  assert.ok("getCertificate" in tls.connect(80));
});

test("tls.connect must return an instance of tls.TLSSocket given port and host", () => {
  // we don't use `instanceof(tls.TLSSocket)` here because our TlsSocket
  // implementation doesn't extend tls.TLSSocket.
  assert.ok("getCertificate" in tls.connect(80, "10.0.0.1"));
});

test("tls.connect must emit secureConnect in next ticks", () => {
  return new Promise((resolve) => {
    const socket = tls.connect({ host: "foo" });
    socket.on("secureConnect", resolve);
  });
});

test("tls.connect must emit secureConnect after connect in next ticks", () => {
  return new Promise((resolve) => {
    const socket = tls.connect({ host: "foo" });

    socket.on("connect", () => {
      socket.on("secureConnect", resolve);
    });
  });
});

test("tls.connect must not emit secureConnect on server", () => {
  return new Promise((resolve) => {
    let server;
    mitm.on("connection", function (s) {
      server = s;
    });
    tls.connect({ host: "foo" });
    server.on("secureConnect", resolve);
    resolve();
  });
});

test("tls.connect must call back on secureConnect", () => {
  return new Promise((resolve) => {
    let connected = false;

    const client = tls.connect({ host: "foo" }, () => {
      assert.equal(connected, true);
      resolve();
    });

    client.on("connect", () => {
      connected = true;
    });
  });
});

test("tls.connect must set encrypted true", () => {
  assert.equal(tls.connect({ host: "foo" }).encrypted, true);
});

test("tls.connect must set authorized true", () => {
  assert.equal(tls.connect({ host: "foo" }).authorized, true);
});

function mustRequest(context, request) {
  test(`${context}: must return http.ClientRequest`, () => {
    assert.instance(request({ host: "foo" }), http.ClientRequest);
  });

  test(`${context}: must emit connect on Mitm`, () => {
    const onConnect = sinon.spy();
    mitm.on("connect", onConnect);
    request({ host: "foo" });
    assert.equal(onConnect.callCount, 1);
  });

  test(`${context}: must emit connect on Mitm after multiple connections`, () => {
    const onConnect = sinon.spy();
    mitm.on("connect", onConnect);
    request({ host: "foo" });
    request({ host: "foo" });
    request({ host: "foo" });
    assert.equal(onConnect.callCount, 3);
  });

  test(`${context}: must emit connection on Mitm`, () => {
    const onConnection = sinon.spy();
    mitm.on("connection", onConnection);
    request({ host: "foo" });
    assert.equal(onConnection.callCount, 1);
  });

  test(`${context}: must emit connection on Mitm after multiple connections`, () => {
    const onConnection = sinon.spy();
    mitm.on("connection", onConnection);
    request({ host: "foo" });
    request({ host: "foo" });
    request({ host: "foo" });
    assert.equal(onConnection.callCount, 3);
  });

  test(`${context}: must emit request on Mitm`, () => {
    return new Promise((resolve) => {
      const client = request({ host: "foo" });
      client.end();

      mitm.on("request", function (req, res) {
        assert.instance(req, http.IncomingMessage);
        assert.not.equal(req, client);
        assert.instance(res, http.ServerResponse);
        resolve();
      });
    });
  });

  test(`${context}: must emit request on Mitm after multiple requests`, () => {
    return new Promise((resolve) => {
      let counter = 0;
      request({ host: "foo" }).end();
      request({ host: "foo" }).end();
      request({ host: "foo" }).end();
      mitm.on("request", () => {
        counter++;
        if (counter === 3) {
          resolve();
        }
      });
    });
  });

  test(`${context}: must emit socket on request in next ticks`, () => {
    return new Promise((resolve) => {
      const client = request({ host: "foo" });
      client.on("socket", resolve);
    });
  });

  // https://github.com/moll/node-mitm/pull/25
  test(`${context}: must emit connect after socket event`, () => {
    return new Promise((resolve) => {
      const client = request({ host: "foo" });

      client.on("socket", function (socket) {
        socket.on("connect", resolve);
      });
    });
  });

  test(`${context} when bypassed must not intercept`, () => {
    return new Promise((resolve) => {
      mitm.on("connect", function (client) {
        client.bypass();
      });
      request({ host: "127.0.0.1" }).on("error", function (err) {
        assert.instance(err, Error);
        assert.match(err.message, /ECONNREFUSED/);
        resolve();
      });
    });
  });

  test(`${context} when bypassed must not emit request`, () => {
    return new Promise((resolve) => {
      mitm.on("connect", function (client) {
        client.bypass();
      });
      const onRequest = sinon.spy();
      mitm.on("request", onRequest);
      request({ host: "127.0.0.1" }).on("error", function (_err) {
        assert.equal(onRequest.callCount, 0);
        resolve();
      });
    });
  });
}

mustRequest("Http.request", http.request);
mustRequest("Https.request", https.request);

// https://github.com/moll/node-mitm/pull/25
test("Https.request must emit secureConnect after socket event", () => {
  return new Promise((resolve) => {
    const client = https.request({ host: "foo" });

    client.on("socket", function (socket) {
      socket.on("secureConnect", resolve);
    });
  });
});

mustRequest("Using Http.Agent", function (opts) {
  return http.request({ agent: new http.Agent(), ...opts });
});

test("Using Http.Agent must support keep-alive", () => {
  return new Promise((resolve) => {
    const client = http.request({
      host: "foo",
      agent: new http.Agent({ keepAlive: true }),
    });

    client.end();

    mitm.on("request", function (_req, res) {
      res.setHeader("Connection", "keep-alive");
      res.end();
    });

    // Just waiting for response is too early to trigger:
    // TypeError: socket._handle.getAsyncId is not a function in _http_client.
    client.on("response", function (res) {
      res.on("data", noop);
      res.on("end", resolve);
    });
  });
});

mustRequest("Using Https.Agent", function (opts) {
  return https.request({ agent: new https.Agent(), ...opts });
});

test("http.IncomingMessage must have URL", () => {
  return new Promise((resolve) => {
    http.request({ host: "foo", path: "/foo" }).end();

    mitm.on("request", function (req) {
      assert.equal(req.url, "/foo");
      resolve();
    });
  });
});

test("http.IncomingMessage must have headers", () => {
  return new Promise((resolve) => {
    const req = http.request({ host: "foo" });
    req.setHeader("Content-Type", "application/json");
    req.end();

    mitm.on("request", function (req) {
      assert.equal(req.headers["content-type"], "application/json");
      resolve();
    });
  });
});

test("http.IncomingMessage must have body", () => {
  return new Promise((resolve) => {
    const client = http.request({ host: "foo", method: "POST" });
    client.write("Hello");

    mitm.on("request", function (req, _res) {
      req.setEncoding("utf8");
      req.on("data", function (data) {
        assert.equal(data, "Hello");
        resolve();
      });
    });
  });
});

test("http.IncomingMessage must have a reference to the http.ServerResponse", () => {
  return new Promise((resolve) => {
    http.request({ host: "foo", method: "POST" }).end();
    mitm.on("request", function (req, res) {
      assert.equal(req.res, res);
    });
    mitm.on("request", resolve);
  });
});

test("http.ServerResponse must respond with status, headers and body", () => {
  return new Promise((resolve) => {
    mitm.on("request", function (_req, res) {
      res.statusCode = 442;
      res.setHeader("Content-Type", "application/json");
      res.end("Hi!");
    });

    http
      .request({ host: "foo" })
      .on("response", function (res) {
        assert.equal(res.statusCode, 442);
        assert.equal(res.headers["content-type"], "application/json");
        res.setEncoding("utf8");
        res.once("data", function (data) {
          assert.equal(data, "Hi!");
          resolve();
        });
      })
      .end();
  });
});

test("http.ServerResponse must have a reference to the http.IncomingMessage", () => {
  return new Promise((resolve) => {
    http.request({ host: "foo", method: "POST" }).end();
    mitm.on("request", function (req, res) {
      assert.equal(res.req, req);
    });
    mitm.on("request", resolve);
  });
});

test("http.ServerResponse.prototype.write must make clientRequest emit response", () => {
  return new Promise((resolve) => {
    const req = http.request({ host: "foo" });
    req.end();
    mitm.on("request", function (_req, res) {
      res.write("Test");
    });
    req.on("response", resolve);
  });
});

// Under Node v0.10 it's the writeQueueSize that's checked to see if
// the callback can be called.
test("http.ServerResponse.prototype.write must call given callback", () => {
  return new Promise((resolve) => {
    http.request({ host: "foo" }).end();
    mitm.on("request", function (_req, res) {
      res.write("Test", resolve);
    });
  });
});

test("http.ServerResponse.prototype.end must make http.ClientRequest emit response", () => {
  return new Promise((resolve) => {
    const client = http.request({ host: "foo" });
    client.end();
    mitm.on("request", function (_req, res) {
      res.end();
    });
    client.on("response", resolve);
  });
});

// In an app of mine Node v0.11.7 did not emit the end event, but
// v0.11.11 did. I'll investigate properly if this becomes a problem in
// later Node versions.
test("http.ServerResponse.prototype.end must make http.IncomingMessage emit end", () => {
  return new Promise((resolve) => {
    const client = http.request({ host: "foo" });
    client.end();
    mitm.on("request", function (_req, res) {
      res.end();
    });

    client.on("response", function (res) {
      res.on("data", noop);
      res.on("end", resolve);
    });
  });
});

test("Mitm.prototype.addListener must be an alias to EventEmitter.prototype.addListener", () => {
  assert.equal(Mitm.prototype.addListener, EventEmitter.prototype.addListener);
});

test("Mitm.prototype.off  must be an alias to EventEmitter.prototype.removeListener", () => {
  assert.equal(Mitm.prototype.off, EventEmitter.prototype.removeListener);
});

test.run();

function Upcase() {
  stream.Transform.call(this, arguments);
}

Upcase.prototype = Object.create(stream.Transform.prototype, {
  constructor: { value: Upcase, configurable: true, writeable: true },
});

Upcase.prototype._transform = function (chunk, _enc, done) {
  done(null, String(chunk).toUpperCase());
};

function noop() {}
