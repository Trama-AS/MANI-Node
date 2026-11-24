# Pool de conexiones de Core (SCRUM-1651)

Core abre un pool de conexiones directas a PostgreSQL (`pg`, `DATABASE_URL`) para las operaciones que necesitan una
transacción real. Este documento explica cómo se dimensiona y qué relación tiene con Dispatch.

## Variables

| Variable | Por omisión | Qué controla |
|---|---|---|
| `DATABASE_POOL_MAX` | 5 | Conexiones máximas **por instancia** de Core |
| `DATABASE_POOL_CONNECTION_TIMEOUT_MS` | 10 000 | Cuánto espera una petición por una conexión libre antes de fallar |
| `DATABASE_POOL_IDLE_TIMEOUT_MS` | 30 000 | Cuánto se deja abierta una conexión sin uso |

Un valor ausente, vacío o que no sea un entero positivo usa el de por omisión: una variable mal escrita no deja a Core sin
pool.

## Cómo dimensionar el máximo

La base de QA permite `max_connections` = 60. Esas conexiones las comparten **todos** los clientes de la base, no solo Core:

```
instancias de Core × DATABASE_POOL_MAX
  + conexiones de Dispatch (y de cualquier otro servicio)
  + conexiones reservadas por Supabase (Auth, Storage, panel, migraciones)
  ≤ max_connections
```

Con una sola instancia de Core, el valor por omisión (5) deja mucho margen pero limita la concurrencia: más de 5
transacciones simultáneas hacen cola. Subirlo reduce la espera bajo carga, y subirlo de más agota la base y hace fallar a
todos los servicios. Cambiarlo es una decisión de operación: se fija por ambiente y se mide (T-42).

## Relación con el timeout de Dispatch

Cuando el pool está lleno, una petición a Core espera hasta `DATABASE_POOL_CONNECTION_TIMEOUT_MS` por una conexión. Si
Dispatch deja de esperar a Core **antes** de ese plazo, Dispatch reporta un error por una petición que Core todavía podía
atender. Regla: **el timeout de Dispatch hacia Core debe ser mayor o igual que `DATABASE_POOL_CONNECTION_TIMEOUT_MS`**
(hoy 10 s en Core, y el de Dispatch está en 3 s; el ajuste del lado de Dispatch corresponde a su repositorio).

## Verificación

- `tests/unit/config/config.test.js` cubre la lectura y los valores por omisión.
- `tests/unit/db/pgPoolFactory.test.js` comprueba que el pool recibe esos valores.
