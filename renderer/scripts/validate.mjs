import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export async function validate(root) {
 const input=JSON.parse(await readFile(path.join(root,'inputs.json'),'utf8'));
 const p=input.props;
 if(!['product-story','real-product','real-refined'].includes(input.template)||p?.format!=='9:16') throw Error('Unsupported template or format');
 if(!Array.isArray(p.shots)||p.shots.length!==5) throw Error('Exactly five shots required');
 const ids=new Set();let seconds=0;
 for(const s of p.shots){if(ids.has(s.id)||typeof s.id!=='string'||!s.id)throw Error('Unique shot IDs required');ids.add(s.id);if(!Number.isFinite(s.seconds)||s.seconds<1||s.seconds>10)throw Error('Invalid shot duration');seconds+=s.seconds;}
 for(const s of p.shots){if(['real-product','real-refined'].includes(input.template)&&(!Number.isFinite(s.trimBefore)||s.trimBefore<0||!Number.isFinite(s.sourceDuration)||s.trimBefore+s.seconds>s.sourceDuration))throw Error('Source range outside footage');}
 for(const s of p.shots){if(s.captionFrom!==undefined&&(!Number.isFinite(s.captionFrom)||!Number.isFinite(s.captionTo)||s.captionFrom<0||s.captionTo>s.seconds||s.captionTo<=s.captionFrom))throw Error('Caption range outside shot');}
 if(seconds<15||seconds>25)throw Error('Ad duration must be 15–25 seconds');
 for(const name of [p.asset,p.voice,p.music,p.mix,...p.shots.map(s=>s.source)].filter(Boolean)) {if(typeof name!=='string'||path.isAbsolute(name)||name.split(/[\\/]/).includes('..')||name.includes(':'))throw Error('Asset must be a local public path');if(!(await stat(path.join(root,'public',name))).isFile())throw Error('Missing asset');}
 const catalog=JSON.parse(await readFile(path.join(root,'catalog',`${input.template}.json`),'utf8'));
 if(catalog.sample.from<0||catalog.sample.to>seconds||catalog.sample.to<=catalog.sample.from)throw Error('Sample range outside timeline');
 return {seconds,frames:Math.round(seconds*30),hasAudio:Boolean(p.voice||p.mix||p.music)};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){console.log(JSON.stringify(await validate(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'))));}
