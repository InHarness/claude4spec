# orchestrator helper: write a role run's scope block (loop-protocol.md "Scope of a run")
import json,sys
kind,unit_id=sys.argv[1],sys.argv[2]; extra=json.loads(sys.argv[3]) if len(sys.argv)>3 else {}
s=json.load(open('.c4s-impl/state.json'))
u=next(x for x in s['units'] if x['id']==unit_id)
scope={'unit':{'id':u['id'],'goal':u['goal'],'recipe':u['recipe'],'dependsOn':u['dependsOn']},'stateDir':'.c4s-impl/'}
scope.update(extra); scope['mode']=kind
out=f".c4s-impl/runs/{s['iteration']:03d}-{kind}-{unit_id}.scope.json"
json.dump(scope,open(out,'w'),ensure_ascii=False,indent=2);print(out)
