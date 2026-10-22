# AGENTS.md — MANI-Node (Core Backend)

Bienvenido al repositorio **MANI-Node**. Este archivo define el rol y las directrices operativas de IA y desarrollo para el servicio Core Backend del ecosistema MANI.

---

## 1. Rol y Responsabilidad del Repositorio
* **Tecnología:** Node.js (Express / Clean Architecture).
* **Puerto:** `3000` (interno).
* **Dominio Funcional:** Núcleo de negocio operativo:
  - Gestión y autenticación de usuarios (Clientes, Aliados, Admins).
  - Multi-tenancy (aislamiento lógico de organizaciones).
  - Verificación KYC y documentación de profesionales.
  - Catálogos de servicios y perfiles.
  - Orquestación con la base de datos principal (PostgreSQL / Supabase).

---

## 2. Topología de Comunicación y API Gateway

```
[ MANI-Flutter ] 
       │
       ▼ (Peticiones al puerto 80)
[ MANI-APIGateway ]
       │
       ▼ (/api/v1/core/* ──> puerto 3000)
[ MANI-Node ] ───(HTTP)───> [ MANI-Rules-Java ] (:8080)
       │
       └───(HTTP)──────────> [ MANI-Dispatch-DotNet ] (:5000)
```

### Relación con otros repositorios:
1. **`MANI-APIGateway`:** Es el **único punto de entrada** de tráfico externo hacia este servicio. NGINX reenvía las rutas `/api/v1/core/*` hacia el puerto `3000` de este contenedor. **Ningún cliente frontend debe conectarse directamente a este servicio sin pasar por el Gateway.**
2. **`MANI-Rules-Java`:** Invocado internamente (`http://rules-service:8080/api/v1/rules/*`) cuando el core requiere validar tarifarios, rangos de precio o evaluar condiciones de validación complejas.
3. **`MANI-Dispatch-DotNet`:** Invocado internamente (`http://dispatch-service:5000/api/v1/dispatch/*`) para sincronizar estados de solicitudes una vez formalizadas.
4. **`MANI-Flutter`:** Consumidor indirecto a través del Gateway.

---

## 3. Protocolos y Encabezados Requeridos
* **`Authorization`:** Debe recibir `Bearer <JWT>`. Los endpoints protegidos extraen el `user_id` y `tenant_id` para cumplir con las políticas de aislamiento.
* **`X-Correlation-ID`:** Encabezado propagado desde el Gateway para mantener la trazabilidad distribuida de cada solicitud.
* **Formato:** Todas las respuestas deben ser JSON estándar con códigos de estado HTTP semánticos (200, 201, 400, 401, 403, 404, 409, 500).

---

## 4. Comandos de Desarrollo
```bash
# Instalar dependencias
npm install

# Iniciar servidor en desarrollo
npm run dev

# Ejecutar el linter
npm run lint

# Ejecutar pruebas (unitarias e integración)
npm test
```

## 5. Estructura de Carpetas
```
src/
  app.js            # Construcción de la app Express (sin listen, usada en tests)
  server.js         # Punto de entrada: carga env y arranca el servidor
  config/           # Lectura centralizada de variables de entorno
  routes/           # Enrutamiento HTTP
  controllers/      # Orquestación de la petición/respuesta HTTP
  services/         # Lógica de dominio del core
  repositories/      # Acceso a datos (PostgreSQL/Supabase)
  middlewares/       # Correlation-ID, manejo de errores, etc.
tests/
  unit/             # Pruebas de servicios sin HTTP
  integration/      # Pruebas de rutas vía supertest
```

---

## Autoría y atribución (obligatorio)

**El entregable lo firma la persona que lo presenta.** No se añaden líneas de coautoría, firmas, pies ni emojis que atribuyan el trabajo a una herramienta de IA, ni en commits, Pull Requests, documentos, código o comentarios. Tampoco se firma un documento o un ADR como autor: ese campo lleva el nombre de la persona responsable.

Regla vigente: `MANI-Docs` → [`governance/POLITICAS_DEVOPS_HERRAMIENTAS.md`](https://github.com/Trama-AS/MANI-docs/blob/main/governance/POLITICAS_DEVOPS_HERRAMIENTAS.md) §18.7 y [`wiki/05-proceso/trabajo-con-ia.md`](https://github.com/Trama-AS/MANI-docs/blob/main/wiki/05-proceso/trabajo-con-ia.md).

Por qué, para no revertirla «mejorando»: la política §18.1 ya exige revisión humana de todo resultado, y esa revisión es la garantía; §18.5 dice que una respuesta de IA no es una decisión arquitectónica, así que atribuirle autoría la contradice. La trazabilidad del cambio la dan el identificador de Jira, la rama, el PR y el historial de Git, que sí dicen qué cambió, por qué y quién lo aprobó.

Lo que sí se registra es el **método de verificación** —el comando ejecutado y su resultado, el archivo comparado, la consulta hecha—, no la herramienta que ayudó a escribirlo.

Si encuentras una atribución de ese tipo en un archivo que ya estás editando, quítala.
