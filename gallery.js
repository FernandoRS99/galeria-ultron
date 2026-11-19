export function pathParts(path){
  const parts=String(path).replaceAll('\\','/').split('/');
  if(!parts.length||parts.some(p=>!p||p==='.'||p==='..'||p.includes(':')))throw Error('Caminho inválido no catálogo.');
  return parts;
}
async function directory(root,parts){let dir=root;for(const part of parts)dir=await dir.getDirectoryHandle(part);return dir}
export async function readLocalFile(root,path){const parts=pathParts(path),dir=await directory(root,parts.slice(0,-1));return (await dir.getFileHandle(parts.at(-1))).getFile()}
const collectionFolder=name=>/^(bordoes_ultron|expansao_.+|catalogo_.+)$/.test(name);
export async function findGallery(root){
  for(const parts of [['output','audio'],['audio'],[]]){try{const candidate=await directory(root,parts);
    try{await candidate.getDirectoryHandle('bordoes_ultron');return candidate}catch{}
    try{await candidate.getFileHandle('manifesto.json');return candidate}catch{}
    for await(const [name,h] of candidate.entries())if(h.kind==='directory'&&collectionFolder(name))return candidate;
  }catch{}}
  throw Error('Selecione a pasta audio dentro de output, para carregar todas as coleções.');
}
const pretty=s=>s.replaceAll('_',' ').replace(/(^|\s)(\S)/gu,(_,space,c)=>space+c.toUpperCase());
export function itemLanguage(item,data={}){
  // Reconferência local Medium em 19/11/2026: "Nem doeu!". O ASR Small
  // havia marcado inglês com confiança 0,5234. Não altera o manifesto do bot.
  if(item.id==='ultron_frases_v2_049')return 'pt';
  const raw=String(item.idioma||item.idioma_detectado||item.asr_local?.idioma||data.idioma||'').toLowerCase();
  if(/^pt(?:[-_].*)?$/.test(raw))return 'pt';
  if(raw==='sem fala')return 'none';
  return /^[a-z]{2,3}(?:[-_][a-z]+)?$/.test(raw)?raw.split(/[-_]/)[0]:'unknown';
}
export function selectionDocument(items,marked,folder){
  return {version:1,operation:'revisar_remocao_galeria',deleted:false,folder,
    created:new Date().toISOString(),items:items.filter(i=>marked.has(i.id)).map(i=>({
      id:i.catalogId||i.id,title:i.title,path:pathParts(i.path).join('/'),sha256:i.hash||null,
      author:i.author,collection:i.collection,language:i.language||'unknown'}))};
}
function collectionName(prefix,data){const parts=prefix.split('/').filter(Boolean);
  if(parts[0]==='bordoes_ultron')return pretty(parts[1]||'Bordões gerais');
  if(parts[0]?.startsWith('expansao_'))return 'Expansão PT-BR';
  if(parts[0]?.startsWith('catalogo_'))return 'Catálogos de revisão';
  return String(data.personagem||pretty(parts[0]||'Galeria selecionada'));
}
export function manifestItems(data,prefix=''){
  if(!Array.isArray(data.recortes))throw Error('Manifesto sem lista de recortes.');
  const collection=collectionName(prefix,data),result=[];
  for(const i of data.recortes){
    const relative=pathParts(i.arquivo).join('/');if(!/\.(wav|ogg|mp3|m4a|flac)$/i.test(relative))continue;
    if(!Number.isFinite(i.duracao)||i.duracao<=0)throw Error('Duração inválida no catálogo.');
    const path=prefix+relative,approval=String(i.aprovacao_final||i.aprovacao_proprietario||data.aprovacao_final||'');
    const review=i.ativo_no_bot===false||data.ativo_no_bot===false||/pendente|aguardando.revisao|candidat/i.test(String(i.estado||'')+' '+approval);
    const approved=!review&&/aprovado/i.test(String(i.estado||'')+' '+approval);
    result.push({id:path,catalogId:i.id||relative,language:itemLanguage(i,data),title:String(i.titulo||i.texto||i.id||relative),path,duration:i.duracao,
      text:String(i.texto||i.transcricao_automatica||i.asr_local?.texto||''),kind:review?'revisao':'recorte',
      status:review?'Em revisão · não significa ativo no bot':approved?'Aprovado na galeria':'Cadastro local · confira o conteúdo',
      author:String(i.autor||data.personagem||collection),collection,category:String(i.categoria||i.grupo||''),
      hash:/^[a-f0-9]{64}$/i.test(i.sha256||'')?i.sha256.toLowerCase():null});
  }return result;
}
const identity=i=>i.hash?'sha:'+i.hash:'path:'+i.path.toLowerCase();
export function deduplicate(items){const seen=new Set(),unique=[];for(const i of items){const key=identity(i);if(!seen.has(key)){seen.add(key);unique.push(i)}}return unique}
async function parallel(items,limit,fn){let index=0;await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(index<items.length){const i=index++;await fn(items[i],i)}}))}
export async function discoverCatalogs(root){
  const catalogs=[],warnings=[],entries=[];for await(const entry of root.entries())entries.push(entry);
  const broad=entries.some(([n,h])=>h.kind==='directory'&&collectionFolder(n));
  async function walk(dir,prefix='',depth=0){
    if(depth>8)return;let children;try{children=[];for await(const e of dir.entries())children.push(e)}catch{warnings.push('Pasta indisponível: '+(prefix||root.name));return}
    for(const [name,h] of children.sort(([a],[b])=>a.localeCompare(b))){
      if(h.kind==='file'&&name==='manifesto.json')catalogs.push({handle:h,prefix,path:prefix+name});
      if(h.kind==='directory'&&!name.startsWith('.')&&!['fontes','converted','node_modules'].includes(name))await walk(h,prefix+name+'/',depth+1);
    }
  }
  if(broad){for(const [n,h] of entries.filter(([n,h])=>h.kind==='directory'&&collectionFolder(n)).sort(([a],[b])=>a.localeCompare(b)))await walk(h,n+'/')}
  else await walk(root);
  return {catalogs,warnings,broad};
}
export async function loadGallery(root,cache=new Map()){
  const discovered=await discoverCatalogs(root),warnings=[...discovered.warnings],catalogItems=[];
  for(const c of discovered.catalogs){try{const file=await c.handle.getFile(),version=file.lastModified+':'+file.size;let entry=cache.get(c.path);
    if(!entry||entry.version!==version){entry={version,items:manifestItems(JSON.parse(await file.text()),c.prefix)};cache.set(c.path,entry)}catalogItems.push(...entry.items);
  }catch{warnings.push('Catálogo não carregado: '+c.path)}}
  if(!discovered.catalogs.length)throw Error('Nenhum manifesto encontrado. Selecione a pasta output\\audio.');
  // Valida as cópias antes de deduplicar, para um caminho ausente não ocultar
  // outra cópia existente. Limita a leitura de metadados a 12 operações.
  const resolved=Array(catalogItems.length);
  await parallel(catalogItems,12,async(item,index)=>{try{const f=await readLocalFile(root,item.path);resolved[index]={...item,updated:f.lastModified,size:f.size}}catch{}});
  const items=deduplicate(resolved.filter(Boolean)),available=new Set(items.map(identity));
  // Manifestos secundários podem apontar uma cópia antiga inexistente. Se
  // outra cópia do mesmo hash está acessível, o áudio não está ausente.
  const missingPaths=deduplicate(catalogItems.filter((_,i)=>!resolved[i])).filter(i=>!available.has(identity(i))).map(i=>i.path);
  const missing=missingPaths.length,duplicates=catalogItems.length-items.length-missing;
  for(const path of ['bordoes_ultron/ultron/fontes/oLfM--gAdnc.ogg','ultron/fontes/oLfM--gAdnc.ogg','fontes/oLfM--gAdnc.ogg']){
    try{const f=await readLocalFile(root,path);items.push({id:'dialogo-ultron-visao-completo',title:'Ultron e Visão · diálogo completo',path,duration:89.61,kind:'dialogo',collection:'Ultron',author:'Ultron e Visão',text:'Cena completa preservada na galeria original.',category:'Diálogos',status:'Fonte original local',updated:f.lastModified,size:f.size});break}catch{}
  }
  return {items,missing,missingPaths,warnings,catalogs:discovered.catalogs.length,duplicates,broad:discovered.broad};
}

if(typeof document!=='undefined'){
const $=id=>document.getElementById(id),fmt=s=>Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0');
const norm=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
let root=null,items=[],kind='all',signature='',reading=false,restored=null,visible=60,currentUrl=null,catalogCache=new Map();
let favorites=new Set;try{favorites=new Set(JSON.parse(localStorage.getItem('ultron-local-favorites')||'[]'))}catch{}
let marked=new Set;try{marked=new Set(JSON.parse(localStorage.getItem('ultron-removal-selection')||'[]'))}catch{}
const languages={pt:'Português',en:'Inglês',es:'Espanhol',ja:'Japonês',none:'Sem fala',unknown:'Idioma não informado'};
function el(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n}
async function dbHandle(value){return new Promise((resolve,reject)=>{const req=indexedDB.open('ultron-local-folder',1);req.onupgradeneeded=()=>req.result.createObjectStore('settings');req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result,tx=db.transaction('settings',value===undefined?'readonly':'readwrite'),store=tx.objectStore('settings'),op=value===undefined?store.get('folder'):store.put(value,'folder');op.onsuccess=()=>resolve(op.result);op.onerror=()=>reject(op.error);tx.oncomplete=()=>db.close()}})}
async function play(item){try{if(!root)throw Error('Conecte a pasta da galeria primeiro.');const f=await readLocalFile(root,item.path);$('mainPlayer').pause();if(currentUrl)URL.revokeObjectURL(currentUrl);currentUrl=URL.createObjectURL(f);$('mainPlayer').src=currentUrl;$('playingTitle').textContent=item.title;$('playingMeta').textContent=item.author+' · '+fmt(item.duration)+' · arquivo local';$('playerbar').hidden=false;await $('mainPlayer').play()}catch(e){$('syncText').textContent='Não foi possível abrir o áudio: '+e.message}}
function facets(){for(const [id,field,label] of [['author','author','Todos os personagens'],['collection','collection','Todas as coleções']]){
  const select=$(id),selected=select.value;select.replaceChildren(new Option(label,''));const counts=new Map();for(const i of items)counts.set(i[field],(counts.get(i[field])||0)+1);
  for(const [name,count] of [...counts].sort(([a],[b])=>a.localeCompare(b,'pt-BR')))select.add(new Option(name+' ('+count+')',name));if(counts.has(selected))select.value=selected;
}}
function filtered(){
  const q=norm($('search').value),min=Number($('minDuration').value),language=$('language').value;
  return items.filter(i=>(kind==='all'||kind==='favorites'&&favorites.has(i.id)||kind===i.kind)&&(!$('author').value||i.author===$('author').value)&&(!$('collection').value||i.collection===$('collection').value)&&(!language||(i.language||'unknown')===language)&&i.duration>=min&&norm(i.title+' '+i.text+' '+i.author+' '+i.collection+' '+i.category).includes(q));
}
function selectionStatus(){const count=items.filter(i=>marked.has(i.id)).length;$('selectionCount').textContent=count+' áudio'+(count===1?' marcado':'s marcados')+' para remover';$('exportSelection').disabled=!count;$('clearSelection').disabled=!marked.size}
function saveMarks(){localStorage.setItem('ultron-removal-selection',JSON.stringify([...marked]));selectionStatus()}
function render(){
  const selected=filtered();
  selected.sort((a,b)=>$('sort').value==='long'?b.duration-a.duration:$('sort').value==='new'?b.updated-a.updated:a.title.localeCompare(b.title,'pt-BR'));
  $('count').textContent=selected.length+' áudios encontrados · exibindo '+Math.min(visible,selected.length);
  const frag=document.createDocumentFragment();for(const i of selected.slice(0,visible)){
    const c=el('article',undefined,'card'),m=el('div',undefined,'meta');m.append(el('span',({dialogo:'DIÁLOGO',revisao:'EM REVISÃO',recorte:'RECORTE'})[i.kind],'kind'),el('span',fmt(i.duration)));c.append(m,el('h3',i.title),el('p',i.author+' · '+i.collection,'meta'),el('p',(languages[i.language]||i.language||'Idioma não informado')+' · '+(i.catalogId||'Diálogo'),'meta'),el('p',i.text||'Arquivo de áudio da sua galeria.','transcript'));
    const b=el('button','Ouvir áudio local');b.className='listen';b.onclick=()=>play(i);c.append(b);
    const label=el('label',undefined,'mark-removal'),check=el('input');check.type='checkbox';check.checked=marked.has(i.id);check.setAttribute('aria-label','Marcar para remover: '+i.title);check.onchange=()=>{check.checked?marked.add(i.id):marked.delete(i.id);saveMarks();c.classList.toggle('marked',check.checked)};label.append(check,el('span','Marcar para remover'));c.append(label);c.classList.toggle('marked',marked.has(i.id));
    const foot=el('div',undefined,'card-foot'),fav=el('button',favorites.has(i.id)?'★ Favorito':'☆ Favoritar');fav.className='favorite';fav.setAttribute('aria-pressed',String(favorites.has(i.id)));fav.onclick=()=>{favorites.has(i.id)?favorites.delete(i.id):favorites.add(i.id);localStorage.setItem('ultron-local-favorites',JSON.stringify([...favorites]));render()};foot.append(fav,el('span','No seu computador'));c.append(foot,el('small',i.status,'meta'));frag.append(c);
  }
  if(!selected.length)frag.append(el('div',root?'Nenhum áudio corresponde a estes filtros.':'Conecte a pasta output\\audio para carregar todas as coleções. Nenhum áudio será enviado à internet.','empty'));
  $('grid').replaceChildren(frag);$('loadMore').hidden=visible>=selected.length;selectionStatus();
}
async function refresh(){
  if(!root||reading)return;reading=true;if(!items.length)$('syncText').textContent='Lendo os catálogos e conferindo os arquivos locais…';
  try{if(await root.queryPermission({mode:'read'})!=='granted')throw Error('Renove a permissão clicando em Conectar pasta local.');
    const selectedRoot=root,r=await loadGallery(selectedRoot,catalogCache);if(root!==selectedRoot)return;
    const next=JSON.stringify(r.items);items=r.items;
    $('total').textContent=items.length.toLocaleString('pt-BR');$('minutes').textContent=Math.round(items.reduce((s,i)=>s+i.duration,0)/60)+' minutos · '+new Set(items.map(i=>i.collection)).size+' coleções';
    $('sync').classList.add('live');$('syncText').textContent='Leitura local ativa · '+r.catalogs+' catálogos · atualizada às '+new Date().toLocaleTimeString('pt-BR')+(r.missing?' · '+r.missing+' arquivos ausentes':'')+(r.warnings.length?' · '+r.warnings.length+' catálogos/pastas indisponíveis':'');
    $('folderName').textContent='Pasta conectada: '+root.name+(r.broad?' · biblioteca completa':' · somente esta pasta; selecione output\\audio para todas as coleções');
    const scene=items.find(i=>i.id==='dialogo-ultron-visao-completo');$('featured').hidden=!scene;if(scene){$('featuredTime').textContent='CENA ORIGINAL · '+fmt(scene.duration);$('featuredPlay').onclick=()=>play(scene)}
    if(next!==signature){signature=next;facets();render()}
  }catch(e){$('sync').classList.remove('live');$('syncText').textContent=e.message}finally{reading=false}
}
async function connect(){try{
  if(!window.showDirectoryPicker)throw Error('Abra no Microsoft Edge ou Google Chrome para conectar a pasta local.');
  let picked=restored;if(picked&&await picked.requestPermission({mode:'read'})!=='granted')picked=null;if(!picked)picked=await window.showDirectoryPicker({id:'ultron-gallery',mode:'read'});
  const g=await findGallery(picked);root=g;restored=g;items=[];signature='';catalogCache=new Map();visible=60;$('mainPlayer').pause();$('playerbar').hidden=true;try{await dbHandle(g)}catch{}
  $('connect').textContent='Trocar pasta';$('connect').onclick=()=>{restored=null;connect()};await refresh();
}catch(e){if(e.name!=='AbortError')$('syncText').textContent=e.message}}
const reset=()=>{visible=60;render()};$('connect').onclick=connect;$('refresh').onclick=refresh;$('search').oninput=reset;for(const id of ['sort','author','collection','minDuration','language'])$(id).onchange=reset;
$('markFiltered').onclick=()=>{for(const i of filtered())marked.add(i.id);saveMarks();render()};
$('clearSelection').onclick=()=>{marked.clear();saveMarks();render()};
$('exportSelection').onclick=()=>{const data=selectionDocument(items,marked,root?.name||''),blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download='selecao-remover-galeria-'+Date.now()+'.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);$('selectionMessage').textContent='Seleção salva na pasta de downloads. Nenhum áudio foi apagado. Avise no chat que salvou; não precisa digitar os códigos.'};
const requestedLanguage=new URLSearchParams(location.search).get('idioma');if(requestedLanguage&&[...$('language').options].some(o=>o.value===requestedLanguage))$('language').value=requestedLanguage;
$('loadMore').onclick=()=>{visible+=60;render()};document.querySelectorAll('[data-kind]').forEach(b=>b.onclick=()=>{kind=b.dataset.kind;document.querySelectorAll('[data-kind]').forEach(x=>x.classList.toggle('active',x===b));reset()});$('closePlayer').onclick=()=>{$('mainPlayer').pause();$('playerbar').hidden=true};
async function restore(){try{restored=await dbHandle();if(restored&&await restored.queryPermission({mode:'read'})==='granted'){root=await findGallery(restored);$('connect').textContent='Trocar pasta';$('connect').onclick=()=>{restored=null;connect()};await refresh()}else if(restored)$('syncText').textContent='Pasta lembrada. Clique em Conectar pasta local para renovar a permissão.'}catch{}}
render();restore();setInterval(()=>{if(!document.hidden)refresh()},5000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});
}
