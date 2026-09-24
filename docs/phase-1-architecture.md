# NextWebEC CRM — Fase 1

## Decisiones de arquitectura

El CRM será una SPA estática, *mobile-first*, publicada en GitHub Pages. HTML5, CSS3 y módulos ES nativos mantienen la interfaz rápida y sin framework. El navegador usa `@supabase/supabase-js` solamente con la URL y la clave pública/anon; la base de datos y Supabase Auth protegen cada operación con RLS.

```
GitHub Pages (HTML / CSS / ES modules)
        │  Supabase anon key + JWT del usuario
        ▼
Supabase Auth ──► Postgres + RLS + triggers + auditoría
        ▲
        └── Edge Functions (crear/desactivar usuarios y acciones administrativas)
              service_role solo como secreto del servidor
```

La clave `service_role` no se expone nunca al repositorio, al navegador ni a GitHub Pages. Las operaciones de administración de usuarios pasan por una Edge Function que valida que quien llama sea administrador antes de invocar la API administrativa de Auth.

## Estructura propuesta

```
.
├── index.html
├── login.html
├── assets/
│   ├── icons/
│   └── styles/             # tokens, reset, layout, componentes y responsive
├── src/
│   ├── app.js              # bootstrap, sesión y routing ligero
│   ├── config.js            # lee solo URL y anon key inyectadas en build
│   ├── lib/supabase.js
│   ├── services/            # llamadas por dominio: leads, activities, sales…
│   ├── views/               # una vista por módulo de navegación
│   ├── components/          # sidebar, modal, cards, tablas, kanban
│   └── utils/               # formato, validación, fechas y permisos de UI
├── supabase/
│   ├── migrations/
│   └── functions/admin-users/
├── docs/
└── .env.example
```

La UI oculta los módulos exclusivos de administración, pero esa no es una barrera de seguridad: los permisos reales viven en las políticas de la migración.

## Modelo de datos

| Dominio | Tabla | Responsabilidad |
| --- | --- | --- |
| Identidad | `profiles` | Extiende `auth.users` con rol y estado activo. |
| Catálogo | `services` | Servicios y precios editables por administración. |
| CRM | `leads` | Prospecto, responsable, pipeline, próxima acción y metadatos. |
| Seguimiento | `activities` | Llamadas, WhatsApp, emails, reuniones, notas y tareas. |
| Venta | `sales`, `payments` | Venta ganada y cobros inmutables. |
| Comisión | `commissions` | 40% de lo efectivamente cobrado, con pagos de comisión. |
| Auditoría | `lead_status_history`, `lead_audit_log` | Transiciones y una imagen antes/después de cada cambio. |

`leads.id` es UUID para relaciones y `lead_number` es un número consecutivo legible para el equipo. Una venta corresponde a un lead ganado; una venta admite múltiples cobros. El trigger de pagos recalcula el valor cobrado y crea/actualiza la comisión: `round(total_cobrado * 0.40, 2)`.

## Aplicar la migración

1. Crea un proyecto de Supabase y habilita el proveedor **Email**.
2. Ejecuta [20260924000000_initial_schema.sql](../supabase/migrations/20260924000000_initial_schema.sql) en SQL Editor, o instala la CLI e inicia el proyecto para aplicar `supabase db push`.
3. Crea el primer usuario desde **Authentication → Users**. Tras la creación, promueve exactamente esa cuenta con el `UPDATE` comentado al final de la migración, sustituyendo el correo.
4. En **Authentication → URL Configuration**, agrega la URL de GitHub Pages como Site URL y Redirect URL. Agrega también `http://localhost:<puerto>` para desarrollo.
5. Copia solo Project URL y anon/publishable key a las variables de despliegue. No versionar `.env`.

La confirmación de correo debe permanecer activa en producción. Para un CRM interno, conviene desactivar el registro público: los nuevos usuarios se crean desde una Edge Function protegida por el rol administrador.

## Autenticación y usuarios

El login de Fase 2 utilizará `signInWithPassword({ email, password })` y restaurará la sesión con `onAuthStateChange`. Los ejecutivos no crean cuentas por sí mismos. La función `admin-users` deberá:

1. Leer el JWT del `Authorization` header y confirmar que su perfil tiene `role = 'admin'` e `is_active = true`.
2. Usar el secreto `SUPABASE_SERVICE_ROLE_KEY` únicamente dentro de la Edge Function para invitar/crear o bloquear un usuario de Auth.
3. Dejar que `on_auth_user_created` cree el perfil de ejecutivo; la función actualiza su nombre/rol solo cuando proceda.
4. Para desactivar, marcar `profiles.is_active = false` y bloquear al usuario en Auth para invalidar futuras sesiones.

No se puede administrar `auth.users` directamente desde GitHub Pages aunque la persona sea administradora: la API de administración requiere la clave `service_role`.

## RLS y garantías clave

Las funciones `is_active_user()` e `is_admin()` se ejecutan con un `search_path` fijo y se basan en `auth.uid()`. Todas las tablas de aplicación tienen RLS activo.

- Un ejecutivo puede consultar y modificar solamente leads cuyo `owner_id` sea su propio usuario; un administrador puede ver todos.
- Al crear un lead, el trigger toma `created_by` y `updated_by` desde el JWT. En una actualización vuelve a fijar `updated_by`.
- El trigger rechaza cualquier cambio de `owner_id` realizado por un ejecutivo, incluso si la UI se manipula. Solo administración puede reasignar.
- Los cambios de estado, creador, antes/después y actor se guardan automáticamente en registros de auditoría sin permisos directos de escritura para el navegador.
- Actividades, ventas, pagos y comisiones se filtran mediante el dueño del lead/venta. Los pagos no se editan ni borran desde la aplicación: una corrección debe ser un nuevo movimiento administrativo, para conservar trazabilidad.
- Los permisos SQL por columna impiden elevar rol, desactivar cuentas, falsificar campos de auditoría o alterar manualmente importes recaudados.

## Prueba obligatoria de aislamiento (Fase 4)

Crear dos cuentas ejecutivas, A y B. Con cada JWT comprobar:

1. A crea un lead y recibe un resultado al consultarlo.
2. B recibe una lista vacía al consultar ese ID.
3. B recibe error/0 filas al intentar actualizar el lead de A, incluido cambiar `owner_id`.
4. A puede crear una actividad y un cobro asociados a su propio lead/venta; B no.
5. Un administrador puede ver y reasignar el lead, y los registros de auditoría reflejan su UUID.

Estas verificaciones se automatizarán con dos sesiones de prueba reales antes de cerrar la Fase 4.
