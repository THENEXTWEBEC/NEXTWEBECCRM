# NEXTWEBECCRM — avance de capas financieras

## Implementado en esta fase

- Migraciones `013_treasury_planning.sql`, `014_finance_targets_alerts.sql` y `015_receivable_due_dates.sql`: cuentas USD bancarias/caja con saldo inicial fechado; movimientos con origen único, clave idempotente, cuenta, conciliación y anulación auditada; configuración e historial de distribuciones; escenarios guardados; reglas e historial de alertas.
- El libro toma cobros de ventas y mantenimientos, pagos de gastos y pagos de comisiones desde sus tablas de origen. La lectura sincroniza con `INSERT OR IGNORE`; una anulación en el registro de origen marca el asiento espejo como anulado. Los movimientos históricos empiezan sin cuenta asignada.
- La disponibilidad queda marcada incompleta si faltan cuentas/saldos iniciales, movimientos asignados o conciliaciones posteriores a la fecha de apertura. El saldo inicial es el ancla y los movimientos anteriores a esa fecha no se suman otra vez.
- La vista Finanzas permite filtrar por mes, crear cuenta, registrar saldo inicial, conciliar movimientos y exportar CSV/PDF. El servidor valida roles de administración en las rutas nuevas.
- Distribuciones mensuales: configuración de cinco categorías con validación de 100%, vista previa, confirmación única por período e historial/anulación auditada. Bloquea cuando la caja no está verificada. La provisión tributaria se etiqueta como estimación operativa.
- Informes JSON/CSV/PDF básico con marca NextWebEC: incluyen ventas, cobros, cuentas por cobrar, gastos pagados, disponibilidad de caja y rentabilidad por proyecto/cliente en el informe JSON. Comparan períodos anteriores y muestran objetivos mensuales configurables. Los períodos de informes aceptan mes, trimestre, año y rango personalizado. Facturación tributaria y límites SRI permanecen explícitamente fuera del sistema.
- Alertas con historial deduplicado y estado para facturas de mantenimiento y cuentas por cobrar con vencimiento asignado, mantenimientos próximos, comisiones, gastos vencidos, reservas, márgenes y objetivos incumplidos. Reglas con umbrales configurables.

## Rutas nuevas

- `/api/finance/accounts`, `/api/finance/accounts/:id/opening-balance`
- `/api/finance/ledger`, `/api/finance/movements`, `/api/finance/movements/:id/reconcile`, `/api/finance/movements/:id/void`
- `/api/finance/distributions`, `/api/finance/distributions/preview`, `/api/finance/distributions/settings`, `/api/finance/distributions/:id/void`
- `/api/finance/receivables`, `/api/finance/receivables/:saleId/due-date`
- `/api/finance/reports`, `/api/finance/reports.csv`, `/api/finance/reports.pdf`
- `/api/finance/objectives`, `/api/finance/alerts/rules/:kind`
- `/api/finance/projections`, `/api/finance/projections/simulate`
- `/api/finance/alerts`, `/api/finance/alerts/rules`, `/api/finance/alerts/:id`

## Pendiente antes de considerar la capa completa

- No existe un registro de vencimientos de dominios en el CRM, por lo que esa alerta queda pendiente. Las cuentas por cobrar históricas sin fecha asignada no producen alertas para evitar inventar vencimientos.
- El selector principal admite mes, trimestre, año y rango personalizado. Resumen, libro, gastos, reportes y exportaciones usan el período elegido; las cuentas por cobrar siguen mostrando el saldo abierto total y los contratos activos se muestran como cartera vigente.
- El PDF es un resumen ejecutivo básico; falta incluir su desglose por proyecto/cliente. No se integrará SRI sin autorización y queda fuera del alcance técnico actual.
- Confirmar y conciliar en el CRM los saldos iniciales y movimientos posteriores en cada cuenta real. Hasta entonces no se habilitan distribuciones ni se presenta disponibilidad como verificada.
- Realizar QA visual manual de escritorio y móvil; no se hizo durante esta fase. No se conectó banco ni SRI, no se migró la base de producción y no se desplegó.

## Validación

`npm run check` y `git diff --check` pasan. `node --test` pasa 4/4; la suite valida migraciones, permisos, conciliación, idempotencia, distribución, alertas, proyecciones y separación de datos reales con una base SQLite temporal. La integración HTTP requiere loopback local. No se migró la base productiva ni se hizo QA visual manual.
