import {inflateSync} from 'node:zlib';
export const MAX_SKIN_BYTES = 1024 * 1024;
const signature = Buffer.from([137,80,78,71,13,10,26,10]);
function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) { crc ^= byte; for (let bit=0;bit<8;bit++) crc=(crc>>>1)^((crc&1)?0xedb88320:0); }
    return (crc^0xffffffff)>>>0;
}
// Validate the complete PNG before decoding or uploading, including bounded
// inflation, CRCs and scanline filters. No image processing dependency is needed.
export function validateSkinPng(input) {
    const bytes=Buffer.from(input);
    const invalid=()=>{throw new Error('Invalid or corrupt PNG. Choose a valid Minecraft skin image.');};
    if(bytes.length>MAX_SKIN_BYTES)throw new Error('Skin PNG files must be 1 MiB or smaller.');
    if(bytes.length<33||!bytes.subarray(0,8).equals(signature))invalid();
    let offset=8,header,ended=false,palette=false,idatEnded=false;const chunks=[];
    while(offset<bytes.length){
        if(offset+12>bytes.length)invalid();const length=bytes.readUInt32BE(offset),end=offset+12+length;
        if(end>bytes.length)invalid();const type=bytes.toString('ascii',offset+4,offset+8),data=bytes.subarray(offset+8,end-4);
        if(crc32(bytes.subarray(offset+4,end-4))!==bytes.readUInt32BE(end-4))invalid();
        if(!header&&type!=='IHDR')invalid();
        if(type==='IHDR'){
            if(header||length!==13)invalid();
            const width=data.readUInt32BE(0),height=data.readUInt32BE(4),depth=data[8],color=data[9],interlace=data[12];
            if(width!==64||![32,64].includes(height))throw new Error('Minecraft skins must be 64×64 or legacy 64×32 pixels.');
            if(!({0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]}[color]||[]).includes(depth)||data[10]||data[11]||interlace>1)invalid();
            header={width,height,depth,color,interlace};
        }else if(type==='PLTE'){if(palette||chunks.length||!length||length%3||length>768)invalid();palette=true;}
        else if(type==='IDAT'){if(idatEnded||(header.color===3&&!palette))invalid();chunks.push(data);}
        else if(type==='IEND'){if(length||end!==bytes.length)invalid();ended=true;}
        else if(!['tRNS','gAMA','cHRM','sRGB','iCCP','sBIT','pHYs','tEXt','zTXt','iTXt','bKGD','hIST','tIME','eXIf'].includes(type)&&type[0]===type[0]?.toUpperCase())invalid();
        if(chunks.length&&type!=='IDAT')idatEnded=true;
        if(['acTL','fcTL','fdAT'].includes(type))throw new Error('Animated PNG skins are not supported. Choose a still PNG.');
        offset=end;
    }
    if(!ended||!chunks.length)invalid();let raw;
    try{raw=inflateSync(Buffer.concat(chunks),{maxOutputLength:100000});}catch{invalid();}
    const channels={0:1,2:3,3:1,4:2,6:4}[header.color];let cursor=0;
    const passes=header.interlace?[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]]:[[0,0,1,1]];
    for(const [x,y,dx,dy] of passes){const w=Math.max(0,Math.ceil((header.width-x)/dx)),h=Math.max(0,Math.ceil((header.height-y)/dy));if(!w||!h)continue;const stride=Math.ceil(w*channels*header.depth/8);for(let row=0;row<h;row++){if(cursor>=raw.length||raw[cursor]>4)invalid();cursor+=1+stride;}}
    if(cursor!==raw.length)invalid();return {width:header.width,height:header.height};
}
export function validateSkinModel(value,height=64){if(!['classic','slim'].includes(value))throw new Error('Choose Classic / Steve or Slim / Alex.');if(height===32&&value==='slim')throw new Error('Legacy 64×32 skins require Classic. Use a 64×64 image for Slim.');return value;}
