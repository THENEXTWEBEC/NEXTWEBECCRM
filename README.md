# NEXTWEBECCRM

CRM privado y mobile-first para registrar oportunidades del equipo comercial de NextWebEC. Cada vendedor inicia sesión con su cuenta y trabaja sus propios prospectos; los permisos se verifican en PostgreSQL con Row Level Security (RLS).

## Stack y arquitectura

- Interfaz: HTML, CSS y JavaScript moderno (SPA ligera, sin compilador).
- Datos y autenticación: Supabase Auth + PostgreSQL + RLS + funciones y triggers SQL.
- Acciones privilegiadas: Supabase Edge Function `admin-users`.
- Publicación: GitHub Pages desde la rama `main` mediante `.github/workflows/deploy-pages.yml`.
- El navegador utiliza únicamente la URL del proyecto y su clave pública/anon. La clave `service_role` vive solo como secreto de Edge Functions.

## Funcionalidades disponibles

- Login por cuenta individual, panel de vendedor y panel administrativo.
- Alta atómica de prospectos con detección de duplicados por teléfono, email, dominio y empresa/contacto.
- Propietario original inmutable, reasignación administrativa auditada e ID UUID visible.
- Pipeline Kanban con arrastrar y soltar; tabla con búsqueda y filtros por estado, vendedor, servicio, fuente, fecha y seguimiento.
- Actividades, notas, fechas de seguimiento e historial automático de cambios.
- Registro de venta al ganar una oportunidad, pagos parciales y comisión del 40% sobre cobros confirmados.
- Solo administración puede registrar cobros, pagar comisiones, invitar o desactivar vendedores y archivar oportunidades.
- Exportación CSV desde la vista de oportunidades (respeta los filtros aplicados).

## Preparar Supabase

1. Crea un proyecto Supabase y activa el proveedor Email en **Authentication → Providers**.
2. En **SQL Editor**, ejecuta en orden:
   - `supabase/migrations/20260924000000_initial_schema.sql`
   - `supabase/migrations/20260924010000_crm_app_hardening.sql`
3. Crea el primer usuario administrador desde **Authentication → Users**. Luego promueve esa cuenta ejecutando, con el correo real:

   ```sql
   update public.profiles set role = 'admin' where email = 'admin@tu-dominio.com';
   ```

4. En **Authentication → URL Configuration**, establece la URL pública del CRM como Site URL y agrega esa URL y la URL local como Redirect URLs. Mantén apagado el registro público; las cuentas del equipo se invitan desde la sección **Equipo**.
5. Despliega la función administrativa:

   ```sh
   supabase login
   supabase link --project-ref TU_PROJECT_REF
   supabase functions deploy admin-users
   ```

   Supabase proporciona `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` como valores de runtime para Edge Functions. No copies la clave de servicio a GitHub ni al navegador. La función valida el JWT y el perfil administrador antes de invitar o desactivar una cuenta.

## Configuración de GitHub Pages

En **Settings → Secrets and variables → Actions**, agrega:

- Variable `SUPABASE_URL`: Project URL de Supabase.
- Secret `SUPABASE_ANON_KEY`: clave anon/publishable del proyecto.

GitHub Actions genera `runtime-config.js` durante el despliegue. Ese archivo contiene solo valores públicos; nunca pongas la clave service role aquí. Si aún no se configuran estas dos variables, la página muestra una pantalla de configuración y no simula una base de datos.

El workflow ya publica la rama `main` con GitHub Pages. La URL predeterminada para este repositorio es:

`https://infooxbarec-star.github.io/NEXTWEBECCRM/`

GitHub muestra la URL efectiva en **Settings → Pages** y en el deployment del workflow. Al conectar un dominio futuro como `crm.thenextwebec.com`, agrega un registro DNS CNAME de `crm` hacia `infooxbarec-star.github.io` y registra ese dominio en **Settings → Pages → Custom domain**. Habilita HTTPS cuando GitHub lo indique.

## Ejecutar localmente

1. Configura `supabaseUrl` y `supabaseAnonKey` en `src/config.js`, o cambia temporalmente los dos valores en `runtime-config.js`.
2. Desde este directorio inicia un servidor estático, por ejemplo:

   ```sh
   python3 -m http.server 8000
   ```

3. Abre `http://localhost:8000/` y agrega esa dirección a las Redirect URLs de Supabase.

La aplicación importa `@supabase/supabase-js` desde `esm.sh`; se necesita conexión a internet para cargar la interfaz y acceder a Supabase.

## Seguridad y propiedad de leads

- `profiles.role` y `profiles.is_active` no son editables desde el navegador; solo la Edge Function administra las cuentas.
- RLS filtra leads por `owner_id`; administración puede ver y reasignar todos. La API tampoco concede lectura de leads ajenos a un vendedor.
- La migración revoca inserciones directas en `leads`. La función `create_lead_if_unique` toma un bloqueo transaccional, busca duplicados y crea el prospecto en una sola operación para evitar carreras entre dos vendedores.
- La respuesta de duplicados revela solo empresa, propietario, fecha, estado y el tipo de coincidencia.
- `created_by`, `created_at` y `original_owner_id` se fijan en la base y no se pueden cambiar. Toda reasignación queda en `lead_audit_log`.
- Los pagos de clientes requieren rol administrador en RLS. Cada inserción recalcula el total cobrado y genera una comisión acumulada de `40% × cobros`.
- El vendedor puede consultar su comisión, pero solo administración puede escribir `paid_amount`. Leads se archivan con `deleted_at`; no se borran físicamente.

## Tablas

`profiles`, `services`, `leads`, `activities`, `sales`, `payments`, `commissions`, `lead_status_history` y `lead_audit_log`. El primer administrador se crea en Supabase Auth y los vendedores se invitan desde la aplicación.

## Esquema inicial y comisión

Al marcar una oportunidad como ganada, se registra el valor final del proyecto en `sales`. Los cobros parciales se agregan en `payments`. Después de cada cobro, un trigger suma los movimientos y fija `commissions.generated_amount` en el 40% cobrado, de manera acumulativa. Por ejemplo, dos cobros de $500 en un proyecto de $1.000 generan $200 y luego $400 de comisión total. La comisión pagada se mantiene separada y solo administración puede confirmarla.

## Verificación antes de habilitar al equipo

Después de aplicar las migraciones y configurar Supabase, verifica con cuentas de prueba separadas:

1. Vendedor A crea “ACME Ecuador” con teléfono `0999999999`; el registro conserva su usuario y hora.
2. Vendedor B intenta crear el mismo teléfono y ve propietario, fecha y estado del registro existente.
3. Administración reasigna la oportunidad y la auditoría registra el cambio, manteniendo el creador original.
4. En un proyecto ganado de $1.000, administración registra $500 y comprueba $200 de comisión y $500 de saldo; otro cobro de $500 eleva la comisión a $400.
5. Un vendedor no puede crear cobros, alterar comisiones ni leer por API el lead ajeno. Estas reglas están en RLS y triggers, además de la interfaz.

## Variables de entorno

Consulta `.env.example` para las variables públicas del frontend y la clave de servicio estrictamente del servidor. No versionar secretos reales ni usar la clave de servicio en `src/config.js` o `runtime-config.js`.
