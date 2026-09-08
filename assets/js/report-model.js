export const REASONS = Object.freeze({child_safety:'Proteção de crianças e adolescentes',sexual:'Conteúdo sexual ou íntimo',violence:'Violência ou ameaça',hate:'Ódio ou discriminação',harassment:'Assédio ou bullying',privacy:'Exposição de dados',self_harm:'Incentivo à automutilação',fraud:'Golpe ou fraude',malware:'Malware ou abuso técnico',spam:'Spam ou manipulação',copyright:'Direitos autorais',impersonation:'Identidade falsa',other:'Outra regra da comunidade'});
const ID = /^[A-Za-z0-9_-]{1,128}$/;
export function validateReport(input) {
  const {targetType,targetId,contextId,reason} = input;
  const description=String(input.description || '').trim();
  if (!['profile','stream','chat'].includes(targetType) || !ID.test(targetId || '')) throw new Error('Referência inválida.');
  if (!ID.test(contextId || '') || (targetType !== 'chat' && contextId !== '-')) throw new Error('Contexto inválido.');
  if (!Object.hasOwn(REASONS,reason)) throw new Error('Escolha um motivo válido.');
  if ([...description].length>1000) throw new Error('Use até 1.000 caracteres no relato.');
  return {targetType,targetId,contextId,reason,description};
}
export function reportKey(data) {return `${data.targetType}:${data.contextId}:${data.targetId}`;}
export function targetPath(data) {
  if(data.targetType==='profile') return ['profiles',data.targetId];
  if(data.targetType==='stream') return ['streams',data.targetId];
  return ['streams',data.contextId,'chat',data.targetId];
}
export const RESOLUTIONS = Object.freeze({no_violation:'Nenhuma violação identificada',insufficient:'Informações insuficientes',target_unavailable:'Alvo indisponível',reviewed:'Análise concluída; sem ação automática'});
