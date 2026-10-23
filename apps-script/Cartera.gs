/**
 * =====================================================================
 *  BACKEND DE CARTERA — SpecialCar  (Google Apps Script)
 * ---------------------------------------------------------------------
 *  IMPORTANTE: este proyecto se crea e implementa DESDE LA CUENTA
 *  juridico@specialcar.com.co. Asi:
 *    - Los correos salen de juridico@ (no de otra cuenta).
 *    - Los eventos de acuerdos quedan en el calendario de juridico@ y
 *      directortransporte@ se agrega como invitado, por lo que el evento
 *      aparece tambien en su calendario (ambos calendarios consolidados).
 *
 *  Que hace:
 *    1. Guarda la cartera (archivo CarteraRodamientos) en una Google Sheet.
 *    2. Guarda acuerdos de pago, compromisos (cuotas) y seguimientos.
 *    3. Agenda cada compromiso y el proximo seguimiento en los calendarios.
 *    4. Envia todos los dias:
 *         - Informe de cartera por placa  -> Para: juridico@  CC: directortransporte@
 *         - Informe de acuerdos           -> Para: juridico@  CC: directortransporte@, ceo@
 *
 *  Pasos de instalacion: ver CARTERA_SETUP.md en el repositorio.
 * =====================================================================
 */

const CONFIG = {
  CORREO_CARTERA:  'juridico@specialcar.com.co',
  CORREO_DIRECTOR: 'directortransporte@specialcar.com.co',
  CORREO_CEO:      'ceo@specialcar.com.co',
  NOMBRE_REMITENTE: 'Cartera - Grupo Special Car',
  ZONA: 'America/Bogota',
  HORA_INFORME: 7,                 // hora (0-23) del envio automatico diario
  ENVIAR_SABADOS: true,            // el informe diario sale lunes a sabado
  ENVIAR_DOMINGOS: false,
  SHEET_ID: '',                    // vacio = se crea "SpecialCar - Cartera" en el Drive de juridico@ la primera vez
  CALENDARIO_ID: '',               // vacio = calendario principal de juridico@
  ENVIAR_INVITACIONES: false,      // true = directortransporte@ recibe un correo por cada evento creado
  MAX_FILAS_CORREO: 100,           // filas de detalle en el cuerpo del correo (Gmail recorta correos >100KB; el PDF y el CSV adjuntos llevan todas las placas)
  NOTIFICAR_ACUERDOS: true,        // correo automatico (CC director y CEO) al crear, pagar o anular un acuerdo
  // ---- Carga automatica del reporte CarteraRodamientos (cada hora) ----
  IMPORTAR_DESDE_DRIVE: true,      // todo Excel/CSV que se guarde en la carpeta de abajo se carga solo
  CARPETA_IMPORTAR: 'SpecialCar Cartera - Cargar aqui',
  IMPORTAR_DESDE_CORREO: true,     // todo correo que llegue a juridico@ con el reporte adjunto se carga solo
  BUSQUEDA_CORREO: 'has:attachment (filename:xlsx OR filename:xls OR filename:csv) (cartera OR rodamientos OR CarteraRodamientos OR ParqueAutomotor OR "parque automotor" OR consolidado) newer_than:10d -label:cartera-importada -from:me -subject:"[CARTERA DIARIA]" -subject:"[ACUERDOS DE PAGO]"',
  // Descarga directa desde el portal SGT. Usuario y clave NO van aqui: se guardan en
  // Configuracion del proyecto > Propiedades del script: PORTAL_USUARIO y PORTAL_CLAVE.
  DESCARGAR_DEL_PORTAL: true,
  PORTAL_BASE: 'https://portal2sgt.azurewebsites.net',
  PORTAL_REPORTE: '/Reportes/CarteraRodamiento',
  PORTAL_URL_DESCARGA: '',         // si la deteccion automatica no encuentra el boton de Excel, pegar aqui la URL exacta de descarga
  HORAS_PORTAL: [6, 12, 17],       // horas del dia en que se descarga del portal (la de 6 queda lista para el informe de las 7)
  // Parque automotor (vencimientos): un reporte por empresa que se consolida solo
  PORTAL_PARQUE: '/Reportes/ParqueAutomotor',  // pagina del reporte "Listado de parque automotor"
  PORTAL_PARQUE_URLS: [],
  // Filtros que se eligen en el formulario del reporte (por texto de la opcion), igual que a mano
  PORTAL_FILTROS: {
    '/Reportes/CarteraRodamiento': { estado: 'Activos' }   // Fecha corte = hoy, Empresa = Todas, Estado = Activos
  },
  // Nombre esperado del archivo de cada reporte (se descarta cualquier otro, p.ej. "Contratos_Total")
  ARCHIVOS_REPORTE: {
    '/Reportes/CarteraRodamiento': /cartera|rodamiento/i,
    '/Reportes/ParqueAutomotor': /parque/i
  },
  CLAVE: ''                        // NO escribirla aqui: usar la propiedad del script CLAVE_APP (la app la pide una vez por navegador)
};

// ===================== WEB APP =====================
function doGet() {
  const disparador = asegurarDisparador_();
  return json_({ ok: true, servicio: 'cartera-specialcar', disparador: disparador });
}

function doPost(e) {
  try {
    const p = JSON.parse(e.postData.contents || '{}');
    const claveApp = CONFIG.CLAVE || PropertiesService.getScriptProperties().getProperty('CLAVE_APP');
    if (claveApp && p.clave !== claveApp) return json_({ error: 'clave invalida' });
    const disparador = asegurarDisparador_();
    switch (p.accion) {
      case 'ping':                 return json_({ ok: true, cuenta: Session.getEffectiveUser().getEmail(), disparador: disparador, placas: leerCartera_().length, hoja: libro_().getUrl(), carpeta: urlCarpetaImportar_() });
      case 'obtenerCartera':       return json_(obtenerTodo_(p));
      case 'guardarEstadoPlaca':   return json_(guardarEstadoPlaca_(p));
      case 'guardarGestion':       return json_(guardarGestion_(p.gestion));
      case 'enviarCorreoAfiliado': return json_(enviarCorreoAfiliado_(p));
      case 'importarAhora':        return json_(importarCarteraAutomatica(true));
      case 'obtenerParque':        return json_(obtenerParque_(p));
      case 'guardarParque':        return json_(guardarParque_(p.tablas || [], p.origen || 'Carga manual en la app'));
      case 'guardarGestionVehiculos': return json_(guardarGestionVehiculos_(p.cambios || []));
      case 'guardarCartera':       return json_(guardarCartera_(p));
      case 'guardarAcuerdo':       return json_(guardarAcuerdo_(p.acuerdo));
      case 'enviarInformeCartera': return json_(enviarInformeCartera());
      case 'enviarInformeAcuerdos':return json_(enviarInformeAcuerdos());
      default: return json_({ error: 'accion desconocida: ' + p.accion });
    }
  } catch (err) {
    console.error(err);
    return json_({ error: String(err && err.message || err) });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// ===================== HOJA DE CALCULO =====================
const COLS_CARTERA = ['placa','numInterno','identificacion','nombre','celular','correo','empresa','clase','empresaConvenio','ultimoPeriodo','periodosVencidos','valorVencido','periodosSinTarifa','estado'];
const ENC_CARTERA  = ['Placa','N Interno','Identificacion','Afiliado','Celular','Correo','Empresa','Clase','Empresa Convenio','Ultimo periodo pago','# Periodos vencidos','$ Valor vencido','Periodos sin tarifa','Estado'];

function libro_() {
  const props = PropertiesService.getScriptProperties();
  const id = CONFIG.SHEET_ID || props.getProperty('SHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  const ss = SpreadsheetApp.create('SpecialCar - Cartera');
  props.setProperty('SHEET_ID', ss.getId());
  return ss;
}
function hoja_(nombre, encabezados) {
  const ss = libro_();
  let h = ss.getSheetByName(nombre);
  if (!h) {
    h = ss.insertSheet(nombre);
    if (encabezados) { h.getRange(1, 1, 1, encabezados.length).setValues([encabezados]).setFontWeight('bold').setBackground('#1e3a5f').setFontColor('#ffffff'); h.setFrozenRows(1); }
    const def = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
    if (def && ss.getSheets().length > 1) ss.deleteSheet(def);
  }
  return h;
}

function guardarCartera_(p) {
  const regs = p.registros || [];
  if (!regs.length) throw new Error('No llegaron registros de cartera');
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const h = hoja_('Cartera', ENC_CARTERA);
    if (h.getLastRow() > 1) h.getRange(2, 1, h.getLastRow() - 1, ENC_CARTERA.length).clearContent();
    const filas = regs.map(r => COLS_CARTERA.map(c => c === 'periodosSinTarifa' ? (r[c] || []).join(' | ') : (r[c] === undefined || r[c] === null ? '' : r[c])));
    h.getRange(2, 1, filas.length, ENC_CARTERA.length).setValues(filas);
    h.getRange(2, 12, filas.length, 1).setNumberFormat('$#,##0');
    const props = PropertiesService.getScriptProperties();
    props.setProperties({ CARTERA_CORTE: p.fechaCorte || hoyISO_(), CARTERA_ARCHIVO: p.archivo || '', CARTERA_CARGA: new Date().toISOString(), CARTERA_ORIGEN: p.origen || 'Carga manual en la app' });
    tocarVersion_();
    // Historico diario para ver la evolucion de la cartera
    const hist = hoja_('Historico', ['Fecha carga', 'Fecha corte', 'Archivo', 'Placas', 'Placas con saldo', 'Total vencido']);
    const conSaldo = regs.filter(r => Number(r.valorVencido) > 0);
    hist.appendRow([new Date(), p.fechaCorte || '', (p.archivo || '') + (p.origen ? ' (' + p.origen + ')' : ''), regs.length, conSaldo.length, conSaldo.reduce((s, r) => s + Number(r.valorVencido), 0)]);
    return { ok: true, placas: regs.length };
  } finally { lock.releaseLock(); }
}

function leerCartera_() {
  const h = hoja_('Cartera', ENC_CARTERA);
  const n = h.getLastRow() - 1;
  if (n < 1) return [];
  return h.getRange(2, 1, n, COLS_CARTERA.length).getValues().filter(f => f[0]).map(f => {
    const o = {};
    COLS_CARTERA.forEach((c, i) => o[c] = f[i]);
    o.placa = String(o.placa).toUpperCase();
    ['numInterno','identificacion','celular'].forEach(c => o[c] = String(o[c]));
    o.periodosVencidos = Number(o.periodosVencidos) || 0;
    o.valorVencido = Number(o.valorVencido) || 0;
    o.periodosSinTarifa = o.periodosSinTarifa ? String(o.periodosSinTarifa).split(' | ') : [];
    return o;
  });
}

// --- Acuerdos: una fila por acuerdo (columnas legibles + JSON completo) ---
const ENC_ACUERDOS = ['ID','Placa','Afiliado','Empresa','Fecha acuerdo','Valor deuda','Valor acordado','Pagado','Saldo','Estado','Proximo compromiso','Proximo seguimiento','Responsable','Observaciones','Actualizado','JSON'];

function leerAcuerdos_() {
  const h = hoja_('Acuerdos', ENC_ACUERDOS);
  const n = h.getLastRow() - 1;
  if (n < 1) return [];
  return h.getRange(2, ENC_ACUERDOS.length, n, 1).getValues().map(f => { try { return JSON.parse(f[0]); } catch (e) { return null; } }).filter(Boolean);
}

function guardarAcuerdo_(a) {
  if (!a || !a.id || !a.placa) throw new Error('Acuerdo invalido');
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  let evento = null;
  try {
    const previo = leerAcuerdos_().filter(x => x.id === a.id)[0] || null;
    const pagadas = x => (x && x.compromisos || []).filter(c => c.pagado).length;
    if (!previo) evento = a.estado === 'anulado' ? null : 'nuevo';
    else if (a.estado === 'anulado' && previo.estado !== 'anulado') evento = 'anulado';
    else if (pagadas(a) > pagadas(previo)) evento = 'pago';
    sincronizarEventosAcuerdo_(a);
    const h = hoja_('Acuerdos', ENC_ACUERDOS);
    const t = totalesAcuerdo_(a);
    const fila = [a.id, a.placa, a.nombre, a.empresa, a.fechaAcuerdo, Number(a.valorDeuda) || 0, Number(a.valorAcordado) || 0, t.pagado, t.saldo,
      ESTADOS_[estadoAcuerdo_(a)], t.proximo ? t.proximo.fecha + ' · ' + cop_(t.proximo.valor) : '', t.proximoSeguimiento || '', a.responsable || '', a.observaciones || '', new Date(), JSON.stringify(a)];
    const ids = h.getLastRow() > 1 ? h.getRange(2, 1, h.getLastRow() - 1, 1).getValues().map(f => f[0]) : [];
    const i = ids.indexOf(a.id);
    if (i >= 0) h.getRange(i + 2, 1, 1, fila.length).setValues([fila]);
    else h.appendRow(fila);
    escribirCompromisos_();
    tocarVersion_();
  } finally { lock.releaseLock(); }
  if (evento && CONFIG.NOTIFICAR_ACUERDOS) { try { notificarAcuerdo_(a, evento); } catch (e) { console.warn('Notificacion acuerdo', e); } }
  return { ok: true, acuerdo: a, notificado: evento };
}

/** Correo automatico de cada novedad de un acuerdo: Para juridico@, CC directortransporte@ y ceo@ */
function notificarAcuerdo_(a, evento) {
  const t = totalesAcuerdo_(a);
  const titulos = { nuevo: 'Nuevo acuerdo de pago', pago: 'Pago registrado en acuerdo', anulado: 'Acuerdo anulado' };
  const ultimoPago = (a.compromisos || []).filter(c => c.pagado).sort((x, y) => String(y.fechaPago || '').localeCompare(String(x.fechaPago || '')))[0];
  const asunto = '[' + titulos[evento].toUpperCase() + '] ' + a.placa + ' · ' + a.nombre +
    (evento === 'pago' && ultimoPago ? ' · ' + cop_(ultimoPago.valorPagado || ultimoPago.valor) : evento === 'nuevo' ? ' · ' + cop_(a.valorAcordado) : '');
  const html = '<div style="' + S_.wrap + '">' +
    '<h1 style="' + S_.h1 + '">' + titulos[evento] + ' — ' + esc_(a.placa) + '</h1>' +
    '<p style="' + S_.sub + '">' + esc_(a.nombre) + ' · ' + esc_(a.empresa || '') + ' · CC ' + esc_(a.identificacion || '') + ' · ' + esc_(a.celular || '') + '</p>' +
    (evento === 'anulado' ? '<div style="' + S_.alerta + '">Motivo: ' + esc_(a.motivoAnulacion || 'sin motivo registrado') + '</div>' : '') +
    (evento === 'pago' && ultimoPago ? '<p style="font-size:13px">Pago de <b>' + cop_(ultimoPago.valorPagado || ultimoPago.valor) + '</b> el ' + fmt_(ultimoPago.fechaPago) + '.</p>' : '') +
    kpis_([[cop_(a.valorDeuda), 'Deuda al acordar', '#fef2f2', '#b91c1c'], [cop_(a.valorAcordado), 'Valor acordado', '#eff6ff', '#1d4ed8'], [cop_(t.pagado), 'Pagado', '#f0fdf4', '#15803d'], [cop_(t.saldo), 'Saldo', '#fffbeb', '#92400e']]) +
    (a.observaciones ? '<p style="font-size:12px">Condiciones: ' + esc_(a.observaciones) + '</p>' : '') +
    '<h2 style="' + S_.h2 + '">Plan de pagos</h2>' +
    tabla_(['#', 'Fecha', 'Valor', 'Estado'], (a.compromisos || []).map((c, i) => [i + 1, fmt_(c.fecha), cop_(c.valor),
      c.pagado ? 'Pagada ' + fmt_(c.fechaPago) : (c.fecha < hoyISO_() ? '<span style="color:#b91c1c">Vencida</span>' : 'Pendiente')]), [2]) +
    (evento !== 'anulado' ? '<p style="font-size:11px;color:#6b7280">Las fechas pendientes están agendadas en los calendarios de ' + CONFIG.CORREO_CARTERA + ' y ' + CONFIG.CORREO_DIRECTOR + '.</p>' : '') +
    '</div>';
  MailApp.sendEmail(CONFIG.CORREO_CARTERA, asunto, titulos[evento] + ' ' + a.placa, {
    htmlBody: html, cc: [CONFIG.CORREO_DIRECTOR, CONFIG.CORREO_CEO].join(','), name: CONFIG.NOMBRE_REMITENTE
  });
}

// Hoja plana con todas las cuotas y seguimientos (para consultar / filtrar en Sheets)
function escribirCompromisos_() {
  const acs = leerAcuerdos_();
  const h = hoja_('Compromisos', ['Fecha', 'Tipo', 'Placa', 'Afiliado', 'Detalle', 'Valor', 'Estado', 'Fecha pago', 'Valor pagado', 'ID acuerdo']);
  if (h.getLastRow() > 1) h.getRange(2, 1, h.getLastRow() - 1, 10).clearContent();
  const filas = [];
  acs.forEach(a => {
    (a.compromisos || []).forEach((c, i) => filas.push([c.fecha, 'Cuota', a.placa, a.nombre, 'Cuota ' + (i + 1) + '/' + a.compromisos.length, Number(c.valor) || 0,
      a.estado === 'anulado' ? 'Anulado' : c.pagado ? 'Pagada' : (c.fecha < hoyISO_() ? 'Vencida' : 'Pendiente'), c.fechaPago || '', c.pagado ? Number(c.valorPagado || c.valor) : '', a.id]));
    (a.seguimientos || []).forEach(s => filas.push([s.fecha, 'Seguimiento (' + (s.tipo || '') + ')', a.placa, a.nombre, (s.resultado ? s.resultado + ' — ' : '') + (s.nota || ''), '', s.proximaFecha ? 'Proximo: ' + s.proximaFecha : '', '', '', a.id]));
  });
  filas.sort((x, y) => String(x[0]).localeCompare(String(y[0])));
  if (filas.length) h.getRange(2, 1, filas.length, 10).setValues(filas);
}

// Cada escritura sube la "version"; la app pregunta cada minuto y solo descarga todo si cambio.
function versionActual_() { return PropertiesService.getScriptProperties().getProperty('VERSION') || '0'; }
function tocarVersion_() { PropertiesService.getScriptProperties().setProperty('VERSION', String(Date.now())); }

function obtenerTodo_(p) {
  const props = PropertiesService.getScriptProperties();
  const version = versionActual_();
  if (p && p.version && p.version === version) return { sinCambios: true, version: version };
  return { version: version, fechaCorte: props.getProperty('CARTERA_CORTE'), archivo: props.getProperty('CARTERA_ARCHIVO'),
    cargado: props.getProperty('CARTERA_CARGA'), origen: props.getProperty('CARTERA_ORIGEN'),
    registros: leerCartera_(), acuerdos: leerAcuerdos_(), estados: leerEstados_(), gestiones: leerGestiones_(), cuenta: Session.getEffectiveUser().getEmail(),
    carpeta: props.getProperty('CARPETA_IMPORTAR_URL') || '' };
}

// ===================== ESTADO DE GESTION POR PLACA =====================
// Activo | Notificado | Desvinculacion | Radicado (+ numero de radicado). No depende del
// archivo de cartera: se conserva por placa aunque se cargue un reporte nuevo.
const ESTADOS_PLACA_ = { activo: 'Activo', notificado: 'Notificado', desvinculacion: 'Desvinculación', radicado: 'Radicado' };
const ENC_ESTADOS = ['Placa', 'Estado', 'N° Radicado', 'Fecha cambio', 'Usuario', 'Historial'];
function leerEstados_() {
  const h = hoja_('EstadosPlaca', ENC_ESTADOS);
  const n = h.getLastRow() - 1, out = {};
  if (n < 1) return out;
  h.getRange(2, 1, n, 5).getValues().forEach(f => {
    if (!f[0]) return;
    const clave = Object.keys(ESTADOS_PLACA_).filter(k => ESTADOS_PLACA_[k] === f[1] || k === f[1])[0] || 'activo';
    out[String(f[0]).toUpperCase()] = { estado: clave, radicado: String(f[2] || ''), fecha: f[3] instanceof Date ? f[3].toISOString() : String(f[3] || ''), usuario: String(f[4] || '') };
  });
  return out;
}
function guardarEstadoPlaca_(p) {
  const placa = String(p.placa || '').toUpperCase().trim();
  const estado = ESTADOS_PLACA_[p.estado] ? p.estado : null;
  if (!placa || !estado) throw new Error('Placa o estado invalido');
  const radicado = estado === 'radicado' ? String(p.radicado || '').trim() : '';
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const h = hoja_('EstadosPlaca', ENC_ESTADOS);
    const n = h.getLastRow() - 1;
    const placas = n > 0 ? h.getRange(2, 1, n, 1).getValues().map(f => String(f[0]).toUpperCase()) : [];
    const i = placas.indexOf(placa);
    const ahora = new Date(), usuario = p.usuario || CONFIG.CORREO_CARTERA;
    const linea = Utilities.formatDate(ahora, CONFIG.ZONA, 'yyyy-MM-dd HH:mm') + ' ' + ESTADOS_PLACA_[estado] + (radicado ? ' #' + radicado : '');
    if (i >= 0) {
      const hist = String(h.getRange(i + 2, 6).getValue() || '');
      h.getRange(i + 2, 1, 1, 6).setValues([[placa, ESTADOS_PLACA_[estado], radicado, ahora, usuario, (hist ? hist + '\n' : '') + linea]]);
    } else {
      h.appendRow([placa, ESTADOS_PLACA_[estado], radicado, ahora, usuario, linea]);
    }
    tocarVersion_();
    return { ok: true, placa: placa, estado: { estado: estado, radicado: radicado, fecha: ahora.toISOString(), usuario: usuario } };
  } finally { lock.releaseLock(); }
}


// ===================== GESTIONES DE COBRO (trazabilidad por placa) =====================
// Una fila por contacto: llamada sin respuesta, mensaje/correo enviado (con el texto),
// compromiso del afiliado, etc. La proxima gestion se agenda en los calendarios.
const ENC_GESTIONES = ['ID', 'Fecha', 'Placa', 'Afiliado', 'Empresa', 'Medio', 'Resultado', 'Detalle', 'Información enviada', 'Deuda al gestionar', 'Periodos vencidos', 'Próxima gestión', 'Usuario', 'Registrado', 'EventoId'];
function leerGestiones_() {
  const h = hoja_('Gestiones', ENC_GESTIONES);
  const n = h.getLastRow() - 1;
  if (n < 1) return [];
  const iso = v => v instanceof Date ? v.toISOString() : String(v || '');
  return h.getRange(2, 1, n, ENC_GESTIONES.length).getValues().filter(f => f[0]).map(f => ({
    id: String(f[0]), fecha: iso(f[1]), placa: String(f[2]).toUpperCase(), nombre: String(f[3] || ''), empresa: String(f[4] || ''), medio: String(f[5] || ''),
    resultado: String(f[6] || ''), nota: String(f[7] || ''), mensaje: String(f[8] || ''), valorDeuda: Number(f[9]) || 0, periodos: Number(f[10]) || 0,
    proximaFecha: f[11] instanceof Date ? Utilities.formatDate(f[11], CONFIG.ZONA, 'yyyy-MM-dd') : String(f[11] || ''), usuario: String(f[12] || ''), creado: iso(f[13]), eventId: String(f[14] || '') }));
}
function guardarGestion_(g) {
  if (!g || !g.id || !g.placa || !g.resultado) throw new Error('Gestión inválida');
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const h = hoja_('Gestiones', ENC_GESTIONES);
    const n = h.getLastRow() - 1;
    const filas = n > 0 ? h.getRange(2, 1, n, ENC_GESTIONES.length).getValues() : [];
    if (filas.some(f => String(f[0]) === g.id)) return { ok: true, duplicada: true };
    const placa = String(g.placa).toUpperCase();
    // la proxima gestion reemplaza a la anterior pendiente de esa placa en el calendario
    const cal = calendario_();
    filas.forEach((f, i) => { if (String(f[2]).toUpperCase() === placa && f[14]) { borrarEvento_(cal, String(f[14])); h.getRange(i + 2, 15).setValue(''); } });
    let eventId = '';
    if (g.proximaFecha) {
      try {
        const desc = 'Afiliado: ' + (g.nombre || '') + '\nEmpresa: ' + (g.empresa || '') + '\nDeuda: ' + cop_(g.valorDeuda) + ' (' + (g.periodos || 0) + ' periodos)' +
          '\n\nÚltima gestión (' + (g.medio || '') + '): ' + g.resultado + (g.nota ? '\n' + g.nota : '') + '\nRegistrada por: ' + (g.usuario || CONFIG.CORREO_CARTERA);
        eventId = upsertEvento_(cal, null, String(g.proximaFecha).slice(0, 10), '☎️ Gestión de cobro ' + placa + ' · ' + (g.nombre || ''), desc);
      } catch (e) { console.warn('Evento gestion ' + placa, e); }
    }
    h.appendRow([g.id, g.fecha ? new Date(g.fecha) : new Date(), placa, g.nombre || '', g.empresa || '', g.medio || '', g.resultado, g.nota || '', g.mensaje || '',
      Number(g.valorDeuda) || 0, Number(g.periodos) || 0, g.proximaFecha || '', g.usuario || CONFIG.CORREO_CARTERA, new Date(), eventId]);
    tocarVersion_();
    return { ok: true, gestion: Object.assign({}, g, { placa: placa, eventId: eventId }) };
  } finally { lock.releaseLock(); }
}
/** Envia el estado de cuenta al afiliado desde juridico@ y lo deja registrado como gestion. */
function enviarCorreoAfiliado_(p) {
  const para = String(p.para || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(para)) throw new Error('Correo del afiliado inválido: ' + para);
  MailApp.sendEmail(para, String(p.asunto || 'Estado de cuenta - Grupo Special Car'), String(p.cuerpo || ''), { name: CONFIG.NOMBRE_REMITENTE, replyTo: CONFIG.CORREO_CARTERA });
  const g = p.gestion || {};
  g.medio = 'Correo'; g.resultado = 'Correo enviado';
  g.mensaje = 'Para: ' + para + '\nAsunto: ' + (p.asunto || '') + '\n\n' + (p.cuerpo || '');
  return guardarGestion_(g);
}

// ===================== LOGICA DE ACUERDOS (igual que en cartera.js) =====================
const ESTADOS_ = { vigente: 'Vigente', incumplido: 'Incumplido', cumplido: 'Cumplido', anulado: 'Anulado' };
function totalesAcuerdo_(a) {
  const comps = a.compromisos || [];
  const pagado = comps.filter(c => c.pagado).reduce((s, c) => s + (Number(c.valorPagado) || Number(c.valor) || 0), 0);
  const pendientes = comps.filter(c => !c.pagado).sort((x, y) => String(x.fecha).localeCompare(String(y.fecha)));
  const hoy = hoyISO_();
  const vencidos = pendientes.filter(c => c.fecha < hoy);
  const segs = (a.seguimientos || []).slice().sort((x, y) => String(y.fecha || '').localeCompare(String(x.fecha || '')) || String(y.creado || '').localeCompare(String(x.creado || '')));
  const ultimoSeg = segs[0] || null;
  return { pagado: pagado, saldo: Math.max((Number(a.valorAcordado) || 0) - pagado, 0), pendientes: pendientes, vencidos: vencidos, proximo: pendientes[0] || null, ultimoSeg: ultimoSeg, proximoSeguimiento: ultimoSeg && ultimoSeg.proximaFecha || null };
}
function estadoAcuerdo_(a) {
  if (a.estado === 'anulado') return 'anulado';
  const t = totalesAcuerdo_(a);
  if ((a.compromisos || []).length && !t.pendientes.length) return 'cumplido';
  if (t.vencidos.length) return 'incumplido';
  return 'vigente';
}


// =====================================================================
//  CARGA AUTOMATICA DEL REPORTE CarteraRodamientos
//  Fuentes (en este orden): portal SGT, correo de juridico@, carpeta de Drive.
//  Corre cada hora (disparador) y justo antes del informe diario.
// =====================================================================
function carpetaImportar_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('CARPETA_IMPORTAR_ID');
  if (id) { try { const f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) {} }
  const it = DriveApp.getFoldersByName(CONFIG.CARPETA_IMPORTAR);
  const f = it.hasNext() ? it.next() : DriveApp.createFolder(CONFIG.CARPETA_IMPORTAR);
  props.setProperties({ CARPETA_IMPORTAR_ID: f.getId(), CARPETA_IMPORTAR_URL: f.getUrl() });
  return f;
}
function subcarpeta_(padre, nombre) { const it = padre.getFoldersByName(nombre); return it.hasNext() ? it.next() : padre.createFolder(nombre); }
function urlCarpetaImportar_() { try { return carpetaImportar_().getUrl(); } catch (e) { return ''; } }

/** Revisa portal, correo y carpeta; carga el reporte mas reciente. Lo ejecuta el disparador horario. */
function importarCarteraAutomatica(forzarPortal) {
  const res = { portal: null, correo: 0, archivos: 0, cargado: null, errores: [] };
  const carpeta = carpetaImportar_();
  const horaActual = Number(Utilities.formatDate(new Date(), CONFIG.ZONA, 'H'));
  const props = PropertiesService.getScriptProperties();
  // 1) Portal SGT
  if (CONFIG.DESCARGAR_DEL_PORTAL && props.getProperty('PORTAL_USUARIO')) {
    const clave = hoyISO_() + '-' + horaActual;
    if (forzarPortal || (CONFIG.HORAS_PORTAL.indexOf(horaActual) >= 0 && props.getProperty('PORTAL_ULTIMA') !== clave)) {
      const errPortal = [];
      try { const blob = descargarDelPortal_(); carpeta.createFile(blob); res.portal = blob.getName(); }
      catch (e) { errPortal.push('Portal (cartera): ' + e.message); }
      if (CONFIG.PORTAL_PARQUE) {
        try { const blobs = descargarReportes_(CONFIG.PORTAL_PARQUE, true, CONFIG.PORTAL_PARQUE_URLS, 'ParqueAutomotor'); blobs.forEach(b => carpeta.createFile(b)); res.portalParque = blobs.length; }
        catch (e) { errPortal.push('Portal (parque automotor): ' + e.message); }
      }
      res.errores = res.errores.concat(errPortal);
      if (res.portal || res.portalParque) props.setProperty('PORTAL_ULTIMA', clave);
      if (errPortal.length) props.setProperty('PORTAL_ERROR', Utilities.formatDate(new Date(), CONFIG.ZONA, 'yyyy-MM-dd HH:mm') + ' ' + errPortal.join(' / ')); else props.deleteProperty('PORTAL_ERROR');
    }
  }
  // 2) Correo: adjuntos del reporte que lleguen a juridico@
  if (CONFIG.IMPORTAR_DESDE_CORREO) {
    try {
      const etiqueta = GmailApp.getUserLabelByName('cartera-importada') || GmailApp.createLabel('cartera-importada');
      GmailApp.search(CONFIG.BUSQUEDA_CORREO, 0, 20).forEach(hilo => {
        hilo.getMessages().forEach(m => m.getAttachments().forEach(a => {
          // los informes que envia este mismo sistema (cartera_AAAA-MM-DD.csv, Informe_*.pdf) no son reportes del portal
          if (/\.(xlsx|xls|csv)$/i.test(a.getName()) && !/^(cartera_\d{4}-\d{2}-\d{2}|informe_)/i.test(a.getName())) { carpeta.createFile(a.copyBlob()).setName(a.getName()); res.correo++; }
        }));
        hilo.addLabel(etiqueta);
      });
    } catch (e) { res.errores.push('Correo: ' + e.message); }
  }
  // 3) Carpeta de Drive (incluye lo que dejaron el portal y el correo)
  if (CONFIG.IMPORTAR_DESDE_DRIVE || res.portal || res.portalParque || res.correo) {
    const procesados = subcarpeta_(carpeta, 'Procesados'), conError = subcarpeta_(carpeta, 'Con error');
    const archivos = [];
    const it = carpeta.getFiles();
    while (it.hasNext()) archivos.push(it.next());
    archivos.sort((a, b) => a.getDateCreated() - b.getDateCreated());
    let mejor = null; const parques = [];
    archivos.forEach(f => {
      try {
        const filas = leerFilasArchivo_(f);
        if (esParque_(filas)) {
          const t = parsearParque_(filas);
          if (!t.filas.length) throw new Error('sin placas');
          parques.push(t); res.archivos++; f.moveTo(procesados); return;
        }
        const datos = parsearCartera_(filas);
        if (!datos.registros.length) throw new Error('sin placas');
        res.archivos++;
        if (!mejor || datos.fechaCorte >= mejor.fechaCorte) mejor = Object.assign(datos, { archivo: f.getName() });
        f.moveTo(procesados);
      } catch (e) { res.errores.push(f.getName() + ': ' + e.message); f.moveTo(conError); }
    });
    if (mejor) {
      const actual = props.getProperty('CARTERA_CORTE') || '';
      if (!actual || mejor.fechaCorte >= actual) {
        const origen = res.portal ? 'Portal SGT (automático)' : res.correo ? 'Correo juridico@ (automático)' : 'Carpeta de Drive (automático)';
        guardarCartera_({ fechaCorte: mejor.fechaCorte, archivo: mejor.archivo, registros: mejor.registros, origen: origen });
        res.cargado = { archivo: mejor.archivo, fechaCorte: mejor.fechaCorte, placas: mejor.registros.length };
      } else res.errores.push('Se omitió ' + mejor.archivo + ': su corte (' + mejor.fechaCorte + ') es anterior al cargado (' + actual + ')');
    }
    if (parques.length) {
      const origen = res.portalParque ? 'Portal SGT (automático)' : res.correo ? 'Correo juridico@ (automático)' : 'Carpeta de Drive (automático)';
      res.parque = guardarParque_(parques, origen);
    }
  }
  console.log(JSON.stringify(res));
  return res;
}

function leerArchivoCartera_(f) { return parsearCartera_(leerFilasArchivo_(f)); }
// Convierte el archivo (xlsx, xls, csv o Google Sheet) en una matriz de filas.
function leerFilasArchivo_(f) {
  const tipo = f.getMimeType();
  if (tipo === MimeType.GOOGLE_SHEETS) return SpreadsheetApp.openById(f.getId()).getSheets()[0].getDataRange().getValues();
  if (/csv|text\/plain/.test(tipo) || /\.csv$/i.test(f.getName())) {
    let txt = f.getBlob().getDataAsString('UTF-8');
    if (txt.indexOf('\uFFFD') >= 0) txt = f.getBlob().getDataAsString('ISO-8859-1');
    const sep = (txt.split('\n')[0].match(/;/g) || []).length > (txt.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
    return Utilities.parseCsv(txt, sep);
  }
  // Excel: copia temporal convertida a Google Sheets (API de Drive), se lee y se borra
  const r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + f.getId() + '/copy?supportsAllDrives=true', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({ name: 'tmp_cartera_' + Date.now(), mimeType: MimeType.GOOGLE_SHEETS })
  });
  if (r.getResponseCode() !== 200) throw new Error('No se pudo convertir el Excel (' + r.getResponseCode() + ')');
  const tmpId = JSON.parse(r.getContentText()).id;
  try { return SpreadsheetApp.openById(tmpId).getSheets()[0].getDataRange().getValues(); }
  finally { try { DriveApp.getFileById(tmpId).setTrashed(true); } catch (e) {} }
}

function normalizar_(s) { return String(s || '').replace(/\uFEFF/g, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
function mapearCol_(h) {
  h = normalizar_(h);
  if (h.indexOf('placa') >= 0) return 'placa';
  if (h.indexOf('interno') >= 0) return 'numInterno';
  if (h.indexOf('identificacion') >= 0 || h.indexOf('documento') >= 0 || h.indexOf('cedula') >= 0) return 'identificacion';
  if (h.indexOf('nombre') >= 0) return 'nombre';
  if (h.indexOf('celular') >= 0 || h.indexOf('telefono') >= 0) return 'celular';
  if (h.indexOf('correo') >= 0 || h.indexOf('email') >= 0) return 'correo';
  if (h.indexOf('convenio') >= 0) return 'empresaConvenio';
  if (h.indexOf('empresa') >= 0) return 'empresa';
  if (h.indexOf('clase') >= 0) return 'clase';
  if (h.indexOf('ultimo periodo') >= 0) return 'ultimoPeriodo';
  if (h.indexOf('sin tarifa') >= 0) return 'periodosSinTarifa';
  if (h.indexOf('$') >= 0 || (h.indexOf('valor') >= 0 && h.indexOf('vencid') >= 0)) return 'valorVencido';
  if (h.indexOf('#') >= 0 || (h.indexOf('periodos') >= 0 && h.indexOf('vencid') >= 0)) return 'periodosVencidos';
  if (h.indexOf('estado') >= 0) return 'estado';
  return null;
}
function aNumero_(v) { if (typeof v === 'number') return v; const t = String(v || '').replace(/[^\d,.-]/g, ''); return t ? (Number(t.replace(/\./g, '').replace(',', '.')) || 0) : 0; }
// Misma logica que la carga manual de la app (filas de continuacion = periodos sin tarifa).
function parsearCartera_(filas) {
  let corte = null, hIdx = -1;
  for (let i = 0; i < Math.min(filas.length, 15); i++) {
    filas[i].forEach(c => {
      if (c instanceof Date && !corte && hIdx < 0 && String(filas[i].join(' ')).toLowerCase().indexOf('corte') >= 0) corte = Utilities.formatDate(c, CONFIG.ZONA, 'yyyy-MM-dd');
      const m = String(c).toLowerCase().indexOf('corte') >= 0 && String(c).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (m) corte = m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
    });
    if (hIdx < 0 && filas[i].some(c => normalizar_(c) === 'placa')) hIdx = i;
  }
  if (hIdx < 0) throw new Error('no se encontró el encabezado "Placa"');
  const mapa = filas[hIdx].map(mapearCol_);
  if (mapa.indexOf('valorVencido') < 0 || mapa.indexOf('periodosVencidos') < 0) throw new Error('no es el reporte de Cartera de Rodamientos (faltan columnas de periodos/valor vencido)');
  const regs = []; let cur = null;
  const txt = v => v === null || v === undefined ? '' : String(v).trim();
  for (let i = hIdx + 1; i < filas.length; i++) {
    const o = {};
    mapa.forEach((k, j) => { if (k && !(k in o)) o[k] = filas[i][j]; });
    const placa = txt(o.placa).toUpperCase();
    if (placa) {
      cur = { placa: placa, numInterno: txt(o.numInterno), identificacion: txt(o.identificacion), nombre: txt(o.nombre), celular: txt(o.celular), correo: txt(o.correo),
        empresa: txt(o.empresa), clase: txt(o.clase), empresaConvenio: txt(o.empresaConvenio), ultimoPeriodo: txt(o.ultimoPeriodo),
        periodosVencidos: Math.round(aNumero_(o.periodosVencidos)), valorVencido: aNumero_(o.valorVencido), periodosSinTarifa: o.periodosSinTarifa ? [txt(o.periodosSinTarifa)] : [], estado: txt(o.estado) };
      regs.push(cur);
    } else if (cur) {
      if (o.periodosSinTarifa) cur.periodosSinTarifa.push(txt(o.periodosSinTarifa));
      if (o.estado && !cur.estado) cur.estado = txt(o.estado);
    }
  }
  return { fechaCorte: corte || hoyISO_(), registros: regs };
}

// ---------- Portal SGT: inicia sesion y descarga el Excel ----------
function cookies_(jar, resp) {
  let sc = resp.getAllHeaders()['Set-Cookie'];
  if (!sc) return;
  (Array.isArray(sc) ? sc : [sc]).forEach(c => { const kv = String(c).split(';')[0]; const i = kv.indexOf('='); if (i > 0) jar[kv.slice(0, i).trim()] = kv.slice(i + 1); });
}
function cookieHeader_(jar) { return Object.keys(jar).map(k => k + '=' + jar[k]).join('; '); }
function absoluta_(url, base) { if (/^https?:/i.test(url)) return url; if (url.charAt(0) === '/') return CONFIG.PORTAL_BASE + url; return base.replace(/[^/]*$/, '') + url; }
// GET/POST siguiendo redirecciones a mano para conservar las cookies de sesion.
function pedir_(jar, url, opciones) {
  for (let n = 0; n < 8; n++) {
    const o = Object.assign({ muteHttpExceptions: true, followRedirects: false }, opciones || {});
    o.headers = Object.assign({ Cookie: cookieHeader_(jar), 'User-Agent': 'Mozilla/5.0 (SpecialCar Cartera)' }, o.headers || {});
    const r = UrlFetchApp.fetch(url, o);
    cookies_(jar, r);
    const code = r.getResponseCode();
    if (code >= 300 && code < 400) { const h = r.getAllHeaders(); url = absoluta_(h.Location || h.location, url); opciones = { method: 'get' }; continue; }
    return { r: r, url: url, code: code };
  }
  throw new Error('Demasiadas redirecciones en el portal');
}
function atributo_(tag, nombre) { const m = tag.match(new RegExp(nombre + '\\s*=\\s*["\']([^"\']*)["\']', 'i')); return m ? m[1].replace(/&amp;/g, '&') : null; }
function formularios_(html) {
  const out = [], re = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi; let m;
  while ((m = re.exec(html))) {
    const campos = [], ri = /<(input|select|textarea|button)\b[^>]*>/gi; let t;
    while ((t = ri.exec(m[2]))) campos.push({ tag: t[0], tipo: (atributo_(t[0], 'type') || t[1]).toLowerCase(), nombre: atributo_(t[0], 'name'), valor: atributo_(t[0], 'value') || '' });
    // opciones de cada <select> (p.ej. la lista de empresas del reporte)
    const rs = /<select\b([^>]*)>([\s\S]*?)<\/select>/gi; let sm;
    while ((sm = rs.exec(m[2]))) {
      const nombre = atributo_('<s ' + sm[1] + '>', 'name'), opciones = [], ro = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi; let om;
      while ((om = ro.exec(sm[2]))) opciones.push({ valor: atributo_('<o ' + om[1] + '>', 'value') !== null ? atributo_('<o ' + om[1] + '>', 'value') : om[2].replace(/<[^>]+>/g, '').trim(), texto: om[2].replace(/<[^>]+>/g, '').trim(), sel: /\bselected\b/i.test(om[1]) });
      const c = campos.filter(x => x.tipo === 'select' && x.nombre === nombre)[0];
      if (c) { c.opciones = opciones; c.valor = (opciones.filter(o => o.sel)[0] || opciones[0] || { valor: '' }).valor; }
    }
    out.push({ action: atributo_('<f ' + m[1] + '>', 'action') || '', metodo: (atributo_('<f ' + m[1] + '>', 'method') || 'get').toLowerCase(), campos: campos, html: m[0] });
  }
  return out;
}
// Formulario de INGRESO (no confundir con "Mi Perfil", que tambien tiene un campo de contraseña)
function esFormLogin_(f, urlPagina) {
  if (!f.campos.some(c => c.tipo === 'password')) return false;
  if (f.action) return /login|signin|ingres|iniciar/i.test(f.action);
  return /login|signin/i.test(urlPagina || '');
}
function iniciarSesionPortal_(jar, ruta) {
  ruta = ruta || CONFIG.PORTAL_REPORTE;
  const props = PropertiesService.getScriptProperties();
  const usuario = String(props.getProperty('PORTAL_USUARIO') || '').trim(), clave = String(props.getProperty('PORTAL_CLAVE') || '').replace(/^\s+|\s+$/g, '');
  if (!usuario || !clave) throw new Error('Faltan PORTAL_USUARIO / PORTAL_CLAVE en Propiedades del script');
  let p = pedir_(jar, CONFIG.PORTAL_BASE + ruta);
  const form = formularios_(p.r.getContentText()).filter(f => esFormLogin_(f, p.url))[0];
  if (!form) return p; // ya hay sesion
  const datos = {};
  form.campos.forEach(c => { if (c.nombre && c.tipo !== 'submit' && c.tipo !== 'button' && c.tipo !== 'checkbox') datos[c.nombre] = c.valor; });
  const campoClave = form.campos.filter(c => c.tipo === 'password')[0];
  const campoUsuario = form.campos.filter(c => c.nombre && (c.tipo === 'email' || /email|correo|user|usuario|login/i.test(c.nombre)) && c.tipo !== 'hidden' && c.tipo !== 'password')[0]
    || form.campos.filter(c => c.nombre && c.tipo === 'text')[0];
  if (!campoUsuario || !campoClave) throw new Error('No se reconocieron los campos de usuario/clave del portal');
  datos[campoUsuario.nombre] = usuario; datos[campoClave.nombre] = clave;
  const recordar = form.campos.filter(c => c.tipo === 'checkbox' && /remember|recordar/i.test(c.nombre || ''))[0];
  if (recordar) datos[recordar.nombre] = 'true';
  p = pedir_(jar, absoluta_(form.action || p.url, p.url), { method: 'post', payload: datos });
  if (formularios_(p.r.getContentText()).some(f => esFormLogin_(f, p.url))) {
    const msg = mensajesPortal_(p.r.getContentText());
    throw new Error('El portal rechazó el inicio de sesión' + (msg ? ': "' + msg + '"' : '') + ' (revisa PORTAL_USUARIO / PORTAL_CLAVE o ejecuta diagnosticarLogin)');
  }
  return pedir_(jar, CONFIG.PORTAL_BASE + ruta);
}
function entidades_(t) {
  const mapa = { nbsp: ' ', amp: '&', quot: '"', lt: '<', gt: '>', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', uuml: 'ü', iexcl: '¡', iquest: '¿' };
  return String(t).replace(/&#(\d+);/g, (x, n) => String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]+);/gi, (x, n) => String.fromCharCode(parseInt(n, 16))).replace(/&([a-zA-Z]+);/g, (x, n) => mapa[n] !== undefined ? mapa[n] : ' ');
}
// Textos de error/aviso que muestra el portal (validaciones de ASP.NET, alertas)
function mensajesPortal_(html) {
  const out = [], re = /<(div|span|li|p|label)\b[^>]*class\s*=\s*["'][^"']*(validation-summary|field-validation-error|text-danger|alert|error|invalid-feedback)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi; let m;
  while ((m = re.exec(html))) { const t = entidades_(m[3].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(); if (t && out.indexOf(t) < 0) out.push(t); }
  return out.join(' | ').slice(0, 300);
}

/**
 * Ejecutar a mano si el portal rechaza el inicio de sesion: muestra como es el
 * formulario y que responde el portal (NUNCA muestra la contraseña).
 */
function diagnosticarLogin() {
  const props = PropertiesService.getScriptProperties();
  const u = String(props.getProperty('PORTAL_USUARIO') || ''), c = String(props.getProperty('PORTAL_CLAVE') || '');
  console.log('PORTAL_USUARIO: "' + u.replace(/^(.{3}).*(@.*)$/, '$1***$2') + '" · largo ' + u.length + (u !== u.trim() ? ' · ¡TIENE ESPACIOS AL INICIO O FINAL!' : '') +
    ' · PORTAL_CLAVE: largo ' + c.length + (c !== c.trim() ? ' · ¡TIENE ESPACIOS AL INICIO O FINAL!' : ''));
  const jar = {};
  const p = pedir_(jar, CONFIG.PORTAL_BASE + CONFIG.PORTAL_REPORTE);
  const html = p.r.getContentText();
  console.log('Página de ingreso: ' + p.url + ' · código ' + p.code + ' · cookies: ' + Object.keys(jar).join(', '));
  formularios_(html).forEach((f, i) => console.log('Formulario ' + i + ': ' + f.metodo.toUpperCase() + ' "' + f.action + '" · campos: ' +
    f.campos.map(x => x.tipo + ':' + (x.nombre || '(sin nombre)') + (x.tipo === 'hidden' ? '=' + String(x.valor).slice(0, 12) + '…' : '')).join(' | ')));
  console.log('Scripts: ' + (html.match(/<script[^>]*src=["'][^"']+["']/gi) || []).join(' '));
  console.log('Recaptcha/captcha en la página: ' + /recaptcha|captcha|hcaptcha/i.test(html));
  const js = (html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi) || []).join('\n');
  console.log('Llamadas en JS del login: ' + ((js.match(/(fetch|ajax|post|url)\s*[:(]\s*["'][^"']+["']/gi) || []).slice(0, 10).join(' · ') || 'ninguna'));
  try { iniciarSesionPortal_({}, CONFIG.PORTAL_REPORTE); console.log('RESULTADO: inicio de sesión correcto'); }
  catch (e) { console.log('RESULTADO: ' + e.message); }
}

function esExcel_(r) {
  const h = r.getAllHeaders(), ct = String(h['Content-Type'] || h['content-type'] || ''), cd = String(h['Content-Disposition'] || h['content-disposition'] || '');
  return /spreadsheet|excel|octet-stream|csv/i.test(ct) || /\.(xlsx|xls|csv)/i.test(cd);
}
function nombreDescarga_(r, base) {
  const h = r.getAllHeaders(), cd = String(h['Content-Disposition'] || h['content-disposition'] || '');
  const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i);
  return m ? decodeURIComponent(m[1]) : (base || 'CarteraRodamientos') + '_' + hoyISO_() + '.xlsx';
}
// Posibles formas de pedir el Excel desde la pagina del reporte. En el portal SGT el
// reporte es un formulario de filtros (Fecha corte, Empresa, Placa, Estado) con el
// boton "Ver Informe"; se envia como lo haria el navegador.
const PALABRAS_DESCARGA_ = /excel|xls|export|descarg/i;
const FORM_PROHIBIDO_ = /logout|logoff|salir|cerrar|perfil|password|contrase|eliminar|borrar|delete/i;
function hoyCO_() { return Utilities.formatDate(new Date(), CONFIG.ZONA, 'dd/MM/yyyy'); }
// Nombre del reporte para validar rutas y archivos: '/Reportes/CarteraRodamiento' -> 'carterarodamiento'
function tokenReporte_(ruta) { return normalizar_(String(ruta).split('/').filter(String)[1] || ruta).replace(/[^a-z]/g, ''); }
function rutaDelReporte_(url, ruta) { return normalizar_(url).replace(/[^a-z\/]/g, '').indexOf(tokenReporte_(ruta)) >= 0; }
function intentosDescarga_(html, pagina, ruta, extra, sinRespaldo) {
  const intentos = []; let m;
  // 1) El formulario del reporte (filtros + "Ver Informe"/"Generar Informe"): SOLO formularios cuya accion es del reporte
  formularios_(html).forEach(f => {
    if (f.campos.some(c => c.tipo === 'password') || FORM_PROHIBIDO_.test(f.action)) return;
    const accion = absoluta_(f.action || pagina.url, pagina.url);
    if (!rutaDelReporte_(accion, ruta)) return;
    const datos = {};
    f.campos.forEach(c => {
      if (!c.nombre || /submit|button|checkbox|file|image/.test(c.tipo)) return;
      if (c.tipo === 'radio') { if (!(c.nombre in datos) || /\bchecked\b/i.test(c.tag)) datos[c.nombre] = c.valor; return; }
      datos[c.nombre] = c.valor;
      if (/fecha|corte/i.test(c.nombre) && !c.valor) datos[c.nombre] = hoyCO_();
    });
    // Estado del vehiculo (radios Activos/Inactivos/Todos): la opcion marcada por defecto es "Activos";
    // si el campo oculto del estado esta vacio, se llena con la opcion elegida (lo hace el JS del portal)
    const radioEstado = Object.keys(datos).filter(k => /estado/i.test(k) && f.campos.some(c => c.tipo === 'radio' && c.nombre === k))[0];
    if (radioEstado) f.campos.filter(c => c.tipo === 'hidden' && /estado/i.test(c.nombre || '') && !c.valor).forEach(c => datos[c.nombre] = datos[radioEstado]);
    const filtros = CONFIG.PORTAL_FILTROS[ruta] || {};
    Object.keys(filtros).forEach(k => f.campos.filter(c => c.tipo === 'select' && new RegExp(k, 'i').test(c.nombre || '')).forEach(c => {
      const o = (c.opciones || []).filter(o => normalizar_(o.texto) === normalizar_(filtros[k]))[0] || (c.opciones || []).filter(o => normalizar_(o.texto).indexOf(normalizar_(filtros[k]).slice(0, 5)) === 0)[0];
      if (o) datos[c.nombre] = o.valor;
    }));
    Object.assign(datos, extra || {});
    const submits = f.campos.filter(c => /submit|image/.test(c.tipo));
    const excel = submits.filter(c => PALABRAS_DESCARGA_.test(c.tag));
    (excel.length ? excel : (submits.length ? submits : [{ tag: '', nombre: null }])).forEach(b => {
      const d = Object.assign({}, datos); if (b.nombre) d[b.nombre] = b.valor;
      intentos.push({ url: absoluta_(atributo_(b.tag, 'formaction') || f.action || pagina.url, pagina.url), metodo: f.metodo, datos: d });
    });
  });
  // 2) Enlaces/rutas de Excel, pero solo si pertenecen a este reporte (nunca el menu: Contratos, etc.)
  const reA = /<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = reA.exec(html))) {
    const u = absoluta_(entidades_(m[1]), pagina.url);
    if (PALABRAS_DESCARGA_.test(m[1] + ' ' + m[2]) && !/^javascript:/i.test(m[1]) && rutaDelReporte_(u, ruta)) intentos.push({ url: u, metodo: 'get', datos: extra || null });
  }
  const reJs = /["'](\/[A-Za-z0-9_\/-]*(?:Export|Excel|Descarg|Generar)[A-Za-z0-9_\/-]*)["']/gi;
  while ((m = reJs.exec(html))) if (rutaDelReporte_(m[1], ruta)) intentos.push({ url: absoluta_(m[1], pagina.url), metodo: 'get', datos: extra || null });
  if (!sinRespaldo) intentos.push({ url: CONFIG.PORTAL_BASE + ruta + '/Exportar', metodo: 'get', datos: extra || null });
  return intentos;
}
let _registroIntentos = null; // lo llena diagnosticarPortal
function probarIntentos_(jar, intentos, base, ruta, nivel) {
  const vistos = probarIntentos_._vistos || (probarIntentos_._vistos = {});
  for (let i = 0; i < intentos.length; i++) {
    const it = intentos[i], k = it.metodo + ' ' + it.url + JSON.stringify(it.datos || ''); if (vistos[k]) continue; vistos[k] = 1;
    const p = it.metodo === 'post' ? pedir_(jar, it.url, { method: 'post', payload: it.datos || {} }) : pedir_(jar, it.datos ? it.url + (it.url.indexOf('?') >= 0 ? '&' : '?') + Object.keys(it.datos).map(x => encodeURIComponent(x) + '=' + encodeURIComponent(it.datos[x])).join('&') : it.url);
    const h = p.r.getAllHeaders();
    if (_registroIntentos) _registroIntentos.push(it.metodo.toUpperCase() + ' ' + it.url + (it.datos ? ' ' + JSON.stringify(it.datos).slice(0, 200) : '') + ' → ' + p.code + ' ' + (h['Content-Type'] || h['content-type'] || '') + (h['Content-Disposition'] || h['content-disposition'] ? ' ' + (h['Content-Disposition'] || h['content-disposition']) : '') + ' (' + p.r.getContent().length + ' bytes)');
    if (p.code === 200 && esExcel_(p.r)) {
      const nombre = nombreDescarga_(p.r, base);
      // solo se acepta si el archivo es del reporte pedido (p.ej. no "Contratos_Total")
      const esperado = CONFIG.ARCHIVOS_REPORTE[ruta];
      const nombreOk = esperado ? esperado.test(nombre) : normalizar_(nombre).replace(/[^a-z]/g, '').indexOf(tokenReporte_(ruta)) >= 0;
      if (!/filename/i.test(String(h['Content-Disposition'] || h['content-disposition'] || '')) || nombreOk) return p.r.getBlob().setName(nombre);
      if (_registroIntentos) _registroIntentos.push('   ↳ descartado: ' + nombre + ' no es del reporte ' + ruta);
      continue;
    }
    // "Ver Informe" puede devolver una pagina con el informe y su propio boton de Excel
    if (p.code === 200 && !nivel && /text\/html/i.test(String(h['Content-Type'] || h['content-type'] || ''))) {
      const b = probarIntentos_(jar, intentosDescarga_(p.r.getContentText(), p, ruta, null, true).filter(x => PALABRAS_DESCARGA_.test(x.url + ' ' + JSON.stringify(x.datos || ''))), base, ruta, 1);
      if (b) return b;
    }
  }
  return null;
}
/**
 * Inicia sesion, abre la pagina del reporte y descarga el/los Excel.
 * porEmpresa = true: si el reporte tiene una lista de empresas, descarga un archivo por cada una.
 */
function descargarReportes_(ruta, porEmpresa, urlsFijas, base) {
  const jar = {};
  const pagina = iniciarSesionPortal_(jar, ruta);
  const html = pagina.r.getContentText();
  const blobs = [];
  (urlsFijas || []).filter(String).forEach(u => {
    const p = pedir_(jar, absoluta_(u, pagina.url));
    if (p.code === 200 && esExcel_(p.r)) blobs.push(p.r.getBlob().setName(nombreDescarga_(p.r, base + '_' + (blobs.length + 1))));
  });
  if (blobs.length) return blobs;
  if (porEmpresa) {
    formularios_(html).forEach(f => {
      const sel = f.campos.filter(c => c.tipo === 'select' && /empresa/i.test((c.nombre || '') + ' ' + c.tag) && (c.opciones || []).filter(o => o.valor).length > 1)[0];
      if (!sel || blobs.length) return;
      sel.opciones.filter(o => o.valor && !/seleccion|todas|todos/i.test(o.texto)).forEach(o => {
        const extra = {}; extra[sel.nombre] = o.valor;
        probarIntentos_._vistos = {};
        const b = probarIntentos_(jar, intentosDescarga_(html, pagina, ruta, extra), base + '_' + o.valor, ruta);
        if (b) blobs.push(b);
      });
    });
    if (blobs.length) return blobs;
  }
  probarIntentos_._vistos = {};
  const b = probarIntentos_(jar, intentosDescarga_(html, pagina, ruta), base, ruta);
  if (b) return [b];
  throw new Error('Inició sesión pero no encontró la descarga en Excel de ' + ruta + '. Ejecuta el diagnóstico y comparte el registro, o configura la URL de descarga');
}
function descargarDelPortal_() {
  return descargarReportes_(CONFIG.PORTAL_REPORTE, false, CONFIG.PORTAL_URL_DESCARGA ? [CONFIG.PORTAL_URL_DESCARGA] : [], 'CarteraRodamientos')[0];
}

/** Ejecutar a mano si la descarga del portal falla: muestra en el registro lo que ve el script (sin la clave). */
function diagnosticarPortalParque() { diagnosticarPortal(CONFIG.PORTAL_PARQUE); }
function diagnosticarPortal(ruta) {
  ruta = typeof ruta === 'string' ? ruta : CONFIG.PORTAL_REPORTE;
  const jar = {};
  const p = iniciarSesionPortal_(jar, ruta);
  const html = p.r.getContentText();
  console.log('URL tras iniciar sesión: ' + p.url + ' · código ' + p.code + ' · cookies: ' + Object.keys(jar).join(', '));
  formularios_(html).forEach((f, i) => console.log('Formulario ' + i + ': ' + f.metodo.toUpperCase() + ' ' + f.action + ' · campos: ' + f.campos.map(c => c.tipo + ':' + (c.nombre || '') + (/submit|button/.test(c.tipo) ? '[' + c.tag.replace(/\s+/g, ' ').slice(0, 120) + ']' : '') + (c.opciones ? '{' + c.opciones.slice(0, 15).map(o => o.valor + '=' + o.texto).join(', ') + '}' : '')).join(' | ')));
  const enlaces = html.match(/<(a|button)\b[^>]*>[\s\S]{0,80}?<\/(a|button)>/gi) || [];
  console.log('Botones/enlaces: \n' + enlaces.filter(x => /excel|xls|export|descarg|generar|consultar/i.test(x)).map(x => x.replace(/\s+/g, ' ')).join('\n'));
  console.log('Scripts: ' + (html.match(/<script[^>]*src=["'][^"']+["']/gi) || []).join(' '));
  console.log('Intentando la descarga…');
  _registroIntentos = [];
  try { const r = descargarReportes_(ruta, ruta === CONFIG.PORTAL_PARQUE, [], 'Diagnostico'); console.log('DESCARGA OK: ' + r.map(b => b.getName() + ' (' + b.getBytes().length + ' bytes)').join(', ')); }
  catch (e) { console.log('DESCARGA FALLÓ: ' + e.message); }
  console.log('Intentos:\n' + _registroIntentos.join('\n'));
  _registroIntentos = null;
  console.log('Rutas JS: ' + ((html.match(/["']\/[A-Za-z0-9_\/-]{3,}["']/g) || []).filter(x => /report|cartera|parque|export|excel/i.test(x)).join(' ')));
}


// =====================================================================
//  PARQUE AUTOMOTOR (vencimientos): consolidado de los reportes por empresa
//  Cada archivo "ParqueAutomotor_NN.xlsx" trae una empresa (fila "Empresa:");
//  el CONSOLIDADO trae varias (columna "Empresa"). Al recibir una empresa se
//  reemplazan solo sus filas, asi la hoja ParqueAutomotor ES el consolidado.
// =====================================================================
const ENC_PARQUE = ['Placa','No Interno','Nombre Propietario','Documento','Teléfono','Celular','Dirección de Residencia','Email','Fecha Nacimiento','Email Secundario','Ciudad propietario','Tar. Operacion #','Vence T. Operacion','Marca Vehículo','Clase Vehículo','Tipo Combustible','Tipo Carrocería','Pasajeros','Modelo','Cilindraje','Ciudad Vehiculo','Chasis','Motor','No. SOAT','Entidad Soat','Fecha SOAT','Entidad Seguros','Fecha Seguros','Fecha TecMecanica','Fecha Preventiva','Tipo Convenio','Empresa Convenio','Estado','Estado Vehículo','Fecha Creación','Usuario Creación','Empresa','Actualizado','Origen'];
// Columnas que necesita la app de vencimientos (el resto queda en la hoja/consolidado)
const COLS_PARQUE_APP = ['Placa','No Interno','Nombre Propietario','Documento','Celular','Email','Vence T. Operacion','Fecha SOAT','Fecha Seguros','Fecha TecMecanica','Fecha Preventiva','Estado','Empresa'];
const FECHAS_PARQUE = ['Vence T. Operacion','Fecha SOAT','Fecha Seguros','Fecha TecMecanica','Fecha Preventiva','Fecha Nacimiento'];

function esParque_(filas) {
  for (let i = 0; i < Math.min(filas.length, 8); i++) {
    const t = filas[i].map(normalizar_);
    if (t.some(c => c.indexOf('listado de parque') >= 0)) return true;
    if (t.indexOf('placa') >= 0 && (t.indexOf('vence t. operacion') >= 0 || t.indexOf('fecha soat') >= 0)) return true;
  }
  return false;
}
function isoCelda_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, CONFIG.ZONA, 'yyyy-MM-dd');
  const s = String(v === null || v === undefined ? '' : v).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0];
  return s;
}
function parsearParque_(filas) {
  let hIdx = -1, empresa = '';
  for (let i = 0; i < Math.min(filas.length, 10); i++) {
    const t = filas[i].map(normalizar_);
    if (t[0] && t[0].indexOf('empresa') === 0 && t[0].indexOf(':') > 0) empresa = String(filas[i].slice(1).filter(x => String(x).trim())[0] || '').trim();
    if (hIdx < 0 && t.indexOf('placa') >= 0 && (t.indexOf('vence t. operacion') >= 0 || t.indexOf('fecha soat') >= 0)) hIdx = i;
  }
  if (hIdx < 0) throw new Error('no se encontró el encabezado del parque automotor');
  // la columna sin titulo (entre "Empresa Convenio" y "Estado Vehículo") es el Estado
  const enc = filas[hIdx].map((h, j) => String(h || '').trim() || (normalizar_(filas[hIdx][j + 1]) === 'estado vehiculo' ? 'Estado' : ''));
  const idx = {}; enc.forEach((h, j) => { if (h && !(normalizar_(h) in idx)) idx[normalizar_(h)] = j; });
  const out = [];
  for (let i = hIdx + 1; i < filas.length; i++) {
    const f = filas[i]; const placa = String(f[idx['placa']] || '').trim().toUpperCase();
    if (!placa) continue;
    out.push(ENC_PARQUE.slice(0, 37).map(h => {
      if (h === 'Placa') return placa;
      if (h === 'Empresa') return String((idx['empresa'] !== undefined ? f[idx['empresa']] : '') || empresa || '').trim();
      const j = idx[normalizar_(h)]; const v = j === undefined ? '' : f[j];
      return FECHAS_PARQUE.indexOf(h) >= 0 ? isoCelda_(v) : (v instanceof Date ? Utilities.formatDate(v, CONFIG.ZONA, 'yyyy-MM-dd HH:mm') : (v === null || v === undefined ? '' : v));
    }));
  }
  return { empresa: empresa, filas: out };
}
// Solo vehiculos ACTIVOS en el consolidado: columna Estado (sin titulo en el reporte) y/o
// "Estado Vehículo". Sin dato de estado se conserva; Inactivo/Retirado/Desvinculado se descarta.
function esActivoParque_(f) {
  const est = [f[ENC_PARQUE.indexOf('Estado')], f[ENC_PARQUE.indexOf('Estado Vehículo')]].map(normalizar_).filter(String);
  if (!est.length) return true;
  if (est.some(e => /^(inactiv|retir|desvinc|bloque|suspend)/.test(e))) return false;
  return est.some(e => e === 'activo' || e === 'activos');
}
// tablas: [{filas:[[...37 columnas ENC_PARQUE...]]}] o desde la app: [{encabezados:[...], filas:[[...]]}]
function guardarParque_(tablas, origen) {
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const h = hoja_('ParqueAutomotor', ENC_PARQUE);
    const n = h.getLastRow() - 1;
    let actuales = n > 0 ? h.getRange(2, 1, n, ENC_PARQUE.length).getValues() : [];
    const iEmp = ENC_PARQUE.indexOf('Empresa'), ahora = new Date();
    const nuevas = [], empresas = {}; let inactivos = 0;
    tablas.forEach(t => {
      let filas = t.filas || [];
      if (t.encabezados) { // viene de la app: reordenar por nombre de columna
        const pos = {}; t.encabezados.forEach((e, j) => pos[normalizar_(e)] = j);
        filas = filas.map(f => ENC_PARQUE.slice(0, 37).map(e => { const j = pos[normalizar_(e)]; return j === undefined ? '' : (f[j] === null || f[j] === undefined ? '' : f[j]); }));
      }
      filas.forEach(f => {
        const e = String(f[iEmp] || '').trim() || 'SIN EMPRESA'; f[iEmp] = e;
        if (!(e in empresas)) empresas[e] = 0;
        if (!esActivoParque_(f)) { inactivos++; return; }
        empresas[e]++; nuevas.push(f.slice(0, 37).concat([ahora, origen]));
      });
    });
    if (!nuevas.length) throw new Error(inactivos ? 'Todos los vehículos recibidos están inactivos' : 'No llegaron vehículos');
    // reemplaza solo las empresas recibidas; si una placa cambio de empresa, queda la nueva
    const placasNuevas = {}; nuevas.forEach(f => placasNuevas[String(f[0]).toUpperCase()] = 1);
    actuales = actuales.filter(f => f[0] && esActivoParque_(f) && !(String(f[iEmp]).trim() in empresas) && !placasNuevas[String(f[0]).toUpperCase()]);
    const todas = actuales.concat(nuevas).sort((a, b) => String(a[iEmp]).localeCompare(String(b[iEmp])) || String(a[0]).localeCompare(String(b[0])));
    if (n > 0) h.getRange(2, 1, n, ENC_PARQUE.length).clearContent();
    h.getRange(2, 1, todas.length, ENC_PARQUE.length).setValues(todas);
    FECHAS_PARQUE.forEach(c => h.getRange(2, ENC_PARQUE.indexOf(c) + 1, todas.length, 1).setNumberFormat('yyyy-mm-dd'));
    const props = PropertiesService.getScriptProperties();
    props.setProperties({ PARQUE_CARGA: ahora.toISOString(), PARQUE_ORIGEN: origen, PARQUE_VERSION: String(Date.now()) });
    hoja_('HistoricoParque', ['Fecha', 'Origen', 'Empresas actualizadas', 'Vehículos activos recibidos', 'Total consolidado', 'Inactivos descartados'])
      .appendRow([ahora, origen, Object.keys(empresas).map(e => e + ' (' + empresas[e] + ')').join(', '), nuevas.length, todas.length, inactivos]);
    return { ok: true, empresas: empresas, recibidos: nuevas.length, total: todas.length, inactivosDescartados: inactivos };
  } finally { lock.releaseLock(); }
}
function obtenerParque_(p) {
  const props = PropertiesService.getScriptProperties();
  const version = props.getProperty('PARQUE_VERSION') || '0';
  if (p && p.version && p.version === version) return { sinCambios: true, version: version };
  const h = hoja_('ParqueAutomotor', ENC_PARQUE);
  const n = h.getLastRow() - 1;
  const cols = COLS_PARQUE_APP.map(c => ENC_PARQUE.indexOf(c));
  const iAct = ENC_PARQUE.indexOf('Actualizado'), iEmp = ENC_PARQUE.indexOf('Empresa');
  const filas = [], empresas = {};
  if (n > 0) h.getRange(2, 1, n, ENC_PARQUE.length).getValues().forEach(f => {
    if (!f[0] || !esActivoParque_(f)) return;
    filas.push(cols.map(j => (FECHAS_PARQUE.indexOf(ENC_PARQUE[j]) >= 0 || f[j] instanceof Date) ? isoCelda_(f[j]) : f[j]));
    const e = f[iEmp]; const act = f[iAct] instanceof Date ? f[iAct].toISOString() : String(f[iAct] || '');
    if (!empresas[e]) empresas[e] = { actualizado: act, vehiculos: 0 };
    if (act > empresas[e].actualizado) empresas[e].actualizado = act;
    empresas[e].vehiculos++;
  });
  return { version: version, encabezados: COLS_PARQUE_APP, filas: filas, empresas: empresas, gestion: leerGestion_(),
    cargado: props.getProperty('PARQUE_CARGA'), origen: props.getProperty('PARQUE_ORIGEN') };
}
// Datos que se registran a mano en la tabla de vencimientos (fechas de renovacion,
// pagos de TO, observaciones, comprobantes en Drive), compartidos entre navegadores.
function leerGestion_() {
  const h = hoja_('GestionVehiculos', ['Placa', 'Datos', 'Actualizado', 'Usuario']);
  const n = h.getLastRow() - 1, out = {};
  if (n < 1) return out;
  h.getRange(2, 1, n, 2).getValues().forEach(f => { if (f[0]) { try { out[String(f[0]).toUpperCase()] = JSON.parse(f[1]); } catch (e) {} } });
  return out;
}
function guardarGestionVehiculos_(cambios) {
  if (!cambios.length) return { ok: true, guardados: 0 };
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const h = hoja_('GestionVehiculos', ['Placa', 'Datos', 'Actualizado', 'Usuario']);
    const n = h.getLastRow() - 1;
    const filas = n > 0 ? h.getRange(2, 1, n, 4).getValues() : [];
    const pos = {}; filas.forEach((f, i) => pos[String(f[0]).toUpperCase()] = i);
    const ahora = new Date();
    cambios.forEach(c => {
      const placa = String(c.placa || '').toUpperCase().trim(); if (!placa) return;
      const fila = [placa, JSON.stringify(c.campos || {}), ahora, c.usuario || ''];
      if (placa in pos) filas[pos[placa]] = fila; else { pos[placa] = filas.length; filas.push(fila); }
    });
    if (filas.length) h.getRange(2, 1, filas.length, 4).setValues(filas);
    PropertiesService.getScriptProperties().setProperty('PARQUE_VERSION', String(Date.now()));
    return { ok: true, guardados: cambios.length };
  } finally { lock.releaseLock(); }
}


// ===================== CALENDARIOS =====================
function calendario_() {
  return CONFIG.CALENDARIO_ID ? CalendarApp.getCalendarById(CONFIG.CALENDARIO_ID) : CalendarApp.getDefaultCalendar();
}
function fechaLocal_(iso) { const p = String(iso).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }

function borrarEvento_(cal, id) {
  if (!id) return;
  try { const ev = cal.getEventById(id); if (ev) ev.deleteEvent(); } catch (e) { console.warn('No se pudo borrar evento ' + id, e); }
}

// Crea o actualiza un evento de dia completo en el calendario de juridico@ con
// directortransporte@ como invitado (asi queda en ambos calendarios).
function upsertEvento_(cal, id, fechaIso, titulo, descripcion) {
  let ev = null;
  if (id) { try { ev = cal.getEventById(id); } catch (e) { ev = null; } }
  const fecha = fechaLocal_(fechaIso);
  if (ev) {
    ev.setTitle(titulo); ev.setDescription(descripcion); ev.setAllDayDate(fecha);
    const invitados = ev.getGuestList().map(g => g.getEmail().toLowerCase());
    if (invitados.indexOf(CONFIG.CORREO_DIRECTOR.toLowerCase()) < 0) ev.addGuest(CONFIG.CORREO_DIRECTOR);
  } else {
    ev = cal.createAllDayEvent(titulo, fecha, { description: descripcion, guests: CONFIG.CORREO_DIRECTOR, sendInvites: CONFIG.ENVIAR_INVITACIONES });
    ev.removeAllReminders();
    ev.addPopupReminder(15 * 60);  // dia anterior 9:00 a.m.
    ev.addEmailReminder(15 * 60);
  }
  ev.setGuestsCanSeeGuests(true);
  return ev.getId();
}

function sincronizarEventosAcuerdo_(a) {
  const cal = calendario_();
  (a._eventosAEliminar || []).forEach(id => borrarEvento_(cal, id));
  delete a._eventosAEliminar;

  const comps = a.compromisos || [];
  if (a.estado === 'anulado') {
    comps.forEach(c => { borrarEvento_(cal, c.eventId); delete c.eventId; });
    borrarEvento_(cal, a.eventoSeguimientoId); delete a.eventoSeguimientoId;
    a.eventosSincronizados = false;
    return;
  }
  const base = 'Afiliado: ' + a.nombre + '\nCC: ' + (a.identificacion || '') + '\nEmpresa: ' + (a.empresa || '') +
    '\nCelular: ' + (a.celular || '') + '\nCorreo: ' + (a.correo || '') +
    '\n\nAcuerdo del ' + a.fechaAcuerdo + ' por ' + cop_(a.valorAcordado) + ' (deuda al acordar ' + cop_(a.valorDeuda) + ')' +
    (a.observaciones ? '\nCondiciones: ' + a.observaciones : '') + '\nResponsable: ' + (a.responsable || CONFIG.CORREO_CARTERA);

  comps.forEach((c, i) => {
    try {
      const titulo = (c.pagado ? '✅ PAGADA · ' : '💰 ') + 'Cuota ' + (i + 1) + '/' + comps.length + ' acuerdo ' + a.placa + ' · ' + cop_(c.pagado ? (c.valorPagado || c.valor) : c.valor);
      const desc = base + (c.pagado ? '\n\nPago registrado el ' + c.fechaPago + ' por ' + cop_(c.valorPagado || c.valor) : '\n\nValor de la cuota: ' + cop_(c.valor));
      c.eventId = upsertEvento_(cal, c.eventId, c.fecha, titulo, desc);
    } catch (e) { console.warn('Evento cuota ' + a.placa, e); }
  });

  const t = totalesAcuerdo_(a);
  try {
    if (t.proximoSeguimiento && estadoAcuerdo_(a) !== 'cumplido') {
      const desc = base + '\n\nUltima gestion (' + (t.ultimoSeg.fecha || '') + ', ' + (t.ultimoSeg.tipo || '') + '): ' + (t.ultimoSeg.nota || '') +
        '\nSaldo del acuerdo: ' + cop_(t.saldo);
      a.eventoSeguimientoId = upsertEvento_(cal, a.eventoSeguimientoId, t.proximoSeguimiento, '📞 Seguimiento acuerdo ' + a.placa + ' · ' + a.nombre, desc);
    } else if (a.eventoSeguimientoId) {
      borrarEvento_(cal, a.eventoSeguimientoId); delete a.eventoSeguimientoId;
    }
  } catch (e) { console.warn('Evento seguimiento ' + a.placa, e); }
  a.eventosSincronizados = true;
}

/** Ejecutar a mano si se borraron eventos o se cambio de calendario: vuelve a crear/actualizar todos. */
function resincronizarCalendarios() {
  const acs = leerAcuerdos_();
  acs.forEach(a => guardarAcuerdo_(a));
  return acs.length;
}

// ===================== INFORMES =====================
const S_ = {
  wrap: 'font-family:Segoe UI,Arial,sans-serif;color:#1f2937;max-width:1000px;margin:0 auto',
  h1: 'font-size:20px;color:#1e3a5f;margin:0 0 2px',
  sub: 'color:#6b7280;font-size:12px;margin:0 0 18px',
  h2: 'font-size:14px;color:#1e3a5f;margin:20px 0 8px;border-bottom:2px solid #e5e7eb;padding-bottom:5px',
  tbl: 'width:100%;border-collapse:collapse;font-size:11px',
  th: 'background:#1e3a5f;color:#fff;padding:6px 8px;text-align:left;font-size:10px;text-transform:uppercase',
  td: 'padding:4px 6px;border-bottom:1px solid #eee',
  kpi: 'padding:12px;border-radius:8px;text-align:center;border:1.5px solid #e5e7eb',
  alerta: 'background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;padding:10px 12px;border-radius:6px;font-size:12px;margin-bottom:14px'
};
function kpis_(lista) {
  return '<table style="width:100%;border-collapse:separate;border-spacing:8px 0;margin:0 -8px 8px"><tr>' + lista.map(k =>
    '<td style="' + S_.kpi + ';background:' + k[2] + '"><div style="font-size:20px;font-weight:800;color:' + k[3] + '">' + k[0] + '</div><div style="font-size:11px;color:#6b7280">' + k[1] + '</div></td>').join('') + '</tr></table>';
}
function tabla_(enc, filas, derecha) {
  derecha = derecha || [];
  return '<table style="' + S_.tbl + '"><thead><tr>' + enc.map((h, i) => '<th style="' + S_.th + (derecha.indexOf(i) >= 0 ? ';text-align:right' : '') + '">' + h + '</th>').join('') + '</tr></thead><tbody>' +
    filas.map((f, j) => '<tr' + (j % 2 ? ' bgcolor="#f9fafb"' : '') + '>' + f.map((c, i) => '<td style="' + S_.td + (derecha.indexOf(i) >= 0 ? ';text-align:right;white-space:nowrap' : '') + '">' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
}

function htmlInformeCartera_(regs, acs, corte, limite) {
  const conSaldo = regs.filter(r => r.valorVencido > 0).sort((a, b) => b.valorVencido - a.valorVencido);
  const total = conSaldo.reduce((s, r) => s + r.valorVencido, 0);
  const porEmp = {};
  conSaldo.forEach(r => { porEmp[r.empresa] = porEmp[r.empresa] || { n: 0, v: 0 }; porEmp[r.empresa].n++; porEmp[r.empresa].v += r.valorVencido; });
  const activos = acs.filter(a => ['vigente', 'incumplido'].indexOf(estadoAcuerdo_(a)) >= 0);
  const acPorPlaca = {}; activos.forEach(a => acPorPlaca[a.placa] = a);
  const rangos = [['1 periodo', r => r.periodosVencidos === 1], ['2–3 periodos', r => r.periodosVencidos >= 2 && r.periodosVencidos <= 3], ['4–6 periodos', r => r.periodosVencidos >= 4 && r.periodosVencidos <= 6], ['Más de 6', r => r.periodosVencidos > 6]];
  const diasCorte = corte ? Math.round((fechaLocal_(hoyISO_()) - fechaLocal_(corte)) / 86400000) : null;
  const detalle = limite ? conSaldo.slice(0, limite) : conSaldo;
  const gestiones = leerGestiones_().sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  const ultimaG = {}; gestiones.forEach(g => { if (!ultimaG[g.placa]) ultimaG[g.placa] = g; });
  const desde = Date.now() - 86400000, recientes = gestiones.filter(g => new Date(g.fecha).getTime() >= desde);
  const porResultado = {}; recientes.forEach(g => porResultado[g.resultado] = (porResultado[g.resultado] || 0) + 1);
  const sinGestion7 = conSaldo.filter(r => !ultimaG[r.placa] || new Date(ultimaG[r.placa].fecha).getTime() < Date.now() - 7 * 86400000).length;
  const fh = s => Utilities.formatDate(new Date(s), CONFIG.ZONA, 'dd/MM HH:mm');
  const estados = leerEstados_();
  const est = r => { const e = estados[r.placa]; return e ? ESTADOS_PLACA_[e.estado] + (e.radicado ? ' #' + esc_(e.radicado) : '') : 'Activo'; };
  const porEstado = {}; Object.keys(ESTADOS_PLACA_).forEach(k => porEstado[k] = { n: 0, v: 0 });
  conSaldo.forEach(r => { const k = (estados[r.placa] || {}).estado || 'activo'; porEstado[k].n++; porEstado[k].v += r.valorVencido; });
  return '<div style="' + S_.wrap + '">' +
    '<h1 style="' + S_.h1 + '">Informe diario de cartera por placa</h1>' +
    '<p style="' + S_.sub + '">Grupo Special Car — ' + fechaLarga_() + ' · Corte de cartera: ' + (corte ? fmt_(corte) : 'sin cargar') + '</p>' +
    (diasCorte !== null && diasCorte > 1 ? '<div style="' + S_.alerta + '">⚠️ La cartera no se ha actualizado desde el ' + fmt_(corte) + ' (' + diasCorte + ' días). Carga el archivo CarteraRodamientos del día en la vista Cartera.</div>' : '') +
    kpis_([[cop_(total), 'Cartera vencida', '#fef2f2', '#b91c1c'], [conSaldo.length, 'Placas con saldo', '#fffbeb', '#92400e'], [regs.length - conSaldo.length, 'Placas al día', '#f0fdf4', '#15803d'], [activos.length, 'Acuerdos activos', '#eff6ff', '#1d4ed8']]) +
    '<h2 style="' + S_.h2 + '">Resumen por empresa</h2>' +
    tabla_(['Empresa', 'Placas', 'Valor vencido'], Object.keys(porEmp).sort((a, b) => porEmp[b].v - porEmp[a].v).map(e => [esc_(e), porEmp[e].n, cop_(porEmp[e].v)]).concat([['<b>TOTAL</b>', '<b>' + conSaldo.length + '</b>', '<b>' + cop_(total) + '</b>']]), [2]) +
    '<h2 style="' + S_.h2 + '">Por estado de gestión</h2>' +
    tabla_(['Estado', 'Placas con saldo', 'Valor'], Object.keys(ESTADOS_PLACA_).map(k => [ESTADOS_PLACA_[k], porEstado[k].n, cop_(porEstado[k].v)]), [2]) +
    '<h2 style="' + S_.h2 + '">Por periodos vencidos</h2>' +
    tabla_(['Rango', 'Placas', 'Valor'], rangos.map(x => { const l = conSaldo.filter(x[1]); return [x[0], l.length, cop_(l.reduce((s, r) => s + r.valorVencido, 0))]; }), [2]) +
    '<h2 style="' + S_.h2 + '">Gestiones de cobro de las últimas 24 horas (' + recientes.length + ')</h2>' +
    '<p style="font-size:12px;margin:0 0 8px">' + (Object.keys(porResultado).map(k => esc_(k) + ': <b>' + porResultado[k] + '</b>').join(' · ') || 'Ninguna gestión registrada') + ' — Placas con saldo sin gestión en 7 días: <b>' + sinGestion7 + '</b></p>' +
    (recientes.length ? tabla_(['Fecha', 'Placa', 'Afiliado', 'Medio', 'Resultado', 'Detalle', 'Próxima'], recientes.slice(0, 60).map(g => [fh(g.fecha), '<b>' + esc_(g.placa) + '</b>', esc_(g.nombre), esc_(g.medio), esc_(g.resultado), esc_(String(g.nota || '').slice(0, 80)), g.proximaFecha ? fmt_(g.proximaFecha) : '—'])) : '') +
    '<h2 style="' + S_.h2 + '">Detalle por placa (' + conSaldo.length + ')' + (detalle.length < conSaldo.length ? ' — se muestran las ' + detalle.length + ' de mayor valor; el detalle completo va en el PDF y el CSV adjuntos' : '') + '</h2>' +
    tabla_(['Placa', 'Afiliado', 'Empresa', 'Celular', '# Per.', 'Valor vencido', 'Estado', 'Acuerdo', 'Última gestión'],
      detalle.map(r => ['<b>' + esc_(r.placa) + '</b>', esc_(r.nombre), esc_(r.empresa), esc_(r.celular), r.periodosVencidos, cop_(r.valorVencido), est(r), acPorPlaca[r.placa] ? ESTADOS_[estadoAcuerdo_(acPorPlaca[r.placa])] : '—',
        ultimaG[r.placa] ? fh(ultimaG[r.placa].fecha) + ' ' + esc_(ultimaG[r.placa].resultado) : 'Sin gestión']), [5]) +
    '<p style="font-size:10px;color:#9ca3af;text-align:center;margin-top:24px">Enviado automáticamente desde ' + CONFIG.CORREO_CARTERA + ' — Sistema de Vencimientos y Cartera SpecialCar — Confidencial</p></div>';
}

function htmlInformeAcuerdos_(acs) {
  const hoy = hoyISO_();
  const vivos = acs.filter(a => a.estado !== 'anulado');
  const g = { vigente: [], incumplido: [], cumplido: [] };
  vivos.forEach(a => g[estadoAcuerdo_(a)].push(a));
  const activos = g.vigente.concat(g.incumplido);
  const sum = (l, f) => l.reduce((s, x) => s + f(x), 0);
  // gestiones del dia y de los proximos 7 dias
  const lim = Utilities.formatDate(new Date(Date.now() + 7 * 86400000), CONFIG.ZONA, 'yyyy-MM-dd');
  const agenda = [];
  activos.forEach(a => {
    (a.compromisos || []).filter(c => !c.pagado && c.fecha <= lim).forEach(c => agenda.push([c.fecha, 'Cuota', a, cop_(c.valor)]));
    const t = totalesAcuerdo_(a);
    if (t.proximoSeguimiento && t.proximoSeguimiento <= lim) agenda.push([t.proximoSeguimiento, 'Seguimiento', a, '']);
  });
  agenda.sort((x, y) => x[0].localeCompare(y[0]));
  const filaAc = a => {
    const t = totalesAcuerdo_(a);
    return ['<b>' + esc_(a.placa) + '</b>', esc_(a.nombre), fmt_(a.fechaAcuerdo), cop_(a.valorAcordado), cop_(t.pagado), cop_(t.saldo),
      t.proximo ? fmt_(t.proximo.fecha) + ' · ' + cop_(t.proximo.valor) : '—',
      t.vencidos.length ? '<span style="color:#b91c1c;font-weight:700">' + t.vencidos.length + ' · ' + cop_(sum(t.vencidos, c => Number(c.valor) || 0)) + '</span>' : '—',
      t.ultimoSeg ? fmt_(t.ultimoSeg.fecha) + ' ' + esc_(String(t.ultimoSeg.nota || '').slice(0, 90)) : '—'];
  };
  const encAc = ['Placa', 'Afiliado', 'Fecha acuerdo', 'Acordado', 'Pagado', 'Saldo', 'Próximo compromiso', 'Vencido', 'Último seguimiento'];
  const sec = (tit, l) => '<h2 style="' + S_.h2 + '">' + tit + ' (' + l.length + ')</h2>' + (l.length ? tabla_(encAc, l.map(filaAc), [3, 4, 5]) : '<p style="' + S_.sub + '">Ninguno</p>');
  return '<div style="' + S_.wrap + '">' +
    '<h1 style="' + S_.h1 + '">Informe de acuerdos de pago</h1>' +
    '<p style="' + S_.sub + '">Grupo Special Car — ' + fechaLarga_() + ' · Responsable: ' + CONFIG.CORREO_CARTERA + '</p>' +
    kpis_([[activos.length, 'Acuerdos activos', '#eff6ff', '#1d4ed8'], [g.incumplido.length, 'Incumplidos', '#fef2f2', '#b91c1c'],
      [cop_(sum(activos, a => totalesAcuerdo_(a).saldo)), 'Saldo por recaudar', '#fffbeb', '#92400e'], [cop_(sum(vivos, a => totalesAcuerdo_(a).pagado)), 'Recaudado en acuerdos', '#f0fdf4', '#15803d']]) +
    '<h2 style="' + S_.h2 + '">Agenda: vencidos, hoy y próximos 7 días (' + agenda.length + ')</h2>' +
    (agenda.length ? tabla_(['Fecha', 'Tipo', 'Placa', 'Afiliado', 'Celular', 'Valor'], agenda.map(x => [
      x[0] < hoy ? '<span style="color:#b91c1c;font-weight:700">' + fmt_(x[0]) + ' (vencida)</span>' : x[0] === hoy ? '<b>HOY</b>' : fmt_(x[0]),
      x[1], '<b>' + esc_(x[2].placa) + '</b>', esc_(x[2].nombre), esc_(x[2].celular || ''), x[3]]), [5]) : '<p style="' + S_.sub + '">Sin gestiones pendientes</p>') +
    sec('Acuerdos incumplidos', g.incumplido) + sec('Acuerdos vigentes al día', g.vigente) + sec('Acuerdos cumplidos', g.cumplido) +
    '<p style="font-size:10px;color:#9ca3af;text-align:center;margin-top:24px">Enviado desde ' + CONFIG.CORREO_CARTERA + ' — Sistema de Vencimientos y Cartera SpecialCar — Confidencial</p></div>';
}

function pdf_(html, nombre) {
  return Utilities.newBlob('<html><head><meta charset="UTF-8"></head><body style="margin:24px">' + html + '</body></html>', 'text/html', nombre + '.html').getAs('application/pdf').setName(nombre + '.pdf');
}
function csvCartera_(regs, acs) {
  const acPorPlaca = {}; acs.filter(a => ['vigente', 'incumplido'].indexOf(estadoAcuerdo_(a)) >= 0).forEach(a => acPorPlaca[a.placa] = a);
  const estados = leerEstados_();
  const enc = ['Placa', 'N Interno', 'Identificacion', 'Afiliado', 'Celular', 'Correo', 'Empresa', 'Clase', 'Ultimo periodo pago', '# Periodos vencidos', '$ Valor vencido', 'Estado', 'N Radicado', 'Acuerdo'];
  const filas = regs.slice().sort((a, b) => b.valorVencido - a.valorVencido).map(r => { const e = estados[r.placa] || {}; return [r.placa, r.numInterno, r.identificacion, r.nombre, r.celular, r.correo, r.empresa, r.clase, r.ultimoPeriodo, r.periodosVencidos, r.valorVencido, ESTADOS_PLACA_[e.estado || 'activo'], e.radicado || '', acPorPlaca[r.placa] ? ESTADOS_[estadoAcuerdo_(acPorPlaca[r.placa])] : '']; });
  const csv = [enc].concat(filas).map(f => f.map(c => '"' + String(c === null || c === undefined ? '' : c).replace(/"/g, '""') + '"').join(';')).join('\r\n');
  return Utilities.newBlob('﻿' + csv, 'text/csv', 'cartera_' + hoyISO_() + '.csv');
}

/** Informe de cartera por placa: Para juridico@, CC directortransporte@ */
function enviarInformeCartera() {
  const regs = leerCartera_(), acs = leerAcuerdos_();
  const corte = PropertiesService.getScriptProperties().getProperty('CARTERA_CORTE');
  if (!regs.length) throw new Error('No hay cartera cargada. Carga el archivo desde la vista Cartera.');
  const conSaldo = regs.filter(r => r.valorVencido > 0);
  const total = conSaldo.reduce((s, r) => s + r.valorVencido, 0);
  const asunto = '[CARTERA DIARIA] ' + conSaldo.length + ' placas con saldo · ' + cop_(total) + ' · ' + fmt_(hoyISO_());
  MailApp.sendEmail(CONFIG.CORREO_CARTERA, asunto, 'Informe diario de cartera. Abre este correo en un cliente que muestre HTML o revisa los adjuntos.', {
    htmlBody: htmlInformeCartera_(regs, acs, corte, CONFIG.MAX_FILAS_CORREO),
    cc: CONFIG.CORREO_DIRECTOR,
    name: CONFIG.NOMBRE_REMITENTE,
    attachments: [pdf_(htmlInformeCartera_(regs, acs, corte, 0), 'Informe_cartera_' + hoyISO_()), csvCartera_(regs, acs)]
  });
  return { ok: true, placas: conSaldo.length, total: total };
}

/** Informe de acuerdos: Para juridico@, CC directortransporte@ y ceo@ */
function enviarInformeAcuerdos() {
  const acs = leerAcuerdos_();
  const activos = acs.filter(a => ['vigente', 'incumplido'].indexOf(estadoAcuerdo_(a)) >= 0);
  const inc = activos.filter(a => estadoAcuerdo_(a) === 'incumplido').length;
  const asunto = '[ACUERDOS DE PAGO] ' + activos.length + ' activos · ' + inc + ' incumplidos · ' + fmt_(hoyISO_());
  const html = htmlInformeAcuerdos_(acs);
  MailApp.sendEmail(CONFIG.CORREO_CARTERA, asunto, 'Informe de acuerdos de pago. Abre este correo en un cliente que muestre HTML o revisa el PDF adjunto.', {
    htmlBody: html,
    cc: [CONFIG.CORREO_DIRECTOR, CONFIG.CORREO_CEO].join(','),
    name: CONFIG.NOMBRE_REMITENTE,
    attachments: [pdf_(html, 'Informe_acuerdos_' + hoyISO_())]
  });
  return { ok: true, acuerdos: activos.length, incumplidos: inc };
}

// ===================== ENVIO AUTOMATICO DIARIO =====================
/** Lo ejecuta el disparador diario. Envia ambos informes. */
function informeDiarioAutomatico() {
  const dia = Number(Utilities.formatDate(new Date(), CONFIG.ZONA, 'u')); // 1=lunes ... 7=domingo
  if (dia === 6 && !CONFIG.ENVIAR_SABADOS) return;
  if (dia === 7 && !CONFIG.ENVIAR_DOMINGOS) return;
  try { const imp = importarCarteraAutomatica(!PropertiesService.getScriptProperties().getProperty('PORTAL_ULTIMA') || PropertiesService.getScriptProperties().getProperty('PORTAL_ULTIMA').indexOf(hoyISO_()) !== 0); if (imp.errores.length) console.warn(imp.errores.join('\n')); } catch (e) { console.error('Importacion', e); }
  try { enviarInformeCartera(); } catch (e) { console.error('Informe cartera', e); avisarError_('informe de cartera', e); }
  try {
    if (leerAcuerdos_().length) enviarInformeAcuerdos();
  } catch (e) { console.error('Informe acuerdos', e); avisarError_('informe de acuerdos', e); }
}
function avisarError_(que, e) {
  try { MailApp.sendEmail(CONFIG.CORREO_CARTERA, '[ERROR] No se pudo enviar el ' + que, 'Detalle: ' + (e && e.message || e)); } catch (x) {}
}

/** Instala el disparador diario la primera vez que se usa el Web App (no hay que ejecutar nada a mano). */
function asegurarDisparador_() {
  try {
    const props = PropertiesService.getScriptProperties();
    const clave = 'DISPARADORES_V4_' + CONFIG.HORA_INFORME;
    const tr = ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction());
    if (props.getProperty(clave) && ['informeDiarioAutomatico', 'importarCarteraAutomatica'].every(f => tr.indexOf(f) >= 0) && tr.indexOf('sincronizarFleetAutomatica') < 0) return true;
    instalarDisparadores();
    props.setProperty(clave, new Date().toISOString());
    return true;
  } catch (e) { console.warn('No se pudo instalar el disparador', e); return false; }
}

/** (Opcional) instala o reinstala el envio automatico diario. El Web App ya lo hace solo. */
function instalarDisparadores() {
  // (incluye 'sincronizarFleetAutomatica' para limpiar: FleetSync tiene ahora su propio proyecto)
  ScriptApp.getProjectTriggers().filter(t => ['informeDiarioAutomatico', 'importarCarteraAutomatica', 'sincronizarFleetAutomatica'].indexOf(t.getHandlerFunction()) >= 0).forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('informeDiarioAutomatico').timeBased().everyDays(1).atHour(CONFIG.HORA_INFORME).inTimezone(CONFIG.ZONA).create();
  ScriptApp.newTrigger('importarCarteraAutomatica').timeBased().everyHours(1).create();
  carpetaImportar_();
  libro_(); // crea la hoja si no existe
  return 'Disparador diario instalado a las ' + CONFIG.HORA_INFORME + ':00 (' + CONFIG.ZONA + '). Hoja: ' + libro_().getUrl();
}

/**
 * EJECUTAR UNA VEZ desde el editor (con juridico@) despues de pegar esta version:
 * autoriza los permisos nuevos (Drive, Gmail y conexion al portal), programa todo
 * y prueba la descarga. El resultado queda en el "Registro de ejecucion".
 */
function configurarTodo() {
  verificarPermisos();
  console.log(instalarDisparadores());
  console.log('Carpeta de carga automatica: ' + carpetaImportar_().getUrl());
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('PORTAL_USUARIO')) console.warn('Falta PORTAL_USUARIO / PORTAL_CLAVE en Propiedades del script: la descarga del portal queda desactivada.');
  console.log('Importacion: ' + JSON.stringify(importarCarteraAutomatica(true)));
  tocarVersion_();
}

/**
 * Google ahora deja aceptar los permisos uno por uno; si alguno quedo sin marcar,
 * el script no vuelve a preguntar solo. Esto obliga a pedir TODOS los que falten
 * (conexion al portal, Gmail, Drive, Calendar, correo).
 */
function verificarPermisos() {
  const info = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL);
  if (info.getAuthorizationStatus() === ScriptApp.AuthorizationStatus.REQUIRED) {
    console.warn('Faltan permisos. Si no aparece la ventana, abre este enlace con juridico@ y marca "Seleccionar todo": ' + info.getAuthorizationUrl());
    ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL);
  }
  console.log('Permisos completos: portal, Gmail, Drive, Calendar y envío de correo.');
}

/** Prueba manual: envia ambos informes ya mismo. */
function probarEnvio() { console.log(enviarInformeCartera()); console.log(enviarInformeAcuerdos()); }

// ===================== UTILIDADES =====================
function hoyISO_() { return Utilities.formatDate(new Date(), CONFIG.ZONA, 'yyyy-MM-dd'); }
function fmt_(iso) { if (!iso) return '—'; const p = String(iso).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(iso); }
function fechaLarga_() { const m = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']; const p = hoyISO_().split('-'); return Number(p[2]) + ' de ' + m[Number(p[1]) - 1] + ' de ' + p[0]; }
function cop_(n) { n = Math.round(Number(n) || 0); return '$ ' + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.').replace(/^/, n < 0 ? '-' : ''); }
function esc_(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
