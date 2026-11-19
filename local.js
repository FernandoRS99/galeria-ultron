export function pathParts(path){
  const parts=String(path).replaceAll('\\','/').split('/');
  if(!parts.length||parts.some(p=>!p||p==='.'||p==='..'||p.includes(':')))throw Error('Caminho inválido no catálogo.');
  return parts;
}
export async function readLocalFile(root,path){
  const parts=pathParts(path);let dir=root;
  for(const part of parts.slice(0,-1))dir=await dir.getDirectoryHandle(part);
  return (await dir.getFileHandle(parts.at(-1))).getFile();
}
export async function findGallery(root){
  try{await root.getFileHandle('manifesto.json');return root}catch{}
  let dir=root;for(const part of ['output','audio','bordoes_ultron','ultron'])dir=await dir.getDirectoryHandle(part);
  await dir.getFileHandle('manifesto.json');return dir;
}
export function manifestItems(data){
  if(!Array.isArray(data.recortes))throw Error('O manifesto da galeria não foi encontrado.');
  return data.recortes.map(i=>{
    pathParts(i.arquivo);
    if(!Number.isFinite(i.duracao)||i.duracao<=0)throw Error('Duração inválida no catálogo.');
    return {id:String(i.id),title:String(i.titulo),path:i.arquivo,duration:i.duracao,
      text:String(i.texto||i.transcricao_automatica||''),kind:'recorte',status:i.estado==='aprovado'?'Galeria aprovada':'Validado localmente · confira a prévia',author:'Ultron'};
  });
}

if(typeof document!=='undefined'){
const $=id=>document.getElementById(id),fmt=s=>Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0');
const norm=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
let root=null,items=[],kind='all',signature='',lastRead=0,reading=false,restored=null;
let favorites=new Set;try{favorites=new Set(JSON.parse(localStorage.getItem('ultron-local-favorites')||'[]'))}catch{}
let currentUrl=null;
function el(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n}
async function dbHandle(value){
  return new Promise((resolve,reject)=>{const req=indexedDB.open('ultron-local-folder',1);req.onupgradeneeded=()=>req.result.createObjectStore('settings');req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result;const tx=db.transaction('settings',value===undefined?'readonly':'readwrite');const store=tx.objectStore('settings');const op=value===undefined?store.get('folder'):store.put(value,'folder');op.onsuccess=()=>resolve(op.result);op.onerror=()=>reject(op.error);tx.oncomplete=()=>db.close()}});
}
async function play(item){
  try{
    if(!root)throw Error('Conecte a pasta da galeria primeiro.');
    const file=await readLocalFile(root,item.path);
    $('mainPlayer').pause();if(currentUrl)URL.revokeObjectURL(currentUrl);
    currentUrl=URL.createObjectURL(file);$('mainPlayer').src=currentUrl;
    $('playingTitle').textContent=item.title;$('playingMeta').textContent=fmt(item.duration)+' · arquivo local';
    $('playerbar').hidden=false;await $('mainPlayer').play();
  }catch(e){$('syncText').textContent='Não foi possível abrir o áudio: '+e.message;}
}
function render(){
  const q=norm($('search').value);let selected=items.filter(i=>(kind==='all'||kind==='favorites'&&favorites.has(i.id)||kind===i.kind)&&norm(i.title+' '+i.text).includes(q));
  selected.sort((a,b)=>$('sort').value==='long'?b.duration-a.duration:$('sort').value==='new'?b.updated-a.updated:a.title.localeCompare(b.title,'pt-BR'));
  $('count').textContent=selected.length+' áudios encontrados';const frag=document.createDocumentFragment();
  for(const item of selected){const c=el('article',undefined,'card'),m=el('div',undefined,'meta');m.append(el('span',item.kind==='dialogo'?'DIÁLOGO':'RECORTE','kind'),el('span',fmt(item.duration)));c.append(m,el('h3',item.title),el('p',item.text||'Arquivo de áudio da sua galeria.','transcript'));
    const button=el('button','Ouvir áudio local');button.className='listen';button.onclick=()=>play(item);c.append(button);
    const foot=el('div',undefined,'card-foot'),fav=el('button',favorites.has(item.id)?'★ Favorito':'☆ Favoritar');fav.className='favorite';fav.setAttribute('aria-pressed',String(favorites.has(item.id)));fav.onclick=()=>{favorites.has(item.id)?favorites.delete(item.id):favorites.add(item.id);localStorage.setItem('ultron-local-favorites',JSON.stringify([...favorites]));render()};foot.append(fav,el('span','No seu computador'));c.append(foot,el('small',item.status,'meta'));frag.append(c)}
  if(!selected.length)frag.append(el('div',root?'Nenhum áudio corresponde a este filtro.':'Conecte a pasta local para carregar sua galeria. Nenhum áudio será enviado à internet.','empty'));
  $('grid').replaceChildren(frag);
}
function duration(file){return new Promise(resolve=>{const a=new Audio,url=URL.createObjectURL(file);let done=false;const finish=d=>{if(done)return;done=true;clearTimeout(timer);a.removeAttribute('src');URL.revokeObjectURL(url);resolve(Number.isFinite(d)?d:0)};const timer=setTimeout(()=>finish(0),3000);a.preload='metadata';a.onloadedmetadata=()=>finish(a.duration);a.onerror=()=>finish(0);a.src=url})}
async function refresh(){
  if(!root||reading)return;reading=true;
  try{
    const permission=await root.queryPermission({mode:'read'});if(permission!=='granted')throw Error('A permissão da pasta precisa ser renovada. Clique em Conectar pasta local.');
    const manifestFile=await readLocalFile(root,'manifesto.json'),data=JSON.parse(await manifestFile.text());
    const next=manifestItems(data);const missing=[];
    for(const item of next){try{const f=await readLocalFile(root,item.path);item.updated=f.lastModified;item.size=f.size}catch{missing.push(item.id)}}
    let loaded=next.filter(i=>!missing.includes(i.id));
    const scenePath='fontes/oLfM--gAdnc.ogg';try{const f=await readLocalFile(root,scenePath);loaded.push({id:'dialogo-ultron-visao-completo',title:'Ultron e Visão · diálogo completo',path:scenePath,duration:89.61,kind:'dialogo',text:'Cena completa da galeria original, com as falas dos dois personagens.',status:'Fonte original local',updated:f.lastModified,size:f.size})}catch{}
    // Descobre novos áudios sem enviar bytes ou nomes para nenhum servidor.
    // As fontes brutas e cópias MP3 dos recortes catalogados ficam de fora.
    const known=new Set(loaded.map(i=>i.path.replace(/\.[^.]+$/,'')));
    async function scan(dir,prefix='',depth=0){if(depth>3)return;for await(const [name,handle] of dir.entries()){
      if(handle.kind==='directory'){if(name!=='fontes'&&!name.startsWith('.'))await scan(handle,prefix+name+'/',depth+1);continue}
      const path=prefix+name;if(!/\.(ogg|wav|mp3)$/i.test(name)||known.has(path.replace(/\.[^.]+$/,''))||/previa-repertorio/i.test(name))continue;
      const f=await handle.getFile();const old=items.find(i=>i.path===path&&i.updated===f.lastModified&&i.size===f.size);const d=old?.duration||await duration(f);if(d>0)loaded.push({id:path,title:name.replace(/\.[^.]+$/,'').replaceAll('_',' '),path,duration:d,kind:'recorte',text:'Áudio adicional encontrado na pasta local.',status:'Arquivo adicional · confira o conteúdo',updated:f.lastModified,size:f.size});
    }}
    await scan(root);
    const nextSignature=JSON.stringify(loaded);items=loaded;lastRead=Date.now();
    $('total').textContent=items.length;$('minutes').textContent=Math.round(items.reduce((s,i)=>s+i.duration,0)/60)+' minutos no computador';
    $('sync').classList.add('live');$('syncText').textContent='Leitura local ativa · atualizada às '+new Date(lastRead).toLocaleTimeString('pt-BR')+(missing.length?' · '+missing.length+' arquivos ausentes':'');
    const scene=items.find(i=>i.id==='dialogo-ultron-visao-completo');if(scene){$('featured').hidden=false;$('featuredTime').textContent='CENA ORIGINAL · '+fmt(scene.duration);$('featuredPlay').onclick=()=>play(scene)}
    if(nextSignature!==signature){signature=nextSignature;render()}
  }catch(e){$('sync').classList.remove('live');$('syncText').textContent=e.message}finally{reading=false}
}
async function connect(){
  try{
    if(!window.showDirectoryPicker)throw Error('Abra esta página no Microsoft Edge ou Google Chrome para conectar a pasta local.');
    let picked=restored;
    if(picked){const permission=await picked.requestPermission({mode:'read'});if(permission!=='granted')picked=null}
    if(!picked)picked=await window.showDirectoryPicker({id:'ultron-gallery',mode:'read'});
    const gallery=await findGallery(picked);root=gallery;restored=gallery;
    try{await dbHandle(gallery)}catch{}
    $('folderName').textContent='Pasta conectada: '+gallery.name;$('connect').textContent='Trocar pasta';$('connect').onclick=()=>{restored=null;connect()};await refresh();
  }catch(e){if(e.name!=='AbortError')$('syncText').textContent=e.message;}
}
$('connect').onclick=connect;$('refresh').onclick=refresh;$('search').oninput=render;$('sort').onchange=render;
document.querySelectorAll('[data-kind]').forEach(b=>b.onclick=()=>{kind=b.dataset.kind;document.querySelectorAll('[data-kind]').forEach(x=>x.classList.toggle('active',x===b));render()});
$('closePlayer').onclick=()=>{$('mainPlayer').pause();$('playerbar').hidden=true};
async function restore(){try{restored=await dbHandle();if(restored&&await restored.queryPermission({mode:'read'})==='granted'){root=await findGallery(restored);$('folderName').textContent='Pasta conectada: '+root.name;await refresh()}else if(restored)$('syncText').textContent='Pasta lembrada. Clique em Conectar pasta local para renovar a permissão.'}catch{}}
render();restore();setInterval(()=>{if(!document.hidden)refresh()},5000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});
}
