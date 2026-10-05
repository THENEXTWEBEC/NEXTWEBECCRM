# Auditoría integral NEXTWEBECCRM — 5 octubre 2026

Revisión realizada antes de modificar el flujo integral. Se conserva Express, SQLite, JavaScript y el diseño actual.

## Hallazgos y correcciones planificadas

1. Seguimientos: actividades tipo task y campos next_action compiten como fuentes; no hay estados ni finalización. Crear tabla relacionada y migrar registros existentes sin borrar el historial.
2. Ganado: frontend ejecuta PATCH + INSERT y revierte manualmente; puede dejar ventas inconsistentes. Unificar cierre y valor final en transacción del servidor.
3. Finanzas: ventas sumadas sin estado actual de oportunidad; archivados mantienen ventas, pero la tarjeta activa no explica el alcance. Centralizar agregados en servidor y distinguir vendido, cobrado, saldo y comisiones.
4. Cobros: todos afectan dinero y comisión, sin pendiente/cancelado; no hay actividad de cobro. Introducir estados y recomputación atómica con snapshot de tasa, rechazo de exceso y protección de comisiones pagadas.
5. Comisión: rate existe pero se ignora en el cálculo (40% fijo). Configuración para nuevas ventas, conservando tasas históricas.
6. Estados: frontend/backend repiten listas y awaiting_payment añade un estado no oficial. Una definición compartida; migrar el estado legado a negociación con auditoría.
7. Fechas: datetime-local convertido según ordenador del usuario. Convertir explícitamente Ecuador (UTC-5), presentar America/Guayaquil.
8. Seguridad: sesiones SQLite, bcrypt, Helmet, cookie y rate-limit existentes son adecuados. Falta validación exhaustiva, permisos SQL antes de LIMIT, protección CSRF de requests sin Origin y atomicidad en PATCH.
9. Propiedad: autoría histórica conservada; creación fija propietario al autor incluso administrador. Permitir asignación administrativa validada sin alterar created_by/original_owner_id.
10. Duplicados: coincidencia fuerte de teléfono/email/web bloqueada; empresa con diferente contacto no advierte. Aviso de empresa débil confirmable y enlace únicamente si permisos permiten abrir.
11. UX: ficha omite contexto, formularios largos; Dashboard no prioriza tareas y no hay Mi día. Añadir acciones cortas y próximas acciones conectadas.
12. Responsive: Kanban repite 8 columnas para 10 estados, grid del Dashboard inline conserva 2 columnas móvil, menú oculta configuración administrativa, modales sin semántica/foco. Corregir sin rediseño.
13. Rendimiento: N+1 en relaciones y permisos, LIMIT global previo a permisos, recargas con pantalla completa. Relaciones precargadas y filtros SQL por usuario; bootstrap coherente y detalle acotado.
14. SQLite: WAL, claves foráneas, busy_timeout=5000 ya habilitados. Motor de migraciones solo aplica 001; implementar migraciones ordenadas y atómicas, índices por estado/fecha/relación.
15. Duplicación $2400: sales.lead_id y commissions.sale_id tienen UNIQUE, y consultas sales no tienen joins que multipliquen filas. No es posible certificar causa en producción sin acceso a sus datos. Informe administrativo de ventas, estado, archivado y potenciales coincidencias; no eliminar datos.

## Conservación y límites

No se modificarán archivos sources ni la carpeta original. No borrar ventas, contactos, sesiones, cobros, actividad ni comisiones. Los cambios se prueban con bases temporales. No cargar pruebas Iceman en producción. Acceso al panel Render bloqueado por política del navegador; publicar y verificar Live son pasos distintos.

## Validación requerida

Migración repetible con datos legados; login y permisos por rol; cierre atómico; seguimiento y actividad; reasignación sin reescribir autores; cobros pending/confirmed/cancelled; snapshot de tasa; Iceman 1200 → 600/240 → pago comisión → segundo 600/480; rollback ante sobrecobro/cancelación inválida; archivado/restaurado; CSRF; fechas Ecuador; dashboard y Mi día; responsive y flujos de navegador cuando la herramienta lo permita.

## Resultado de implementación

Flujos conectados mediante bootstrap transaccional, definición única de estados y servicio de operaciones comerciales/financieras. Migración no destructiva con backup automático previo. Validación automatizada de flujo HTTP, Iceman, permisos, idempotencia de cobros, rollback, duplicados débiles/fuertes, migración repetida, fechas Ecuador y renderizado. La revisión del navegador real y el diagnóstico de datos en Render siguen pendientes por bloqueo de la herramienta; no se certifica producción ni se eliminan registros.
