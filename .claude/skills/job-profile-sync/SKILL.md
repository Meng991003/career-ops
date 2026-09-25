---
name: job-profile-sync
description: Reconcile the candidate's job-board profiles (JobStreet, foundit) against cv.md so skills, roles, education and summary match everywhere. Use when the user updates their CV, says a profile is out of date or incomplete, or asks to add or remove a skill across sites.
user_invocable: true
---

# Profile Sync — cv.md is the source of truth

`cv.md` is authoritative. A profile disagreeing with it is the defect; fix the
profile, not the CV, unless the user says the CV is wrong.

Never log in, never create an account, never enter a password. Work only in
browser sessions the candidate has already authenticated. If a login wall
appears, stop and ask them to log in.

## Read the truth first

```bash
node --input-type=module -e "
import {readFileSync} from 'node:fs';
const {parseCv}=await import('./build-cv.mjs');
const cv=parseCv(readFileSync('cv.md','utf8'));
console.log('name    :', cv.name);
console.log('contact :', [cv.location,cv.phone,cv.email,cv.linkedin].join(' | '));
cv.skills.forEach(s=>console.log('skill   :', s.category+': '+s.value.slice(0,70)));
cv.experience.forEach(j=>console.log('job     :', [j.title,j.org,j.period].join(' | ')));
cv.education.forEach(e=>console.log('edu     :', [e.title,e.org,e.period].join(' | ')));
cv.projects.forEach(p=>console.log('project :', [p.title,p.org].join(' | ')));"
```

Then read each profile and diff against that. Report the differences before
changing anything, and let the user decide anything that turns on facts you
cannot verify.

## Browser mechanics that will otherwise cost you an hour

These are not theoretical; each one was hit on JobStreet or foundit.

| Symptom | What is actually happening |
|---|---|
| A click "succeeds" but nothing changes | `ref` clicks often only FOCUS the control. Zero network requests and no DOM change is the tell. Redo it as a coordinate `left_click` |
| `form_input` sets a value that vanishes | React-controlled autocompletes and comboboxes ignore programmatic sets. Click the field, `type`, then click the exact option in the dropdown |
| A dropdown option is picked that you did not choose | Enter selects the HIGHLIGHTED row, not the top one. Click the option; never press Enter to accept |
| Long typed text arrives mangled | `type` drops characters on long strings ("enterprise" → "eterprise"). For textareas use `form_input`, then re-read the field and verify before saving |
| A dropdown list will not scroll to the item | The list is clipped by the dialog. Use arrow keys: the highlight moves past the visible clip, then Enter |
| A long country/month list has no search | Typing does not filter. Scroll in coarse jumps, then back off a few ticks — overshooting is faster than creeping |

**Always verify after a page reload, never from the optimistic UI.** foundit's
profile-score widget in particular animates through wrong values (0%, 36%, 45%)
before settling; read it after it stops, or from the pending-actions list.

## Résumé-parser suggestions are not facts

Both boards parse an uploaded résumé into *suggested* entries shown under a
"Found in resumé" badge with **Add to Profile** / **Don't include** buttons.
These are frequently wrong and may come from an older résumé:

- Client projects appear as employment, with the client as the employer
- Employers appear that are not on the CV at all
- Several entries claim "Present" simultaneously, implying concurrent jobs
- A project host is parsed as a company (a GitHub-hosted project became a job at "GitHub")

Never accept them in bulk. Diff each against `cv.md` and put anything that
turns on the user's own history to them before acting.

**Editing a suggestion and saving it PROMOTES it onto the profile.** If the
same role already exists, that silently creates a duplicate. To correct a
suggestion's fields, expect it to become a real entry, and check afterwards
whether it now duplicates something.

## Money and identity fields

- **Currency is not a formality.** Salary controls default to the site's local
  currency. Entering a Malaysian figure while the selector says SGD overstates
  it more than threefold, and the form accepts it silently. Set the currency
  explicitly, then confirm the field's own echo (foundit prints
  "MYR Nine Thousand Three Hundred (Monthly)").
- **Current salary is visible to recruiters and anchors offers.** Before
  entering it, tell the user what it converts to in the target market, then let
  them decide. Do not treat it as a routine field.
- **Names:** boards registered through Google may carry the account's script
  (e.g. Chinese characters) while the CV is romanised. Keep the surname in the
  surname field — it must match the passport for any work-pass paperwork — and
  confirm the romanisation with the user rather than transliterating for them.

## Finish

Report a table of what each surface now holds versus `cv.md`, name anything
still divergent, and say plainly what you could not do (a profile photo cannot
be produced for them). Re-read each changed section after a reload and quote
the verified state, not the state you intended.
