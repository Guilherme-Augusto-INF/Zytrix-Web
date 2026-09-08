import {auth,db,doc,collection,getDoc,runTransaction,serverTimestamp} from './firebase.js';
import {validateReport,reportKey,targetPath,RESOLUTIONS} from './report-model.js';
export async function reportAvailability() {
  const s=await getDoc(doc(db,'governance','config'));
  return s.exists() && s.data().reportsEnabled===true && s.data().rulesVersion==='governance-1';
}
export async function submitReport(input) {
  const user=auth.currentUser;
  if(!user) throw new Error('Entre na sua conta para denunciar.');
  await user.reload();
  if(!user.emailVerified) throw new Error('Verifique seu e-mail antes de enviar.');
  await user.getIdToken(true);
  const data=validateReport(input);
  const key=reportKey(data);
  const reportRef=doc(collection(db,'reports'));
  const lockRef=doc(db,'reportKeys',user.uid,'targets',key);
  const rateRef=doc(db,'reportLimits',user.uid);
  await runTransaction(db,async tx=>{
    const [config,target,lock,rate]=await Promise.all([tx.get(doc(db,'governance','config')),tx.get(doc(db,...targetPath(data))),tx.get(lockRef),tx.get(rateRef)]);
    if(!config.exists() || config.data().reportsEnabled!==true || config.data().rulesVersion!=='governance-1') throw new Error('Recebimento de denúncias ainda não está ativo.');
    if(!target.exists()) throw new Error('Referência indisponível ou removida. Nenhuma denúncia foi enviada.');
    const owner=data.targetType==='profile'?data.targetId:data.targetType==='stream'?target.data().streamerUid:target.data().uid;
    if(owner===user.uid) throw new Error('Não é possível denunciar a si próprio.');
    if(lock.exists()) {
      const previous=await tx.get(doc(db,'reports',lock.data().reportId));
      if(previous.exists() && previous.data().status!=='closed') throw new Error('Já existe uma denúncia sua em aberto para esta referência.');
    }
    if(rate.exists() && Date.now()-(rate.data().lastAt?.toMillis()||0)<60000) throw new Error('Aguarde um minuto entre envios.');
    tx.set(reportRef,{...data,reporterUid:user.uid,key,status:'open',createdAt:serverTimestamp()});
    tx.set(lockRef,{reportId:reportRef.id,updatedAt:serverTimestamp()});
    tx.set(rateRef,{reportId:reportRef.id,lastAt:serverTimestamp()});
  });
  return reportRef.id;
}
export async function closeReport(id,resolution) {
  if(!Object.hasOwn(RESOLUTIONS,resolution)) throw new Error('Resultado inválido.');
  const user=auth.currentUser;
  if(!user) throw new Error('Sessão encerrada.');
  const ref=doc(db,'reports',id), audit=doc(db,'moderationAudit',id);
  await runTransaction(db,async tx=>{
    const snap=await tx.get(ref);
    if(!snap.exists() || snap.data().status!=='open') throw new Error('Esta denúncia já foi concluída ou está indisponível.');
    tx.update(ref,{status:'closed',resolution,reviewedAt:serverTimestamp()});
    tx.set(audit,{reportId:id,action:'close_report',resolution,moderatorUid:user.uid,createdAt:serverTimestamp()});
  });
}
