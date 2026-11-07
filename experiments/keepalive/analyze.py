import json, sys
rows=[json.loads(l) for l in open('log.jsonl')]
for run in dict.fromkeys(r['run'] for r in rows):
    rs=[r for r in rows if r['run']==run]; beats=[r for r in rs if r.get('ev')=='beat']
    print(f'== {run}: {len(beats)} beats')
    for r in rs:
        if r.get('ev')!='beat': print('  ', {k:r[k] for k in r if k not in('run','t')})
    prev=None
    for b in beats:
        if prev and b['srv']-prev['srv']>4500: print(f"   GAP {(b['srv']-prev['srv'])/1000:.1f}s after wall={prev['wall']} (ac drift {(b['ac']-prev['ac'])-(b['wall']-prev['wall']):+.2f}s)")
        prev=b
    if beats:
        l=beats[-1]; print(f"   last: wall={l['wall']} ac={l['ac']:.1f} (ac-wall {l['ac']-l['wall']:+.2f}s) state={l['state']} vis={l['vis']}")
        print('   maxGap', max(b.get('maxGap',0) for b in beats))
