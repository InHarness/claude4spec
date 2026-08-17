cd /Users/michael/Code/ctowiec/claude4spec-private/app-spec

git status --short .claude4spec/entities   # najpierw: czysto? encje są w gicie = rollback za darmo

for d in dto ui-view design-system spreadsheet; do
  for f in .claude4spec/entities/$d/*.json; do
    node -e '
      const fs=require("fs"), p=process.argv[1];
      const o=JSON.parse(fs.readFileSync(p,"utf8"));
      if(!("name" in o) || "title" in o) process.exit(0);
      const out={};
      for(const [k,v] of Object.entries(o)) out[k==="name"?"title":k]=v;
      fs.writeFileSync(p, JSON.stringify(out,null,2)+"\n");
    ' "$f"
  done
done

git diff --stat .claude4spec/entities      # oczekiwane: 118 plików