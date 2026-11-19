import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
mkdirSync('dist',{recursive:true});
const html=readFileSync('index.html','utf8').replace('/*LOCAL_APPLICATION*/',readFileSync('gallery.js','utf8'));
writeFileSync('dist/index.html',html);console.log('Página autônoma pronta: dist/index.html');
