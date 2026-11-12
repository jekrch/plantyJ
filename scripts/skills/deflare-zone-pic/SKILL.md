---
name: deflare-zone-pic
description: Take sun glare off zone photos in plantyJ, meaning the pale, washed-out haze in a corner (usually the top right) from shooting toward the sun. Finds which zone pics have it, fits and removes the haze, and swaps the fixed image into zone_pics.json under a new -vN filename. Use when the user says zone pics have glare, flare, haze, a washed-out corner, or a sun spot, or asks to deflare, de-haze, or fix the lighting on zone photos. Not for plant pics (pics.json), whose images carry derived metadata.
---

# Taking sun glare off zone photos

`deflare.py` beside this file does all of it, from the repo root. It needs OpenCV
(`cv2`), numpy and scipy (`pip install -r scripts/skills/requirements.txt`). Write
working files to the scratchpad.

Zone pics only. Plant pics in `pics.json` also have BioCLIP ids, embeddings, hashes and
colors computed from the image, so swapping their image needs those refreshed too. This
skill doesn't do that.

## What it fixes and what it doesn't

Shooting toward the sun adds a veil of light over part of the frame. It's brightest
near the sun, usually just past the top-right corner, and fades smoothly away from it.
Under it, shadows go grey and colors wash out. That veil is what comes off.

It doesn't remove:

- **Sun rays.** Thin bright streaks fanning out from the sun (hbd, bb and kg in Nov
  2026). A smooth veil can't follow them. Reading them angle by angle from the darkest
  pixels was tried and came out as noise, since dark objects sit along every ray. They'd
  need inpainting.
- **The blown-out sun disc.** Pixels clipped to white hold no scene.
- **Framing.** It never crops, straightens or rotates.

## Workflow

### 1. Find the photos with glare

```bash
python3 scripts/skills/deflare-zone-pic/deflare.py scan              # every zone pic
python3 scripts/skills/deflare-zone-pic/deflare.py scan sy-1794452691 bb-1794452784
```

Each line gives `GLARE` or `clean`, the peak lift on shadows out of 255, and where it
put the sun. Clean photos read under 35. The mildest real haze read 57, and the worst
up to 176.

- A sun fitted well inside the frame with a tiny scale (under ~0.1) is usually a bright
  patch of scene, not glare. Look before trusting it.
- An `(already deflared)` photo still reads high, because what's left is mostly sky or a
  blown-out core. Don't deflare a `-vN` image again. Start from `original`.

View the flagged photos before going on. The user knows which ones look wrong, so ask
if their list and the scan disagree.

### 2. Get the original

```bash
python3 scripts/skills/deflare-zone-pic/deflare.py original sy-1794452691 SCRATCH/sy.jpg
```

This writes the first-posted photo, from disk or from git if a `-vN` replaced it.

### 3. Enhance into the scratchpad

```bash
python3 scripts/skills/deflare-zone-pic/deflare.py enhance SCRATCH/sy.jpg SCRATCH/sy-out.jpg \
  --compare SCRATCH/sy-cmp.jpg --zoom 640,0,640,480 --map SCRATCH/sy-map.png
```

`--compare` puts the source beside the result. `--zoom X,Y,W,H` (repeatable) shows
crops instead. Always zoom on the glare corner, since that's where problems show.
`--map` shows the first pass's veil, brighter where more came off, with the cells it
read from in green and the ones it rejected (sky, sunlit ground) in red.

What it prints, per pass: where the sun is, how much it lifted shadows, the veil's
measured color and the color it used, and the scene's black. After that, what the scan
reads on the result, how far the unglared bottom-left moved, and how many pixels were
clipped to black.

### 4. Check it

Compare the glare corner against the source:

| You see | Do |
| --- | --- |
| Bottom-left moved more than ~2/255 | The veil reaches too far. Check `--map`. `--passes 1` if the second pass did it |
| Black pixels rose well past ~0.3% | Shadows were crushed. Try `--passes 1`, then `--strength 0.8` |
| A blue or lavender wash left in the corner | Too little blue removed. `--tint 1,1.1,1.25` |
| Trees or shade in the corner turned purple or magenta | Too much green removed. `--tint 1,1.05,1.1` |
| A dark smudge right at the corner | The second pass fitted scene. `--passes 1` |
| Haze plainly still there with nothing else wrong | `--strength 1.15`, then check the blacks again |
| Sun rays still visible | Expected, see above. Tell the user |

`--tint R,G,B` is the veil color relative to its weakest channel, used as given in every
pass. Without it the measured color is pulled halfway to neutral and capped at 1.25.

### 5. Install

```bash
python3 scripts/skills/deflare-zone-pic/deflare.py install sy-1794452691 SCRATCH/sy-out.jpg
```

This writes the image as `<name>-v2.jpg` (or the next version), points the zone pic's
`image` at it in `zone_pics.json` (only that string changes), and deletes the old file,
which stays in git. The id stays the same.

The new filename matters. `public/sw.js` caches images and never revalidates them, so
an overwritten file would stay stale on any device that has seen it. The one exception:
a `-vN` file that's never been committed or deployed can be overwritten in place.

Check `git status` and `git diff public/data/zone_pics.json` afterwards.

### 6. Finish

Don't commit or stage. Tell the user what changed and what's left (rays, blown-out
spots), and let them make the visual call in the app.

## How it works

Read this before changing the script. The limits were set by photos it got wrong.

- **Model:** photo = scene + veil, in linear light. Removal is `(lin - veil) / (1 - veil)`,
  so whites stay white. This is the same move as the comic-snaps color restorer's
  "glare over the ink".
- **Reading the veil:** the darkest 3% of each cell (12×16 grid) should be shadow. Their
  floor is the veil plus the scene's black. A radial falloff `b + a·exp(-(d/s)^k)` is
  fitted *under* those floors with a lopsided loss (the model above a floor costs 4×).
  Cells far above it get dropped, such as sky, sunlit sidewalk and white walls with no
  shadow in them.
- **Sun above:** the centre may not sit lower than 0.35 image heights from the top. Left
  free, mpg's fit put the "sun" below the frame on sunlit ground.
- **Scene black:** only lift above the 5th-percentile floor comes off, per channel. Shade
  isn't neutral, and one black for all channels crushed 1.8% of kg's shadows.
- **Veil color:** measured from how each channel of the *same* darkest pixels rises with
  the veil, then pulled halfway to neutral and capped at 1.25. A neutral veil left a
  blue-lavender wash. Each channel's own floor picks different pixels, so green leaves
  inflated green and fy's tree went purple. Sky in a corner reads as a very blue veil
  (nbv measured 2.9×).
- **Second pass:** one falloff takes the broad haze but undershoots the brighter core near
  the sun, so it refits on the result. A later pass runs only if the lift fell by 20% or
  more and the centre stayed within 0.4 heights of the first. Past that it fits the
  scene: bb's second pass found a brighter "core" in its corner and left a dark smudge.
  A third pass never helped.
