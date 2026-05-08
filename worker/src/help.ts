export const HELP_HEADER = `PlantyJ Bot — Commands:

Add a plant photo:
  Each photo is one plant in one zone. If a plant lives in multiple zones,
  post a separate photo per zone.

  Caption format (only shortCode is required):
  shortCode // fullName // commonName // zone // tags // description

  Zone is either a bare code (fb1) or 'Display Name (code)' to declare/rename.

  Tags can be pic-level (no prefix), plant+zone-level (+tag), or plant-level (++tag):
  tmt-c // // // fb1 // edible,+native,++medicinal

  First time registering a plant + zone:
  tmt-c // Solanum lycopersicum 'Cherokee Purple' // Cherokee Purple Tomato // Front Bed 1 (fb1) // edible,heirloom // first ripe fruit

  Same plant photographed in a different zone (just supply the new zone):
  mint-1 // // // sb // // spreading into the side bed

  Once shortCode and zone are known, just:
  tmt-c // // // fb1 // // sizing up nicely

  If posting from the same zone as the last photo of this plant, just the code:
  tmt-c

Unidentified plants:
  Don't know what it is? Use shortCode 'id':
  id // fb1                    — minimum: just a zone
  id // fb1 // mystery vine    — with a description
  The pic is saved as 'unid-{seq}' until you identify it. Once the BioCLIP
  action runs, accept its prediction with /accept, or fill it in manually
  with /update.

Pic commands:
  /delete {seq} — Remove a pic by its sequential ID
  /update {seq} {field} {value} — Update a field on a pic or its plant
  /accept {seq} [shortCode] — Apply BioCLIP prediction to an unidentified
    pic. With a shortCode, also rename (e.g. /accept 12 r-rub merges into
    an existing 'r-rub' plant or creates one).
  /help — Show this message

Updatable fields:
  Plant-level (apply to all pics of the plant): shortCode, fullName, commonName
  Pic-level (apply only to this pic): zoneCode, tags, description

Annotation commands (persistent across all pics):
  /annotate {shortCode} // tags // {tags} — set plant-level tags (comma-separated)
  /annotate {shortCode} // description // {desc} — set plant-level description
  /annotate {shortCode} // {zoneCode} // tags // {tags} — set plant+zone tags
  /annotate {shortCode} // {zoneCode} // description // {desc} — set plant+zone description
  /deleteannotation {shortCode} — remove plant-level annotation
  /deleteannotation {shortCode} // {zoneCode} — remove plant+zone annotation
  Set tags to "-" or leave value empty to clear.

  /addtag {seq} {tag} — add a tag to a pic (deduped)
  /addtag {shortCode} // {tag} — add a tag to a plant annotation
  /addtag {shortCode} // {zoneCode} // {tag} — add a tag to a plant+zone annotation

Zone commands:
  /addzone {code} {name} — Create or rename a zone (name optional)
  /renamezone {code} {name} — Set/replace a zone's display name
  /deletezone {code} — Remove a zone (only if no pics reference it)
  /zones — List all known zones
  /plants — List all known plants
  /tags — List all known tags

Zone photo (represents the zone, not a plant):
  Send a photo with the caption:
  /zonepic {zoneCode} [// description]
  Zone pics live independently of plant pics and aren't grouped by shortCode.
  /deletezonepic {id} — Remove a zone pic by its id

Q&A:
  /ask {question} — Ask anything about the garden journal. The bot will
    answer from the current data and suggest copy-pasteable commands for
    any changes you want to make.
  /resp {follow-up} — Continue the previous /ask thread. A new /ask
    starts a fresh thread. Both commands accept a model suffix (1/2/3)
    to override the model for that turn.
  /askstyle {description} — Set a persistent response style for /ask and
    /resp (e.g. "David Attenborough", "extremely concise", "sourced with
    links"). Stays active until you clear it.
  /askstyle — Clear the current style.
  /showstyle — Show the currently active style.

Ecological analysis:
  /analyze — Queue a 1–2 paragraph ecological-niche analysis (good/bad/
    mixed, native insects, urban wildlife, with grounded source URLs)
    for every plant+zone pair that doesn't have one yet. A cron trigger
    drains the queue every minute, processing a few pairs per tick and
    committing each batch to ai_analysis.json.
  /analyze {zoneCode} — Same, scoped to a single zone (full property
    context still informs the reasoning).
  /analyze-load — Report queue progress: succeeded / failed / remaining,
    tokens used, elapsed time. Run repeatedly to watch the cron drain.
  /analyze-cancel — Clear the queue and run state (use if a run is
    stuck or you want to abandon it).`;
