import net from "net";
import tls from "tls";
import http from "http";
import https from "https";
import stream from "stream";
import { EventEmitter } from "events";

import Sinon from "sinon";
import { test } from "uvu";
import "must/register.js";

import Mitm from "../index.js";

let mitm;
let sinon;

test.before.each(() => {
  mitm = new Mitm();
  sinon = Sinon.sandbox.create();
});
test.after.each(() => {
  mitm.disable();
  sinon.restore();
});

test("must return an instance of Mitm when called as a function", () => {
  mitm.must.be.an.instanceof(Mitm);
});

function mustConnect(moduleName, module) {
  test(`${moduleName}: must return an instance of net.Socket`, () => {
    const socket = module.connect({ host: "foo", port: 80 });
    socket.must.be.an.instanceof(net.Socket);
  });

  test(`${moduleName}: must return an instance of net.Socket given port`, () => {
    module.connect(80).must.be.an.instanceof(net.Socket);
  });

  test(`${moduleName}: must return an instance of net.Socket given port and host`, () => {
    module.connect(80, "10.0.0.1").must.be.an.instanceof(net.Socket);
  });

  test(`${moduleName}: must emit connect on Mitm`, () => {
    const onConnect = Sinon.spy();
    mitm.on("connect", onConnect);
    const opts = { host: "foo" };
    const socket = module.connect(opts);

    onConnect.callCount.must.equal(1);
    onConnect.firstCall.args[0].must.equal(socket);
    onConnect.firstCall.args[1].must.equal(opts);
  });

  test(`${moduleName}: must emit connect on Mitm with options object given host and port`, () => {
    const onConnect = Sinon.spy();
    mitm.on("connect", onConnect);
    const socket = module.connect(9, "127.0.0.1");

    onConnect.callCount.must.equal(1);
    onConnect.firstCall.args[0].must.equal(socket);
    onConnect.firstCall.args[1].must.eql({ host: "127.0.0.1", port: 9 });
  });

  test(`${moduleName}: must emit connection on Mitm`, () => {
    const onConnection = Sinon.spy();
    mitm.on("connection", onConnection);
    const opts = { host: "foo" };
    const socket = module.connect(opts);

    onConnection.callCount.must.equal(1);
    onConnection.firstCall.args[0].must.be.an.instanceof(net.Socket);
    onConnection.firstCall.args[0].must.not.equal(socket);
    onConnection.firstCall.args[1].must.equal(opts);
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
        data.must.equal("Hello");
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
          err.must.be.an.instanceof(Error);
          err.message.must.include("ECONNREFUSED");
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
      connect.callCount.must.equal(1);
      connect.firstCall.args[0].must.eql({ host: "127.0.0.1", port: 9 });
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

      const onConnect = Sinon.spy();
      const client = module.connect({ host: "127.0.0.1", port: 9 }, onConnect);

      client.on(
        "error",
        process.nextTick.bind(null, () => {
          onConnect.callCount.must.equal(0);
          resolve();
        })
      );
    });
  });

  test(`${moduleName}: when bypassed must not emit connection`, () => {
    mitm.on("connect", function (client) {
      client.bypass();
    });
    const onConnection = Sinon.spy();
    mitm.on("connection", onConnection);
    module.connect({ host: "127.0.0.1", port: 9 }).on("error", noop);
    onConnection.callCount.must.equal(0);
  });
}

mustConnect("net.connect", net);

test("net.connect must not return an instance of tls.TLSSocket", () => {
  const client = net.connect({ host: "foo", port: 80 });
  // we don't use `instanceof(tls.TLSSocket)` here because our TlsSocket
  // implementation doesn't extend tls.TLSSocket.
  client.must.not.have.property("getCertificate");
});

test("net.connect must not set the encrypted property", () => {
  net.connect({ host: "foo" }).must.not.have.property("encrypted");
});

test("net.connect must not set the authorized property", () => {
  net.connect({ host: "foo" }).must.not.have.property("authorized");
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
      data.must.equal("Hello ☺️");
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
      ticked.must.be.true();
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
      server.read().must.equal("Hello ☺️");
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
      ticked.must.be.true();
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
      server.read().must.equal("Hello");
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
      server.read().must.equal("Hello");
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
      assertBuffers(server.read(), Buffer.from("Hello", "utf-8"));
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
      assertBuffers(server.read(), Buffer.from("Hello", "utf-8"));
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
      assertBuffers(server.read(), Buffer.from("Hello", "utf-8"));
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
      assertBuffers(
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
      data.must.equal("HELLO");
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
  net.createConnection.must.equal(net.connect);
});

mustConnect("tls.connect", tls);

test("tls.connect must return an instance of tls.TLSSocket", () => {
  // we don't use `instanceof(tls.TLSSocket)` here because our TlsSocket
  // implementation doesn't extend tls.TLSSocket.
  tls.connect({ host: "foo", port: 80 }).must.have.property("getCertificate");
});

test("tls.connect must return an instance of tls.TLSSocket given port", () => {
  // we don't use `instanceof(tls.TLSSocket)` here because our TlsSocket
  // implementation doesn't extend tls.TLSSocket.
  tls.connect(80).must.have.property("getCertificate");
});

test("tls.connect must return an instance of tls.TLSSocket given port and host", () => {
  // we don't use `instanceof(tls.TLSSocket)` here because our TlsSocket
  // implementation doesn't extend tls.TLSSocket.
  tls.connect(80, "10.0.0.1").must.have.property("getCertificate");
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
      connected.must.be.true();
      resolve();
    });

    client.on("connect", () => {
      connected = true;
    });
  });
});

test("tls.connect must set encrypted true", () => {
  tls.connect({ host: "foo" }).encrypted.must.be.true();
});

test("tls.connect must set authorized true", () => {
  tls.connect({ host: "foo" }).authorized.must.be.true();
});

function mustRequest(context, request) {
  test(`${context}: must return http.ClientRequest`, () => {
    request({ host: "foo" }).must.be.an.instanceof(http.ClientRequest);
  });

  test(`${context}: must emit connect on Mitm`, () => {
    const onConnect = Sinon.spy();
    mitm.on("connect", onConnect);
    request({ host: "foo" });
    onConnect.callCount.must.equal(1);
  });

  test(`${context}: must emit connect on Mitm after multiple connections`, () => {
    const onConnect = Sinon.spy();
    mitm.on("connect", onConnect);
    request({ host: "foo" });
    request({ host: "foo" });
    request({ host: "foo" });
    onConnect.callCount.must.equal(3);
  });

  test(`${context}: must emit connection on Mitm`, () => {
    const onConnection = Sinon.spy();
    mitm.on("connection", onConnection);
    request({ host: "foo" });
    onConnection.callCount.must.equal(1);
  });

  test(`${context}: must emit connection on Mitm after multiple connections`, () => {
    const onConnection = Sinon.spy();
    mitm.on("connection", onConnection);
    request({ host: "foo" });
    request({ host: "foo" });
    request({ host: "foo" });
    onConnection.callCount.must.equal(3);
  });

  test(`${context}: must emit request on Mitm`, () => {
    return new Promise((resolve) => {
      const client = request({ host: "foo" });
      client.end();

      mitm.on("request", function (req, res) {
        req.must.be.an.instanceof(http.IncomingMessage);
        req.must.not.equal(client);
        res.must.be.an.instanceof(http.ServerResponse);
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
        err.must.be.an.instanceof(Error);
        err.message.must.include("ECONNREFUSED");
        resolve();
      });
    });
  });

  test(`${context} when bypassed must not emit request`, () => {
    return new Promise((resolve) => {
      mitm.on("connect", function (client) {
        client.bypass();
      });
      const onRequest = Sinon.spy();
      mitm.on("request", onRequest);
      request({ host: "127.0.0.1" }).on("error", function (_err) {
        onRequest.callCount.must.equal(0);
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
      req.url.must.equal("/foo");
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
      req.headers["content-type"].must.equal("application/json");
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
        data.must.equal("Hello");
        resolve();
      });
    });
  });
});

test("http.IncomingMessage must have a reference to the http.ServerResponse", () => {
  return new Promise((resolve) => {
    http.request({ host: "foo", method: "POST" }).end();
    mitm.on("request", function (req, res) {
      req.res.must.equal(res);
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
        res.statusCode.must.equal(442);
        res.headers["content-type"].must.equal("application/json");
        res.setEncoding("utf8");
        res.once("data", function (data) {
          data.must.equal("Hi!");
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
      res.req.must.equal(req);
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
  Mitm.prototype.addListener.must.equal(EventEmitter.prototype.addListener);
});

test("Mitm.prototype.off  must be an alias to EventEmitter.prototype.removeListener", () => {
  Mitm.prototype.off.must.equal(EventEmitter.prototype.removeListener);
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

function assertBuffers(a, b) {
  if (a.equals) a.equals(b).must.be.true();
  else a.toString("utf8").must.equal(b.toString("utf8"));
}

function noop() {}
