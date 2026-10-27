# Módulos internos de Core (SCRUM-1447 · HU-M13-05)

Inventario de dominios de MANI-Node y de sus límites, contrastado con RNF-02 y ADR-0022. Core sigue siendo
**un solo servicio desplegable**: cada dominio es un límite interno (carpetas y archivos), no un microservicio
ni un servicio por CRUD.

Corte: `develop` 0a02b7f (26-oct-2026). Comprobado sobre el código; las cifras salen de los comandos de la
sección «Cómo se verificó».

## 1. Dominios, rutas y datos

| Dominio | Rutas (`/api/v1/core/…`) | Casos de uso | Tablas que escribe o lee | Persistencia |
|---|---|---|---|---|
| Identidad y registro | `/auth/*` (registro de aliado, cliente y empresa, `validate-token`, `dev-token`) | `auth/`, `allies/` (empleado directo) | `usuario`, `aliado`, `cliente`, `sitio`, `documento_kyc`, `aliado_categoria`, `consentimiento_usuario` | Supabase (service role) + pg transaccional sin contexto de tenant |
| Tenants | `GET /tenants` | `tenants/` | `tenant` | Supabase (service role) |
| Perfiles | `/profiles/me`, `/profiles/me/photo`, `/profiles/me/categories*` | `profiles/` | `usuario`, `aliado`, `aliado_categoria`, `categoria_servicio` | Supabase + pg transaccional sin contexto de tenant |
| Disponibilidad | `/profiles/me/unavailability*` | `availability/` | `aliado_ausencia` | Supabase (service role) |
| Verificación KYC | `/aliados/verificacion`, `/aliados/:id/verificacion`, `/aliados/:id/documentos/:documentoId/url` | `verification/` | `aliado`, `documento_kyc`, `usuario` | Supabase + pg transaccional sin contexto de tenant |
| Catálogo | `/catalog`, `/catalog/categories*` | `catalog/` | `categoria_servicio` | Supabase (service role); reglas en Rules (HTTP) |
| Clientes y sitios | `/clients/company`, `/clients/:id/sites*`, `/sites/:id/rules`, `/sites/:id/reglas`, `/sites/:id/validate-schedule` | `clients/`, `sites/` | `cliente`, `sitio`, `usuario`, `solicitud` (lectura) | pg sin contexto de tenant |
| Legal | `/legal/documents/active`, `/legal/consents` | `legal/` | `documento_legal`, `consentimiento_usuario` | Supabase (service role) |
| Solicitudes | `POST /solicitudes` | `requests/` | `solicitud`, `solicitud_foto`, `sitio`, `evento_servicio` | pg con `withTenantContext` (el único) |
| Integración con Dispatch | `/allies/eligible`, `/allies/me`, `/solicitudes/:id/context`, `POST/GET /notifications` | `dispatch/` | `aliado`, `aliado_ausencia`, `cobertura_aliado`, `solicitud_rechazo`, `zona`, `solicitud`, `notificacion` | pg sin contexto de tenant |
| Notificaciones | `/profiles/me/inbox` | `notifications/` y parte de `dispatch/` | `notificacion` | pg sin contexto de tenant + proveedor push (mock de HU-M09-06) |
| Salud | `/health` | `health/` | — | — |

Dependencias hacia otros servicios, siempre por HTTP (ADR-0030):
- **Rules**: `RulesServiceHttpClient`, solo desde el catálogo (crear y editar categoría).
- **Dispatch**: `DispatchServiceHttpClient`, solo desde sitios (reglas visibles al aliado asignado, SCRUM-853).

## 2. Antes y después de este cambio

**Antes.**
- `src/routes/core.routes.js` registraba en un solo archivo de 78 líneas las rutas de ocho dominios: tenants, perfiles, disponibilidad, verificación, integración con Dispatch, notificaciones, solicitudes y catálogo.
- `src/repositories/` y `src/services/` (catálogo, perfiles y tenants) eran código de la primera estructura. Solo los usaba `tests/unit/services/catalog.service.test.js`, y ningún archivo de `src/` los importaba.
- `AGENTS.md` §5 describía esa estructura antigua.

**Después.**
- `src/routes/core.routes.js` solo compone `src/routes/core/<dominio>.routes.js`, un archivo por dominio con sus propios middlewares (multer de fotos en perfiles y solicitudes, `requireRole('ADMIN')` en catálogo). El orden de montaje es el mismo de antes.
- Se eliminan `src/repositories/`, `src/services/` y la prueba que los cubría.
- `AGENTS.md` §5 describe la estructura real.

**Lo que no cambia:** ningún método, ninguna ruta pública ni su orden, ningún middleware de autenticación o rol, y ningún caso de uso, repositorio, migración ni contrato OpenAPI.

## 3. Límites que ya se cumplen

- Un caso de uso por operación y una carpeta de casos de uso por dominio (`src/application/useCases/<dominio>`).
- El tenant, el usuario y el rol salen del JWT verificado (`authenticate`), no del cuerpo ni de cabeceras.
- Core llama a Dispatch y a Rules por HTTP (ADR-0030). La única excepción es la lectura de `solicitud_rechazo` (hallazgo 6).
- No hay dependencias circulares entre casos de uso: los casos de uso no se importan entre sí; comparten repositorios inyectados desde `container.js`.

## 4. Hallazgos para las siguientes iteraciones

No se corrigen en este cambio, porque tocan persistencia o contratos y necesitan su propia historia y su propia regresión.

1. **ADR-0032 aplicado en un solo repositorio (C3).**
   - Solo `PgServiceRequestRepository` (crear solicitud) fija el contexto con `withTenantContext`.
   - Doce repositorios usan el cliente de Supabase con la *service-role key* (`SupabaseClientFactory`), que **no pasa por RLS**.
   - Los otros ocho repositorios `pg` consultan con `pool.query` o con su propia transacción, sin `app.set_context`: `PgElegibilidadRepository`, `PgNotificacionRepository`, `PgSolicitudContextRepository`, `PostgresClientRepository`, `PostgresCompanyClientRepository`, `PostgresSiteRepository`, `TransactionalAliadoRepository` y `TransactionalAliadoCategoriaRepository`.
   - En todos ellos el aislamiento por tenant depende solo del filtro `tenant_id` escrito en cada consulta.
   - Pasarlos a `runInTenantContext` es el cambio que hace efectiva la 0007. Conviene hacerlo por dominio y con su prueba `pg` de aislamiento, empezando por elegibilidad y sitios, que exponen datos a otros roles.
2. **Repositorios duplicados de cliente y sitio.** Conviven tres accesos a las mismas tablas:
   - `clienteRepository` y `sitioRepository` (Supabase): registro de cliente;
   - `clientRepository` y `siteRepository` (pg): reglas y horario del sitio;
   - `companyClientRepository` (pg): cliente empresa y sus sedes.
   Hay que unificarlos en un solo puerto de clientes y uno de sitios.
3. **`useCases/dispatch/` mezcla tres dominios:** elegibilidad, contexto de solicitud y notificaciones (`PublishNotification`, `ListNotifications`). Las notificaciones deberían vivir en `useCases/notifications/`, junto a `ListMyInbox`.
4. **`container.js` (404 líneas)** arma todos los dominios en un solo constructor. El paso siguiente es una función de composición por dominio, sin cambiar las instancias que reciben los controladores.
5. **`GET /tenants` es pública** y lista los tenants. Lo corrige SCRUM-1364; el front ya no la usa (Flutter #62).
6. **Core lee una tabla de Dispatch.** `PgElegibilidadRepository` excluye a los aliados que rechazaron la solicitud con un `NOT EXISTS` sobre `solicitud_rechazo`. La 0007 la declara de dominio de Dispatch y no le da permisos a `mani_core_svc`. Hay que decidir si Dispatch expone los rechazos por HTTP o si la tabla se comparte de forma explícita en el ADR-0030.
7. **Rol de la conexión, por confirmar con DevOps.** `withTenantContext` fija el contexto con `app.set_context`, pero no hace `SET ROLE`, y `mani_core_svc` es `NOLOGIN`. Por eso RLS solo filtra si el usuario de `DATABASE_URL` hereda ese rol y no tiene `BYPASSRLS` ni es superusuario. Con el usuario `postgres`, RLS no aplica y el aislamiento depende de los filtros `tenant_id` de cada consulta. Si en cambio hereda `mani_core_svc`, la consulta del hallazgo 6 respondería con permiso denegado.

## 5. Cómo se verificó

- **Inventario de rutas antes y después:** se recorrió la pila de Express de `src/app.js` (método, ruta con prefijo y cadena de middlewares, en orden de registro). Las dos listas tienen 105 entradas y son idénticas (`diff` sin diferencias).
- **Prueba de regresión `tests/integration/routes/routeInventory.test.js`:**
  - verifica que las 105 rutas previas siguen registradas con el mismo método y los mismos middlewares, y que ninguna queda duplicada;
  - una ruta nueva no la rompe; quitar una ruta o su `authenticate` sí (se comprobó quitándole `authenticate` a `POST /solicitudes`: la prueba falla).
- **Uso del código heredado:** `git grep` de `src/repositories/` y `src/services/` en `src/` y `tests/` solo encuentra la prueba eliminada.
- **Dependencias por caso de uso:** introspección de `container.js` (qué repositorio recibe cada caso de uso). De ahí salen los hallazgos 2 y 3.
- **Permisos de `solicitud_rechazo` y roles:** lectura de `db/migrations/0006` y `0007` y de `src/infrastructure/db/withTenantContext.js` (hallazgos 6 y 7).
- **Suite completa:** `npm test` 805 pruebas, 798 pasan, 0 fallan y 7 se omiten (las de PostgreSQL real sin `TEST_DATABASE_URL`); `npx eslint .` sin errores.
