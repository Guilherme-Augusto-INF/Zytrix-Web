from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit
import json, subprocess
root=Path(__file__).resolve().parents[1]
class Parser(HTMLParser):
 def __init__(self):super().__init__();self.refs=[];self.ids=[];self.h1=0
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  if a.get('id'):self.ids.append(a['id'])
  if tag=='h1':self.h1+=1
  if tag in ['a','script','link']:
   ref=a.get('href',a.get('src',''))
   if ref:self.refs.append(ref)
errors=[];routes={i['source']:i['destination'] for i in json.loads((root/'vercel.json').read_text())['rewrites']}
for slug in ['termos','privacidade','diretrizes-da-comunidade','denuncias-e-moderacao','conteudo-proibido','politicas','denunciar','moderacao']:
 p=root/(slug+'.html');parser=Parser();parser.feed(p.read_text())
 if parser.h1!=1:errors.append(f'{slug}: h1')
 if len(parser.ids)!=len(set(parser.ids)):errors.append(f'{slug}: duplicate ids')
 for ref in parser.refs:
  u=urlsplit(ref)
  if u.scheme or u.netloc:continue
  if not u.path:
   if u.fragment and u.fragment not in parser.ids:errors.append(f'{slug}: {ref}')
   continue
  target=routes.get(u.path,u.path)
  if not (root/target.lstrip('/')).exists():errors.append(f'{slug}: missing {ref}')
for f in (root/'assets/js').glob('*.js'):
 r=subprocess.run(['node','--check',str(f)],capture_output=True,text=True)
 if r.returncode:errors.append(r.stderr)
assert (root/'firestore.rules').read_bytes()==(root/'firebase/firestore.rules').read_bytes()==(root/'REGRAS-PARA-COLAR-NO-FIREBASE.txt').read_bytes()
if errors:raise SystemExit('\n'.join(errors))
print('PASS: JS syntax, policy routes, local links, anchors, headings, rules copies')
