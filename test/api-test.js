import { EventEmitter } from "node:events";

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

test("Mitm.prototype.addListener must be an alias to EventEmitter.prototype.addListener", () => {
  assert.equal(Mitm.prototype.addListener, EventEmitter.prototype.addListener);
});

test("Mitm.prototype.off must be an alias to EventEmitter.prototype.removeListener", () => {
  assert.equal(Mitm.prototype.off, EventEmitter.prototype.removeListener);
});

test.run();
