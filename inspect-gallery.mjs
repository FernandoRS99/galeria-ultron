// Exercita o mesmo leitor da página com um adaptador File System Access para
// arquivos locais. Não copia nem publica mídias ou metadados da biblioteca.
import {readdir,stat,readFile} from 'node:fs/promises';
import path from 'node:path';
import {loadGallery,findGallery} from './gallery.js';
const counts={metadata:0,text:0};
function fileHandle(full,name){return {kind:'file',name,async getFile(){counts.metadata++;const s=await stat(full);return {size:s.size,lastModified:s.mtimeMs,text:async()=>{counts.text++;return readFile(full,'utf8')}}}}}
function dirHandle(full){return {kind:'directory',name:path.basename(full),async getDirectoryHandle(name){const target=path.join(full,name);if(!(await stat(target)).isDirectory())throw Error('Não é pasta');return dirHandle(target)},async getFileHandle(name){const target=path.join(full,name);if(!(await stat(target)).isFile())throw Error('Não é arquivo');return fileHandle(target,name)},async *entries(){for(const item of await readdir(full,{withFileTypes:true})){if(item.isDirectory())yield [item.name,dirHandle(path.join(full,item.name))];else if(item.isFile())yield [item.name,fileHandle(path.join(full,item.name),item.name)]}}}}
if(!process.argv[2])throw Error('Informe somente a pasta local de áudios.');
const start=performance.now(),root=await findGallery(dirHandle(path.resolve(process.argv[2]))),cache=new Map();
const result=await loadGallery(root,cache);
const totals={};for(const i of result.items)totals[i.collection]=(totals[i.collection]||0)+1;
console.log(JSON.stringify({items:result.items.length,catalogs:result.catalogs,missing:result.missing,missingPaths:result.missingPaths,warnings:result.warnings,duplicates:result.duplicates,collections:totals,kinds:result.items.reduce((a,i)=>(a[i.kind]=(a[i.kind]||0)+1,a),{}),seconds:Math.round((performance.now()-start)/10)/100,metadataReads:counts.metadata,jsonReads:counts.text},null,2));
const parsed=counts.text,next=await loadGallery(root,cache);
if(next.items.length!==result.items.length||counts.text!==parsed)throw Error('Cache ou nova execução divergente.');
console.log('Nova execução e cache: OK; nenhum áudio lido como texto.');
