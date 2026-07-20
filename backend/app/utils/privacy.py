import re

# Phone regex (Chinese mobile phone numbers: 11 digits starting with 1)
_PHONE_RE = re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)")
# Email regex
_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
# ID Card regex (18 digits)
_ID_CARD_RE = re.compile(r"(?<!\d)\d{17}[\dXx](?!\d)")

# Detailed Address regex: matches province, city, and/or district, and then masks the following text
_ADDRESS_RE = re.compile(
    r"((?:[^省市区县\s]{2,10}?省)?(?:[^省市区县\s]{2,10}?市)?(?:[^省市区县\s]{2,10}?[区县]))"
    r"([^，。；：？\s]{2,40})"
)

def mask_phone(match: re.Match) -> str:
    phone = match.group(0)
    return f"{phone[:3]}****{phone[7:]}"

def mask_email(match: re.Match) -> str:
    email = match.group(0)
    parts = email.split('@')
    name, domain = parts[0], parts[1]
    if len(name) <= 2:
        masked_name = name[0] + "*" * (len(name) - 1)
    else:
        masked_name = name[0] + "*" * (len(name) - 2) + name[-1]
    return f"{masked_name}@{domain}"

def mask_id_card(match: re.Match) -> str:
    id_card = match.group(0)
    return f"{id_card[:6]}************{id_card[14:]}"

def mask_address(match: re.Match) -> str:
    prefix = match.group(1)
    return f"{prefix}***"

def desensitize_text(text: str) -> str:
    if not text:
        return text
    text = _PHONE_RE.sub(mask_phone, text)
    text = _EMAIL_RE.sub(mask_email, text)
    text = _ID_CARD_RE.sub(mask_id_card, text)
    text = _ADDRESS_RE.sub(mask_address, text)
    return text

def desensitize_parsed_structure(struct: dict) -> dict:
    if not struct:
        return struct
    profile = struct.get("profile") or {}
    for key in ("phone", "email", "name"):
        v = profile.get(key)
        if v:
            profile[key] = desensitize_text(v)
    
    work_exps = struct.get("work_experiences") or []
    for exp in work_exps:
        for key in ("company", "role", "period"):
            v = exp.get(key)
            if isinstance(v, str):
                exp[key] = desensitize_text(v)
        bullets = exp.get("bullets") or []
        for i, b in enumerate(bullets):
            if isinstance(b, str):
                bullets[i] = desensitize_text(b)
    return struct
