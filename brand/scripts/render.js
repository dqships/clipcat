const {chromium}=require('playwright');const fs=require('fs');const B=require('path').join(__dirname,'..','icon')+'/';
const jobs=[];
for(const s of [64,128,256,512,1024]) jobs.push(['clipcat-icon-macos.svg',s,`png/macos-${s}.png`]);
for(const s of [16,32]) jobs.push(['clipcat-icon-macos.svg',s,`png/macos-${s}.png`]);
for(const s of [48,64,128,256]) jobs.push(['clipcat-icon-tile.svg',s,`png/tile-${s}.png`]);
for(const s of [16,24,32]) jobs.push(['clipcat-icon-tile-small.svg',s,`png/tile-${s}.png`]);
jobs.push(['clipcat-icon-square.svg',180,'apple-touch-icon.png']);
for(const s of [192,512]) jobs.push(['clipcat-icon-tile.svg',s,`png/web-${s}.png`]);
(async()=>{const b=await chromium.launch();
for(const [src,s,out] of jobs){const p=await b.newPage({viewport:{width:s,height:s}});
 const svg=fs.readFileSync(B+src,'utf8');
 await p.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${s}px;height:${s}px}</style>${svg}`);
 await p.screenshot({path:B+out,omitBackground:true,clip:{x:0,y:0,width:s,height:s}});await p.close();}
await b.close();})();
