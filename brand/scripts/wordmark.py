import os
import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
blob=hb.Blob.from_file_path(os.environ.get('JOST_TTF','Jost.ttf')); face=hb.Face(blob); font=hb.Font(face); font.set_variations({'wght':600})
upem=face.upem
def text_path(txt,track=-0.01):
    buf=hb.Buffer(); buf.add_str(txt); buf.guess_segment_properties(); hb.shape(font,buf,{"kern":True,"liga":True})
    pen=SVGPathPen(None); x=0
    for info,pos in zip(buf.glyph_infos,buf.glyph_positions):
        tp=TransformPen(pen,(1,0,0,-1,x+pos.x_offset,-pos.y_offset)); font.draw_glyph_with_pen(info.codepoint,tp)
        x+=pos.x_advance+track*upem
    return pen.getCommands(), x-track*upem
ext=font.get_glyph_extents(font.get_nominal_glyph(ord('C')))
CAP=ext.y_bearing  # height of C incl overshoot
if __name__=="__main__": print(upem,CAP,text_path('ClipCat')[1])
