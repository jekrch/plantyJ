import re

MIN_DESCRIPTION_CHARS = 40
MIN_DESCRIPTION_WORDS = 5


def is_meaningful_description(text: str) -> bool:
    stripped = text.strip()
    if len(stripped) < MIN_DESCRIPTION_CHARS:
        return False
    if len(stripped.split()) < MIN_DESCRIPTION_WORDS:
        return False
    return True


def slugify(name: str) -> str:
    slug = name.lower().strip()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    return slug.strip("-")
