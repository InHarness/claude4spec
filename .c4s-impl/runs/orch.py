# orchestrator helper: python3 .c4s-impl/runs/orch.py <cmd> <unit> [arg]
import json,sys,subprocess
P='.c4s-impl/state.json'; s=json.load(open(P)); cmd,uid=sys.argv[1],sys.argv[2]
u=next(x for x in s['units'] if x['id']==uid)
head=lambda: subprocess.check_output(['git','rev-parse','HEAD']).decode().strip()
def portion(name): return next(q for q in u['portions'] if q['name']==name)
if cmd=='split':
    sp=json.loads(sys.argv[3]); u['portions']=[{**x,"status":"pending","rounds":0,"partial":0,"uncovered":[],"only":[]} for x in sp['portions']]
elif cmd=='start':
    u.update(status='in-progress',startCommit=head(),baseCommit=head())
    w=s['waves'][u['wave']-1]
    if not w.get('startCommit'): w['startCommit']=head()
elif cmd=='pstart': portion(sys.argv[3])['status']='in-progress'
elif cmd=='pdone':
    q=portion(sys.argv[3]); q.update(status='implemented',rounds=q['rounds']+1,partial=0,only=[],uncovered=[])
elif cmd=='ppartial': q=portion(sys.argv[3]); q['partial']=q.get('partial',0)+1
elif cmd=='verified':
    u['rounds']['unit']+=1; u['lastUncovered']=0
elif cmd=='reopen':  # arg: json {portion: [only items]}
    for name,items in json.loads(sys.argv[3]).items():
        q=portion(name); q.update(status='pending',only=items,uncovered=[i.get('slug') or i.get('finding') for i in items])
    u['status']='in-progress'; u['startCommit']=head()
elif cmd=='reviewblock': u['rounds']['review']+=1; u['lastBlocking']=int(sys.argv[3])
elif cmd=='verify': u.update(status='verified'); u['rounds']['review']=0; u['lastBlocking']=0
s['iteration']+=1; json.dump(s,open(P,'w'),ensure_ascii=False,indent=2); print('ok',cmd,uid)
