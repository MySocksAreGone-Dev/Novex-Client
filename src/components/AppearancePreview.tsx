import {useEffect,useRef,useState} from 'react';
import type {SkinModel} from '../services/appearance';
// Small, static 2D player previews. No WebGL context or animation loop per card.
export default function AppearancePreview({image,model='classic',cape=false,back=false,label='Skin preview'}:{image?:string;model?:SkinModel;cape?:boolean;back?:boolean;label?:string}){
    const ref=useRef<HTMLCanvasElement>(null),[failed,setFailed]=useState(false);
    useEffect(()=>{
        const canvas=ref.current,ctx=canvas?.getContext('2d');if(!canvas||!ctx)return;
        let live=true;ctx.clearRect(0,0,canvas.width,canvas.height);setFailed(false);
        if(!image)return;
        const texture=new Image();texture.onload=()=>{
            if(!live)return;ctx.imageSmoothingEnabled=false;
            const scale=8;const draw=(sx:number,sy:number,w:number,h:number,x:number,y:number,mirror=false)=>{ctx.save();ctx.scale(scale,scale);if(mirror){ctx.translate(x+w,y);ctx.scale(-1,1);ctx.drawImage(texture,sx,sy,w,h,0,0,w,h);}else ctx.drawImage(texture,sx,sy,w,h,x,y,w,h);ctx.restore();};
            if(cape){draw(back?12:1,1,10,16,7,8);return;}
            const arm=model==='slim'?3:4,legacy=texture.height===32;
            draw(back?24:8,8,8,8,8,0);draw(back?32:20,20,8,12,8,8);
            draw(back?48+arm:44,20,arm,12,8-arm,8);
            draw(legacy?(back?48+arm:44):(back?40+arm:36),legacy?20:52,arm,12,16,8,legacy);
            draw(back?12:4,20,4,12,8,20);draw(legacy?(back?12:4):(back?28:20),legacy?20:52,4,12,12,20,legacy);
            draw(back?56:40,8,8,8,8,0);
            if(!legacy){draw(back?32:20,36,8,12,8,8);draw(back?48+arm:44,36,arm,12,8-arm,8);draw(back?56+arm:52,52,arm,12,16,8);draw(back?12:4,36,4,12,8,20);draw(back?12:4,52,4,12,12,20);}
        };
        texture.onerror=()=>{if(live)setFailed(true);};texture.src=image;
        return()=>{live=false;texture.onload=null;texture.onerror=null;};
    },[image,model,cape,back]);
    return <div className="appearance-preview"><canvas ref={ref} width={192} height={256} role="img" aria-label={label}/>{(!image||failed)&&<span>{failed?'Preview unavailable':'Default skin'}</span>}</div>;
}
