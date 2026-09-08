from pathlib import Path
import json, html
ROOT = Path(__file__).resolve().parents[1]
release=json.loads((ROOT/'governance/release.json').read_text())
(ROOT/'assets/js/policy-release.js').write_text('export const POLICY_RELEASE = Object.freeze('+json.dumps({'version': release['version'], 'effective': release['effective']})+');\n')
docs=json.loads((ROOT/'governance/policies.json').read_text())
e=html.escape
nav=''.join(f'<a href="/{d["slug"]}">{e(d["title"])}</a>' for d in docs)
header='<a class="skip-link" href="#principal">Pular para o conteúdo</a><header class="policy-header"><a class="brand" href="/index.html"><span class="brand-mark">Z</span> Zytrix</a><a href="/politicas">Segurança e políticas</a><a href="/index.html">Voltar às lives</a></header>'
footer=f'<footer class="policy-footer"><nav aria-label="Documentos da plataforma">{nav}</nav><a href="/politicas">Central de políticas</a></footer>'
notice='<p class="policy-notice"><strong>Versão em preparação.</strong> Estes documentos ainda não estão vigentes. Identificação do responsável, contato e política etária dependem de definição. Os recursos disponíveis e suas limitações estão indicados abaixo.</p>' if not release['effective'] else ''
def page(slug,title,description,body):
    canonical='https://zytrix-lives.vercel.app/'+slug
    return f'''<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>{e(title)} | Zytrix</title><meta name="description" content="{e(description, quote=True)}"><link rel="canonical" href="{canonical}"><meta name="robots" content="{'index,follow' if release['effective'] else 'noindex,follow'}"><link rel="stylesheet" href="/assets/css/styles.css"><link rel="stylesheet" href="/assets/css/policies.css"></head><body class="policy-page">{header}<main id="principal" tabindex="-1">{body}</main>{footer}</body></html>'''
for d in docs:
    toc='<nav class="policy-toc" aria-label="Índice desta página"><h2>Nesta página</h2><ol>'+''.join(f'<li><a href="#{s["id"]}">{e(s["title"])}</a></li>' for s in d['sections'])+'</ol></nav>'
    sections=''.join(f'<section id="{s["id"]}"><h2>{e(s["title"])}</h2>{s["body"]}</section>' for s in d['sections'])
    body=f'<div class="policy-heading"><p class="eyebrow">SEGURANÇA E POLÍTICAS</p><h1>{e(d["title"])}</h1><p>{e(d["description"])}</p><p class="policy-meta">Versão {e(release["version"])} · Última atualização: <time datetime="2026-09-08">8 de setembro de 2026</time></p>{notice}</div><div class="policy-layout">{toc}<article aria-label="{e(d["title"])}">{sections}<p><a href="#principal">Voltar ao início</a></p></article></div>'
    (ROOT/(d['slug']+'.html')).write_text(page(d['slug'],d['title'],d['description'],body))
links=''.join(f'<li><a href="/{d["slug"]}"><strong>{e(d["title"])}</strong></a><p>{e(d["description"])}</p></li>' for d in docs)
body=f'<div class="policy-heading"><p class="eyebrow">ZYTRIX</p><h1>Segurança e políticas</h1><p>Entenda as regras, o tratamento de dados e os limites atuais da plataforma.</p>{notice}</div><article class="policy-hub"><ul class="policy-directory">{links}</ul><section><h2>Precisa de ajuda?</h2><p>O formulário de denúncias está em preparação. Acesse <a href="/denunciar">Denunciar</a> para verificar a disponibilidade. Não envie senhas, documentos pessoais nem cópias de conteúdo ilegal.</p><p>Canal público de contato: <strong>[INFORMAÇÃO NECESSÁRIA ANTES DO LANÇAMENTO]</strong>.</p></section><section><h2>Versões dos documentos</h2><p>Esta é a primeira minuta, versão 1.0-draft. Não há histórico de versões vigentes. Cada versão publicada deve ser preservada e mudanças materiais devem ser comunicadas antes de novo aceite.</p></section></article>'
(ROOT/'politicas.html').write_text(page('politicas','Segurança e políticas','Termos, privacidade, diretrizes, conteúdo proibido e moderação do Zytrix.',body))
print('6 páginas geradas; status: '+('vigente' if release['effective'] else 'minuta não vigente'))
