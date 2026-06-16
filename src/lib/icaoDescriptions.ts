export const ICAO_DESCRIPTIONS: Record<string, Record<number, string>> = {
  Pronunciation: {
    1: 'Pre-elementary: Performs at a level below the Elementary level',
    2: 'Elementary: Pronunciation, stress, rhythm, and intonation are heavily influenced by the first language or regional variation and usually interfere with ease of understanding',
    3: 'Pre-operational: Pronunciation, stress, rhythm, and intonation are influenced by the first language or regional variation and frequently interfere with ease of understanding',
    4: 'Operational: Pronunciation, stress, rhythm, and intonation are influenced by the first language or regional variation but only sometimes interfere with ease of understanding',
    5: 'Extended: Pronunciation, stress, rhythm, and intonation, though influenced by the first language or regional variation, rarely interfere with ease of understanding',
    6: 'Expert: Pronunciation, stress, rhythm, and intonation, though possibly influenced by the first language or regional variation, almost never interfere with ease of understanding',
  },
  Structure: {
    1: 'Pre-elementary: Performs at a level below the Elementary level',
    2: 'Elementary: Shows only limited control of a few simple, memorized grammatical structures and sentence patterns',
    3: 'Pre-operational: Basic grammatical structures and sentence patterns associated with predictable situations are not always well controlled. Errors frequently interfere with meaning',
    4: 'Operational: Basic grammatical structures and sentence patterns are used creatively and are usually well controlled. Errors may occur, particularly in unusual or unexpected circumstances, but rarely interfere with meaning',
    5: 'Extended: Basic grammatical structures and sentence patterns are consistently well controlled. Complex structures are attempted but with errors which sometimes interfere with meaning',
    6: 'Expert: Both basic and complex grammatical structures and sentence patterns are consistently well controlled',
  },
  Vocabulary: {
    1: 'Pre-elementary: Performs at a level below the Elementary level',
    2: 'Elementary: Limited vocabulary range consisting only of isolated words and memorized phrases',
    3: 'Pre-operational: Vocabulary range and accuracy are often sufficient to communicate on common, concrete, or work-related topics, but range is limited and the word choice often inappropriate. Is often unable to paraphrase successfully when lacking vocabulary',
    4: 'Operational: Vocabulary range and accuracy are usually sufficient to communicate effectively on common, concrete, and work-related topics. Can often paraphrase successfully when lacking vocabulary in unusual or unexpected circumstances',
    5: 'Extended: Vocabulary range and accuracy are sufficient to communicate effectively on common, concrete, and work-related topics. Paraphrases consistently and successfully. Vocabulary is sometimes idiomatic',
    6: 'Expert: Vocabulary range and accuracy are sufficient to communicate effectively on a wide variety of familiar and unfamiliar topics. Vocabulary is idiomatic, nuanced, and sensitive to register',
  },
  Fluency: {
    1: 'Pre-elementary: Performs at a level below the Elementary level',
    2: 'Elementary: Can produce very short, isolated, memorized utterances with frequent pausing and a distracting use of fillers to search for expressions and to articulate less familiar words',
    3: 'Pre-operational: Produces stretches of language, but phrasing and pausing are often inappropriate. Hesitations or slowness in language processing may prevent effective communication. Fillers are sometimes distracting',
    4: 'Operational: Produces stretches of language at an appropriate tempo. There may be occasional loss of fluency on transition from rehearsed or formulaic speech to spontaneous interaction, but this does not prevent effective communication. Can make limited use of discourse markers or connectors. Fillers are not distracting',
    5: 'Extended: Able to speak at length with relative ease on familiar topics but may not vary speech flow as a stylistic device. Can make use of appropriate discourse markers or connectors',
    6: 'Expert: Able to speak at length with a natural, effortless flow. Varies speech flow for stylistic effect, e.g. to emphasize a point. Uses appropriate discourse markers and connectors spontaneously',
  },
  Comprehension: {
    1: 'Pre-elementary: Performs at a level below the Elementary level',
    2: 'Elementary: Comprehension is limited to isolated, memorized phrases when they are carefully and slowly articulated',
    3: 'Pre-operational: Comprehension is often accurate on common, concrete, and work-related topics when the accent or variety used is sufficiently intelligible for an international community of users. May fail to understand a linguistic or situational complication or an unexpected turn of events',
    4: 'Operational: Comprehension is mostly accurate on common, concrete, and work-related topics when the accent or variety used is sufficiently intelligible for an international community of users. When the speaker is confronted with a linguistic or situational complication or an unexpected turn of events, comprehension may be slower or require clarification strategies',
    5: 'Extended: Comprehension is accurate on common, concrete, and work-related topics and mostly accurate when the speaker is confronted with a linguistic or situational complication or an unexpected turn of events. Is able to comprehend a range of speech varieties (dialect and/or accent) or registers',
    6: 'Expert: Comprehension is consistently accurate in nearly all contexts and includes comprehension of linguistic and cultural subtleties',
  },
  Interactions: {
    1: 'Pre-elementary: Performs at a level below the Elementary level',
    2: 'Elementary: Response time is slow and often inappropriate. Interaction is limited to simple routine exchanges',
    3: 'Pre-operational: Responses are sometimes immediate, appropriate, and informative. Can initiate and maintain exchanges with reasonable ease on familiar topics and in predictable situations. Generally inadequate when dealing with an unexpected turn of events',
    4: 'Operational: Responses are usually immediate, appropriate, and informative. Initiates and maintains exchanges even when dealing with an unexpected turn of events. Deals adequately with apparent misunderstandings by checking, confirming, or clarifying',
    5: 'Extended: Responses are immediate, appropriate, and informative. Manages the speaker/listener relationship effectively',
    6: 'Expert: Interacts with ease in nearly all situations. Is sensitive to verbal and non-verbal cues and responds to them appropriately',
  },
}

export const LEVEL_LABELS = ['Pre-elem', 'Elementary', 'Pre-op', 'Operational', 'Extended', 'Expert']
