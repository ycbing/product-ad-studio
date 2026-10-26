import React from 'react';
import {AbsoluteFill,Audio,OffthreadVideo,Sequence,interpolate,staticFile,useCurrentFrame} from 'remotion';
import type {RefinedProps} from './refined-schema';
function Shot({shot,index}:{shot:RefinedProps['shots'][number];index:number}) {
 const f=useCurrentFrame();const frames=Math.round(shot.seconds*30);
 const enter=interpolate(f,[2,12],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
 const scale=interpolate(f,[0,frames],[shot.zoom,shot.zoom+0.018]);
 const hero=index===0||index===4;
 const subStart=(shot.captionFrom??0)*30;const subEnd=(shot.captionTo??shot.seconds)*30;
 // Keep the source inside the canvas even when a later editor changes the crop.
 const x=Math.max(-(scale-1)*540,Math.min((scale-1)*540,shot.shiftX));
 const y=Math.max(-(scale-1)*960,Math.min((scale-1)*960,shot.shiftY));
 return <AbsoluteFill style={{background:'#d9d8cf',fontFamily:'"PingFang SC","Noto Sans CJK SC",sans-serif',color:'#203c32',overflow:'hidden'}}>
  <OffthreadVideo muted src={staticFile(shot.source)} trimBefore={Math.round(shot.trimBefore*30)} style={{width:'100%',height:'100%',objectFit:'cover',objectPosition:shot.position,transform:`translate(${x}px,${y}px) scale(${scale})`,filter:'saturate(.94) contrast(1.02) brightness(1.035)'}}/>
  <AbsoluteFill style={{background:'linear-gradient(180deg,rgba(250,247,238,.50),rgba(250,247,238,.16) 31%,transparent 49%,transparent 72%,rgba(10,23,18,.68))'}}/>
  <div style={{position:'absolute',left:72,right:72,top:100,display:'flex',justifyContent:'space-between',fontSize:22,letterSpacing:3,color:'#294238'}}><span>DAILY OBJECTS / 01</span><span style={{fontSize:20,letterSpacing:1}}>实拍素材 · 创意样片</span></div>
  <div style={{position:'absolute',left:76,right:76,top:hero?295:280,opacity:enter,transform:`translateY(${(1-enter)*14}px)`}}>
   <div style={{fontSize:25,color:'#455e50',marginBottom:30,letterSpacing:4}}>{shot.kicker}</div>
   <div style={{fontSize:hero?96:57,fontWeight:hero?600:500,lineHeight:1.28,letterSpacing:hero?-2:0,whiteSpace:'pre-line',textShadow:'0 1px 12px #ffffff22'}}>{shot.headline}</div>
   {index===4&&<div style={{fontSize:32,marginTop:30,letterSpacing:2,color:'#3a5146'}}>给日常，一个清楚的位置。</div>}
  </div>
  {shot.caption&&<div style={{position:'absolute',left:90,right:90,bottom:225,textAlign:'center',fontSize:35,lineHeight:1.5,color:'#fffef8',textShadow:'0 2px 14px #0009',opacity:interpolate(f,[subStart,subStart+3,subEnd-3,subEnd],[0,1,1,0],{extrapolateLeft:'clamp',extrapolateRight:'clamp'})}}>{shot.caption}</div>}
  <div style={{position:'absolute',left:76,right:76,bottom:115,fontSize:20,color:'#f0f0e8bb',letterSpacing:1}}>品类展示 / 非特定品牌或型号</div>
 </AbsoluteFill>;
}
export const RefinedProduct:React.FC<RefinedProps>=(props)=>{let offset=0;return <AbsoluteFill>{props.shots.map((s,i)=>{const from=offset;const duration=Math.round(s.seconds*30);offset+=duration;return <Sequence key={s.id} from={from} durationInFrames={duration}><Shot shot={s} index={i}/></Sequence>})}<Audio src={staticFile(props.mix)}/></AbsoluteFill>};
