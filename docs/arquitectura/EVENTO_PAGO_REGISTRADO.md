# Evento `PagoRegistrado` v1 y publicación desde Core (SCRUM-889)

**Normativa:** `ADR-0029` (Kafka con outbox transaccional), `CONTRATOS_EVENTOS.md` (sobre común `EventEnvelope v1`, en MANI-docs) y `ADR-0030` (frontera de datos).

## Qué es

Core publica un evento cada vez que el proveedor de pagos resuelve un intento de pago y queda registrado en `pago`, con
cualquier desenlace (`APROBADO`, `RECHAZADO` o `PENDIENTE`; `data.estado` lo dice). Un fallo del proveedor (timeout,
respuesta inválida) no registra pago y por tanto no emite evento. Hoy el proveedor es el sandbox simulado
(`data.simulado = true`): no hay dinero real.

- **Tópico:** `mani.pago.pago-registrado.v1` (1 partición, factor de replicación 1, `retention.bytes=1073741824`, igual
  que los demás). Lo crea la infraestructura: el broker no autocrea tópicos.
- **Productor único:** Core. **Clave de partición:** `id_solicitud` (el orden se conserva por solicitud).
- **Dedupe:** los consumidores deben deduplicar por `event_id`; la entrega es al menos una vez.

## Sobre y `data`

```json
{
  "event_id": "uuid del evento (id de outbox_evento)",
  "event_type": "PagoRegistrado",
  "event_version": 1,
  "occurred_at": "instante de la transacción del pago, en UTC",
  "tenant_id": "uuid",
  "correlation_id": "uuid (el de la petición; si no es UUID, se genera uno)",
  "partition_key": "id_solicitud",
  "data": {
    "id_pago": "uuid", "id_solicitud": "uuid", "id_cotizacion": "uuid", "id_cliente": "uuid", "id_aliado": "uuid",
    "estado": "APROBADO | RECHAZADO | PENDIENTE", "monto": 150000.5, "moneda": "COP",
    "proveedor": "mock", "simulado": true
  }
}
```

`data` lleva solo identificadores, estado e importes. No lleva datos de tarjeta, referencia del proveedor, motivo del
rechazo ni datos de contacto de las personas. El encabezado Kafka `event-id` repite el `event_id`.

## Cómo se publica

1. **Outbox:** en `PgPaymentRepository.registrar`, el evento se inserta en `outbox_evento` en la **misma transacción**
   que el pago (migración `0035`). Si el pago no se guarda, el evento tampoco; un reintento con la misma clave no lo
   duplica (un evento por pago y tipo).
2. **Relay:** `OutboxRelay` toma los pendientes de todos los tenants (con `SKIP LOCKED`, así varios Core no publican el
   mismo evento), los publica con `KafkaEventPublisher` y solo entonces los marca publicados. Si Kafka falla, hace
   ROLLBACK, cuenta el intento (`intentos`, `ultimo_error`) y reintenta en la vuelta siguiente.
3. **Sin broker, sin pérdida:** si `KAFKA_BROKERS` no está configurada, el relay no arranca y los eventos esperan en
   el outbox hasta que se configure.

## Configuración (variables de entorno de Core)

| Variable | Descripción | Por defecto |
|---|---|---|
| `KAFKA_BROKERS` | Lista `host:puerto` separada por comas. Sin ella, el relay no arranca. | vacía |
| `KAFKA_CLIENT_ID` | Identificador del cliente. | `mani-core` |
| `OUTBOX_RELAY_INTERVAL_MS` | Pausa entre vueltas del relay. | `2000` |
| `OUTBOX_RELAY_BATCH_SIZE` | Eventos por vuelta. | `50` |

Requisito para DevOps: la dirección de `KAFKA_BROKERS` debe resolverse **desde el contenedor de Core**. Con el broker de
DEV y QA, que anuncia `kafka:9092`, basta con que Core esté en la red `mani-network`: `KAFKA_BROKERS=kafka:9092`.

## Qué se verificó

Pruebas contra PostgreSQL 15 como `mani_core_svc` (outbox, RLS, relay, fallo de Kafka, concurrencia) y una prueba local
de punta a punta contra un broker `apache/kafka:3.8.0` real: el pago dejó su evento, el relay lo publicó y el consumidor
lo recibió con la clave y el encabezado esperados. **No** se probó contra el broker de DEV ni de QA.

## Límites conocidos

- Hoy solo existe este evento en el outbox. `SolicitudCreada`, `CotizacionAceptada` y `ServicioFinalizado` (del mismo
  contrato) no se publican todavía.
- Las funciones `SECURITY DEFINER` del relay son la solución mínima; un rol `mani_relay` dedicado (ADR-0029) la
  reemplazaría.
- `CONTRATOS_EVENTOS.md` (MANI-docs) aún no incluye `PagoRegistrado`; este documento es su especificación hasta que se
  agregue ahí.
