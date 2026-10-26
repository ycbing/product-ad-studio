import React from 'react';
import {AbsoluteFill,Audio,Img,Sequence,interpolate,spring,staticFile,useCurrentFrame,useVideoConfig} from 'remotion';
import type {AdProps} from './schema';
const ink='#203d34',accent='#e0a45e';
function Scene({shot,ad,index}:{shot:AdProps['shots'][number];ad:AdProps;index:number}) {
 const frame=useCurrentFrame(); const {fps}=useVideoConfig();
 const enter=spring({frame,fps,config:{damping:200},durationInFrames:24});
 const fade=interpolate(frame,[0,10],[0,1],{extrapolateRight:'clamp'});
 const drift=interpolate(frame,[0,shot.seconds*fps],[0,18],{extrapolateRight:'clamp'});
 const dark=shot.layout==='cta'; const color=dark?'#f8f3e9':ink;
 return <AbsoluteFill style={{background:dark?ink:'#f6f2e9',color,fontFamily:'"PingFang SC","Noto Sans CJK SC",sans-serif',overflow:'hidden'}}>
  <div style={{position:'absolute',width:1000,height:1000,borderRadius:'50%',background:dark?'#33554a':'#e8e4d7',left:220,top:690,transform:`translateY(${-drift}px)`}}/>
  <div style={{position:'absolute',top:96,left:76,right:76,display:'flex',justifyContent:'space-between',fontSize:25,letterSpacing:3}}><span>{ad.brand}</span><span style={{fontSize:23,letterSpacing:0}}>AI 创意演示</span></div>
  <div style={{position:'absolute',left:76,top:225,right:76,opacity:fade,transform:`translateY(${(1-enter)*30}px)`}}>
   <div style={{fontSize:27,color:dark?'#ebc88e':'#65786b',marginBottom:34,letterSpacing:3}}>{shot.eyebrow}</div>
   <div style={{fontSize:shot.headline.length>24?68:78,fontWeight:700,lineHeight:1.28,whiteSpace:'pre-line',letterSpacing:-2}}>{shot.headline}</div>
  </div>
  {shot.layout==='problem'? <div style={{position:'absolute',left:110,right:110,top:850,height:400}}>{['盐','油','糖','醋','茶'].map((label,i)=><div key={label} style={{position:'absolute',left:i*150,top:(i%2)*90,transform:`rotate(${(i%2?1:-1)*9}deg) translateY(${-drift}px)`,width:135,height:245,borderRadius:25,background:['#d9b98d','#91a48b','#e0cdaa','#b08c6a','#b8c4aa'][i],boxShadow:'0 18px 25px #203d3414',display:'flex',alignItems:'center',justifyContent:'center',fontSize:42}}>{label}</div>)}</div>:
  <div style={{position:'absolute',top:560,left:0,width:1080,height:930,transform:`translateY(${(1-enter)*45-drift}px) scale(${1+frame*0.00015})`}}><Img src={staticFile(ad.asset)} style={{width:'100%',height:'100%',objectFit:'contain',filter:'drop-shadow(0 28px 22px #152b2520)'}}/></div>}
  {shot.layout==='benefits'&&<div style={{position:'absolute',left:76,right:76,top:1450,display:'flex',gap:18}}>{['分层摆放','开放取用','整理台面'].map(t=><div key={t} style={{fontSize:29,border:'2px solid #a7b3a4',borderRadius:40,padding:'18px 27px'}}>{t}</div>)}</div>}
  {dark&&<div style={{position:'absolute',left:76,right:76,top:1435,background:accent,color:ink,borderRadius:22,padding:30,textAlign:'center',fontSize:38,fontWeight:600}}>查看商品详情 ↗</div>}
  <div style={{position:'absolute',bottom:210,left:86,right:86,textAlign:'center',fontSize:36,lineHeight:1.5,background:dark?'#ffffff10':'#ffffffa8',borderRadius:20,padding:'22px 28px'}}>{shot.caption}</div>
  <div style={{position:'absolute',bottom:98,left:76,right:76,fontSize:22,opacity:0.65,display:'flex',justifyContent:'space-between'}}><span>{ad.demo?'虚构商品 · 原创插画示例 · 非真实功效演示':ad.productName}</span><span>0{index+1} / 05</span></div>
  <div style={{position:'absolute',bottom:0,left:0,height:8,width:`${Math.min(100,frame/(shot.seconds*fps)*100)}%`,background:accent}}/>
 </AbsoluteFill>;
}
export const ProductStory:React.FC<AdProps>=(ad)=>{let offset=0;return <AbsoluteFill>{ad.shots.map((shot,index)=>{const from=offset;const duration=Math.round(shot.seconds*30);offset+=duration;return <Sequence key={shot.id} from={from} durationInFrames={duration}><Scene shot={shot} ad={ad} index={index}/></Sequence>})}{ad.voice&&<Audio src={staticFile(ad.voice)}/>}</AbsoluteFill>};
