// ===== CONSTANTES =====
const FROM_EMAIL = 'directortransporte@specialcar.com.co';
const TO_EMAIL   = 'coordinadordocumental@specialcar.com.co';
const HOY = new Date(); HOY.setHours(0,0,0,0);

// URL del Web App de Google Apps Script (backend). Pegar aqui la URL que entrega
// Google al "Implementar > Nueva implementacion > Aplicacion web" (ver SETUP.md).
// Mientras diga 'PEGA_AQUI_TU_URL_DE_APPS_SCRIPT', los comprobantes y las fechas
// se siguen guardando localmente en el navegador como hasta ahora (nada se rompe).
const WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbwUyaxCtT0gjPek7fR0gtE-XNKC8_MZTYEHDtyG2lOCoCPTS2c-pFmoimEgsi7wnYo/exec';
const BACKEND_ACTIVO = WEBAPP_URL.startsWith('https://');

// ===== ESTADO =====
let vehiculos = JSON.parse(JSON.stringify(VEHICULOS_DATA));
let vehiculosFiltrados = [];
let vistaActual = 'dashboard';

// ===== FECHA UTILS =====
const parseD = s => { if (!s) return null; const d = new Date(s+'T00:00:00'); return isNaN(d)?null:d; };
const fmtD   = s => { const d=parseD(s); if(!d) return '—'; return d.toLocaleDateString('es-CO',{day:'2-digit',month:'2-digit',year:'numeric'}); };
const diasR  = s => { const d=parseD(s); if(!d) return null; return Math.round((d-HOY)/86400000); };

function estadoDoc(fecha, esTO) {
  const dias = diasR(fecha);
  if (dias===null) return 'sin';
  if (dias < 0) return 'vencido';
  if (dias <= (esTO?90:30)) return esTO ? 'alerta_to' : 'alerta';
  return 'vigente';
}
function cellClass(est) {
  return {vigente:'cell-g',alerta:'cell-y',alerta_to:'cell-o',vencido:'cell-r',sin:'cell-n'}[est]||'cell-n';
}
function filaClass(v) {
  const ests = [estadoDoc(v.soat,false),estadoDoc(v.seguros,false),estadoDoc(v.tarOperacion,true),estadoDoc(v.tecnicomecanica,false)];
  if (ests.includes('vencido')) return 'fila-vencido';
  if (ests.includes('alerta')||ests.includes('alerta_to')) return 'fila-alerta';
  return 'fila-vigente';
}

// ===== DEMORA EN EL PROCESO DE TARJETA DE OPERACION =====
// Regla: si entre el pago de la TO y la fecha de documentos completos pasan mas de 3 dias,
// o entre documentos completos y el radicado en RUNT pasan mas de 3 dias, se considera una
// demora en el proceso y se pide dejar una observacion explicando el motivo.
function demoraTO(v){
  const pago=parseD(v.fechaPagoTO), docs=parseD(v.fechaDocsCompletosTO), radicado=parseD(v.fechaRadicadoRUNT);
  const r={demoraPagoDocs:false,demoraDocsRadicado:false,diasPagoDocs:null,diasDocsRadicado:null};
  if(pago && docs){
    const d=Math.round((docs-pago)/86400000);
    r.diasPagoDocs=d;
    if(d>3) r.demoraPagoDocs=true;
  }
  if(docs && radicado){
    const d=Math.round((radicado-docs)/86400000);
    r.diasDocsRadicado=d;
    if(d>3) r.demoraDocsRadicado=true;
  }
  r.hayDemora=r.demoraPagoDocs||r.demoraDocsRadicado;
  return r;
}

// ===== NAVEGACION =====
function irAVista(v) {
  vistaActual = v;
  ['dashboard','tabla','cartera'].forEach(x=>{
    const vista=document.getElementById('vista-'+x), nav=document.getElementById('nav-'+x);
    if(vista) vista.classList.toggle('hidden', v!==x);
    if(nav) nav.classList.toggle('active', v===x);
  });
  // Los botones del encabezado (cargar vencimientos, reporte gerencia, agregar vehiculo) son del modulo de vencimientos
  const accVenc=document.getElementById('header-actions-venc');
  if(accVenc) accVenc.classList.toggle('acciones-ocultas', v==='cartera');
  if (v==='dashboard') renderDashboard();
  if (v==='tabla') renderTabla();
  if (v==='cartera' && typeof renderCartera==='function') renderCartera();
}

// ===== DASHBOARD =====
function renderDashboard() {
  const docs=[{k:'soat',n:'SOAT',to:false},{k:'seguros',n:'Seguros',to:false},{k:'tarOperacion',n:'T. Operacion',to:true},{k:'tecnicomecanica',n:'Tecnicomecanica',to:false}];
  let totV=0,totVenc=0,totAlerta=0,totOk=0;
  vehiculos.forEach(v=>{
    const ests=docs.map(d=>estadoDoc(v[d.k],d.to));
    totV++;
    if(ests.includes('vencido')) totVenc++;
    else if(ests.includes('alerta')||ests.includes('alerta_to')) totAlerta++;
    else totOk++;
  });
  document.getElementById('d-total').textContent=totV;
  document.getElementById('d-vencidos').textContent=totVenc;
  document.getElementById('d-alertas').textContent=totAlerta;
  document.getElementById('d-vigentes').textContent=totOk;

  // Doc status
  document.getElementById('doc-status-grid').innerHTML=docs.map(d=>{
    let vc=0,al=0,vi=0;
    vehiculos.forEach(v=>{const e=estadoDoc(v[d.k],d.to);if(e==='vencido')vc++;else if(e==='alerta'||e==='alerta_to')al++;else if(e==='vigente')vi++;});
    const tot=vc+al+vi||1;
    const pV=Math.round(vc/tot*100),pA=Math.round(al/tot*100),pG=Math.round(vi/tot*100);
    return `<div class="doc-stat">
      <div class="doc-stat-title">${d.n}</div>
      <div class="doc-stat-bars">
        <div class="stat-bar-row"><span class="bar-label" style="color:var(--red)">Vencido</span><div class="stat-bar-track"><div class="stat-bar-fill fill-r" style="width:${pV}%"></div></div><span class="bar-num">${vc}</span></div>
        <div class="stat-bar-row"><span class="bar-label" style="color:var(--orange)">Alerta</span><div class="stat-bar-track"><div class="stat-bar-fill fill-y" style="width:${pA}%"></div></div><span class="bar-num">${al}</span></div>
        <div class="stat-bar-row"><span class="bar-label" style="color:var(--green)">Vigente</span><div class="stat-bar-track"><div class="stat-bar-fill fill-g" style="width:${pG}%"></div></div><span class="bar-num">${vi}</span></div>
      </div>
    </div>`;
  }).join('');

  // Lista alertas
  const criticos=vehiculos.filter(v=>docs.some(d=>['vencido','alerta','alerta_to'].includes(estadoDoc(v[d.k],d.to)))).slice(0,25);
  document.getElementById('lista-alertas-dashboard').innerHTML=criticos.length===0
    ?'<div class="empty-msg">Ningun vehiculo con alertas activas</div>'
    :criticos.map(v=>{
      const badges=docs.map(d=>{
        const e=estadoDoc(v[d.k],d.to);
        if(e==='vigente'||e==='sin') return '';
        const st=e==='vencido'?'background:var(--red-bg);color:var(--red)':e==='alerta_to'?'background:var(--orange-bg);color:var(--orange)':'background:var(--yellow-bg);color:var(--yellow)';
        const dias=diasR(v[d.k]);
        return `<span class="cell-doc" style="font-size:10px;padding:2px 6px;${st}">${d.n} ${dias<0?'venc.':dias+'d'}</span>`;
      }).filter(Boolean).join('');
      return `<div class="alerta-dash-item">
        <span class="alerta-placa">${v.placa}</span>
        <span class="alerta-nombre">${v.nombre}</span>
        <div class="alerta-docs">${badges}</div>
        <button class="alerta-btn" onclick="notificarVehiculo(${v.id})">Notificar</button>
      </div>`;
    }).join('');

  // Chart barras
  const meses=[];
  for(let i=0;i<6;i++){const d=new Date(HOY);d.setMonth(d.getMonth()+i);meses.push({label:`${d.toLocaleString('es-CO',{month:'short'})} ${d.getFullYear().toString().slice(2)}`,y:d.getFullYear(),m:d.getMonth(),v:0,a:0});}
  vehiculos.forEach(v=>{docs.forEach(d=>{const f=parseD(v[d.k]);if(!f)return;const idx=meses.findIndex(mm=>mm.y===f.getFullYear()&&mm.m===f.getMonth());if(idx>=0){const e=estadoDoc(v[d.k],d.to);if(e==='vencido')meses[idx].v++;else if(e==='alerta'||e==='alerta_to')meses[idx].a++;}});});
  const maxV=Math.max(...meses.map(m=>m.v+m.a),1);
  const H=120;
  document.getElementById('chart-meses').innerHTML=meses.map(m=>{
    const hV=Math.round((m.v/maxV)*H),hA=Math.round((m.a/maxV)*H);
    return `<div class="chart-bar-group">
      <div class="chart-bar-num">${m.v+m.a||''}</div>
      <div class="chart-bar-stack" style="height:${H}px">
        <div class="chart-bar-seg fill-r" style="height:${hV}px" title="${m.v} vencidos"></div>
        <div class="chart-bar-seg fill-y" style="height:${hA}px" title="${m.a} en alerta"></div>
      </div>
      <div class="chart-bar-label">${m.label}</div>
    </div>`;
  }).join('');
}

// ===== TABLA =====
function renderTabla() {
  vehiculosFiltrados=aplicarFiltros();
  document.getElementById('count-label').textContent=`${vehiculosFiltrados.length} registros`;
  const tbody=document.getElementById('tbodyVehiculos');
  if(vehiculosFiltrados.length===0){tbody.innerHTML=`<tr><td colspan="20" class="empty-msg">Sin resultados</td></tr>`;return;}
  tbody.innerHTML=vehiculosFiltrados.map(v=>renderFila(v)).join('');
  bindTablaEvents(tbody);
}

function renderFila(v) {
  const {id}=v;
  const cellDoc=(campo,esTO)=>{
    const val=v[campo],e=estadoDoc(val,esTO),dias=diasR(val);
    const tip=val&&dias!==null?(dias<0?`Vencido hace ${Math.abs(dias)}d`:`Vence en ${dias}d`):'Sin fecha';
    return `<td><span class="cell-doc ${cellClass(e)}" title="${tip}">${val?fmtD(val):'--'}</span></td>`;
  };
  const inpF=(campo)=>`<input type="date" class="inp-fecha" data-id="${id}" data-campo="${campo}" value="${v[campo]||''}" />`;
  const bComp=(campo,tdcls)=>{
    const arch=v[campo],has=!!(arch&&arch.nombre);
    return `<td class="${tdcls}"><label class="btn-comp ${has?'has-f':''}" title="${has?arch.nombre:'Adjuntar comprobante (PDF o imagen)'}">${has?`${arch.nombre.slice(0,10)}...`:'Adjuntar'}<input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.gif" class="comp-input" data-id="${id}" data-campo="${campo}" style="display:none"/></label>${has?`<button style="margin-left:3px;background:none;border:none;cursor:pointer;font-size:10px;color:var(--blue)" onclick="verComprobante(${id},'${campo}')">ver</button>`:''}</td>`;
  };
  const celdaObsTO=()=>{
    const d=demoraTO(v);
    const partes=[];
    if(d.demoraPagoDocs) partes.push(`Pago→Docs: ${d.diasPagoDocs}d`);
    if(d.demoraDocsRadicado) partes.push(`Docs→Radicado: ${d.diasDocsRadicado}d`);
    const tip=partes.length?`Demora detectada (${partes.join(' · ')}). Registra el motivo.`:'Sin demoras detectadas en el proceso';
    const alerta=d.hayDemora && !v.observacionTO;
    return `<td class="td-to-e"><input type="text" class="inp-obs-to ${alerta?'obs-to-alerta':''}" data-id="${id}" placeholder="${d.hayDemora?'⚠ Explica la demora...':'Observación (opcional)'}" title="${tip}" value="${v.observacionTO||''}"/></td>`;
  };
  return `<tr class="${filaClass(v)}" id="fila-${id}">
    <td>${v.placa}</td>
    <td>${v.numInterno||'--'}</td>
    <td style="max-width:145px;overflow:hidden;text-overflow:ellipsis" title="${v.nombre}">${v.nombre}</td>
    <td><span class="empresa-tag" title="${v.empresa}">${v.empresa}</span></td>
    ${cellDoc('soat',false)}
    <td class="td-soat-e">${inpF('fechaRenovSoat')}</td>
    ${bComp('comprobanteSoat','td-soat-e')}
    ${cellDoc('seguros',false)}
    <td class="td-seg-e">${inpF('fechaRenovSeguros')}</td>
    ${bComp('comprobanteSeguros','td-seg-e')}
    ${cellDoc('tarOperacion',true)}
    <td class="td-to-e">${inpF('fechaPagoTO')}</td>
    ${bComp('comprobanteTO','td-to-e')}
    <td class="td-to-e">${inpF('fechaDocsCompletosTO')}</td>
    <td class="td-to-e">${inpF('fechaRadicadoRUNT')}</td>
    ${celdaObsTO()}
    ${cellDoc('tecnicomecanica',false)}
    <td class="td-tec-e">${inpF('fechaRenovTecno')}</td>
    ${bComp('comprobanteTecno','td-tec-e')}
    <td style="text-align:center"><button class="btn-notif" onclick="notificarVehiculo(${id})">Notificar</button></td>
  </tr>`;
}

function bindTablaEvents(tbody) {
  tbody.querySelectorAll('.inp-fecha').forEach(el=>el.addEventListener('change',e=>{
    const id=parseInt(e.target.dataset.id),campo=e.target.dataset.campo;
    vehiculos[id][campo]=e.target.value||null;guardarLS();reRender(id);
  }));
  tbody.querySelectorAll('.inp-obs-to').forEach(el=>el.addEventListener('change',e=>{
    const id=parseInt(e.target.dataset.id);
    vehiculos[id].observacionTO=e.target.value.trim()||null;guardarLS();reRender(id);
  }));
  tbody.querySelectorAll('.comp-input').forEach(el=>el.addEventListener('change',e=>{
    const id=parseInt(e.target.dataset.id),campo=e.target.dataset.campo,file=e.target.files[0];
    if(!file) return;
    const tipoValido=/^(application\/pdf|image\/(jpeg|png|webp|gif))$/.test(file.type);
    if(!tipoValido){ mostrarToast('Formato no soportado: adjunta un PDF o una imagen (jpg, png, webp, gif)','error'); e.target.value=''; return; }
    const LIMITE_MB=4;
    if(file.size>LIMITE_MB*1024*1024){ mostrarToast(`El archivo pesa mas de ${LIMITE_MB}MB. Usa un PDF/foto mas liviano para poder guardarlo`,'error'); e.target.value=''; return; }
    const NOMBRES_DOC={comprobanteSoat:'SOAT',comprobanteSeguros:'Seguros',comprobanteTO:'TO',comprobanteTecno:'Tecno'};
    (async()=>{
      if(BACKEND_ACTIVO){
        try{
          mostrarToast('Subiendo comprobante a Drive...','info');
          const subido=await subirComprobanteADrive(file,vehiculos[id].placa,NOMBRES_DOC[campo]||campo);
          vehiculos[id][campo]=subido; // {nombre,url} -> ya no ocupa espacio en el navegador
          guardarLS();reRender(id);
          mostrarToast('Comprobante guardado en Drive','success');
          return;
        }catch(err){
          console.warn('Fallo subida a Drive, se guarda localmente',err);
          mostrarToast('No se pudo subir a Drive, se guardo solo en este navegador','error');
        }
      }
      // Modo local (backend no configurado o subida fallida): igual que antes.
      const r=new FileReader();
      r.onload=ev=>{vehiculos[id][campo]={nombre:file.name,data:ev.target.result};guardarLS();reRender(id);};
      r.readAsDataURL(file);
    })();
  }));
}

function reRender(id) {
  const v=vehiculos[id],fila=document.getElementById(`fila-${id}`);
  if(!fila) return;
  const tmp=document.createElement('tbody');tmp.innerHTML=renderFila(v);
  fila.replaceWith(tmp.firstElementChild);
  bindTablaEvents(document.getElementById(`fila-${id}`).parentElement);
}

// ===== FILTROS =====
function aplicarFiltros() {
  const q=document.getElementById('buscador').value.toLowerCase().trim();
  const emp=document.getElementById('filtroEmpresa').value;
  const fS=document.getElementById('filtroSOAT').value;
  const fSg=document.getElementById('filtroSeguros').value;
  const fT=document.getElementById('filtroTO').value;
  const fTc=document.getElementById('filtroTecno').value;
  return vehiculos.filter(v=>{
    if(q&&!`${v.placa} ${v.nombre} ${v.empresa} ${v.identificacion} ${v.numInterno}`.toLowerCase().includes(q))return false;
    if(emp&&v.empresa!==emp)return false;
    if(fS&&estadoDoc(v.soat,false)!==fS)return false;
    if(fSg&&estadoDoc(v.seguros,false)!==fSg)return false;
    if(fT&&estadoDoc(v.tarOperacion,true)!==fT)return false;
    if(fTc&&estadoDoc(v.tecnicomecanica,false)!==fTc)return false;
    return true;
  });
}
function filtrarTabla(){renderTabla();}
function limpiarFiltros(){
  ['buscador','filtroEmpresa','filtroSOAT','filtroSeguros','filtroTO','filtroTecno'].forEach(id=>{document.getElementById(id).value='';});
  renderTabla();
}
function cargarEmpresas(){
  const sel=document.getElementById('filtroEmpresa');
  [...new Set(vehiculos.map(v=>v.empresa))].sort().forEach(e=>{const o=document.createElement('option');o.value=e;o.textContent=e;sel.appendChild(o);});
}

// ===== MODAL =====
function abrirModalNuevo(){
  document.getElementById('modalTitulo').textContent='Agregar Vehiculo';
  document.getElementById('modalContenido').innerHTML=buildForm(null);
  document.getElementById('modalDetalle').classList.remove('hidden');
}
function cerrarModal(){document.getElementById('modalDetalle').classList.add('hidden');}
function buildForm(v){
  const val=c=>v?(v[c]||''):'';
  return `<div class="form-sect">Datos del Vehiculo</div>
  <div class="form-grid">
    <div class="form-group"><label>Placa</label><input id="f_placa" value="${val('placa')}" placeholder="ABC123"/></div>
    <div class="form-group"><label>N Interno</label><input id="f_numInterno" value="${val('numInterno')}"/></div>
    <div class="form-group"><label>Identificacion</label><input id="f_identificacion" value="${val('identificacion')}"/></div>
    <div class="form-group"><label>Nombre Conductor</label><input id="f_nombre" value="${val('nombre')}"/></div>
    <div class="form-group" style="grid-column:span 2"><label>Empresa</label>
      <input id="f_empresa" value="${val('empresa')}" list="emp-dl"/>
      <datalist id="emp-dl">${[...new Set(vehiculos.map(x=>x.empresa))].sort().map(e=>`<option value="${e}">`).join('')}</datalist>
    </div>
  </div>
  <div class="form-sect">Fechas de Vencimiento</div>
  <div class="form-grid form-grid-3">
    <div class="form-group"><label>SOAT</label><input type="date" id="f_soat" value="${val('soat')}"/></div>
    <div class="form-group"><label>Seguros</label><input type="date" id="f_seguros" value="${val('seguros')}"/></div>
    <div class="form-group"><label>Tarjeta Operacion</label><input type="date" id="f_tarOperacion" value="${val('tarOperacion')}"/></div>
    <div class="form-group"><label>Tecnicomecanica</label><input type="date" id="f_tecnicomecanica" value="${val('tecnicomecanica')}"/></div>
  </div>
  <div class="form-sect form-sect-to">Tarjeta de Operacion Gestion</div>
  <div class="form-grid form-grid-3">
    <div class="form-group"><label>Fecha Pago TO</label><input type="date" id="f_fechaPagoTO" value="${val('fechaPagoTO')}"/></div>
    <div class="form-group"><label>F. Docs Completos</label><input type="date" id="f_fechaDocsCompletosTO" value="${val('fechaDocsCompletosTO')}"/></div>
    <div class="form-group"><label>F. Radicado RUNT</label><input type="date" id="f_fechaRadicadoRUNT" value="${val('fechaRadicadoRUNT')}"/></div>
  </div>`;
}
function guardarRegistro(){
  const placa=document.getElementById('f_placa').value.trim().toUpperCase();
  if(!placa){mostrarToast('La placa es requerida','error');return;}
  const datos={placa,numInterno:document.getElementById('f_numInterno').value.trim(),identificacion:document.getElementById('f_identificacion').value.trim(),nombre:document.getElementById('f_nombre').value.trim(),empresa:document.getElementById('f_empresa').value.trim(),soat:document.getElementById('f_soat').value||null,seguros:document.getElementById('f_seguros').value||null,tarOperacion:document.getElementById('f_tarOperacion').value||null,tecnicomecanica:document.getElementById('f_tecnicomecanica').value||null,fechaPagoTO:document.getElementById('f_fechaPagoTO').value||null,fechaDocsCompletosTO:document.getElementById('f_fechaDocsCompletosTO').value||null,fechaRadicadoRUNT:document.getElementById('f_fechaRadicadoRUNT').value||null};
  const idx=vehiculos.findIndex(x=>x.placa===placa);
  if(idx>=0){Object.assign(vehiculos[idx],datos);mostrarToast('Registro actualizado','success');}
  else{vehiculos.push({...plantillaVacia(),id:nuevoId(),manual:true,...datos});mostrarToast('Vehiculo agregado','success');}
  guardarLS();cerrarModal();
  if(vistaActual==='dashboard')renderDashboard();else renderTabla();
}

// ===== NOTIFICACIONES =====
function notificarVehiculo(id){
  const v=vehiculos[id];
  const docs=[{n:'SOAT',f:v.soat,to:false},{n:'Seguros',f:v.seguros,to:false},{n:'Tarjeta de Operacion',f:v.tarOperacion,to:true},{n:'Tecnicomecanica',f:v.tecnicomecanica,to:false}];
  const alertas=docs.map(d=>{const e=estadoDoc(d.f,d.to),dias=diasR(d.f);if(e==='vencido')return `VENCIDO ${d.n}: ${fmtD(d.f)} (hace ${Math.abs(dias)} dias)`;if(e==='alerta'||e==='alerta_to')return `ALERTA ${d.n}: vence ${fmtD(d.f)} (en ${dias} dias)`;return null;}).filter(Boolean);
  if(alertas.length===0){mostrarToast(`${v.placa} no tiene alertas`,'info');return;}
  const asunto=encodeURIComponent(`[ALERTA VENCIMIENTO] Vehiculo ${v.placa} - ${v.nombre}`);
  const cuerpo=encodeURIComponent(`Cordial saludo,\n\nDesde la Direccion de Transporte se notifican los siguientes vencimientos:\n\nPlaca: ${v.placa}\nConductor: ${v.nombre}\nEmpresa: ${v.empresa}\nIdentificacion: ${v.identificacion}\n\nDOCUMENTOS EN ALERTA:\n${alertas.join('\n')}\n\nPor favor gestionar la renovacion a la mayor brevedad.\n\nAtentamente,\nDireccion de Transporte - SpecialCar\nCorreo: ${FROM_EMAIL}\nFecha: ${new Date().toLocaleDateString('es-CO')}`);
  window.location.href=`mailto:${TO_EMAIL}?subject=${asunto}&body=${cuerpo}`;
  mostrarToast(`Correo generado para ${v.placa} hacia ${TO_EMAIL}`,'success');
}
function notificarTodos(){
  const con=vehiculos.filter(v=>['soat','seguros','tarOperacion','tecnicomecanica'].some((d,i)=>['vencido','alerta','alerta_to'].includes(estadoDoc(v[d],[false,false,true,false][i]))));
  if(con.length===0){mostrarToast('Sin alertas activas','info');return;}
  const lineas=con.map(v=>{const ds=[{k:'soat',to:false},{k:'seguros',to:false},{k:'tarOperacion',to:true},{k:'tecnicomecanica',to:false}];const res=ds.filter(d=>['vencido','alerta','alerta_to'].includes(estadoDoc(v[d.k],d.to))).map(d=>`${d.k.toUpperCase()}:${fmtD(v[d.k])}`).join('|');return `${v.placa} | ${v.nombre} | ${res}`;}).join('\n');
  const asunto=encodeURIComponent(`[RESUMEN VENCIMIENTOS] ${con.length} vehiculos - ${new Date().toLocaleDateString('es-CO')}`);
  const cuerpo=encodeURIComponent(`Cordial saludo,\n\nResumen de vencimientos al ${new Date().toLocaleDateString('es-CO')}:\nTotal en alerta: ${con.length}\n\nPLACA | CONDUCTOR | DOCUMENTOS\n${'-'.repeat(60)}\n${lineas}\n\nAtentamente,\nDireccion de Transporte - SpecialCar\n${FROM_EMAIL}`);
  window.location.href=`mailto:${TO_EMAIL}?subject=${asunto}&body=${cuerpo}`;
  mostrarToast(`Resumen generado: ${con.length} vehiculos hacia ${TO_EMAIL}`,'success');
}

// ===== VER COMPROBANTE (PDF o IMAGEN, en Drive o guardado localmente) =====
function verComprobante(id,campo){
  const arch=vehiculos[id][campo];if(!arch)return;
  if(arch.url){ window.open(arch.url,'_blank'); return; } // guardado en Drive: se abre directo
  if(!arch.data) return;
  const esImagen=/^data:image\//.test(arch.data);
  const w=window.open('','_blank');
  if(esImagen){
    w.document.write(`<html><head><title>${arch.nombre}</title></head><body style="margin:0;background:#111;display:flex;align-items:center;justify-content:center;min-height:100vh"><img src="${arch.data}" style="max-width:100%;max-height:100vh;object-fit:contain"/></body></html>`);
  }else{
    w.document.write(`<html><head><title>${arch.nombre}</title></head><body style="margin:0"><embed src="${arch.data}" type="application/pdf" width="100%" style="height:100vh"/></body></html>`);
  }
}

// ===== CSV =====
function exportarCSV(){
  const cols=['Placa','N Interno','Nombre','Empresa','SOAT','Estado SOAT','Seguros','Estado Seguros','T.Operacion','Estado TO','Tecnicomecanica','Estado Tecno'];
  const rows=vehiculosFiltrados.map(v=>[v.placa,v.numInterno,v.nombre,v.empresa,v.soat||'',estadoDoc(v.soat,false),v.seguros||'',estadoDoc(v.seguros,false),v.tarOperacion||'',estadoDoc(v.tarOperacion,true),v.tecnicomecanica||'',estadoDoc(v.tecnicomecanica,false)]);
  const csv=[cols,...rows].map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`vencimientos_${new Date().toISOString().slice(0,10)}.csv`;a.click();
  mostrarToast('CSV exportado','success');
}

// ===== REPORTE GERENCIA =====
function generarReporteGerencia(){
  const docs=[{k:'soat',n:'SOAT',to:false},{k:'seguros',n:'Seguros',to:false},{k:'tarOperacion',n:'T.Operacion',to:true},{k:'tecnicomecanica',n:'Tecnicomecanica',to:false}];
  const rs={};docs.forEach(d=>{let vc=0,al=0,vi=0;vehiculos.forEach(v=>{const e=estadoDoc(v[d.k],d.to);if(e==='vencido')vc++;else if(e==='alerta'||e==='alerta_to')al++;else if(e==='vigente')vi++;});rs[d.k]={v:vc,a:al,g:vi};});
  const conAlerta=vehiculos.filter(v=>docs.some(d=>['vencido','alerta','alerta_to'].includes(estadoDoc(v[d.k],d.to))));
  const fecha=new Date().toLocaleDateString('es-CO',{day:'2-digit',month:'long',year:'numeric'});
  const totalDocs=Object.values(rs).reduce((a,r)=>a+r.v,0);
  const totalAl=Object.values(rs).reduce((a,r)=>a+r.a,0);
  const win=window.open('','_blank');
  win.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Reporte Gerencial SpecialCar ${fecha}</title><style>
    body{font-family:'Segoe UI',sans-serif;color:#1f2937;padding:36px;max-width:950px;margin:0 auto}
    h1{font-size:22px;color:#1e3a5f;margin-bottom:2px}
    .sub{color:#6b7280;font-size:13px;margin-bottom:26px}
    .kpi-row{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:26px}
    .kpi{padding:16px;border-radius:8px;text-align:center;border:1.5px solid #e5e7eb}
    .kpi-n{font-size:30px;font-weight:800}.kpi-l{font-size:11px;color:#6b7280;margin-top:3px}
    .kv{border-color:#fecaca;background:#fef2f2}.kv .kpi-n{color:#b91c1c}
    .ka{border-color:#fde68a;background:#fffbeb}.ka .kpi-n{color:#92400e}
    .kg{border-color:#bbf7d0;background:#f0fdf4}.kg .kpi-n{color:#15803d}
    .kt{border-color:#bfdbfe;background:#eff6ff}.kt .kpi-n{color:#1d4ed8}
    h2{font-size:14px;font-weight:700;color:#1e3a5f;margin:0 0 12px;border-bottom:2px solid #e5e7eb;padding-bottom:6px}
    .doc-res{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:26px}
    .dr{padding:12px;border:1.5px solid #e5e7eb;border-radius:6px}
    .dr-t{font-size:10px;font-weight:700;text-transform:uppercase;color:#6b7280;margin-bottom:8px}
    .dr-r{display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px}
    table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:26px}
    th{background:#1e3a5f;color:#fff;padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase}
    td{padding:7px 10px;border-bottom:1px solid #f3f4f6}tr:nth-child(even) td{background:#f9fafb}
    .b{display:inline-block;padding:2px 7px;border-radius:20px;font-size:10px;font-weight:600}
    .bv{background:#fef2f2;color:#b91c1c;border:1px solid #fecaca}.ba{background:#fffbeb;color:#92400e;border:1px solid #fde68a}.bg{background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0}
    .footer{margin-top:40px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:10px;color:#9ca3af;text-align:center}
    .topbar{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px}
    @media print{.no-print{display:none!important}}
  </style></head><body>
  <div class="topbar">
    <div><h1>Reporte Gerencial de Vencimientos</h1><div class="sub">SpecialCar &mdash; ${fecha}</div></div>
    <button class="no-print" onclick="window.print()" style="padding:9px 16px;background:#1e3a5f;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600">Imprimir / Guardar PDF</button>
  </div>
  <div class="kpi-row">
    <div class="kpi kt"><div class="kpi-n">${vehiculos.length}</div><div class="kpi-l">Total vehiculos</div></div>
    <div class="kpi kv"><div class="kpi-n">${totalDocs}</div><div class="kpi-l">Docs vencidos</div></div>
    <div class="kpi ka"><div class="kpi-n">${totalAl}</div><div class="kpi-l">Docs en alerta</div></div>
    <div class="kpi kg"><div class="kpi-n">${vehiculos.length-conAlerta.length}</div><div class="kpi-l">Vehiculos al dia</div></div>
  </div>
  <h2>Estado por tipo de documento</h2>
  <div class="doc-res">${docs.map(d=>`<div class="dr"><div class="dr-t">${d.n}</div>
    <div class="dr-r"><span style="color:#b91c1c">Vencido</span><strong>${rs[d.k].v}</strong></div>
    <div class="dr-r"><span style="color:#92400e">Alerta</span><strong>${rs[d.k].a}</strong></div>
    <div class="dr-r"><span style="color:#15803d">Vigente</span><strong>${rs[d.k].g}</strong></div>
  </div>`).join('')}</div>
  <h2>Vehiculos con alertas o documentos vencidos (${conAlerta.length})</h2>
  <table><thead><tr><th>Placa</th><th>Conductor</th><th>Empresa</th><th>SOAT</th><th>Seguros</th><th>T.Operacion</th><th>Tecnicomecanica</th></tr></thead>
  <tbody>${conAlerta.map(v=>{
    const bc=(f,to)=>{const e=estadoDoc(f,to),c=e==='vencido'?'bv':e==='alerta'||e==='alerta_to'?'ba':'bg';return `<span class="b ${c}">${f?fmtD(f):'--'}</span>`;};
    return `<tr><td><strong>${v.placa}</strong></td><td>${v.nombre}</td><td>${v.empresa}</td><td>${bc(v.soat,false)}</td><td>${bc(v.seguros,false)}</td><td>${bc(v.tarOperacion,true)}</td><td>${bc(v.tecnicomecanica,false)}</td></tr>`;
  }).join('')}</tbody></table>
  <div class="footer">Reporte Sistema de Vencimientos SpecialCar &mdash; ${fecha} &mdash; Confidencial</div>
  </body></html>`);win.document.close();
}

// ===== BACKEND (Drive + Google Sheet, via Google Apps Script) =====
async function llamarBackend(payload){
  if(!BACKEND_ACTIVO) throw new Error('backend no configurado');
  const resp=await fetch(WEBAPP_URL,{
    method:'POST',
    // text/plain evita el preflight CORS que Apps Script no responde bien.
    headers:{'Content-Type':'text/plain;charset=utf-8'},
    body:JSON.stringify(payload)
  });
  const data=await resp.json();
  if(data && data.error) throw new Error(data.error);
  return data;
}

// Sube un comprobante a la carpeta unica de Drive. Devuelve {nombre,url} si el
// backend esta activo; si no, devuelve null y el llamador debe usar el modo local.
async function subirComprobanteADrive(file,placa,tipoDoc){
  if(!BACKEND_ACTIVO) return null;
  const dataUrl=await new Promise((resolve,reject)=>{
    const r=new FileReader();
    r.onload=()=>resolve(r.result);
    r.onerror=reject;
    r.readAsDataURL(file);
  });
  const base64=dataUrl.split(',')[1];
  const resultado=await llamarBackend({accion:'subirComprobante',nombre:file.name,data:base64,tipo:file.type,placa,tipoDoc});
  return {nombre:resultado.nombre,url:resultado.url};
}

// Guarda (upsert) todos los vehiculos en la Google Sheet compartida. No bloquea la
// interfaz: si falla (sin internet, backend no configurado, etc.) solo se avisa
// una vez por sesion para no llenar de toasts, y el dato sigue guardado localmente.
let _avisoBackendMostrado=false;
async function sincronizarLote(lista){
  if(!BACKEND_ACTIVO) return;
  try{
    await llamarBackend({accion:'guardarLote',vehiculos:lista});
  }catch(e){
    console.warn('Sincronizacion de lote fallo',e);
    if(!_avisoBackendMostrado){ mostrarToast('No se pudo sincronizar con Drive/Sheets. Los cambios quedan guardados en este navegador.','error'); _avisoBackendMostrado=true; }
  }
}

// ===== LOCAL STORAGE =====
function datosBaseVehiculo(v){
  return {id:v.id,manual:v.manual||undefined,placa:v.placa,numInterno:v.numInterno,identificacion:v.identificacion,nombre:v.nombre,empresa:v.empresa,soat:v.soat,seguros:v.seguros,tarOperacion:v.tarOperacion,tecnicomecanica:v.tecnicomecanica,preventiva:v.preventiva,fechaRenovSoat:v.fechaRenovSoat,fechaRenovSeguros:v.fechaRenovSeguros,fechaPagoTO:v.fechaPagoTO,fechaDocsCompletosTO:v.fechaDocsCompletosTO,fechaRadicadoRUNT:v.fechaRadicadoRUNT,fechaRenovTecno:v.fechaRenovTecno,observacionTO:v.observacionTO};
}
function datosConComprobantes(v){
  return {...datosBaseVehiculo(v),comprobanteSoat:v.comprobanteSoat,comprobanteSeguros:v.comprobanteSeguros,comprobanteTO:v.comprobanteTO,comprobanteTecno:v.comprobanteTecno,comprobantePrev:v.comprobantePrev};
}
let _syncTimeout=null;
function guardarLS(){
  try{
    localStorage.setItem('sc_v3',JSON.stringify(vehiculos.map(datosConComprobantes)));
  }catch(e){
    // Si el navegador se queda sin espacio (comprobantes muy pesados en conjunto),
    // se guarda al menos la info y fechas para no perder la actualizacion, y se avisa.
    console.warn('LS (con comprobantes)',e);
    try{
      localStorage.setItem('sc_v3',JSON.stringify(vehiculos.map(datosBaseVehiculo)));
      mostrarToast('Almacenamiento local lleno: se guardaron las fechas pero no todos los comprobantes adjuntos','error');
    }catch(e2){ console.warn('LS',e2); }
  }
  // Sincroniza con la Google Sheet unos segundos despues del ultimo cambio, para
  // agrupar varias ediciones seguidas en una sola llamada al backend.
  if(BACKEND_ACTIVO){
    clearTimeout(_syncTimeout);
    _syncTimeout=setTimeout(()=>{ sincronizarLote(vehiculos); },1500);
  }
}
// Ojo: cargarLS ya no solo actualiza vehiculos existentes (por placa), tambien
// vuelve a agregar los que fueron creados por carga de archivo o por el modal
// "Agregar Vehiculo" y que no existen en data.js, para que no se pierdan al recargar.
function cargarLS(){
  try{
    const s=localStorage.getItem('sc_v3');if(!s)return;
    JSON.parse(s).forEach(m=>{
      let v=vehiculos.find(x=>x.placa===m.placa || (m.id!==undefined && x.id===m.id && !m.placa));
      if(v){ Object.assign(v,m); }
      else if(m.placa){ vehiculos.push({...plantillaVacia(),...m,id:nuevoId()}); }
    });
  }catch(e){console.warn(e);}
}

// ===== PLANTILLA / UTILIDADES DE VEHICULO =====
function plantillaVacia(){
  return {
    id:null, placa:'', numInterno:'', identificacion:'', nombre:'', empresa:'',
    soat:null, seguros:null, tarOperacion:null, tecnicomecanica:null, preventiva:null,
    renovSoat:null, fechaRenovSoat:null, comprobanteSoat:null,
    renovSeguros:null, fechaRenovSeguros:null, comprobanteSeguros:null,
    fechaPagoTO:null, comprobanteTO:null, fechaDocsCompletosTO:null, fechaRadicadoRUNT:null,
    renovTecno:null, fechaRenovTecno:null, comprobanteTecno:null,
    renovPrev:null, fechaRenovPrev:null, comprobantePrev:null,
    observacionTO:null
  };
}
function nuevoId(){
  return vehiculos.length ? Math.max(...vehiculos.map(v=>v.id||0))+1 : 0;
}

// ===== CARGA SEMANAL DE ARCHIVO DE VENCIMIENTOS (XLSX/CSV) =====
const CAMPOS_FECHA_VENC=['soat','seguros','tarOperacion','tecnicomecanica','preventiva'];

function normalizarTexto(s){
  return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
}

// Reconoce encabezados en español sin importar tildes/mayusculas ni orden de columnas.
// Ajustado al layout real de "Consolidado.xlsx" (Placa, No Interno, Nombre Propietario,
// Documento, Tar. Operacion #, Vence T. Operacion, No. SOAT, Entidad Soat, Fecha SOAT,
// Entidad Seguros, Fecha Seguros, Fecha TecMecanica, Fecha Preventiva, Empresa Convenio,
// Empresa, etc.) evitando confundir columnas de numero/entidad con las columnas de fecha.
function mapearColumna(header){
  const h=normalizarTexto(header);
  if(h.includes('estado')) return null; // Estado / Estado Vehiculo: se ignoran, se calculan solas
  if(h.includes('convenio')) return null; // Tipo Convenio / Empresa Convenio: no es la empresa del vehiculo
  if(h.includes('placa')) return 'placa';
  if(h.includes('interno')) return 'numInterno';
  if(h.includes('documento')||h.includes('identificacion')||h.includes('cedula')) return 'identificacion';
  if(h.includes('nombre')) return 'nombre';
  if(h==='empresa'||(h.includes('empresa'))) return 'empresa'; // ya se descarto "convenio" arriba
  // Columnas de fecha: exigen "fecha" o "vence" junto a la palabra clave, para no
  // confundirlas con "No. SOAT", "Entidad Soat", "Entidad Seguros", "Tar. Operacion #".
  const esFecha=h.includes('fecha')||h.includes('vence');
  if(h.includes('soat') && esFecha) return 'soat';
  if(h.includes('seguro') && esFecha) return 'seguros';
  if((h.includes('operacion')||h.includes('tarjeta')) && esFecha) return 'tarOperacion';
  if((h.includes('tecno')||h.includes('tecmec')||h.includes('mecanica')) && !h.includes('carroceria')) return 'tecnicomecanica';
  if(h.includes('preventiv')) return 'preventiva';
  return null;
}

// Convierte fechas de Excel (numero serial), objetos Date o texto dd/mm/aaaa a formato ISO (aaaa-mm-dd).
function excelFechaAISO(valor){
  if(valor===null||valor===undefined||valor==='') return null;
  if(valor instanceof Date && !isNaN(valor)){
    return `${valor.getFullYear()}-${String(valor.getMonth()+1).padStart(2,'0')}-${String(valor.getDate()).padStart(2,'0')}`;
  }
  if(typeof valor==='number'){
    if(window.XLSX && XLSX.SSF){
      const d=XLSX.SSF.parse_date_code(valor);
      if(d) return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
    }
    return null;
  }
  const s=String(valor).trim();
  let m=s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if(m){ let [,d,mo,y]=m; if(y.length===2) y='20'+y; return `${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`; }
  m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if(m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  return null;
}

function onArchivoVencimientosSeleccionado(e){
  const files=[...e.target.files];
  if(!files.length) return;
  // varios ParqueAutomotor (uno por empresa) y/o el CONSOLIDADO: se consolidan en parque.js
  if(typeof procesarArchivosVencimientos==='function') procesarArchivosVencimientos(files); else procesarArchivoVencimientos(files[0]);
  e.target.value=''; // permite volver a seleccionar el mismo archivo la proxima semana
}

// Sube el archivo semanal: actualiza SOLO lo que trae el archivo (por placa) y
// deja intactos comprobantes, fechas de renovacion y demas datos ya cargados.
// Si una placa del archivo no existe todavia en el sistema, se crea el registro.
function procesarArchivoVencimientos(file){
  const reader=new FileReader();
  reader.onload=async ev=>{
    try{
      const wb=XLSX.read(ev.target.result,{type:'array',cellDates:true});
      const hoja=wb.Sheets[wb.SheetNames[0]];
      const filas=XLSX.utils.sheet_to_json(hoja,{defval:''});
      if(!filas.length){ mostrarToast('El archivo no tiene filas con datos','error'); return; }

      const headers=Object.keys(filas[0]);
      const mapa={};
      headers.forEach(h=>{ const campo=mapearColumna(h); if(campo && !Object.values(mapa).includes(campo)) mapa[h]=campo; });
      if(!Object.values(mapa).includes('placa')){
        mostrarToast('No se encontro una columna "Placa" en el archivo. Revisa los encabezados.','error');
        return;
      }

      let actualizados=0,creados=0,ignorados=0;
      filas.forEach(fila=>{
        const datos={};
        headers.forEach(h=>{
          const campo=mapa[h]; if(!campo) return;
          let val=fila[h];
          if(CAMPOS_FECHA_VENC.includes(campo)) val=excelFechaAISO(val);
          else val=(val===null||val===undefined)?'':String(val).trim();
          datos[campo]=val;
        });
        if(!datos.placa){ ignorados++; return; }
        datos.placa=String(datos.placa).trim().toUpperCase();

        const existente=vehiculos.find(v=>v.placa===datos.placa);
        if(existente){
          CAMPOS_FECHA_VENC.forEach(c=>{ if(datos[c]!==undefined && datos[c]!==null && datos[c]!=='') existente[c]=datos[c]; });
          ['numInterno','identificacion','nombre','empresa'].forEach(c=>{ if(datos[c]) existente[c]=datos[c]; });
          actualizados++;
        }else{
          vehiculos.push({
            ...plantillaVacia(),
            id:nuevoId(),
            placa:datos.placa,
            numInterno:datos.numInterno||'',
            identificacion:datos.identificacion||'',
            nombre:datos.nombre||'',
            empresa:datos.empresa||'',
            soat:datos.soat||null,
            seguros:datos.seguros||null,
            tarOperacion:datos.tarOperacion||null,
            tecnicomecanica:datos.tecnicomecanica||null,
            preventiva:datos.preventiva||null
          });
          creados++;
        }
      });

      guardarLS();
      guardarUltimaActualizacion(file.name,actualizados+creados);
      cargarEmpresas();
      if(vistaActual==='dashboard') renderDashboard(); else renderTabla();
      mostrarToast(`Archivo cargado: ${actualizados} actualizados, ${creados} nuevos${ignorados?`, ${ignorados} filas ignoradas`:''}`,'success');

      // Al cargar el archivo semanal (y solo entonces) se sincronizan con el
      // calendario los vencimientos de T.O. del MES EN CURSO. No hay boton
      // aparte ni descarga de .ics: esto es lo unico que agenda en el calendario.
      if(BACKEND_ACTIVO){
        try{
          await llamarBackend({accion:'guardarLote',vehiculos});
          const r=await llamarBackend({accion:'sincronizarCalendarioMes'});
          mostrarToast(`Calendario del mes actualizado: ${r.creados} nuevo(s), ${r.actualizados} actualizado(s)`,'success');
        }catch(err){
          console.warn('No se pudo sincronizar el calendario del mes en curso',err);
          mostrarToast('El archivo se cargo bien, pero no se pudo actualizar el calendario (sin conexion con el backend)','error');
        }
      }
    }catch(err){
      console.error(err);
      mostrarToast('No se pudo leer el archivo. Verifica que sea un Excel o CSV valido.','error');
    }
  };
  reader.readAsArrayBuffer(file);
}

function guardarUltimaActualizacion(nombre,cantidad){
  try{ localStorage.setItem('sc_ultima_carga',JSON.stringify({nombre,cantidad,fecha:new Date().toISOString()})); }
  catch(e){ console.warn(e); }
  mostrarUltimaActualizacion();
}
function mostrarUltimaActualizacion(){
  const el=document.getElementById('ultima-carga-info');
  if(!el) return;
  try{
    const s=localStorage.getItem('sc_ultima_carga');
    if(!s){ el.textContent=''; return; }
    const info=JSON.parse(s), f=new Date(info.fecha);
    el.textContent=`Última carga: ${info.nombre} · ${f.toLocaleDateString('es-CO')} ${f.toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'})} · ${info.cantidad} filas`;
  }catch(e){}
}

// ===== TOAST =====
function mostrarToast(msg,tipo){
  const t=document.getElementById('toast');t.textContent=msg;t.className=`toast toast-${tipo||'info'}`;t.classList.remove('hidden');
  clearTimeout(t._t);t._t=setTimeout(()=>t.classList.add('hidden'),3500);
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded',()=>{
  cargarLS();cargarEmpresas();irAVista('dashboard');mostrarUltimaActualizacion();
  document.getElementById('modalDetalle').addEventListener('click',e=>{if(e.target===document.getElementById('modalDetalle'))cerrarModal();});
  const tots=vehiculos.reduce((a,v)=>{const es=[estadoDoc(v.soat,false),estadoDoc(v.seguros,false),estadoDoc(v.tarOperacion,true),estadoDoc(v.tecnicomecanica,false)];if(es.includes('vencido'))a.v++;else if(es.includes('alerta')||es.includes('alerta_to'))a.a++;return a;},{v:0,a:0});
  if(tots.v>0||tots.a>0)setTimeout(()=>mostrarToast(`${tots.v} vencidos y ${tots.a} en alerta`,tots.v>0?'error':'info'),800);
});
