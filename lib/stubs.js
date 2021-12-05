// @ts-check

export default class Stubs {
  _stubs = [];

  stub(obj, prop, value) {
    this._stubs.push([obj, prop, obj[prop]]);
    obj[prop] = value;
  }

  restore() {
    let stub;
    while ((stub = this._stubs.pop())) stub[0][stub[1]] = stub[2];
  }
}
