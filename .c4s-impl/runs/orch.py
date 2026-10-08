# orchestrator helper (claude-code-session harness): state transitions of loop-protocol.md resume()
# usage:
#   orch.py next                         -> print the next step derived from state
#   orch.py start-unit <unit>            -> in-progress, startCommit=HEAD (+ wave startCommit)
#   orch.py split <unit> <split.json>    -> record portions
#   orch.py start-portion <portion>      -> portion in-progress, write build scope; prints scope path
#   orch.py verdict <portion> <verdict.json>  -> apply a portion verdict
#   orch.py unit-verdict <unit> <verdict.json> -> apply unit-scope verdict (reopen or ok)
#   orch.py review <unit> <review.json>  -> apply review (verify or reopen)
import json, subprocess, sys, os

P = '.c4s-impl/state.json'
STUCK = 3


def load():
    return json.load(open(P))


def save(s):
    json.dump(s, open(P, 'w'), ensure_ascii=False, indent=2)


def head():
    return subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()


def unit(s, uid):
    return next(u for u in s['units'] if u['id'] == uid)


def portion(s, name):
    uid = name.split('/')[0]
    u = unit(s, uid)
    return u, next(p for p in u['portions'] if p['name'] == name)


def scope(s, kind, u, extra):
    sc = {'unit': {'id': u['id'], 'goal': u['goal'], 'recipe': u['recipe'], 'dependsOn': u['dependsOn']}, 'stateDir': '.c4s-impl/', 'mode': kind}
    sc.update(extra)
    out = f".c4s-impl/runs/{s['iteration']:03d}-{kind}-{u['id'].split('-')[0]}{('-' + extra['portion']['name'].split('/')[1]) if 'portion' in extra else ''}.scope.json"
    json.dump(sc, open(out, 'w'), ensure_ascii=False, indent=2)
    return out


def bad(rows):
    return [r for r in rows if r['status'] != 'covered']


cmd = sys.argv[1]
s = load()
s['iteration'] = s.get('iteration', 0) + (0 if cmd == 'next' else 1)

if cmd == 'next':
    ip = [u for u in s['units'] if u['status'] == 'in-progress']
    ver = {u['id'] for u in s['units'] if u['status'] == 'verified'}
    if ip:
        u = ip[0]
    else:
        cand = [u for u in s['units'] if u['status'] == 'pending' and all(d['unit'] in ver for d in u['dependsOn'])]
        if not cand:
            print('ALL-VERIFIED' if len(ver) == len(s['units']) else 'WAITING'); sys.exit()
        u = cand[0]
        print('START', u['id']); sys.exit()
    if not u['portions']:
        print('SPLIT', u['id']); sys.exit()
    for p in u['portions']:
        if p['status'] != 'verified':
            print('PORTION', p['name'], p['status'], json.dumps(p.get('only', []))); sys.exit()
    print('UNIT-VERIFY', u['id'])
    sys.exit()

if cmd == 'start-unit':
    u = unit(s, sys.argv[2]); h = head()
    u['status'] = 'in-progress'; u['startCommit'] = h
    w = next(w for w in s['waves'] if w['n'] == u['wave'])
    if not w.get('startCommit'):
        w['startCommit'] = h
    save(s); print(scope(s, 'split', u, {}))

elif cmd == 'split':
    u = unit(s, sys.argv[2]); sp = json.load(open(sys.argv[3]))
    u['portions'] = [{'name': p['name'], 'layers': p.get('layers', []), 'slugs': p['slugs'], 'status': 'pending', 'rounds': 0, 'uncovered': [], 'only': [], **({'criteriaGroup': p['criteriaGroup']} if p.get('criteriaGroup') else {})} for p in sp['portions']]
    save(s); print(len(u['portions']), 'portions')

elif cmd == 'start-portion':
    u, p = portion(s, sys.argv[2])
    if p['status'] == 'in-progress':
        print('ALREADY-IN-PROGRESS: verify next')
    p['status'] = 'in-progress'
    save(s)
    slug = u['id']
    pk = f".c4s-impl/packets/{slug}-{p['name'].split('/')[1]}.md"
    if not os.path.exists(pk):
        pk = f".c4s-impl/packets/{slug}.md"
    print(scope(s, 'build', u, {'portion': {'name': p['name'], 'layers': p.get('layers', []), 'slugs': p['slugs'], 'packet': pk}, 'only': p.get('only', [])}))
    print(scope(s, 'verify-portion', u, {'portion': {'name': p['name'], 'layers': p.get('layers', []), 'slugs': p['slugs']}, 'only': p.get('only', [])}))

elif cmd == 'verdict':
    u, p = portion(s, sys.argv[2]); v = json.load(open(sys.argv[3]))
    prev = len(p.get('uncovered', [])) if p['rounds'] else None
    b = bad(v['rows'])
    p['uncovered'] = [r['slug'] for r in b]
    p['only'] = [{'slug': r['slug']} for r in b]
    p['rounds'] += 1
    if not b:
        p['status'] = 'verified'
    else:
        p['status'] = 'pending'
        if p['rounds'] >= STUCK and prev is not None and len(b) >= prev:
            u['status'] = 'blocked'; u['blockedBy'] = 'stuck'
            open('.c4s-impl/gate', 'w').write(f'stuck: {p["name"]}\n')
    save(s); print(p['status'], f"{len(v['rows']) - len(b)}/{len(v['rows'])}", [r['slug'] for r in b])

elif cmd == 'unit-verdict':
    u = unit(s, sys.argv[2]); v = json.load(open(sys.argv[3]))
    b = bad(v['rows'])
    u.setdefault('rounds', {}); u['rounds']['unit'] = u['rounds'].get('unit', 0) + 1
    if not b:
        save(s); print('OK', f"{len(v['rows'])}/{len(v['rows'])}"); sys.exit()
    # reopen the portions owning the failed slugs; goal/regression/stub rows go to the last portion
    for r in b:
        own = next((p for p in u['portions'] if r['slug'] in p['slugs']), u['portions'][-1])
        own['status'] = 'pending'; own.setdefault('only', []).append({'slug': r['slug']})
    u['startCommit'] = head()
    save(s); print('REOPEN', [r['slug'] for r in b])

elif cmd == 'review':
    u = unit(s, sys.argv[2]); r = json.load(open(sys.argv[3]))
    json.dump(r, open(f'.c4s-impl/review/{u["id"]}.json', 'w'), ensure_ascii=False, indent=2)
    nb = [f for f in r['findings'] if not f['blocking']]
    if nb:
        with open(f'.c4s-impl/review/{u["id"]}.md', 'a') as fh:
            for f in nb:
                fh.write(f"- {f['id']} {f['file']}:{f['line']} — {f['reason']}\n")
    blk = [f for f in r['findings'] if f['blocking']]
    u.setdefault('rounds', {})
    if not blk:
        u['status'] = 'verified'; u['rounds']['review'] = 0
        for f in os.listdir('.c4s-impl/packets') if os.path.isdir('.c4s-impl/packets') else []:
            if f.startswith(u['id']):
                os.remove('.c4s-impl/packets/' + f)
        save(s); print('VERIFIED', len(nb), 'non-blocking'); sys.exit()
    u['rounds']['review'] = u['rounds'].get('review', 0) + 1
    if u['rounds']['review'] >= STUCK and len(blk) >= u.get('lastBlocking', 1e9):
        u['status'] = 'blocked'; u['blockedBy'] = 'review'
        open('.c4s-impl/gate', 'w').write(f'review: {u["id"]}\n')
    else:
        for f in blk:
            p = next((p for p in u['portions'] if p['name'] == f['portion']), u['portions'][-1])
            p['status'] = 'pending'; p.setdefault('only', []).append({'finding': f['id']})
        u['startCommit'] = head()
    u['lastBlocking'] = len(blk)
    save(s); print('REOPEN-REVIEW', [f['id'] for f in blk])
