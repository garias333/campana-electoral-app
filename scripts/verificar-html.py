"""Revisa el balance de etiquetas HTML y extrae el JS embebido para poder
pasarle `node --check`. Un tag mal cerrado en un archivo de 2.000 lineas no
se nota sin renderizar, y aqui no hay navegador."""
import re, sys, subprocess, tempfile, os, glob, shutil, pwd

VACIAS = {'area','base','br','col','embed','hr','img','input','link','meta',
          'param','source','track','wbr'}


def buscar_node():
    """nvm instala node por usuario, asi que no esta en el PATH minimo de un
    cron ni en el de otra cuenta. Se busca en el PATH y, si no esta, entre las
    versiones que nvm haya dejado en los directorios personales.

    Los directorios se piden al sistema con `pwd`, no con un comodin sobre
    /home: ese directorio es drwx-----x, o sea que se puede *entrar* pero no
    *listar*, y el comodin devuelve vacio aunque la ruta exacta si exista."""
    ruta = shutil.which('node')
    if ruta:
        return ruta
    candidatos = [os.path.expanduser('~')]
    try:
        candidatos += [u.pw_dir for u in pwd.getpwall() if u.pw_dir.startswith('/home/')]
    except Exception:
        pass
    for hogar in dict.fromkeys(candidatos):
        encontrados = sorted(glob.glob(os.path.join(hogar, '.nvm/versions/node/*/bin/node')))
        if encontrados:
            return encontrados[-1]
    if os.path.exists('/usr/local/bin/node'):
        return '/usr/local/bin/node'
    sys.exit('No se encontro node. Exporte su PATH de nvm antes de correr esto.')


NODE = buscar_node()

def revisar(ruta):
    crudo = open(ruta, encoding='utf-8').read()

    # 1) JS embebido -> node --check
    scripts = re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', crudo, re.S)
    for i, js in enumerate(scripts):
        with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f:
            f.write(js); tmp = f.name
        r = subprocess.run([NODE, '--check', tmp], capture_output=True, text=True)
        os.unlink(tmp)
        if r.returncode != 0:
            print(f'  ✗ JS bloque {i+1}: {r.stderr.strip().splitlines()[0] if r.stderr else "error"}')
            return False

    # 2) Balance de etiquetas, ignorando scripts/estilos/comentarios
    texto = re.sub(r'<script.*?</script>', '', crudo, flags=re.S)
    texto = re.sub(r'<style.*?</style>', '', texto, flags=re.S)
    texto = re.sub(r'<!--.*?-->', '', texto, flags=re.S)

    pila = []
    for m in re.finditer(r'<(/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*?)(/?)>', texto):
        cierre, tag, attrs, autocierre = m.group(1), m.group(2).lower(), m.group(3), m.group(4)
        if tag in VACIAS or autocierre == '/':
            continue
        linea = texto[:m.start()].count('\n') + 1
        if cierre:
            if not pila:
                print(f'  ✗ </{tag}> sobra en la linea {linea}')
                return False
            abierto, l_ab = pila.pop()
            if abierto != tag:
                print(f'  ✗ linea {linea}: se cierra </{tag}> pero lo abierto era <{abierto}> (linea {l_ab})')
                return False
        else:
            pila.append((tag, linea))
    if pila:
        print(f'  ✗ quedaron sin cerrar: {[(t, l) for t, l in pila]}')
        return False
    return True

ok = True
for ruta in sys.argv[1:]:
    print(f'{ruta}:')
    if revisar(ruta):
        print('  ✓ JS valido y etiquetas balanceadas')
    else:
        ok = False
sys.exit(0 if ok else 1)
