import os, math
from geom import PATH
from wordmark import text_path, CAP
OUT=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..')
INK="#17150F"; PAPER="#FAF8F3"; YEL="#F2B705"
# mark bbox in 100-grid
BX0,BY0,BX1,BY1=18,9,79.137,90
BW,BH=BX1-BX0,BY1-BY0
os.makedirs(f'{OUT}/logo',exist_ok=True); os.makedirs(f'{OUT}/icon/png',exist_ok=True)
def w(p,s): open(f'{OUT}/{p}','w').write(s)
def svg(vb,body,title='ClipCat'):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}"><title>{title}</title>{body}</svg>\n'
# small-size variant: bigger counter so it stays open at 16-32 px
import geom, importlib
def path_with(r=None):
    if r is None: return PATH
    geom.r=r; src=open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'geom.py')).read().replace('CX,CY,R,r,ANG=50,58,32,14,40',f'CX,CY,R,r,ANG=50,58,32,{r},40')
    ns={}; exec(src.replace('if __name__','if False and __name__'),ns); return ns['PATH']
SMALL=path_with(15.5)
pad=2
vb=f'{BX0-pad} {BY0-pad} {BW+2*pad:.3f} {BH+2*pad}'
for name,c in [('ink',INK),('white',PAPER),('yellow',YEL)]:
    w(f'logo/clipcat-mark-{name}.svg',svg(vb,f'<path fill="{c}" d="{PATH}"/>'))
# lockup: mark height = 1.55 x cap height, mark bottom sits at baseline + small overshoot
d,adv=text_path('ClipCat')
s=CAP*1.55/BH            # font units per grid unit
gap=CAP*0.32
mw=BW*s
tx=mw+gap
H_top=-BH*s
def lockup(c):
    return (f'<g fill="{c}"><path transform="translate({-BX0*s:.2f} {-BY1*s+CAP*0.012:.2f}) scale({s:.4f})" d="{PATH}"/>'
            f'<path transform="translate({tx:.2f} 0)" d="{d}"/></g>')
lvb=f'{-CAP*0.1:.1f} {H_top-CAP*0.1:.1f} {tx+adv+CAP*0.2:.1f} {BH*s+CAP*0.25:.1f}'
for name,c in [('ink',INK),('white',PAPER)]:
    w(f'logo/clipcat-lockup-{name}.svg',svg(lvb,lockup(c)))
    w(f'logo/clipcat-wordmark-{name}.svg',svg(f'-20 {-CAP-40} {adv+40} {CAP+60}',f'<path fill="{c}" d="{d}"/>'))
# icons
def placed(path,box,cx,cy,c=INK):
    k=box/BH; x=cx-(BX0+BW/2)*k; y=cy-(BY0+BH/2)*k
    return f'<path fill="{c}" transform="translate({x:.2f} {y:.2f}) scale({k:.4f})" d="{path}"/>'
mac=(f'<defs><filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000" flood-opacity=".28"/></filter></defs>'
     f'<rect x="100" y="100" width="824" height="824" rx="185.4" fill="{YEL}" filter="url(#s)"/>'+placed(PATH,470,512,520))
w('icon/clipcat-icon-macos.svg',svg('0 0 1024 1024',mac))
tile=f'<rect width="1024" height="1024" rx="184" fill="{YEL}"/>'+placed(PATH,600,512,522)
w('icon/clipcat-icon-tile.svg',svg('0 0 1024 1024',tile))
small=f'<rect width="1024" height="1024" rx="184" fill="{YEL}"/>'+placed(SMALL,720,512,526)
w('icon/clipcat-icon-tile-small.svg',svg('0 0 1024 1024',small))
w('icon/favicon.svg',svg('0 0 1024 1024',small))
square=f'<rect width="1024" height="1024" fill="{YEL}"/>'+placed(PATH,560,512,522)
w('icon/clipcat-icon-square.svg',svg('0 0 1024 1024',square))
print('ok')
