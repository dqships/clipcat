"""Pack rendered PNGs into icon.icns, icon.ico and favicon.ico."""
import os
from PIL import Image
B=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','icon')+'/'
imgs={s:Image.open(f'{B}png/macos-{s}.png') for s in [16,32,64,128,256,512,1024]}
imgs[1024].save(B+'icon.icns',append_images=[imgs[s] for s in [16,32,64,128,256,512]])
sz=[16,24,32,48,64,128,256]
t={s:Image.open(f'{B}png/tile-{s}.png') for s in sz}
t[256].save(B+'icon.ico',sizes=[(s,s) for s in sz],append_images=[t[s] for s in sz[:-1]])
t[32].save(B+'favicon.ico',sizes=[(16,16),(32,32)],append_images=[t[16]])
imgs[1024].save(B+'icon.png')
