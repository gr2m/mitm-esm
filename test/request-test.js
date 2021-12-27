import http from "node:http";
import https from "node:https";

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

test.run();

function noop() {}
