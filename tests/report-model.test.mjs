import test from 'node:test';
import assert from 'node:assert/strict';
import {validateReport,reportKey,targetPath} from '../assets/js/report-model.js';
const valid={targetType:'stream',targetId:'stream-1',contextId:'-',reason:'harassment',description:'Contexto'};
test('Unicode e HTML são dados e não alteram a referência',()=>{const d=validateReport({...valid,description:'Ameaça 😢 <script>alert(1)</script>'});assert.equal(d.description,'Ameaça 😢 <script>alert(1)</script>');assert.deepEqual(targetPath(d),['streams','stream-1']);});
test('IDs, tipo, contexto, motivos e tamanho inválidos são recusados',()=>{for(const change of [{targetId:''},{targetId:'../private'},{targetId:'https://evil.example'},{targetType:'admins'},{contextId:'wrong'},{reason:'__proto__'},{description:'a'.repeat(1001)}])assert.throws(()=>validateReport({...valid,...change}));});
test('referências distintas têm chaves distintas',()=>{assert.notEqual(reportKey(valid),reportKey({...valid,targetType:'profile'}));assert.deepEqual(targetPath({...valid,targetType:'chat',contextId:'live1'}),['streams','live1','chat','stream-1']);});
