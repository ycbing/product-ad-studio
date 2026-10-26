import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {validate} from './validate.mjs';
const source=path.resolve(import.meta.dirname,'..');
async function fixture(fn){const root=await mkdtemp(path.join(tmpdir(),'ad-test-'));try{for(const n of ['inputs.json','catalog','public'])await cp(path.join(source,n),path.join(root,n),{recursive:true});const input=JSON.parse(await readFile(path.join(root,'inputs.json'),'utf8'));await fn(root,input);}finally{await rm(root,{recursive:true,force:true});}}
test('demo timeline is a fifteen-second five-shot ad',async()=>assert.equal((await validate(source)).seconds,15));
test('rejects path traversal outside public',()=>fixture(async(root,input)=>{input.props.shots[0].source='../package.json';await writeFile(path.join(root,'inputs.json'),JSON.stringify(input));await assert.rejects(validate(root),/local public path/);}));
test('rejects duplicated shot IDs',()=>fixture(async(root,input)=>{input.props.shots[1].id=input.props.shots[0].id;await writeFile(path.join(root,'inputs.json'),JSON.stringify(input));await assert.rejects(validate(root),/Unique/);}));
test('rejects preview beyond edited timeline',()=>fixture(async(root,input)=>{const file=path.join(root,'catalog',`${input.template}.json`);const catalog=JSON.parse(await readFile(file,'utf8'));catalog.sample.to=20;await writeFile(file,JSON.stringify(catalog));await assert.rejects(validate(root),/Sample range/);}));
test('rejects footage range beyond source duration',()=>fixture(async(root,input)=>{input.props.shots[0].trimBefore=100;await writeFile(path.join(root,'inputs.json'),JSON.stringify(input));await assert.rejects(validate(root),/Source range/);}));
test('rejects subtitles extending beyond a shot',()=>fixture(async(root,input)=>{input.props.shots[1].captionFrom=0.2;input.props.shots[1].captionTo=20;await writeFile(path.join(root,'inputs.json'),JSON.stringify(input));await assert.rejects(validate(root),/Caption range/);}));
