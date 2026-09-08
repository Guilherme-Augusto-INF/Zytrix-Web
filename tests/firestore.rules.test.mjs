import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,getDocs,collection,query,where,limit,writeBatch,serverTimestamp,Timestamp,updateDoc,deleteDoc,runTransaction,increment} from 'firebase/firestore';
let env;
const uid='alice';
const as=(id,verified=true)=>env.authenticatedContext(id,{email_verified:verified}).firestore();
before(async()=>{assert.match(process.env.FIRESTORE_EMULATOR_HOST||'',/^(127\.0\.0\.1|localhost):\d+$/);env=await initializeTestEnvironment({projectId:'demo-zytrix-governance',firestore:{rules:readFileSync('firestore.rules','utf8')}});});
after(async()=>env?.cleanup());
beforeEach(async()=>{await env.clearFirestore();await env.withSecurityRulesDisabled(async c=>{const db=c.firestore();await Promise.all([setDoc(doc(db,'governance','config'),{reportsEnabled:true,rulesVersion:'governance-1',termsEffective:true,termsVersion:'1.0',privacyVersion:'1.0'}),setDoc(doc(db,'admins','admin'),{active:true}),setDoc(doc(db,'profiles','bob'),{uid:'bob'}),setDoc(doc(db,'profiles','alice'),{uid:'alice'}),setDoc(doc(db,'streams','live1'),{streamerUid:'bob',status:'offline'}),setDoc(doc(db,'streams','live1','chat','msg1'),{uid:'bob',text:'message'})]);});});
function report(db,id='r1',change={},who=uid,{lock=true,rate=true}={}){
 const d={reporterUid:who,targetType:'stream',targetId:'live1',contextId:'-',reason:'harassment',description:'Contexto',status:'open',createdAt:serverTimestamp(),...change};d.key=d.targetType+':'+d.contextId+':'+d.targetId;
 const b=writeBatch(db);b.set(doc(db,'reports',id),d);if(lock)b.set(doc(db,'reportKeys',who,'targets',d.key),{reportId:id,updatedAt:serverTimestamp()});if(rate)b.set(doc(db,'reportLimits',who),{reportId:id,lastAt:serverTimestamp()});return b.commit();
}
function close(db,id='r1',audit=true){const b=writeBatch(db);b.update(doc(db,'reports',id),{status:'closed',resolution:'no_violation',reviewedAt:serverTimestamp()});if(audit)b.set(doc(db,'moderationAudit',id),{reportId:id,action:'close_report',resolution:'no_violation',moderatorUid:'admin',createdAt:serverTimestamp()});return b.commit();}
test('ALLOW denúncia de live encerrada; titular lê protocolo',async()=>{await assertSucceeds(report(as(uid)));await assertSucceeds(getDoc(doc(as(uid),'reports','r1')));});
test('ALLOW perfil e mensagem; Unicode e HTML permanecem dados',async()=>{await assertSucceeds(report(as(uid),'r1',{targetType:'profile',targetId:'bob',description:'😢 <script>bad()</script>'}));await assertSucceeds(report(as('carol'),'r2',{targetType:'chat',targetId:'msg1',contextId:'live1'},'carol'));});
test('DENY anônimo e e-mail não verificado',async()=>{await assertFails(report(env.unauthenticatedContext().firestore()));await assertFails(report(as(uid,false)));});
test('DENY dados gigantes, alvo ausente, tipo/contexto inválido e auto-denúncia',async()=>{for(const data of [{description:'x'.repeat(1001)},{targetId:'missing'},{targetType:'profile',targetId:uid},{targetId:''},{targetType:'admin'},{contextId:'wrong'},{reason:'fake'},{status:'closed'},{resolution:'reviewed'}])await assertFails(report(as(uid),'r1',data));});
test('DENY alvo removido e autor inexistente não permite manipular reporterUid',async()=>{await assertFails(report(as(uid),'r1',{},'bob'));await env.withSecurityRulesDisabled(c=>deleteDoc(doc(c.firestore(),'streams','live1')));await assertFails(report(as(uid)));});
test('DENY criação sem rate limit ou trava de duplicidade',async()=>{await assertFails(report(as(uid),'r1',{},uid,{rate:false}));await assertFails(report(as(uid),'r1',{},uid,{lock:false}));});
test('DENY flood de alvos diferentes e denúncia duplicada',async()=>{await assertSucceeds(report(as(uid)));await assertFails(report(as(uid),'r2',{targetType:'profile',targetId:'bob'}));await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),'reportLimits',uid),{lastAt:Timestamp.fromMillis(1)}));await assertFails(report(as(uid),'r2'));});
test('ALLOW novo fato após conclusão; auditoria imutável',async()=>{await report(as(uid));await assertSucceeds(close(as('admin')));await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),'reportLimits',uid),{lastAt:Timestamp.fromMillis(1)}));await assertSucceeds(report(as(uid),'r2'));await assertFails(updateDoc(doc(as('admin'),'moderationAudit','r1'),{resolution:'reviewed'}));await assertFails(deleteDoc(doc(as('admin'),'moderationAudit','r1')));});
test('DENY IDOR, enumeração, listagem pública e dados internos',async()=>{await report(as(uid));for(const db of [as('bob'),env.unauthenticatedContext().firestore()]){await assertFails(getDoc(doc(db,'reports','r1')));await assertFails(getDocs(query(collection(db,'reports'),limit(30))));await assertFails(getDoc(doc(db,'reportLimits',uid)));await assertFails(getDoc(doc(db,'moderationAudit','r1')));}await assertSucceeds(getDocs(query(collection(as(uid),'reports'),where('reporterUid','==',uid),limit(30))));await assertFails(getDocs(collection(as(uid),'reports')));});
test('DENY decisão por usuário/moderador não provisionado, auto-promoção e config manipulável',async()=>{await report(as(uid));for(const id of [uid,'moderator'])await assertFails(close(as(id)));await assertFails(setDoc(doc(as(uid),'admins',uid),{active:true}));await assertFails(setDoc(doc(as(uid),'governance','config'),{reportsEnabled:true}));await assertFails(updateDoc(doc(as(uid),'reports','r1'),{status:'closed'}));});
test('DENY decisão sem auditoria; ALLOW fila admin limitada',async()=>{await report(as(uid));await assertFails(close(as('admin'),'r1',false));await assertSucceeds(getDocs(query(collection(as('admin'),'reports'),where('status','==','open'),limit(30))));await assertFails(getDocs(collection(as('admin'),'reports')));});
test('DENY recebimento desativado',async()=>{await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),'governance','config'),{reportsEnabled:false}));await assertFails(report(as(uid)));});
test('ALLOW aceite versionado; DENY falsificação, alteração e versão diferente',async()=>{const db=as(uid),ref=doc(db,'policyAcceptances',uid,'versions','1.0'),d={uid,termsVersion:'1.0',privacyVersion:'1.0',acceptedAt:serverTimestamp()};await assertSucceeds(setDoc(ref,d));await assertFails(setDoc(ref,d));await assertFails(setDoc(doc(db,'policyAcceptances','bob','versions','1.0'),{...d,uid:'bob'}));await assertFails(setDoc(doc(db,'policyAcceptances',uid,'versions','9.0'),{...d,termsVersion:'9.0'}));});
test('DENY aceite de minuta ou timestamp do cliente',async()=>{await assertFails(setDoc(doc(as(uid),'policyAcceptances',uid,'versions','1.0'),{uid,termsVersion:'1.0',privacyVersion:'1.0',acceptedAt:Timestamp.fromMillis(1)}));await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),'governance','config'),{termsEffective:false}));await assertFails(setDoc(doc(as(uid),'policyAcceptances',uid,'versions','1.0'),{uid,termsVersion:'1.0',privacyVersion:'1.0',acceptedAt:serverTimestamp()}));});
test('DENY corridas concorrentes: apenas um envio sobrevive',async()=>{const results=await Promise.allSettled([report(as(uid),'race1'),report(as(uid),'race2')]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);});


test('ALLOW alerta público somente quando acompanha apoio atômico válido',async()=>{
  const old=Timestamp.fromMillis(1);
  await env.withSecurityRulesDisabled(async c=>{
    const db=c.firestore();
    await setDoc(doc(db,'streams','live1'),{streamerUid:'bob',channelId:'bob',title:'Live',description:'',categoryId:'Games',thumbnailURL:'',status:'live',playbackURL:'https://www.twitch.tv/example',startedAt:old,endedAt:null,createdAt:old,viewerCount:0});
    await setDoc(doc(db,'wallets','alice'),{uid:'alice',balance:500,totalSent:0,totalReceived:0,lastTransactionId:'seed-a',createdAt:old,updatedAt:old});
    await setDoc(doc(db,'wallets','bob'),{uid:'bob',balance:500,totalSent:0,totalReceived:0,lastTransactionId:'seed-b',createdAt:old,updatedAt:old});
  });
  const db=as('alice');
  const senderRef=doc(db,'wallets','alice');
  const recipientRef=doc(db,'wallets','bob');
  const txRef=doc(db,'zyCoinTransactions','support1');
  const alertRef=doc(db,'streams','live1','supportAlerts','support1');
  await assertSucceeds(runTransaction(db,async tx=>{
    const sender=await tx.get(senderRef);
    tx.update(senderRef,{balance:450,totalSent:50,totalReceived:0,lastTransactionId:'support1',updatedAt:serverTimestamp()});
    tx.update(recipientRef,{balance:increment(50),totalReceived:increment(50),lastTransactionId:'support1',updatedAt:serverTimestamp()});
    tx.set(txRef,{transactionId:'support1',fromUid:'alice',toUid:'bob',streamId:'live1',amount:50,type:'stream_support',status:'completed',createdAt:serverTimestamp()});
    tx.set(alertRef,{transactionId:'support1',fromUid:'alice',streamId:'live1',amount:50,createdAt:serverTimestamp()});
  }));
  await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(),'streams','live1','supportAlerts','support1')));
  await assertFails(setDoc(doc(as('carol'),'streams','live1','supportAlerts','fake'),{transactionId:'fake',fromUid:'carol',streamId:'live1',amount:50,createdAt:serverTimestamp()}));
  await assertFails(updateDoc(alertRef,{amount:500}));
  await assertFails(deleteDoc(alertRef));
});

test('ALLOW streamer configurar som e 18+; DENY som fora da lista',async()=>{
  const old=Timestamp.fromMillis(1);
  await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'streams','live1'),{streamerUid:'bob',channelId:'bob',title:'Live',description:'',categoryId:'Games',thumbnailURL:'',status:'offline',playbackURL:'https://www.twitch.tv/example',startedAt:null,endedAt:null,createdAt:old,viewerCount:0}));
  const ref=doc(as('bob'),'streams','live1');
  await assertSucceeds(updateDoc(ref,{supportAlertSound:'bell',matureContent:true}));
  await assertFails(updateDoc(ref,{supportAlertSound:'remote-url'}));
  await assertFails(updateDoc(ref,{matureContent:'yes'}));
});


test('ALLOW apoio cria carteira ausente sem ler saldo do destinatário',async()=>{
  const old=Timestamp.fromMillis(1);
  await env.withSecurityRulesDisabled(async c=>{const db=c.firestore();await setDoc(doc(db,'streams','live1'),{streamerUid:'bob',channelId:'bob',title:'Live',description:'',categoryId:'Games',thumbnailURL:'',status:'live',playbackURL:'https://www.twitch.tv/example',startedAt:old,endedAt:null,createdAt:old,viewerCount:0});await setDoc(doc(db,'wallets','alice'),{uid:'alice',balance:500,totalSent:0,totalReceived:0,lastTransactionId:'seed-a',createdAt:old,updatedAt:old});});
  const db=as('alice'),senderRef=doc(db,'wallets','alice'),recipientRef=doc(db,'wallets','bob'),txRef=doc(db,'zyCoinTransactions','support-new-wallet'),alertRef=doc(db,'streams','live1','supportAlerts','support-new-wallet');
  await assertFails(getDoc(recipientRef));
  await assertSucceeds(runTransaction(db,async tx=>{await tx.get(senderRef);tx.update(senderRef,{balance:475,totalSent:25,totalReceived:0,lastTransactionId:'support-new-wallet',updatedAt:serverTimestamp()});tx.set(recipientRef,{uid:'bob',balance:525,totalSent:0,totalReceived:25,lastTransactionId:'support-new-wallet',createdAt:serverTimestamp(),updatedAt:serverTimestamp()});tx.set(txRef,{transactionId:'support-new-wallet',fromUid:'alice',toUid:'bob',streamId:'live1',amount:25,type:'stream_support',status:'completed',createdAt:serverTimestamp()});tx.set(alertRef,{transactionId:'support-new-wallet',fromUid:'alice',streamId:'live1',amount:25,createdAt:serverTimestamp()});}));
  await env.withSecurityRulesDisabled(async c=>{const snap=await getDoc(doc(c.firestore(),'wallets','bob'));assert.equal(snap.data().balance,525);assert.equal(snap.data().totalReceived,25);});
});
