# Corrección financiera y despliegue

Estado: implementación local; publicación y validación con datos de producción pendientes. No se ejecutó ninguna operación en producción. Pepitos Grill solo se creó en una base temporal para pruebas. El ID real todavía no está verificado.

## Auditoría previa

Se inspeccionaron estructura, migraciones, API, sesión, cálculos, interfaz y pruebas antes de editar. Oportunidades: leads, archivo por deleted_at; ventas: sales (una por lead); cobros: payments; comisiones: commissions; pagos: commission_payouts; usuarios: users; actividad: activities; seguimiento: followups; historial: lead_status_history y lead_audit_log. SQLite usa claves foráneas, WAL y timeout. Autenticación: bcrypt, sesión SQLite, cookie HTTP-only, permisos consultados en users en cada petición. API existente: /api/auth/*, /api/data/:name, /api/rpc/:name y /api/admin/*. Dashboard consume workspace y financialSummary; cobros confirmados generan comisión según commissions.rate, guardada al cerrar la venta.

El módulo tenía pagos acumulados sin reversión; PATCH de cobros cancelaba sin motivo; DELETE bloqueaba incluso movimientos cancelados. Se conservó la tasa general y las tasas históricas. Los archivos heredados con cambios pendientes no se incluyeron como parte de esta corrección.

## Archivos de esta corrección

- server/migrations/004_financial_reversals.sql: metadatos de anulación, referencias únicas de pago y archivo administrativo financiero.
- server/db.mjs: comprobación integral y referencial de respaldos antes de migrar.
- server/index.mjs: endpoints, permisos, transacciones, archivo y eliminación.
- src/api.js: acceso a endpoints especializados.
- src/app.js: detalle, pagos, anulaciones, motivo obligatorio y vista previa de eliminación.
- tests/crm.test.mjs y tests/migration.test.mjs: integración y migración.
- docs/financial-reversals.md: esta entrega.

## Endpoints

- GET /api/commissions/:id/detail: propietario de comisión o administrador; venta, cobros, pagos e historial.
- POST /api/admin/commissions/:id/payouts: amount, paid_at y request_key obligatorio; reintentar la misma referencia no duplica pagos.
- POST /api/admin/commission-payouts/:id/void: reason (3–1000 caracteres), confirm:true.
- POST /api/admin/payments/:id/void: mismo formato; bloquea cobros confirmados mientras existan pagos de comisión válidos de la venta.
- GET /api/admin/leads/:id/deletion-preview: ID, empresa, venta, movimientos y posibilidad de eliminación; solo lectura.
- DELETE /api/admin/leads/:id: confirm_name exacto, archivada y sin movimientos activos. Respaldo verificado y validación repetida dentro de la transacción. Conserva snapshot financiero y auditoría en financial_archive, fuera de reportes; elimina relaciones operativas sin huérfanos.
- PATCH /api/data/payments/:id: confirmación existente; cancelaciones deben utilizar la nueva anulación con motivo.

Las anulaciones duplicadas devuelven error sin alterar importes. Nuevos pagos y anulaciones usan transacciones inmediatas; errores revierten toda la operación. Pendientes no generan comisión pero bloquean eliminación hasta anularse. El archivo administrativo conserva los datos financieros históricos; no representa una eliminación de evidencia contable. No se aplicó una política de retención legal no especificada.

## Respaldo y pruebas

Respaldo local previo: data/backups/nextwebec-20261013T140836Z.db. integrity_check=ok y foreign_key_check sin filas. No es un respaldo de producción. Cada migración posterior al esquema inicial crea su propio respaldo verificado; cada eliminación también.

Ejecutar npm run check y npm test con Node 22 y dependencias instaladas. Cuatro suites: integración HTTP, dominio/fechas, renderizado y migración. La integración cubre $450 de cobro, $180 de pago al 40%, bloqueos, motivos, permisos, reintentos, reversión, saldo $450, comisión $0, archivo de evidencia y eliminación; compara listas y ventas de IceMan/RUBA y todos los totales previos con los posteriores. Usa únicamente base temporal. La migración preserva pagos históricos y tasas y valida claves foráneas. Renderizado no reemplaza QA visual ni verificación en producción.

## Publicar en Render

1. Iniciar sesión en el servicio srv-davfk66k1f9s73a520tg. Anotar rama, commit, DATABASE_PATH y disco persistente actuales, sin exponer secretos. No cambiar ruta de la base ni sustituir archivos.
2. Antes de publicar, descargar respaldo desde Configuración → Descargar respaldo SQLite y conservarlo fuera del servicio. Verificarlo sobre una copia con integrity_check y foreign_key_check; detener el despliegue si falla.
3. Confirmar que DATABASE_PATH apunta a la base existente dentro del disco persistente. Render pierde cambios fuera del disco al desplegar. Si no hay disco persistente, detenerse y preservar primero los datos existentes: no desplegar sobre almacenamiento efímero.
4. Publicar únicamente los archivos de esta corrección en una rama/PR revisable. No subir data/, respaldos, .env ni cambios heredados ajenos. Ejecutar npm ci, npm run check y npm test en Node 22 antes de integrar la rama publicada.
5. En Render usar Manual Deploy → Deploy latest commit después de integrar la corrección en la rama configurada. Mantener Dockerfile, variables, disco y base existentes. Docker ejecuta npm start; migrate() aplica 004 al iniciar y crea/verifica una copia antes de ejecutarla. No ejecutar migración en pre-deploy: el disco no está disponible allí.
6. Verificar logs, /api/health, inicio de sesión, detalle de comisiones, vista previa, datos de IceMan/RUBA y diagnóstico financiero. Revisar escritorio y móvil. No registrar pagos ficticios para verificar producción.
7. Si falla la migración, detener y revisar; no reemplazar la base con desarrollo. No restaurar un respaldo antiguo sobre transacciones nuevas sin un procedimiento de conciliación. El código anterior no entiende las anulaciones de pagos: después de utilizar esta versión, cualquier rollback necesita revisar compatibilidad financiera.

Fuentes: https://render.com/docs/disks ; https://render.com/docs/deploys ; https://render.com/docs/docker

## Pepitos Grill: procedimiento con confirmación humana

1. Administrador: Comisiones → Pepitos Grill → Ver detalle. Registrar ID de oportunidad, venta, comisión, cobro y pago. Comprobar empresa, colaborador Consuelo Mora, venta/cobro $450, tasa 40%, comisión/pago $180 y archivo. Si hay duplicados o discrepancias, detenerse.
2. Presentar esos IDs y movimientos al administrador y obtener confirmación explícita de que son pruebas. Nada de este procedimiento se ejecuta automáticamente.
3. En el detalle de comisión, Anular pago en el movimiento de $180. Escribir motivo, marcar confirmación y guardar. Pagada debe quedar $0; generada todavía $180.
4. Ver oportunidad y cobros → Anular sobre el cobro de $450, motivo obligatorio y confirmación. Generada, pagada y pendiente de comisión deben ser $0; cobrado $0 y saldo de venta $450. El saldo de una venta anulada sigue siendo su valor hasta eliminar la oportunidad.
5. Archivados → Eliminar definitivamente presenta la vista previa con ID y movimientos. Comprobar que no quedan movimientos activos. Si existen cobros pendientes o pagos adicionales, revisarlos y anular solo los incorrectos.
6. Solicitar confirmación explícita de la eliminación irreversible. Escribir Pepitos Grill y pulsar Eliminar definitivamente. Se verifica respaldo y se archiva la evidencia anulada en una transacción.
7. Verificar ausencia en listas, archivados, ventas, comisiones y estadísticas. Si no existen otras comisiones, los tres indicadores deben mostrar $0. Comparar IceMan/RUBA y usuarios/configuración con el respaldo: deben conservarse.

Pendiente: validar estos flujos en navegador sobre la versión desplegada, identificar ID real y ejecutar procedimiento solo tras confirmación. No declarar completada la intervención de producción antes de ello.
