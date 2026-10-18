# Evolución del Esquema y Políticas RLS en Supabase — `MANI-Node` (`db/`)

De acuerdo con **[ADR-0030](https://github.com/Trama-AS/MANI-docs/blob/main/adr/ADR-0030-propiedad-esquema-y-frontera-de-datos.md)** y **[ADR-0032](https://github.com/Trama-AS/MANI-docs/blob/main/adr/ADR-0032-identidad-de-servicio-en-base-de-datos.md)** (`SCRUM-1103` / `SCRUM-1104` / `SCRUM-1159`), **Core Service (`MANI-Node`) es el único dueño de la evolución del esquema PostgreSQL/Supabase compartido**. Ninguna política RLS ni objeto de base de datos puede crearse únicamente en la consola de Supabase sin estar versionado en `db/migrations/`.

---

## 1. Estructura del Directorio

| Ruta | Propósito |
| :--- | :--- |
| [`db/migrations/`](migrations/) | Serie incremental e inmutable de migraciones SQL registradas en `schema_migrations`. |
| [`db/verify/`](verify/) | Scripts SQL ejecutables (`ON_ERROR_STOP=1`, transacción con `ROLLBACK`) que acreditan el cierre de exposiciones y los 6 casos de aislamiento cross-tenant en el motor. |
| [`src/infrastructure/db/withTenantContext.js`](../src/infrastructure/db/withTenantContext.js) | Puerta transaccional de Core (`pg`) que ejecuta `SELECT app.set_context($1, $2, $3)` al inicio de cada transacción. |

---

## 2. Serie de Migraciones Versionadas

| Versión | Archivo | Ticket | Descripción |
| :--- | :--- | :--- | :--- |
| **`0001`** | [`0001_add_identidad_aliado_core_node.sql`](migrations/0001_add_identidad_aliado_core_node.sql) | `SCRUM-1065` | Columnas de identidad (`tipo_documento`, `numero_documento`, `telefono`) e índice único por tenant en `aliado`. |
| **`0005`** | [`0005_cerrar_exposiciones_rls.sql`](migrations/0005_cerrar_exposiciones_rls.sql) | `SCRUM-1334` | Cierra las 3 exposiciones inmediatas a `anon`: revoca `registrar_aliado_persona_natural`/`registrar_aliado_empresa`, retira políticas `USING (true)` de `documento_kyc` y habilita RLS en las 11 tablas de negocio pendientes. |
| **`0006`** | [`0006_contexto_identidad.sql`](migrations/0006_contexto_identidad.sql) | `SCRUM-1104` | Crea los roles de servicio `mani_core_svc` y `mani_dispatch_svc` (`NOLOGIN NOBYPASSRLS`), concede `USAGE` sobre `auth` y define el esquema `app` (`app.tenant_id()`, `app.user_id()`, `app.user_role()`, `app.set_context(uuid, uuid, text)`). |
| **`0007`** | [`0007_politicas_por_tenant.sql`](migrations/0007_politicas_por_tenant.sql) | `SCRUM-1104` | Aplica `ENABLE + FORCE ROW LEVEL SECURITY` en todas las tablas con `tenant_id`, impone la frontera de datos por `GRANT` (ADR-0030) y reemplaza las políticas legadas por políticas canónicas basadas en `app.*` con `TO` explícito. |

---

## 3. Modelo de Identidad en Base de Datos (`ADR-0032`)

Cuando los servicios (`MANI-Node` y `MANI-.NET`) son la única frontera de acceso a datos (`ADR-0022`), conectarse con `service_role` o `postgres` omite RLS (`BYPASSRLS`), y las políticas antiguas basadas en `auth.uid()` dejan de filtrar por tenant.

El modelo implementado en `0006` y `0007` resuelve ambos problemas:

1. **Roles de servicio dedicados sin `BYPASSRLS`:**
   - `mani_core_svc`: usado por `MANI-Node` (Core Service).
   - `mani_dispatch_svc`: usado por `MANI-.NET` (Dispatch Service).
   - Ambos roles nacen con `NOLOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE` en la migración `0006`. Operaciones (DevOps) asigna `LOGIN PASSWORD` fuera de git (`/opt/mani/.env.{dev,qa,prod}`, `ADR-0031` §5).
2. **Contexto transaccional unificado (`request.jwt.claims`):**
   - Al abrir una transacción, el servicio invoca `SELECT app.set_context(tenant_id, user_id, user_role)` con los encabezados ya verificados en el perímetro (`X-Tenant-Id`, `X-User-Id`, `X-User-Role`).
   - `app.set_context` escribe en `request.jwt.claims` con `is_local = true`: el contexto muere automáticamente en `COMMIT` o `ROLLBACK` y nunca se filtra a otra petición del pool de conexiones (`P1`).
   - Si `tenant_id` es `NULL`, `app.set_context` rechaza la operación con `MANI-RLS-400` (`ERRCODE 22023`).
   - Si un servicio consulta una tabla con `tenant_id` sin haber llamado antes a `app.set_context`, `app.tenant_id()` devuelve `NULL` y RLS filtra 0 filas (falla cerrada, `C5`).

---

## 4. Matriz de Permisos (`GRANT`) y Políticas RLS Vigentes (`0007`)

Toda tabla con `tenant_id` tiene `ENABLE ROW LEVEL SECURITY` y `FORCE ROW LEVEL SECURITY`. Ninguna política usa `TO public` implícito.

| Tabla | Dueño (`ADR-0030`) | `mani_core_svc` | `mani_dispatch_svc` | Políticas RLS Vigentes | Regla de Aislamiento |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `tenant` | Core | `SELECT` | `SELECT` | `tenant_lectura` (`TO anon, authenticated, mani_core_svc, mani_dispatch_svc`) | `FOR SELECT USING (true)` (directorio de slugs pre-auth, `ADR-0018`); escritura solo `postgres`. |
| `zona` | Core | `SELECT` | `SELECT` | `zona_lectura` (`TO anon, authenticated, mani_core_svc, mani_dispatch_svc`) | `FOR SELECT USING (true)` (catálogo geográfico global sin `tenant_id`); escritura solo `postgres`. |
| `usuario` | Core | `CRUD` | — | `usuario_tenant` (`TO authenticated, mani_core_svc`) | Patrón T: `tenant_id = app.tenant_id()` (`USING` y `WITH CHECK`). |
| `categoria_servicio` | Core | `CRUD` | — | `categoria_servicio_tenant` (`TO authenticated, mani_core_svc`) | Patrón T: `tenant_id = app.tenant_id()` (reemplaza lectura pública anterior). |
| `aliado`, `cliente`, `sitio`, `aliado_categoria`, `cobertura_aliado`, `aliado_ausencia` | Core | `CRUD` | — | `<tabla>_tenant` (`TO authenticated, mani_core_svc`) | Patrón T: `tenant_id = app.tenant_id()`. Dispatch no tiene permisos sobre estas tablas (`P3`). |
| `documento_kyc` | Core | `CRUD` | — | `documento_kyc_lectura`, `documento_kyc_alta`, `documento_kyc_resolucion_admin`, `documento_kyc_borrado` (`TO authenticated, mani_core_svc`) | Lectura/borrado: mismo tenant **y** (`admin_tenant` o aliado dueño). Alta: mismo tenant **y** aliado dueño. Actualización: mismo tenant **y** `admin_tenant`. |
| `tarifa_referencia`, `cotizacion`, `mensaje`, `evento_servicio`, `calificacion`, `notificacion` | Core | `CRUD` | — | `<tabla>_tenant` (`TO authenticated, mani_core_svc`) | Patrón T: `tenant_id = app.tenant_id()`. |
| `solicitud_foto` | Core | `SELECT, INSERT` | — | `solicitud_foto_tenant` (`TO authenticated, mani_core_svc`) | Patrón T: `tenant_id = app.tenant_id()`. |
| `documento_legal` | Core | `SELECT, INSERT` | — | `documento_legal_lectura`, `documento_legal_alta` | Lectura de activos globales (`tenant_id IS NULL`) o del tenant (`app.tenant_id()`). |
| `consentimiento_usuario` | Core | `SELECT, INSERT` | — | `consentimiento_usuario_propio`, `consentimiento_usuario_alta` | `usuario_id = app.user_id()` **y** (`tenant_id IS NULL` o `tenant_id = app.tenant_id()`). |
| `solicitud` | Core / Dispatch | `SELECT, INSERT, UPDATE` | `SELECT, UPDATE` | `solicitud_lectura`, `solicitud_alta_cliente`, `solicitud_aceptar_aliado`, `solicitud_transicion_core` | Lectura por tenant; alta exige `app.user_role() = 'cliente'`; aceptación en Dispatch exige `app.user_role() = 'aliado'` (`H-02`/`KI-13`). |
| `solicitud_rechazo` | Dispatch | — | `SELECT, INSERT` | `solicitud_rechazo_aliado` (`TO authenticated, mani_dispatch_svc`) | Mismo tenant (`app.tenant_id()`) **y** aliado dueño (`app.user_id()`). |
| `storage.objects` | Core | Storage API | — | `kyc_isolation`, `solicitudes_isolation` (`TO authenticated, mani_core_svc`) | Exige `(storage.foldername(name))[1] = app.tenant_id()::text` y carpeta de usuario `(storage.foldername(name))[2] = app.user_id()::text` (o `admin_tenant`). |

---

## 5. Runbook de Aplicación y Verificación (DEV y QA)

### 5.1 Aplicar migraciones y ejecutar verificación en el motor

```bash
# 1. Aplicar migraciones de cierre de exposiciones (0005), contexto (0006) y políticas por tenant (0007)
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f db/migrations/0005_cerrar_exposiciones_rls.sql \
  -f db/migrations/0006_contexto_identidad.sql \
  -f db/migrations/0007_politicas_por_tenant.sql

# 2. Ejecutar las suites de verificación (corren en transacción y terminan en ROLLBACK)
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/verify/0005_verificar_exposiciones.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/verify/0007_verificar_modelo_identidad_rls.sql
```

Salida esperada:
- `NOTICE:  OK 0005: exposiciones cerradas y servicios sin cambios`
- `NOTICE:  OK 0007: modelo de identidad, politicas RLS y 6 casos cross-tenant verificados`

### 5.2 Activación operativa de los roles de servicio (Paso 5 — DevOps)

Las migraciones `0005`–`0007` son **aditivas y seguras de aplicar antes de cambiar las credenciales de conexión** de los servicios. Para activar el filtrado en QA/PROD:

1. Operaciones ejecuta fuera de git (con el secreto almacenado en `/opt/mani/.env.{dev,qa,prod}`):
   ```sql
   ALTER ROLE mani_core_svc WITH LOGIN PASSWORD '<CORE_DB_PASSWORD>';
   ALTER ROLE mani_dispatch_svc WITH LOGIN PASSWORD '<DISPATCH_DB_PASSWORD>';
   ```
2. Actualizar `DATABASE_URL` de `MANI-Node` para conectar como `mani_core_svc` y de `MANI-.NET` para conectar como `mani_dispatch_svc`.
3. **Reversa inmediata:** restaurar `DATABASE_URL` al usuario previo restablece el comportamiento anterior en segundos sin revertir migraciones ni tocar datos.
