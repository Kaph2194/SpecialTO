// =====================================================================
// GESTIONES DE COBRO POR PLACA — trazabilidad (con o sin acuerdo de pago)
// ---------------------------------------------------------------------
// Cada contacto con el afiliado queda registrado: llamó y no contestó, buzón,
// mensaje de WhatsApp enviado (con el texto exacto), correo enviado desde
// juridico@ (con el texto exacto), contestó y se comprometió, etc. Cada
// gestión puede dejar la fecha de la próxima, que aparece en la Agenda y en
// los calendarios de juridico@ y directortransporte@.
// Se guarda en la hoja de Google (pestaña "Gestiones") y se ve igual en
// cualquier navegador. Depende de cartera.js.
// =====================================================================

const MEDIOS_GESTION = ['Llamada','WhatsApp','SMS','Correo','Visita','Notificación escrita','Otro'];
const RESULTADOS_GESTION = [
  {t:'No contestó', c:'res-mal', ico:'📵'},
  {t:'Buzón de voz', c:'res-mal', ico:'📼'},
  {t:'Número errado / no existe', c:'res-mal', ico:'🚫'},
  {t:'Mensaje enviado', c:'res-info', ico:'💬'},
  {t:'Correo enviado', c:'res-info', ico:'✉️'},
  {t:'Información enviada (estado de cuenta)', c:'res-info', ico:'📄'},
  {t:'Contestó – se compromete a pagar', c:'res-ok', ico:'🤝'},
  {t:'Contestó – solicita acuerdo de pago', c:'res-ok', ico:'📝'},
  {t:'Contestó – no puede pagar', c:'res-warn', ico:'⚠️'},
  {t:'Contestó – no reconoce la deuda', c:'res-warn', ico:'❓'},
  {t:'Dice que ya pagó (verificar)', c:'res-warn', ico:'🔎'},
  {t:'Visita realizada', c:'res-info', ico:'🚶'},
  {t:'Otro', c:'res-info', ico:'•'}
];
const infoResultado = t => RESULTADOS_GESTION.find(r=>r.t===t) || {t:t||'—', c:'res-info', ico:'•'};
const RESULTADOS_SIN_CONTACTO = ['No contestó','Buzón de voz','Número errado / no existe'];

let gestiones = [];
const _gestionesPendientes = new Set();
try{ const g=localStorage.getItem('sc_gestiones_v1'); if(g){ const p=JSON.parse(g); if(Array.isArray(p)) gestiones=p; } }catch(e){}
function guardarGestionesLS(){ try{ localStorage.setItem('sc_gestiones_v1',JSON.stringify(gestiones)); }catch(e){ console.warn('LS gestiones',e); } }

const ahoraLocalInput = () => { const d=new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,16); };
const fmtFechaHora = s => { if(!s) return '—'; const d=new Date(s.length<=10?s+'T00:00:00':s); return isNaN(d)?s:d.toLocaleString('es-CO',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}); };
const fechaDeGestion = g => String(g.fecha||'').slice(0,10);

function gestionesDePlaca(placa){
  return gestiones.filter(g=>g.placa===placa).sort((a,b)=>String(b.fecha).localeCompare(String(a.fecha))||String(b.creado||'').localeCompare(String(a.creado||'')));
}
function ultimaGestion(placa){ return gestionesDePlaca(placa)[0]||null; }
function proximaGestionDe(placa){ const u=ultimaGestion(placa); return u&&u.proximaFecha||null; }

// ---------- Registro y sincronizacion ----------
function registrarGestion(datos){
  const r=cartera.registros.find(x=>x.placa===datos.placa)||{};
  const g={ id:uid('GE'), fecha:datos.fecha||new Date().toISOString(), placa:datos.placa, nombre:r.nombre||datos.nombre||'', empresa:r.empresa||'',
    medio:datos.medio||'Llamada', resultado:datos.resultado||'Otro', nota:datos.nota||'', mensaje:datos.mensaje||'',
    valorDeuda:r.valorVencido||0, periodos:r.periodosVencidos||0, proximaFecha:datos.proximaFecha||'', usuario:CARTERA_CORREOS.cartera, creado:new Date().toISOString() };
  gestiones.push(g); guardarGestionesLS();
  if(vistaActual==='cartera') renderCartera();
  sincronizarGestion(g);
  return g;
}
function sincronizarGestion(g){
  if(!CARTERA_BACKEND_ACTIVO) return Promise.resolve();
  _gestionesPendientes.add(g.id);
  return llamarBackendCartera({accion:'guardarGestion',gestion:g})
    .then(r=>{ if(r&&r.gestion){ const i=gestiones.findIndex(x=>x.id===g.id); if(i>=0) gestiones[i]={...gestiones[i],...r.gestion}; guardarGestionesLS(); } _versionBackend=null; actualizarBadgeBackend(true); })
    .catch(e=>{ console.warn(e); actualizarBadgeBackend(false); mostrarToast(/desconocida/.test(e.message)?'El backend no tiene la versión nueva: actualiza Cartera.gs':'La gestión quedó en este navegador; se subirá cuando haya conexión','error'); })
    .finally(()=>_gestionesPendientes.delete(g.id));
}
// Llamada desde cartera.js al recibir datos del backend
function aplicarGestionesBackend(lista){
  const remotos=new Set(lista.map(g=>g.id));
  const soloLocales=gestiones.filter(g=>!remotos.has(g.id));
  gestiones=lista.concat(soloLocales);
  guardarGestionesLS();
  soloLocales.filter(g=>!_gestionesPendientes.has(g.id)).forEach(sincronizarGestion);
}

// ---------- Filtros, tabla y agenda ----------
function filtroGestionOK(placa,val){
  if(!val) return true;
  const u=ultimaGestion(placa);
  const dias=u?Math.floor((Date.now()-new Date(u.fecha).getTime())/86400000):9999;
  if(val==='sin7') return dias>=7;
  if(val==='hoy') return !!u&&fechaDeGestion(u)===hoyISO();
  if(val==='sincontacto') return !!u&&RESULTADOS_SIN_CONTACTO.includes(u.resultado);
  if(val==='compromiso') return !!u&&/^Contestó – (se compromete|solicita)/.test(u.resultado);
  if(val==='nunca') return !u;
  return true;
}
function celdaUltimaGestion(placa){
  const u=ultimaGestion(placa), n=gestionesDePlaca(placa).length;
  if(!u) return '<span class="cell-n">Sin gestión</span>';
  const ir=infoResultado(u.resultado);
  return `<span class="res-tag ${ir.c}" title="${esc(u.medio)} · ${esc(u.resultado)}${u.nota?'\n'+esc(u.nota):''}">${ir.ico} ${esc(u.resultado.length>22?u.resultado.slice(0,21)+'…':u.resultado)}</span>
    <div class="td-sub">${fmtFechaHora(u.fecha)} · ${n} ${n>1?'gestiones':'gestión'}${u.proximaFecha?` · próx. ${fmtD(u.proximaFecha)}`:''}</div>`;
}
function itemsAgendaGestiones(){
  const items=[], vistas=new Set();
  gestiones.slice().sort((a,b)=>String(b.fecha).localeCompare(String(a.fecha))).forEach(g=>{
    if(vistas.has(g.placa)) return; vistas.add(g.placa);
    if(!g.proximaFecha) return;
    const r=cartera.registros.find(x=>x.placa===g.placa);
    if(r&&!(r.valorVencido>0)) return; // ya esta al dia
    items.push({tipo:'gestion',fecha:g.proximaFecha,placa:g.placa,nombre:g.nombre||(r&&r.nombre)||'',txt:`Gestión de cobro · última: ${g.resultado}`});
  });
  return items;
}

// ---------- Mensaje con el estado de cuenta ----------
function plantillaMensaje(r){
  const ac=acuerdoActivoDePlaca(r.placa);
  const nombre=(r.nombre||'').toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());
  let txt=`Cordial saludo, ${nombre}.\n\nLe escribimos del área de Cartera de Grupo Special Car respecto al vehículo de placa ${r.placa}`+(r.empresa?` (${r.empresa})`:'')+`.\n\n`+
    `Con corte al ${fmtD(cartera.fechaCorte)}, registra ${r.periodosVencidos} periodo(s) de rodamiento pendiente(s) de pago por un valor de ${fmtCOP(r.valorVencido)}.`+(r.ultimoPeriodo?` Último periodo pagado: ${r.ultimoPeriodo}.`:'')+`\n\n`;
  if(ac){ const t=totalesAcuerdo(ac); txt+=`Le recordamos el acuerdo de pago vigente: saldo ${fmtCOP(t.saldo)}`+(t.proximo?`, próxima cuota el ${fmtD(t.proximo.fecha)} por ${fmtCOP(t.proximo.valor)}`:'')+`.\n\n`; }
  else txt+=`Le agradecemos ponerse al día o comunicarse con nosotros para acordar una forma de pago.\n\n`;
  return txt+`Quedamos atentos.\nCartera – Grupo Special Car\n${CARTERA_CORREOS.cartera}`;
}

// ---------- Ventana de gestion ----------
function abrirGestion(placa){
  const r=cartera.registros.find(x=>x.placa===placa); if(!r) return;
  const ac=acuerdoActivoDePlaca(placa);
  const tel=String(r.celular||'').replace(/\D/g,'');
  const historial=[
    ...gestionesDePlaca(placa).map(g=>({...g,_tipo:'gestion'})),
    ...acuerdos.filter(a=>a.placa===placa).flatMap(a=>(a.seguimientos||[]).map(s=>({fecha:s.fecha,medio:s.tipo,resultado:s.resultado||(s.tipo==='Pago'?'Pago registrado':'Seguimiento de acuerdo'),nota:s.nota,proximaFecha:s.proximaFecha,usuario:s.usuario,_tipo:'acuerdo'})))
  ].sort((a,b)=>String(b.fecha).localeCompare(String(a.fecha)));
  const html=`
  <div class="ac-resumen">
    <div><span class="alerta-placa">${esc(r.placa)}</span> ${esc(r.nombre)} <span class="sel-estado ${ESTADOS_PLACA[estadoPlacaDe(placa)].c}">${esc(textoEstadoPlaca(placa))}</span> ${ac?`<span class="cell-doc ${ESTADO_AC[estadoAcuerdo(ac)].c}">Acuerdo ${ESTADO_AC[estadoAcuerdo(ac)].t}</span>`:''}</div>
    <div class="td-sub">${esc(r.empresa)} · CC ${esc(r.identificacion)} · ${tel?`<a href="tel:${tel}">${esc(r.celular)}</a>`:'sin celular'} · ${r.correo?esc(r.correo):'sin correo'}</div>
    <div class="ac-grid" style="margin-top:8px">
      <div><label>Deuda (corte ${fmtD(cartera.fechaCorte)})</label><b>${fmtCOP(r.valorVencido)}</b></div>
      <div><label>Periodos vencidos</label><b>${r.periodosVencidos}</b></div>
      <div><label>Último periodo pago</label><b>${esc(r.ultimoPeriodo||'—')}</b></div>
      <div><label>Gestiones registradas</label><b>${historial.length}</b></div>
    </div>
  </div>

  <div class="form-sect">Registro rápido de una llamada</div>
  <div class="gest-rapida">
    ${['No contestó','Buzón de voz','Número errado / no existe'].map(t=>`<button class="btn btn-sm btn-outline-dark" onclick="gestionRapida('${esc(placa)}','${t}')">${infoResultado(t).ico} ${t}</button>`).join('')}
    <span class="td-sub">Queda con fecha y hora de ahora; la próxima gestión se toma del campo de abajo si lo llenas.</span>
  </div>

  <div class="form-sect">Enviar información al afiliado (queda registrado el texto enviado)</div>
  <textarea id="gs_mensaje" class="gest-mensaje" rows="7">${esc(plantillaMensaje(r))}</textarea>
  <div class="gest-envio">
    <button class="btn btn-sm btn-wa" ${tel?'':'disabled title="Sin celular"'} onclick="enviarWhatsAppGestion('${esc(placa)}')">💬 Abrir WhatsApp y registrar</button>
    <button class="btn btn-sm btn-dark" ${r.correo?'':'disabled title="Sin correo"'} onclick="enviarCorreoGestion('${esc(placa)}')">✉️ ${CARTERA_BACKEND_ACTIVO?'Enviar correo desde juridico@':'Abrir correo'} y registrar</button>
  </div>

  <div class="form-sect">Registrar gestión</div>
  <div class="form-grid form-grid-3">
    <div class="form-group"><label>Fecha y hora</label><input type="datetime-local" id="gs_fecha" value="${ahoraLocalInput()}" data-inicial="${ahoraLocalInput()}"/></div>
    <div class="form-group"><label>Medio</label><select id="gs_medio">${MEDIOS_GESTION.map(m=>`<option>${m}</option>`).join('')}</select></div>
    <div class="form-group"><label>Resultado</label><select id="gs_resultado"><option value="">— Selecciona —</option>${RESULTADOS_GESTION.map(o=>`<option>${o.t}</option>`).join('')}</select></div>
  </div>
  <div class="form-grid" style="margin-top:10px;grid-template-columns:2fr 1fr">
    <div class="form-group"><label>Detalle / lo que dijo el afiliado</label><textarea id="gs_nota" rows="2" placeholder="Ej: dice que paga el viernes; pidió que le enviaran el estado de cuenta"></textarea></div>
    <div class="form-group"><label>Próxima gestión</label><input type="date" id="gs_prox" value="${isoDe(new Date(Date.now()+2*86400000))}"/><span class="td-sub">Se agenda en la Agenda y en los calendarios</span></div>
  </div>

  <div class="form-sect">Historial de gestiones (${historial.length})</div>
  <div class="hist-seg hist-gest">${historial.map(h=>{ const ir=infoResultado(h.resultado); return `
    <div class="seg-item"><div class="seg-fecha">${fmtFechaHora(h.fecha)}<small>${esc(h.medio||'')}${h._tipo==='acuerdo'?' · acuerdo':''}</small></div>
      <div class="seg-nota"><span class="res-tag ${ir.c}">${ir.ico} ${esc(h.resultado)}</span>${h.nota?`<div>${esc(h.nota)}</div>`:''}
        ${h.mensaje?`<details><summary class="td-sub">Ver información enviada</summary><pre class="msg-enviado">${esc(h.mensaje)}</pre></details>`:''}
        <div class="td-sub">${h.proximaFecha?`Próxima gestión: ${fmtD(h.proximaFecha)} · `:''}${esc(h.usuario||'')}${h.valorDeuda?` · deuda en ese momento ${fmtCOP(h.valorDeuda)}`:''}</div></div></div>`; }).join('')||'<div class="cell-n" style="padding:8px">Aún no hay gestiones registradas para esta placa</div>'}</div>`;
  const btns=`${!ac&&r.valorVencido>0?`<button class="btn btn-outline-dark" onclick="cerrarModalCartera();abrirNuevoAcuerdo('${esc(placa)}')">🤝 Crear acuerdo</button>`:''}
    ${ac?`<button class="btn btn-outline-dark" onclick="cerrarModalCartera();abrirSeguimiento('${ac.id}')">🤝 Ver acuerdo</button>`:''}
    <button class="btn btn-primary btn-primary-dark" onclick="guardarGestionForm('${esc(placa)}')">💾 Guardar gestión</button>`;
  abrirModalCartera(`Gestión de cobro — ${placa}`,html,btns);
}
function _proxForm(){ const e=document.getElementById('gs_prox'); return e?e.value:''; }
function gestionRapida(placa,resultado){
  registrarGestion({placa,medio:'Llamada',resultado,proximaFecha:_proxForm()});
  mostrarToast(`${placa}: "${resultado}" registrado`,'success');
  abrirGestion(placa);
}
function guardarGestionForm(placa){
  const resultado=document.getElementById('gs_resultado').value;
  if(!resultado){ mostrarToast('Selecciona el resultado de la gestión','error'); return; }
  const inp=document.getElementById('gs_fecha'), f=inp.value;
  // si no se cambio la hora del formulario, se usa la hora exacta de ahora (con segundos)
  registrarGestion({placa,fecha:f&&f!==inp.dataset.inicial?new Date(f).toISOString():null,medio:document.getElementById('gs_medio').value,resultado,nota:document.getElementById('gs_nota').value.trim(),proximaFecha:_proxForm()});
  mostrarToast(`Gestión registrada para ${placa}`,'success');
  abrirGestion(placa);
}
function enviarWhatsAppGestion(placa){
  const r=cartera.registros.find(x=>x.placa===placa); if(!r) return;
  let tel=String(r.celular||'').replace(/\D/g,''); if(tel.length===10) tel='57'+tel;
  const msg=document.getElementById('gs_mensaje').value.trim();
  window.open(`https://wa.me/${tel}?text=${encodeURIComponent(msg)}`,'_blank','noopener');
  registrarGestion({placa,medio:'WhatsApp',resultado:'Mensaje enviado',mensaje:msg,nota:`WhatsApp a ${r.celular}`,proximaFecha:_proxForm()});
  mostrarToast('Se abrió WhatsApp con el mensaje y quedó registrado','success');
  abrirGestion(placa);
}
async function enviarCorreoGestion(placa){
  const r=cartera.registros.find(x=>x.placa===placa); if(!r||!r.correo) return;
  const cuerpo=document.getElementById('gs_mensaje').value.trim();
  const asunto=`Estado de cuenta rodamiento – vehículo ${r.placa} – Grupo Special Car`;
  const prox=_proxForm();
  if(!CARTERA_BACKEND_ACTIVO){
    window.location.href=`mailto:${encodeURIComponent(r.correo)}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;
    registrarGestion({placa,medio:'Correo',resultado:'Correo enviado',mensaje:`Para: ${r.correo}\nAsunto: ${asunto}\n\n${cuerpo}`,proximaFecha:prox});
    abrirGestion(placa); return;
  }
  if(!confirm(`¿Enviar el correo a ${r.correo} desde ${CARTERA_CORREOS.cartera}?`)) return;
  const g={ id:uid('GE'), fecha:new Date().toISOString(), placa, nombre:r.nombre, empresa:r.empresa, medio:'Correo', resultado:'Correo enviado',
    nota:`Correo a ${r.correo}`, mensaje:`Para: ${r.correo}\nAsunto: ${asunto}\n\n${cuerpo}`, valorDeuda:r.valorVencido, periodos:r.periodosVencidos,
    proximaFecha:prox, usuario:CARTERA_CORREOS.cartera, creado:new Date().toISOString() };
  try{
    mostrarToast('Enviando correo…','info');
    const resp=await llamarBackendCartera({accion:'enviarCorreoAfiliado',para:r.correo,asunto,cuerpo,gestion:g});
    gestiones.push(resp&&resp.gestion?resp.gestion:g); guardarGestionesLS(); _versionBackend=null;
    mostrarToast(`Correo enviado a ${r.correo} y registrado`,'success');
    abrirGestion(placa); if(vistaActual==='cartera') renderCartera();
  }catch(e){ mostrarToast(/desconocida/.test(e.message)?'El backend no tiene la versión nueva: actualiza Cartera.gs':'No se pudo enviar: '+e.message,'error'); }
}
