# usage: python3 .c4s-impl/runs/scope.py <unit-id> <out> [key=json ...]  — writes a scope block for a role run
import json,sys
s=json.load(open('.c4s-impl/state.json')); u=next(x for x in s['units'] if x['id']==sys.argv[1])
sc={"unit":{k:u[k] for k in ('id','goal','recipe','jobs')},"stateDir":".c4s-impl/"}
for kv in sys.argv[3:]:
    k,v=kv.split('=',1); sc[k]=json.loads(v)
json.dump(sc,open(sys.argv[2],'w'),ensure_ascii=False,indent=2)
