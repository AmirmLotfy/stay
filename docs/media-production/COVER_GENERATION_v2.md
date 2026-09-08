# STAY cover generation v2

Generated on 2026-09-08 with the built-in OpenAI image-generation tool, then composed with repository-native SVG overlays so the STAY mark and every visible word remain exact.

## Design evidence

- The live Devpost editor requests a 3:2 image and accepts JPG, PNG, or GIF files up to 5 MB. The final cover is 1500x1000 JPG.
- YouTube's video-details editor calls for a standout thumbnail. The final thumbnail uses the dependable 1280x720 16:9 canvas, one focal subject, short high-contrast copy, and a 212 KB JPG.
- Visual references reviewed before generation favored one clear focal point over interface collages. STAY's own open-threshold mark, forest/ivory/terracotta palette, and calm editorial product tone remained the governing references.

## YouTube background prompt

```text
Use case: ads-marketing
Asset type: premium YouTube thumbnail background, designed for final 16:9 crop
Primary request: Create a cinematic editorial image for STAY, an accessible independent-living and trusted-circle coordination product. Build a visual metaphor around an open domestic threshold connecting two calm spaces: an elegant older woman at home on the right, seen naturally and confidently rather than as a patient, with warm morning light; a subtle terracotta path of light travels through a deep forest-green open doorway toward her. The left 45 percent must be simple dark-green negative space reserved for a short headline and exact brand lockup to be added later.
Input images: the STAY open-threshold logo is the identity reference; a real STAY product screenshot is used only for color palette and calm editorial tone, never to recreate or invent interface text.
Style/medium: high-end editorial campaign photography blended with restrained architectural graphic design; human, calm, credible, warm, award-entry quality.
Composition/framing: one clear focal person on the right, open doorway motif behind; bold readable silhouette at small thumbnail size; spacious left side; no clutter.
Lighting/mood: warm morning window light, quiet confidence, connection without surveillance or alarm.
Color palette: deep forest green, warm ivory, muted terracotta, soft sage; avoid bright tech blue and neon.
Text: no text at all.
Constraints: no logo, typography, screens, UI, devices, medical equipment, emergency imagery, Alexa hardware, or caregiver uniform; leave clean areas for deterministic overlays.
Avoid: generic stock-photo smiles, dramatic crisis, hospital cues, glowing sci-fi network lines, robot imagery, dashboard collage, synthetic gradients, watermarks.
```

## Devpost background prompt

```text
Use case: ads-marketing
Asset type: premium Devpost project cover background, designed for final 3:2 crop
Primary request: Create a distinctive visual poster background for STAY, an accessible independent-living and trusted-circle coordination product. Use the idea of an open home threshold as the hero: two deep forest-green architectural forms create an open doorway, with a single warm terracotta path entering a calm ivory home interior. Add a small, dignified older-adult figure beyond the threshold, active and self-possessed, to signal independence. Reserve the upper-left and center-left for the project name and concise statement that will be added later.
Input images: the STAY open-threshold logo is the identity reference; a real STAY product screenshot is used only for palette and editorial restraint, never to recreate or invent interface text.
Style/medium: tactile architectural collage with subtle paper grain and photographic depth, sophisticated design-award poster, calm and human, clearly unlike a screenshot.
Composition/framing: iconic large threshold geometry, one focal path, strong hierarchy at small gallery-card size, generous negative space, balanced 3:2 landscape.
Lighting/mood: warm sunlit interior, protected but open, reassuring rather than sentimental.
Color palette: deep forest green, warm ivory, muted terracotta, soft sage, near-black accents.
Text: no text at all.
Constraints: no logo, typography, fake UI, screens, smart speaker, medical or emergency imagery, alarm symbols, or clutter; keep all key imagery within a safe central crop.
Avoid: generic SaaS illustration, stock vectors, dashboard collage, glossy 3D blobs, neon AI motifs, watermarks.
```

## Deterministic composition

```bash
magick -background none assets/submission/covers/source/STAY_YouTube_Overlay_v2.svg assets/submission/covers/source/STAY_YouTube_Overlay_v2.png
magick -background none assets/submission/covers/source/STAY_Devpost_Overlay_v2.svg assets/submission/covers/source/STAY_Devpost_Overlay_v2.png
magick \( assets/submission/covers/source/STAY_YouTube_Background_GPT_Image_2.png -resize 1280x720\! \) assets/submission/covers/source/STAY_YouTube_Overlay_v2.png -compose over -composite -strip -interlace Plane -sampling-factor 4:4:4 -quality 94 assets/submission/video/STAY_YouTube_Thumbnail_v2.jpg
magick \( assets/submission/covers/source/STAY_Devpost_Background_GPT_Image_2.png -resize 1500x1000\! \) assets/submission/covers/source/STAY_Devpost_Overlay_v2.png -compose over -composite -strip -interlace Plane -sampling-factor 4:4:4 -quality 94 assets/submission/STAY_Devpost_Cover_v2.jpg
```

The generated backgrounds contain no interface, logo, or text. The overlays preserve the approved open-threshold mark and add exact, reviewable copy.
