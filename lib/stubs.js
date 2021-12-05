// @ts-check

export default class Stubs {
  _stubs = [];

  stub(api, prop, value) {
    this._stubs.push([api, prop, api[prop]]);
    api[prop] = value;
  }

  restore() {
    for (const [api, property, originalValue] of this._stubs) {
      api[property] = originalValue;
    }
    this._stubs = [];
  }
}
