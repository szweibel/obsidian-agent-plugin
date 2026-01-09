/**
 * Prose linting module with write-good integration and AI-ism detection
 */

import writeGood from 'write-good';

export interface LintSuggestion {
  index: number;
  offset: number;
  reason: string;
  type: 'write-good' | 'ai-ism';
}

// AI-isms: words and phrases commonly overused by AI language models
const AI_ISMS: Array<{ pattern: RegExp; reason: string }> = [
  // ===== SINGLE WORDS =====

  // Classic AI tells
  { pattern: /\bdelve\b/gi, reason: '"delve" is the #1 AI-ism - consider "explore", "examine", or "look into"' },
  { pattern: /\bcrucial\b/gi, reason: '"crucial" is overused by AI - consider "important", "key", or "essential"' },
  { pattern: /\bpivotal\b/gi, reason: '"pivotal" is an AI-ism - consider "important" or "significant"' },
  { pattern: /\brobust\b/gi, reason: '"robust" is an AI-ism - be more specific about what makes it strong' },
  { pattern: /\bseamless(ly)?\b/gi, reason: '"seamless" is overused by AI - consider "smooth" or "easy"' },
  { pattern: /\bmeticulous(ly)?\b/gi, reason: '"meticulous" is an AI-ism - consider "careful", "thorough", or "detailed"' },

  // Journey/exploration words
  { pattern: /\bjourney\b/gi, reason: '"journey" is overused by AI - consider "process", "experience", or be specific' },
  { pattern: /\bembark(s|ed|ing)?\b/gi, reason: '"embark" is an AI-ism - consider "start", "begin", or "undertake"' },
  { pattern: /\bnavigat(e|ing|ed|ion)\b/gi, reason: '"navigate" is overused by AI for non-physical contexts - consider "handle", "manage", or "work through"' },
  { pattern: /\bunpack(ing|ed|s)?\b/gi, reason: '"unpack" is an AI-ism - consider "explain", "analyze", or "examine"' },

  // Unlock/reveal words
  { pattern: /\bunlock(s|ed|ing)?\b/gi, reason: '"unlock" is an AI-ism - describe what becomes available' },
  { pattern: /\bunveil(s|ed|ing)?\b/gi, reason: '"unveil" is an AI-ism - consider "reveal", "show", or "introduce"' },
  { pattern: /\bunleash(es|ed|ing)?\b/gi, reason: '"unleash" is an AI-ism - describe the actual result' },

  // Power/impact words
  { pattern: /\belevat(e|es|ed|ing)\b/gi, reason: '"elevate" is an AI-ism - describe the specific improvement' },
  { pattern: /\bempowering?\b/gi, reason: '"empower" is an AI-ism - consider "enable", "help", or "allow"' },
  { pattern: /\bbolster(s|ed|ing)?\b/gi, reason: '"bolster" is an AI-ism - consider "support", "strengthen", or "reinforce"' },
  { pattern: /\bunderscores?\b/gi, reason: '"underscore" is an AI-ism - consider "emphasize", "highlight", or "show"' },
  { pattern: /\bexemplif(y|ies|ied)\b/gi, reason: '"exemplify" is an AI-ism - consider "show", "demonstrate", or give the example directly' },

  // Corporate/business jargon
  { pattern: /\bleverage\b/gi, reason: '"leverage" is overused - consider "use", "apply", or "take advantage of"' },
  { pattern: /\bsynergy\b/gi, reason: '"synergy" is corporate AI-speak - describe the actual benefit' },
  { pattern: /\bsynergistic\b/gi, reason: '"synergistic" is corporate AI-speak - describe the actual benefit' },
  { pattern: /\bactionable\b/gi, reason: '"actionable" is an AI-ism - consider "practical" or "useful"' },
  { pattern: /\bimpactful\b/gi, reason: '"impactful" is an AI-ism - describe the specific impact' },
  { pattern: /\bscalable\b/gi, reason: '"scalable" is overused - be specific about growth potential' },
  { pattern: /\bstakeholder(s)?\b/gi, reason: '"stakeholder" is corporate AI-speak - name who you mean' },

  // Innovation/transformation words
  { pattern: /\binnovativ(e|ion)\b/gi, reason: '"innovative" is overused - describe what makes it new or different' },
  { pattern: /\btransformativ(e|ion)\b/gi, reason: '"transformative" is an AI-ism - describe the actual change' },
  { pattern: /\brevolution(ize|izing|ized|ary)?\b/gi, reason: '"revolutionize" is an AI-ism - describe the actual change' },
  { pattern: /\bgame[- ]?chang(er|ing)\b/gi, reason: '"game-changer" is an AI cliché - describe the actual impact' },
  { pattern: /\bcutting[- ]?edge\b/gi, reason: '"cutting-edge" is an AI-ism - describe what makes it advanced' },
  { pattern: /\bgroundbreaking\b/gi, reason: '"groundbreaking" is an AI-ism - describe what makes it new' },
  { pattern: /\bpioneering\b/gi, reason: '"pioneering" is an AI-ism - describe the specific innovation' },

  // Process/optimization words
  { pattern: /\butiliz(e|ing|ed|ation)\b/gi, reason: '"utilize" is an AI-ism - just say "use"' },
  { pattern: /\bfacilitat(e|ing|ed|ion)\b/gi, reason: '"facilitate" is an AI-ism - consider "help", "enable", or "make possible"' },
  { pattern: /\boptimiz(e|ing|ed|ation)\b/gi, reason: '"optimize" is overused - be specific about the improvement' },
  { pattern: /\bstreamlin(e|ing|ed)\b/gi, reason: '"streamline" is an AI-ism - describe the actual simplification' },
  { pattern: /\bcommenc(e|ing|ed)\b/gi, reason: '"commence" is an AI-ism - just say "start" or "begin"' },

  // Holistic/comprehensive words
  { pattern: /\bholistic(ally)?\b/gi, reason: '"holistic" is an AI-ism - be specific about what you mean' },
  { pattern: /\bcomprehensive(ly)?\b/gi, reason: '"comprehensive" is overused by AI - be specific about scope' },
  { pattern: /\bmultifaceted\b/gi, reason: '"multifaceted" is an AI-ism - describe the specific aspects' },
  { pattern: /\bnuanced\b/gi, reason: '"nuanced" is an AI-ism - describe the specific subtleties' },
  { pattern: /\bintricate\b/gi, reason: '"intricate" is an AI-ism - describe what makes it complex' },

  // Metaphorical words
  { pattern: /\btapestry\b/gi, reason: '"tapestry" is an AI-ism when used metaphorically' },
  { pattern: /\blandscape\b/gi, reason: '"landscape" is an AI-ism when used metaphorically - be more specific' },
  { pattern: /\brealm\b/gi, reason: '"realm" is an AI-ism - consider "area", "field", or "domain"' },
  { pattern: /\bbeacon\b/gi, reason: '"beacon" is an AI-ism when used metaphorically' },
  { pattern: /\bparadigm\b/gi, reason: '"paradigm" is an AI-ism - use simpler language' },
  { pattern: /\benigma\b/gi, reason: '"enigma" is an AI-ism - consider "mystery" or "puzzle"' },
  { pattern: /\blabyrinth\b/gi, reason: '"labyrinth" is an AI-ism - consider "maze" or describe the complexity' },
  { pattern: /\bsymphony\b/gi, reason: '"symphony" is an AI-ism when used metaphorically - describe the coordination directly' },
  { pattern: /\borchestrat(e|es|ed|ing)\b/gi, reason: '"orchestrate" is an AI-ism - consider "coordinate", "arrange", or "organize"' },

  // Foster/nurture words
  { pattern: /\bfostering?\b/gi, reason: '"foster" is overused by AI - consider "encourage", "support", or "develop"' },
  { pattern: /\bnurtur(e|ing|ed)\b/gi, reason: '"nurture" is overused by AI - consider "develop", "support", or "grow"' },
  { pattern: /\bcultiват(e|es|ed|ing)\b/gi, reason: '"cultivate" is an AI-ism - consider "develop", "build", or "grow"' },

  // Other overused words
  { pattern: /\bproactive(ly)?\b/gi, reason: '"proactive" is an AI-ism - describe the specific action' },
  { pattern: /\bvibrant\b/gi, reason: '"vibrant" is an AI-ism - describe the specific quality' },
  { pattern: /\bbustling\b/gi, reason: '"bustling" is an AI-ism - describe the activity specifically' },
  { pattern: /\bwhimsical\b/gi, reason: '"whimsical" is an AI-ism - describe the specific quality' },
  { pattern: /\bpoised\b/gi, reason: '"poised" is an AI-ism - be more specific about readiness' },
  { pattern: /\bunparalleled\b/gi, reason: '"unparalleled" is an AI-ism - describe what makes it unique' },
  { pattern: /\btailored\b/gi, reason: '"tailored" is an AI-ism - consider "customized", "specific", or "designed for"' },
  { pattern: /\bbespoke\b/gi, reason: '"bespoke" is an AI-ism - consider "custom" or "made for"' },
  { pattern: /\bresonat(e|es|ed|ing)\b/gi, reason: '"resonate" is an AI-ism - describe the connection specifically' },
  { pattern: /\bever[- ]?evolving\b/gi, reason: '"ever-evolving" is an AI-ism - describe how things are changing' },
  { pattern: /\bfast[- ]?paced\b/gi, reason: '"fast-paced" is an AI-ism - be more specific' },
  { pattern: /\billuminat(e|es|ed|ing)\b/gi, reason: '"illuminate" is an AI-ism - consider "explain", "clarify", or "reveal"' },
  { pattern: /\bprofound(ly)?\b/gi, reason: '"profound" is an AI-ism - describe the depth specifically' },
  { pattern: /\bundoubtedly\b/gi, reason: '"undoubtedly" is an AI-ism - state your point directly or provide evidence' },
  { pattern: /\bindeed\b/gi, reason: '"indeed" is often AI padding - usually can be omitted' },
  { pattern: /\bnotably\b/gi, reason: '"notably" is often AI padding - just state the notable thing' },

  // ===== CONSTRUCTIONS & SENTENCE PATTERNS =====

  // "This is not just X, it's Y" pattern
  { pattern: /\bthis (is|isn't|is not) (not |just |not just |merely )+[^.!?]+,\s*(it's|it is|but)\b/gi, reason: '"This isn\'t just X, it\'s Y" is a classic AI construction - state your point directly' },
  { pattern: /\b(it|this|that) (is|was) not (just|only|merely) [^.!?]+but (also )?/gi, reason: '"not just X but also Y" is an AI construction - simplify' },

  // "Not only...but also" pattern
  { pattern: /\bnot only\b[^.!?]+\bbut also\b/gi, reason: '"not only X but also Y" is an AI construction - consider simplifying' },
  { pattern: /\bwill not only\b[^.!?]+\bbut (will )?(also )?/gi, reason: '"will not only X but also Y" is an AI construction - simplify' },

  // Sentence openers (AI affirmations)
  { pattern: /^Absolutely[,.]?\s/gim, reason: 'Starting with "Absolutely" is an AI tell - remove or rephrase' },
  { pattern: /^Certainly[,.]?\s/gim, reason: 'Starting with "Certainly" is an AI tell - just state your point' },
  { pattern: /^Indeed[,.]?\s/gim, reason: 'Starting with "Indeed" is an AI tell - remove or rephrase' },
  { pattern: /^Undoubtedly[,.]?\s/gim, reason: 'Starting with "Undoubtedly" is an AI tell - remove or rephrase' },
  { pattern: /^Interestingly[,.]?\s/gim, reason: 'Starting with "Interestingly" is an AI tell - let readers decide what\'s interesting' },
  { pattern: /^Importantly[,.]?\s/gim, reason: 'Starting with "Importantly" is an AI tell - just state the important thing' },
  { pattern: /^Notably[,.]?\s/gim, reason: 'Starting with "Notably" is an AI tell - just state the notable thing' },
  { pattern: /^Firstly[,.]?\s/gim, reason: '"Firstly" is an AI-ism - just say "First"' },
  { pattern: /^Secondly[,.]?\s/gim, reason: '"Secondly" is an AI-ism - just say "Second"' },
  { pattern: /^Additionally[,.]?\s/gim, reason: 'Starting with "Additionally" is an AI tell - vary your transitions' },
  { pattern: /^Furthermore[,.]?\s/gim, reason: 'Starting with "Furthermore" is an AI tell - vary your transitions' },
  { pattern: /^Moreover[,.]?\s/gim, reason: 'Starting with "Moreover" is an AI tell - vary your transitions' },

  // ===== PHRASES =====

  // "Important to note" variants
  { pattern: /\bit('s| is) important to note\b/gi, reason: '"it\'s important to note" is AI filler - just state the point' },
  { pattern: /\bit('s| is) worth noting\b/gi, reason: '"it\'s worth noting" is AI filler - just state the point' },
  { pattern: /\bit('s| is) crucial to (note|understand|remember)\b/gi, reason: 'AI filler phrase - just state the point' },
  { pattern: /\bit('s| is) essential to (note|understand|remember)\b/gi, reason: 'AI filler phrase - just state the point' },
  { pattern: /\bit should be noted\b/gi, reason: '"it should be noted" is passive AI filler - just state the point' },

  // "In today's" phrases
  { pattern: /\bin today('s| s) (world|age|society|digital age|fast-paced world)\b/gi, reason: '"in today\'s world" is AI filler - be specific or omit' },
  { pattern: /\bin this day and age\b/gi, reason: '"in this day and age" is an AI cliché - omit or be specific' },
  { pattern: /\bin (the |our )?(modern|current|digital) (age|era|world|landscape)\b/gi, reason: 'AI filler phrase - be specific or omit' },

  // "In the realm/world of" phrases
  { pattern: /\bin the realm of\b/gi, reason: '"in the realm of" is an AI-ism - just say "in" or be more specific' },
  { pattern: /\bin the world of\b/gi, reason: '"in the world of" is an AI-ism - just say "in" or be more specific' },
  { pattern: /\bthe world of [a-z]+\b/gi, reason: '"the world of X" is an AI-ism - just say the thing directly' },

  // "Play a role" phrases
  { pattern: /\bplay(s|ed|ing)? a (crucial|pivotal|key|vital|significant|important|critical) role\b/gi, reason: 'AI loves "plays a crucial role" - describe the actual role' },
  { pattern: /\bserves? as a\b/gi, reason: '"serves as a" is often AI padding - simplify' },

  // Testament/evidence phrases
  { pattern: /\ba testament to\b/gi, reason: '"a testament to" is an AI-ism - describe the evidence directly' },
  { pattern: /\bstands as a testament\b/gi, reason: '"stands as a testament" is an AI-ism - describe the evidence directly' },

  // Transition clichés
  { pattern: /\bwith that being said\b/gi, reason: '"with that being said" is AI transition - try "however" or omit' },
  { pattern: /\bthat being said\b/gi, reason: '"that being said" is AI transition - try "however" or omit' },
  { pattern: /\bhaving said that\b/gi, reason: '"having said that" is AI transition - try "however" or omit' },
  { pattern: /\bat its core\b/gi, reason: '"at its core" is an AI-ism - just state the core thing' },
  { pattern: /\bto put it simply\b/gi, reason: '"to put it simply" is AI padding - just say it simply' },
  { pattern: /\bfrom a broader perspective\b/gi, reason: '"from a broader perspective" is AI padding - just broaden' },

  // Hedging phrases
  { pattern: /\bit can be seen that\b/gi, reason: '"it can be seen that" is passive AI padding - state directly' },
  { pattern: /\bone might argue\b/gi, reason: '"one might argue" is hedging - make your point or attribute it' },
  { pattern: /\bit could be argued\b/gi, reason: '"it could be argued" is hedging - make your point or attribute it' },
  { pattern: /\bgenerally speaking\b/gi, reason: '"generally speaking" is often hedging - be specific or commit' },
  { pattern: /\bbroadly speaking\b/gi, reason: '"broadly speaking" is often hedging - be specific or commit' },
  { pattern: /\bto some extent\b/gi, reason: '"to some extent" is hedging - be specific about the extent' },

  // Path/way clichés
  { pattern: /\bpaves? the way\b/gi, reason: '"paves the way" is a cliché - describe what it enables' },
  { pattern: /\bshed(s|ding)? light on\b/gi, reason: '"sheds light on" is a cliché - consider "explains", "clarifies", or "reveals"' },
  { pattern: /\btip of the iceberg\b/gi, reason: '"tip of the iceberg" is a cliché - be more specific' },

  // Array/collection clichés
  { pattern: /\b(wide|vast|broad|diverse) (array|range|spectrum) of\b/gi, reason: '"wide array of" is an AI-ism - be specific about what you mean' },
  { pattern: /\bmyriad (of )?\b/gi, reason: '"myriad" is an AI-ism - try "many" or be specific' },
  { pattern: /\ba plethora of\b/gi, reason: '"a plethora of" is an AI-ism - try "many" or be specific' },
  { pattern: /\btreasure trove\b/gi, reason: '"treasure trove" is an AI-ism - describe the collection specifically' },

  // Redundant phrases
  { pattern: /\bfirst and foremost\b/gi, reason: '"first and foremost" is redundant - just say "first"' },
  { pattern: /\beach and every\b/gi, reason: '"each and every" is redundant - use "each" or "every"' },
  { pattern: /\bany and all\b/gi, reason: '"any and all" is redundant - use "any" or "all"' },

  // Wordy phrases
  { pattern: /\bin order to\b/gi, reason: '"in order to" is usually just "to"' },
  { pattern: /\bdue to the fact that\b/gi, reason: '"due to the fact that" is wordy - try "because"' },
  { pattern: /\bfor the purpose of\b/gi, reason: '"for the purpose of" is wordy - try "to" or "for"' },
  { pattern: /\bin terms of\b/gi, reason: '"in terms of" is often vague - be more direct' },
  { pattern: /\bwith regard to\b/gi, reason: '"with regard to" is wordy - try "about" or "regarding"' },
  { pattern: /\bwith respect to\b/gi, reason: '"with respect to" is wordy - try "about" or "for"' },
  { pattern: /\bthe fact that\b/gi, reason: '"the fact that" is often unnecessary padding - try omitting' },

  // Conclusion phrases
  { pattern: /\bin conclusion\b/gi, reason: '"in conclusion" is often unnecessary - just conclude' },
  { pattern: /\bin summary\b/gi, reason: '"in summary" is often unnecessary - just summarize' },
  { pattern: /\bto summarize\b/gi, reason: '"to summarize" is often unnecessary - just summarize' },
  { pattern: /\bmoving forward\b/gi, reason: '"moving forward" is an AI-ism - be specific about what happens next' },
  { pattern: /\bgoing forward\b/gi, reason: '"going forward" is an AI-ism - be specific about what happens next' },
  { pattern: /\bat the end of the day\b/gi, reason: '"at the end of the day" is a cliché - state your conclusion directly' },
  { pattern: /\bultimately\b/gi, reason: '"ultimately" is often AI padding - can usually be omitted' },

  // Exploration phrases
  { pattern: /\blet('s| us) (explore|delve|dive|examine|take a look)\b/gi, reason: 'AI transition phrase - just explore the topic' },
  { pattern: /\bin this article,? (we'll|we will|I'll|I will)\b/gi, reason: '"in this article, we\'ll" is an AI opener - just start' },

  // Padding phrases
  { pattern: /\bin essence\b/gi, reason: '"in essence" is often AI padding - just state the essence' },
  { pattern: /\bas a matter of fact\b/gi, reason: '"as a matter of fact" is padding - just state the fact' },
  { pattern: /\bit goes without saying\b/gi, reason: '"it goes without saying" - then don\'t say it, or just say it' },
  { pattern: /\bneedless to say\b/gi, reason: '"needless to say" - then don\'t say it, or just say it' },
  { pattern: /\bas previously mentioned\b/gi, reason: '"as previously mentioned" is AI padding - just reference it directly' },
  { pattern: /\bas mentioned (earlier|above|before)\b/gi, reason: '"as mentioned earlier" is AI padding - just reference it directly' },

  // ===== EM DASH OVERUSE =====
  // Note: A few em dashes are fine, but AI tends to overuse them
  { pattern: /—[^—]+—[^—]+—/g, reason: 'Multiple em dashes in one sentence is an AI tell - vary your punctuation' },

  // ===== DICTIONARY/DEFINITION OPENINGS =====
  { pattern: /^[A-Z][a-z]+ is defined as\b/gim, reason: 'Starting with a definition is an AI tell - jump into your point' },
  { pattern: /^[A-Z][a-z]+ can be defined as\b/gim, reason: 'Dictionary openings are an AI tell - jump into your point' },
  { pattern: /^(The |A |An )?[A-Z][a-z]+ refers to\b/gim, reason: 'Definition openings are an AI tell - assume the reader knows' },
  { pattern: /\bby definition\b/gi, reason: '"by definition" is often AI padding' },
  { pattern: /\bthe term [a-z]+ (refers to|means|describes)\b/gi, reason: 'Defining obvious terms is an AI pattern' },

  // ===== PEPPY/INSPIRATIONAL CLOSINGS =====
  { pattern: /\bthe possibilities are (endless|limitless|infinite)\b/gi, reason: '"the possibilities are endless" is an AI cliché' },
  { pattern: /\bthe future (is|looks) bright\b/gi, reason: '"the future is bright" is an AI cliché' },
  { pattern: /\bonly time will tell\b/gi, reason: '"only time will tell" is a cliché' },
  { pattern: /\bthe sky('s| is) the limit\b/gi, reason: '"the sky\'s the limit" is a cliché' },
  { pattern: /\bexciting times ahead\b/gi, reason: '"exciting times ahead" is an AI cliché' },
  { pattern: /\bwatch this space\b/gi, reason: '"watch this space" is a cliché' },
  { pattern: /\bstay tuned\b/gi, reason: '"stay tuned" is a cliché' },
  { pattern: /\bwe('re| are) just getting started\b/gi, reason: '"we\'re just getting started" is an AI cliché' },
  { pattern: /\bthis is (just|only) the beginning\b/gi, reason: '"this is just the beginning" is an AI cliché' },
  { pattern: /\bembrace the (future|change|challenge|journey)\b/gi, reason: '"embrace the X" is an AI-ism' },

  // ===== MISSION STATEMENT CADENCE =====
  { pattern: /\bwe must strive to\b/gi, reason: '"we must strive to" is mission-statement AI-speak' },
  { pattern: /\bwe (must|need to|should) (work|strive|endeavor) to(wards?)?\b/gi, reason: 'Mission-statement cadence is an AI tell' },
  { pattern: /\bour (collective |shared )?(goal|mission|vision) is to\b/gi, reason: 'Mission-statement phrasing is an AI tell' },
  { pattern: /\bcommitted to (excellence|quality|innovation|success)\b/gi, reason: 'Corporate mission-speak is an AI-ism' },
  { pattern: /\bdedicated to (providing|delivering|creating|building)\b/gi, reason: 'Corporate mission-speak is an AI-ism' },

  // ===== HEDGING STACKS =====
  { pattern: /\b(can|could|may|might) (potentially|possibly|perhaps)\b/gi, reason: 'Stacked hedging words - commit or be specific' },
  { pattern: /\b(often|typically|usually|generally) (can|could|may|might)\b/gi, reason: 'Stacked hedging words - commit or be specific' },
  { pattern: /\bit('s| is) (possible|likely|probable) that\b/gi, reason: 'Hedging phrase - state it directly or provide evidence' },
  { pattern: /\btends to (often|usually|typically)\b/gi, reason: 'Redundant hedging - pick one' },

  // ===== INTENSIFIER CLUSTERS =====
  { pattern: /\b(significantly|substantially|fundamentally|dramatically) (impact|change|affect|improve|enhance)\b/gi, reason: 'Intensifier + vague verb is AI padding - be specific' },
  { pattern: /\btruly (unique|remarkable|exceptional|extraordinary)\b/gi, reason: '"truly X" is often AI padding - let the description speak' },
  { pattern: /\breally (important|crucial|essential|significant)\b/gi, reason: '"really X" is padding - show why it matters' },
  { pattern: /\bvery (unique|important|crucial|essential)\b/gi, reason: '"very X" is padding - be more specific' },
  { pattern: /\bextremely (important|valuable|useful|helpful)\b/gi, reason: '"extremely X" is padding - show, don\'t tell' },

  // ===== BALANCED/EVERYONE WINS FRAMING =====
  { pattern: /\bboth (sides|parties|groups) (can |will )?(benefit|win|gain)\b/gi, reason: '"everyone wins" framing is AI oversimplification' },
  { pattern: /\bit('s| is) a win-win\b/gi, reason: '"win-win" is a cliché' },
  { pattern: /\bmutually beneficial\b/gi, reason: '"mutually beneficial" is corporate AI-speak' },
  { pattern: /\bbenefits (everyone|all parties|both sides)\b/gi, reason: 'Forced balance is an AI pattern - acknowledge tradeoffs' },

  // ===== PRE-EMPTIVE CAVEATS =====
  { pattern: /\bwhile (this|it|there) (is|may be|can be) (no|not a) (one-size-fits-all|silver bullet|magic bullet|perfect)\b/gi, reason: 'Pre-emptive caveat is an AI pattern' },
  { pattern: /\bthere('s| is) no (one-size-fits-all|silver bullet|magic bullet|perfect) (solution|answer)\b/gi, reason: '"no silver bullet" is a cliché' },
  { pattern: /\bresults may vary\b/gi, reason: '"results may vary" is a disclaimer cliché' },
  { pattern: /\byour mileage may vary\b/gi, reason: '"your mileage may vary" is a cliché' },
  { pattern: /\bit('s| is) not (a |an )?(silver bullet|magic bullet|panacea)\b/gi, reason: '"not a silver bullet" is a cliché' },

  // ===== FORCED TAXONOMY =====
  { pattern: /\bthere are (three|four|five) (main |key |primary )?(types|kinds|categories|pillars|components)\b/gi, reason: 'Forced 3-5 category taxonomy is an AI structural pattern' },
  { pattern: /\bcan be (broken down|divided|split|categorized) into (three|four|five)\b/gi, reason: 'Forced taxonomy is an AI pattern - is the structure natural?' },
  { pattern: /\bfalls into (one of )?(three|four|five) (categories|buckets|groups)\b/gi, reason: 'Forced categorization is an AI pattern' },

  // ===== AI SELF-REFERENCE (dead giveaways) =====
  { pattern: /\bas an AI\b/gi, reason: 'AI self-reference - obvious AI tell' },
  { pattern: /\bas a (large )?language model\b/gi, reason: 'AI self-reference - obvious AI tell' },
  { pattern: /\bmy training data\b/gi, reason: 'AI self-reference - obvious AI tell' },
  { pattern: /\bI('m| am) (just )?an AI\b/gi, reason: 'AI self-reference - obvious AI tell' },
  { pattern: /\bI don('t| not) have (personal )?(opinions|feelings|experiences)\b/gi, reason: 'AI disclaimer - obvious AI tell' },

  // ===== CLAUDE-SPECIFIC PATTERNS =====
  // Based on testing reports, Claude has some quirks
  { pattern: /\bMarcus\b/g, reason: '"Marcus" is a weirdly common AI-generated character name' },
  { pattern: /\bI appreciate you (sharing|asking|bringing)\b/gi, reason: '"I appreciate you sharing" is an AI politeness pattern' },
  { pattern: /\bthat('s| is) a (great|excellent|wonderful|fantastic) (question|point|observation)\b/gi, reason: 'Complimenting the question is AI sycophancy' },
  { pattern: /\bthank you for (sharing|asking|bringing|raising)\b/gi, reason: 'Thanking for the question is AI sycophancy' },
  { pattern: /\bI('m| am) happy to help\b/gi, reason: '"I\'m happy to help" is AI boilerplate' },
  { pattern: /\bI('d| would) be happy to\b/gi, reason: '"I\'d be happy to" is AI boilerplate' },
  { pattern: /\bhope (this|that) helps\b/gi, reason: '"hope this helps" is AI boilerplate' },
  { pattern: /\blet me know if you (need|have|want)\b/gi, reason: '"let me know if you need" is AI boilerplate' },
  { pattern: /\bfeel free to\b/gi, reason: '"feel free to" is AI boilerplate' },
  { pattern: /\bdon('t)? hesitate to\b/gi, reason: '"don\'t hesitate to" is AI boilerplate' },

  // ===== OVERPOLISHED PROSE (Claude tendency) =====
  { pattern: /\bseeks to\b/gi, reason: '"seeks to" is formal AI-speak - try "tries to" or be direct' },
  { pattern: /\baims to\b/gi, reason: '"aims to" is often AI padding - just say what it does' },
  { pattern: /\bstrives to\b/gi, reason: '"strives to" is AI-speak - try "tries to" or be direct' },
  { pattern: /\bendeavor(s)? to\b/gi, reason: '"endeavors to" is AI-speak - just say "try"' },
  { pattern: /\battempts to\b/gi, reason: '"attempts to" is formal - consider "tries to"' },

  // ===== MORE CONTEXT PHRASES =====
  { pattern: /\bin (a |the )?(context|landscape|realm|sphere) of\b/gi, reason: '"in the context of" is often AI padding - be direct' },
  { pattern: /\bwhen it comes to\b/gi, reason: '"when it comes to" is AI padding - be direct' },
  { pattern: /\bwith (respect|regard) to\b/gi, reason: '"with regard to" is formal AI padding - try "about" or "for"' },
  { pattern: /\bas (it )?relates to\b/gi, reason: '"as it relates to" is formal AI padding - be more direct' },
  { pattern: /\bin (the )?light of\b/gi, reason: '"in light of" is often AI padding - try "because of" or "given"' },
  { pattern: /\bthrough the lens of\b/gi, reason: '"through the lens of" is an AI-ism' },
  { pattern: /\bfrom the perspective of\b/gi, reason: '"from the perspective of" is often padding - be more direct' },

  // ===== FLAGPOLING / "WHY THIS MATTERS" =====
  // AI constantly tells you why things are important instead of letting the content speak
  { pattern: /\bhere('s| is) why (this|that|it) (matters|is important)\b/gi, reason: '"here\'s why this matters" is AI flagpoling - let the content show importance' },
  { pattern: /\bwhy (this|that|it) (matters|is important)\b/gi, reason: '"why this matters" is AI flagpoling - show, don\'t tell' },
  { pattern: /\bwhy (this|that|it)('s| is) (so )?(important|significant|crucial|relevant)\b/gi, reason: 'Flagpoling importance is an AI pattern - show, don\'t tell' },
  { pattern: /\bthis (is|becomes) (especially |particularly )?(important|significant|crucial|relevant) (because|when|as)\b/gi, reason: 'Flagpoling importance is an AI pattern - show, don\'t tell' },
  { pattern: /\bthe (importance|significance|relevance) of (this|that) (cannot|can't) be (overstated|understated)\b/gi, reason: '"cannot be overstated" is AI hyperbole' },
  { pattern: /\bwhat makes (this|it) (so )?(important|significant|special|unique) is\b/gi, reason: 'Flagpoling is an AI pattern - let the reader judge importance' },
  { pattern: /\b(and |but )?here('s| is) (the|a) (key|crucial|important|critical) (point|thing|takeaway)\b/gi, reason: 'Flagpoling the key point is an AI pattern' },
  { pattern: /\bthe (key|crucial|important|main) (point|thing|takeaway) (here )?is\b/gi, reason: 'Flagpoling is an AI pattern - just make the point' },
  { pattern: /\bwhat('s| is) (really |truly )?(important|key|crucial) (here )?(is|to understand)\b/gi, reason: 'Flagpoling importance is AI padding' },
  { pattern: /\bit('s| is) (worth|important to) (emphasizing|highlighting|noting|pointing out)\b/gi, reason: 'Flagpoling is an AI pattern - just emphasize it' },
  { pattern: /\bI (want to|need to|have to|must) (emphasize|stress|highlight|point out)\b/gi, reason: 'Announcing emphasis is AI padding - just emphasize it' },
  { pattern: /\blet me (emphasize|stress|highlight|point out)\b/gi, reason: 'Announcing emphasis is AI padding - just say it' },
  { pattern: /\bthis (point |)is (worth|worthy of) (emphasis|attention|consideration)\b/gi, reason: 'Flagpoling is an AI pattern' },

  // ===== SIGNPOSTING / META-COMMENTARY =====
  // AI loves to tell you what it's about to do instead of just doing it
  { pattern: /\bI('ll| will) (now |)(explain|discuss|describe|outline|cover|address|examine)\b/gi, reason: 'Announcing what you\'ll do is AI meta-commentary - just do it' },
  { pattern: /\blet('s| us) (now |)(take a look at|examine|explore|consider|discuss)\b/gi, reason: 'Announcing the exploration is AI padding - just explore' },
  { pattern: /\bnow,? let('s| us)\b/gi, reason: '"Now let\'s" is AI transition padding' },
  { pattern: /\bwith that (in mind|said|being said|out of the way)\b/gi, reason: '"with that said" is AI transition padding' },
  { pattern: /\bhaving (established|discussed|covered|explained) (this|that)\b/gi, reason: 'Meta-commentary is AI padding - just move on' },
  { pattern: /\bbefore (we |I )?(go|move|dive|proceed|continue)\b/gi, reason: 'Transition signposting is AI padding' },
  { pattern: /\bnow that we('ve| have) (established|discussed|covered)\b/gi, reason: 'Transition signposting is AI padding' },
  { pattern: /\bturning (now |our attention )?to\b/gi, reason: '"turning to" is formal AI transition' },
  { pattern: /\bmoving on to\b/gi, reason: '"moving on to" is AI transition padding' },
  { pattern: /\bthis brings us to\b/gi, reason: '"this brings us to" is AI transition padding' },
  { pattern: /\bwhich brings (us|me) to\b/gi, reason: '"which brings us to" is AI transition padding' },

  // ===== MORE PADDING PHRASES =====
  { pattern: /\bit('s| is) (also )?(worth|important to) (mentioning|noting|considering|remembering)\b/gi, reason: 'Announcing what\'s worth noting is AI padding - just note it' },
  { pattern: /\banother (important|key|crucial|critical) (point|thing|aspect|factor) (to consider |)is\b/gi, reason: 'Flagpoling is AI padding' },
  { pattern: /\bone (important|key|crucial|critical) (thing|point|aspect) to (note|consider|remember|keep in mind)\b/gi, reason: 'Flagpoling is AI padding' },
  { pattern: /\bkeep in mind that\b/gi, reason: '"keep in mind that" is often AI padding' },
  { pattern: /\bbear in mind that\b/gi, reason: '"bear in mind that" is formal AI padding' },
  { pattern: /\bremember that\b/gi, reason: '"remember that" is often AI padding - just state the thing' },

  // ===== "RATHER THAN" / "INSTEAD OF" CONSTRUCTIONS =====
  // The user pointed these out - they do argumentative work but repeat frequently in AI prose
  { pattern: /\b\w+ing [^,.]+ rather than \w+ing\b/gi, reason: '"X-ing rather than Y-ing" construction is common in AI prose - consider varying' },
  { pattern: /\bproviding [^,.]+ rather than\b/gi, reason: '"providing X rather than Y" is an AI construction pattern' },
  { pattern: /\bpresent(s|ing)? [^,.]+ rather than\b/gi, reason: '"presenting X rather than Y" is an AI construction pattern' },

  // ===== ENUMERATION / TRIADIC STRUCTURES =====
  // AI loves "First... Second... Third..." patterns
  { pattern: /\bFirst,[\s\S]{10,200}Second,[\s\S]{10,200}Third,/gi, reason: 'First/Second/Third enumeration is a common AI structure - consider varying' },
  { pattern: /\btakes (three|four|five) forms\b/gi, reason: '"takes N forms" + enumeration is an AI pattern' },
  { pattern: /\boperationalization takes\b/gi, reason: '"operationalization" is academic AI-speak' },
  { pattern: /\bmanifests in (three|four|five) (ways|forms)\b/gi, reason: '"manifests in N ways" is an AI pattern' },
  { pattern: /\bcan be (seen|understood|viewed) in (three|four|five)\b/gi, reason: 'Forced enumeration is an AI pattern' },

  // ===== SECTION TRANSITIONS / ACADEMIC SIGNPOSTING =====
  { pattern: /\bthe next section (presents|discusses|examines|explores|addresses)\b/gi, reason: '"the next section presents" is academic signposting - consider cutting' },
  { pattern: /\bthe following section\b/gi, reason: '"the following section" is academic signposting' },
  { pattern: /\bthe (previous|preceding) section\b/gi, reason: '"the previous section" is academic signposting' },
  { pattern: /\bas (discussed|mentioned|noted|shown) (in the )?(previous|preceding|above|earlier) section\b/gi, reason: 'Section cross-references are often cuttable' },
  { pattern: /\bthis section (will |)(explore|examine|discuss|present|address)\b/gi, reason: '"this section will explore" is signposting - just explore' },

  // ===== SUMMARIZING MOVES =====
  { pattern: /\btogether,? these (demonstrate|show|illustrate|suggest|indicate)\b/gi, reason: '"together, these demonstrate" is an AI summarizing pattern' },
  { pattern: /\btaken together\b/gi, reason: '"taken together" is an AI summarizing phrase' },
  { pattern: /\bcollectively,? (these|they|this)\b/gi, reason: '"collectively, these" is an AI summarizing phrase' },
  { pattern: /\bin aggregate\b/gi, reason: '"in aggregate" is formal AI-speak' },

  // ===== SOFTER IMPORTANCE FLAGPOLING =====
  { pattern: /\bperhaps (most )?(significantly|importantly|notably|crucially)\b/gi, reason: '"perhaps most significantly" is soft flagpoling' },
  { pattern: /\bmost (significantly|importantly|notably|crucially)\b/gi, reason: '"most significantly" is flagpoling - let readers judge significance' },
  { pattern: /\bparticularly (significant|important|notable|noteworthy)\b/gi, reason: '"particularly significant" is soft flagpoling' },
  { pattern: /\bespecially (significant|important|notable|noteworthy|worth noting)\b/gi, reason: '"especially important" is soft flagpoling' },

  // ===== COLON-HEAVY ACADEMIC PATTERNS =====
  { pattern: /\bbecomes (especially |particularly )?(problematic|significant|important|relevant) (in|when|where)\b/gi, reason: 'Formulaic academic phrasing' },
  { pattern: /\bprove(s)? (that |)[^.!?]+ is not only [^.!?]+ but (also )?\b/gi, reason: '"proves X is not only Y but Z" is AI construction' },

  // ===== MORE ACADEMIC AI-ISMS =====
  { pattern: /\boperationalize(s|d)?\b/gi, reason: '"operationalize" is academic jargon - consider simpler language' },
  { pattern: /\bproblematize(s|d)?\b/gi, reason: '"problematize" is academic jargon' },
  { pattern: /\bcontextualize(s|d)?\b/gi, reason: '"contextualize" is academic jargon - consider "put in context"' },
  { pattern: /\btheorize(s|d)?\b/gi, reason: '"theorize" is often academic padding' },
  { pattern: /\binterrogate(s|d)?\b/gi, reason: '"interrogate" (when not about questioning people) is academic AI-speak' },
  { pattern: /\bunpack(s|ed|ing)? the\b/gi, reason: '"unpack the X" is academic AI-speak - just analyze it' },
];

/**
 * Check text for AI-isms (words and phrases overused by AI)
 */
function checkAiIsms(text: string): LintSuggestion[] {
  const suggestions: LintSuggestion[] = [];

  for (const { pattern, reason } of AI_ISMS) {
    // Reset regex state
    pattern.lastIndex = 0;

    let match;
    while ((match = pattern.exec(text)) !== null) {
      suggestions.push({
        index: match.index,
        offset: match[0].length,
        reason,
        type: 'ai-ism',
      });
    }
  }

  return suggestions;
}

export interface LintOptions {
  // write-good options
  passive?: boolean;
  illusion?: boolean;
  so?: boolean;
  thereIs?: boolean;
  weasel?: boolean;
  adverb?: boolean;
  tooWordy?: boolean;
  cliches?: boolean;
  eprime?: boolean;
  // Custom options
  aiIsms?: boolean;
}

const DEFAULT_OPTIONS: LintOptions = {
  passive: true,
  illusion: true,
  so: true,
  thereIs: true,
  weasel: true,
  adverb: false,  // Can be noisy
  tooWordy: true,
  cliches: true,
  eprime: false,  // Too strict for most users
  aiIsms: true,
};

/**
 * Lint prose text for style issues
 */
export function lintProse(text: string, options: LintOptions = {}): LintSuggestion[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const suggestions: LintSuggestion[] = [];

  // Run write-good checks
  const writeGoodOpts: Record<string, boolean> = {};
  for (const key of ['passive', 'illusion', 'so', 'thereIs', 'weasel', 'adverb', 'tooWordy', 'cliches', 'eprime']) {
    if (key in opts) {
      writeGoodOpts[key] = (opts as any)[key];
    }
  }

  const writeGoodSuggestions = writeGood(text, writeGoodOpts);
  for (const s of writeGoodSuggestions) {
    suggestions.push({
      index: s.index,
      offset: s.offset,
      reason: s.reason,
      type: 'write-good',
    });
  }

  // Run AI-ism checks
  if (opts.aiIsms) {
    const aiSuggestions = checkAiIsms(text);
    suggestions.push(...aiSuggestions);
  }

  // Sort by position in text
  suggestions.sort((a, b) => a.index - b.index);

  return suggestions;
}

/**
 * Format lint suggestions as a readable summary for the agent
 */
export function formatLintSummary(text: string, suggestions: LintSuggestion[]): string {
  if (suggestions.length === 0) {
    return 'No prose issues detected.';
  }

  // Group by type
  const writeGoodCount = suggestions.filter(s => s.type === 'write-good').length;
  const aiIsmCount = suggestions.filter(s => s.type === 'ai-ism').length;

  let summary = `Found ${suggestions.length} prose issue(s)`;
  if (writeGoodCount > 0 && aiIsmCount > 0) {
    summary += ` (${writeGoodCount} style, ${aiIsmCount} AI-isms)`;
  } else if (aiIsmCount > 0) {
    summary += ` (${aiIsmCount} AI-isms)`;
  }
  summary += ':\n\n';

  // Show each issue with context
  for (const suggestion of suggestions.slice(0, 15)) { // Limit to first 15
    const start = Math.max(0, suggestion.index - 20);
    const end = Math.min(text.length, suggestion.index + suggestion.offset + 20);

    let context = text.slice(start, end);
    if (start > 0) context = '...' + context;
    if (end < text.length) context = context + '...';

    // Highlight the issue
    const issueText = text.slice(suggestion.index, suggestion.index + suggestion.offset);

    const typeLabel = suggestion.type === 'ai-ism' ? '[AI-ism]' : '[Style]';
    summary += `${typeLabel} "${issueText}": ${suggestion.reason}\n`;
  }

  if (suggestions.length > 15) {
    summary += `\n... and ${suggestions.length - 15} more issues.`;
  }

  return summary;
}
