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

// Varredura sob demanda. Nunca mistura arquivos de catálogo com arquivos avulsos.
export async function discoverUncatalogued(root, cataloguedPaths = []) {
  const known = new Set(cataloguedPaths);
  const discovered = await discoverCatalogs(root);
  if (discovered.warnings.length) {
    throw Error('Não foi possível conferir todas as pastas dos catálogos.');
  }

  // Inclui até os registros que a galeria não exibe por deduplicação.
  for (const catalog of discovered.catalogs) {
    let data;
    try {
      data = JSON.parse(await (await catalog.handle.getFile()).text());
    } catch {
      throw Error('Não foi possível ler o catálogo: ' + catalog.path);
    }
    if (!Array.isArray(data.recortes)) {
      throw Error('Catálogo sem recortes: ' + catalog.path);
    }
    for (const record of data.recortes) {
      known.add(catalog.prefix + pathParts(record.arquivo).join('/'));
    }
  }

  const found = [];
  const extensions = /\.(mp3|wav|ogg|m4a|flac)$/i;
  async function scan(dir, prefix = '', depth = 0) {
    if (depth > 16) throw Error('A estrutura das pastas é profunda demais para uma varredura segura.');
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === 'directory') {
        if (name.startsWith('.') || name === 'node_modules') continue;
        await scan(handle, prefix + name + '/', depth + 1);
        continue;
      }
      const path = prefix + name;
      if (handle.kind !== 'file' || !extensions.test(name) || known.has(path)) continue;
      const file = await handle.getFile();
      found.push({
        id: 'uncatalogued:' + path,
        catalogId: '',
        title: name,
        path,
        duration: null,
        text: '',
        kind: 'uncatalogued',
        language: 'unknown',
        author: 'Arquivo local',
        collection: prefix.split('/')[0] || 'Outros',
        category: prefix,
        status: 'Não catalogado · pode ser usado pelo bot',
        hash: null,
        updated: file.lastModified,
        size: file.size
      });
    }
  }
  await scan(root);
  return found;
}

async function digest(data){const bytes=typeof data==='string'?new TextEncoder().encode(data):await data.arrayBuffer();return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('')}
async function writeLocal(root,path,data){const parts=pathParts(path);let dir=root;for(const p of parts.slice(0,-1))dir=await dir.getDirectoryHandle(p,{create:true});const handle=await dir.getFileHandle(parts.at(-1),{create:true}),writer=await handle.createWritable();try{await writer.write(data);await writer.close()}catch(e){try{await writer.abort()}catch{}throw e}}
async function removeAudio(root,path){const parts=pathParts(path);if(!/\.(wav|ogg|mp3|m4a|flac)$/i.test(parts.at(-1)))throw Error('Exclusão limitada a arquivos de áudio.');const dir=await directory(root,parts.slice(0,-1));await dir.removeEntry(parts.at(-1))}
async function optionalFile(root,path){try{return await readLocalFile(root,path)}catch(e){if(e.name==='NotFoundError')return null;throw e}}
function updatedManifest(data,remaining){const next={...data,recortes:remaining};for(const key of ['total','total_recortes'])if(typeof next[key]==='number')next[key]=remaining.length;if(typeof next.duracao_total==='number')next.duracao_total=remaining.reduce((sum,i)=>sum+(Number(i.duracao)||0),0);return next}
export async function prepareDeletion(root,selected){
  if(!selected.length)throw Error('Marque pelo menos um áudio.');
  const selectedPaths=new Set(),selectedHashes=new Set(),files=new Map(),catalogs=[];
  async function addFile(path,expectedHash){
    path=pathParts(path).join('/');if(!/\.(wav|ogg|mp3|m4a|flac)$/i.test(path))throw Error('Seleção contém um arquivo que não é áudio.');
    if(files.has(path))return;const file=await optionalFile(root,path);if(!file)return;
    const hash=await digest(file);if(expectedHash&&hash!==expectedHash)throw Error('O áudio mudou desde a leitura: '+path+'. Atualize a página.');
    files.set(path,{path,hash,size:file.size});
  }
  for(const item of selected){selectedPaths.add(pathParts(item.path).join('/'));if(item.hash)selectedHashes.add(item.hash);const file=await readLocalFile(root,item.path);
    if((item.updated!=null&&file.lastModified!==item.updated)||(item.size!=null&&file.size!==item.size))throw Error('Um áudio selecionado foi alterado. Atualize a página.');
    await addFile(item.path,item.hash);
  }
  const discovered=await discoverCatalogs(root);if(discovered.warnings.length)throw Error('Não foi possível conferir todos os catálogos. Nenhum arquivo foi apagado.');
  for(const c of discovered.catalogs){
    const file=await c.handle.getFile(),before=await file.text();let data;try{data=JSON.parse(before)}catch{throw Error('Catálogo inválido: '+c.path+'. Nenhum arquivo foi apagado.')}
    if(!Array.isArray(data.recortes))throw Error('Catálogo sem lista de recortes: '+c.path);
    const remaining=[];let removed=0;
    for(const record of data.recortes){const path=c.prefix+pathParts(record.arquivo).join('/');if(selectedPaths.has(path)||(record.sha256&&selectedHashes.has(record.sha256))){removed++;await addFile(path,record.sha256)}else remaining.push(record)}
    if(removed){const after=JSON.stringify(updatedManifest(data,remaining),null,2)+'\n';catalogs.push({path:c.path,before,after,beforeHash:await digest(file),afterHash:await digest(after),removed})}
  }
  return {root,selected:selected.map(i=>({id:i.id,title:i.title,path:i.path})),files:[...files.values()],catalogs};
}
async function validatePlan(plan){
  for(const c of plan.catalogs)if(await digest(await readLocalFile(plan.root,c.path))!==c.beforeHash)throw Error('O catálogo mudou. Atualize e confirme novamente.');
  for(const f of plan.files)if(await digest(await readLocalFile(plan.root,f.path))!==f.hash)throw Error('Um áudio mudou. Atualize e confirme novamente.');
}
export async function applyDeletion(plan){
  if(await plan.root.queryPermission({mode:'readwrite'})!=='granted')throw Error('Permissão de escrita não concedida. Nenhum áudio foi apagado.');
  await validatePlan(plan);
  const batch='.lixeira_galeria/'+Date.now()+'-'+crypto.randomUUID(),journal={version:1,state:'preparing',created:new Date().toISOString(),selected:plan.selected,files:plan.files,catalogs:plan.catalogs.map(({path,beforeHash,afterHash})=>({path,beforeHash,afterHash}))};
  const save=()=>writeLocal(plan.root,batch+'/transaction.json',JSON.stringify(journal,null,2));
  await save();
  // Todas as cópias são gravadas e conferidas antes de alterar os originais.
  for(const f of plan.files){const data=await readLocalFile(plan.root,f.path);await writeLocal(plan.root,batch+'/files/'+f.path,data);if(await digest(await readLocalFile(plan.root,batch+'/files/'+f.path))!==f.hash)throw Error('Falha ao conferir a cópia de segurança. Exclusão não iniciada.')}
  for(const c of plan.catalogs){await writeLocal(plan.root,batch+'/catalogs/'+c.path,await readLocalFile(plan.root,c.path));if(await digest(await readLocalFile(plan.root,batch+'/catalogs/'+c.path))!==c.beforeHash)throw Error('Falha no backup do catálogo. Exclusão não iniciada.')}
  await validatePlan(plan);journal.state='backed_up';await save();
  const changed=[],removed=[];
  try{
    for(const c of plan.catalogs){if(await digest(await readLocalFile(plan.root,c.path))!==c.beforeHash)throw Error('Catálogo alterado durante a operação.');changed.push(c);await writeLocal(plan.root,c.path,c.after)}
    journal.state='catalogs_updated';await save();
    for(const f of plan.files){if(await digest(await readLocalFile(plan.root,f.path))!==f.hash)throw Error('Áudio alterado durante a operação.');await removeAudio(plan.root,f.path);removed.push(f)}
    journal.state='deleted';await save();return {batch,audios:plan.selected.length,files:removed.length,catalogs:changed.length};
  }catch(error){
    const failures=[];
    for(const f of removed){try{const current=await optionalFile(plan.root,f.path);if(current&&await digest(current)!==f.hash)throw Error('Novo arquivo ocupa o caminho');if(!current)await writeLocal(plan.root,f.path,await readLocalFile(plan.root,batch+'/files/'+f.path))}catch{failures.push(f.path)}}
    for(const c of changed.reverse()){try{const hash=await digest(await readLocalFile(plan.root,c.path));if(hash!==c.beforeHash&&hash!==c.afterHash)throw Error('Catálogo modificado externamente');if(hash!==c.beforeHash)await writeLocal(plan.root,c.path,await readLocalFile(plan.root,batch+'/catalogs/'+c.path))}catch{failures.push(c.path)}}
    journal.state=failures.length?'needs_recovery':'rolled_back';journal.recoveryFailures=failures;try{await save()}catch{}
    throw Error(failures.length?'Operação interrompida. Cópias preservadas em '+batch+'; recuperação pendente de '+failures.length+' arquivo(s).':'Operação cancelada e alterações revertidas. '+error.message);
  }
}
export async function undoDeletion(root,batch){
  if(!/^\.lixeira_galeria\/\d+-[a-f0-9-]+$/.test(batch))throw Error('Registro de recuperação inválido.');
  if(await root.queryPermission({mode:'readwrite'})!=='granted')throw Error('Permissão de escrita necessária para restaurar.');
  const journal=JSON.parse(await (await readLocalFile(root,batch+'/transaction.json')).text());if(journal.state!=='deleted')throw Error('Esta operação não está disponível para desfazer.');
  for(const f of journal.files){if(await optionalFile(root,f.path))throw Error('Existe um novo arquivo no caminho original. Nada foi sobrescrito.');if(await digest(await readLocalFile(root,batch+'/files/'+f.path))!==f.hash)throw Error('Cópia de segurança divergente.')}
  for(const c of journal.catalogs){if(await digest(await readLocalFile(root,c.path))!==c.afterHash)throw Error('O catálogo mudou após a exclusão. Restauração automática interrompida.');if(await digest(await readLocalFile(root,batch+'/catalogs/'+c.path))!==c.beforeHash)throw Error('Backup do catálogo divergente.')}
  // Restaura áudios antes dos catálogos: os registros só voltam quando todos
  // os arquivos necessários já existem. Falha parcial mantém o backup.
  try{
    for(const f of journal.files)await writeLocal(root,f.path,await readLocalFile(root,batch+'/files/'+f.path));
    for(const c of journal.catalogs)await writeLocal(root,c.path,await readLocalFile(root,batch+'/catalogs/'+c.path));
    journal.state='restored';await writeLocal(root,batch+'/transaction.json',JSON.stringify(journal,null,2));return journal.selected.length;
  }catch(e){throw Error('Restauração interrompida. As cópias continuam em '+batch+'. '+e.message)}
}

if(typeof document!=='undefined'){
const $=id=>document.getElementById(id),fmt=s=>Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0');
const norm=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
let root=null,items=[],uncataloguedItems=[],uncataloguedLoaded=false,uncataloguedLoading=false,kind='all',signature='',reading=false,restored=null,visible=60,currentUrl=null,catalogCache=new Map();
let favorites=new Set;try{favorites=new Set(JSON.parse(localStorage.getItem('ultron-local-favorites')||'[]'))}catch{}
let marked=new Set;try{marked=new Set(JSON.parse(localStorage.getItem('ultron-removal-selection')||'[]'))}catch{}
const languages={pt:'Português',en:'Inglês',es:'Espanhol',ja:'Japonês',none:'Sem fala',unknown:'Idioma não informado'};
function el(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n}
async function dbHandle(value){return new Promise((resolve,reject)=>{const req=indexedDB.open('ultron-local-folder',1);req.onupgradeneeded=()=>req.result.createObjectStore('settings');req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result,tx=db.transaction('settings',value===undefined?'readonly':'readwrite'),store=tx.objectStore('settings'),op=value===undefined?store.get('folder'):store.put(value,'folder');op.onsuccess=()=>resolve(op.result);op.onerror=()=>reject(op.error);tx.oncomplete=()=>db.close()}})}
async function play(item){try{if(!root)throw Error('Conecte a pasta da galeria primeiro.');const f=await readLocalFile(root,item.path);$('mainPlayer').pause();if(currentUrl)URL.revokeObjectURL(currentUrl);currentUrl=URL.createObjectURL(f);$('mainPlayer').src=currentUrl;$('playingTitle').textContent=item.title;$('playingMeta').textContent=item.author+' · '+(Number.isFinite(item.duration)?fmt(item.duration):'duração não cadastrada')+' · arquivo local';$('playerbar').hidden=false;await $('mainPlayer').play()}catch(e){$('syncText').textContent='Não foi possível abrir o áudio: '+e.message}}
function facets(){for(const [id,field,label] of [['author','author','Todos os personagens'],['collection','collection','Todas as coleções']]){
  const select=$(id),selected=select.value;select.replaceChildren(new Option(label,''));const counts=new Map();for(const i of (kind==='uncatalogued'?uncataloguedItems:items))counts.set(i[field],(counts.get(i[field])||0)+1);
  for(const [name,count] of [...counts].sort(([a],[b])=>a.localeCompare(b,'pt-BR')))select.add(new Option(name+' ('+count+')',name));if(counts.has(selected))select.value=selected;
}}
function selectedSource(){return kind==='uncatalogued'?uncataloguedItems:items}
function filtered(){
  const q=norm($('search').value),min=Number($('minDuration').value),language=$('language').value;
  return selectedSource().filter(i=>
    (kind==='uncatalogued'||kind==='all'||kind==='favorites'&&favorites.has(i.id)||kind===i.kind)&&
    (!$('author').value||i.author===$('author').value)&&
    (!$('collection').value||i.collection===$('collection').value)&&
    (!language||(i.language||'unknown')===language)&&
    (min===0||(Number.isFinite(i.duration)&&i.duration>=min))&&
    norm(i.title+' '+i.text+' '+i.author+' '+i.collection+' '+i.category).includes(q)
  );
}
function selectionStatus(){
  const count=selectedSource().filter(i=>marked.has(i.id)).length;
  $('selectionCount').textContent=count+' áudio'+(count===1?' marcado':'s marcados')+' para remover';
  $('exportSelection').disabled=!count;
  $('deleteSelected').disabled=!count||!root;
  $('clearSelection').disabled=!marked.size;
}
function saveMarks(){localStorage.setItem('ultron-removal-selection',JSON.stringify([...marked]));selectionStatus()}
function render(){
  const selected=filtered();
  selected.sort((a,b)=>$('sort').value==='long'?b.duration-a.duration:$('sort').value==='new'?b.updated-a.updated:a.title.localeCompare(b.title,'pt-BR'));
  $('count').textContent=selected.length+' áudios encontrados · exibindo '+Math.min(visible,selected.length);
  const frag=document.createDocumentFragment();for(const i of selected.slice(0,visible)){
    const c=el('article',undefined,'card'),m=el('div',undefined,'meta');m.append(el('span',({dialogo:'DIÁLOGO',revisao:'EM REVISÃO',recorte:'RECORTE',uncatalogued:'NÃO CATALOGADO'})[i.kind],'kind'),el('span',Number.isFinite(i.duration)?fmt(i.duration):'Duração desconhecida'));c.append(m,el('h3',i.title),el('p',i.author+' · '+i.collection,'meta'),el('p',(languages[i.language]||i.language||'Idioma não informado')+' · '+(i.catalogId||(i.kind==='uncatalogued'?'Sem manifesto':'Diálogo')),'meta'),el('p',i.text||'Arquivo de áudio da sua galeria.','transcript'));
    const b=el('button','Ouvir áudio local');b.className='listen';b.onclick=()=>play(i);c.append(b);
    const label=el('label',undefined,'mark-removal'),check=el('input');check.type='checkbox';check.checked=marked.has(i.id);check.setAttribute('aria-label','Marcar para remover: '+i.title);check.onchange=()=>{check.checked?marked.add(i.id):marked.delete(i.id);saveMarks();c.classList.toggle('marked',check.checked)};label.append(check,el('span','Marcar para remover'));c.append(label);c.classList.toggle('marked',marked.has(i.id));
    const foot=el('div',undefined,'card-foot'),fav=el('button',favorites.has(i.id)?'★ Favorito':'☆ Favoritar');fav.className='favorite';fav.setAttribute('aria-pressed',String(favorites.has(i.id)));fav.onclick=()=>{favorites.has(i.id)?favorites.delete(i.id):favorites.add(i.id);localStorage.setItem('ultron-local-favorites',JSON.stringify([...favorites]));render()};foot.append(fav,el('span','No seu computador'));c.append(foot,el('small',i.status,'meta'));frag.append(c);
  }
  if(!selected.length)frag.append(el('div',root?(kind==='uncatalogued'&&!uncataloguedLoaded?'Clique novamente em Não catalogados para iniciar a leitura, ou aguarde a varredura.':'Nenhum áudio corresponde a estes filtros.'):'Conecte a pasta output\\audio para carregar todas as coleções. Nenhum áudio será enviado à internet.','empty'));
  $('grid').replaceChildren(frag);$('loadMore').hidden=visible>=selected.length;selectionStatus();
}
async function loadUncatalogued(force=false){
  if(!root||uncataloguedLoading||uncataloguedLoaded&&!force)return;
  uncataloguedLoading=true;
  const target=root;
  $('syncText').textContent='Procurando arquivos não catalogados nas subpastas…';
  try{
    const next=await discoverUncatalogued(target,items.map(i=>i.path));
    if(root!==target)return;
    uncataloguedItems=next;
    uncataloguedLoaded=true;
    if(kind==='uncatalogued'){
      facets();
      render();
    }
    $('syncText').textContent='Não catalogados: '+next.length.toLocaleString('pt-BR')+' arquivos · leitura local concluída';
  }catch(e){
    $('syncText').textContent='Falha na leitura dos não catalogados: '+e.message;
  }finally{uncataloguedLoading=false}
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
    if(next!==signature){signature=next;if(kind!=='uncatalogued'){facets();render()}}
  }catch(e){$('sync').classList.remove('live');$('syncText').textContent=e.message}finally{reading=false}
}
async function connect(){try{
  if(!window.showDirectoryPicker)throw Error('Abra no Microsoft Edge ou Google Chrome para conectar a pasta local.');
  let picked=restored;if(picked&&await picked.requestPermission({mode:'read'})!=='granted')picked=null;if(!picked)picked=await window.showDirectoryPicker({id:'ultron-gallery',mode:'read'});
  const g=await findGallery(picked);root=g;restored=g;items=[];uncataloguedItems=[];uncataloguedLoaded=false;signature='';catalogCache=new Map();visible=60;$('mainPlayer').pause();$('playerbar').hidden=true;try{await dbHandle(g)}catch{}
  $('connect').textContent='Trocar pasta';$('connect').onclick=()=>{restored=null;connect()};await refresh();
}catch(e){if(e.name!=='AbortError')$('syncText').textContent=e.message}}
const reset=()=>{visible=60;render()};$('connect').onclick=connect;$('refresh').onclick=refresh;$('search').oninput=reset;for(const id of ['sort','author','collection','minDuration','language'])$(id).onchange=reset;
$('markFiltered').onclick=()=>{for(const i of filtered())marked.add(i.id);saveMarks();render()};
$('deleteSelected').onclick=async()=>{
  if(!root)return;
  const selected=selectedSource().filter(i=>marked.has(i.id));
  if(!selected.length)return;
  const button=$('deleteSelected');
  button.disabled=true;
  try{
    const permission=await root.requestPermission({mode:'readwrite'});
    if(permission!=='granted')throw Error('Permissão de escrita não autorizada.');
    const plan=await prepareDeletion(root,selected);
    if(!plan.files.length)throw Error('Nenhum arquivo disponível para excluir.');
    const warning=kind==='uncatalogued'?'\nATENÇÃO: arquivos sem manifesto podem ser usados pelo bot.\n':'';
    const confirmed=confirm(
      'CONFIRMAR EXCLUSÃO\n\n'+
      'Áudios marcados: '+selected.length+'\n'+
      'Arquivos físicos a remover: '+plan.files.length+'\n'+
      'Manifestos a atualizar: '+plan.catalogs.length+'\n'+warning+'\n'+
      'O backup será gravado e validado antes de apagar.\nContinuar?'
    );
    if(!confirmed)return;
    const result=await applyDeletion(plan);
    for(const item of selected)marked.delete(item.id);
    saveMarks();
    if(kind==='uncatalogued'){
      // Evita mostrar itens que já não existem, sem nova varredura pesada.
      const removed=new Set(plan.files.map(f=>f.path));
      uncataloguedItems=uncataloguedItems.filter(i=>!removed.has(i.path));
      facets();render();
    }
    signature='';
    await refresh();
    $('selectionMessage').textContent='Backup da última exclusão: '+result.batch;
    alert('Exclusão concluída!\n'+result.files+' arquivos removidos.\n'+result.catalogs+' manifestos atualizados.\nBackup: '+result.batch);
  }catch(error){
    alert('Exclusão não concluída:\n'+error.message);
  }finally{selectionStatus()}
};
$('clearSelection').onclick=()=>{marked.clear();saveMarks();render()};
$('exportSelection').onclick=()=>{const data=selectionDocument(selectedSource(),marked,root?.name||''),blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download='selecao-remover-galeria-'+Date.now()+'.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);$('selectionMessage').textContent='Seleção salva na pasta de downloads. Nenhum áudio foi apagado. Avise no chat que salvou; não precisa digitar os códigos.'};
const requestedLanguage=new URLSearchParams(location.search).get('idioma');if(requestedLanguage&&[...$('language').options].some(o=>o.value===requestedLanguage))$('language').value=requestedLanguage;
$('loadMore').onclick=()=>{visible+=60;render()};document.querySelectorAll('[data-kind]').forEach(b=>b.onclick=async()=>{kind=b.dataset.kind;document.querySelectorAll('[data-kind]').forEach(x=>x.classList.toggle('active',x===b));$('author').value='';$('collection').value='';facets();reset();if(kind==='uncatalogued')await loadUncatalogued()});$('closePlayer').onclick=()=>{$('mainPlayer').pause();$('playerbar').hidden=true};
async function restore(){try{restored=await dbHandle();if(restored&&await restored.queryPermission({mode:'read'})==='granted'){root=await findGallery(restored);$('connect').textContent='Trocar pasta';$('connect').onclick=()=>{restored=null;connect()};await refresh()}else if(restored)$('syncText').textContent='Pasta lembrada. Clique em Conectar pasta local para renovar a permissão.'}catch{}}
render();restore();setInterval(()=>{if(!document.hidden)refresh()},5000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});
}
