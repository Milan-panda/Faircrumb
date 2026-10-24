// Original vector-first faircrumb mark: an f with three shared crumbs.
// PNGs use a full-bleed background so the OS can apply its own mask safely.
import { writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
const background=[22,78,67,255], foreground=[217,249,154,255];
const strokes=[[[172,352],[172,160]],[[172,160],[294,160]],[[172,248],[270,248]]];
const crumbs=[[352,160,20],[356,244,15],[326,320,11]];
const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#164e43"/><path d="M172 352V160h122M172 248h98" fill="none" stroke="#d9f99a" stroke-width="36" stroke-linecap="round" stroke-linejoin="round"/><g fill="#d9f99a"><circle cx="352" cy="160" r="20"/><circle cx="356" cy="244" r="15"/><circle cx="326" cy="320" r="11"/></g></svg>\n';
await writeFile('public/icon.svg',svg);
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function chunk(type,data){const kind=Buffer.from(type);const result=Buffer.alloc(12+data.length);result.writeUInt32BE(data.length);kind.copy(result,4);data.copy(result,8);result.writeUInt32BE(crc32(Buffer.concat([kind,data])),8+data.length);return result;}
function onStroke(x,y,a,b){const dx=b[0]-a[0],dy=b[1]-a[1];const t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy)));return (x-a[0]-t*dx)**2+(y-a[1]-t*dy)**2<=18**2;}
for(const size of [192,512]){
 const raw=Buffer.alloc((size*4+1)*size);
 for(let y=0;y<size;y++){const offset=y*(size*4+1);for(let x=0;x<size;x++){
  // Four samples keep the small icon edges smooth without a graphics dependency.
  let coverage=0;for(const [sx,sy] of [[.25,.25],[.75,.25],[.25,.75],[.75,.75]]){
   const px=(x+sx)/size*512,py=(y+sy)/size*512;
   if(strokes.some(([a,b])=>onStroke(px,py,a,b))||crumbs.some(([cx,cy,r])=>(px-cx)**2+(py-cy)**2<=r*r))coverage++;
  }
  for(let c=0;c<4;c++)raw[offset+1+x*4+c]=Math.round(background[c]+(foreground[c]-background[c])*coverage/4);
 }}
 const header=Buffer.alloc(13);header.writeUInt32BE(size);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
 await writeFile(`public/icon-${size}.png`,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));
}
console.log('Generated faircrumb SVG and 192/512px PWA icons.');
