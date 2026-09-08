import {auth,db,doc,getDoc,setDoc,serverTimestamp} from './firebase.js';
import {POLICY_RELEASE} from './policy-release.js';
let checkbox=null;
export async function prepareAcceptance(form) {
 if(!form)return;
 const note=document.createElement('p');note.className='muted';
 note.innerHTML='Consulte os <a href="/termos">Termos de Uso</a> e a <a href="/privacidade">Política de Privacidade</a>.';
 form.append(note);
 if(!POLICY_RELEASE.effective){note.append(document.createTextNode(' Documentos em preparação; ainda não é solicitado aceite desta minuta.'));return;}
 const label=document.createElement('label');label.className='checkbox-label';checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.name='policyAcceptance';checkbox.id='policy-acceptance';
 label.append(checkbox,document.createTextNode(' Li e concordo com os Termos de Uso e declaro ter ciência da Política de Privacidade.'));form.append(label);
}
export function requireAcceptanceBeforeSignup(){
 if(POLICY_RELEASE.effective && !checkbox?.checked)throw new Error('Leia os documentos e marque o aceite para continuar.');
}
export async function recordAcceptance(user){
 if(!POLICY_RELEASE.effective)return;
 const ref=doc(db,'policyAcceptances',user.uid,'versions',POLICY_RELEASE.version);
 if((await getDoc(ref)).exists())return;
 requireAcceptanceBeforeSignup();
 const c=await getDoc(doc(db,'governance','config'));
 if(!c.exists() || c.data().termsEffective!==true || c.data().termsVersion!==POLICY_RELEASE.version || c.data().privacyVersion!==POLICY_RELEASE.version)throw new Error('Não foi possível confirmar a versão vigente. Tente novamente mais tarde.');
 await setDoc(ref,{uid:user.uid,termsVersion:POLICY_RELEASE.version,privacyVersion:POLICY_RELEASE.version,acceptedAt:serverTimestamp()});
}
