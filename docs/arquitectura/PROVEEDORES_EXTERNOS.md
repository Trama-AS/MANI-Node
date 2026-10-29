# Integración con proveedores externos (SCRUM-1240 · ARQ-09)

Contrato y política comunes para los proveedores externos de Core: **pagos** (HU-M11-01, SCRUM-1432) y
**notificaciones push** (HU-M09-06, SCRUM-1428). La decisión se registra en MANI-docs como ADR-0034.

Este documento no crea proveedores nuevos ni reemplaza los mocks: SCRUM-1432 es dueño del sandbox de pagos y
SCRUM-1428 del proveedor push simulado. Aquí se fija lo que ambos (y el proveedor real que los reemplace) deben
cumplir.

Corte: `develop` ae79f93 (27-oct-2026).

## 1. Responsabilidades

| Pieza | Dónde | Responsable |
|---|---|---|
| Puertos `IPaymentProvider` e `IPushProvider` | `src/domain/ports/` | Contrato común (esta tarea) |
| Error común `ProviderError` y sus clases `PaymentProviderError`, `PushProviderError` | `src/domain/errors/` | Contrato común (esta tarea) |
| Política de llamada `callProvider` | `src/application/providers/callProvider.js` | Contrato común (esta tarea) |
| `MockPaymentProvider` (sandbox) | `src/infrastructure/payments/` | SCRUM-1432 |
| `MockPushProvider` | `src/infrastructure/push/` | SCRUM-1428 |
| Selección del adaptador por ambiente | `createPaymentProvider`, `createPushProvider` | Cada módulo; regla común abajo |

Core es el único servicio que habla con estos proveedores (ADR-0030 §2). Dispatch y Rules no los llaman.

## 2. Contrato de los puertos

Los dos puertos exponen lo mismo:

| Elemento | Pagos (`charge`) | Push (`send`) |
|---|---|---|
| `name` | Nombre del adaptador; queda en cada pago | Nombre del adaptador; va en la entrega |
| `simulated` | `true` si no mueve dinero real | `true` si no entrega a dispositivos reales |
| Clave de idempotencia | `idempotencyKey` = `claveIdempotencia` del cliente, si la envía | `idempotencyKey` = id de la notificación |
| Trazabilidad | `correlationId` de la petición | `correlationId` de la petición |
| Cancelación | `signal` (`AbortSignal`) | `signal` (`AbortSignal`) |
| Desenlace válido | `{ estado: APROBADO \| RECHAZADO \| PENDIENTE, referencia, motivo? }` | `{ proveedor, estado: ENTREGADA \| SIMULADA, simulada, mensajeId }` |
| Sin desenlace | Lanza `PaymentProviderError` | Lanza `PushProviderError` |

Reglas que todo adaptador cumple:

1. **Nunca devuelve un éxito falso.** Si no sabe el desenlace, lanza el error con su causa (`TIMEOUT`, `UNAVAILABLE`
   o `INVALID_RESPONSE`). Un pago `RECHAZADO` no es un error: es un desenlace válido.
2. **Idempotente por clave.** La misma `idempotencyKey` devuelve el mismo desenlace y no cobra ni entrega dos veces.
3. **Simulado siempre visible.** Un adaptador con `simulated: true` nunca reporta una entrega `ENTREGADA` ni un pago
   como real.
4. **Respeta `signal`.** Cuando Core aborta por timeout, el adaptador deja de esperar al proveedor.

## 3. Política común de llamada

`callProvider` aplica la misma política en todos los casos de uso:

| | Pagos | Push |
|---|---|---|
| Timeout | `PAYMENT_PROVIDER_TIMEOUT_MS` (10 000 ms) | `PUSH_PROVIDER_TIMEOUT_MS` (5 000 ms) |
| Reintentos automáticos | **Ninguno**, aunque la configuración los pida | 2, con espera de 100 ms y 200 ms |
| Qué se reintenta | — | Solo `TIMEOUT` y `UNAVAILABLE` |
| Sin desenlace | 504 `MANI-PAG-504` (timeout) o 502 `MANI-PAG-502`; no se registra pago | La notificación queda en la bandeja; la entrega se informa `FALLIDA` |
| Auditoría | `US-07.pago.proveedor_sin_desenlace` con tenant, usuario, causa y `correlation_id` | Notificación persistida en `notificacion` con su tenant y destinatario |

Por qué un cobro no se reintenta: si la respuesta se pierde después de cobrar, repetir sin la clave del cliente
podría cobrar dos veces. El cliente reintenta con la misma `claveIdempotencia`, y tanto Core (por la tabla de pagos)
como el proveedor devuelven el pago existente. La clave es la del cliente y no la cotización, para que un pago
rechazado se pueda volver a intentar.

Una excepción sin tipo (red, error del adaptador) se informa como `UNAVAILABLE` con un mensaje genérico: el detalle
interno, que puede traer direcciones o credenciales, no llega al cliente.

## 4. Configuración, secretos y sustitución de mock a real

- El adaptador se elige por variable de ambiente (`PAYMENT_PROVIDER`, `PUSH_PROVIDER`; por omisión `mock`), no con
  un flag en el código (ADR-0014). Un valor sin adaptador detiene el arranque.
- Para agregar el proveedor real:
  1. crear el adaptador en `src/infrastructure/<payments|push>/` extendiendo el puerto;
  2. leer sus credenciales en `src/config/index.js` desde `process.env` y agregarlas a `REQUIRED_VARS_BY_ENV` del
     ambiente que lo use;
  3. registrarlo en `PROVIDERS` de su fábrica.

  Con el paso 3 ya queda sometido a las pruebas de contrato (`tests/unit/providers/providers.contract.test.js`).
- Las credenciales nunca se registran, no se devuelven en respuestas y no se guardan en el repositorio
  (`.env.example` solo lleva nombres).
- El tenant y el destinatario salen siempre del JWT y del repositorio, nunca del cuerpo (ADR-0018), y viajan al
  proveedor para que la entrega quede aislada y auditada por tenant.

## 5. Matriz de contratos y pruebas

| Garantía | Criterio | Prueba |
|---|---|---|
| Cada adaptador implementa su puerto, declara `name` y `simulated` | C1 | `providers.contract.test.js` (todos los `PROVIDERS`) |
| Desenlace dentro del contrato, con referencia o `mensajeId` | C1 | `providers.contract.test.js` |
| Misma clave, mismo desenlace; claves distintas, operaciones distintas | C2 | `providers.contract.test.js` |
| Simulado nunca se presenta como real | C1 | `providers.contract.test.js` |
| Timeout aborta la señal y responde `TIMEOUT` sin esperar indefinidamente | C2 | `callProvider.test.js`, `providerPolicyUseCases.test.js` |
| Solo se reintenta lo pasajero; `INVALID_RESPONSE` nunca | C2 | `callProvider.test.js` |
| Un error sin tipo no filtra el detalle interno | C3 | `callProvider.test.js` |
| Un cobro nunca se reintenta automáticamente y sin desenlace no deja pago | C2 | `providerPolicyUseCases.test.js`, `paymentUseCases.test.js` |
| Push reintentado no entrega dos veces | C2 | `providerPolicyUseCases.test.js` |
| Push fallido deja la notificación en la bandeja y la entrega `FALLIDA` | C2 | `providerPolicyUseCases.test.js`, `dispatchUseCases.test.js` |
| Tenant y destinatario desde la sesión; fallo de pago auditado con tenant | C3 | `providerPolicyUseCases.test.js` |

## 6. Cómo se verificó

- `npm test`: 1210 pruebas, 1157 pasan, 0 fallan y 53 se omiten (las de PostgreSQL real sin `TEST_DATABASE_URL`).
  Son 25 pruebas nuevas en `tests/unit/providers/`.
- `npx eslint .` sin errores.
- La prueba de timeout encontró un defecto antes de publicar: al abortar, el rechazo del adaptador ganaba la carrera
  y un timeout se informaba como `UNAVAILABLE` (502 en vez de 504). `callProvider` lo corrige con una marca de
  vencimiento.
