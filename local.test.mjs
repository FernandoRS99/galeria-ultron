import test from 'node:test';import assert from 'node:assert/strict';import {pathParts,readLocalFile,manifestItems,loadGallery,findGallery,deduplicate,itemLanguage,selectionDocument} from './gallery.js';import {readFileSync} from 'node:fs';
test('somente caminhos relativos seguros',()=>{for(const p of ['../senha.txt','C:/Windows/a','a/../b','/a','a//b'])assert.throws(()=>pathParts(p));assert.deepEqual(pathParts('amostras/01.wav'),['amostras','01.wav'])});
test('leitura local nunca pede criacao ou escrita',async()=>{const file={name:'01.wav'};const root={getDirectoryHandle:async(...args)=>{assert.deepEqual(args,['amostras']);return {getFileHandle:async(...args)=>{assert.deepEqual(args,['01.wav']);return {getFile:async()=>file}}}}};assert.equal(await readLocalFile(root,'amostras/01.wav'),file)});
test('manifesto conserva texto e rejeita arquivo externo',()=>{const item={id:'01',titulo:'Teste',arquivo:'amostras/01.wav',duracao:3,transcricao_automatica:'Fala original'};assert.equal(manifestItems({recortes:[item]})[0].text,'Fala original');assert.throws(()=>manifestItems({recortes:[{...item,arquivo:'../fora.wav'}]}))});
test('aplicacao sem envio de dados ou dependencias externas',()=>{const s=readFileSync('gallery.js','utf8');assert.doesNotMatch(s,/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|createWritable/);assert.match(s,/showDirectoryPicker/);assert.match(s,/mode:'read'/)});

function folder(name,children={}){return {kind:'directory',name,async getDirectoryHandle(n){if(children[n]?.kind!=='directory')throw Error('ausente');return children[n]},async getFileHandle(n){if(children[n]?.kind!=='file')throw Error('ausente');return children[n]},async *entries(){yield*Object.entries(children)}}}
const file=(name,text='audio')=>({name,kind:'file',getFile:async()=>({lastModified:1,size:text.length,text:async()=>text})});
const catalog=(items,extras={})=>file('manifesto.json',JSON.stringify({recortes:items,...extras}));
const clip=(id,extra={})=>({id,titulo:id,arquivo:id+'.ogg',duracao:4,...extra});
test('raiz do bot seleciona audio e preserva compatibilidade com pasta individual',async()=>{
  const ultron=folder('ultron',{'manifesto.json':catalog([])}),bordoes=folder('bordoes_ultron',{ultron}),audio=folder('audio',{bordoes_ultron:bordoes});
  assert.equal(await findGallery(folder('_bot',{output:folder('output',{audio})})),audio);assert.equal(await findGallery(audio),audio);assert.equal(await findGallery(ultron),ultron);
});
test('colecoes, expansao, revisao e falhas parciais nao interrompem a biblioteca',async()=>{
  const hash='a'.repeat(64),audio=folder('audio',{
    bordoes_ultron:folder('bordoes_ultron',{
      ultron:folder('ultron',{'manifesto.json':catalog([clip('um',{sha256:hash})]),'um.ogg':file('um.ogg')}),
      animes:folder('animes',{'manifesto.json':catalog([clip('copia',{sha256:hash}),clip('ausente')]),'copia.ogg':file('copia.ogg')}),
      ruim:folder('ruim',{'manifesto.json':file('manifesto.json','{quebrado')})}),
    expansao_500:folder('expansao_500',{'manifesto.json':catalog([clip('dois',{autor:'Goku',arquivo:'recortes\\dois.ogg'})]),recortes:folder('recortes',{'dois.ogg':file('dois.ogg')})}),
    catalogo_200:folder('catalogo_200',{'manifesto.json':catalog([clip('tres')],{ativo_no_bot:false}),'tres.ogg':file('tres.ogg')}),
    falas_privadas:folder('falas_privadas',{'manifesto.json':catalog([clip('segredo')]),'segredo.ogg':file('segredo.ogg')})});
  const result=await loadGallery(audio);assert.equal(result.items.length,3);assert.equal(result.duplicates,1);assert.equal(result.missing,1);assert.equal(result.warnings.length,1);
  assert.ok(result.items.some(i=>i.kind==='revisao'));assert.ok(result.items.some(i=>i.author==='Goku'));assert.ok(!result.items.some(i=>i.path.includes('falas_privadas')));
});
test('uma copia ausente nao oculta outra existente com mesmo hash',async()=>{
  const hash='b'.repeat(64),root=folder('ultron',{'manifesto.json':catalog([clip('ausente',{sha256:hash}),clip('existente',{sha256:hash})]),'existente.ogg':file('existente.ogg')});
  const result=await loadGallery(root);assert.equal(result.items.length,1);assert.equal(result.items[0].title,'existente');assert.equal(result.missing,0);assert.equal(result.duplicates,1);
});
test('deduplicacao conserva IDs iguais de personagens diferentes',()=>{
  assert.equal(deduplicate([{id:'01',path:'ultron/01.ogg'},{id:'01',path:'goku/01.ogg'}]).length,2);
});
test('cache de manifesto nao bloqueia nova execucao com arquivo adicionado',async()=>{
  const children={'manifesto.json':catalog([clip('novo')])},root=folder('ultron',children),cache=new Map();
  assert.equal((await loadGallery(root,cache)).items.length,0);children['novo.ogg']=file('novo.ogg');assert.equal((await loadGallery(root,cache)).items.length,1);
});
test('idioma preserva incerteza e corrige falso positivo Chaves reconferido',()=>{
  assert.equal(itemLanguage({idioma:'en'}),'en');assert.equal(itemLanguage({idioma:'pt-BR'}),'pt');
  assert.equal(itemLanguage({}, {idioma:'Fontes originais; falas pt-BR e risadas'}),'unknown');
  assert.equal(itemLanguage({id:'ultron_frases_v2_049',idioma:'en'}),'pt');
});
test('exportacao leva somente marcados e nao autoriza nem executa exclusao',()=>{
  const items=[{id:'a',catalogId:'v2_070',path:'catalogo/070.mp3',title:'Primeiro',hash:'a'.repeat(64)},
               {id:'b',path:'catalogo/071.mp3',title:'Segundo'}];
  const result=selectionDocument(items,new Set(['a']),'audio');assert.equal(result.deleted,false);
  assert.equal(result.operation,'revisar_remocao_galeria');assert.equal(result.items.length,1);
  assert.equal(result.items[0].id,'v2_070');assert.equal(result.items[0].path,'catalogo/070.mp3');
  assert.equal(result.items[0].sha256,'a'.repeat(64));assert.equal(items.length,2);
});
test('selecao salva inclui itens marcados alem dos primeiros sessenta',()=>{
  const items=Array.from({length:132},(_,n)=>({id:String(n),path:n+'.ogg',title:String(n)}));
  assert.equal(selectionDocument(items,new Set(items.map(i=>i.id)),'audio').items.length,132);
});
