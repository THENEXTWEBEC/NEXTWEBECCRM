# NEXTWEBECCRM: flujo comercial conectado

## Uso diario en cinco minutos

1. Abre **Mi día**. Atiende vencidos, tareas de hoy y próximas. Cada fila abre la oportunidad.
2. Crea una oportunidad con empresa y contacto. Teléfono, correo, servicio, valor y seguimiento son opcionales. El servicio sugiere un precio que puedes cambiar. “Más información” contiene los detalles secundarios.
3. Trabaja desde la ficha: registra llamadas, WhatsApp, email, reuniones, propuestas y notas. Las acciones comerciales avanzan una etapa temprana cuando corresponde, sin regresar una negociación ni cambiar una venta ganada o perdida.
4. Programa un seguimiento con tipo, descripción y fecha/hora de Ecuador. Aparece en la ficha, Seguimientos y Mi día. Completarlo lo retira de pendientes y registra la actividad una sola vez.
5. Al ganar, registra el valor final. Esto crea la venta y conserva la tasa de comisión vigente; no registra dinero cobrado.
6. Administración registra cobros pendientes o confirmados. Solo los confirmados actualizan cobrado, saldo y comisión. Puede confirmar o cancelar desde la ficha. No se permite una cancelación que deje comisiones generadas por debajo de las ya pagadas.
7. Administración paga comisiones desde la ficha o Comisiones; puede cambiar la tasa para ventas futuras desde Configuración.
8. Archivar conserva todos los datos. Administración consulta y restaura en Archivados; una coincidencia fuerte con otro registro activo requiere revisión antes de restaurar.
9. Administración puede eliminar desde Archivados, escribiendo el nombre de la empresa para confirmar. Solo se permite si no existen cobros ni movimientos de comisión. Se guarda un respaldo completo antes de eliminar; la operación borra la oportunidad y sus relaciones, incluida una venta sin cobros, y conserva una constancia administrativa de la eliminación. Comisiones y totales se actualizan inmediatamente.

## Definiciones y decisiones

- **Valor estimado**: potencial del pipeline; no es una venta ni una factura. En el dashboard del ejecutivo, **Dinero en juego** suma el valor estimado de sus oportunidades abiertas, incluidas propuestas y negociaciones; excluye ganadas, perdidas y archivadas. Actividad del equipo muestra el mismo cálculo en una columna por colaborador.
- **Valor vendido**: suma de valores finales de oportunidades Ganadas; incluye ventas archivadas. Si una oportunidad se reabre, deja de aportar vendido hasta volver a Ganado; los cobros confirmados históricos permanecen.
- **Dinero cobrado**: suma de cobros confirmados.
- **Saldo por cobrar**: saldo de ventas Ganadas, incluidas archivadas.
- **Comisión generada**: cobros confirmados × tasa guardada para cada venta.
- **Comisión pagada**: pagos administrativos; comisión pendiente = generada − pagada.
- **Reasignación**: mueve la oportunidad y tareas pendientes. No cambia autores históricos ni el beneficiario de una comisión ya creada.
- **Estados**: Nuevo, Contactado, Respondió, Reunión agendada, Reunión realizada, Propuesta, Negociación, Ganado, Perdido. Perdido cancela tareas aún pendientes. Ganado conserva los seguimientos y permite programar nuevos, incluidos cobros; aparecen en Mi día y Seguimientos.
- **Horarios**: America/Guayaquil (UTC−5). Una tarea 6 octubre 09:00 se guarda como 14:00 UTC y se presenta siempre a las 09:00 Ecuador.
- **Abandono**: sin actividad comercial o 3, 7, 14+ días desde la última actividad; excluye ganado, perdido y archivado.
- **Duplicados**: teléfono ecuatoriano normalizado, email y dominio son coincidencias fuertes. Nombre de empresa es débil y puede continuar tras confirmación explícita. Solo se abre un registro ajeno si el rol permite consultarlo.

## Datos y migración

La migración 002 añade seguimientos y estados de cobro, conserva registros antiguos y mantiene las tasas existentes. Convierte actividades task y próximos seguimientos en tareas relacionadas, sin borrar actividad original. Los pagos antiguos se consideran confirmados, conservando su autor y fecha. Los pagos de comisión existentes se conservan como entrada histórica. El estado legado awaiting_payment se convierte en negociación con historial.

Antes de una migración nueva se crea una copia SQLite completa en el directorio `backups` junto a la base. Si el backup falla, la migración no empieza. Las migraciones son transaccionales e idempotentes. Los agregados visibles se calculan desde cobros confirmados; los campos cacheados antiguos se conservan y se contrastan en el informe, sin borrar datos.

**Configuración → Revisar ventas y posibles duplicados** muestra ventas, estado, archivado, valor y cobros, nombres repetidos y discrepancias entre cachés históricos y cobros reales. Una coincidencia de nombre no prueba duplicidad; no se elimina ningún registro.

## Validación y límites

- Pruebas HTTP reales con SQLite temporal: login admin/ejecutivo, propiedad, duplicados, cierre atómico, seguimiento, finalización, reasignación, estados de cobro, tasas históricas, archivo/restauración, auditoría, CSRF y backups.
- Escenario Iceman: 1200 vendido; 0 cobrado / 0 comisión; primer 600 → 240 generados; pago comisión 240 → 0 pendiente; segundo 600 → 480 generados / 240 pendientes. Reintentar la misma solicitud no duplica cobros.
- Prueba de migración con datos antiguos, conservación de autores, tasas y pagos, dos orígenes de seguimiento y ejecución repetida.
- Fechas Ecuador y renderizado de pantallas y permisos visibles verificados automáticamente.
- La revisión visual en navegador real, drag-and-drop manual y verificación por dispositivo siguen pendientes: la herramienta de navegador no pudo verificar su política de seguridad ni para localhost.
- No se ha accedido a la base de producción de Render. La copia histórica local no contenía ventas; por ello la causa concreta de los $2400 en producción permanece sin verificar. Usar el informe administrativo y reportar registros antes de decidir cualquier limpieza.
- El esquema mantiene restricciones UNIQUE por venta/oportunidad y comisión/venta; las consultas financieras agregan pagos por venta, sin joins que multipliquen ventas.

Las modificaciones del propio usuario refrescan inmediatamente el espacio compartido. Para cambios de otro usuario, se consulta cada 45 segundos con la pestaña visible y sin un formulario abierto, y al volver a la pestaña; no se borra el trabajo que esté escribiendo el ejecutivo.
