import {reportAvailability} from './report-service.js';
let availability;
export async function reportLink(root,targetType,targetId,contextId='-',placement='after') {
 if(!root || !/^[A-Za-z0-9_-]{1,128}$/.test(targetId))return;
 try{availability??=reportAvailability();if(!await availability || !root.isConnected)return;}catch{return;}
 const a=document.createElement('a');a.href='/denunciar?'+new URLSearchParams({targetType,targetId,contextId});
 a.textContent=targetType==='profile'?'Denunciar perfil':targetType==='chat'?'Denunciar mensagem':'Denunciar live';a.className='btn';
 if(placement==='append')root.append(a);else root.insertAdjacentElement('afterend',a);
}
