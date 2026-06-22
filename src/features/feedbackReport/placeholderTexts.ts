export type FeedbackArea = 'pronunciation' | 'structure' | 'vocabulary' | 'fluency' | 'comprehension' | 'interactions'

export const FEEDBACK_AREAS: { key: FeedbackArea; label: string }[] = [
  { key: 'pronunciation',  label: 'Pronunciation' },
  { key: 'structure',      label: 'Structure' },
  { key: 'vocabulary',     label: 'Vocabulary' },
  { key: 'fluency',        label: 'Fluency' },
  { key: 'comprehension',  label: 'Comprehension' },
  { key: 'interactions',   label: 'Interactions' },
]

export const PLACEHOLDER_TEXTS: Record<FeedbackArea, Record<number, string>> = {
  pronunciation: {
    2: `You were awarded high / low Level 2.

This is because examiners thought that:
• There were few examples where your speech is easily understandable.
• You do not connect enough ideas to use stress or intonation.

For example:
• ...

What you can do:
• Practice the different sounds of English, ideally with the help of a teacher, especially consonant sounds and groups of consonants at the beginnings of words.
• Practice making sentences in a connected way, using stress and intonation.`,

    3: `You were awarded high / low Level 3.

This is because examiners thought that:
• There were severe word-level distortions throughout the test. This means that often it was not clear what you were saying, because of certain sounds.
• There were problems with your phrase-level pronunciation (rhythm, stress or intonation) that commonly caused a problem in understanding.

For example:
• ...

What you can do:
• Practice the difference between long and short vowels.
• Practice placing stress on words with more than one syllable.
• Practice saying words that finish in consonants.
• Practice using intonation to express meaning in your sentences.
• Practice speaking in a more connected way, joining sentences together with rhythm and stressing key words.`,

    4: `You were awarded high / low Level 4.

This is because examiners thought that:
• There were word-level distortions throughout the test. This means that sometimes it was not clear what you were saying, because of certain sounds.
• There were problems with your phrase-level pronunciation (rhythm, stress or intonation) that caused a problem in understanding repeatedly during the test.

For example:
• ...

What you can do:
• Practice the difference between long and short vowels.
• Practice placing stress on words with more than one syllable.
• Practice saying words that finish in consonants.
• Practice using intonation to express meaning in your sentences.
• Practice speaking in a more connected way, joining sentences together with rhythm and stressing key words.
• Practice making your speech as clear as possible by slowing down your speed of speech slightly.`,

    5: `You were awarded high / low Level 5.

This is because examiners thought that:
• There were word-level distortions noted in more than one part of the test. This means that occasionally it was not clear what you were saying, because of certain sounds.
• There were problems with phrase-level features on more than one occasion. This means that now and then your speech was unclear due to issues with rhythm, stress or intonation.

For example:
• ...

What you can do:
• Work on phrase level features, ideally with a teacher.
• Identify any problematic English sounds you may have, and work on minimizing the effect of these.`,

    6: `You were awarded Level 6.

This is because examiners thought that your performance matched the ICAO Level 6 description.

For your awareness:
• Your pronunciation of...`,
  },

  structure: {
    2: `You were awarded high / low Level 2.

This is because examiners thought that:
• You don't use enough sentences, except ones you have memorized.

For example:
• ...

What you can do:
• Practice basic English grammatical forms: present and past simple, and use of future and continuous forms, to explain words in aviation, talk about what you can see, etc.`,

    3: `You were awarded high / low Level 3.

This is because examiners thought that:
• Your basic structures were not well-controlled even in relatively simple tasks. This means you made mistakes with some simple grammar forms, which can confuse listeners.

For example:
• ...

What you can do:
• Pay attention to simple verb forms such as "it is hovering" and "he asked".
• Use some simple "if" structures: "I want to know if..."`,

    4: `You were awarded high / low Level 4.

This is because examiners thought that:
• There were patterns of errors in basic structures throughout the test. This means you made mistakes with some simple grammatical forms, which can confuse listeners.
• You did not use any complex structures in the test.

For example:
• ...

What you can do:
• Try to identify which basic structures you typically use wrongly, and work on correcting these errors.
• Add more complex structures to your answers (for example, perhaps you tend to answer with only very short, simple sentences and you could extend these ideas).`,

    5: `You were awarded high / low Level 5.

This is because examiners thought that:
• There were patterns of errors in basic structures which did not interfere with meaning. This means you made mistakes with some simple grammatical forms which, although not confusing, are too numerous to award level 6.
• You used complex structures, but made errors and these interfered with meaning.

For example:
• ...

What you can do:
• Try to identify which basic structures you typically use wrongly, or are unsure about, and work on correcting these errors.
• Practice using those complex structures that you know more accurately.`,

    6: `You were awarded Level 6.

This is because examiners thought that your performance matched the ICAO Level 6 description.

For your awareness:
• Your use of...`,
  },

  vocabulary: {
    2: `You were awarded high / low Level 2.

This is because examiners thought that:
• You only use operational words, or you don't use many words at all.

For example:
• ...

What you can do:
• You need to learn more vocabulary, especially related to your work and aviation.`,

    3: `You were awarded high / low Level 3.

This is because examiners thought that:
• Your lack of accuracy with common words may confuse the listener.
• You do not have the range to discuss work-related processes in English.
• You cannot paraphrase easily.

For example:
• ...

What you can do:
• Check your use of vocabulary, especially for basic words connected with flying operations.
• Check your use of simple prepositions (e.g. "over" vs. "on").
• Try to learn more words to talk about what you do at work, and some emergency situations.
• Practice paraphrasing: explaining things using other words.`,

    4: `You were awarded high / low Level 4.

This is because examiners thought that:
• You sometimes didn't have words to discuss work-related situations, or could not paraphrase.
• You only used very common language.
• You made too many mistakes with the accuracy of your word choices.

For example:
• ...

What you can do:
• Practice your ability to paraphrase, for example explaining what you do in aviation using other words.
• Increase your vocabulary range, including synonyms and some less common vocabulary.
• Check the accuracy of the words you use when talking about your work, perhaps with the help of a teacher.`,

    5: `You were awarded high / low Level 5.

This is because examiners thought that:
• You sometimes lack the language to be clear when talking about topics outside of your daily role in aviation.
• You made too many mistakes with the accuracy of your word choices to award Level 6.

For example:
• ...

What you can do:
• Check the accuracy of the words you use when discussing general aviation topics, perhaps with a teacher.
• Increase your vocabulary so that you can discuss a wide variety of aviation-related topics, not necessarily related to your work, including less common words and phrases.
• Sometimes use words or phrases that show you can use different degrees of formality or register (for instance things like "I see what you mean").`,

    6: `You were awarded Level 6.

This is because examiners thought that your performance matched the ICAO Level 6 description.

For your awareness:
• Your use of...`,
  },

  fluency: {
    2: `You were awarded high / low Level 2.

This is because examiners thought that:
• The only times you connected words and ideas was when you had memorised the ideas.
• There were too many long silences.

For example:
• ...

What you can do:
• Practice talking English as much as possible, with a teacher.`,

    3: `You were awarded high / low Level 3.

This is because examiners thought that:
• Your speech is typically interrupted by long pauses and repetitions. This means you used too many fillers like "errr..." and sometimes did not finish your sentences.
• You did not use discourse markers or connectors often enough.

For example:
• ...

What you can do:
• Use more simple connectors such as "and", "but", "so" or "because" or discourse markers like "firstly" and "next" to help you keep speaking.`,

    4: `You were awarded high / low Level 4.

This is because examiners thought that:
• Your speech flow was interrupted in less familiar contexts. This means you used too many fillers like "err" or "um" or repetitions when you were thinking of what to say.
• Your coherence was lost even in relatively simple discourse. This means sometimes you did not connect your ideas together clearly enough.

For example:
• ...

What you can do:
• Practice using more connectors and discourse markers when speaking, to make your meaning clearer to the listener.
• Practice speaking for longer turns without needing to repeat yourself or use filler language (e.g. "ummm", but also phrases that you typically repeat).`,

    5: `You were awarded high / low Level 5.

This is because examiners thought that:
• Your speech flow may be uniform or unvaried. This means you spoke either quickly or slowly at a similar pace throughout the test, and did not show you can vary your speech flow. You may have had to use hesitation or excessive reformulation to keep the turn.
• Your coherence may have been lost at times. This means some ideas were not fully connected when speaking at length, or you were listing ideas rather than extending them naturally.

For example:
• ...

What you can do:
• Practice speaking at length, but using features of speech flow to emphasise your ideas: speeding up or slowing down.
• Rather than listing ideas as answers to more complex questions, talk about each item on the list in turn: "First, XXX. This means YYYY. Then there is ZZZZ. This means...".`,

    6: `You were awarded Level 6.

This is because examiners thought that your performance matched the ICAO Level 6 description.

For your awareness:
• Your use of...`,
  },

  comprehension: {
    2: `You were awarded high / low Level 2.

This is because examiners thought that:
• You only understood very simple questions from the examiner, and could not report any recordings accurately.

For example:
• ...

What you can do:
• Listen as much as possible to people speaking English.
• Improve your vocabulary.
• Try to copy what you hear others saying.
• Ask the examiner to repeat some questions, or to use other words.`,

    3: `You were awarded high / low Level 3.

This is because examiners thought that:
• You misunderstood some examiner questions.
• You did not demonstrate general understanding of many of the recordings.

For example:
• ...

What you can do:
• Check that you understand examiner questions: if you are not sure, ask them to repeat or use other words.
• Repeat more recordings. Often they are easier to understand the second time.
• Listen to English speakers more often (podcasts, videos and films etc.) and check your understanding.
• Ask the examiner to repeat some questions, or use other words.`,

    4: `You were awarded high / low Level 4.

This is because examiners thought that:
• You misunderstood some more complex examiner questions.
• You did not demonstrate full understanding of enough of the recordings.

For example:
• ...

What you can do:
• Repeat more examiner questions if you're not sure what the examiner wants you to do. Sometimes the question is designed to be more difficult to understand, so it is appropriate to ask for clarification.
• Try to give detailed responses to the recordings, not only short summaries. Show you understand as much as possible from the recordings.
• Repeat recordings where necessary. At least give the "general idea" of the message, even if you don't catch all the details.`,

    5: `You were awarded high / low Level 5.

This is because examiners thought that:
• You misunderstood some complex examiner questions and did not demonstrate full understanding of enough of the recordings.
• You needed repetition to confirm the meaning of even relatively simple messages.

For example:
• ...

What you can do:
• Avoid excessive repetitions where possible: it is normal to repeat some of the recordings in a set, especially the longer ones. But don't ask for repetition unless you have already demonstrated some understanding of the recording. (N.B. some level 6 candidates have not reported anything on first listening but have asked for repetition only to consolidate their responses.)
• Check that you understand examiner questions if you are not sure. Some of the more complex questions are designed to be difficult.
• Demonstrate full understanding of the recordings wherever possible: you may need to practice note-taking skills with some example recordings.`,

    6: `You were awarded Level 6.

This is because examiners thought that your performance matched the ICAO Level 6 description.

For your awareness:
• Your use of...`,
  },

  interactions: {
    2: `You were awarded high / low Level 2.

This is because examiners thought that:
• You have difficulty interacting with the other speaker even in basic situations.

For example:
• ...

What you can do:
• With a teacher, practice asking and answering questions.
• Learn some ways to check your understanding of other people: how to ask them to repeat, slow down and so on.`,

    3: `You were awarded high / low Level 3.

This is because examiners thought that:
• You have difficulty maintaining effective interactions in some familiar and most unfamiliar situations.

For example:
• ...

What you can do:
• Use some simple but effective ways to clarify your interactions, e.g. "Can you explain what you mean?"
• Show that you can agree or disagree naturally with what the examiner says.`,

    4: `You were awarded high / low Level 4.

This is because examiners thought that:
• You have difficulty maintaining effective interactions sometimes.
• Your responses to questions were generic or not on topic.

For example:
• ...

What you can do:
• Don't be silent in response: always try to keep the interaction going by asking questions of the examiner if you're unsure of what to do.
• Don't try to "remember" good answers: just answer with what seems appropriate at the time.
• Try to base your responses on what the examiner has just said by agreeing, disagreeing or clarifying or providing more information.`,

    5: `You were awarded high / low Level 5.

This is because examiners thought that:
• You sometimes gave inappropriate or generic responses.
• Your interactions were not always natural.

For example:
• ...

What you can do:
• Practice giving full answers to questions, clarifying when you're unsure about what a question is asking, and trying not to "act" in any particular manner during the test: react to the examiner as a colleague or associate, rather than as an examiner.
• Always try to align your responses as closely as possible to the specific topic of the examiner's question. Use examples if you can to support your ideas.`,

    6: `You were awarded Level 6.

This is because examiners thought that your performance matched the ICAO Level 6 description.

For your awareness:
• Your use of...`,
  },
}
