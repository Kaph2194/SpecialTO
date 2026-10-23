// =====================================================================
// PARQUE AUTOMOTOR / VENCIMIENTOS — consolidado y sincronizacion
// ---------------------------------------------------------------------
// - "Cargar Vencimientos" acepta VARIOS archivos a la vez: los reportes
//   ParqueAutomotor_NN.xlsx (uno por empresa, con la fila "Empresa:") y/o el
//   CONSOLIDADO (columna "Empresa"). Se consolidan solos.
// - El consolidado vive en la hoja de Google de juridico@ (backend de cartera):
//   se llena tambien automaticamente desde el portal SGT, el correo o la carpeta
//   de Drive, y cualquier navegador lo ve igual.
// - Lo que se registra a mano en la tabla (fechas de renovacion, pagos de TO,
//   observaciones, comprobantes en Drive) tambien se comparte entre navegadores.
// Usa el mismo backend y la misma clave que el modulo de cartera (cartera.js).
// =====================================================================

const CAMPOS_GESTION_VEH = ['fechaRenovSoat','fechaRenovSeguros','fechaPagoTO','fechaDocsCompletosTO','fechaRadicadoRUNT','fechaRenovTecno','observacionTO','comprobanteSoat','comprobanteSeguros','comprobanteTO','comprobanteTecno'];
const CAMPOS_BASE_VEH = ['numInterno','identificacion','nombre','empresa','soat','seguros','tarOperacion','tecnicomecanica','preventiva'];
let _parqueVersion = null, _parqueInfo = {}, _placasParque = new Set();
let _gestionSnapshot = {}, _gestionTimer = null, _parqueSyncEnCurso = null, _parqueRenderPendiente = false;
const _gestionPendientes = new Set();

// ---------- Lectura de archivos (ParqueAutomotor por empresa o CONSOLIDADO) ----------
function _norm(s){ return normalizarTexto(s); }
function leerTablaParque(filas){
  let hIdx=-1, empresa='';
  for(let i=0;i<Math.min(filas.length,10);i++){
    const t=filas[i].map(_norm);
    if(t[0]&&t[0].startsWith('empresa')&&t[0].includes(':')) empresa=String(filas[i].slice(1).find(x=>String(x).trim())||'').trim();
    if(hIdx<0&&t.includes('placa')) hIdx=i;
  }
  if(hIdx<0) return null;
  // la columna sin titulo antes de "Estado Vehiculo" es el Estado (Activo/Inactivo)
  const enc=filas[hIdx].map((h,j)=>String(h||'').trim()||(_norm(filas[hIdx][j+1])==='estado vehiculo'?'Estado':`Col${j+1}`));
  const tieneEmpresa=enc.some(h=>_norm(h)==='empresa');
  if(!tieneEmpresa) enc.push('Empresa');
  const iPlaca=enc.findIndex(h=>_norm(h)==='placa');
  // solo vehiculos ACTIVOS (columna Estado y/o "Estado Vehículo")
  const iEst=enc.map((h,j)=>['estado','estado vehiculo'].includes(_norm(h))?j:-1).filter(j=>j>=0);
  const out=[]; let inactivos=0;
  for(let i=hIdx+1;i<filas.length;i++){
    const f=filas[i]; if(!String(f[iPlaca]||'').trim()) continue;
    if(!esActivoFila(iEst.map(j=>f[j]))){ inactivos++; continue; }
    const fila=enc.map((h,j)=>{
      if(!tieneEmpresa&&j===enc.length-1) return empresa;
      const v=f[j];
      if(v instanceof Date) return excelFechaAISO(v);
      return v===null||v===undefined?'':v;
    });
    fila[iPlaca]=String(fila[iPlaca]).trim().toUpperCase();
    out.push(fila);
  }
  return {empresa, encabezados:enc, filas:out, inactivos};
}
function esActivoFila(estados){
  const e=estados.map(_norm).filter(Boolean);
  if(!e.length) return true;
  if(e.some(x=>/^(inactiv|retir|desvinc|bloque|suspend)/.test(x))) return false;
  return e.some(x=>x==='activo'||x==='activos');
}
// Quita de la vista los vehiculos que no estan activos en el consolidado (los creados a
// mano con "Agregar Vehiculo" se conservan). empresas: limitar a esas empresas (carga parcial).
let _placasManuales=new Set();
function depurarVehiculosInactivos(activos, empresas){
  const antes=vehiculos.length;
  vehiculos=vehiculos.filter(v=>activos.has(v.placa)||v.manual||_placasManuales.has(v.placa)||(empresas&&!empresas.has(v.empresa)));
  vehiculos.forEach((v,i)=>{ v.id=i; });
  _placasParque=new Set(activos);
  try{ if(!empresas) localStorage.setItem('sc_parque_activos',JSON.stringify([...activos])); }catch(e){}
  return antes-vehiculos.length;
}

// Aplica una tabla (encabezados + filas) sobre los vehiculos: actualiza SOLO las
// fechas de vencimiento y datos basicos; conserva comprobantes y gestion.
function aplicarTablaVencimientos(encabezados, filas){
  const mapa={}; encabezados.forEach((h,j)=>{ const c=mapearColumna(h); if(c&&!(c in mapa)) mapa[c]=j; });
  if(!('placa' in mapa)) throw new Error('No se encontró la columna "Placa"');
  let actualizados=0, creados=0;
  filas.forEach(f=>{
    const datos={};
    Object.entries(mapa).forEach(([c,j])=>{ let v=f[j]; datos[c]=CAMPOS_FECHA_VENC.includes(c)?excelFechaAISO(v):(v===null||v===undefined?'':String(v).trim()); });
    if(!datos.placa) return;
    datos.placa=String(datos.placa).trim().toUpperCase();
    _placasParque.add(datos.placa);
    const ex=vehiculos.find(v=>v.placa===datos.placa);
    if(ex){
      CAMPOS_FECHA_VENC.forEach(c=>{ if(datos[c]) ex[c]=datos[c]; });
      ['numInterno','identificacion','nombre','empresa'].forEach(c=>{ if(datos[c]) ex[c]=datos[c]; });
      actualizados++;
    }else{
      vehiculos.push({...plantillaVacia(),id:nuevoId(),placa:datos.placa,numInterno:datos.numInterno||'',identificacion:datos.identificacion||'',nombre:datos.nombre||'',empresa:datos.empresa||'',
        soat:datos.soat||null,seguros:datos.seguros||null,tarOperacion:datos.tarOperacion||null,tecnicomecanica:datos.tecnicomecanica||null,preventiva:datos.preventiva||null});
      creados++;
    }
  });
  return {actualizados, creados};
}

// Reemplaza a procesarArchivoVencimientos: uno o varios archivos a la vez.
async function procesarArchivosVencimientos(files){
  const tablas=[], errores=[];
  for(const file of files){
    try{
      const buf=await file.arrayBuffer();
      const wb=XLSX.read(buf,{type:'array',cellDates:true});
      const filas=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:'',raw:true});
      const t=leerTablaParque(filas);
      if(!t||!t.filas.length) throw new Error('sin columna "Placa" o sin vehículos');
      t.archivo=file.name; tablas.push(t);
    }catch(err){ console.error(err); errores.push(`${file.name}: ${err.message}`); }
  }
  if(!tablas.length){ mostrarToast(errores[0]||'No se pudo leer ningún archivo','error'); return; }
  let act=0, cre=0;
  tablas.forEach(t=>{ const r=aplicarTablaVencimientos(t.encabezados,t.filas); act+=r.actualizados; cre+=r.creados; });
  const empresas=[...new Set(tablas.flatMap(t=>{ const i=t.encabezados.findIndex(h=>_norm(h)==='empresa'); return t.filas.map(f=>f[i]); }).filter(Boolean))];
  const inactivosArchivo=tablas.reduce((s,t)=>s+(t.inactivos||0),0);
  const activosArchivo=new Set(tablas.flatMap(t=>{ const i=t.encabezados.findIndex(h=>_norm(h)==='placa'); return t.filas.map(f=>String(f[i]).toUpperCase()); }));
  const quitados=depurarVehiculosInactivos(activosArchivo,new Set(empresas));
  guardarLS();
  guardarUltimaActualizacion(tablas.length>1?`${tablas.length} archivos (${empresas.length} empresas)`:tablas[0].archivo, act+cre);
  recargarEmpresasFiltro();
  if(vistaActual==='dashboard') renderDashboard(); else if(vistaActual==='tabla') renderTabla();
  mostrarToast(`Consolidado (solo activos): ${act} actualizados, ${cre} nuevos · ${empresas.length} empresa(s)${inactivosArchivo?` · ${inactivosArchivo} inactivos descartados`:''}${quitados?` · ${quitados} ya no activos ocultados`:''}${errores.length?` · ${errores.length} archivo(s) con error`:''}`,errores.length?'error':'success');

  // 1) Consolidado compartido (hoja de juridico@) para que todos los navegadores lo vean
  if(typeof CARTERA_BACKEND_ACTIVO!=='undefined'&&CARTERA_BACKEND_ACTIVO){
    try{
      const r=await llamarBackendCartera({accion:'guardarParque',tablas:tablas.map(t=>({encabezados:t.encabezados,filas:t.filas}))});
      _parqueVersion=null;
      mostrarToast(`Consolidado guardado en la hoja compartida: ${r.total} vehículos`,'success');
    }catch(err){ console.warn(err); mostrarToast('Se cargó aquí, pero no se pudo guardar el consolidado compartido','error'); }
  }
  // 2) Backend de vencimientos existente (Sheet + calendario de T.O. del mes)
  sincronizarCalendarioTO();
}

async function sincronizarCalendarioTO(){
  if(!BACKEND_ACTIVO) return;
  try{
    await llamarBackend({accion:'guardarLote',vehiculos});
    const r=await llamarBackend({accion:'sincronizarCalendarioMes'});
    mostrarToast(`Calendario del mes actualizado: ${r.creados} nuevo(s), ${r.actualizados} actualizado(s)`,'success');
  }catch(err){ console.warn('Calendario T.O.',err); }
}

function recargarEmpresasFiltro(){
  const sel=document.getElementById('filtroEmpresa'); if(!sel) return;
  const val=sel.value;
  sel.innerHTML='<option value="">Todas las empresas</option>'+[...new Set(vehiculos.map(v=>v.empresa).filter(Boolean))].sort().map(e=>`<option value="${esc(e)}">${esc(e)}</option>`).join('');
  sel.value=val;
}

// ---------- Gestion manual compartida ----------
function gestionDe(v){
  const g={};
  CAMPOS_GESTION_VEH.forEach(c=>{
    const val=v[c];
    if(c.startsWith('comprobante')){ if(val&&val.url) g[c]={nombre:val.nombre,url:val.url}; } // los guardados solo en el navegador (sin Drive) no se comparten
    else if(val!==null&&val!==undefined&&val!=='') g[c]=val;
  });
  return g;
}
function tomarSnapshotGestion(){ _gestionSnapshot={}; vehiculos.forEach(v=>{ _gestionSnapshot[v.placa]=JSON.stringify(gestionDe(v)); }); }
function programarSyncGestion(){
  if(typeof CARTERA_BACKEND_ACTIVO==='undefined'||!CARTERA_BACKEND_ACTIVO) return;
  clearTimeout(_gestionTimer);
  _gestionTimer=setTimeout(enviarCambiosGestion,1500);
}
async function enviarCambiosGestion(extra){
  const cambios=(extra||[]).slice();
  vehiculos.forEach(v=>{
    const j=JSON.stringify(gestionDe(v));
    if(j!==(_gestionSnapshot[v.placa]||'{}')&&!cambios.some(c=>c.placa===v.placa)){
      const c={placa:v.placa,campos:gestionDe(v),usuario:CARTERA_CORREOS.cartera};
      if(v.manual){ c.campos.base={}; CAMPOS_BASE_VEH.forEach(k=>c.campos.base[k]=v[k]); } // vehiculo creado a mano
      cambios.push(c);
    }
  });
  if(!cambios.length) return;
  cambios.forEach(c=>_gestionPendientes.add(c.placa));
  try{
    await llamarBackendCartera({accion:'guardarGestionVehiculos',cambios});
    cambios.forEach(c=>{ _gestionSnapshot[c.placa]=JSON.stringify(c.campos.base?(({base,...r})=>r)(c.campos):c.campos); });
    _parqueVersion=null;
  }catch(e){ console.warn('Gestion vehiculos',e); }
  finally{ cambios.forEach(c=>_gestionPendientes.delete(c.placa)); }
}
// Todas las ediciones de la tabla pasan por guardarLS(): se envuelve para detectar cambios.
if(typeof guardarLS==='function'){
  const _guardarLSOriginal=guardarLS;
  guardarLS=function(){ _guardarLSOriginal(); programarSyncGestion(); };
}

// ---------- Sincronizacion con el backend ----------
async function sincronizarParque(forzar){
  if(typeof CARTERA_BACKEND_ACTIVO==='undefined'||!CARTERA_BACKEND_ACTIVO) return;
  if(_parqueSyncEnCurso) return _parqueSyncEnCurso;
  _parqueSyncEnCurso=(async()=>{
    try{
      const r=await llamarBackendCartera({accion:'obtenerParque',version:forzar?null:_parqueVersion});
      if(r.sinCambios) return;
      _parqueVersion=r.version;
      _parqueInfo={cargado:r.cargado,origen:r.origen,empresas:r.empresas||{}};
      const gestion=r.gestion||{};
      _placasManuales=new Set(Object.entries(gestion).filter(([p,g])=>g&&g.base).map(([p])=>p));
      let quitados=0;
      if(r.filas&&r.filas.length){
        aplicarTablaVencimientos(r.encabezados,r.filas);
        const iP=r.encabezados.indexOf('Placa');
        quitados=depurarVehiculosInactivos(new Set(r.filas.map(f=>String(f[iP]).toUpperCase())));
      }
      const subir=[];
      Object.entries(gestion).forEach(([placa,g])=>{
        if(_gestionPendientes.has(placa)) return;
        let v=vehiculos.find(x=>x.placa===placa);
        if(!v&&g.base){ v={...plantillaVacia(),id:nuevoId(),placa,...g.base}; vehiculos.push(v); }
        if(!v) return;
        CAMPOS_GESTION_VEH.forEach(c=>{
          if(c in g) v[c]=g[c];
          else if(!(c.startsWith('comprobante')&&v[c]&&v[c].data)) v[c]=null; // se borro en otro navegador
        });
      });
      // migracion: lo registrado en este navegador antes de compartir se sube
      if(!r.filas||!Object.keys(gestion).length){
        vehiculos.forEach(v=>{ const g=gestionDe(v); if(Object.keys(g).length&&!gestion[v.placa]) subir.push({placa:v.placa,campos:g,usuario:CARTERA_CORREOS.cartera}); });
      }
      if(!r.filas||!r.filas.length){
        // la hoja aun no tiene consolidado: se sube el de este navegador
        if(vehiculos.length) llamarBackendCartera({accion:'guardarParque',origen:'Datos existentes de la app',tablas:[{encabezados:['Placa','No Interno','Nombre Propietario','Documento','Vence T. Operacion','Fecha SOAT','Fecha Seguros','Fecha TecMecanica','Fecha Preventiva','Empresa'],
          filas:vehiculos.map(v=>[v.placa,v.numInterno,v.identificacion,v.nombre,v.tarOperacion||'',v.soat||'',v.seguros||'',v.tecnicomecanica||'',v.preventiva||'',v.empresa])}]}).then(()=>{_parqueVersion=null;}).catch(e=>console.warn(e));
      }
      // guarda localmente sin disparar envio
      try{ localStorage.setItem('sc_v3',JSON.stringify(vehiculos.map(datosConComprobantes))); }catch(e){ try{ localStorage.setItem('sc_v3',JSON.stringify(vehiculos.map(datosBaseVehiculo))); }catch(e2){} }
      tomarSnapshotGestion();
      if(subir.length) enviarCambiosGestion(subir);
      recargarEmpresasFiltro(); mostrarInfoParque(); refrescarVistaVencimientos();
      if(quitados) mostrarToast(`${quitados} vehículo(s) inactivos o que ya no están en el consolidado se ocultaron de vencimientos`,'info');
      // calendario de T.O.: una vez por cada consolidado nuevo
      const claveCal='sc_parque_cal_'+(r.cargado||'');
      try{ if(r.cargado&&!localStorage.getItem(claveCal)){ localStorage.setItem(claveCal,'1'); sincronizarCalendarioTO(); } }catch(e){}
    }catch(e){ console.warn('No se pudo leer el parque automotor del backend',e); }
    finally{ _parqueSyncEnCurso=null; }
  })();
  return _parqueSyncEnCurso;
}
function refrescarVistaVencimientos(){
  const a=document.activeElement;
  const ocupado=!document.getElementById('modalDetalle').classList.contains('hidden')||(a&&a.closest&&a.closest('#vista-tabla')&&/INPUT|SELECT|TEXTAREA/.test(a.tagName)&&a.id!=='buscador');
  if(ocupado){ _parqueRenderPendiente=true; return; }
  _parqueRenderPendiente=false;
  if(vistaActual==='dashboard') renderDashboard(); else if(vistaActual==='tabla') renderTabla();
}
function mostrarInfoParque(){
  const el=document.getElementById('ultima-carga-info'); if(!el||!_parqueInfo.cargado) return;
  const emps=Object.keys(_parqueInfo.empresas||{}).length, veh=Object.values(_parqueInfo.empresas||{}).reduce((s,e)=>s+e.vehiculos,0);
  const f=new Date(_parqueInfo.cargado);
  el.textContent=`Consolidado: ${emps} empresas · ${veh} vehículos · ${f.toLocaleDateString('es-CO')} ${f.toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'})}${_parqueInfo.origen?` · ${_parqueInfo.origen}`:''}`;
  el.title=Object.entries(_parqueInfo.empresas||{}).map(([e,o])=>`${e}: ${o.vehiculos} vehículos (${new Date(o.actualizado).toLocaleString('es-CO')})`).join('\n');
}
async function actualizarTodoDesdePortal(){
  if(typeof importarDelPortalAhora==='function') await importarDelPortalAhora();
  await sincronizarParque(true);
}

document.addEventListener('DOMContentLoaded',()=>{
  try{ const a=JSON.parse(localStorage.getItem('sc_parque_activos')||'null'); if(Array.isArray(a)&&a.length){ depurarVehiculosInactivos(new Set(a)); recargarEmpresasFiltro(); refrescarVistaVencimientos(); } }catch(e){}
  vehiculos.forEach(v=>_placasParque.add(v.placa));
  tomarSnapshotGestion();
  sincronizarParque(true);
  setInterval(()=>{ if(document.visibilityState==='visible') sincronizarParque(); },60000);
  document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible') sincronizarParque(); });
  document.addEventListener('focusout',()=>setTimeout(()=>{ if(_parqueRenderPendiente) refrescarVistaVencimientos(); },300));
});
