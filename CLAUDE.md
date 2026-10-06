# CLAUDE.md — Guía de Desarrollo para MANI-Node

Este documento sintetiza las reglas de arquitectura y patrones de código para trabajar en el backend Core de MANI.

---

## 1. Contexto de Arquitectura
* **Microservicio:** Core de Negocio (Node.js).
* **Consumidores:** Peticiones HTTP provenientes de **`MANI-APIGateway`** (rutas `/api/v1/core/*`).
* **Interacción con otros servicios:**
  - Consume reglas de negocio de **`MANI-Rules-Java`** vía llamadas REST internas.
  - Interactúa con **`MANI-Dispatch-DotNet`** para flujos de órdenes y asignación.
* **Persistencia:** Conexión a PostgreSQL (Supabase) con validación estricta de tenant en cada consulta.

---

## 2. Convenciones de Código y Clean Architecture
* **Regla de Dependencia:** Las dependencias del código fuente apuntan exclusivamente hacia adentro (Dominio <- Aplicación <- Infraestructura / Interfaces).
* **Capas (Clean Architecture):**
  - `domain/`: Entidades de negocio puras (`entities/`), errores de dominio (`errors/`) y contratos/puertos de repositorios y servicios (`ports/`). Sin dependencias externas ni de frameworks.
  - `application/`: Casos de uso (`useCases/`) que orquestan las reglas de aplicación recibiendo dependencias por inyección (DIP).
  - `infrastructure/`: Implementaciones concretas de persistencia (`repositories/`), clientes de red y seguridad (`security/`).
  - `controllers/` & `routes/` & `middlewares/`: Adaptadores de interfaz HTTP. Extraen DTOs de las peticiones, invocan los casos de uso y traducen errores de dominio a respuestas HTTP semánticas.
  - `container.js`: Composition Root para resolución e inyección de dependencias (IoC/DIP).
* **Manejo de Errores:** Errores de dominio tipados (`NotFoundError`, `UnauthorizedError`, `ValidationError`) mapeados en `errorHandler` a respuestas `{ error: string, code?: string, correlationId: string }`.
* **Variables de Entorno:** Todas las URLs de servicios externos y credenciales se leen exclusivamente desde `process.env` vía `config/`.

