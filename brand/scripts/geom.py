import math
CX,CY,R,r,ANG=50,58,32,14,40
TIP=(24,9); INNER=118
def P(deg,rad=R): a=math.radians(deg); return (CX+rad*math.cos(a), CY-rad*math.sin(a))
def ang_of(p): return math.degrees(math.atan2(-(p[1]-CY),p[0]-CX))%360
def tangent(tip):
    dx,dy=tip[0]-CX,tip[1]-CY; d=math.hypot(dx,dy); base=math.atan2(-dy,dx); off=math.acos(R/d)
    return P(math.degrees(base+off))
def inter(p1,d1,p2,p3):
    # ray p1 + t*d1 with segment p2->p3
    ex,ey=p3[0]-p2[0],p3[1]-p2[1]; den=d1[0]*ey-d1[1]*ex
    t=((p2[0]-p1[0])*ey-(p2[1]-p1[1])*ex)/den; return (p1[0]+t*d1[0],p1[1]+t*d1[1])
tL=tangent(TIP); iL=P(INNER)
mir=lambda p:(100-p[0],p[1])
tipR,tR,iR=mir(TIP),mir(tL),mir(iL)
a=math.radians(ANG); d=(math.cos(a),-math.sin(a))
X=inter((CX,CY),d,tipR,tR)
f=lambda p:f'{p[0]:.3f} {p[1]:.3f}'
cU,cD=P(ANG,r),P(-ANG,r); oD=P(-ANG)
PATH=(f'M{f(cU)} L{f(X)} L{f(tipR)} L{f(iR)} A{R} {R} 0 0 0 {f(iL)} L{f(TIP)} L{f(tL)} '
      f'A{R} {R} 0 0 0 {f(oD)} L{f(cD)} A{r} {r} 0 1 1 {f(cU)} Z')
if __name__=="__main__": print(PATH, ang_of(tL), ang_of(tR))
