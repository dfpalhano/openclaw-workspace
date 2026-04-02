#!/usr/bin/env python3
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image as RLImage
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_JUSTIFY
from reportlab.lib import colors
import os

out='/home/diegopalhano/projects/mission-control/data/occupancy-letters/SH1_rebecca_barringer_custom_20260327.pdf'
sig='/home/diegopalhano/projects/mission-control/data/natalie-signature.png'

doc = SimpleDocTemplate(out,pagesize=A4,leftMargin=25*mm,rightMargin=25*mm,topMargin=20*mm,bottomMargin=20*mm)
styles=getSampleStyleSheet()
bold=ParagraphStyle('bold', fontName='Helvetica-Bold', fontSize=11, leading=16)
normal=ParagraphStyle('normal', fontName='Helvetica', fontSize=11, leading=16)
subj=ParagraphStyle('subj', fontName='Helvetica-Bold', fontSize=11, leading=16, spaceAfter=10)
body=ParagraphStyle('body', fontName='Helvetica', fontSize=11, leading=18, spaceAfter=12, alignment=TA_JUSTIFY)

story=[]
story.append(Paragraph('<b>Natalie Mosh</b>', bold))
story.append(Paragraph('40 Rosa St,<br/>Spring Hill QLD 4000', normal))
story.append(Paragraph('Australia', normal))
story.append(Spacer(1, 6*mm))
story.append(Paragraph('Date: 27th March 2026', normal))
story.append(Spacer(1, 6*mm))
story.append(Paragraph('To Whom It May Concern,', normal))
story.append(Spacer(1, 4*mm))
story.append(Paragraph('<b>Subject: Confirmation of Occupancy – Ms Rebecca Barringer</b>', subj))

paras = [
"I confirm that Ms Rebecca Barringer stays at 40 Rosa St, Spring Hill QLD 4000, Australia, within a privately managed household environment, and has been present at the address from 11/01/2026 and remains associated with the address as at 27th March 2026.",
"During this time, Ms Rebecca Barringer occupied the premises under a Private Occupancy Licence, contributing weekly toward shared household and operational costs. We also confirm that she contributed a Security Contribution of $925, which is currently held in our custody and remains subject to the terms of the House Rules and the Private Occupancy Licence, including any applicable conditions relating to deductions, cleaning, damages, outstanding amounts, and exit requirements.",
"This arrangement did not constitute a residential tenancy, lease, or rooming accommodation agreement, and did not grant exclusive possession of any part of the premises. The Security Contribution referred to above is held under the private occupancy arrangement and is not an RTA bond lodgement.",
"This letter is provided solely to confirm the above period of presence at the address and the existence of the private occupancy arrangement for identification or administrative purposes, such as documentation or application requirements. It is not intended to create, confirm, or imply any tenancy rights, bond registration status, or ongoing residential status beyond the terms of the applicable House Rules and Private Occupancy Licence.",
"Should further verification be required, I can be contacted at nataliemosh68@outlook.com or +61 410 076 937."
]
for p in paras:
    story.append(Paragraph(p, body))

story.append(Spacer(1, 6*mm))
story.append(Paragraph('Sincerely,', normal))
story.append(Spacer(1, 3*mm))
if os.path.exists(sig):
    img=RLImage(sig, width=44*mm, height=14*mm)
    img.hAlign='LEFT'
    story.append(img)
story.append(Paragraph('<b>Natalie Mosh</b>', bold))

doc.build(story)
print(out)
