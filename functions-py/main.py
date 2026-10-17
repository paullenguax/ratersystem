"""
TEAC rule checking, served to the app.

The rules themselves live in `teac_rules/`, vendored from paullenguax/teac at a
pinned tag by sync_rules.sh. Nothing in this file decides whether an item is
legal — it only handles auth, shapes the request, and records which version of
the rules answered.

Two callables:

    validate_part3_batch   whole batch: quotas, balance, trap placement,
                           openers, exposure against the live bank
    validate_part3_item    one item: the subset a single row can be judged on,
                           for live feedback while someone types

Both run as the caller. A viewer who may not read the bank gets nothing.
"""
import os

from firebase_functions import https_fn, options
from firebase_admin import initialize_app, firestore

from teac_rules import rules_part3

initialize_app()

options.set_global_options(region='europe-west2', max_instances=10)

_HERE = os.path.dirname(os.path.abspath(__file__))


def rules_version():
    """The tag and commit the vendored rules came from. Stored with every
    result, because an item legal under one version may not be under the next."""
    try:
        with open(os.path.join(_HERE, 'teac_rules', 'VERSION')) as fh:
            return fh.read().strip()
    except OSError:
        return 'unknown'


# Roles allowed to run a check. Review roles need it to see why an item was
# flagged; trainees never do.
ALLOWED = {'admin', 'senior_rater', 'sme', 'ele'}


def _require_role(req):
    if req.auth is None:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.UNAUTHENTICATED,
                                  'Sign in to validate content.')
    uid = req.auth.uid
    snap = firestore.client().collection('people').document(uid).get()
    role = (snap.to_dict() or {}).get('role') if snap.exists else None
    if role not in ALLOWED:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.PERMISSION_DENIED,
                                  'Your role cannot validate TEAC content.')
    return uid, role


def _clean_rows(raw):
    if not isinstance(raw, list) or not raw:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
                                  'Send a non-empty list of rows.')
    if len(raw) > 500:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
                                  'At most 500 rows per call.')
    rows = []
    for r in raw:
        if not isinstance(r, dict):
            raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
                                      'Each row must be an object.')
        for k in ('version', 'item', 'set', 'speaker', 'script'):
            if k not in r:
                raise https_fn.HttpsError(
                    https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
                    'Row is missing %r.' % k)
        rows.append(r)
    return rows


@https_fn.on_call()
def validate_part3_batch(req: https_fn.CallableRequest) -> dict:
    """{rows: [...], against?: {script: label}, profile?: str} -> findings."""
    _require_role(req)
    data = req.data or {}
    rows = _clean_rows(data.get('rows'))
    against = data.get('against') or None
    if against is not None and not isinstance(against, dict):
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
                                  '`against` must be an object of script -> label.')
    res = rules_part3.check(rows, against=against, profile=data.get('profile'))
    res['rulesVersion'] = rules_version()
    res['ok'] = not res['findings']
    return res


@https_fn.on_call()
def validate_part3_item(req: https_fn.CallableRequest) -> dict:
    """{row: {...}} -> the findings a single item can produce on its own."""
    _require_role(req)
    row = (req.data or {}).get('row')
    if not isinstance(row, dict) or 'item' not in row or 'script' not in row:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
                                  'Send a row with at least `item` and `script`.')
    findings = rules_part3.check_one(row)
    lo, hi = rules_part3.band_for(int(row['item']))
    return {
        'findings': findings,
        'ok': not findings,
        'words': rules_part3.words(row.get('script')),
        'band': {'low': lo, 'high': hi},
        'numericRefs': rules_part3.numrefs(row.get('script')),
        'rulesVersion': rules_version(),
    }
