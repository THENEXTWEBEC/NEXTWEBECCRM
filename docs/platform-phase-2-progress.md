# NEXTWEBECCRM 2.0 — avance de la primera ampliación

## Diagnóstico previo

El repositorio ya implementaba Node.js 22, Express, SQLite con WAL y claves foráneas, sesiones SQLite, roles administrador/comercial, pipeline, actividad, seguimientos, ventas, cobros parciales, comisiones con tasa histórica, reversos auditados y respaldo antes de migraciones. Se conservó esa arquitectura y sus datos. La copia de trabajo contiene cambios locales previos ajenos a esta ampliación; no se descartaron ni se incluyeron en un commit.

Faltaban entidades independientes de cliente, cotización y proyecto. La venta existente representa el valor contratado y sus cobros confirmados; no equivale a una factura electrónica. La fase añadida no modifica ese cálculo financiero.

## Migración 008

Agrega `clients`, `client_leads`, `quotes`, `quote_items`, `quote_counters`, `projects` y `platform_audit`, con claves foráneas e índices, y una referencia opcional de venta a cotización. Añade cinco servicios del catálogo solicitado sin cambiar precios o nombres existentes. Crea un proyecto para cada venta histórica con un cobro confirmado; conserva ventas, cobros, usuarios, actividad, comisiones y seguimientos. No fusiona automáticamente clientes históricos por similitud de nombre.

El migrador actual crea y verifica un respaldo antes de ejecutar 008. La migración se ejecuta dentro de una transacción. En una copia local histórica se verificó `integrity_check=ok`, cero errores de claves foráneas y la conservación de los recuentos de ocho tablas anteriores. Esa copia no sustituye una prueba con la base de staging.

## Flujos implementados

- Una oportunidad puede vincularse a una ficha nueva de cliente o a una ficha existente. La identificación y el correo bloquean una creación duplicada; el enlace se registra en auditoría.
- Las cotizaciones almacenan conceptos, cantidades, importes en centavos, descuento, impuesto, anticipo, vigencia, condiciones y observaciones. El número se asigna transaccionalmente. El backend genera un PDF real, con páginas adicionales si el contenido lo requiere.
- El estado avanza borrador → enviada → aceptada o rechazada. Una aceptada vinculada a una oportunidad se puede convertir en venta. La conversión repetida devuelve la venta existente si coincide el importe.
- Un proyecto se crea al alcanzar el anticipo acordado en una cotización aceptada. Para ventas sin cotización aceptada, se crea con el primer cobro confirmado. Los estados operativos del proyecto se mantienen separados de las etapas comerciales.
- Administración ve todos los clientes, cotizaciones y proyectos. Un ejecutivo solo ve registros vinculados a sus oportunidades activas; los importes del cliente compartido se calculan con ese mismo alcance.
- La eliminación o reapertura administrativa de una venta archiva la instantánea del proyecto antes de retirarlo. La eliminación de una oportunidad vinculada a cliente o cotización queda bloqueada.

## Validación

- `npm run check`: sintaxis de servidor, cliente y módulo nuevo.
- `npm test`: migraciones y lógica anterior, flujo HTTP de $1.200 con dos cobros de $600 y comisión de $480, permisos, idempotencia, cliente compartido, cotización, conversión, umbral de anticipo y PDF multipágina.
- Prueba manual local: creación de oportunidad, vinculación de cliente, cotización, estados y conversión. El PDF de una y tres páginas se abrió y renderizó. Se corrigió la fuente serif accidental de encabezados.

## Pendiente antes de considerar la plataforma terminada

Facturación interna y electrónica SRI, aplicaciones de cobros por factura, contratos y documentos con almacenamiento seguro, gastos, mantenimiento recurrente, tareas de proyecto, automatizaciones, reportes, rol de operaciones, dashboard financiero por período, diseño móvil completo y QA de accesibilidad. El PDF usa tipografía estándar del formato; falta incorporar la fuente de marca Inter y una plantilla comercial aprobada. No hay configuración de staging en esta copia. No se desplegó esta fase ni se verificó con datos de Render.

Antes de desplegar: respaldar y verificar la base real, probar 008 en una copia de staging, revisar datos históricos y confirmar la ruta del disco persistente. El despliegue en producción requiere autorización expresa.
