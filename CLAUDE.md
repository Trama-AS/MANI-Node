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

## 2. Convenciones de Código
* **Capas (Layered Architecture):**
  - `routes/`: Enrutamiento y validación básica de esquemas de entrada.
  - `controllers/`: Orquestación de llamadas y códigos de respuesta HTTP.
  - `services/`: Lógica de dominio y reglas de core.
  - `repositories/`: Acceso a la base de datos (PostgreSQL/Supabase).
* **Manejo de Errores:** Errores tipados y controlados retornando `{ error: string, code?: string, correlationId: string }`.
* **Variables de Entorno:** Todas las URLs de servicios externos y credenciales se leen exclusivamente desde `process.env`.
