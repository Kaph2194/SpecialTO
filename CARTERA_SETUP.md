# Módulo de Cartera — instalación

El módulo **💰 Cartera** muestra la cartera de rodamientos por placa, permite crear **acuerdos de pago** con compromisos por fecha, registrar **seguimientos** y **pagos**, y envía dos informes:

| Informe | Para | Copia (CC) | Cuándo |
|---|---|---|---|
| Cartera diaria por placa (valores vencidos) | juridico@specialcar.com.co | directortransporte@specialcar.com.co | Automático todos los días (lun–sáb, 7:00 a.m.) y con el botón “Enviar informe diario” |
| Acuerdos de pago (estado, pagos, incumplidos, agenda) | juridico@specialcar.com.co | directortransporte@specialcar.com.co, ceo@specialcar.com.co | Automático todos los días y con el botón “Enviar informe acuerdos” |

Cada acuerdo nuevo, pago registrado o anulación envía además un correo automático a juridico@ con copia a directortransporte@ y ceo@.

Cada compromiso de pago y cada próximo seguimiento se agenda como evento en el **calendario de juridico@** con **directortransporte@ como invitado**, así queda en ambos calendarios. Al registrar un pago, el evento cambia a “✅ PAGADA”; al anular el acuerdo, los eventos se borran.

---

## Archivos nuevos / modificados

| Archivo | Qué es |
|---|---|
| `cartera.js` | Lógica de la vista Cartera (tabla por placa, acuerdos, agenda, informes, carga del Excel). |
| `apps-script/Cartera.gs` + `apps-script/appsscript.json` | Backend de cartera (Sheets + Gmail + Calendar). |
| `index.html`, `app.js`, `styles.css` | Nueva pestaña “💰 Cartera”, modal de acuerdos y estilos. No cambia nada del módulo de vencimientos. |

---

## Conexión automática (una sola vez, ~5 minutos, desde juridico@)

Después de este paso **todo es automático**: cada acuerdo, cuota y seguimiento se agenda solo en los calendarios de juridico@ y directortransporte@; cada acuerdo nuevo, pago o anulación envía un correo (CC directortransporte@ y ceo@); y los dos informes salen solos todos los días a las 7:00 a.m.

> Google exige que la cuenta que envía los correos autorice el permiso **una vez**. Por eso este paso lo hace quien tenga la sesión de **juridico@specialcar.com.co**; nadie más puede hacerlo por esa cuenta.

1. Con la sesión de **juridico@specialcar.com.co**, abrir <https://script.google.com> → **Nuevo proyecto** → nombre `SpecialCar Cartera`.
2. Borrar lo que trae `Código.gs` y pegar todo el contenido de [`apps-script/Cartera.gs`](apps-script/Cartera.gs).
3. **Implementar → Nueva implementación** → tipo **Aplicación web**:
   - Ejecutar como: **Yo (juridico@specialcar.com.co)**
   - Quién tiene acceso: **Cualquier usuario**
   - **Implementar** → **Autorizar acceso** → elegir juridico@ → *Configuración avanzada* → *Ir a SpecialCar Cartera* → **Permitir** (Hojas de cálculo, Calendar y envío de correo).
   - Copiar la **URL de la aplicación web** (termina en `/exec`).
4. Abrir la app → **💰 Cartera** → en la parte superior, **⚙️ Conectar** → pegar la URL → Aceptar.
   - Debe quedar en verde: *Automático: calendario y correos desde juridico@specialcar.com.co*.
   - En ese momento el backend **crea solo** la hoja “SpecialCar - Cartera” en el Drive de juridico@, **programa solo** el envío diario y recibe la cartera que haya cargada en la app.

Para que la conexión quede para **todos los equipos** sin repetir el paso 4, pega la URL en `cartera.js` (constante `CARTERA_WEBAPP_URL_FIJA`, al inicio del archivo) y súbelo al repositorio.

Opcional: en `CONFIG` (al inicio de `Cartera.gs`) se puede cambiar la hora del informe, si sale sábados/domingos y si se notifica cada novedad de acuerdos. Para que nadie más pueda escribir en el backend aunque conozca la URL, poner la misma palabra en `CARTERA_CLAVE` (cartera.js) y en `CONFIG.CLAVE` (Cartera.gs).

### Comprobación

1. **📤 Cargar Cartera** con el archivo del día.
2. **✉️ Enviar informe diario** y **✉️ Enviar informe acuerdos**: deben llegar a juridico@ con sus copias.
3. Crear un acuerdo de prueba: llega el correo “Nuevo acuerdo de pago” y las cuotas aparecen en ambos calendarios.

## Datos personales y repositorio público

El repositorio de GitHub es **público** y la app se publica en GitHub Pages. Por eso la cartera (cédulas, celulares, correos y deudas de los afiliados) **no se sube al repositorio**: vive en la hoja de Google de juridico@ y se carga en la app desde el backend o con el botón **Cargar Cartera**. `cartera_data.js` está en `.gitignore`. Se recomienda además volver privado el repositorio, porque `data.js` ya contiene nombres y cédulas.

---

## Uso diario (persona de cartera)

1. **Cargar Cartera** con el archivo del día (si no se carga, el informe automático avisa que el corte está desactualizado).
2. Pestaña **Placas**: filtrar por empresa, por periodos vencidos o por placas sin acuerdo; el número de celular abre WhatsApp.
3. **+ Acuerdo** en la placa: valor acordado, número de cuotas, primera fecha y periodicidad → “Generar cuotas iguales” (se pueden editar fechas y valores una a una) → Guardar. Las cuotas quedan en los calendarios.
4. **Seguimiento / pagos**: registrar cada gestión (llamada, WhatsApp, correo, visita) con el resultado y la **fecha del próximo seguimiento** (también se agenda), y marcar las cuotas pagadas con fecha y valor.
5. Pestaña **Agenda**: lo vencido, lo de hoy y lo próximo, agrupado por fecha.

Estados del acuerdo: **Vigente** (al día), **Incumplido** (alguna cuota vencida sin pago), **Cumplido** (todas las cuotas pagadas), **Anulado**.

## Sin backend configurado (modo local)

Todo funciona en el navegador: los acuerdos se guardan localmente, el botón **📅 .ics** descarga los eventos (con ambos correos como asistentes) para agregarlos al calendario, y “Enviar informe” abre el cliente de correo con Para/CC ya diligenciados más la vista imprimible del informe para adjuntarla en PDF. El envío **automático** diario sí requiere el backend.

## Mantenimiento

- `resincronizarCalendarios()` — vuelve a crear/actualizar todos los eventos (por ejemplo si se borraron a mano).
- La pestaña *Historico* de la hoja guarda el total de cartera de cada carga para ver la evolución.
- Para cambiar la hora del informe: editar `CONFIG.HORA_INFORME`, guardar e **Implementar → Gestionar implementaciones → Editar → Nueva versión**; el nuevo horario se programa solo.
- Al cambiar `Cartera.gs`, siempre publicar una **nueva versión** de la implementación existente (así la URL no cambia).
