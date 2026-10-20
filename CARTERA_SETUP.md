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

## Actualizar a la versión 2 (sincronización, estados y carga automática del portal)

La app ya trae fija la URL del backend, así que **cualquier navegador** muestra la misma cartera, acuerdos y estados (se actualiza sola cada minuto). Para activar lo nuevo hay que reemplazar el código del backend **una vez**, con la sesión de **juridico@specialcar.com.co**:

1. Abrir <https://script.google.com> → proyecto **SpecialCar Cartera**.
2. En `Código.gs`: seleccionar todo, borrar y pegar el contenido nuevo de [`apps-script/Cartera.gs`](apps-script/Cartera.gs). Guardar 💾.
3. **Usuario y clave del portal SGT** (no van en el código ni en GitHub): ⚙️ **Configuración del proyecto** → abajo, **Propiedades del script** → **Agregar propiedad del script**:
   - `PORTAL_USUARIO` = el correo con el que se entra a portal2sgt
   - `PORTAL_CLAVE` = la contraseña de ese usuario
   - `CLAVE_APP` = una palabra clave para entrar a la cartera desde la app (**importante**: el repositorio y la URL son públicos; sin esta clave cualquiera que tenga la URL podría leer cédulas, celulares y deudas de los afiliados). La app la pide **una sola vez por navegador**.
   - **Guardar propiedades del script**.
4. **Permisos:** ⚙️ **Configuración del proyecto** → activar *Mostrar el archivo de manifiesto "appsscript.json"* → en el editor abrir `appsscript.json`, reemplazar todo por el contenido de [`apps-script/appsscript.json`](apps-script/appsscript.json) y guardar. (Si el manifiesto tiene una lista `oauthScopes` incompleta, Google no pide los permisos nuevos y aparece *"No cuentas con el permiso para llamar a UrlFetchApp.fetch"*.)
5. Volver a **Editor** (`< >`), en la lista de funciones de arriba elegir **`configurarTodo`** → **Ejecutar** → **Revisar permisos** → juridico@ → *Configuración avanzada* → *Ir a SpecialCar Cartera* → **Permitir**. Los permisos nuevos son Drive (leer el Excel), Gmail (leer adjuntos) y conexión a servicios externos (entrar al portal).
   En el **Registro de ejecución** debe aparecer la carpeta de carga y `"cargado":{...,"placas":666}` (o el número del día). Si aparece un error del portal, ver *Si falla la descarga del portal*.
6. **Implementar → Gestionar implementaciones** → ✏️ (editar) → *Versión*: **Nueva versión** → **Implementar**. **No crear una implementación nueva**: así la URL sigue siendo la misma que tiene la app.

### Qué queda automático

| Qué | Cuándo |
|---|---|
| Descarga de cartera y parque automotor (todas las empresas) del portal SGT y carga en la app | 6:00, 12:00 y 17:00 (`CONFIG.HORAS_PORTAL`), y antes del informe de las 7:00 |
| Carga de reportes que lleguen como adjunto al correo de juridico@ | Cada hora |
| Carga de cualquier Excel que se guarde en la carpeta de Drive **“SpecialCar Cartera - Cargar aqui”** | Cada hora |
| Botón **🔄 Actualizar desde el portal** en la app | Cuando se pulse |
| Informe diario de cartera e informe de acuerdos | 7:00 a.m. lunes a sábado |
| Eventos en calendarios y correos de acuerdos | Al guardar |

Los archivos ya cargados pasan a la subcarpeta *Procesados*; los que no se pudieron leer, a *Con error*. Si llegan varios, se usa el de fecha de corte más reciente.

### Parque automotor (vencimientos): consolidado automático

El CONSOLIDADO ya no hay que armarlo a mano:

- **Automático:** en las mismas horas, el backend entra al portal, abre el reporte de parque automotor (`CONFIG.PORTAL_PARQUE`, por defecto `/Reportes/ParqueAutomotor`), descarga un Excel **por cada empresa** de la lista del reporte y los une en la pestaña **ParqueAutomotor** de la hoja de Google. Esa pestaña **es el consolidado** (mismas columnas que el CONSOLIDADO.xlsx, más *Actualizado* y *Origen*) y se puede descargar como Excel desde Google Sheets.
- También se consolidan solos los archivos `ParqueAutomotor_NN.xlsx` o `CONSOLIDADO.xlsx` que lleguen al correo de juridico@ o que se guarden en la carpeta de Drive.
- **Manual:** **📤 Cargar Vencimientos** ahora permite seleccionar **los 6 archivos a la vez** (o el CONSOLIDADO).
- Cada archivo reemplaza solo los vehículos de **su empresa**, así que se puede actualizar una empresa sin tocar las demás.
- La vista de vencimientos se sincroniza en cualquier navegador. Lo que se registra en la tabla (fechas de renovación, pago de T.O., documentos completos, radicado RUNT, observaciones y comprobantes subidos a Drive) también queda compartido (pestaña *GestionVehiculos*).
- Botón **🔄 Portal** en la cabecera: descarga en el momento parque automotor y cartera.

Si la descarga del parque automotor falla, ejecutar **`diagnosticarPortalParque`** y compartir el registro, o poner las URLs exactas de descarga (una por empresa) en `CONFIG.PORTAL_PARQUE_URLS`. Si la ruta del reporte en el portal no es `/Reportes/ParqueAutomotor`, cambiarla en `CONFIG.PORTAL_PARQUE`.

### Estado de gestión por placa

Cada placa tiene **Estado**: Activo, Notificado, Desvinculación o Radicado. Al elegir **Radicado** aparece el campo **N° radicado** (se marca en rojo mientras esté vacío). El estado se guarda en la pestaña *EstadosPlaca* de la hoja (con historial de cambios), **no se pierde al cargar un reporte nuevo**, se puede filtrar, y sale en los informes y en el CSV.

### Si falla la descarga del portal

El script entra al portal como lo haría una persona (correo y contraseña) y busca el botón de Excel del reporte. Si el portal cambia o el botón no se reconoce:

1. En Apps Script ejecutar **`diagnosticarPortal`** y copiar el *Registro de ejecución* (no muestra la contraseña). Con eso se ajusta la detección.
2. O bien, en el portal, abrir las herramientas de desarrollador (F12) → pestaña *Red*, pulsar el botón de Excel, copiar la URL de la descarga y pegarla en `CONFIG.PORTAL_URL_DESCARGA`.

Mientras tanto, el reporte se puede cargar guardándolo en la carpeta de Drive, reenviándolo al correo de juridico@ o con **📤 Cargar Cartera**.

---

## Instalación inicial (ya realizada)

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

Opcional: en `CONFIG` (al inicio de `Cartera.gs`) se puede cambiar la hora del informe, si sale sábados/domingos y si se notifica cada novedad de acuerdos. La clave de acceso se define con la propiedad del script `CLAVE_APP` (nunca en el código).

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
