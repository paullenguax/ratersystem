#!/usr/bin/env python3
"""
callsigns.py — the voice-artist slot and callsign scheme, as code.

Decided 17 October 2026. Closes the two open questions about recording:
which voice records an item, and what callsign it carries.

THE SCHEME

One voice artist per item position. VA 1 records item 1 of every Version of
every role, VA 2 records item 2, and so on. A candidate sitting one Version
therefore hears nine voices and nine callsigns, which is what keeps the nine
items audibly unrelated — the rule that a Set's items are different aircraft on
different occasions is otherwise carried by the text alone.

The callsign belongs to the SLOT, not to the speaker's role. Item position 3 is
Pacifico whether VA 3 is voicing Pacifico's pilot or the controller talking to
Pacifico. Speaker decides only the word order:

    Pilot  ->  "<Place> <Unit>, <callsign>"     Hawkins Tower, Barlow two three one
    ATC    ->  "<callsign>, <Place> <Unit>"     Barlow two three one, Hawkins Tower

Three callsign families, chosen by role, because a PPL Version cannot have
airline callsigns in it:

    commercial  font names        Airline, Tower, Approach, Area
    light       letter-letter     PPL, Rotary, FISO
    ground      Ops <number>      ADP, AOps  (aircraft heard there use commercial)

Shorter callsigns sit on the short slots (1, 4, 7). An item 1 can be four words,
and a four-syllable callsign in front of it would be longer than the utterance.

Callsigns are excluded from the word count (Rules A §4): they are added at
voice-artist handover and are not part of the measured utterance.

    python callsigns.py            print the full scheme
    python callsigns.py --check    confirm the sets are internally distinct
"""

# ── the nine slots ──────────────────────────────────────────────────────────

COMMERCIAL = {1: 'Barlow',   2: 'Nunito',  3: 'Pacifico',
              4: 'Oswald',   5: 'Calibri', 6: 'Varela',
              7: 'Playfair', 8: 'Arimo',   9: 'Monserrat'}

LIGHT = {1: 'Foxtrot Mike', 2: 'Sierra Tango', 3: 'Delta Romeo',
         4: 'Bravo Kilo',   5: 'Victor Hotel', 6: 'Juliett Papa',
         7: 'Alpha Zulu',   8: 'Charlie Yankee', 9: 'Echo November'}

GROUND = {1: 'Ops One',   2: 'Ops Two',   3: 'Ops Three',
          4: 'Ops Four',  5: 'Ops Five',  6: 'Ops Six',
          7: 'Ops Seven', 8: 'Ops Eight', 9: 'Ops Nine'}

# Ordered so the two B names and the two M names are never adjacent.
PLACE = {1: 'Bay City', 2: 'Everwood', 3: 'Medford',
         4: 'Fairview', 5: 'Buckhorn', 6: 'Oakdale',
         7: 'Hawkins',  8: 'Mayberry', 9: 'Riverdale'}

# Spoken digit by digit in R/T. Distinct patterns, no repeated leading digit.
NUMBER = {1: '231', 2: '146', 3: '452', 4: '318', 5: '507',
          6: '629', 7: '764', 8: '873', 9: '985'}

DIGITS = {'0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four',
          '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'niner'}

# ── role to family and unit ─────────────────────────────────────────────────

FAMILY = {'Airline': 'commercial', 'Tower': 'commercial',
          'Approach': 'commercial', 'Area': 'commercial',
          'PPL': 'light', 'Rotary': 'light', 'FISO': 'light',
          'ADP': 'ground', 'AOps': 'ground'}

# The unit is whichever position holds the frequency, so it follows the phase.
PHASE_UNIT = {
    'ground / preflight': 'Ground',
    'climb':              'Departure',
    'cruise / en-route':  'Control',
    'descent':            'Control',
    'approach':           'Approach',
    'arrival':            'Tower',
}

# Roles whose unit never varies, whatever the phase or area of operation.
UNIT_OVERRIDE = {'FISO': 'Information', 'Area': 'Control',
                 'ADP': 'Ground', 'AOps': 'Ground'}

# A controller role is its OWN unit, which the phase map alone gets wrong: in a
# Tower Version the controller is Tower even at the Approach phase, because the
# aircraft is on Tower's frequency on final. The pilot roles keep the phase map,
# where the Approach phase does mean the Approach unit.
ROLE_PHASE_UNIT = {
    'Tower': {'ground / preflight': 'Ground', 'climb': 'Tower',
              'approach': 'Tower', 'arrival': 'Tower'},
    'Approach': {'climb': 'Departure', 'descent': 'Approach',
                 'approach': 'Approach'},
}

PILOT_SIDE = {'Pilot', 'Driver', 'Ops'}


def spoken_number(n):
    """'231' -> 'two three one'. R/T reads digits individually."""
    return ' '.join(DIGITS[d] for d in str(n))


def callsign(slot, role, speaker):
    """The callsign for this item, before the unit is attached.

    An aircraft overheard on a ground role's frequency is a real aircraft, so it
    takes a commercial callsign rather than an Ops number.
    """
    fam = FAMILY[role]
    if fam == 'ground' and speaker == 'Pilot':
        fam = 'commercial'
    table = {'commercial': COMMERCIAL, 'light': LIGHT, 'ground': GROUND}[fam]
    name = table[slot]
    if fam == 'ground':
        return name                      # "Ops Four" carries no flight number
    return '%s %s' % (name, spoken_number(NUMBER[slot]))


def unit(role, phase):
    if role in UNIT_OVERRIDE:
        return UNIT_OVERRIDE[role]
    key = (phase or '').strip().lower()
    if role in ROLE_PHASE_UNIT:
        u = ROLE_PHASE_UNIT[role].get(key)
        if u:
            return u
    u = PHASE_UNIT.get(key)
    if u is None:
        raise ValueError('no unit for role %r phase %r' % (role, phase))
    return u


def prefix(slot, role, speaker, phase):
    """The words the voice artist records before the script itself."""
    cs = callsign(slot, role, speaker)
    station = '%s %s' % (PLACE[slot], unit(role, phase))
    if speaker in PILOT_SIDE:
        return '%s, %s' % (station, cs)   # calling the unit, giving own callsign
    return '%s, %s' % (cs, station)       # unit addressing the aircraft


def va_brief(slot):
    """Everything VA <slot> records once, across all roles."""
    out = []
    for fam, table in (('commercial', COMMERCIAL), ('light', LIGHT), ('ground', GROUND)):
        name = table[slot]
        cs = name if fam == 'ground' else '%s %s' % (name, spoken_number(NUMBER[slot]))
        out.append((fam, cs))
    return {'slot': slot, 'place': PLACE[slot], 'callsigns': out}


def _check():
    problems = []
    for label, table in (('commercial', COMMERCIAL), ('light', LIGHT),
                         ('ground', GROUND), ('place', PLACE), ('number', NUMBER)):
        vals = list(table.values())
        if len(set(vals)) != 9:
            problems.append('%s: repeated value' % label)
        if sorted(table) != list(range(1, 10)):
            problems.append('%s: slots are not 1-9' % label)
    # no two light callsigns may share a letter word
    words = [w for v in LIGHT.values() for w in v.split()]
    if len(set(words)) != len(words):
        problems.append('light: a phonetic letter is used twice')
    # adjacent slots must not share an initial sound
    for d, lab in ((COMMERCIAL, 'commercial'), (PLACE, 'place')):
        for s in range(1, 9):
            if d[s][0].lower() == d[s + 1][0].lower():
                problems.append('%s: slots %d and %d both start with %r'
                                % (lab, s, s + 1, d[s][0]))
    return problems


if __name__ == '__main__':
    import sys
    if '--check' in sys.argv:
        p = _check()
        print('\n'.join(p) if p else 'scheme is internally consistent')
        sys.exit(1 if p else 0)

    print('%-5s %-10s %-28s %-30s %s' % ('slot', 'place', 'commercial', 'light', 'ground'))
    for s in range(1, 10):
        num = spoken_number(NUMBER[s])
        print('%-5d %-10s %-28s %-30s %s' % (
            s, PLACE[s],
            '%s %s' % (COMMERCIAL[s], num),
            '%s %s' % (LIGHT[s], num),
            GROUND[s]))
    print('\nworked examples')
    for role, speaker, phase in (('Airline', 'Pilot', 'Approach'),
                                 ('Airline', 'ATC', 'Approach'),
                                 ('FISO', 'Pilot', 'Arrival'),
                                 ('ADP', 'Driver', 'Runway'),
                                 ('ADP', 'Pilot', 'Apron / Stand')):
        print('  %-8s %-7s %-16s %s' % (role, speaker, phase,
                                        prefix(2, role, speaker, phase)))
