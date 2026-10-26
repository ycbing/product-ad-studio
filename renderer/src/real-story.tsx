import React from 'react';
import {AbsoluteFill,Audio,OffthreadVideo,Sequence,interpolate,staticFile,useCurrentFrame} from 'remotion';
import type {FilmProps} from './real-schema';
function RealShot({shot,index}:{shot:FilmProps['shots'][number];index:number}){
 const f=useCurrentFrame();const length=Math.round(shot.seconds*30);
 const opacity=interpolate(f,[5,18],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
 const rise=interpolate(f,[5,22],[30,0],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
 const scale=interpolate(f,[0,length],[index===2?1.33:1.02,index===2?1.40:1.07]);
 return <AbsoluteFill style={{background:'#101b18',fontFamily:'"PingFang SC","Noto Sans CJK SC",sans-serif',color:'white',overflow:'hidden'}}>
  <OffthreadVideo muted src={staticFile(shot.source)} trimBefore={Math.round(shot.trimBefore*30)} style={{width:'100%',height:'100%',objectFit:'cover',objectPosition:shot.position,transform:`scale(${scale})`,filter:'saturate(0.88) contrast(1.04)'}}/>
  <AbsoluteFill style={{background:'linear-gradient(180deg,rgba(250,248,242,.50),rgba(250,248,242,.20) 33%,transparent 58%,rgba(9,22,18,.78) 100%)'}}/>
  <div style={{position:'absolute',top:95,left:72,right:72,display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:23,letterSpacing:3,color:'#233f35'}}><span>KITCHEN / DAILY</span><span style={{fontSize:22,letterSpacing:0,border:'1px solid #233f3560',padding:'10px 16px',borderRadius:30}}>实拍素材演示</span></div>
  <div style={{position:'absolute',left:76,right:76,top:330,color:'#17382e',opacity,transform:`translateY(${rise}px)`}}>
   <div style={{width:55,height:4,background:'#826947',marginBottom:30}}/>
   <div style={{fontSize:27,letterSpacing:3,color:'#39564a',marginBottom:25}}>{shot.kicker}</div>
   <div style={{fontSize:shot.headline.length>22?76:86,fontWeight:600,lineHeight:1.32,whiteSpace:'pre-line',textShadow:'0 1px 18px #ffffff44'}}>{shot.headline}</div>
  </div>
  <div style={{position:'absolute',left:76,right:76,bottom:220,textAlign:'center',fontSize:34,lineHeight:1.6,color:'#fffdf6',textShadow:'0 2px 12px #000'}}>{shot.caption}</div>
  <div style={{position:'absolute',left:76,right:76,bottom:110,display:'flex',justifyContent:'space-between',fontSize:21,color:'#d2d8d0'}}><span>品类创意样片 · 非特定品牌 / 型号</span><span>0{index+1} / 05</span></div>
 </AbsoluteFill>;
}
export const RealProduct:React.FC<FilmProps>=(props)=>{let offset=0;const total=props.shots.reduce((n,s)=>n+Math.round(s.seconds*30),0);return <AbsoluteFill>{props.shots.map((shot,index)=>{const from=offset;const duration=Math.round(shot.seconds*30);offset+=duration;return <Sequence key={shot.id} from={from} durationInFrames={duration}><RealShot shot={shot} index={index}/></Sequence>})}{props.voice&&<Audio src={staticFile(props.voice)}/>} {props.music&&<Audio src={staticFile(props.music)} volume={f=>interpolate(f,[0,30,total-50,total],[0,0.32,0.32,0],{extrapolateLeft:'clamp',extrapolateRight:'clamp'})}/>}</AbsoluteFill>};
