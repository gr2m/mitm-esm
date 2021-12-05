export default class Stubs extends Array {
  stub(obj, prop, value) {
    this.push([obj, prop, obj[prop]]);
    obj[prop] = value;
  }

  restore() {
    let stub;
    while ((stub = this.pop())) stub[0][stub[1]] = stub[2];
  }
}
