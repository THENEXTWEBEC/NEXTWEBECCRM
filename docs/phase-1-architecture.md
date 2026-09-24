# Arquitectura y despliegue de NEXTWEBECCRM

Este documento resume la arquitectura que usa la aplicación. La guía operativa, las instrucciones de configuración y los casos de verificación están en el [README](../README.md).

## Componentes

```text
GitHub Pages (HTML, CSS y módulos ES)
       │ URL + clave pública + JWT de usuario
       ▼
Supabase Auth ── PostgreSQL, RLS, triggers y auditoría
       ▲
       └── Edge Function admin-users
             clave service role solo del lado servidor
```

La interfaz usa `@supabase/supabase-js` desde esm.sh y recibe sus valores públicos mediante `runtime-config.js`, generado durante el despliegue. Nunca se publica una clave `service_role`.

## Migraciones

Aplica las migraciones en orden:

1. `supabase/migrations/20260924000000_initial_schema.sql`
2. `supabase/migrations/20260924010000_crm_app_hardening.sql`

La segunda migración guarda el propietario original, añade la función transaccional de creación sin duplicados, el archivado lógico, los estados y campos adicionales y limita los cobros de clientes a administradores.

## Acceso y propiedad

- Supabase Auth mantiene cuentas individuales. Los perfiles se crean desde un trigger de `auth.users`.
- `admin-users` valida la sesión y el rol antes de invitar o desactivar cuentas usando la clave privilegiada.
- RLS filtra las oportunidades por responsable y reserva la vista global para administración.
- `create_lead_if_unique` serializa altas, comprueba coincidencias y crea la oportunidad dentro de la misma transacción. Esto evita que dos vendedores creen simultáneamente el mismo prospecto.
- La base define creador, hora original y propietario original; la interfaz solo los presenta. Reasignar cambia el responsable actual y genera una fila en `lead_audit_log`.
- `payments` es de escritura administrativa. Un trigger actualiza los cobros acumulados y la comisión al 40%; los vendedores no pueden alterar el monto pagado de sus comisiones.

## Publicación

El workflow `.github/workflows/deploy-pages.yml` comprueba la sintaxis de la aplicación y publica el directorio raíz con GitHub Pages después de cada push a `main`. Configura `SUPABASE_URL` como variable y `SUPABASE_ANON_KEY` como secreto de Actions para conectar la aplicación publicada. Los pasos de configuración están en el README.
