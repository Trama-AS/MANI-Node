# Guía de Contribución

Para mantener la trazabilidad automatizada con Jira, todo el desarrollo en este repositorio debe seguir estrictamente la siguiente convención de nombres.

## Convención Obligatoria (SCRUM-<id>)

Cada tarea, error o historia de usuario tiene un ID asociado en Jira (por ejemplo, `SCRUM-452`). Este ID debe usarse obligatoriamente en los siguientes lugares:

1. **Nombre de la Rama (Branch Name):**
   Las ramas deben incluir el ID del ticket.
   * ✅ Correcto: `feature/SCRUM-452-gestion-usuarios`
   * ❌ Incorrecto: `feature/gestion-usuarios`

2. **Mensajes de Commit (Commit Messages):**
   El mensaje de cada commit debe empezar obligatoriamente con el ID del ticket al inicio.
   * ✅ Correcto: `[SCRUM-452] Agrega endpoint para gestion de usuarios`
   * ❌ Incorrecto: `Agrega endpoint para gestion de usuarios`

3. **Título del Pull Request (PR Title):**
   El título del PR debe incluir el ID del ticket para que Jira pueda enlazarlo y hacer la transición de estados automáticamente en el panel de desarrollo.
   * ✅ Correcto: `[SCRUM-452] Implementación de Gestión de Usuarios`
   * ❌ Incorrecto: `Implementación de Gestión de Usuarios`

### Smart Commits
Este repositorio tiene habilitados los **Smart Commits** de Jira. Puedes realizar acciones en Jira directamente desde tus mensajes de commit añadiendo comandos especiales.
Ejemplo:
`[SCRUM-452] #resolve #time 2h` -> Esto enlazará el commit, marcará la tarea como resuelta y registrará 2 horas de trabajo en Jira de forma automática.
