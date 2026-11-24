/**
 * Circuit Breaker (SCRUM-1663 / QAS-40) compatible con la semántica de opossum para proteger llamadas
 * de Core hacia proveedores externos (pagos, push) y servicios internos (Rules, Dispatch).
 *
 * Estados:
 * - CLOSED: tráfico normal; las fallas pasajeras consecutivas incrementan el contador.
 * - OPEN: tras alcanzar `failureThreshold`, rechaza de inmediato sin esperar timeout hasta que venza `resetTimeoutMs`.
 * - HALF_OPEN: permite una llamada de sondeo; si tiene éxito cierra el circuito, si falla vuelve a abrirlo.
 */
class CircuitBreaker {
  constructor(action = null, {
    name = 'circuit',
    failureThreshold = 5,
    resetTimeoutMs = 10000,
    errorFilter = (err) => err?.transient !== false && err?.retryable !== false,
    now = () => Date.now(),
  } = {}) {
    if (!Number.isInteger(failureThreshold) || failureThreshold < 1) {
      throw new TypeError('CircuitBreaker: failureThreshold debe ser un entero >= 1');
    }
    if (!Number.isFinite(resetTimeoutMs) || resetTimeoutMs <= 0) {
      throw new TypeError('CircuitBreaker: resetTimeoutMs debe ser un número positivo');
    }
    this.action = action;
    this.name = name;
    this.failureThreshold = failureThreshold;
    this.resetTimeoutMs = resetTimeoutMs;
    this.errorFilter = errorFilter;
    this.now = now;

    this._state = 'CLOSED';
    this._failures = 0;
    this._openedAt = null;
    this._listeners = { open: [], halfOpen: [], close: [] };
  }

  get state() {
    if (this._state === 'OPEN' && this._openedAt !== null && this.now() - this._openedAt >= this.resetTimeoutMs) {
      this._transition('HALF_OPEN');
    }
    return this._state;
  }

  get opened() {
    return this.state === 'OPEN';
  }

  get closed() {
    return this.state === 'CLOSED';
  }

  get halfOpen() {
    return this.state === 'HALF_OPEN';
  }

  get stats() {
    return {
      name: this.name,
      state: this.state,
      failures: this._failures,
      failureThreshold: this.failureThreshold,
      resetTimeoutMs: this.resetTimeoutMs,
      openedAt: this._openedAt,
    };
  }

  on(event, listener) {
    if (this._listeners[event] && typeof listener === 'function') {
      this._listeners[event].push(listener);
    }
    return this;
  }

  open() {
    this._openedAt = this.now();
    this._transition('OPEN');
  }

  close() {
    this._failures = 0;
    this._openedAt = null;
    this._transition('CLOSED');
  }

  async fire(...args) {
    const fn = typeof args[0] === 'function' && !this.action ? args.shift() : this.action;
    if (typeof fn !== 'function') {
      throw new TypeError('CircuitBreaker.fire requiere una función ejecutable');
    }
    return this.execute(() => fn(...args));
  }

  async execute(operation) {
    const currentState = this.state;
    if (currentState === 'OPEN') {
      const err = new Error(`Circuito abierto para ${this.name}`);
      err.code = 'CIRCUIT_OPEN';
      err.circuitOpen = true;
      err.retryable = false;
      throw err;
    }

    try {
      const result = await operation();
      if (this._state === 'HALF_OPEN' || this._failures > 0) {
        this.close();
      }
      return result;
    } catch (err) {
      if (this.errorFilter(err)) {
        this._failures += 1;
        if (currentState === 'HALF_OPEN' || this._failures >= this.failureThreshold) {
          this.open();
        }
      }
      throw err;
    }
  }

  _transition(nextState) {
    if (this._state === nextState) return;
    this._state = nextState;
    const key = nextState === 'OPEN' ? 'open' : (nextState === 'HALF_OPEN' ? 'halfOpen' : 'close');
    for (const fn of this._listeners[key]) {
      fn(this.stats);
    }
  }
}

module.exports = CircuitBreaker;
