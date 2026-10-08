// orchestrator helper: validate a role's JSON against .c4s-impl/schemas/<schema>.json
// usage: node .c4s-impl/runs/validate.cjs <schema>=<file> ...
const path=require('path'),fs=require('fs');const root=process.cwd();
const Ajv=require(path.join(root,'node_modules/ajv/dist/2020')).default;
const ajv=new Ajv({allErrors:true,strict:false});let bad=0;
for(const [schema,file] of process.argv.slice(2).map(a=>a.split('='))){
  const v=ajv.compile(JSON.parse(fs.readFileSync(path.join(root,'.c4s-impl/schemas',schema+'.json'))));
  const ok=v(JSON.parse(fs.readFileSync(file)));console.log(schema,file,ok?'OK':JSON.stringify(v.errors));if(!ok)bad=1;}
process.exit(bad)
