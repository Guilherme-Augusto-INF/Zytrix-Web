import {auth,db,onAuthStateChanged,collection,query,where,limit,getDocs} from './firebase.js';
import {header,footer} from './ui.js';
import {REASONS,RESOLUTIONS} from './report-model.js';
import {reportAvailability,submitReport} from './report-service.js';
header();footer();
const form=document.querySelector('#report-form'), fields=document.querySelector('#report-fields'), message=document.querySelector('#report-status'), mine=document.querySelector('#my-reports');
const params=new URLSearchParams(location.search);
for(const name of ['targetType','targetId','contextId']) if(params.has(name)) form.elements[name].value=params.get(name);
for(const [value,label] of Object.entries(REASONS)){const option=new Option(label,value);form.elements.reason.add(option);}
function contextState(){form.elements.contextId.closest('label').hidden=form.elements.targetType.value!=='chat';if(form.elements.targetType.value!=='chat')form.elements.contextId.value='-';}
form.elements.targetType.addEventListener('change',contextState);contextState();
let sending=false, generation=0;
async function ownReports(user,version){
 const snapshot=await getDocs(query(collection(db,'reports'),where('reporterUid','==',user.uid),limit(30)));
 if(generation!==version)return;
 mine.replaceChildren();
 for(const item of snapshot.docs){const p=document.createElement('p'),d=item.data();p.textContent=`${item.id} · ${d.targetType}: ${d.targetId} · ${d.status==='closed'?(RESOLUTIONS[d.resolution]||'Concluída'):'Recebida, aguardando análise'}`;mine.append(p);}
 if(snapshot.empty)mine.textContent='Nenhum envio encontrado.';
}
onAuthStateChanged(auth,async user=>{
 const version=++generation;fields.disabled=true;mine.replaceChildren();
 if(!user){message.textContent='Entre na sua conta para verificar a disponibilidade do envio.';return;}
 try{const available=await reportAvailability();if(generation!==version)return;
 fields.disabled=!available || !user.emailVerified;
 message.textContent=!available?'O recebimento de denúncias ainda não está ativo. Nenhum relato será enviado.':!user.emailVerified?'Verifique seu e-mail para enviar uma denúncia.':'Envio disponível. Recebimento não significa análise imediata.';
 if(available)await ownReports(user,version);
 }catch{if(generation===version)message.textContent='Não foi possível confirmar a disponibilidade. Nenhuma denúncia foi enviada.';}
});
form.addEventListener('submit',async event=>{
 event.preventDefault();if(sending || fields.disabled)return;
 sending=true;const button=form.querySelector('button[type=submit]');button.disabled=true;
 message.textContent='Enviando. Aguarde a confirmação antes de tentar novamente.';
 try{const id=await submitReport(Object.fromEntries(new FormData(form)));message.textContent=`Denúncia recebida. Protocolo: ${id}. A análise ainda não foi realizada.`;form.elements.description.value='';if(auth.currentUser)await ownReports(auth.currentUser,generation);}
 catch(error){message.textContent=error.code?'Não foi possível confirmar o envio. Consulte seus envios antes de tentar novamente.':error.message;}
 finally{sending=false;button.disabled=false;}
});
