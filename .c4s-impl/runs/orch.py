# orchestrator helper (claude-code-session harness): state transitions of loop-protocol.md resume()
# usage:
#   orch.py next                         -> print the next step derived from state
#   orch.py start-unit <unit>            -> in-progress, startCommit=HEAD (+ wave startCommit)
#   orch.py split <unit> <split.json>    -> record portions
#   orch.py start-portion <portion>      -> portion in-progress, write build scope; prints scope path
#   orch.py implemented <portion> <status.json> -> apply an implementer run (implemented | partial | blocked)
#   orch.py unit-verdict <unit> <verdict.json> -> apply unit-scope verdict (reopen or ok)
#   orch.py review <unit> <review.json>  -> apply review (VERIFIED -> unit-commit.sh squashes, or reopen)
# protocol 2026-10-08: no portion verifier; one commit per unit (baseCommit..HEAD squashed at verify)
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


def accepted_by_deviation(r):
    # a row the code cannot satisfy because the specification contradicts itself (or the code
    # predates the window), carried by a non-blocking drift/incorrect deviation: the patch owns it
    import re
    for dev_id in re.findall(r'dev-\d{4}', r.get('evidence', '')):
        p = f'.c4s-impl/deviations/{dev_id}.json'
        if os.path.exists(p):
            d = json.load(open(p))
            if not d['blocking'] and d['kind'] in ('drift', 'incorrect'):
                return True
    return False


def bad(rows):
    return [r for r in rows if r['status'] != 'covered' and not accepted_by_deviation(r)]


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
        if p['status'] != 'implemented':
            print('PORTION', p['name'], p['status'], json.dumps(p.get('only', []))); sys.exit()
    print('UNIT-VERIFY', u['id'])
    sys.exit()

if cmd == 'start-unit':
    u = unit(s, sys.argv[2]); h = head()
    u['status'] = 'in-progress'; u['startCommit'] = h; u['baseCommit'] = h
    w = next(w for w in s['waves'] if w['n'] == u['wave'])
    if not w.get('startCommit'):
        w['startCommit'] = h
    save(s); print(scope(s, 'split', u, {}))

elif cmd == 'split':
    u = unit(s, sys.argv[2]); sp = json.load(open(sys.argv[3]))
    u['portions'] = [{'name': p['name'], 'layers': p.get('layers', []), 'slugs': p['slugs'], 'status': 'pending', 'rounds': 0, 'partial': 0, 'uncovered': [], 'only': [], **({'criteriaGroup': p['criteriaGroup']} if p.get('criteriaGroup') else {})} for p in sp['portions']]
    save(s); print(len(u['portions']), 'portions')

elif cmd == 'start-portion':
    u, p = portion(s, sys.argv[2])
    if p['status'] == 'in-progress':
        print('RESUMING an in-progress portion (a previous run stopped early)')
    p['status'] = 'in-progress'
    save(s)
    slug = u['id']
    pk = f".c4s-impl/packets/{slug}-{p['name'].split('/')[1]}.md"
    if not os.path.exists(pk):
        pk = f".c4s-impl/packets/{slug}.md"
    print(scope(s, 'build', u, {'portion': {'name': p['name'], 'layers': p.get('layers', []), 'slugs': p['slugs'], 'packet': pk}, 'only': p.get('only', [])}))

elif cmd == 'implemented':
    u, p = portion(s, sys.argv[2])
    st = json.load(open(sys.argv[3])) if len(sys.argv) > 3 and os.path.exists(sys.argv[3]) else None
    if st and st.get('status') == 'waiting':
        u['status'] = 'blocked'; u['blockedBy'] = (st.get('deviations') or ['waiting'])[0]
        save(s); print('BLOCKED', u['blockedBy']); sys.exit()
    if st is None or st.get('stoppedEarly') or st.get('status') == 'error':
        p['partial'] = p.get('partial', 0) + 1
        if p['partial'] >= STUCK:
            u['status'] = 'blocked'; u['blockedBy'] = 'stuck'
            open('.c4s-impl/gate', 'w').write(f'stuck: {p["name"]} stopped early {p["partial"]} times\n')
        save(s); print('PARTIAL', p['partial']); sys.exit()
    p['status'] = 'implemented'; p['rounds'] += 1; p['partial'] = 0; p['only'] = []
    save(s); print(f"round {p['rounds']}")

elif cmd == 'unit-verdict':
    u = unit(s, sys.argv[2]); v = json.load(open(sys.argv[3]))
    b = bad(v['rows'])
    u.setdefault('rounds', {}); u['rounds']['unit'] = u['rounds'].get('unit', 0) + 1
    prev = u.get('lastUncovered'); u['lastUncovered'] = len(b)
    if not b:
        cov = sum(1 for r in v['rows'] if r['status'] == 'covered')
        save(s); print('OK', f"{cov}/{len(v['rows'])}" + (f" + {len(v['rows']) - cov} accepted by deviation" if cov < len(v['rows']) else '')); sys.exit()
    if u['rounds']['unit'] >= STUCK and prev is not None and len(b) >= prev:
        u['status'] = 'blocked'; u['blockedBy'] = 'stuck'
        open('.c4s-impl/gate', 'w').write(f'stuck: {u["id"]} unit verify did not shrink ({len(b)} open)\n')
        save(s); print('STUCK', [r['slug'] for r in b]); sys.exit()
    # reopen the portions owning the failed slugs; goal/regression/stub rows go to the last portion
    for r in b:
        own = next((p for p in u['portions'] if r['slug'] in p['slugs']), u['portions'][-1])
        own['status'] = 'pending'; own.setdefault('only', []).append({'slug': r['slug']}); own.setdefault('uncovered', []).append(r['slug'])
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
