# functions-py — the TEAC rules, served

A second Firebase Functions codebase, in Python, alongside the Node one in
`functions/`. It exists for one reason: the Part 3 rules are written in Python
in `paullenguax/teac`, and that is the only copy there should be.

Porting them to TypeScript would be faster to ship and would guarantee two
answers to "is this item legal" within a week. Hosting the Python instead keeps
one.

## What is here

| | |
|---|---|
| `main.py` | the callable functions the app uses |
| `teac_rules/` | the rules, vendored from `paullenguax/teac` at a pinned tag — **never edited here** |
| `sync_rules.sh` | refreshes `teac_rules/` from the pinned tag and records which one |

## Functions

- `validate_part3_batch` — takes `{rows: [...]}` and returns findings for the
  whole batch: quotas, balance, trap placement, openers, exposure.
- `validate_part3_item` — takes `{row: {...}}` and returns the subset of rules a
  single item can be judged against, for live feedback in an editor.

Both are `on_call`, so the caller's auth comes through and the function checks
`people/{uid}.role` before answering.

## Keeping the rules current

```
./sync_rules.sh v5.3            # or whichever tag
```

It writes `teac_rules/VERSION` with the tag and commit. Every validation result
the app stores should record that string, because an item legal under one
version of the rules may not be legal under the next.

## Deploying

```
firebase deploy --only functions:teac
```

The codebase is named `teac` in `firebase.json`, so it deploys independently of
the Node functions and a failure in one does not block the other.
