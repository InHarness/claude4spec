import { chromium } from 'playwright';
const BASE='http://localhost:3300';
const r=await fetch(`${BASE}/api/workspace`); const p=(await r.json()).projects[0];
const b=await chromium.launch(); const page=await b.newPage({viewport:{width:1440,height:1000}});
const errs=[],bad=[];
page.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
page.on('response',res=>{if(res.status()>=400)bad.push(`${res.status()} ${res.url()}`)});
await page.goto(`${BASE}/p/${p.id}/mcp-tools/alpha-read-page`,{waitUntil:'networkidle'});
await page.waitForTimeout(1500);
const info=await page.evaluate(()=>{
  const ps=[...document.querySelectorAll('.prose-spec')];
  const ta=[...document.querySelectorAll('textarea')];
  return {
    proseCount: ps.length,
    proseHtml: ps.map(e=>e.innerHTML.slice(0,200)),
    proseText: ps.map(e=>e.innerText),
    textareas: ta.map(e=>e.value.slice(0,60)),
    bodyHead: document.body.innerText.slice(0,600),
  };
});
console.log(JSON.stringify(info,null,2));
console.log('errors:',errs); console.log('4xx:',bad);
const api=await (await fetch(`${BASE}/api/projects/${p.id}/mcp-tools/alpha-read-page`)).json();
console.log('api description:',JSON.stringify(api?.data?.description));
await page.screenshot({path:'/private/tmp/claude-501/-Users-michael-Code-ctowiec-claude4spec/a7ca5411-1cfe-4b44-86cf-41d3807a48fc/scratchpad/probe-detail.png',fullPage:true});
await b.close();
