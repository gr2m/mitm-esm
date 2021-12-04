import Net from "net";

export default function Socket() {
  Net.Socket.apply(this, arguments);
}

Socket.prototype = Object.create(Net.Socket.prototype, {
  constructor: { value: Socket, configurable: true, writeable: true },
});

Socket.prototype.bypass = function () {
  this.bypassed = true;
};
