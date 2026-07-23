import type { TemplateSlide } from '@/types'

// Starter template content, transcribed from the real examiner script in
// `Storyline-Replacement/Old Interlocutor Tools/Air/main.html` (a prior
// HTML-based interlocutor tool for the TEAC speaking test). Loaded via the
// "Load example script" button on StorylineTemplateEditorPage — the admin
// reviews and explicitly saves it, rather than it being written directly.
//
// {PortalField} tokens (Test Number, Date, Centre Name, Candidate Name,
// Examiner Name) are resolved at real test-run time from portal/booking
// data — left as literal tokens for now (Phase 2 concern).
// [placeholder] tokens (e.g. [role]) are filled once per StorylineTest.
// {questions} marks where a version's question list gets spliced in;
// {topic} marks a short per-content title (e.g. "Effective Radio
// Communications") — content that changes per Test/Part, not fixed wording.
// partNumber tags which of the 4 pooled Parts a slide belongs to; slides
// without it are whole-test content, authored directly on the Version.
export function buildSeedTemplateSlides(): TemplateSlide[] {
  const rows: Omit<TemplateSlide, 'id' | 'order'>[] = [
    {
      kind: 'admin_checklist',
      label: 'Test room setup',
      scriptText:
        'Technical Check\n' +
        '- Candidate Screen working and visible to the candidate\n' +
        '- Sound audible and volume sufficient\n' +
        '- Voice recorder ready with sufficient power\n' +
        '- Computer plugged in to guarantee power for complete test',
      slotSpec: {},
    },
    {
      kind: 'examiner_preview',
      label: 'Preview Part 1 & 4 questions',
      scriptText: 'Review the Part 1 and Part 4 questions for this version before starting the test.',
      slotSpec: {},
    },
    {
      kind: 'instruction',
      label: 'Invite candidate',
      candidateState: 'Logo',
      scriptText:
        'Invite the Candidate into the test room.\n' +
        'Place the recorder on the desk with the microphone directed towards the candidate and press record. ' +
        "Check that it is recording. Then click NEXT below to confirm you have started the recording.",
      slotSpec: {},
    },
    {
      kind: 'instruction',
      label: 'Preamble',
      candidateState: 'Logo',
      scriptText:
        'This is test number {Test Number} of the Test of English for Aeronautical Communication on {Date} ' +
        'at TEAC Centre {Centre Name}.\n' +
        'The candidate is {Candidate Name} and the examiner is {Examiner Name}.\n' +
        'Also present in the room is [state name(s)].',
      slotSpec: {},
    },
    {
      kind: 'instruction',
      label: 'Introduction',
      candidateState: 'Logo',
      scriptText:
        'Good morning/afternoon/evening. For the recording, please tell me your full name?\n' +
        'No recording devices are allowed in this room. Do you have any devices with you now?\n' +
        "Can I see your identification please? ... Thank you, that's fine.\n" +
        'You are registered as a(n) [role].\n' +
        'There are 4 parts to this test in which we will discuss routine and non-routine operations.\n' +
        'This is an aviation English communication test. Your knowledge of operational procedures is not being assessed.\n' +
        'During the test, speak as clearly as possible to demonstrate that you can speak clearly for international listeners.\n' +
        'If you do not understand my instructions, please tell me.\n' +
        'Is there any reason why you should not take this test today?\n' +
        "OK, let's begin the test.",
      slotSpec: { variables: ['role'] },
    },
    {
      kind: 'question_set',
      label: 'Part 1 — Experience questions',
      candidateState: 'Task1',
      partNumber: 1,
      scriptText: "OK, this is Part 1.\n{questions}\nNow I'm going to show you an image related to a(n) [role]'s role...",
      slotSpec: { questions: true, variables: ['role'] },
    },
    {
      kind: 'image_question_set',
      label: 'Part 1 — Image questions',
      candidateState: 'Task1Image',
      partNumber: 1,
      scriptText: '{questions}\nThank you, we will now move on to Part 2',
      slotSpec: { questions: true, images: 1 },
    },
    {
      kind: 'instruction',
      label: 'Part 2 — Introduction',
      candidateState: 'Task2',
      partNumber: 2,
      scriptText:
        'You will hear the first section of an RT communication between a pilot and a tower controller. ' +
        'I will play the recording once and cannot repeat it.\n' +
        'After listening, you will respond to the 2 prompts here on the screen:\n' +
        'Describe the communications between the pilot and the ATC\n' +
        'and...\n' +
        'What unexpected information is reported?',
      slotSpec: {},
    },
    {
      kind: 'audio_response',
      label: 'Part 2 — Section 1 recording',
      candidateState: 'Task2',
      partNumber: 2,
      scriptText:
        'Here is some paper and a pen. As you listen, take notes to explain the communications fully.\n' +
        'Do you have any questions?\n' +
        'We will first check the volume.\n' +
        '[Play Volume check in Menu above]\n' +
        'How is the volume?\n' +
        'OK, I will now play the first section of the communication.',
      slotSpec: { audio: 'single', maxPlays: 1 },
    },
    {
      kind: 'audio_response',
      label: 'Part 2 — Section 2 recording',
      candidateState: 'Task2',
      partNumber: 2,
      scriptText:
        "Before I play the next section of the communication, I'd like to discuss what might happen next ... " +
        'What do you think could happen?\n' +
        'What might the pilot do and need?\n' +
        'How might the controller support him, and what questions might the controller ask?\n' +
        "OK, thank you. So, let's listen to the last section of the communication. As you listen, make notes " +
        'to help you explain the exchanges to me in as much detail as possible.\n' +
        'OK, please now explain those communications in as much detail as you can.\n' +
        'OK thank you. That completes Part 2, we will now move on to Part 3.',
      slotSpec: { audio: 'single', maxPlays: 1 },
    },
    {
      kind: 'audio_response',
      label: 'Part 3 — Instructions and example',
      candidateState: 'Task3',
      partNumber: 3,
      scriptText:
        'I will play you 3 sets of 3 recordings of pilots or controllers talking in non-routine situations. ' +
        'Each set relates to a different aviation topic.\n' +
        'After every recording, you need to report the message. As you listen, make notes to help you explain ' +
        'the messages in as much detail as possible.\n' +
        'Explain who is speaking, pilot or ATC, and explain what the message is.\n' +
        'You do not need to report the callsigns.\n' +
        'You will hear each recording once. If you want to hear the message again, just ask and I will play it ' +
        'once more only.\n' +
        "Before we start, let's listen to an example so you know what to expect.",
      slotSpec: { audio: 'single', maxPlays: 2 },
    },
    {
      kind: 'audio_set',
      label: 'Part 3 — Set 1',
      candidateState: 'Task3',
      partNumber: 3,
      scriptText: 'Do you have any questions?\nOK, I will now play Set 1.',
      slotSpec: { audio: 'set', audioSetSize: 3, maxPlays: 2 },
    },
    {
      kind: 'audio_set',
      label: 'Part 3 — Set 2',
      candidateState: 'Task3',
      partNumber: 3,
      scriptText: 'OK, I will now play Set 2.',
      slotSpec: { audio: 'set', audioSetSize: 3, maxPlays: 2 },
    },
    {
      kind: 'audio_set',
      label: 'Part 3 — Set 3',
      candidateState: 'Task3',
      partNumber: 3,
      scriptText: 'OK, I will now play Set 3.',
      slotSpec: { audio: 'set', audioSetSize: 3, maxPlays: 2 },
    },
    {
      kind: 'timed_picture_description',
      label: 'Part 4 — Picture ALPHA',
      candidateState: 'PictureAlpha',
      partNumber: 4,
      scriptText:
        'OK, thank you. Can I take the paper and pen back please? ... That completes Part 3, we will now move ' +
        'on to Part 4.\n' +
        "I'm going to show you a picture - this is picture ALPHA. You have 30 seconds to describe it fully, " +
        'starting now.',
      timing: { responseSeconds: 30 },
      slotSpec: { images: 1 },
    },
    {
      kind: 'image_question_set',
      label: 'Part 4 — Picture BRAVO',
      candidateState: 'PictureBravo',
      partNumber: 4,
      scriptText: 'Thank you. Now this is picture BRAVO. I have some questions to ask you about it.\n{questions}',
      slotSpec: { questions: true, images: 1 },
    },
    {
      kind: 'image_question_set',
      label: 'Part 4 — Both pictures',
      candidateState: 'PicturesAlphaAndBravo',
      partNumber: 4,
      scriptText: "Now let's look at both pictures, ALPHA and BRAVO.\n{questions}",
      slotSpec: { questions: true, images: 2 },
    },
    {
      kind: 'question_set',
      label: 'Part 4 — Final questions',
      candidateState: 'Logo',
      partNumber: 4,
      scriptText: 'OK I’d like to finish the test by asking you some questions about {topic}.\n{questions}',
      slotSpec: { topic: true, questions: true },
    },
    {
      kind: 'closing',
      label: 'End of test',
      candidateState: 'Logo',
      scriptText: 'Thank you, this is the end of the test.',
      slotSpec: {},
    },
  ]

  return rows.map((row, i) => ({ ...row, id: crypto.randomUUID(), order: i }))
}
