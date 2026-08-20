const { deriveComboImages } = require('./deriveComboImages')

// Ported from src/features/storyline/resolveItems.ts /
// player-src/shared/resolveItems.ts — keep in sync (a third leg of this
// codebase's established "duplicate, no automated enforcement" convention,
// needed here because functions/ has no build step to share TS modules
// with src/ or player-src/). Behavioral port of the player-src/shared/
// copy specifically — `parts` here is keyed to the lighter
// `{slotContent}`-only shape (matching a raw Firestore storyline_parts
// doc), not the full authoring StorylinePart.
//
// Used by getStorylineLiveContent (index.js) to re-run the exact same
// resolve computation the admin app already does at Preview/Publish time,
// fresh on every request — see that function for why (live text for
// versionType 'live' Versions).

function normalizeChecklistItems(items) {
  return items?.map(item => (typeof item === 'string' ? { text: item } : item))
}

function substituteVariables(text, variables) {
  if (!variables) return text
  let result = text
  for (const [key, value] of Object.entries(variables)) {
    result = result.split(`[${key}]`).join(value)
  }
  return result
}

function formatQuestions(questions) {
  if (!questions || questions.length === 0) return ''
  return questions.map(q => `- ${q}`).join('\n')
}

function resolveScriptText(slide, testVariables, slot) {
  let text = substituteVariables(slide.scriptText, testVariables)
  if (slide.slotSpec.topic) {
    text = text.includes('{topic}') ? text.replace('{topic}', slot?.topic ?? '') : text
  }
  if (slide.slotSpec.questions) {
    const questionsBlock = formatQuestions(slot?.questions)
    text = text.includes('{questions}')
      ? text.replace('{questions}', questionsBlock ? `\n${questionsBlock}\n` : '')
      : [text, questionsBlock].filter(Boolean).join('\n')
  }
  return text
}

function slidePreviewEntry(slide, slot) {
  const topic = slide.slotSpec.topic ? slot?.topic : undefined
  const questions = slide.slotSpec.questions ? slot?.questions?.filter(Boolean) : undefined
  if (!topic && !questions?.length) return undefined
  const entry = { label: slide.label }
  if (topic) entry.topic = topic
  if (questions?.length) entry.questions = questions
  return entry
}

function resolveMedia(slide, slot) {
  const images = slot?.images?.filter(Boolean)
  const audioClips = []
  const maxPlays = slide.slotSpec.maxPlays

  const maxPlaysField = maxPlays !== undefined ? { maxPlays } : {}
  if (slide.slotSpec.audio === 'single' && slot?.audio?.recordings?.[0]) {
    audioClips.push({ label: slide.label, url: slot.audio.recordings[0], ...maxPlaysField })
  }
  if (slide.slotSpec.audio === 'set') {
    if (slot?.audio?.intro) audioClips.push({ label: 'Introduction', url: slot.audio.intro, ...maxPlaysField })
    slot?.audio?.recordings?.forEach((url, i) => {
      if (url) audioClips.push({ label: `Recording ${i + 1}`, url, ...maxPlaysField })
    })
  }
  if (slide.slotSpec.volumeCheck && slot?.audio?.volumeCheck) {
    audioClips.push({ label: 'Volume check', url: slot.audio.volumeCheck })
  }

  const media = {}
  if (images && images.length > 0) media.images = images
  if (audioClips.length > 0) media.audioClips = audioClips
  return Object.keys(media).length > 0 ? media : undefined
}

function resolveItems(slides, testVariables, testSlotContent, parts, testDisplayName) {
  const sorted = [...slides].sort((a, b) => a.order - b.order)

  function slotFor(slide) {
    return slide.partNumber ? parts[slide.partNumber]?.slotContent[slide.id] : testSlotContent[slide.id]
  }

  const wholeTestCombo = deriveComboImages(
    sorted.filter(s => !s.partNumber),
    id => testSlotContent[id]?.images?.[0],
  )
  const partCombos = {}
  for (const n of [1, 2, 3, 4]) {
    const part = parts[n]
    partCombos[n] = deriveComboImages(
      sorted.filter(s => s.partNumber === n),
      id => part?.slotContent[id]?.images?.[0],
    )
  }

  const previewByPart = {}
  for (const slide of sorted) {
    if (!slide.partNumber || slide.previewExclude) continue
    const entry = slidePreviewEntry(slide, slotFor(slide))
    if (entry) (previewByPart[slide.partNumber] ??= []).push({ ...entry, partNumber: slide.partNumber })
  }

  return sorted.map(slide => {
    const slot = slotFor(slide)
    const item = {
      id: slide.id,
      order: slide.order,
      kind: slide.kind,
      label: slide.label,
      candidateState: slide.candidateState ?? '',
      examinerText: resolveScriptText(slide, testVariables, slot),
    }
    if (slide.notes) item.notes = substituteVariables(slide.notes, testVariables)
    if (slide.candidateInstructions?.length) {
      item.candidateInstructions = slide.candidateInstructions.map(line => ({ ...line, text: substituteVariables(line.text, testVariables) }))
    }
    const checklistItems = normalizeChecklistItems(slide.checklistItems)
    if (checklistItems?.length) item.checklistItems = checklistItems
    if (slide.kind === 'accept_reject_test' && testDisplayName) item.testDisplayName = testDisplayName
    if (slide.startsTestTimer) item.startsTestTimer = slide.startsTestTimer
    if (slide.nextButtonLabel) item.nextButtonLabel = slide.nextButtonLabel
    if (slide.previewParts?.length) {
      const previewContent = slide.previewParts.flatMap(n => previewByPart[n] ?? [])
      if (previewContent.length) item.previewContent = previewContent
    }
    if (slide.timing) item.timing = slide.timing

    let media = resolveMedia(slide, slot)
    const combo = slide.partNumber ? partCombos[slide.partNumber]?.[slide.id] : wholeTestCombo[slide.id]
    if (combo) media = { ...media, images: combo.images }
    if (media) item.media = media
    return item
  })
}

exports.resolveItems = resolveItems
