import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('package.json',root),'utf8'));
for(const section of ['dependencies','devDependencies'])for(const name of Object.keys(manifest[section]??{})){
  const installed=JSON.parse(await readFile(new URL(`node_modules/${name}/package.json`,root),'utf8'));
  manifest[section][name]=installed.version;
}
await writeFile(new URL('package.json',root),JSON.stringify(manifest,null,2)+'\n');
