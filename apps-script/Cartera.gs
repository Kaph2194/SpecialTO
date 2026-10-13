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
  MAX_FILAS_CORREO: 120,           // filas de detalle en el cuerpo del correo (Gmail recorta correos >100KB; el PDF y el CSV adjuntos llevan todas las placas)
  NOTIFICAR_ACUERDOS: true,        // correo automatico (CC director y CEO) al crear, pagar o anular un acuerdo
  CLAVE: ''                        // opcional: igual a CARTERA_CLAVE en cartera.js
};

// ===================== WEB APP =====================
function doGet() {
  const disparador = asegurarDisparador_();
  return json_({ ok: true, servicio: 'cartera-specialcar', cuenta: Session.getEffectiveUser().getEmail(), disparador: disparador });
}

function doPost(e) {
  try {
    const p = JSON.parse(e.postData.contents || '{}');
    if (CONFIG.CLAVE && p.clave !== CONFIG.CLAVE) return json_({ error: 'clave invalida' });
    const disparador = asegurarDisparador_();
    switch (p.accion) {
      case 'ping':                 return json_({ ok: true, cuenta: Session.getEffectiveUser().getEmail(), disparador: disparador, placas: leerCartera_().length, hoja: libro_().getUrl() });
      case 'obtenerCartera':       return json_(obtenerTodo_());
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
    props.setProperties({ CARTERA_CORTE: p.fechaCorte || hoyISO_(), CARTERA_ARCHIVO: p.archivo || '', CARTERA_CARGA: new Date().toISOString() });
    // Historico diario para ver la evolucion de la cartera
    const hist = hoja_('Historico', ['Fecha carga', 'Fecha corte', 'Archivo', 'Placas', 'Placas con saldo', 'Total vencido']);
    const conSaldo = regs.filter(r => Number(r.valorVencido) > 0);
    hist.appendRow([new Date(), p.fechaCorte || '', p.archivo || '', regs.length, conSaldo.length, conSaldo.reduce((s, r) => s + Number(r.valorVencido), 0)]);
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
    (a.seguimientos || []).forEach(s => filas.push([s.fecha, 'Seguimiento (' + (s.tipo || '') + ')', a.placa, a.nombre, s.nota || '', '', s.proximaFecha ? 'Proximo: ' + s.proximaFecha : '', '', '', a.id]));
  });
  filas.sort((x, y) => String(x[0]).localeCompare(String(y[0])));
  if (filas.length) h.getRange(2, 1, filas.length, 10).setValues(filas);
}

function obtenerTodo_() {
  const props = PropertiesService.getScriptProperties();
  return { fechaCorte: props.getProperty('CARTERA_CORTE'), archivo: props.getProperty('CARTERA_ARCHIVO'), registros: leerCartera_(), acuerdos: leerAcuerdos_(), cuenta: Session.getEffectiveUser().getEmail() };
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
  return '<div style="' + S_.wrap + '">' +
    '<h1 style="' + S_.h1 + '">Informe diario de cartera por placa</h1>' +
    '<p style="' + S_.sub + '">Grupo Special Car — ' + fechaLarga_() + ' · Corte de cartera: ' + (corte ? fmt_(corte) : 'sin cargar') + '</p>' +
    (diasCorte !== null && diasCorte > 1 ? '<div style="' + S_.alerta + '">⚠️ La cartera no se ha actualizado desde el ' + fmt_(corte) + ' (' + diasCorte + ' días). Carga el archivo CarteraRodamientos del día en la vista Cartera.</div>' : '') +
    kpis_([[cop_(total), 'Cartera vencida', '#fef2f2', '#b91c1c'], [conSaldo.length, 'Placas con saldo', '#fffbeb', '#92400e'], [regs.length - conSaldo.length, 'Placas al día', '#f0fdf4', '#15803d'], [activos.length, 'Acuerdos activos', '#eff6ff', '#1d4ed8']]) +
    '<h2 style="' + S_.h2 + '">Resumen por empresa</h2>' +
    tabla_(['Empresa', 'Placas', 'Valor vencido'], Object.keys(porEmp).sort((a, b) => porEmp[b].v - porEmp[a].v).map(e => [esc_(e), porEmp[e].n, cop_(porEmp[e].v)]).concat([['<b>TOTAL</b>', '<b>' + conSaldo.length + '</b>', '<b>' + cop_(total) + '</b>']]), [2]) +
    '<h2 style="' + S_.h2 + '">Por periodos vencidos</h2>' +
    tabla_(['Rango', 'Placas', 'Valor'], rangos.map(x => { const l = conSaldo.filter(x[1]); return [x[0], l.length, cop_(l.reduce((s, r) => s + r.valorVencido, 0))]; }), [2]) +
    '<h2 style="' + S_.h2 + '">Detalle por placa (' + conSaldo.length + ')' + (detalle.length < conSaldo.length ? ' — se muestran las ' + detalle.length + ' de mayor valor; el detalle completo va en el PDF y el CSV adjuntos' : '') + '</h2>' +
    tabla_(['Placa', 'Afiliado', 'Empresa', 'Celular', 'Último periodo pago', '# Per.', 'Valor vencido', 'Acuerdo'],
      detalle.map(r => ['<b>' + esc_(r.placa) + '</b>', esc_(r.nombre), esc_(r.empresa), esc_(r.celular), esc_(r.ultimoPeriodo), r.periodosVencidos, cop_(r.valorVencido), acPorPlaca[r.placa] ? ESTADOS_[estadoAcuerdo_(acPorPlaca[r.placa])] : '—']), [6]) +
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
  const enc = ['Placa', 'N Interno', 'Identificacion', 'Afiliado', 'Celular', 'Correo', 'Empresa', 'Clase', 'Ultimo periodo pago', '# Periodos vencidos', '$ Valor vencido', 'Acuerdo'];
  const filas = regs.slice().sort((a, b) => b.valorVencido - a.valorVencido).map(r => [r.placa, r.numInterno, r.identificacion, r.nombre, r.celular, r.correo, r.empresa, r.clase, r.ultimoPeriodo, r.periodosVencidos, r.valorVencido, acPorPlaca[r.placa] ? ESTADOS_[estadoAcuerdo_(acPorPlaca[r.placa])] : '']);
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
    const clave = 'DISPARADOR_' + CONFIG.HORA_INFORME;
    if (props.getProperty(clave) && ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'informeDiarioAutomatico')) return true;
    instalarDisparadores();
    props.setProperty(clave, new Date().toISOString());
    return true;
  } catch (e) { console.warn('No se pudo instalar el disparador', e); return false; }
}

/** (Opcional) instala o reinstala el envio automatico diario. El Web App ya lo hace solo. */
function instalarDisparadores() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'informeDiarioAutomatico').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('informeDiarioAutomatico').timeBased().everyDays(1).atHour(CONFIG.HORA_INFORME).inTimezone(CONFIG.ZONA).create();
  libro_(); // crea la hoja si no existe
  return 'Disparador diario instalado a las ' + CONFIG.HORA_INFORME + ':00 (' + CONFIG.ZONA + '). Hoja: ' + libro_().getUrl();
}

/** Prueba manual: envia ambos informes ya mismo. */
function probarEnvio() { console.log(enviarInformeCartera()); console.log(enviarInformeAcuerdos()); }

// ===================== UTILIDADES =====================
function hoyISO_() { return Utilities.formatDate(new Date(), CONFIG.ZONA, 'yyyy-MM-dd'); }
function fmt_(iso) { if (!iso) return '—'; const p = String(iso).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(iso); }
function fechaLarga_() { const m = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']; const p = hoyISO_().split('-'); return Number(p[2]) + ' de ' + m[Number(p[1]) - 1] + ' de ' + p[0]; }
function cop_(n) { n = Math.round(Number(n) || 0); return '$ ' + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.').replace(/^/, n < 0 ? '-' : ''); }
function esc_(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
