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

### Adaptadores de pagos disponibles (SCRUM-1725, QAS-26)

| `PAYMENT_PROVIDER` | Adaptador | Qué hace | Variables extra |
|---|---|---|---|
| `mock` (por omisión) | `MockPaymentProvider` | Simula el desenlace en memoria; no llama a ninguna red | — |
| `sandbox_http` | `HttpSandboxPaymentProvider` | Cobra contra un sandbox de pagos por HTTP (`POST {PAYMENT_PROVIDER_URL}/cobros`) con `Idempotency-Key` y `X-Correlation-ID`; respeta `signal` | `PAYMENT_PROVIDER_URL` (obligatoria, http/https); `PAYMENT_PROVIDER_API_KEY` (opcional, va solo en `Authorization`) |

Ambos implementan `IPaymentProvider` y pasan el mismo contrato (`providers.contract.test.js`): el caso de uso
`CreatePaymentUseCase` no sabe cuál usa. **Cambiar de adaptador es solo configuración**, sin tocar código:

```bash
# mock (por omisión)
PAYMENT_PROVIDER=mock

# sandbox por HTTP
PAYMENT_PROVIDER=sandbox_http
PAYMENT_PROVIDER_URL=https://sandbox-pagos.example.test
PAYMENT_PROVIDER_API_KEY=...   # solo si el sandbox la pide; no se registra ni se devuelve
```

Un valor sin adaptador, o `sandbox_http` sin URL válida, detiene el arranque. La traducción de fallas del sandbox:
408 y 504 → `TIMEOUT`; 429 y 5xx → `UNAVAILABLE`; otro 4xx o un cuerpo fuera del contrato → `INVALID_RESPONSE`; un
`RECHAZADO` es un desenlace válido. El sandbox no mueve dinero real, así que el adaptador sigue siendo `simulated: true`.

## 5. Matriz de contratos y pruebas

| Garantía | Criterio | Prueba |
|---|---|---|
| Cada adaptador implementa su puerto, declara `name` y `simulated` | C1 | `providers.contract.test.js` (todos los `PROVIDERS`, incluidos `mock` y `sandbox_http`) |
| `sandbox_http`: cabeceras, traducción de fallas y sin filtrar credenciales | C1, C2 | `httpSandboxPaymentProvider.test.js` |
| El mismo caso de uso de cobro corre con los dos adaptadores | C3 | `paymentAdaptadores.test.js` |
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

## Fallas inyectables para probar (SCRUM-1662)

Para comprobar en DEV, QA y CI que una falla de un proveedor no revierte la operación, hay adaptadores que fallan a voluntad.
Ninguno se permite en producción: el arranque se detiene si están configurados.

| Qué | Cómo se activa | Comportamiento |
|---|---|---|
| Push que falla | `PUSH_PROVIDER=mock_falla` | Falla siempre (`PUSH_MOCK_FALLAS=siempre`, por omisión) o los N primeros intentos de cada notificación (`PUSH_MOCK_FALLAS=1` es una falla pasajera) |
| Reintentos del push de eventos | `PUSH_PROVIDER_RETRIES` (1 por omisión, 0 los desactiva) | Ante una falla pasajera se reintenta con la misma clave de idempotencia (el id de la notificación), así que el aviso no se duplica |
| Techo del push de la oferta de despacho | `PUSH_OFERTA_TECHO_MS` (3000 por omisión) | La oferta no espera al push más de este tiempo **entre todos los intentos** (con 2 reintentos, 3 intentos de 1 s). Antes eran 3 intentos de 5 s (15 s) y Dispatch corta cada llamada a Core a los 10 s: la orquestación respondía 503 y dejaba 1 de 2 ofertas. Con el techo, un push sin respuesta deja la oferta en la bandeja y la entrega `FALLIDA` en ~3 s |
| Registro de la falla de entrega | siempre activo | Cada entrega `FALLIDA` (oferta de despacho o evento del servicio) deja una línea `notificacion.entrega_fallida` con `tenant_id`, `notificacion_id`, `canal`, `proveedor`, `causa` (`TIMEOUT`, `UNAVAILABLE`, `INVALID_RESPONSE`) y `correlation_id`. No lleva el payload, el detalle del proveedor ni datos personales |
| Storage de KYC que falla | `STORAGE_FALLA=upload,delete,createSignedUrl` y `STORAGE_FALLA_DESPUES_DE=N` | Las operaciones listadas fallan con `503 MANI-STG-503` después de N llamadas correctas |

**Qué se espera ver**
- **Push caído:** la operación que originó el aviso (mensaje, cambio de estado) queda confirmada, la notificación está en la
  bandeja del usuario y la entrega se informa `FALLIDA`. Nunca se revierte la operación.
- **Storage caído a mitad del registro:** con `STORAGE_FALLA=upload` y `STORAGE_FALLA_DESPUES_DE=1`, el primer documento KYC
  sube y el segundo falla: el registro borra el archivo ya subido, las filas y la identidad creada, y relanza el error. No queda
  nada a medias.

## 7. Circuit Breaker y Resiliencia (SCRUM-1663 · QAS-40)

Para proteger a los servicios de llamadas colgadas o dependencias caídas de forma repetida (QAS-40):

1. **Disyuntor (`CircuitBreaker`) en Core (`src/application/providers/CircuitBreaker.js`):**
   - Implementa la máquina de estados `CLOSED -> OPEN -> HALF_OPEN -> CLOSED` (compatible con `opossum`) integrada en `callProvider` y en los clientes HTTP internos (`RulesServiceHttpClient`, `DispatchServiceHttpClient`).
   - Tras `failureThreshold` (5 por defecto) fallos pasajeros consecutivos (timeout, error de red o `5xx`), el circuito pasa a `OPEN` durante `resetTimeoutMs` (10 000 ms por defecto) y rechaza de inmediato con `503` / `UNAVAILABLE` sin agotar conexiones ni esperar el timeout.
   - Los errores de validación o contrato de negocio (`4xx` / `DomainError` / `INVALID_RESPONSE`) no contabilizan como caídas de disponibilidad ni abren el circuito.
   - Al cumplirse `resetTimeoutMs`, el disyuntor pasa a `HALF_OPEN`: una llamada exitosa restablece `CLOSED` y reinicia el contador; una falla la devuelve a `OPEN`.
2. **Alcance frente a proveedores externos reales:**
   - Mientras pagos y notificaciones operen sobre adaptadores simulados en memoria, se exige siempre **timeout estricto**, **validación de respuesta** y **disyuntor** sobre los clientes HTTP y `callProvider`, quedando activo de forma transparente para los adaptadores de proveedores externos reales que se registren en `PROVIDERS`.
