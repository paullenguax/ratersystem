#!/usr/bin/env python3
"""
rules_part3.py — the Part 3 rules as a pure function over plain rows.

No openpyxl, no filesystem, no printing. Give it a list of dicts and it gives
back findings. That is what lets the same rules run in three places without
three copies of them:

    validate_part3.py   reads a workbook, calls check()
    a Cloud Function    reads Firestore documents, calls check()
    a test              builds rows in memory, calls check()

A second implementation in another language would drift from this one inside a
week, and then two answers to "is this item legal" exist. There is one.

ROW SHAPE — keys are lowercase; anything absent is simply not checked.

    version      int     required
    item         int     required, 1-9 (position decides the length band)
    set          str     required, 'A' | 'B' | 'C'
    speaker      str     required, e.g. 'Pilot' | 'ATC' | 'Driver' | 'Ops'
    script       str     required, the utterance itself
    domain       str     optional
    tricky       bool    optional
    mechanism    str     optional, the trap mechanism when tricky
    negative, question, past, continuous, perfect, doubt,
    imperative, conditional        bool, optional grammar flags

Derived values are never read from the row: word count and numeric references
are computed from `script` every time, because typed metadata goes stale the
moment someone edits a script.
"""
import re
import collections

# §4 length bands by item position. The gaps at 12-14 and 23-31 are deliberate:
# they keep the three lengths audibly distinct.
BAND = {1: (4, 11), 2: (15, 22), 0: (32, 40)}

NUM = ('one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|'
       'twenty|thirty|forty|fifty|hundred|thousand')
NUMPAT = re.compile(r'\b(?:\d+|%s)(?:[\s-]+(?:\d+|%s))*\b' % (NUM, NUM), re.I)
NONOPS = ['the first one', 'one of', 'one more', 'no one', 'need one', 'once',
          'someone', 'anyone', 'everyone', 'nobody']

# §5 speaker bands per role family, detected from the speakers present. The band
# was once hard-coded to two speakers, which made the checker report its own
# inability to read a three-speaker role as a failure of that role.
SPEAKER_PROFILES = {
    'two-speaker': {'Pilot': (3, 6), 'ATC': (3, 6)},
    'ground':      {'Driver': (3, 9), 'ATC': (3, 5), 'Pilot': (1, 3)},
    'aops':        {'Ops': (3, 9), 'ATC': (3, 5), 'Pilot': (1, 3)},
}

# Profiles that must carry a controller in every Set. Both ground roles had
# drifted into Sets with no ATC at all, which a candidate experiences as a whole
# block with no sign of the party they actually work to.
ATC_IN_EVERY_SET = {'ground', 'aops'}

# §12 grammar quotas per Version.
LIMITS = {'past': (1, 3), 'perfect': (1, 3), 'continuous': (1, 3),
          'doubt': (1, 3), 'imperative': (1, 3), 'question': (2, 3),
          'conditional': (1, 2)}
LABEL = {'question': 'Interrogative'}

NEGWORD = re.compile(r"\b(?:not|n't|no|never|cannot)\b", re.I)


def pick_profile(speakers):
    """speakers: a set of speaker labels. Returns (name, bands) or (None, None)."""
    for name, prof in SPEAKER_PROFILES.items():
        if speakers <= set(prof):
            return name, prof
    return None, None


def numrefs(text):
    """Numeric references in an utterance, computed from the text (§13)."""
    t = (text or '').lower()
    for g in NONOPS:
        t = t.replace(g, '')
    return NUMPAT.findall(t)


def words(text):
    return len((text or '').split())


def band_for(item):
    return BAND[item % 3]


def _truth(v):
    """Accept True, 'T', 'TRUE', 1 — workbooks and Firestore disagree on this."""
    if isinstance(v, bool):
        return v
    return str(v).strip().upper() in ('T', 'TRUE', '1', 'YES')


def check(rows, against=None, profile=None):
    """Check a batch of rows against the Part 3 rules.

    rows     list of dicts in the shape above — one batch, normally one role.
    against  {normalised script: label} to check exposure against, or None.
             Used for demo and practice material, which must share no item and
             no three-word opener with the live bank. Point it at the LIVE bank
             only: pointing it at a derived set's own parent produces a wall of
             false failures, because a derived set is meant to reuse its parent.
    profile  force a speaker profile instead of detecting it.

    Returns {'findings': [str], 'profile': str|None, 'items': int,
             'versions': int, 'domain_balance': {domain: sets}}.
    An empty findings list means the batch passes.
    """
    fails, openers = [], {}
    pernum = collections.Counter()
    gram = collections.defaultdict(collections.Counter)
    spk = collections.defaultdict(collections.Counter)
    setspk = collections.defaultdict(collections.Counter)
    doms = collections.defaultdict(set)
    setdom = collections.Counter()
    tricky = collections.defaultdict(list)
    stacked = []
    has_tricky_field = any('tricky' in r for r in rows)
    has_domain = any(r.get('domain') for r in rows)

    for r in rows:
        v, it = r['version'], int(r['item'])
        txt = (r.get('script') or '').strip()
        sp, st = r.get('speaker'), r.get('set')
        tag = 'V%s.%s' % (v, it)

        n = words(txt)
        lo, hi = band_for(it)
        if not (lo <= n <= hi):
            fails.append('%s LENGTH: %d words, need %d-%d' % (tag, n, lo, hi))

        refs = numrefs(txt)
        if len(refs) > 1:
            fails.append('%s NUMBERS: %d references in one item %s' % (tag, len(refs), refs))
        pernum[v] += len(refs)
        for d in re.findall(r'\b\d+\b', txt):
            if not re.search(r'runway\s+\w*\s*%s' % d, txt, re.I):
                fails.append('%s DIGIT: "%s" should be written as a word' % (tag, d))

        spk[v][sp] += 1
        setspk[(v, st)][sp] += 1
        if r.get('domain'):
            doms[v].add(r['domain'])
            if it % 3 == 1:
                setdom[r['domain']] += 1
        if _truth(r.get('tricky')):
            tricky[v].append((it, r.get('mechanism') or ''))
            if it % 3 == 0:
                fails.append('%s TRICKY: trap sits on a long item (rule 10.3)' % tag)
        if len(NEGWORD.findall(txt)) > 1:
            stacked.append(tag)
        for k in LIMITS:
            if k in r and _truth(r[k]):
                gram[v][k] += 1

        if against:
            norm = ' '.join(txt.lower().split())
            if norm in against:
                fails.append('%s EXPOSURE: identical to %s' % (tag, against[norm]))
            else:
                op = ' '.join(norm.split()[:3])
                for other, otag in against.items():
                    if ' '.join(other.split()[:3]) == op:
                        fails.append('%s EXPOSURE: shares opener with %s' % (tag, otag))
                        break

        key = ' '.join(txt.split()[:3]).lower()
        if key in openers:
            fails.append('%s OPENER: shares first three words with %s' % (tag, openers[key]))
        else:
            openers[key] = tag

    allspk = set()
    for c in spk.values():
        allspk |= set(c)
    if profile:
        if profile not in SPEAKER_PROFILES:
            return {'findings': ['unknown profile %r; known: %s'
                                 % (profile, ', '.join(SPEAKER_PROFILES))],
                    'profile': None, 'items': len(rows),
                    'versions': len(spk), 'domain_balance': dict(setdom)}
        pname, prof = profile, SPEAKER_PROFILES[profile]
    else:
        pname, prof = pick_profile(allspk)
    if prof is None:
        fails.append('SPEAKER PROFILE: no profile covers %s. Add one to '
                     'SPEAKER_PROFILES or pass a profile; speaker counts were '
                     'not checked.' % ', '.join(sorted(allspk)))

    for v in sorted(spk):
        if pernum[v] > 3:
            fails.append('V%s NUMBERS: %d references, max 3' % (v, pernum[v]))
        if has_tricky_field and len(tricky[v]) != 1:
            fails.append('V%s TRICKY: %d trap items, need exactly 1' % (v, len(tricky[v])))
        if has_domain and len(doms[v]) != 3:
            fails.append('V%s DOMAINS: %d used, need 3' % (v, len(doms[v])))
        if prof is not None:
            for role, c in spk[v].items():
                lo, hi = prof.get(role, (None, None))
                if lo is None:
                    fails.append('V%s SPEAKER: %s is not in the %s profile' % (v, role, pname))
                elif not (lo <= c <= hi):
                    fails.append('V%s SPEAKER: %s count %d, need %d-%d (%s profile)'
                                 % (v, role, c, lo, hi, pname))
        for s in sorted({k[1] for k in setspk if k[0] == v}):
            c = setspk[(v, s)]
            if pname in ATC_IN_EVERY_SET and c['ATC'] == 0:
                fails.append('V%s Set %s: no ATC transmission. %s roles carry a '
                             'controller in every Set.' % (v, s, pname))
            if len(c) < 2 or max(c.values()) > 2:
                fails.append('V%s Set %s SPEAKER: %s, need at least two speakers'
                             % (v, s, dict(c)))
        for k, (lo, hi) in LIMITS.items():
            if any(k in r for r in rows) and not (lo <= gram[v][k] <= hi):
                fails.append('V%s GRAMMAR %s=%d, need %d-%d'
                             % (v, LABEL.get(k, k.capitalize()), gram[v][k], lo, hi))

    seq = [tricky[v][0][1] for v in sorted(tricky) if tricky[v]]
    for i in range(1, len(seq)):
        if seq[i] and seq[i] == seq[i - 1]:
            fails.append('TRAP MECHANISM: "%s" repeats in consecutive Versions' % seq[i])
    if len(stacked) > 1:
        fails.append('STACKED NEGATION: %d items, max 1 per batch (%s)'
                     % (len(stacked), ', '.join(stacked)))
    if setdom:
        total = sum(setdom.values())
        for d, c in sorted(setdom.items()):
            pct = c / total
            if not (0.20 <= pct <= 0.30):
                fails.append('DOMAIN BALANCE: %s at %.0f%% of Sets, need 20-30%%'
                             % (d, pct * 100))

    return {'findings': fails, 'profile': pname, 'items': len(rows),
            'versions': len(spk), 'domain_balance': dict(setdom)}


def check_one(row):
    """The subset of rules a single item can be judged against, for live
    feedback while someone is typing in an editor. Everything else — quotas,
    balance, trap placement across a Version — needs the whole batch."""
    out = []
    it = int(row['item'])
    n = words(row.get('script'))
    lo, hi = band_for(it)
    if not (lo <= n <= hi):
        out.append('LENGTH: %d words, need %d-%d for item %d' % (n, lo, hi, it))
    refs = numrefs(row.get('script'))
    if len(refs) > 1:
        out.append('NUMBERS: %d references in one item %s' % (len(refs), refs))
    for d in re.findall(r'\b\d+\b', row.get('script') or ''):
        if not re.search(r'runway\s+\w*\s*%s' % d, row.get('script') or '', re.I):
            out.append('DIGIT: "%s" should be written as a word' % d)
    if _truth(row.get('tricky')) and it % 3 == 0:
        out.append('TRICKY: trap sits on a long item (rule 10.3)')
    return out
