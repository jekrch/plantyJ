#!/usr/bin/env python3
"""Take sun flare (veiling glare) off zone photos. Run from the repo root.

  scan     [ID ...]          which zone pics have glare (default: all of them)
  original ID OUT            the first-posted photo of a zone pic, from git
  enhance  IN OUT [...]      take the glare off into OUT
  install  ID OUT            swap OUT in as the zone pic's next -vN image

Model: photo = scene + veil, in linear light. The veil is smooth and radial,
centred near the sun, which is usually just outside the frame. Shadows inside
foliage should be near black, so the floor of the darkest pixels in each cell is
the veil plus the scene's own black. A radial surface is fitted *under* those
floors (cells with no shadows, like sky or sunlit sidewalk, sit above it and are
rejected), and removed with (lin - veil) / (1 - veil) so whites stay white.
Each channel gets its own veil strength (the flare is slightly blue) and its own
black (shade isn't neutral). A second pass refits on the result to take the
brighter core near the sun that one falloff undershoots.
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
from scipy.optimize import least_squares

ZONE_PICS = Path("public/data/zone_pics.json")
PUBLIC = Path("public")
GRID = (12, 16)  # rows, cols of cells the floors are read from
# Highest the sun's centre may sit, in image heights from the top. A low fit
# latches onto sunlit ground, which is a bright floor but not glare.
MAX_CENTRE_Y = 0.35
# Peak lift on shadows, out of 255, below which a photo is called clean. A clean
# photo (mpg, Nov 2026) fit a spurious 20; the mildest real haze (wbv) read 57.
GLARE_THRESHOLD = 35
# Pass 2 must stay on the first pass's sun, in image heights.
MAX_CENTRE_MOVE = 0.4
# The measured veil colour is pulled halfway to neutral and capped. Neutral left a
# blue-lavender wash on hbd, sy and kg; the full measurement turned fy's tree
# purple, and sky in a corner reads as a strongly blue veil (nbv measured 2.9x).
SHRINK = 0.5
MAX_TINT = 1.25
VERSIONED = re.compile(r"^(?P<stem>.+?)-v(?P<n>\d+)\.jpg$")


def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def to255(lin):
    return float(linear_to_srgb(np.asarray(lin, dtype=float)) * 255)


def cell_floors(lin):
    """Per cell: centre (in image heights), the 3rd percentile of its darkest
    channel, and the median RGB of those same darkest pixels."""
    H, W, _ = lin.shape
    dark = lin.min(axis=2)
    xs, ys, floors, rgb = [], [], [], []
    for row in np.array_split(np.arange(H), GRID[0]):
        for col in np.array_split(np.arange(W), GRID[1]):
            d = dark[np.ix_(row, col)].ravel()
            cut = np.percentile(d, 3)
            xs.append(col.mean() / H)
            ys.append(row.mean() / H)
            floors.append(cut)
            rgb.append(np.median(lin[np.ix_(row, col)].reshape(-1, 3)[d <= cut], axis=0))
    return np.array(xs), np.array(ys), np.array(floors), np.array(rgb)


def radial(p, x, y):
    a, b, cx, cy, s, k = p
    return b + a * np.exp(-((np.hypot(x - cx, y - cy) / s) ** k))


def fit_veil(x, y, f, aspect):
    i = int(np.argmax(f))
    p0 = [max(f[i] - np.median(f), 1e-3), float(np.percentile(f, 10)), x[i], min(y[i], MAX_CENTRE_Y - 0.05), 0.6, 1.0]
    lo = [0, 0, -1.0, -1.0, 0.05, 0.4]
    hi = [1, 0.5, aspect + 1.0, MAX_CENTRE_Y, 4.0, 2.5]
    keep = np.ones_like(f, bool)
    for _ in range(6):
        def resid(p):
            r = f[keep] - radial(p, x[keep], y[keep])
            # Lower envelope: the model sitting above a floor costs far more than below it.
            return np.where(r < 0, 4.0 * r, r)

        p = least_squares(resid, p0, bounds=(lo, hi)).x
        r = f - radial(p, x, y)
        sigma = max(1.4826 * np.median(np.abs(r[keep])), 2e-3)
        new = r < 2.5 * sigma
        if (new == keep).all():
            break
        keep, p0 = new, p
    return p, keep


class Veil:
    def __init__(self, lin):
        H, W = lin.shape[:2]
        self.H, self.W = H, W
        self.lin = lin
        small = cv2.resize(self.lin, (W // 4, H // 4), interpolation=cv2.INTER_AREA)
        self.x, self.y, self.f, self.rgb = cell_floors(small)
        self.p, self.keep = fit_veil(self.x, self.y, self.f, W / H)
        # Keep the scene's own black: only what lifts a floor above the darkest
        # floors in the frame comes off, so sunlit shadows aren't crushed.
        self.black = float(np.percentile(self.f[self.keep], 5))
        peak = float(self.p[0] + self.p[1])  # the model's value at its centre
        at_cells = radial(self.p, self.x, self.y).max()
        self.peak_lin = max(min(peak, at_cells) - self.black, 0.0)
        self.peak = to255(self.peak_lin + self.black) - to255(self.black)

    def shape(self, x, y):
        a, b, cx, cy, s, k = self.p
        return np.exp(-((np.hypot(x - cx, y - cy) / s) ** k))

    def fit_colour(self):
        """How each channel of the cells' darkest pixels rises with the veil's shape:
        a slope (the veil's colour) and the scene's own black under it, per channel.

        Measured from the same pixels in every channel: each channel's own floor
        picks different pixels, and green leaves inflated green until fy's tree went
        purple. The black is per channel too, because shade under blue sky is bluish:
        one black for all channels sent 1.8% of kg's shadows to pure black."""
        g = self.shape(self.x, self.y)[self.keep]
        X = np.stack([np.ones_like(g), g], axis=1)
        slopes, blacks = [], []
        for c in range(3):
            y = self.rgb[self.keep, c]

            def resid(q):
                r = y - X @ q
                return np.where(r < 0, 4.0 * r, r)

            slopes.append(least_squares(resid, [self.p[1], self.p[0]]).x[1])
            blacks.append(np.percentile(y, 5))
        self.slopes, self.blacks = np.array(slopes), np.array(blacks)
        self.ints = np.array([np.percentile(self.rgb[self.keep, c] - self.slopes[c] * g, 5) for c in range(3)])
        lo = self.slopes.min()
        return self.slopes / lo if lo > 0 else np.ones(3)

    def field_rgb(self, tint, strength=1.0):
        """Per-channel veil: the channel's fitted rise, with its slope set by tint
        relative to the weakest channel, above that channel's own black."""
        xx, yy = np.meshgrid(np.arange(self.W) / self.H, np.arange(self.H) / self.H)
        g = self.shape(xx, yy)
        slope = self.slopes.min() * np.asarray(tint, float)
        # Only what lifts the floor above the scene's own black comes off, so
        # sunlit shadows aren't crushed.
        veil = self.ints[None, None, :] + g[..., None] * slope - self.blacks[None, None, :]
        return np.clip(veil * strength, 0, 0.95)

    def centre(self):
        return np.array(self.p[2:4])

    def field(self):
        xx, yy = np.meshgrid(np.arange(self.W) / self.H, np.arange(self.H) / self.H)
        return np.clip(radial(self.p, xx, yy) - self.black, 0, None)

    def describe(self):
        a, b, cx, cy, s, k = self.p
        return (
            f"sun at ({cx / (self.W / self.H):+.2f}, {cy:+.2f}) of the frame (x, y; 0-1 is inside)  "
            f"scale {s:.2f}  shape {k:.2f}  scene black {to255(self.black):.0f}  "
            f"lifts shadows by up to {self.peak:.0f}/255  cells kept {self.keep.mean():.0%}"
        )


def to_lin(bgr):
    return srgb_to_linear(bgr[..., ::-1].astype(np.float64) / 255)


def to_bgr8(lin):
    return (linear_to_srgb(lin)[..., ::-1] * 255 + 0.5).astype(np.uint8)


def deflare(bgr, passes=2, tint=None, strength=1.0, log=print):
    """Remove the veil, refitting on the result for the sun's core.

    One radial falloff takes the broad haze but undershoots the bright core near
    the sun, so the result is refitted. A later pass runs only while it is still
    centred on the first pass's sun and the lift keeps falling: past that it fits
    the scene (bb's second pass found a brighter "core" in its corner and left a
    dark smudge there; a third pass on nbv read the blue sky as a blue veil)."""
    lin = to_lin(bgr)
    first = prev = None
    for n in range(1, passes + 1):
        v = Veil(lin)
        if n > 1:
            moved = np.linalg.norm(v.centre() - first.centre())
            if v.peak < GLARE_THRESHOLD:
                log(f"pass {n}: {v.peak:.0f}/255 left, under the threshold; done")
                break
            if v.peak > 0.8 * prev.peak or moved > MAX_CENTRE_MOVE:
                log(f"pass {n}: skipped, it fits the scene now ({v.peak:.0f}/255 lift, centre moved {moved:.2f})")
                break
        measured = v.fit_colour()
        if v.slopes.min() <= 0:
            log(f"pass {n}: no channel rises with the veil; done")
            break
        raw = measured if tint is None else np.asarray(tint, float)
        used = np.clip(1 + SHRINK * (raw - 1), 1, MAX_TINT) if tint is None else raw
        log(f"pass {n}: {v.describe()}")
        log(f"        veil colour RGB {measured.round(2).tolist()} measured, {used.round(2).tolist()} used; "
            f"scene black RGB {[round(to255(b)) for b in v.blacks]}")
        veil = v.field_rgb(used, strength)
        lin = np.clip((lin - veil) / (1 - veil), 0, 1)
        first, prev = first or v, v
    return to_bgr8(lin), first


def load_zone_pics():
    return json.loads(ZONE_PICS.read_text())["zonePics"]


def find_pic(pic_id):
    for pic in load_zone_pics():
        if pic["id"] == pic_id:
            return pic
    sys.exit(f"no zone pic with id {pic_id!r} in {ZONE_PICS}")


def base_path(image):
    """images/zones/z/t-v3.jpg -> images/zones/z/t.jpg"""
    p = Path(image)
    m = VERSIONED.match(p.name)
    return str(p.with_name(m["stem"] + ".jpg")) if m else image


def cmd_scan(args):
    pics = [find_pic(i) for i in args.ids] if args.ids else load_zone_pics()
    for pic in pics:
        image = pic["image"]
        if image.startswith("http") or ":" in image.split("/")[0]:
            print(f"{pic['id']:22} skipped: not a local file ({image})")
            continue
        bgr = cv2.imread(str(PUBLIC / image))
        if bgr is None:
            print(f"{pic['id']:22} missing: {PUBLIC / image}")
            continue
        v = Veil(to_lin(bgr))
        done = " (already deflared)" if VERSIONED.match(Path(image).name) else ""
        verdict = "GLARE" if v.peak >= GLARE_THRESHOLD else "clean"
        print(f"{pic['id']:22} {verdict:5} {v.peak:4.0f}/255{done}  {v.describe()}")


def cmd_original(args):
    pic = find_pic(args.id)
    path = PUBLIC / base_path(pic["image"])
    if path.exists():
        Path(args.out).write_bytes(path.read_bytes())
    else:
        log = subprocess.run(
            ["git", "log", "--diff-filter=A", "--format=%H", "-1", "--", str(path)],
            capture_output=True, text=True,
        )
        added = log.stdout.strip() if log.returncode == 0 else ""
        if not added:
            sys.exit(f"{path} isn't on disk or in git history ({log.stderr.strip() or 'never added'})")
        data = subprocess.run(["git", "show", f"{added}:{path.as_posix()}"], capture_output=True, check=True).stdout
        Path(args.out).write_bytes(data)
    print(f"original of {args.id}: {path} -> {args.out}")


def cmd_enhance(args):
    if VERSIONED.match(Path(args.src).name) and not args.force:
        sys.exit(f"{args.src} is already a -vN image. Start from `original` instead (or pass --force).")
    bgr = cv2.imread(args.src)
    if bgr is None:
        sys.exit(f"can't read {args.src}")
    tint = [float(t) for t in args.tint.split(",")] if args.tint else None
    out8, v = deflare(bgr, passes=args.passes, tint=tint, strength=args.strength)
    if v.peak < GLARE_THRESHOLD:
        print(f"little or no glare (under {GLARE_THRESHOLD}/255): consider leaving this photo alone")
    cv2.imwrite(args.out, out8, [cv2.IMWRITE_JPEG_QUALITY, args.quality])
    left = Veil(to_lin(out8))
    print(f"left after: {left.peak:.0f}/255 (scan's reading; part of it can be scene, like sky or a blown-out sun)")

    H, W = v.H, v.W
    src, res = bgr.astype(float), out8.astype(float)
    far = np.abs(src[H // 2:, : W // 3] - res[H // 2:, : W // 3]).mean()
    clipped = ((src.max(2) <= 2).mean() * 100, (res.max(2) <= 2).mean() * 100)
    print(f"bottom-left moved {far:.1f}/255 on average; black pixels {clipped[0]:.2f}% -> {clipped[1]:.2f}%")

    if args.compare:
        if args.zoom:
            rows = []
            for x, y, w, h in map(parse_box, args.zoom):
                pair = np.hstack([bgr[y:y + h, x:x + w], out8[y:y + h, x:x + w]])
                rows.append(cv2.resize(pair, (1200, max(1, round(1200 * pair.shape[0] / pair.shape[1])))))
            cmp = np.vstack(rows)
        else:
            cmp = np.hstack([bgr, out8])
        cv2.imwrite(args.compare, cmp, [cv2.IMWRITE_JPEG_QUALITY, 85])
    if args.map:
        fld = v.field()  # the first pass's veil
        m = (linear_to_srgb(fld / max(fld.max(), 1e-6)) * 255).astype(np.uint8)
        m = cv2.cvtColor(m, cv2.COLOR_GRAY2BGR)
        for xi, yi, kk in zip(v.x, v.y, v.keep):
            cv2.circle(m, (int(xi * H), int(yi * H)), 6, (0, 200, 0) if kk else (0, 0, 255), -1)
        cv2.imwrite(args.map, m)


def parse_box(text):
    x, y, w, h = (int(t) for t in text.split(","))
    return x, y, w, h


def cmd_install(args):
    pic = find_pic(args.id)
    old = pic["image"]
    old_path = Path(old)
    m = VERSIONED.match(old_path.name)
    stem, n = (m["stem"], int(m["n"]) + 1) if m else (old_path.stem, 2)
    new = str(old_path.with_name(f"{stem}-v{n}.jpg"))
    (PUBLIC / new).write_bytes(Path(args.out).read_bytes())

    raw = ZONE_PICS.read_bytes()
    needle = json.dumps(old).encode()
    if raw.count(needle) != 1:
        (PUBLIC / new).unlink()
        sys.exit(f"expected {old} exactly once in {ZONE_PICS}, found {raw.count(needle)}")
    ZONE_PICS.write_bytes(raw.replace(needle, json.dumps(new).encode()))
    if (PUBLIC / old).exists():
        (PUBLIC / old).unlink()
    print(f"{args.id}: {old} -> {new} (old file removed; it stays in git)")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("scan", help="report which zone pics have glare")
    s.add_argument("ids", nargs="*", help="zone pic ids (default: all)")
    s.set_defaults(func=cmd_scan)

    o = sub.add_parser("original", help="write a zone pic's first-posted photo")
    o.add_argument("id")
    o.add_argument("out")
    o.set_defaults(func=cmd_original)

    e = sub.add_parser("enhance", help="take the glare off")
    e.add_argument("src")
    e.add_argument("out")
    e.add_argument("--compare", help="source beside result, pixel-aligned")
    e.add_argument("--zoom", action="append", default=[], help="X,Y,W,H crop for --compare instead of the full view; repeatable")
    e.add_argument("--map", help="the veil taken off (brighter = more), with cells kept (green) and rejected (red)")
    e.add_argument("--strength", type=float, default=1.0, help="share of the fitted veil to remove")
    e.add_argument("--tint", help="veil colour R,G,B relative to its weakest channel, used as given in every pass (default: measured, then pulled halfway to neutral)")
    e.add_argument("--passes", type=int, default=2, help="most fits to run; 1 takes only the broad haze")
    e.add_argument("--quality", type=int, default=82, help="JPEG quality; 82 keeps files near the phone's size")
    e.add_argument("--force", action="store_true", help="allow a -vN image as input")
    e.set_defaults(func=cmd_enhance)

    i = sub.add_parser("install", help="swap the result in as the zone pic's next -vN image")
    i.add_argument("id")
    i.add_argument("out")
    i.set_defaults(func=cmd_install)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
