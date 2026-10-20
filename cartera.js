// =====================================================================
// MODULO DE CARTERA — SpecialCar
// ---------------------------------------------------------------------
// - Vista de cartera por placa (valores vencidos segun el archivo
//   "CarteraRodamientos" que exporta el sistema).
// - Acuerdos de pago con compromisos (cuotas) por fecha y seguimientos.
// - Agenda de fechas (compromisos y proximos seguimientos).
// - Informe diario de cartera (juridico@ con copia a directortransporte@)
//   e informe de acuerdos (con copia adicional a ceo@).
//
// Backend: Google Apps Script propio de cartera (apps-script/Cartera.gs),
// implementado DESDE LA CUENTA juridico@specialcar.com.co para que los
// correos salgan de ese buzon y los eventos queden en su calendario con
// directortransporte@ como invitado (ver CARTERA_SETUP.md).
// Mientras CARTERA_WEBAPP_URL no este configurada, todo funciona en modo
// local (este navegador) y los informes se envian con el cliente de correo.
// =====================================================================

// URL del Web App de cartera (Apps Script implementado desde juridico@).
// Se puede pegar aqui (queda para todos los equipos) o desde el boton
// "⚙️ Conectar" de la vista Cartera (queda guardada en ese navegador).
const CARTERA_WEBAPP_URL_FIJA = 'https://script.google.com/macros/s/AKfycby5nBCRwjooN0VU4fUnXfgJr2DRNUpFALZ0Bc-qNTG8t5eKNNu4D_axKt7bd1WjmApt/exec';
function _urlCarteraGuardada(){ try{ return localStorage.getItem('sc_cartera_url')||''; }catch(e){ return ''; } }
let CARTERA_WEBAPP_URL = CARTERA_WEBAPP_URL_FIJA.startsWith('https://') ? CARTERA_WEBAPP_URL_FIJA : _urlCarteraGuardada();
let CARTERA_BACKEND_ACTIVO = /^https:\/\/script\.google(usercontent)?\.com\//.test(CARTERA_WEBAPP_URL);
// Clave de acceso: NO se escribe en el codigo (el repositorio es publico). Si el backend tiene
// la propiedad CLAVE_APP, la app la pide una vez por navegador y la recuerda.
function _claveCartera(){ try{ return localStorage.getItem('sc_cartera_clave')||''; }catch(e){ return ''; } }

const CARTERA_CORREOS = {
  cartera:  'juridico@specialcar.com.co',
  director: 'directortransporte@specialcar.com.co',
  ceo:      'ceo@specialcar.com.co'
};

// ===== ESTADO =====
let cartera = { fechaCorte: (typeof CARTERA_FECHA_CORTE!=='undefined'?CARTERA_FECHA_CORTE:null), archivo: 'CarteraRodamientos (inicial)', registros: (typeof CARTERA_DATA!=='undefined'?JSON.parse(JSON.stringify(CARTERA_DATA)):[]) };
let acuerdos = [];
let estadosPlaca = {};          // placa -> {estado, radicado, fecha, usuario}
let infoCarga = {};             // {cargado, origen, carpeta}
let carteraTab = 'placas';
let carteraFiltrada = [];
let carteraOrden = { campo: 'valorVencido', dir: -1 };
let _acuerdoEnEdicion = null;   // copia de trabajo en el modal

// ===== UTILIDADES =====
const fmtCOP = n => new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(n)||0);
const esc = s => String(s===null||s===undefined?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const isoDe = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const hoyISO = () => isoDe(new Date());
const uid = p => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`;
function sumarPeriodo(iso, periodicidad, n){
  const d = parseD(iso); if(!d) return null;
  if(periodicidad==='semanal') d.setDate(d.getDate()+7*n);
  else if(periodicidad==='quincenal') d.setDate(d.getDate()+15*n);
  else { const dia=d.getDate(); d.setDate(1); d.setMonth(d.getMonth()+n); const ult=new Date(d.getFullYear(),d.getMonth()+1,0).getDate(); d.setDate(Math.min(dia,ult)); }
  return isoDe(d);
}
function rangoMora(p){ p=Number(p)||0; if(p<=0) return 'al_dia'; if(p===1) return 'r1'; if(p<=3) return 'r2_3'; if(p<=6) return 'r4_6'; return 'r7'; }
const RANGOS = { al_dia:'Al día', r1:'1 periodo', r2_3:'2–3 periodos', r4_6:'4–6 periodos', r7:'Más de 6' };
const RANGO_CLS = { al_dia:'cell-g', r1:'cell-y', r2_3:'cell-o', r4_6:'cell-r', r7:'cell-r cell-rr' };

// ===== ESTADO DE GESTION POR PLACA =====
const ESTADOS_PLACA = { activo:{t:'Activo',c:'est-activo'}, notificado:{t:'Notificado',c:'est-notificado'}, desvinculacion:{t:'Desvinculación',c:'est-desvinc'}, radicado:{t:'Radicado',c:'est-radicado'} };
const estadoPlacaDe = placa => (estadosPlaca[placa]||{}).estado||'activo';
const radicadoDe = placa => (estadosPlaca[placa]||{}).radicado||'';
const textoEstadoPlaca = placa => ESTADOS_PLACA[estadoPlacaDe(placa)].t+(radicadoDe(placa)?` #${radicadoDe(placa)}`:'');
function cambiarEstadoPlaca(placa, estado){
  const ant=estadosPlaca[placa]||{};
  estadosPlaca[placa]={...ant,estado,radicado:estado==='radicado'?(ant.radicado||''):'',fecha:new Date().toISOString(),usuario:CARTERA_CORREOS.cartera};
  guardarEstadosLS(); renderCartera();
  if(estado==='radicado'&&!estadosPlaca[placa].radicado){ const i=document.getElementById('rad_'+placa); if(i){ i.focus(); } mostrarToast(`Escribe el número de radicado de ${placa}`,'info'); }
  sincronizarEstado(placa);
}
function cambiarRadicado(placa, valor){
  const e=estadosPlaca[placa]; if(!e||e.estado!=='radicado') return;
  e.radicado=String(valor||'').trim(); e.fecha=new Date().toISOString();
  guardarEstadosLS();
  const inp=document.getElementById('rad_'+placa); if(inp) inp.classList.toggle('rad-falta',!e.radicado);
  sincronizarEstado(placa);
}

// ===== LOGICA DE ACUERDOS =====
function totalesAcuerdo(a){
  const comps=a.compromisos||[];
  const pagado=comps.filter(c=>c.pagado).reduce((s,c)=>s+(Number(c.valorPagado)||Number(c.valor)||0),0);
  const pendientes=comps.filter(c=>!c.pagado).sort((x,y)=>x.fecha.localeCompare(y.fecha));
  const vencidos=pendientes.filter(c=>diasR(c.fecha)<0);
  const ultimoSeg=(a.seguimientos||[]).slice().sort((x,y)=>(y.fecha||'').localeCompare(x.fecha||'')||(y.creado||'').localeCompare(x.creado||''))[0]||null;
  return { pagado, saldo:Math.max((Number(a.valorAcordado)||0)-pagado,0), pendientes, vencidos, proximo:pendientes[0]||null, ultimoSeg, proximoSeguimiento: ultimoSeg&&ultimoSeg.proximaFecha||null };
}
function estadoAcuerdo(a){
  if(a.estado==='anulado') return 'anulado';
  const t=totalesAcuerdo(a);
  if((a.compromisos||[]).length && t.pendientes.length===0) return 'cumplido';
  if(t.vencidos.length) return 'incumplido';
  return 'vigente';
}
const ESTADO_AC = {
  vigente:{t:'Vigente',c:'cell-g'}, incumplido:{t:'Incumplido',c:'cell-r'},
  cumplido:{t:'Cumplido',c:'cell-b'}, anulado:{t:'Anulado',c:'cell-n'}
};
function acuerdosDePlaca(placa){ return acuerdos.filter(a=>a.placa===placa); }
function acuerdoActivoDePlaca(placa){ return acuerdos.find(a=>a.placa===placa && ['vigente','incumplido'].includes(estadoAcuerdo(a))); }

// ===== PERSISTENCIA LOCAL =====
function guardarCarteraLS(){
  try{ localStorage.setItem('sc_cartera_v1',JSON.stringify(cartera)); }catch(e){ console.warn('LS cartera',e); }
}
function guardarEstadosLS(){
  try{ localStorage.setItem('sc_estados_placa_v1',JSON.stringify(estadosPlaca)); }catch(e){ console.warn('LS estados',e); }
}
function guardarAcuerdosLS(){
  try{ localStorage.setItem('sc_acuerdos_v1',JSON.stringify(acuerdos)); }catch(e){ console.warn('LS acuerdos',e); }
}
function cargarCarteraLS(){
  try{
    const c=localStorage.getItem('sc_cartera_v1');
    if(c){ const p=JSON.parse(c); if(p&&Array.isArray(p.registros)&&p.registros.length&&(!cartera.fechaCorte||!p.fechaCorte||p.fechaCorte>=cartera.fechaCorte)) cartera=p; }
    const a=localStorage.getItem('sc_acuerdos_v1');
    if(a){ const p=JSON.parse(a); if(Array.isArray(p)) acuerdos=p; }
    const e=localStorage.getItem('sc_estados_placa_v1');
    if(e){ const p=JSON.parse(e); if(p&&typeof p==='object') estadosPlaca=p; }
  }catch(e){ console.warn(e); }
}

// ===== BACKEND DE CARTERA =====
let _pidiendoClave=null;
async function llamarBackendCartera(payload,_reintento){
  if(!CARTERA_BACKEND_ACTIVO) throw new Error('backend de cartera no configurado');
  const resp=await fetch(CARTERA_WEBAPP_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({...payload,clave:_claveCartera()})});
  const data=await resp.json();
  if(data&&data.error==='clave invalida'&&!_reintento){
    // Una sola ventana aunque haya varias llamadas en curso
    _pidiendoClave=_pidiendoClave||new Promise(res=>setTimeout(()=>{
      const c=prompt('Clave de acceso a la cartera (la entrega juridico@specialcar.com.co). Se pide una sola vez en este navegador:');
      try{ if(c) localStorage.setItem('sc_cartera_clave',c.trim()); }catch(e){}
      res(!!c);
    },0)).finally(()=>setTimeout(()=>{_pidiendoClave=null;},0));
    if(await _pidiendoClave) return llamarBackendCartera(payload,true);
  }
  if(data&&data.error) throw new Error(data.error==='clave invalida'?'Clave de acceso incorrecta':data.error);
  return data;
}
// ===== SINCRONIZACION ENTRE NAVEGADORES =====
// La hoja de Google de juridico@ es la fuente de verdad. Al abrir la app, cada minuto,
// y al volver a la pestaña, se pregunta al backend si hubo cambios (version) y solo
// entonces se descarga todo. Los cambios propios que aun no se confirman se protegen.
let _versionBackend=null, _ultimaSync=null, _syncEnCurso=null;
const _acuerdosPendientes=new Set(), _estadosPendientes=new Set();
async function cargarCarteraDesdeBackend(forzar){
  if(!CARTERA_BACKEND_ACTIVO) return;
  if(_syncEnCurso) return _syncEnCurso;
  _syncEnCurso=(async()=>{
    try{
      const r=await llamarBackendCartera({accion:'obtenerCartera',version:forzar?null:_versionBackend});
      _ultimaSync=new Date();
      if(r.sinCambios){ actualizarBadgeBackend(true); return; }
      _cuentaBackend=r.cuenta||_cuentaBackend;
      _versionBackend=r.version||null;
      infoCarga={cargado:r.cargado,origen:r.origen,carpeta:r.carpeta};
      let cambio=false;
      if(r.registros&&r.registros.length){
        if(cartera.registros.length&&cartera.fechaCorte&&r.fechaCorte&&cartera.fechaCorte>r.fechaCorte&&!cartera._delBackend){
          // este navegador tiene un corte mas nuevo que nunca se subio: se sube
          llamarBackendCartera({accion:'guardarCartera',fechaCorte:cartera.fechaCorte,archivo:cartera.archivo,registros:cartera.registros}).catch(e=>console.warn(e));
        }else{ cartera={fechaCorte:r.fechaCorte,archivo:r.archivo,registros:r.registros,_delBackend:true}; guardarCarteraLS(); cambio=true; }
      }else if(cartera.registros.length){
        llamarBackendCartera({accion:'guardarCartera',fechaCorte:cartera.fechaCorte,archivo:cartera.archivo,registros:cartera.registros}).then(()=>mostrarToast('Cartera de este navegador subida a la hoja compartida','success')).catch(e=>console.warn(e));
      }
      if(Array.isArray(r.acuerdos)){
        const remotos=new Map(r.acuerdos.map(x=>[x.id,x]));
        const soloLocales=acuerdos.filter(x=>!remotos.has(x.id));
        acuerdos=r.acuerdos.map(x=>_acuerdosPendientes.has(x.id)?(acuerdos.find(y=>y.id===x.id)||x):x).concat(soloLocales);
        guardarAcuerdosLS(); cambio=true;
        soloLocales.filter(x=>!_acuerdosPendientes.has(x.id)).forEach(x=>sincronizarAcuerdo(x));
      }
      if(r.estados&&typeof r.estados==='object'){
        const locales=estadosPlaca; estadosPlaca={...r.estados};
        _estadosPendientes.forEach(p=>{ if(locales[p]) estadosPlaca[p]=locales[p]; });
        // estados guardados solo en este navegador (antes de conectar) se suben
        Object.keys(locales).filter(p=>!r.estados[p]&&!_estadosPendientes.has(p)).forEach(p=>{ estadosPlaca[p]=locales[p]; sincronizarEstado(p); });
        guardarEstadosLS(); cambio=true;
      }
      if(cambio){ cargarEmpresasCartera(); refrescarVistaCartera(); }
      actualizarBadgeBackend(true);
    }catch(e){ console.warn('No se pudo leer cartera del backend',e); actualizarBadgeBackend(false); }
    finally{ _syncEnCurso=null; }
  })();
  return _syncEnCurso;
}
// Re-pinta sin interrumpir: si hay un modal abierto o se esta escribiendo, espera.
let _renderPendiente=false;
function refrescarVistaCartera(){
  if(vistaActual!=='cartera') return;
  const ocupado=!document.getElementById('modalCartera').classList.contains('hidden')||(document.activeElement&&document.activeElement.closest&&document.activeElement.closest('#vista-cartera')&&/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName));
  if(ocupado){ _renderPendiente=true; return; }
  _renderPendiente=false; renderCartera();
}
function sincronizarEstado(placa){
  if(!CARTERA_BACKEND_ACTIVO) return Promise.resolve();
  _estadosPendientes.add(placa);
  const e=estadosPlaca[placa]||{estado:'activo'};
  return llamarBackendCartera({accion:'guardarEstadoPlaca',placa,estado:e.estado,radicado:e.radicado,usuario:CARTERA_CORREOS.cartera})
    .then(()=>{ _estadosPendientes.delete(placa); _versionBackend=null; actualizarBadgeBackend(true); })
    .catch(err=>{ console.warn(err); _estadosPendientes.delete(placa); actualizarBadgeBackend(false);
      mostrarToast(/desconocida/.test(err.message)?'El backend no tiene la versión nueva: actualiza Cartera.gs (ver CARTERA_SETUP.md)':`El estado de ${placa} quedó en este navegador, pero no se pudo guardar en la hoja compartida`,'error'); });
}
async function importarDelPortalAhora(){
  if(!CARTERA_BACKEND_ACTIVO){ mostrarToast('Requiere la conexión con el backend','error'); return; }
  mostrarToast('Buscando el reporte en el portal, el correo y la carpeta… (puede tardar 1 minuto)','info');
  try{
    const r=await llamarBackendCartera({accion:'importarAhora'});
    await cargarCarteraDesdeBackend(true);
    if(r.cargado) mostrarToast(`Cartera actualizada: ${r.cargado.archivo} · corte ${fmtD(r.cargado.fechaCorte)} · ${r.cargado.placas} placas`,'success');
    else mostrarToast(r.errores&&r.errores.length?`No se cargó: ${r.errores[0]}`:'No había reportes nuevos','error');
  }catch(e){ mostrarToast(/desconocida/.test(e.message)?'El backend no tiene la versión nueva: actualiza Cartera.gs':'Error: '+e.message,'error'); }
}
// Sincroniza un acuerdo con el backend (Sheet + calendarios). Las llamadas de un
// mismo acuerdo se encadenan para que la segunda ya lleve los eventId que devolvio
// la primera y no se dupliquen eventos en el calendario.
const _colaSync={};
function sincronizarAcuerdo(a){
  guardarAcuerdosLS();
  if(!CARTERA_BACKEND_ACTIVO) return Promise.resolve();
  const id=a.id;
  _acuerdosPendientes.add(id);
  _colaSync[id]=(_colaSync[id]||Promise.resolve()).then(async()=>{
    const actual=acuerdos.find(x=>x.id===id); if(!actual) return;
    const enviados=(actual._eventosAEliminar||[]).slice();
    try{
      const r=await llamarBackendCartera({accion:'guardarAcuerdo',acuerdo:actual});
      const loc=acuerdos.find(x=>x.id===id);
      if(r&&r.acuerdo&&loc){
        const ev={}; (r.acuerdo.compromisos||[]).forEach(c=>{ if(c.eventId) ev[c.id]=c.eventId; });
        (loc.compromisos||[]).forEach(c=>{ if(ev[c.id]) c.eventId=ev[c.id]; });
        loc.eventoSeguimientoId=r.acuerdo.eventoSeguimientoId; loc.eventosSincronizados=r.acuerdo.eventosSincronizados;
        if(loc._eventosAEliminar){ loc._eventosAEliminar=loc._eventosAEliminar.filter(x=>!enviados.includes(x)); if(!loc._eventosAEliminar.length) delete loc._eventosAEliminar; }
        guardarAcuerdosLS();
      }
      _acuerdosPendientes.delete(id); _versionBackend=null;
      mostrarToast(`Acuerdo ${actual.placa} sincronizado en Sheets y calendarios`,'success');
      actualizarBadgeBackend(true);
      if(vistaActual==='cartera') renderCartera();
    }catch(e){ console.warn(e); _acuerdosPendientes.delete(id); actualizarBadgeBackend(false); mostrarToast('El acuerdo quedó guardado en este navegador, pero no se pudo sincronizar con el backend','error'); }
  });
  return _colaSync[id];
}
function actualizarBadgeBackend(ok){
  const el=document.getElementById('cartera-backend-info'); if(!el) return;
  if(!CARTERA_BACKEND_ACTIVO){ el.innerHTML='<span class="dot dot-y"></span> Sin conexión automática (calendario y correos) — <button class="link-btn" onclick="conectarBackendCartera()">⚙️ Conectar</button>'; return; }
  const hora=_ultimaSync?_ultimaSync.toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'}):'';
  const carga=infoCarga.cargado?` · Última carga ${new Date(infoCarga.cargado).toLocaleString('es-CO',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}${infoCarga.origen?' ('+esc(infoCarga.origen)+')':''}`:'';
  el.innerHTML=ok===false?'<span class="dot dot-r"></span> Sin respuesta del backend — mostrando lo último guardado en este navegador · <button class="link-btn" onclick="cargarCarteraDesdeBackend(true)">Reintentar</button>'
    :`<span class="dot dot-g"></span> Sincronizado${hora?' '+hora:''} · calendario y correos desde ${esc(_cuentaBackend||CARTERA_CORREOS.cartera)}${carga}${infoCarga.carpeta?` · <a class="link-btn" href="${esc(infoCarga.carpeta)}" target="_blank" rel="noopener">📁 Carpeta de carga</a>`:''}`;
}
let _cuentaBackend='';
// Conecta la app con el Web App de cartera sin editar codigo: pide la URL, la prueba y la guarda.
async function conectarBackendCartera(){
  const url=(prompt('Pega la URL del Web App de cartera (termina en /exec).\nSe obtiene al implementar apps-script/Cartera.gs desde la cuenta juridico@specialcar.com.co — ver CARTERA_SETUP.md.\nDeja vacío para desconectar.',CARTERA_WEBAPP_URL||'')||'').trim();
  if(url===''){ try{localStorage.removeItem('sc_cartera_url');}catch(e){} CARTERA_WEBAPP_URL=''; CARTERA_BACKEND_ACTIVO=false; actualizarBadgeBackend(); renderCartera(); return; }
  if(!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(url)){ mostrarToast('La URL debe ser https://script.google.com/macros/s/.../exec','error'); return; }
  const antes=[CARTERA_WEBAPP_URL,CARTERA_BACKEND_ACTIVO];
  CARTERA_WEBAPP_URL=url; CARTERA_BACKEND_ACTIVO=true;
  try{
    mostrarToast('Probando conexión...','info');
    const r=await llamarBackendCartera({accion:'ping'});
    _cuentaBackend=r.cuenta||'';
    try{ localStorage.setItem('sc_cartera_url',url); }catch(e){}
    if(_cuentaBackend && _cuentaBackend.toLowerCase()!==CARTERA_CORREOS.cartera) mostrarToast(`Conectado, pero el backend corre como ${_cuentaBackend}: los correos y eventos saldrán de esa cuenta, no de ${CARTERA_CORREOS.cartera}`,'error');
    else mostrarToast(`Conectado. Envío diario ${r.disparador?'programado':'pendiente'} · calendario y correos automáticos`,'success');
    await cargarCarteraDesdeBackend();
    // Si el backend aun no tiene cartera, se sube la que hay en este navegador
    if(r.placas===0 && cartera.registros.length) await llamarBackendCartera({accion:'guardarCartera',fechaCorte:cartera.fechaCorte,archivo:cartera.archivo,registros:cartera.registros});
  }catch(e){
    console.warn(e); [CARTERA_WEBAPP_URL,CARTERA_BACKEND_ACTIVO]=antes;
    mostrarToast('No respondió el Web App. Revisa que esté implementado con acceso "Cualquier usuario"','error');
  }
  actualizarBadgeBackend(CARTERA_BACKEND_ACTIVO?true:undefined); renderCartera();
}

// ===== RENDER PRINCIPAL =====
function renderCartera(){
  const regs=cartera.registros;
  const conSaldo=regs.filter(r=>r.valorVencido>0);
  const total=conSaldo.reduce((s,r)=>s+r.valorVencido,0);
  const activos=acuerdos.filter(a=>['vigente','incumplido'].includes(estadoAcuerdo(a)));
  const valorAcuerdos=activos.reduce((s,a)=>s+totalesAcuerdo(a).saldo,0);
  const incumplidos=activos.filter(a=>estadoAcuerdo(a)==='incumplido').length;
  const hoyItems=itemsAgenda().filter(i=>i.fecha===hoyISO()).length;

  document.getElementById('c-total').textContent=fmtCOP(total);
  document.getElementById('c-placas').textContent=conSaldo.length;
  document.getElementById('c-placas-sub').textContent=`de ${regs.length} placas · ${regs.length-conSaldo.length} al día`;
  document.getElementById('c-acuerdos').textContent=activos.length;
  document.getElementById('c-acuerdos-sub').textContent=`${fmtCOP(valorAcuerdos)} por recaudar`;
  document.getElementById('c-incumplidos').textContent=incumplidos;
  document.getElementById('c-hoy-sub').textContent=`${hoyItems} gestión(es) agendada(s) para hoy`;
  document.getElementById('cartera-corte').textContent=cartera.fechaCorte?`Corte de cartera: ${fmtD(cartera.fechaCorte)} · ${cartera.archivo||''}`:'Sin archivo de cartera cargado';
  const diasCorte=cartera.fechaCorte?-diasR(cartera.fechaCorte):null;
  document.getElementById('cartera-corte').classList.toggle('corte-viejo',diasCorte!==null&&diasCorte>1);

  // Resumen por empresa
  const porEmp={};
  conSaldo.forEach(r=>{ porEmp[r.empresa]=porEmp[r.empresa]||{n:0,v:0}; porEmp[r.empresa].n++; porEmp[r.empresa].v+=r.valorVencido; });
  const emps=Object.entries(porEmp).sort((a,b)=>b[1].v-a[1].v);
  const maxV=Math.max(1,...emps.map(e=>e[1].v));
  document.getElementById('cartera-empresas').innerHTML=emps.map(([e,o])=>`
    <div class="emp-row" onclick="filtrarCarteraEmpresa('${esc(e).replace(/'/g,"\\'")}')" title="Filtrar por ${esc(e)}">
      <span class="emp-name">${esc(e)}</span>
      <div class="stat-bar-track"><div class="stat-bar-fill fill-r" style="width:${Math.round(o.v/maxV*100)}%"></div></div>
      <span class="emp-val">${fmtCOP(o.v)}</span><span class="emp-n">${o.n} placas</span>
    </div>`).join('')||'<div class="empty-msg">Sin cartera vencida</div>';

  // Por rango de mora
  const porR={}; Object.keys(RANGOS).forEach(k=>porR[k]={n:0,v:0});
  regs.forEach(r=>{const k=rangoMora(r.periodosVencidos);porR[k].n++;porR[k].v+=r.valorVencido;});
  document.getElementById('cartera-rangos').innerHTML=Object.entries(RANGOS).map(([k,t])=>`
    <button class="rango-chip ${document.getElementById('cFiltroRango').value===k?'activo':''}" onclick="filtrarCarteraRango('${k}')">
      <span class="cell-doc ${RANGO_CLS[k]}">${t}</span><strong>${porR[k].n}</strong><small>${fmtCOP(porR[k].v)}</small>
    </button>`).join('');

  // Conteo por estado de gestion (en el filtro y en la tarjeta de rangos)
  const porEst={}; Object.keys(ESTADOS_PLACA).forEach(k=>porEst[k]={n:0,v:0});
  regs.forEach(r=>{ const k=estadoPlacaDe(r.placa); porEst[k].n++; porEst[k].v+=r.valorVencido; });
  const selE=document.getElementById('cFiltroEstado'), valE=selE.value;
  selE.innerHTML='<option value="">Estado: todos</option>'+Object.entries(ESTADOS_PLACA).map(([k,o])=>`<option value="${k}">${o.t} (${porEst[k].n})</option>`).join(''); selE.value=valE;
  document.getElementById('cartera-estados').innerHTML=Object.entries(ESTADOS_PLACA).map(([k,o])=>`
    <button class="estado-chip ${valE===k?'activo':''}" onclick="filtrarCarteraEstado('${k}')"><span class="sel-estado ${o.c}">${o.t}</span><strong>${porEst[k].n}</strong><small>${fmtCOP(porEst[k].v)}</small></button>`).join('');
  ['placas','acuerdos','agenda'].forEach(t=>{
    document.getElementById(`ctab-${t}`).classList.toggle('activo',carteraTab===t);
    document.getElementById(`cpanel-${t}`).classList.toggle('hidden',carteraTab!==t);
  });
  document.getElementById('ctab-acuerdos').querySelector('.tab-n').textContent=activos.length;
  document.getElementById('ctab-agenda').querySelector('.tab-n').textContent=itemsAgenda().filter(i=>i.fecha<=hoyISO()).length;

  if(carteraTab==='placas') renderTablaCartera();
  if(carteraTab==='acuerdos') renderAcuerdos();
  if(carteraTab==='agenda') renderAgenda();
}
function irATabCartera(t){ carteraTab=t; renderCartera(); }

function cargarEmpresasCartera(){
  const sel=document.getElementById('cFiltroEmpresa'); const val=sel.value;
  sel.innerHTML='<option value="">Todas las empresas</option>'+[...new Set(cartera.registros.map(r=>r.empresa))].filter(Boolean).sort().map(e=>`<option value="${esc(e)}">${esc(e)}</option>`).join('');
  sel.value=val;
}
function filtrarCarteraEmpresa(e){ carteraTab='placas'; document.getElementById('cFiltroEmpresa').value=e; renderCartera(); }
function filtrarCarteraRango(k){ carteraTab='placas'; const s=document.getElementById('cFiltroRango'); s.value=s.value===k?'':k; if(k==='al_dia'&&s.value) document.getElementById('cSoloSaldo').checked=false; renderCartera(); }
function filtrarCarteraEstado(k){ carteraTab='placas'; const s=document.getElementById('cFiltroEstado'); s.value=s.value===k?'':k; if(s.value) document.getElementById('cSoloSaldo').checked=false; renderCartera(); }
function limpiarFiltrosCartera(){ ['cBuscador','cFiltroEmpresa','cFiltroRango','cFiltroAcuerdo','cFiltroEstado'].forEach(id=>document.getElementById(id).value=''); document.getElementById('cSoloSaldo').checked=true; renderCartera(); }
function ordenarCartera(campo){ carteraOrden = carteraOrden.campo===campo?{campo,dir:-carteraOrden.dir}:{campo,dir:campo==='placa'||campo==='nombre'||campo==='empresa'?1:-1}; renderTablaCartera(); }

function aplicarFiltrosCartera(){
  const q=normalizarTexto(document.getElementById('cBuscador').value);
  const emp=document.getElementById('cFiltroEmpresa').value;
  const rango=document.getElementById('cFiltroRango').value;
  const fa=document.getElementById('cFiltroAcuerdo').value;
  const solo=document.getElementById('cSoloSaldo').checked;
  const fest=document.getElementById('cFiltroEstado').value;
  const {campo,dir}=carteraOrden;
  return cartera.registros.filter(r=>{
    if(solo&&!(r.valorVencido>0)&&rango!=='al_dia') return false;
    if(q&&!normalizarTexto(`${r.placa} ${r.nombre} ${r.identificacion} ${r.numInterno} ${r.empresa} ${r.celular} ${radicadoDe(r.placa)}`).includes(q)) return false;
    if(emp&&r.empresa!==emp) return false;
    if(rango&&rangoMora(r.periodosVencidos)!==rango) return false;
    if(fest&&estadoPlacaDe(r.placa)!==fest) return false;
    if(fa){ const ac=acuerdoActivoDePlaca(r.placa); if(fa==='con'&&!ac) return false; if(fa==='sin'&&ac) return false; if(fa==='incumplido'&&!(ac&&estadoAcuerdo(ac)==='incumplido')) return false; }
    return true;
  }).sort((a,b)=>{ const x=a[campo],y=b[campo]; return (typeof x==='number'?x-y:String(x).localeCompare(String(y)))*dir; });
}

function renderTablaCartera(){
  carteraFiltrada=aplicarFiltrosCartera();
  const tot=carteraFiltrada.reduce((s,r)=>s+r.valorVencido,0);
  document.getElementById('c-count').textContent=`${carteraFiltrada.length} placas · ${fmtCOP(tot)}`;
  document.querySelectorAll('#tablaCartera th[data-ord]').forEach(th=>{ th.classList.toggle('ord-activo',th.dataset.ord===carteraOrden.campo); th.dataset.dir=carteraOrden.dir>0?'▲':'▼'; });
  const tb=document.getElementById('tbodyCartera');
  if(!cartera.registros.length){ tb.innerHTML=`<tr><td colspan="13" class="empty-msg">No hay cartera cargada.<br><br><button class="btn btn-dark" onclick="document.getElementById('inputArchivoCartera').click()">📤 Cargar archivo CarteraRodamientos</button></td></tr>`; return; }
  if(!carteraFiltrada.length){ tb.innerHTML='<tr><td colspan="13" class="empty-msg">Sin resultados</td></tr>'; return; }
  tb.innerHTML=carteraFiltrada.map(r=>{
    const k=rangoMora(r.periodosVencidos), ac=acuerdoActivoDePlaca(r.placa);
    const e=ac?estadoAcuerdo(ac):null;
    const acTxt=ac?`<span class="cell-doc ${ESTADO_AC[e].c}" title="Saldo acuerdo ${fmtCOP(totalesAcuerdo(ac).saldo)}">${ESTADO_AC[e].t}</span>`:'<span class="cell-n">—</span>';
    const pst=(r.periodosSinTarifa||[]).length?`<span class="pst" title="Periodos sin tarifa parametrizada:\n${esc(r.periodosSinTarifa.join('\n'))}">+${r.periodosSinTarifa.length} sin tarifa</span>`:'';
    return `<tr class="${r.valorVencido>0?'':'fila-vigente'}">
      <td class="td-placa">${esc(r.placa)}</td>
      <td>${esc(r.numInterno||'--')}</td>
      <td class="td-nombre" title="${esc(r.nombre)}">${esc(r.nombre)}<div class="td-sub">${esc(r.identificacion)}</div></td>
      <td><span class="empresa-tag" title="${esc(r.empresa)}">${esc(r.empresa)}</span></td>
      <td class="td-sub2">${esc(r.clase)}</td>
      <td class="td-contacto">${r.celular?`<a href="https://wa.me/57${esc(r.celular.replace(/\D/g,''))}" target="_blank" rel="noopener" title="WhatsApp">${esc(r.celular)}</a>`:'--'}${r.correo?`<div class="td-sub">${esc(r.correo)}</div>`:''}</td>
      <td class="td-sub2">${esc(r.ultimoPeriodo)}</td>
      <td style="text-align:center"><span class="cell-doc ${RANGO_CLS[k]}">${r.periodosVencidos}</span>${pst}</td>
      <td class="td-valor">${fmtCOP(r.valorVencido)}</td>
      <td class="td-estado"><select class="sel-estado ${ESTADOS_PLACA[estadoPlacaDe(r.placa)].c}" onchange="cambiarEstadoPlaca('${esc(r.placa)}',this.value)" title="${estadosPlaca[r.placa]&&estadosPlaca[r.placa].fecha?'Cambiado '+esc(new Date(estadosPlaca[r.placa].fecha).toLocaleString('es-CO')):''}">${Object.entries(ESTADOS_PLACA).map(([k,o])=>`<option value="${k}" ${estadoPlacaDe(r.placa)===k?'selected':''}>${o.t}</option>`).join('')}</select></td>
      <td class="td-radicado">${estadoPlacaDe(r.placa)==='radicado'?`<input id="rad_${esc(r.placa)}" class="inp-radicado ${radicadoDe(r.placa)?'':'rad-falta'}" placeholder="N° radicado" value="${esc(radicadoDe(r.placa))}" onchange="cambiarRadicado('${esc(r.placa)}',this.value)"/>`:'<span class="cell-n">—</span>'}</td>
      <td style="text-align:center">${acTxt}</td>
      <td class="td-acc">
        ${ac?`<button class="btn-notif" onclick="abrirSeguimiento('${ac.id}')">Seguimiento</button>`:(r.valorVencido>0?`<button class="btn-notif btn-acuerdo" onclick="abrirNuevoAcuerdo('${esc(r.placa)}')">+ Acuerdo</button>`:'')}
      </td>
    </tr>`;
  }).join('');
}

// ===== ACUERDOS: LISTA =====
function renderAcuerdos(){
  const fe=document.getElementById('cFiltroEstadoAc').value;
  const q=normalizarTexto(document.getElementById('cBuscadorAc').value);
  const orden={incumplido:0,vigente:1,cumplido:2,anulado:3};
  const lista=acuerdos.filter(a=>{
    const e=estadoAcuerdo(a);
    if(fe==='activos'&&!['vigente','incumplido'].includes(e)) return false;
    if(fe&&fe!=='activos'&&e!==fe) return false;
    if(q&&!normalizarTexto(`${a.placa} ${a.nombre} ${a.identificacion} ${a.empresa}`).includes(q)) return false;
    return true;
  }).sort((a,b)=>orden[estadoAcuerdo(a)]-orden[estadoAcuerdo(b)]||((totalesAcuerdo(a).proximo||{}).fecha||'9').localeCompare((totalesAcuerdo(b).proximo||{}).fecha||'9'));
  const cont=document.getElementById('lista-acuerdos');
  if(!lista.length){ cont.innerHTML=`<div class="empty-msg">${acuerdos.length?'Ningún acuerdo con ese filtro':'Aún no hay acuerdos. Créalos desde la pestaña Placas con el botón “+ Acuerdo”.'}</div>`; return; }
  cont.innerHTML=lista.map(a=>{
    const t=totalesAcuerdo(a), e=estadoAcuerdo(a), pct=a.valorAcordado?Math.min(100,Math.round(t.pagado/a.valorAcordado*100)):0;
    const prox=t.proximo?`<span class="${diasR(t.proximo.fecha)<0?'txt-r':''}">${fmtD(t.proximo.fecha)} · ${fmtCOP(t.proximo.valor)}${diasR(t.proximo.fecha)<0?` (vencida hace ${-diasR(t.proximo.fecha)}d)`:diasR(t.proximo.fecha)===0?' (hoy)':''}</span>`:'—';
    return `<div class="acuerdo-card ac-${e}">
      <div class="ac-head">
        <span class="alerta-placa">${esc(a.placa)}</span>
        <span class="ac-nombre">${esc(a.nombre)}<small>${esc(a.empresa)}</small></span>
        <span class="cell-doc ${ESTADO_AC[e].c}">${ESTADO_AC[e].t}</span>
      </div>
      <div class="ac-grid">
        <div><label>Deuda al acordar</label><b>${fmtCOP(a.valorDeuda)}</b></div>
        <div><label>Valor acordado</label><b>${fmtCOP(a.valorAcordado)}</b></div>
        <div><label>Pagado</label><b class="txt-g">${fmtCOP(t.pagado)}</b></div>
        <div><label>Saldo</label><b>${fmtCOP(t.saldo)}</b></div>
        <div><label>Próximo compromiso</label><b>${prox}</b></div>
        <div><label>Próximo seguimiento</label><b>${t.proximoSeguimiento?fmtD(t.proximoSeguimiento):'—'}</b></div>
      </div>
      <div class="ac-progress"><div style="width:${pct}%"></div></div>
      <div class="ac-foot">
        <span class="td-sub">Acuerdo del ${fmtD(a.fechaAcuerdo)} · ${(a.compromisos||[]).length} cuota(s) · ${(a.seguimientos||[]).length} seguimiento(s)${a.eventosSincronizados?' · 📅 en calendarios':''}</span>
        <span class="ac-btns">
          <button class="btn btn-sm btn-outline-dark" onclick="abrirSeguimiento('${a.id}')">📞 Seguimiento / pagos</button>
          <button class="btn btn-sm btn-outline-dark" onclick="abrirEditarAcuerdo('${a.id}')">✏️ Editar</button>
        </span>
      </div>
    </div>`;
  }).join('');
}

// ===== AGENDA =====
function itemsAgenda(){
  const items=[];
  acuerdos.forEach(a=>{
    if(!['vigente','incumplido'].includes(estadoAcuerdo(a))) return;
    (a.compromisos||[]).filter(c=>!c.pagado).forEach((c,i)=>items.push({tipo:'cuota',fecha:c.fecha,a,c,txt:`Cuota ${(a.compromisos.indexOf(c))+1}/${a.compromisos.length} · ${fmtCOP(c.valor)}`}));
    const ps=totalesAcuerdo(a).proximoSeguimiento;
    if(ps) items.push({tipo:'seguimiento',fecha:ps,a,txt:'Seguimiento programado'});
  });
  return items.sort((x,y)=>x.fecha.localeCompare(y.fecha));
}
function renderAgenda(){
  const dias=Number(document.getElementById('cAgendaDias').value)||30;
  const lim=isoDe(new Date(HOY.getTime()+dias*86400000));
  const items=itemsAgenda().filter(i=>i.fecha<=lim);
  const cont=document.getElementById('lista-agenda');
  if(!items.length){ cont.innerHTML='<div class="empty-msg">Sin compromisos ni seguimientos en el periodo</div>'; return; }
  const grupos={};
  items.forEach(i=>{ const k=i.fecha<hoyISO()?'__vencidos':i.fecha; (grupos[k]=grupos[k]||[]).push(i); });
  cont.innerHTML=Object.keys(grupos).sort().map(k=>{
    const tit=k==='__vencidos'?'⚠️ Vencidos / pendientes de días anteriores':(k===hoyISO()?`Hoy · ${fmtD(k)}`:(t=>t.charAt(0).toUpperCase()+t.slice(1))(new Date(k+'T00:00:00').toLocaleDateString('es-CO',{weekday:'long',day:'2-digit',month:'long',year:'numeric'})));
    return `<div class="agenda-dia ${k==='__vencidos'?'agenda-venc':k===hoyISO()?'agenda-hoy':''}">
      <div class="agenda-tit">${tit}<span>${grupos[k].length}</span></div>
      ${grupos[k].map(i=>`<div class="agenda-item" onclick="abrirSeguimiento('${i.a.id}')">
        <span class="agenda-ico">${i.tipo==='cuota'?'💰':'📞'}</span>
        <span class="alerta-placa">${esc(i.a.placa)}</span>
        <span class="alerta-nombre">${esc(i.a.nombre)}</span>
        <span class="agenda-txt">${k==='__vencidos'?`${fmtD(i.fecha)} · `:''}${i.txt}</span>
        <span class="cell-doc ${ESTADO_AC[estadoAcuerdo(i.a)].c}">${ESTADO_AC[estadoAcuerdo(i.a)].t}</span>
      </div>`).join('')}
    </div>`;
  }).join('');
}

// ===== MODAL GENERICO DE CARTERA =====
function abrirModalCartera(titulo,html,botones){
  document.getElementById('modalCarteraTitulo').textContent=titulo;
  document.getElementById('modalCarteraContenido').innerHTML=html;
  document.getElementById('modalCarteraFooter').innerHTML=`<button class="btn btn-outline-dark" onclick="cerrarModalCartera()">Cerrar</button>`+(botones||'');
  document.getElementById('modalCartera').classList.remove('hidden');
}
function cerrarModalCartera(){ document.getElementById('modalCartera').classList.add('hidden'); _acuerdoEnEdicion=null; if(_renderPendiente) setTimeout(refrescarVistaCartera,50); }

// ===== CREAR / EDITAR ACUERDO =====
function abrirNuevoAcuerdo(placa){
  const r=cartera.registros.find(x=>x.placa===placa); if(!r) return;
  const ac=acuerdoActivoDePlaca(placa);
  if(ac){ mostrarToast(`${placa} ya tiene un acuerdo activo`,'info'); abrirSeguimiento(ac.id); return; }
  _acuerdoEnEdicion={ id:uid('AC'), placa:r.placa, nombre:r.nombre, identificacion:r.identificacion, empresa:r.empresa, celular:r.celular, correo:r.correo,
    valorDeuda:r.valorVencido, periodosVencidos:r.periodosVencidos, valorAcordado:r.valorVencido, fechaAcuerdo:hoyISO(), responsable:CARTERA_CORREOS.cartera,
    observaciones:'', estado:'vigente', compromisos:[], seguimientos:[], creado:new Date().toISOString(), nuevo:true };
  renderFormAcuerdo();
}
function abrirEditarAcuerdo(id){
  const a=acuerdos.find(x=>x.id===id); if(!a) return;
  _acuerdoEnEdicion=JSON.parse(JSON.stringify(a));
  renderFormAcuerdo();
}
function renderFormAcuerdo(){
  const a=_acuerdoEnEdicion;
  const html=`
  <div class="ac-resumen">
    <div><span class="alerta-placa">${esc(a.placa)}</span> ${esc(a.nombre)}</div>
    <div class="td-sub">${esc(a.empresa)} · CC ${esc(a.identificacion)} · ${esc(a.celular||'')} ${a.correo?'· '+esc(a.correo):''}</div>
    <div class="td-sub">Deuda según corte ${fmtD(cartera.fechaCorte)}: <b>${fmtCOP(a.valorDeuda)}</b> (${a.periodosVencidos} periodo(s) vencido(s))</div>
  </div>
  <div class="form-sect">Condiciones del acuerdo</div>
  <div class="form-grid form-grid-3">
    <div class="form-group"><label>Fecha del acuerdo</label><input type="date" id="ac_fecha" value="${a.fechaAcuerdo}"/></div>
    <div class="form-group"><label>Valor acordado (COP)</label><input type="number" min="0" step="1000" id="ac_valor" value="${a.valorAcordado}"/></div>
    <div class="form-group"><label>Responsable</label><input id="ac_resp" value="${esc(a.responsable)}"/></div>
  </div>
  <div class="form-group" style="margin-top:12px"><label>Observaciones / condiciones</label><textarea id="ac_obs" rows="2" placeholder="Ej: se compromete a pagar por transferencia, descuento de intereses, etc.">${esc(a.observaciones)}</textarea></div>
  <div class="form-sect">Plan de pagos (compromisos por fecha)</div>
  <div class="plan-gen">
    <div class="form-group"><label>N° cuotas</label><input type="number" min="1" max="60" id="ac_ncuotas" value="${Math.max(1,(a.compromisos||[]).length||1)}"/></div>
    <div class="form-group"><label>Primera cuota</label><input type="date" id="ac_primera" value="${(a.compromisos[0]||{}).fecha||sumarPeriodo(hoyISO(),'semanal',1)}"/></div>
    <div class="form-group"><label>Periodicidad</label><select id="ac_period"><option value="semanal">Semanal</option><option value="quincenal">Quincenal</option><option value="mensual" selected>Mensual</option></select></div>
    <button class="btn btn-sm btn-outline-dark" onclick="generarCuotas()">⚙️ Generar cuotas iguales</button>
  </div>
  <table class="tabla-cuotas"><thead><tr><th>#</th><th>Fecha compromiso</th><th>Valor</th><th>Estado</th><th></th></tr></thead><tbody id="ac_cuotas"></tbody></table>
  <div class="cuotas-foot"><button class="btn btn-sm btn-outline-dark" onclick="agregarCuota()">+ Agregar cuota</button><span id="ac_cuadre"></span></div>
  <p class="nota-cal">📅 Al guardar, cada compromiso se agenda en el calendario de <b>${CARTERA_CORREOS.cartera}</b> con <b>${CARTERA_CORREOS.director}</b> como invitado${CARTERA_BACKEND_ACTIVO?'':' (cuando el backend de cartera esté configurado; mientras tanto puedes descargar el .ics)'}.</p>`;
  const btns=`${!a.nuevo&&a.estado!=='anulado'?`<button class="btn btn-clear" onclick="anularAcuerdo()">Anular acuerdo</button>`:''}
    ${!CARTERA_BACKEND_ACTIVO?`<button class="btn btn-outline-dark" onclick="descargarICS(_leerFormAcuerdo(true))">📅 .ics</button>`:''}
    <button class="btn btn-primary btn-primary-dark" onclick="guardarAcuerdo()">💾 Guardar acuerdo</button>`;
  abrirModalCartera(a.nuevo?`Nuevo acuerdo de pago — ${a.placa}`:`Editar acuerdo — ${a.placa}`,html,btns);
  renderCuotasForm();
  document.getElementById('ac_valor').addEventListener('input',()=>{_acuerdoEnEdicion.valorAcordado=Number(document.getElementById('ac_valor').value)||0;cuadreCuotas();});
}
function renderCuotasForm(){
  const a=_acuerdoEnEdicion;
  document.getElementById('ac_cuotas').innerHTML=a.compromisos.length?a.compromisos.map((c,i)=>`<tr>
    <td>${i+1}</td>
    <td><input type="date" value="${c.fecha||''}" ${c.pagado?'disabled':''} onchange="_acuerdoEnEdicion.compromisos[${i}].fecha=this.value"/></td>
    <td><input type="number" min="0" step="1000" value="${c.valor}" ${c.pagado?'disabled':''} oninput="_acuerdoEnEdicion.compromisos[${i}].valor=Number(this.value)||0;cuadreCuotas()"/></td>
    <td>${c.pagado?`<span class="cell-doc cell-g">Pagada ${fmtD(c.fechaPago)}</span>`:'<span class="cell-doc cell-y">Pendiente</span>'}</td>
    <td>${c.pagado?'':`<button class="modal-close" title="Quitar" onclick="_acuerdoEnEdicion.compromisos.splice(${i},1);renderCuotasForm()">✕</button>`}</td>
  </tr>`).join(''):'<tr><td colspan="5" class="cell-n" style="padding:12px;text-align:center">Genera las cuotas o agrégalas una a una</td></tr>';
  cuadreCuotas();
}
function cuadreCuotas(){
  const a=_acuerdoEnEdicion; const s=a.compromisos.reduce((t,c)=>t+(Number(c.valor)||0),0);
  const v=Number(document.getElementById('ac_valor').value)||0; const d=v-s;
  document.getElementById('ac_cuadre').innerHTML=`Total cuotas: <b>${fmtCOP(s)}</b> ${d===0?'<span class="txt-g">✔ cuadra con el valor acordado</span>':`<span class="txt-r">${d>0?'faltan':'sobran'} ${fmtCOP(Math.abs(d))}</span>`}`;
}
function generarCuotas(){
  const a=_acuerdoEnEdicion;
  const n=Math.max(1,Math.min(60,parseInt(document.getElementById('ac_ncuotas').value)||1));
  const f1=document.getElementById('ac_primera').value; const per=document.getElementById('ac_period').value;
  if(!f1){ mostrarToast('Indica la fecha de la primera cuota','error'); return; }
  const pagadas=a.compromisos.filter(c=>c.pagado);
  const yaPagado=pagadas.reduce((s,c)=>s+(Number(c.valorPagado)||Number(c.valor)||0),0);
  const total=Math.max(0,(Number(document.getElementById('ac_valor').value)||0)-yaPagado);
  const base=Math.floor(total/n/1000)*1000; // cuotas redondeadas a miles; la ultima ajusta
  const nuevas=[];
  for(let i=0;i<n;i++) nuevas.push({id:uid('CP'),fecha:sumarPeriodo(f1,per,i),valor:i===n-1?total-base*(n-1):base,pagado:false});
  // conserva los eventos de calendario de las cuotas pendientes que se reemplazan para que el backend los borre
  a._eventosAEliminar=(a._eventosAEliminar||[]).concat(a.compromisos.filter(c=>!c.pagado&&c.eventId).map(c=>c.eventId));
  a.compromisos=pagadas.concat(nuevas);
  renderCuotasForm();
}
function agregarCuota(){
  const a=_acuerdoEnEdicion; const ult=a.compromisos[a.compromisos.length-1];
  a.compromisos.push({id:uid('CP'),fecha:ult?sumarPeriodo(ult.fecha,'mensual',1):sumarPeriodo(hoyISO(),'semanal',1),valor:0,pagado:false});
  renderCuotasForm();
}
function _leerFormAcuerdo(sinValidar){
  const a=_acuerdoEnEdicion;
  a.fechaAcuerdo=document.getElementById('ac_fecha').value||hoyISO();
  a.valorAcordado=Number(document.getElementById('ac_valor').value)||0;
  a.responsable=document.getElementById('ac_resp').value.trim()||CARTERA_CORREOS.cartera;
  a.observaciones=document.getElementById('ac_obs').value.trim();
  a.compromisos.sort((x,y)=>(x.fecha||'').localeCompare(y.fecha||''));
  return a;
}
function guardarAcuerdo(){
  const a=_leerFormAcuerdo();
  if(!a.valorAcordado){ mostrarToast('El valor acordado debe ser mayor a cero','error'); return; }
  if(!a.compromisos.length){ mostrarToast('Agrega al menos un compromiso de pago con fecha','error'); return; }
  if(a.compromisos.some(c=>!c.fecha||!(Number(c.valor)>0))){ mostrarToast('Cada cuota necesita fecha y valor','error'); return; }
  const esNuevo=!!a.nuevo; delete a.nuevo;
  a.actualizado=new Date().toISOString();
  const i=acuerdos.findIndex(x=>x.id===a.id);
  if(i>=0) acuerdos[i]=a; else acuerdos.push(a);
  cerrarModalCartera();
  mostrarToast(esNuevo?`Acuerdo creado para ${a.placa}`:`Acuerdo ${a.placa} actualizado`,'success');
  if(esNuevo) carteraTab='acuerdos';
  renderCartera();
  sincronizarAcuerdo(a);
}
function anularAcuerdo(){
  const a=_acuerdoEnEdicion; if(!a) return;
  const motivo=prompt(`¿Anular el acuerdo de ${a.placa}? Escribe el motivo:`); if(motivo===null) return;
  const orig=acuerdos.find(x=>x.id===a.id); if(!orig) return;
  orig.estado='anulado'; orig.motivoAnulacion=motivo; orig.actualizado=new Date().toISOString();
  cerrarModalCartera(); renderCartera(); sincronizarAcuerdo(orig);
}

// ===== SEGUIMIENTO Y PAGOS =====
function abrirSeguimiento(id){
  const a=acuerdos.find(x=>x.id===id); if(!a) return;
  const t=totalesAcuerdo(a), e=estadoAcuerdo(a);
  const reg=cartera.registros.find(r=>r.placa===a.placa);
  const html=`
  <div class="ac-resumen">
    <div><span class="alerta-placa">${esc(a.placa)}</span> ${esc(a.nombre)} <span class="cell-doc ${ESTADO_AC[e].c}">${ESTADO_AC[e].t}</span></div>
    <div class="td-sub">${esc(a.empresa)} · ${a.celular?`<a href="https://wa.me/57${esc(a.celular.replace(/\D/g,''))}" target="_blank" rel="noopener">${esc(a.celular)}</a>`:''} ${a.correo?'· '+esc(a.correo):''}</div>
    <div class="ac-grid" style="margin-top:10px">
      <div><label>Valor acordado</label><b>${fmtCOP(a.valorAcordado)}</b></div>
      <div><label>Pagado</label><b class="txt-g">${fmtCOP(t.pagado)}</b></div>
      <div><label>Saldo acuerdo</label><b>${fmtCOP(t.saldo)}</b></div>
      <div><label>Cartera hoy (corte ${fmtD(cartera.fechaCorte)})</label><b>${reg?fmtCOP(reg.valorVencido):'—'}</b></div>
    </div>
    ${a.observaciones?`<div class="td-sub" style="margin-top:8px">📝 ${esc(a.observaciones)}</div>`:''}
    ${a.estado==='anulado'?`<div class="txt-r" style="margin-top:8px">Anulado: ${esc(a.motivoAnulacion||'')}</div>`:''}
  </div>
  <div class="form-sect">Compromisos de pago</div>
  <table class="tabla-cuotas"><thead><tr><th>#</th><th>Fecha</th><th>Valor</th><th>Estado</th><th>Registrar pago</th></tr></thead><tbody>
  ${(a.compromisos||[]).map((c,i)=>{ const d=diasR(c.fecha);
    return `<tr class="${!c.pagado&&d<0?'fila-vencido':''}"><td>${i+1}</td><td>${fmtD(c.fecha)}</td><td>${fmtCOP(c.valor)}</td>
    <td>${c.pagado?`<span class="cell-doc cell-g">Pagada</span>`:d<0?`<span class="cell-doc cell-r">Vencida ${-d}d</span>`:d===0?'<span class="cell-doc cell-o">Hoy</span>':`<span class="cell-doc cell-y">En ${d}d</span>`}</td>
    <td>${c.pagado?`${fmtD(c.fechaPago)} · ${fmtCOP(c.valorPagado||c.valor)} ${a.estado!=='anulado'?`<button class="link-btn" onclick="desmarcarPago('${a.id}','${c.id}')">deshacer</button>`:''}`:
      a.estado==='anulado'?'—':`<span class="pago-inline"><input type="date" id="pf_${c.id}" value="${hoyISO()}"/><input type="number" id="pv_${c.id}" value="${c.valor}" step="1000"/><button class="btn-notif" onclick="registrarPago('${a.id}','${c.id}')">✔ Pagó</button></span>`}</td></tr>`;}).join('')}
  </tbody></table>
  ${a.estado!=='anulado'?`<div class="form-sect">Registrar seguimiento</div>
  <div class="form-grid form-grid-3">
    <div class="form-group"><label>Fecha gestión</label><input type="date" id="sg_fecha" value="${hoyISO()}"/></div>
    <div class="form-group"><label>Medio</label><select id="sg_tipo"><option>Llamada</option><option>WhatsApp</option><option>Correo</option><option>Visita / presencial</option><option>Otro</option></select></div>
    <div class="form-group"><label>Próximo seguimiento</label><input type="date" id="sg_prox" value="${sumarPeriodo(hoyISO(),'semanal',1)}"/></div>
  </div>
  <div class="form-group" style="margin-top:10px"><label>Resultado / compromiso del afiliado</label><textarea id="sg_nota" rows="2" placeholder="Ej: contestó, confirma pago de la cuota el viernes por transferencia"></textarea></div>`:''}
  <div class="form-sect">Historial de seguimientos (${(a.seguimientos||[]).length})</div>
  <div class="hist-seg">${(a.seguimientos||[]).slice().sort((x,y)=>(y.fecha||'').localeCompare(x.fecha||'')||(y.creado||'').localeCompare(x.creado||'')).map(s=>`
    <div class="seg-item"><div class="seg-fecha">${fmtD(s.fecha)}<small>${esc(s.tipo)}</small></div><div class="seg-nota">${esc(s.nota)||'<span class="cell-n">Sin nota</span>'}${s.proximaFecha?`<div class="td-sub">Próximo seguimiento: ${fmtD(s.proximaFecha)}</div>`:''}<div class="td-sub">${esc(s.usuario||'')}</div></div></div>`).join('')||'<div class="cell-n" style="padding:8px">Sin seguimientos registrados</div>'}</div>`;
  const btns=`${!CARTERA_BACKEND_ACTIVO?`<button class="btn btn-outline-dark" onclick="descargarICS(acuerdos.find(x=>x.id==='${a.id}'))">📅 .ics</button>`:''}
    <button class="btn btn-outline-dark" onclick="cerrarModalCartera();abrirEditarAcuerdo('${a.id}')">✏️ Editar acuerdo</button>
    ${a.estado!=='anulado'?`<button class="btn btn-primary btn-primary-dark" onclick="guardarSeguimiento('${a.id}')">💾 Guardar seguimiento</button>`:''}`;
  abrirModalCartera(`Seguimiento — ${a.placa}`,html,btns);
}
function registrarPago(acId,cpId){
  const a=acuerdos.find(x=>x.id===acId); const c=a&&a.compromisos.find(x=>x.id===cpId); if(!c) return;
  c.pagado=true; c.fechaPago=document.getElementById(`pf_${cpId}`).value||hoyISO(); c.valorPagado=Number(document.getElementById(`pv_${cpId}`).value)||c.valor;
  a.seguimientos=a.seguimientos||[];
  a.seguimientos.push({id:uid('SG'),fecha:c.fechaPago,tipo:'Pago',nota:`Pago registrado de ${fmtCOP(c.valorPagado)} (cuota ${a.compromisos.indexOf(c)+1})`,proximaFecha:(totalesAcuerdo(a).ultimoSeg||{}).proximaFecha||null,usuario:CARTERA_CORREOS.cartera,creado:new Date().toISOString()});
  a.actualizado=new Date().toISOString();
  mostrarToast(`Pago registrado para ${a.placa}`,'success');
  abrirSeguimiento(acId); renderCartera(); sincronizarAcuerdo(a);
}
function desmarcarPago(acId,cpId){
  const a=acuerdos.find(x=>x.id===acId); const c=a&&a.compromisos.find(x=>x.id===cpId); if(!c) return;
  if(!confirm('¿Deshacer el registro de este pago?')) return;
  c.pagado=false; delete c.fechaPago; delete c.valorPagado; a.actualizado=new Date().toISOString();
  abrirSeguimiento(acId); renderCartera(); sincronizarAcuerdo(a);
}
function guardarSeguimiento(acId){
  const a=acuerdos.find(x=>x.id===acId); if(!a) return;
  const nota=document.getElementById('sg_nota').value.trim();
  const prox=document.getElementById('sg_prox').value||null;
  if(!nota&&!prox){ mostrarToast('Escribe el resultado de la gestión o una próxima fecha','error'); return; }
  a.seguimientos=a.seguimientos||[];
  a.seguimientos.push({id:uid('SG'),fecha:document.getElementById('sg_fecha').value||hoyISO(),tipo:document.getElementById('sg_tipo').value,nota,proximaFecha:prox,usuario:CARTERA_CORREOS.cartera,creado:new Date().toISOString()});
  a.actualizado=new Date().toISOString();
  mostrarToast('Seguimiento registrado','success');
  cerrarModalCartera(); renderCartera(); sincronizarAcuerdo(a);
}

// ===== .ICS (respaldo cuando no hay backend) =====
function descargarICS(a){
  if(!a) return;
  const f=s=>s.replace(/-/g,''); const sig=s=>{const d=parseD(s);d.setDate(d.getDate()+1);return isoDe(d).replace(/-/g,'');};
  const escI=s=>String(s||'').replace(/[\\,;]/g,m=>'\\'+m).replace(/\n/g,'\\n');
  const ev=[];
  (a.compromisos||[]).filter(c=>!c.pagado&&c.fecha).forEach((c,i)=>ev.push({uid:`${c.id}@specialcar`,d:c.fecha,t:`💰 Cuota acuerdo ${a.placa} - ${fmtCOP(c.valor)}`,desc:`Afiliado: ${a.nombre}\nCuota ${i+1} de ${a.compromisos.length}\nValor: ${fmtCOP(c.valor)}\nCelular: ${a.celular||''}`}));
  const ps=totalesAcuerdo(a).proximoSeguimiento; if(ps) ev.push({uid:`seg-${a.id}-${ps}@specialcar`,d:ps,t:`📞 Seguimiento acuerdo ${a.placa}`,desc:`Afiliado: ${a.nombre}\nCelular: ${a.celular||''}`});
  if(!ev.length){ mostrarToast('No hay fechas pendientes para agendar','info'); return; }
  const ics=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//SpecialCar//Cartera//ES','CALSCALE:GREGORIAN','METHOD:REQUEST',
    ...ev.flatMap(e=>['BEGIN:VEVENT',`UID:${e.uid}`,`DTSTAMP:${new Date().toISOString().replace(/[-:]/g,'').slice(0,15)}Z`,`DTSTART;VALUE=DATE:${f(e.d)}`,`DTEND;VALUE=DATE:${sig(e.d)}`,`SUMMARY:${escI(e.t)}`,`DESCRIPTION:${escI(e.desc)}`,
      `ORGANIZER;CN=Cartera SpecialCar:mailto:${CARTERA_CORREOS.cartera}`,`ATTENDEE;CN=Juridico;RSVP=FALSE:mailto:${CARTERA_CORREOS.cartera}`,`ATTENDEE;CN=Director Transporte;RSVP=FALSE:mailto:${CARTERA_CORREOS.director}`,
      'BEGIN:VALARM','TRIGGER:-PT15H','ACTION:DISPLAY','DESCRIPTION:Recordatorio','END:VALARM','END:VEVENT']),'END:VCALENDAR'].join('\r\n');
  const b=new Blob([ics],{type:'text/calendar;charset=utf-8'}); const l=document.createElement('a'); l.href=URL.createObjectURL(b); l.download=`acuerdo_${a.placa}.ics`; l.click();
  mostrarToast('Archivo .ics descargado: ábrelo para agregarlo al calendario (incluye a ambos correos)','success');
}

// ===== CARGA DEL ARCHIVO DE CARTERA =====
function onArchivoCarteraSeleccionado(e){ const f=e.target.files[0]; if(f) procesarArchivoCartera(f); e.target.value=''; }
function mapearColCartera(h){
  h=normalizarTexto(h);
  if(h.includes('placa')) return 'placa';
  if(h.includes('interno')) return 'numInterno';
  if(h.includes('identificacion')||h.includes('documento')||h.includes('cedula')) return 'identificacion';
  if(h.includes('nombre')) return 'nombre';
  if(h.includes('celular')||h.includes('telefono')) return 'celular';
  if(h.includes('correo')||h.includes('email')) return 'correo';
  if(h.includes('convenio')) return 'empresaConvenio';
  if(h.includes('empresa')) return 'empresa';
  if(h.includes('clase')) return 'clase';
  if(h.includes('ultimo periodo')) return 'ultimoPeriodo';
  if(h.includes('sin tarifa')) return 'periodosSinTarifa';
  if(h.includes('$')||(h.includes('valor')&&h.includes('vencid'))) return 'valorVencido';
  if(h.includes('#')||(h.includes('periodos')&&h.includes('vencid'))) return 'periodosVencidos';
  if(h.includes('estado')) return 'estado';
  return null;
}
function aNumero(v){ if(typeof v==='number') return v; const s=String(v||'').replace(/[^\d,.-]/g,''); if(!s) return 0; return Number(s.replace(/\./g,'').replace(',','.'))||0; }
function procesarArchivoCartera(file){
  const rd=new FileReader();
  rd.onload=async ev=>{
    try{
      const wb=XLSX.read(ev.target.result,{type:'array'});
      const filas=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:'',raw:true});
      let corte=null, hIdx=-1;
      for(let i=0;i<Math.min(filas.length,15);i++){
        filas[i].forEach(c=>{ const m=String(c).toLowerCase().includes('corte')&&String(c).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); if(m) corte=`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`; });
        if(hIdx<0&&filas[i].some(c=>normalizarTexto(c)==='placa')) hIdx=i;
      }
      if(hIdx<0){ mostrarToast('No se encontró la fila de encabezados con "Placa"','error'); return; }
      const mapa=filas[hIdx].map(mapearColCartera);
      const regs=[]; let cur=null;
      for(let i=hIdx+1;i<filas.length;i++){
        const f=filas[i]; const o={}; mapa.forEach((k,j)=>{ if(k&&!(k in o)) o[k]=f[j]; });
        const placa=String(o.placa||'').trim().toUpperCase();
        if(placa){
          cur={placa,numInterno:String(o.numInterno??'').trim(),identificacion:String(o.identificacion??'').trim(),nombre:String(o.nombre||'').trim(),celular:String(o.celular||'').trim(),correo:String(o.correo||'').trim(),
            empresa:String(o.empresa||'').trim(),clase:String(o.clase||'').trim(),empresaConvenio:String(o.empresaConvenio||'').trim(),ultimoPeriodo:String(o.ultimoPeriodo||'').trim(),
            periodosVencidos:Math.round(aNumero(o.periodosVencidos)),valorVencido:aNumero(o.valorVencido),periodosSinTarifa:o.periodosSinTarifa?[String(o.periodosSinTarifa).trim()]:[],estado:String(o.estado||'').trim()};
          regs.push(cur);
        }else if(cur){
          if(o.periodosSinTarifa) cur.periodosSinTarifa.push(String(o.periodosSinTarifa).trim());
          if(o.estado&&!cur.estado) cur.estado=String(o.estado).trim();
        }
      }
      if(!regs.length){ mostrarToast('El archivo no tiene placas','error'); return; }
      const antes=cartera.registros.reduce((s,r)=>s+r.valorVencido,0);
      cartera={fechaCorte:corte||hoyISO(),archivo:file.name,registros:regs,cargado:new Date().toISOString()};
      guardarCarteraLS(); cargarEmpresasCartera(); renderCartera();
      const despues=regs.reduce((s,r)=>s+r.valorVencido,0);
      mostrarToast(`Cartera cargada: ${regs.length} placas · ${fmtCOP(despues)} (${despues>=antes?'+':'−'}${fmtCOP(Math.abs(despues-antes))} vs. anterior)`,'success');
      if(CARTERA_BACKEND_ACTIVO){
        try{ await llamarBackendCartera({accion:'guardarCartera',fechaCorte:cartera.fechaCorte,archivo:file.name,registros:regs}); cartera._delBackend=true; _versionBackend=null; guardarCarteraLS(); mostrarToast('Cartera guardada en la hoja compartida (base del informe diario)','success'); actualizarBadgeBackend(true); }
        catch(err){ console.warn(err); mostrarToast('La cartera se cargó aquí, pero no se pudo guardar en el backend','error'); actualizarBadgeBackend(false); }
      }
    }catch(err){ console.error(err); mostrarToast('No se pudo leer el archivo de cartera','error'); }
  };
  rd.readAsArrayBuffer(file);
}

// ===== INFORMES =====
// Los mismos datos que usa el backend para el correo automatico diario.
function datosInformeCartera(){
  const conSaldo=cartera.registros.filter(r=>r.valorVencido>0).sort((a,b)=>b.valorVencido-a.valorVencido);
  const total=conSaldo.reduce((s,r)=>s+r.valorVencido,0);
  const porEmp={}; conSaldo.forEach(r=>{porEmp[r.empresa]=porEmp[r.empresa]||{n:0,v:0};porEmp[r.empresa].n++;porEmp[r.empresa].v+=r.valorVencido;});
  return {conSaldo,total,porEmp:Object.entries(porEmp).sort((a,b)=>b[1].v-a[1].v),totalPlacas:cartera.registros.length};
}
function htmlInformeCartera(){
  const d=datosInformeCartera(); const fecha=new Date().toLocaleDateString('es-CO',{day:'2-digit',month:'long',year:'numeric'});
  return `<h1>Informe diario de cartera</h1><div class="sub">Grupo Special Car — ${fecha} · Corte de cartera ${fmtD(cartera.fechaCorte)}</div>
  <div class="kpi-row"><div class="kpi kv"><div class="kpi-n">${fmtCOP(d.total)}</div><div class="kpi-l">Cartera vencida</div></div>
  <div class="kpi ka"><div class="kpi-n">${d.conSaldo.length}</div><div class="kpi-l">Placas con saldo</div></div>
  <div class="kpi kg"><div class="kpi-n">${d.totalPlacas-d.conSaldo.length}</div><div class="kpi-l">Placas al día</div></div>
  <div class="kpi kt"><div class="kpi-n">${acuerdos.filter(a=>['vigente','incumplido'].includes(estadoAcuerdo(a))).length}</div><div class="kpi-l">Acuerdos activos</div></div></div>
  <h2>Resumen por empresa</h2><table><thead><tr><th>Empresa</th><th>Placas</th><th style="text-align:right">Valor vencido</th></tr></thead><tbody>
  ${d.porEmp.map(([e,o])=>`<tr><td>${esc(e)}</td><td>${o.n}</td><td style="text-align:right">${fmtCOP(o.v)}</td></tr>`).join('')}
  <tr><td><b>TOTAL</b></td><td><b>${d.conSaldo.length}</b></td><td style="text-align:right"><b>${fmtCOP(d.total)}</b></td></tr></tbody></table>
  <h2>Detalle por placa (${d.conSaldo.length})</h2><table><thead><tr><th>Placa</th><th>Afiliado</th><th>Empresa</th><th>Último periodo pago</th><th># Per.</th><th style="text-align:right">Valor vencido</th><th>Estado</th><th>Acuerdo</th></tr></thead><tbody>
  ${d.conSaldo.map(r=>{const ac=acuerdoActivoDePlaca(r.placa);return `<tr><td><b>${esc(r.placa)}</b></td><td>${esc(r.nombre)}</td><td>${esc(r.empresa)}</td><td>${esc(r.ultimoPeriodo)}</td><td>${r.periodosVencidos}</td><td style="text-align:right">${fmtCOP(r.valorVencido)}</td><td>${esc(textoEstadoPlaca(r.placa))}</td><td>${ac?ESTADO_AC[estadoAcuerdo(ac)].t:'—'}</td></tr>`;}).join('')}
  </tbody></table>`;
}
function htmlInformeAcuerdos(){
  const fecha=new Date().toLocaleDateString('es-CO',{day:'2-digit',month:'long',year:'numeric'});
  const act=acuerdos.filter(a=>a.estado!=='anulado');
  const g={vigente:[],incumplido:[],cumplido:[]}; act.forEach(a=>g[estadoAcuerdo(a)].push(a));
  const sum=(l,f)=>l.reduce((s,a)=>s+f(a),0);
  const hoy=itemsAgenda().filter(i=>i.fecha===hoyISO());
  const fila=a=>{const t=totalesAcuerdo(a);return `<tr><td><b>${esc(a.placa)}</b></td><td>${esc(a.nombre)}</td><td>${fmtD(a.fechaAcuerdo)}</td><td style="text-align:right">${fmtCOP(a.valorAcordado)}</td><td style="text-align:right">${fmtCOP(t.pagado)}</td><td style="text-align:right">${fmtCOP(t.saldo)}</td><td>${t.proximo?`${fmtD(t.proximo.fecha)} · ${fmtCOP(t.proximo.valor)}`:'—'}</td><td>${t.vencidos.length?`${t.vencidos.length} cuota(s) · ${fmtCOP(sum(t.vencidos.map(c=>({v:c.valor})),x=>x.v))}`:'—'}</td><td>${t.ultimoSeg?`${fmtD(t.ultimoSeg.fecha)} ${esc(t.ultimoSeg.nota||'').slice(0,80)}`:'—'}</td></tr>`;};
  const tabla=l=>l.length?`<table><thead><tr><th>Placa</th><th>Afiliado</th><th>Fecha acuerdo</th><th style="text-align:right">Acordado</th><th style="text-align:right">Pagado</th><th style="text-align:right">Saldo</th><th>Próximo compromiso</th><th>Vencido</th><th>Último seguimiento</th></tr></thead><tbody>${l.map(fila).join('')}</tbody></table>`:'<p class="sub">Ninguno</p>';
  return `<h1>Informe de acuerdos de pago</h1><div class="sub">Grupo Special Car — ${fecha} · Responsable: ${CARTERA_CORREOS.cartera}</div>
  <div class="kpi-row"><div class="kpi kt"><div class="kpi-n">${g.vigente.length+g.incumplido.length}</div><div class="kpi-l">Acuerdos activos</div></div>
  <div class="kpi kv"><div class="kpi-n">${g.incumplido.length}</div><div class="kpi-l">Incumplidos</div></div>
  <div class="kpi ka"><div class="kpi-n">${fmtCOP(sum(g.vigente.concat(g.incumplido),a=>totalesAcuerdo(a).saldo))}</div><div class="kpi-l">Saldo por recaudar</div></div>
  <div class="kpi kg"><div class="kpi-n">${fmtCOP(sum(act,a=>totalesAcuerdo(a).pagado))}</div><div class="kpi-l">Recaudado en acuerdos</div></div></div>
  <h2>Gestiones para hoy (${hoy.length})</h2>${hoy.length?`<table><thead><tr><th>Tipo</th><th>Placa</th><th>Afiliado</th><th>Detalle</th></tr></thead><tbody>${hoy.map(i=>`<tr><td>${i.tipo==='cuota'?'Cuota':'Seguimiento'}</td><td><b>${esc(i.a.placa)}</b></td><td>${esc(i.a.nombre)}</td><td>${i.txt}</td></tr>`).join('')}</tbody></table>`:'<p class="sub">Sin gestiones agendadas para hoy</p>'}
  <h2>Acuerdos incumplidos (${g.incumplido.length})</h2>${tabla(g.incumplido)}
  <h2>Acuerdos vigentes al día (${g.vigente.length})</h2>${tabla(g.vigente)}
  <h2>Acuerdos cumplidos (${g.cumplido.length})</h2>${tabla(g.cumplido)}`;
}
const CSS_INFORME=`body{font-family:'Segoe UI',sans-serif;color:#1f2937;padding:32px;max-width:1100px;margin:0 auto}h1{font-size:22px;color:#1e3a5f;margin:0 0 2px}.sub{color:#6b7280;font-size:13px;margin-bottom:22px}
  .kpi-row{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}.kpi{padding:14px;border-radius:8px;text-align:center;border:1.5px solid #e5e7eb}.kpi-n{font-size:22px;font-weight:800}.kpi-l{font-size:11px;color:#6b7280;margin-top:3px}
  .kv{border-color:#fecaca;background:#fef2f2}.kv .kpi-n{color:#b91c1c}.ka{border-color:#fde68a;background:#fffbeb}.ka .kpi-n{color:#92400e}.kg{border-color:#bbf7d0;background:#f0fdf4}.kg .kpi-n{color:#15803d}.kt{border-color:#bfdbfe;background:#eff6ff}.kt .kpi-n{color:#1d4ed8}
  h2{font-size:14px;color:#1e3a5f;margin:18px 0 10px;border-bottom:2px solid #e5e7eb;padding-bottom:6px}table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:18px}
  th{background:#1e3a5f;color:#fff;padding:7px 9px;text-align:left;font-size:10px;text-transform:uppercase}td{padding:6px 9px;border-bottom:1px solid #f3f4f6}tr:nth-child(even) td{background:#f9fafb}
  .barra{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px}.barra button{padding:9px 14px;background:#1e3a5f;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600}
  .para{font-size:11px;color:#6b7280}@media print{.no-print{display:none!important}}`;
function verInforme(tipo){
  const cuerpo=tipo==='acuerdos'?htmlInformeAcuerdos():htmlInformeCartera();
  const cc=tipo==='acuerdos'?`${CARTERA_CORREOS.director}, ${CARTERA_CORREOS.ceo}`:CARTERA_CORREOS.director;
  const w=window.open('','_blank'); if(!w){ mostrarToast('Permite las ventanas emergentes para ver el informe','error'); return; }
  w.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>${tipo==='acuerdos'?'Informe acuerdos':'Informe cartera'} ${hoyISO()}</title><style>${CSS_INFORME}</style></head><body>
  <div class="barra no-print"><span class="para">Para: ${CARTERA_CORREOS.cartera} · CC: ${cc}</span><button onclick="window.print()">Imprimir / Guardar PDF</button></div>${cuerpo}
  <p class="para" style="text-align:center;margin-top:30px">Generado por el Sistema de Vencimientos y Cartera SpecialCar — Confidencial</p></body></html>`);
  w.document.close();
}
async function enviarInforme(tipo){
  const cc=tipo==='acuerdos'?[CARTERA_CORREOS.director,CARTERA_CORREOS.ceo]:[CARTERA_CORREOS.director];
  if(CARTERA_BACKEND_ACTIVO){
    try{
      mostrarToast('Enviando informe desde juridico@...','info');
      const r=await llamarBackendCartera({accion:tipo==='acuerdos'?'enviarInformeAcuerdos':'enviarInformeCartera'});
      mostrarToast(`Informe enviado a ${CARTERA_CORREOS.cartera} con copia a ${cc.join(', ')}${r&&r.placas!==undefined?` (${r.placas} placas)`:''}`,'success');
      return;
    }catch(e){ console.warn(e); mostrarToast('No se pudo enviar desde el backend; se abrirá tu cliente de correo','error'); }
  }
  // Respaldo: correo prellenado (resumen) + informe completo para imprimir/adjuntar como PDF
  let asunto, cuerpo;
  if(tipo==='acuerdos'){
    const act=acuerdos.filter(a=>['vigente','incumplido'].includes(estadoAcuerdo(a)));
    asunto=`[ACUERDOS DE PAGO] ${act.length} activos - ${new Date().toLocaleDateString('es-CO')}`;
    cuerpo=`Cordial saludo,\n\nInforme de acuerdos de pago al ${new Date().toLocaleDateString('es-CO')}:\n\nPLACA | AFILIADO | ESTADO | SALDO | PRÓXIMO COMPROMISO\n${'-'.repeat(60)}\n${act.map(a=>{const t=totalesAcuerdo(a);return `${a.placa} | ${a.nombre} | ${ESTADO_AC[estadoAcuerdo(a)].t} | ${fmtCOP(t.saldo)} | ${t.proximo?fmtD(t.proximo.fecha)+' '+fmtCOP(t.proximo.valor):'-'}`;}).join('\n')||'Sin acuerdos activos'}\n\nSe adjunta el informe completo en PDF.\n\nAtentamente,\nCartera - Grupo Special Car\n${CARTERA_CORREOS.cartera}`;
  }else{
    const d=datosInformeCartera();
    asunto=`[CARTERA DIARIA] ${d.conSaldo.length} placas - ${fmtCOP(d.total)} - ${new Date().toLocaleDateString('es-CO')}`;
    cuerpo=`Cordial saludo,\n\nInforme diario de cartera (corte ${fmtD(cartera.fechaCorte)}):\nTotal vencido: ${fmtCOP(d.total)}\nPlacas con saldo: ${d.conSaldo.length}\n\nPOR EMPRESA:\n${d.porEmp.map(([e,o])=>`${e}: ${o.n} placas - ${fmtCOP(o.v)}`).join('\n')}\n\nTOP 25 PLACAS:\n${d.conSaldo.slice(0,25).map(r=>`${r.placa} | ${r.nombre} | ${r.periodosVencidos} per. | ${fmtCOP(r.valorVencido)}`).join('\n')}\n\nSe adjunta el detalle completo en PDF.\n\nAtentamente,\nCartera - Grupo Special Car\n${CARTERA_CORREOS.cartera}`;
  }
  verInforme(tipo);
  window.location.href=`mailto:${CARTERA_CORREOS.cartera}?cc=${encodeURIComponent(cc.join(','))}&subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;
}

// ===== CSV =====
function exportarCarteraCSV(){
  const cols=['Placa','N Interno','Identificacion','Afiliado','Celular','Correo','Empresa','Clase','Ultimo periodo pago','# Periodos vencidos','$ Valor vencido','Estado','N Radicado','Acuerdo','Saldo acuerdo','Proximo compromiso'];
  const rows=(carteraFiltrada.length?carteraFiltrada:cartera.registros).map(r=>{const ac=acuerdoActivoDePlaca(r.placa),t=ac&&totalesAcuerdo(ac);return [r.placa,r.numInterno,r.identificacion,r.nombre,r.celular,r.correo,r.empresa,r.clase,r.ultimoPeriodo,r.periodosVencidos,r.valorVencido,ESTADOS_PLACA[estadoPlacaDe(r.placa)].t,radicadoDe(r.placa),ac?ESTADO_AC[estadoAcuerdo(ac)].t:'',t?t.saldo:'',t&&t.proximo?t.proximo.fecha:''];});
  const csv=[cols,...rows].map(r=>r.map(c=>`"${String(c??'').replace(/"/g,'""')}"`).join(';')).join('\n');
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'})); a.download=`cartera_${hoyISO()}.csv`; a.click();
  mostrarToast('CSV de cartera exportado','success');
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded',()=>{
  cargarCarteraLS(); cargarEmpresasCartera(); actualizarBadgeBackend();
  document.getElementById('modalCartera').addEventListener('click',e=>{ if(e.target.id==='modalCartera') cerrarModalCartera(); });
  cargarCarteraDesdeBackend(true);
  setInterval(()=>{ if(document.visibilityState==='visible') cargarCarteraDesdeBackend(); },60000);
  document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible') cargarCarteraDesdeBackend(); });
  document.addEventListener('focusout',()=>setTimeout(()=>{ if(_renderPendiente) refrescarVistaCartera(); },300));
});
