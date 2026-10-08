# orchestrator helper: ship every unsent deviation with c4s create-patch (loop-protocol.md "Shipping")
import json, os, subprocess, time
for f in sorted(os.listdir('.c4s-impl/deviations')):
    if not f.endswith('.json'): continue
    p = '.c4s-impl/deviations/' + f; d = json.load(open(p))
    if d.get('sent'): continue
    md = p[:-5] + '.md'
    if not os.path.exists(md):
        t = d['text']; parts = t.split('Suggestion:', 1)
        open(md, 'w').write('## What I found\n\n' + parts[0].strip() + '\n\n## Suggestion\n\n' + (parts[1].strip() if len(parts) > 1 else '(see above)') + '\n')
    desc = f"{d['address']}: {d['text'][:90].splitlines()[0]}"
    for attempt in range(4):
        r = subprocess.run(['c4s', 'create-patch', '--brief', '2-1-7-to-2-1-8-workflow-test.md', '--kind', d['kind'], '--desc', desc, '--body-file', md, '--project', 'app-spec', '--workspace', 'default'], capture_output=True, text=True)
        try:
            out = json.loads(r.stdout)
        except Exception:
            out = {}
        if 'path' in out:
            d['sent'] = True; d['patchPath'] = out['path']; json.dump(d, open(p, 'w'), ensure_ascii=False, indent=2)
            print('sent', d['id'], out['path']); break
        time.sleep(5)
    else:
        print('FAILED', d['id'], r.stdout[:300], r.stderr[:300])
