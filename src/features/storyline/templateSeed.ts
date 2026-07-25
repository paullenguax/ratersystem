import type { TemplateSlide } from '@/types'

// Starter template content, transcribed from the real examiner script in
// `Storyline-Replacement/Old Interlocutor Tools/Air/main.html` (a prior
// HTML-based interlocutor tool for the TEAC speaking test). Loaded via the
// "Load example script" button on StorylineTemplateEditorPage — the admin
// reviews and explicitly saves it, rather than it being written directly.
// `notes` on every slide below is transcribed from that same file's
// `#help-and-message-centre` panel (its per-slide "Help Centre" advice —
// the old system's equivalent of this player's notes drawer). The two
// `candidateInstructions` blocks (Part 2/3 intro slides) are transcribed
// from `Storyline-Replacement/Task2.PNG`/`Task3.PNG`, the reference
// screenshots of what used to appear on the candidate's own screen during
// those tasks.
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
      kind: 'accept_reject_test',
      label: 'Accept or reject this test',
      notes: 'If this is not the right version, reject it and ask the Administrator to change the version in Test Diary.',
      scriptText:
        'Please check the information carefully to ensure you are delivering the most appropriate version to ' +
        'the correct candidate.\nIf this is not the right version, reject it and ask the Administrator to ' +
        'change the version in Test Diary.',
      slotSpec: {},
    },
    {
      kind: 'test_data_confirm',
      label: 'Confirm test data',
      notes:
        'In real use these fields will be filled in from the booking system automatically — for now, enter ' +
        'them by hand as a final "is this the right candidate/test" check before continuing. They also fill ' +
        'in the {Centre Name}/{Test Number}/{Examiner Name}/{Candidate Name} tokens in the Preamble below.',
      scriptText: 'Confirm the test details below before continuing.',
      slotSpec: {},
    },
    {
      kind: 'admin_checklist',
      label: 'Test room setup',
      notes:
        'Complete the Checklist, ticking each item to confirm everything is ready before continuing.\n' +
        'If the Candidate Screen does not open immediately, click the Screen icon above and wait for the ' +
        'indicator to turn green before continuing as this means that all the test content has been loaded successfully.',
      scriptText: "Don't forget to check...",
      checklistItems: [
        'Candidate screen working and visible to the candidate',
        'Sound is working and volume is sufficient',
        'Voice recorder is available and has sufficient battery power',
        'Computer is plugged in or sufficiently charged for the test',
      ],
      slotSpec: {},
    },
    {
      kind: 'examiner_preview',
      label: 'Preview Part 1 & 4 questions',
      previewParts: [1, 4],
      notes: "Please familiarise yourself with the Part 1 and Part 4 questions so they don't take you by surprise.",
      scriptText: 'Review the Part 1 and Part 4 questions for this version before starting the test.',
      slotSpec: {},
    },
    {
      kind: 'instruction',
      label: 'Invite candidate',
      candidateState: 'Logo',
      startsTestTimer: true,
      notes: 'Follow the prompts.',
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
      notes:
        'Ensure you read the text on screen carefully to introduce the test so that ALL data is captured clearly.\n\n' +
        'If a Monitoring Examiner or Auditor is present in the test room, introduce them also. Otherwise, you do ' +
        'not need to mention that nobody else is present.',
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
      nextButtonLabel: 'START TEST',
      notes:
        'Every part of the introduction must be clearly recorded. If the candidate is not speaking clearly or ' +
        'loudly enough, ask them to do so. You might need to reposition the voice recorder.\n\n' +
        'When you are both happy to begin, click the \'START TEST\' button.',
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
      notes:
        'Use the 2 scripted questions and simple extension questions to elicit an interactive sample of 3 ' +
        'minutes maximum, easing the candidate into the test.\n' +
        'Show them that you are listening with questions like:\n' +
        '- Can you tell more about...?\n' +
        '- Why...?/Why not?',
      scriptText: "OK, this is Part 1.\n{questions}\nNow I'm going to show you an image related to a(n) [role]'s role...",
      slotSpec: { questions: true, variables: ['role'] },
    },
    {
      kind: 'image_question_set',
      label: 'Part 1 — Image questions',
      candidateState: 'Task1Image',
      partNumber: 1,
      notes:
        'Indicate the image on the Candidate Screen. Listen carefully to the candidate\'s references and ask ' +
        'some extension questions to challenge them on role-related and familiar topics. "What do you mean by ' +
        '___?" and Why/How questions are useful for the assessment.\n' +
        'Elicit a sample of 4 to 5 minutes maximum.',
      scriptText: '{questions}\nThank you, we will now move on to Part 2',
      slotSpec: { questions: true, images: 1 },
    },
    {
      kind: 'instruction',
      label: 'Part 2 — Introduction',
      candidateState: 'Task2',
      partNumber: 2,
      notes: 'Indicate to the candidate that the 2 prompts are shown on the Candidate Screen.',
      candidateInstructions: [
        { text: 'Describe the communications between the pilot and the ATC.', bullet: true },
        { text: 'What unexpected information is reported?', bullet: true },
        { text: '[ Take notes to explain the details. ]', color: '#c00000' },
      ],
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
      notes:
        'Give the candidate a pen and some paper whilst you read the prompts. Play the volume check for the ' +
        'candidate and adjust the volume if appropriate.\n' +
        'If the candidate is happy, play Section 1.\n' +
        'Allow the candidate time to finish making notes and then encourage them to respond to both prompts as ' +
        'fully as possible.\n' +
        'If they make brief, vague or generic references, prompt them further by asking "Could you tell me any ' +
        'more about ____?"',
      scriptText:
        'Here is some paper and a pen. As you listen, take notes to explain the communications fully.\n' +
        'Do you have any questions?\n' +
        'We will first check the volume.\n' +
        'How is the volume?\n' +
        'OK, I will now play the first section of the communication.',
      slotSpec: { audio: 'single', maxPlays: 1, volumeCheck: true },
    },
    {
      kind: 'audio_response',
      label: 'Part 2 — Section 2 recording',
      candidateState: 'Task2',
      partNumber: 2,
      notes:
        'Allow the candidate time to finish making notes and then encourage them to report as much as possible.\n' +
        'Where necessary and appropriate, you should prompt the candidate to say more by asking, "Can you tell ' +
        'me any more about:"\n' +
        '- the unexpected situation?\n' +
        '- (any reference made that was not explained fully)?\n' +
        '- the pilot requests?\n' +
        '- the ATC support and questions?',
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
      notes: 'Respond to any queries the candidate has about the task.',
      candidateInstructions: [
        { text: 'After every recording, **__report the message__**.' },
        { text: '**Make notes** to help you explain in as much detail as possible:' },
        { text: 'who is speaking, pilot or ATC', bullet: true },
        { text: 'what the message is.', bullet: true },
        { text: '**You do __not__ need to report call-signs.**' },
        { text: 'If you want to hear the message again, just **ask**.' },
      ],
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
      notes:
        'Play the introduction recording and then play each recording.\n' +
        'Use the prompt "Report the message" if candidates do not naturally respond themselves. Otherwise, stay ' +
        'silent. Avoid prompting candidates to repeat recordings - they should ask themselves.\n' +
        'You can only play the recordings a maximum of two times.',
      scriptText: 'Do you have any questions?\nOK, I will now play Set 1.',
      slotSpec: { audio: 'set', audioSetSize: 3, maxPlays: 2 },
    },
    {
      kind: 'audio_set',
      label: 'Part 3 — Set 2',
      candidateState: 'Task3',
      partNumber: 3,
      notes:
        'Use the prompt "Report the message" if candidates do not naturally respond themselves. Otherwise, stay ' +
        'silent. Avoid prompting candidates to repeat recordings - they should ask themselves.',
      scriptText: 'OK, I will now play Set 2.',
      slotSpec: { audio: 'set', audioSetSize: 3, maxPlays: 2 },
    },
    {
      kind: 'audio_set',
      label: 'Part 3 — Set 3',
      candidateState: 'Task3',
      partNumber: 3,
      notes:
        'Use the prompt "Report the message" if candidates do not naturally respond themselves. Otherwise, stay ' +
        'silent. Avoid prompting candidates to repeat recordings - they should ask themselves.',
      scriptText: 'OK, I will now play Set 3.',
      slotSpec: { audio: 'set', audioSetSize: 3, maxPlays: 2 },
    },
    {
      kind: 'timed_picture_description',
      label: 'Part 4 — Picture ALPHA',
      candidateState: 'PictureAlpha',
      partNumber: 4,
      notes:
        'Take the pen and all of the paper back from the candidate and bridge into Part 4.\n' +
        'ALLOW UP TO 40 SECONDS FOR HIGHER-LEVEL CANDIDATES AND UP TO 60 SECONDS FOR LOWER-LEVEL CANDIDATES.',
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
      // Kept out of the Part 4 examiner-preview slide — the picture
      // questions depend on seeing the images live, so previewing them out
      // of context beforehand isn't useful; only the closing discussion
      // questions (Part 4 — Final questions) are worth reviewing in advance.
      previewExclude: true,
      notes:
        "Probe references with extension questions where necessary. But bear in mind that the ALPHA+BRAVO task " +
        "shouldn't take more than 4 minutes.",
      scriptText: 'Thank you. Now this is picture BRAVO. I have some questions to ask you about it.\n{questions}',
      slotSpec: { questions: true, images: 1 },
    },
    {
      kind: 'image_question_set',
      label: 'Part 4 — Both pictures',
      candidateState: 'PicturesAlphaAndBravo',
      partNumber: 4,
      previewExclude: true,
      notes:
        "Probe references with extension questions where necessary. But bear in mind that the ALPHA+BRAVO task " +
        "shouldn't take more than 4 minutes.",
      scriptText: "Now let's look at both pictures, ALPHA and BRAVO.\n{questions}",
      slotSpec: { questions: true, images: 2 },
    },
    {
      kind: 'question_set',
      label: 'Part 4 — Final questions',
      candidateState: 'Logo',
      partNumber: 4,
      notes:
        'Create a natural and interactive discussion by using the scripted questions and appropriate extension ' +
        "questions on 'less work-specific' topics.\n" +
        'Fully challenging candidates here may support the awarding of the highest scores.',
      scriptText: 'OK I’d like to finish the test by asking you some questions about {topic}.\n{questions}',
      slotSpec: { topic: true, questions: true },
    },
    {
      kind: 'closing',
      label: 'End of test',
      candidateState: 'Logo',
      notes:
        'Stop the Recording.\n' +
        'Ensure you click the CLOSE THIS TEST button to complete the test process.\n' +
        'Escort the candidate from the room, avoiding commenting upon their performance. Thank them for using TEAC.',
      scriptText: 'Thank you, this is the end of the test.',
      slotSpec: {},
    },
  ]

  return rows.map((row, i) => ({ ...row, id: crypto.randomUUID(), order: i }))
}
