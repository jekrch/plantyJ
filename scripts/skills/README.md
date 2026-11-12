# Claude Code skills

Claude Code only discovers project skills under `.claude/skills`, which is gitignored
here, so these live in the repo and are linked in. After a fresh clone, from the root:

```bash
mkdir -p .claude/skills
for s in scripts/skills/*/; do ln -s "../../$s" ".claude/skills/$(basename "$s")"; done
```

Their Python dependencies are in `requirements.txt` here
(`pip install -r scripts/skills/requirements.txt`).

- `deflare-zone-pic`: takes sun glare (the washed-out haze in a corner) off zone photos
  and swaps the fixed image into `zone_pics.json`.
