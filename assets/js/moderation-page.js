import {auth,db,onAuthStateChanged,doc,getDoc,getDocs,collection,query,where,limit} from './firebase.js';
import {header,footer} from './ui.js';
import {REASONS,RESOLUTIONS} from './report-model.js';
import {closeReport} from './report-service.js';
header();footer();
const root=document.querySelector('#moderation-root');let generation=0;
async function load(version){
 const snap=await getDocs(query(collection(db,'reports'),where('status','==','open'),limit(30)));
 if(generation!==version)return;
 root.replaceChildren();
 if(snap.empty){root.textContent='Nenhuma denúncia em aberto nesta consulta.';return;}
 for(const item of snap.docs){
  const d=item.data(),section=document.createElement('section');section.className='moderation-record';
  const h=document.createElement('h2');h.textContent=REASONS[d.reason]||'Denúncia';section.append(h);
  for(const text of [`Protocolo: ${item.id}`,`Alvo: ${d.targetType} / ${d.contextId} / ${d.targetId}`,`Recebida: ${d.createdAt?.toDate?.().toLocaleString('pt-BR')||'Data indisponível'}`,d.description||'Sem relato adicional.']){const p=document.createElement('p');p.textContent=text;section.append(p);}
  const label=document.createElement('label');label.textContent='Resultado da análise';const select=document.createElement('select');select.className='input';for(const [value,text]of Object.entries(RESOLUTIONS))select.add(new Option(text,value));label.append(select);section.append(label);
  const checkLabel=document.createElement('label'),check=document.createElement('input');check.type='checkbox';checkLabel.append(check,document.createTextNode(' Analisei a referência e as regras antes de registrar o resultado.'));section.append(checkLabel);
  const b=document.createElement('button');b.className='btn';b.textContent='Registrar decisão';const status=document.createElement('p');status.setAttribute('role','status');section.append(b,status);
  b.addEventListener('click',async()=>{if(!check.checked){status.textContent='Confirme a análise antes de concluir.';return;}b.disabled=true;try{await closeReport(item.id,select.value);await load(version);}catch{status.textContent='Decisão não confirmada. Atualize a fila antes de tentar novamente.';b.disabled=false;}});
  root.append(section);
 }
 const refresh=document.createElement('button');refresh.className='btn';refresh.textContent='Atualizar fila (até 30 por consulta)';refresh.onclick=()=>load(version).catch(()=>{root.textContent='Fila indisponível.';});root.append(refresh);
}
onAuthStateChanged(auth,async user=>{const version=++generation;root.replaceChildren();if(!user){root.textContent='Entre com uma conta administrativa.';return;}try{const s=await getDoc(doc(db,'admins',user.uid));if(generation!==version)return;if(!s.exists()||s.data().active!==true){root.textContent='Acesso restrito à administração.';return;}await load(version);}catch{if(generation===version)root.textContent='Não foi possível carregar a fila administrativa.';}});
