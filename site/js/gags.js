// The gag library: every way Hexakin can press the button, fill the spin, hurt himself, sweat
// the slowdown and react, as data; and the spin builder that draws a show from it.
//
// Spins dated GAGS_SINCE or later are built here (older spins keep spin.js's original builder,
// so every existing code replays frame for frame). Each gag has its own `since`: a gag can only
// be drawn for spins dated on or after it, so adding gags never changes an existing spin.
// NEVER edit a shipped gag in place: give a changed gag a new id and a new `since`, and set
// `until` on the old one. tools/test_replays.mjs guards this.
//
// A spin is: opener, then 2-4 talky bits with 0-2 mishaps (fake-outs, injuries) between them,
// the slowdown, the landing reaction (by the picked game's genre, or by mood), and an outro.
// Injuries leave a status (plaster, bandage, soot, stars) on him for the rest of the spin.
// Draws use the theatrics stream ("show"); the game is drawn from its own stream ("pick").

import { stream, codeDate } from "./rng.js";
import { eligible, pickResult, segDist, reelAt } from "./spin.js";

export const GAGS_SINCE = "2026-11-05";
const D0 = GAGS_SINCE;

// geometry shared with show.js: Hexakin's feet at stage (425, 1490), 0.71 stage px per canvas px
const FEET_X = 425, FEET_Y = 1490, SCALE = 0.71;
const SAFE_X = [60, 960];
const toStageX = (cx) => FEET_X + (cx - 600) * SCALE;

// ------------------------------------------------------------------ the catalogue
// Talky bits during the fast spin. pose -> alt alternate every ~1.9 s with bounces in between.
// how: lunge | rub | tap | pop. sign: text drawn on the board he holds (library sign poses).
const BITS = [
  // the originals
  { id: "blink", pose: "pointing-accuse", alt: "scheming", how: "lunge", lines: ["Don't blink. Blinking is cheating.", "Eyes on the drum. Not on me. THE DRUM."] },
  { id: "rigged", pose: "scheming", alt: "pointing-accuse", how: "rub", lines: ["You've rigged this. I can tell. You've got a rigging face.", "Is this rigged? Asking for me."] },
  { id: "watch", pose: "tap-watch", alt: "shrug", how: "tap", lines: ["Any time today. Some of us have a download bar to stare at.", "Tick tock. My tea's going cold."] },
  { id: "glass", pose: "nose-on-glass", how: "glass", lines: ["*tap tap* Hello? You've got a thumbprint on your screen. Gross.", "*tap tap* Can you hear me in there? Blink twice."] },
  { id: "shush", pose: "shush", alt: "pointing-accuse", how: "lunge", lines: ["Shh. SHH. It's concentrating.", "Shh. Quiet. It can smell fear."] },
  { id: "rules", pose: "pointing-accuse", alt: "thumbs-down", how: "lunge", span: 3.0, lines: ["{n} games. One button. No re-rolls. Those are the rules."] },
  { id: "illegal", pose: "shrug", alt: "scheming", how: "pop", lines: ["Is it allowed to go this fast? Feels illegal."] },
  { id: "sticker", pose: "shrug", alt: "pointing-accuse", how: "pop", fx: "stickers", lines: ["Who keeps putting stickers on the screen? Was that you?"] },
  { id: "editor", pose: "thumbs-down", alt: "shrug", how: "lunge", lines: ["Editor, if this lands on a golf game, cut it. Actually don't. Honesty."] },
  { id: "coward", pose: "pointing-accuse", alt: "jazz-hands", how: "lunge", lines: ["Pressing a button. Hardest part of my day.", "That press? Ten out of ten. Judges agree."] },
  { id: "lean", pose: "scheming", alt: "pointing-accuse", how: "rub", lines: ["Look at it go. Look at it. No, not at me. AT IT."] },
  // library art
  { id: "updates", pose: "sit_notifications", alt: "react_facepalm-headshake", how: "pop", lines: ["Update required. 47 gigs. Of COURSE it is.", "Seventeen notifications. All of them say 'update'."] },
  { id: "bored", pose: "react_bored-sigh", alt: "react_bored-cheek-fist", how: "pop", lines: ["Still spinning. Still here. Still waiting.", "I've aged. Look at me. I've AGED."] },
  { id: "yawn", pose: "react_yawn-stretch", alt: "react_yawn-cover", how: "pop", lines: ["*yawn* Wake me when it's picked something.", "Not bored. Just resting my excitement."] },
  { id: "doze", pose: "react_sleep-standing", how: "doze", lines: ["Zzz... five more games... zzz..."], after: ["I WASN'T ASLEEP.", "I was resting my eyes. Both of them."] },
  { id: "spy", pose: "react_suspicious-binoculars", alt: "react_suspicious-squint", how: "pop", lines: ["I'm watching you, drum. Every. Single. Card.", "Surveillance mode. Nothing gets past me."] },
  { id: "notes", pose: "prop_clipboard", alt: "react_suspicious-squint", how: "pop", lines: ["Taking notes. For the complaint.", "Card speed: rude. Writing that down."] },
  { id: "think", pose: "react_thinking-bubble", alt: "react_confused-shrug-qs", how: "pop", lines: ["Thinking about what it'll pick. Thinking very hard.", "Hmm. Hmmmm. Hm. Nope, nothing."] },
  { id: "money", pose: "sit_money-moths", alt: "react_facepalm", how: "pop", lines: ["A monthly fee and it STILL makes me wait.", "My wallet's got moths. The drum's got {n} games."] },
  { id: "timer", pose: "prop_stopwatch-race", alt: "prop_stopwatch-1hour", how: "pop", lines: ["Timing it. This is a personal best. For slowness.", "One hour. ONE HOUR. (It's been ten seconds.)"] },
  { id: "how", pose: "react_confused-shrug-qs", alt: "shrug", how: "pop", lines: ["Where does it get all these games? Who's feeding it?", "How does it know what we've played? Witchcraft."] },
  { id: "blah", pose: "react_eyeroll-blah", alt: "react_eyeroll", how: "pop", lines: ["Blah blah, spinning, yes, very exciting.", "'Ooh, the button.' Yeah yeah."] },
  { id: "hi", pose: "react_wave-hello", alt: "react_salute-gg", how: "pop", lines: ["Hi Mum. Yes, I'm on the internet again.", "Hello to everyone watching this instead of playing."] },
  { id: "pad", pose: "gaming_controller-gripping", alt: "gaming_controller-hold", how: "pop", lines: ["Controller's warm. Thumbs are stretched. GO.", "I could be PLAYING something right now."] },
  { id: "sofa", pose: "gaming_sofa-snacks", alt: "gaming_controller-hold", how: "pop", lines: ["Pizza's ready. Sofa's ready. Drum's dawdling.", "Got snacks in. This had better be worth the crumbs."] },
  { id: "smug", pose: "react_smug-hands-behind-head", alt: "react_smug-arms-crossed", how: "pop", lines: ["Relax. I've got a good feeling about this one.", "Whatever it picks, I called it. Retroactively."] },
  { id: "backlog", pose: "sit_climb-cases", alt: "sit_tiny-vs-case", how: "pop", lines: ["Climbing the backlog. Send help.", "This is my backlog. It's taller than me."] },
  { id: "up", pose: "sit_point-up", alt: "pointing-accuse", how: "pop", lines: ["Up there. Watch up THERE. Not down here.", "The drum's up there, people."] },
  { id: "inspect", pose: "prop_magnifier", alt: "react_suspicious-squint", how: "pop", lines: ["Inspecting the drum. For crimes.", "Looking for golf games. Found three. Suspicious."] },
  { id: "peekright", pose: "sit_peek-right", how: "peek-right", lines: ["Is it done? I'm not looking until it's done.", "I'll be over here. Tell me when it stops."] },
  { id: "peektop", pose: "sit_peek-top", how: "peek-top", lines: ["Hello from up here. The view's worse.", "Don't mind me. Just hanging around."] },
  { id: "peekbottom", pose: "sit_peek-bottom", how: "peek-bottom", lines: ["...is it over? No? Right.", "Psst. Is it a good one yet?"] },
  { id: "tantrum", pose: "react_rage-tantrum", alt: "react_rage-scream", how: "rub", w: 0.6, lines: ["IT'S TAKING TOO LONG.", "I'M CALM. I'M VERY CALM."] },
  // signs: he holds up a board with the text drawn on it
  { id: "sign-rules", pose: "sign_blank-board", how: "pop", sign: "NO RE-ROLLS", lines: ["The sign says it. I didn't make the rules. (I did.)"] },
  { id: "sign-count", pose: "sign_blank-hold-high", how: "pop", sign: "{n} GAMES", lines: ["{n} games in there. One gets picked. Big night."] },
  { id: "sign-golf", pose: "sign_blank-protest", how: "pop", sign: "NO GOLF", lines: ["Peaceful protest. No golf games. That's the demand."] },
  { id: "sign-spin", pose: "sign_blank-yellow", how: "pop", sign: "STILL SPINNING", lines: ["Official notice: it is still spinning. Thank you."] },
  { id: "sign-sorry", pose: "sign_blank-two-hands-low", how: "pop", sign: "SORRY", lines: ["Sorry in advance for whatever this picks."] },
  { id: "sign-food", pose: "sign_blank-sandwich", how: "pop", sign: "HUNGRY", lines: ["Times are hard. The button doesn't pay."] },
  { id: "sign-rule1", pose: "sign_blank-wall-pointing", how: "pop", sign: "THE BUTTON|IS LAW", lines: ["Rule one. Memorise it."] },
  { id: "sign-plan", pose: "sign_blank-easel", how: "pop", sign: "1. SPIN|2. PLAY|3. ???", lines: ["Tonight's plan. Very detailed. Very professional."] },
  { id: "sign-wait", pose: "sign_blank-lean", how: "pop", sign: "WAITING...", lines: ["Just leaning. Waiting. Leaning and waiting."] },
].map((g) => ({ slot: "bit", w: 1, since: D0, ...g }));

// Mishaps: the reel fake-outs (nap, break) and injuries. kind picks the choreography below.
const MISHAPS = [
  { id: "nap", kind: "nap", w: 3 },
  { id: "break", kind: "break", w: 3 },
  { id: "unplug", kind: "break", pre: "react_evil-lightbulb", w: 1, rare: true,
    preLines: ["I could just... unplug it. Speed it up a bit.", "What if I poke the wires? What's the worst that—"] },
  { id: "anvil", kind: "anvil", w: 2, rare: true, before: ["Is it me or is there a shadow—"],
    after: ["I'm fine. That was planned. Spin on.", "Who keeps an ANVIL up there?"], status: "bandage" },
  { id: "banana", kind: "banana", w: 2, before: ["Who left a banana peel by the bu—"],
    after: ["Didn't slip. Did a stunt.", "That was a dive. Ten points."], status: "plaster" },
  { id: "cables", kind: "cables", w: 2, before: ["Who did the cable management? WHO?", "I'm not stuck. I'm part of the setup now."],
    after: ["Free! Nobody saw that.", "Right. Moving on. With dignity."] },
  { id: "ball", kind: "ball", w: 2, before: ["Is something coming out of the dr—"],
    after: ["Who left a football game in the drum?!", "That was a sports game. I felt it."], status: "plaster" },
  { id: "balloon", kind: "balloon", w: 1, rare: true, before: ["Bye! I'm floating away from my problems!"],
    after: ["Balloons. Not load-bearing.", "Back. Ignore the bruises."], status: "bandage" },
  { id: "cliff", kind: "cliff", w: 1, rare: true, before: ["Too tense. I'm off. Bye.", "Nope. Can't watch. Leaving."],
    after: ["I'm back. Don't ask.", "Fell off the edge of the video. It's fine."], status: "bandage" },
  { id: "frozen", kind: "frozen", w: 2, before: ["Ow. The button zapped me AGAIN.", "It BIT me. The button BIT me."],
    after: ["Smell that? That's me. Slightly cooked."], status: "soot" },
  { id: "dizzy", kind: "dizzy", w: 2, before: ["Watched it too long. Is the room spinning?", "Round and round and round and..."],
    after: ["Which one of you is the real screen?"], status: "stars" },
  { id: "runaway", kind: "runaway", w: 1, before: ["IT'S GOING TOO FAST. RUN.", "Nope. Nope nope nope."],
    after: ["...it's fine. It's just a drum. I'm fine."] },
].map((g) => ({ slot: "mishap", since: D0, ...g }));

const SLOWDOWNS = [
  { id: "golf", pose: "pointing-accuse", alt: "scheming", lines: ["Slowing down... slowing down... don't you DARE be a golf game."] },
  { id: "breathe", pose: "scheming", alt: "pointing-accuse", lines: ["Here it comes. Here it comes. Nobody breathe."] },
  { id: "drumroll", pose: "idle", alt: "tap-watch", lines: ["Drumroll, please. I said DRUMROLL."] },
  { id: "easy", pose: "shush", alt: "pointing-accuse", lines: ["Shh. Easy... easy... I can see you reaching for the screen."] },
  { id: "notgolf", pose: "react_nervous-sweat", alt: "react_horrified-peek-fingers", lines: ["Not golf. Not golf. Please not golf."] },
  { id: "cantlook", pose: "react_horrified-peek-fingers", alt: "react_horrified-trembling", lines: ["I can't look. Tell me when it's over. Is it over?"] },
  { id: "come", pose: "react_evil-lean-in", alt: "villain_steepled", lines: ["Yesss. Slow down. Come to me, little game."] },
  { id: "crystal", pose: "villain_crystal-ball", alt: "villain_steepled", lines: ["The crystal ball says... it's buffering."] },
  { id: "chosen", pose: "villain_sinister-point", alt: "react_evil-lean-in", lines: ["You. Yes, you, drum. Choose wisely."] },
  { id: "nearly", pose: "prop_stopwatch-hug", alt: "prop_hourglass", lines: ["Nearly there. Any second. Any MINUTE."] },
  { id: "zoom", pose: "react_suspicious-binoculars", alt: "react_suspicious-squint", lines: ["Zooming in... zooming in... it's a blur."] },
].map((g) => ({ slot: "slowdown", w: 1, since: D0, ...g }));

// Landing reactions by mood. how: jump (win) | drop (lose) | lunge (shock).
const REACTIONS = [
  { id: "celebrate", pose: "celebrate", mood: "win", lines: ["GET IN. Tonight's sorted.", "YES. Finally, the button has taste."], w: 3 },
  { id: "jazz", pose: "jazz-hands", mood: "win", lines: ["Ta-daaa. Tonight's entertainment.", "Called it. Didn't call it. Still counts."], w: 3 },
  { id: "fistpump", pose: "react_triumph-fist-pump", mood: "win", lines: ["GET IN. That's the one."] },
  { id: "flex", pose: "react_triumph-flex", mood: "win", lines: ["The button's got taste. Unlike some people."] },
  { id: "micdrop", pose: "react_triumph-mic-drop", mood: "win", lines: ["Picked. Perfect. I'm done here."] },
  { id: "sunburst", pose: "react_triumph-sunburst", mood: "win", lines: ["TONIGHT IS SAVED."] },
  { id: "hype", pose: "react_hype-jump", mood: "win", lines: ["YES YES YES. That one."] },
  { id: "clap", pose: "react_clapping-hype", mood: "win", lines: ["Round of applause for the button."] },
  { id: "thumbs", pose: "react_thumbs-up", mood: "win", lines: ["Solid pick. Solid."] },
  { id: "crown", pose: "prop_crown", mood: "win", lines: ["Crowning this the best spin ever."] },
  { id: "crownhold", pose: "prop_crown-hold", mood: "win", lines: ["All hail tonight's game."] },
  { id: "padup", pose: "gaming_controller-triumph", mood: "win", lines: ["Controller's charged. Let's GO."] },
  { id: "guns", pose: "react_smug-finger-guns", mood: "win", lines: ["Nailed it. You're welcome."] },
  { id: "kneeslide", pose: "scene_goals-knee-slide", mood: "win", lines: ["AND IT'S IN!"] },
  { id: "okay", pose: "react_ok-sign", mood: "win", lines: ["Perfecto. Tonight's sorted."] },
  { id: "collapse", pose: "despair-collapse", mood: "lose", lines: ["Oh no. Oh no no no. Honesty's the brand."], w: 3 },
  { id: "flat", pose: "despair-flat", mood: "lose", lines: ["Why. WHY. Fine. It's tonight's game."], w: 3 },
  { id: "facepalm", pose: "react_facepalm", mood: "lose", lines: ["Of course. Of COURSE."] },
  { id: "facepalm2", pose: "react_facepalm-double", mood: "lose", lines: ["I can't. I genuinely can't."] },
  { id: "headshake", pose: "react_facepalm-headshake", mood: "lose", lines: ["No. No no. Well. Rules are rules."] },
  { id: "fountains", pose: "react_sobbing-fountains", mood: "lose", lines: ["Why does it HATE me?"] },
  { id: "puddle", pose: "react_sobbing-puddle", mood: "lose", lines: ["Not crying. The drum's leaking."] },
  { id: "hugdisc", pose: "react_sobbing-hug-disc", mood: "lose", lines: ["We'll get through this. Together."] },
  { id: "tissue", pose: "react_sobbing-tissue", mood: "lose", lines: ["Give me a minute. Then we play it."] },
  { id: "nope", pose: "react_nope", mood: "lose", lines: ["Nope. ...yes. Rules. Fine."] },
  { id: "stink", pose: "react_disgusted-nose", mood: "lose", lines: ["It stinks. We're playing it anyway."] },
  { id: "recoil", pose: "react_disgusted-recoil", mood: "lose", lines: ["Get it AWAY fro- no. Rules. We play it."] },
  { id: "cringe", pose: "react_cringe", mood: "lose", lines: ["Oof. Okay. Big oof."] },
  { id: "roll", pose: "react_eyeroll", mood: "lose", lines: ["Brilliant. Just brilliant."] },
  { id: "ceiling", pose: "react_bored-lying-ceiling", mood: "lose", lines: ["Wake me when it's tomorrow."] },
  { id: "scream", pose: "react_rage-scream", mood: "lose", lines: ["WHY?! ...fine. Tonight's game."] },
  { id: "tableflip", pose: "react_rage-table-flip", mood: "lose", lines: ["Flipping the table. THEN playing it."] },
  { id: "rip", pose: "prop_grave-rip", mood: "lose", lines: ["RIP my evening."] },
  { id: "verdict", pose: "thumbs-down", mood: "shock", lines: ["It actually picked that. Wow. Okay."], w: 2 },
  { id: "inspired", pose: "shrug", mood: "shock", lines: ["Well done, button. Truly inspired."], w: 2 },
  { id: "what", pose: "react_shocked-cheeks", mood: "shock", lines: ["It picked WHAT?"] },
  { id: "whoa", pose: "react_shocked-jump-back", mood: "shock", lines: ["WHOA. Okay. Bold."] },
  { id: "munch", pose: "react_horrified-munch-scream", mood: "shock", lines: ["AAAAAH. Okay. Tonight's game."] },
  { id: "boom", pose: "react_mindblown-explosion", mood: "shock", lines: ["My head's exploded. Good pick though."] },
  { id: "blown", pose: "react_mindblown-hands-head", mood: "shock", lines: ["Mind. Blown."] },
  { id: "spiral", pose: "react_mindblown-spiral", mood: "shock", lines: ["Did not see that coming."] },
  { id: "lolcry", pose: "react_laugh-crying", mood: "shock", lines: ["HAHA. Oh no. Oh, we're playing that."] },
  { id: "rofl", pose: "react_laugh-rolling", mood: "shock", lines: ["I can't breathe. That's tonight's game."] },
  { id: "pointlaugh", pose: "react_laugh-pointing", mood: "shock", lines: ["HA. Look at it. LOOK at it."] },
  { id: "cackle", pose: "react_laugh-bent-back", mood: "shock", lines: ["The button's got jokes."] },
].map((g) => ({ slot: "reaction", w: 1, since: D0, sfx: g.mood === "win" ? "fanfare" : g.mood === "lose" ? "trombone" : "crash", ...g }));

// Genre reactions: shown instead of the mood reaction (often) when the picked game's store
// genres match (or, for horror/space, its title). Action & adventure is too common to count.
const HORROR = /resident evil|dead space|outlast|alan wake|silent hill|amnesia|layers of fear|evil within|dead by daylight|phasmophobia|horror|zombie|the quarry|until dawn|little nightmares|fear|ghost|haunt|scorn|signalis|dredge/i;
const SPACE = /star wars|starfield|space|galax|mass effect|halo|no man's sky|outer wilds|elite dangerous|cosmic|astro|orbit/i;
const GENRES = [
  { id: "g-blaster", pose: "genre_blaster", genres: ["Shooter"], lines: ["Shooter night. Pew pew."] },
  { id: "g-bat", pose: "genre_zombie-bat", genres: ["Shooter"], title: HORROR, lines: ["Something's getting whacked tonight."] },
  { id: "g-knight", pose: "genre_knight", genres: ["Role playing"], lines: ["Quest accepted. Snacks equipped."] },
  { id: "g-kart", pose: "genre_racing-kart", genres: ["Racing & flying"], lines: ["Vroom. That's the whole review."] },
  { id: "g-jetpack", pose: "genre_jetpack", genres: ["Racing & flying", "Platformer"], lines: ["We have LIFT-OFF."] },
  { id: "g-football", pose: "genre_footballer", genres: ["Sports"], lines: ["Back of the net!"] },
  { id: "g-hoops", pose: "genre_basketball", genres: ["Sports"], lines: ["Slam dunk of a pick."] },
  { id: "g-boxer", pose: "genre_boxer", genres: ["Fighting", "Sports"], lines: ["Gloves on. Let's have it."] },
  { id: "g-ninja", pose: "genre_ninja", genres: ["Fighting"], lines: ["Hi-YA. Tonight we fight."] },
  { id: "g-farmer", pose: "genre_farmer", genres: ["Simulation"], lines: ["Farm life. Calm. Cosy. Finally."] },
  { id: "g-cook", pose: "genre_cook", genres: ["Simulation"], lines: ["Chef mode. The kitchen's already on fire."] },
  { id: "g-fishing", pose: "genre_fishing", genres: ["Simulation", "Family & kids"], lines: ["Reel it in. Tonight's a keeper."] },
  { id: "g-skate", pose: "genre_skate", genres: ["Platformer", "Sports"], lines: ["Kickflip. Into tonight's game."] },
  { id: "g-crystal", pose: "villain_crystal-ball", genres: ["Strategy", "Card & board"], lines: ["I foresee a long night of planning."] },
  { id: "g-clipboard", pose: "prop_clipboard", genres: ["Strategy"], lines: ["Strategy. I've made a plan already."] },
  { id: "g-think", pose: "react_thinking-bubble", genres: ["Puzzle & trivia"], lines: ["Brain. On. Puzzle time."] },
  { id: "g-balloons", pose: "sit_balloon-float", genres: ["Family & kids"], lines: ["Family night! Balloons for everyone!"] },
  { id: "g-flashlight", pose: "genre_horror-flashlight", title: HORROR, lines: ["Lights on. LIGHTS ON."] },
  { id: "g-ghost", pose: "genre_horror-ghost", title: HORROR, lines: ["Is there something behind me? Don't answer."] },
  { id: "g-space", pose: "genre_space-suit", title: SPACE, lines: ["Out of this world. Probably."] },
].map((g) => ({ slot: "genre", w: 1, since: D0, mood: "win", sfx: "fanfare", ...g }));

const OUTROS = [
  { id: "spoken", pose: "pointing-accuse", lines: ["That's tonight's game. No re-rolls. You saw it.", "Right. That's what we're playing. The button has spoken."], w: 2 },
  { id: "gigs", pose: "shrug", lines: ["No take-backs. Downloading it now. Probably 90 gigs."], w: 1.5 },
  { id: "pointless", pose: "react_smug-arms-crossed", lines: ["The button's spoken. Arguing is pointless."] },
  { id: "dontpress", pose: "react_smug-finger-wag", lines: ["Don't even think about pressing it again."] },
  { id: "mwaha", pose: "villain_evil-laugh", lines: ["Mwahaha. Tonight is decided."] },
  { id: "done", pose: "villain_coat-spin", lines: ["My work here is done."] },
  { id: "bye", pose: "react_wave-hello", lines: ["See you tomorrow. Same drum, new game."] },
  { id: "luck", pose: "react_salute-gg", lines: ["Good luck. You'll need it."] },
  { id: "sorted", pose: "react_ok-sign", lines: ["Sorted. Go play."] },
].map((g) => ({ slot: "outro", w: 1, since: D0, ...g }));

const OPENERS = [
  { id: "slam", kind: "slam", w: 4, lines: ["Oh, you pressed it? Cute. Let me do it PROPERLY.", "No no no. Like THIS.", "Stand back. Professional button presser coming through."] },
  { id: "poke", kind: "poke", w: 2, lines: ["Careful. Careful. It bites.", "Gently does it. It's a very sensitive button."], after: ["...that was it? Okay.", "Phew. Still got all my fingers."] },
  { id: "magic", kind: "magic", w: 1.5, lines: ["I don't press buttons. I MANIFEST.", "Watch this. No hands."] },
  { id: "lazy", kind: "lazy", w: 1.5, lines: ["*yawn* Fine. I'll press it.", "Do I HAVE to? Fine."] },
].map((g) => ({ slot: "opener", since: D0, ...g }));

export const CATALOGUE = { opener: OPENERS, bit: BITS, mishap: MISHAPS, slowdown: SLOWDOWNS, reaction: REACTIONS, genre: GENRES, outro: OUTROS };

// every pose a gag can use (for the gallery and tests)
export function gagPoses(g) {
  return [g.pose, g.alt, g.pre].filter(Boolean);
}

// ------------------------------------------------------------------ the builder

const live = (list, date) => list.filter((g) => g.since <= date && (!g.until || date < g.until));

function weighted(R, list) {
  const total = list.reduce((s, x) => s + (x.w ?? 1), 0);
  let k = R.float() * total;
  for (const x of list) { k -= x.w ?? 1; if (k < 0) return x; }
  return list[list.length - 1];
}
function draw(R, list, n) {   // n weighted picks without replacement
  const left = [...list], out = [];
  while (out.length < n && left.length) { const g = weighted(R, left); out.push(g); left.splice(left.indexOf(g), 1); }
  return out;
}


export function buildGagSpin(code, data, opts = {}) {
  const date = codeDate(code);
  const pool = eligible(data.catalogue, data.played || [], date);
  if (!pool.length) throw new Error("No eligible games for this date.");
  const result = pickResult(code, pool);
  const R = stream(code, "show");
  const lib = data.lib || {};
  const force = opts.force || {};
  const C = {};
  for (const [slot, list] of Object.entries(CATALOGUE)) C[slot] = live(list, date);
  const track = [], bubbles = [], stickers = [], fx = [], sfx = [], status = [];
  const segs = [];
  let t = 0, p = 0;
  const seg = (T, v0, v1, ease = "lin", extra = {}) => {
    segs.push({ t0: t, t1: t + T, p0: p, v0, v1, ease, ...extra });
    p += segDist(T, v0, v1, ease); t += T;
  };
  const hold = (T, extra = {}) => seg(T, 0, 0, "lin", extra);
  const n = pool.length;
  const fill = (s) => s.replace(/\{n\}/g, String(n));
  const say = (t0, text, extra = {}) => {
    text = fill(text);
    const dur = extra.dur || Math.max(2.0, 0.9 + text.length / 16);
    bubbles.push({ t0, t1: t0 + dur, text, ...extra });
    sfx.push({ t: t0, name: "pop" });
  };
  const line = (g, k = "lines") => R.pick(g[k]);
  // library poses that stick out past the safe zone slide in (stage px)
  const fitX = (pose) => {
    const m = lib[pose];
    if (!m || m.core || !m.box) return 0;
    const l = toStageX(m.box[0]), r = toStageX(m.box[2]);
    if (r - l > SAFE_X[1] - SAFE_X[0]) return Math.round((SAFE_X[0] + SAFE_X[1]) / 2 - (l + r) / 2);
    if (l < SAFE_X[0]) return Math.round(SAFE_X[0] - l);
    if (r > SAFE_X[1]) return Math.round(SAFE_X[1] - r);
    return 0;
  };
  // every key states its x/y (fit offset added) so nothing drifts from pose to pose
  const key = (t0, pose, o = {}) => track.push({ t: t0, pose, ...o, x: (o.x ?? 0) + (o.raw ? 0 : fitX(pose)), y: o.y ?? 0 });
  const move = (t0, pose, how = "pop", o = {}) => {
    if (how === "lunge") key(t0, pose, { dur: 0.12, ease: "snap", smear: [120, -40], lines: { at: [900, 600] }, wobble: 0.14, jitter: 1.2, ...o });
    else if (how === "rub") key(t0, pose, { dur: 0.12, ease: "snap", smear: [0, 90], wobble: 0.12, jitter: 2.2, ...o });
    else if (how === "tap") key(t0, pose, { dur: 0.1, ease: "snap", smear: [0, -80], wobble: 0.12, jitter: 1, ...o });
    else if (how === "drop") key(t0, pose, { dur: 0.1, ease: "out", smear: [0, 160], wobble: 0.3, impact: true, ...o });
    else if (how === "jump") key(t0, pose, { dur: 0.1, ease: "snap", smear: [0, -170], lines: { at: [600, 500] }, wobble: 0.2, impact: true, y: -24, jitter: 1.4, ...o });
    else key(t0, pose, { dur: 0.1, ease: "back", smear: [0, -70], wobble: 0.16, ...o });
  };
  const curPose = () => track[track.length - 1].pose;
  // landing poses must clear the title banner (stage y ~800): tall ones shrink a little (feet fixed)
  const clearTitle = (pose, lift = 24) => {
    const m = lib[pose];
    const top = m && m.box ? FEET_Y + (m.box[1] - 1140) * SCALE - lift : 830;
    const k = top < 805 ? Math.max(0.72, (FEET_Y - 805) / (FEET_Y - top)) : 1;
    return k < 1 ? { sx: +k.toFixed(3), sy: +k.toFixed(3) } : {};
  };
  const BUBBLE = [590, 960, 960, 1260];   // stage rect of the speech bubble (app.css #bubble)
  const signUnderBubble = (pose) => {
    const m = lib[pose];
    if (!m || !m.text) return false;
    const [x, y, w, h] = m.text, dx = fitX(pose);
    const l = toStageX(x) + dx, r = toStageX(x + w) + dx, tp = FEET_Y + (y - 1140) * SCALE, bt = FEET_Y + (y + h - 1140) * SCALE;
    const ow = Math.max(0, Math.min(r, BUBBLE[2]) - Math.max(l, BUBBLE[0])), oh = Math.max(0, Math.min(bt, BUBBLE[3]) - Math.max(tp, BUBBLE[1]));
    return ow * oh > 0.08 * (r - l) * (bt - tp);
  };
  const bounce = (tb, pose = curPose()) => {
    key(tb, pose, { dur: 0.08, ease: "out", sy: 0.9, sx: 1.07, jitter: 1 });
    key(tb + 0.08, pose, { dur: 0.2, ease: "back", sy: 1, sx: 1, wobble: 0.14, jitter: 1 });
  };
  const word = (t0, text, at, o = {}) => fx.push({ t: t0, type: "word", text, at, dur: 0.85, ...o });
  const hurt = (t0, kind) => { if (kind) status.push({ t: t0, kind }); };
  const V = R.range(13, 17);
  const picked = { bits: [], mishaps: [], at: {} };   // at: when each gag starts (s)

  // --- 0. the opener: how he presses it
  const opener = force.opener ? C.opener.find((g) => g.id === force.opener) : weighted(R, C.opener);
  picked.opener = opener.id;
  key(0, "idle", { breathe: true });
  say(0.15, line(opener), { dur: 1.6 });
  let impact;
  if (opener.kind === "slam") {
    impact = 1.7;
    key(0.95, "idle", { dur: 0.12, ease: "out", sy: 0.88, sx: 1.08 });
    key(1.12, "slam-windup", { dur: 0.08, ease: "snap", smear: [0, -170], lines: { at: [600, 420] }, wobble: 0.1, jitter: 3 });
    key(1.2, "slam-windup", { dur: 0.33, ease: "out", y: -26, sy: 1.06, jitter: 4.5 });
    key(1.57, "slam-windup", { dur: 0.06, ease: "lin", y: 30, sy: 1.34, sx: 0.8, smear: [-40, 280], lines: { at: [380, 640] } });
    key(impact - 0.07, "slam-impact", { dur: 0.07, ease: "lin", smear: [-60, 260], lines: { at: [420, 900] }, impact: true, impactDelay: 2, wobble: 0.24, jitter: 1.2 });
    sfx.push({ t: 0.95, name: "whoosh" }, { t: 1.12, name: "charge", dur: 0.45 }, { t: 1.55, name: "whoosh" });
    fx.push({ t: impact, type: "slam", kind: "drawn", hideAt: 1.16, word: "KA-CHUNK!" });
    sfx.push({ t: impact, name: "boom" });
  } else if (opener.kind === "lazy") {
    impact = 2.0;
    key(0.7, "react_yawn-stretch", { dur: 0.12, ease: "back", smear: [0, -60], wobble: 0.12 });
    key(1.5, "react_yawn-cover", { dur: 0.1, ease: "out", wobble: 0.1 });
    key(impact - 0.06, "slam-impact", { dur: 0.06, ease: "lin", smear: [-30, 140], impact: true, impactDelay: 2, wobble: 0.16 });
    sfx.push({ t: 0.7, name: "whoosh" }, { t: impact - 0.08, name: "whoosh" });
    fx.push({ t: impact, type: "slam", kind: "drawn", hideAt: impact - 0.03, small: true, word: "boop." });
    sfx.push({ t: impact, name: "thud" });
  } else if (opener.kind === "poke") {
    impact = 2.3;
    key(0.6, "prop_magnifier", { dur: 0.12, ease: "back", x: 70, smear: [60, 0], wobble: 0.12 });
    key(1.35, "react_horrified-trembling", { dur: 0.1, ease: "out", x: 110, jitter: 3 });
    key(impact - 0.1, "pointing-accuse", { dur: 0.1, ease: "snap", x: 170, smear: [120, -10], lines: { at: [900, 640] }, wobble: 0.1 });
    key(impact + 0.12, "react_shocked-jump-back", { dur: 0.1, ease: "snap", x: 0, smear: [-160, -40], wobble: 0.2 });
    sfx.push({ t: 0.6, name: "pop" }, { t: impact - 0.1, name: "whoosh" }, { t: impact + 0.12, name: "boing" });
    fx.push({ t: impact, type: "slam", kind: "home", small: true, word: "click." });
    sfx.push({ t: impact, name: "click" });
    say(impact + 0.3, line(opener, "after"), { dur: 1.6 });
  } else {   // magic
    impact = 2.1;
    key(0.7, "jazz-hands", { dur: 0.12, ease: "snap", smear: [0, -90], wobble: 0.16, jitter: 1.5 });
    key(1.5, "jazz-hands", { dur: 0.1, ease: "out", sy: 1.06, jitter: 3 });
    key(impact, "react_triumph-sunburst", { dur: 0.1, ease: "snap", smear: [0, -120], wobble: 0.16 });
    sfx.push({ t: 0.7, name: "sparkle" }, { t: 1.5, name: "charge", dur: 0.55 });
    fx.push({ t: impact, type: "slam", kind: "home", small: true, word: "BOOP!", sparkle: true });
    sfx.push({ t: impact, name: "click" }, { t: impact, name: "sparkle" });
  }
  hold(impact + 0.05);
  seg(0.7, 0, V, "lin");
  sfx.push({ t: impact + 0.05, name: "whoosh" });

  // --- 1. bits and mishaps
  const nMish = force.mishap ? 1 : R.pick([0, 1, 1, 1, 1, 2, 2]);
  let mishaps = draw(R, C.mishap, nMish);
  if (force.mishap) mishaps = [C.mishap.find((g) => g.id === force.mishap)];
  // nap and break both play with the reel; never both "break"-kinds in one spin
  if (mishaps.length === 2 && mishaps.every((m) => m.kind === "break")) mishaps = [mishaps[0]];
  let bits = draw(R, C.bit, 4);
  if (force.bit) bits = [C.bit.find((g) => g.id === force.bit), ...bits.filter((b) => b.id !== force.bit)].slice(0, 4);
  let bi = 0;
  const firstWait = 0.55;

  const cruiseBit = () => {
    const b = bits[bi++ % bits.length];
    picked.bits.push(b.id); picked.at[b.id] = +t.toFixed(2);
    const span = 3.4 + (b.span || 0);
    const t0 = t + (bi === 1 ? firstWait : 0.1);
    if (b.how === "glass") {
      key(t0, b.pose, { dur: 0.16, ease: "back", sx: 1.22, sy: 1.22, y: -40, smear: [0, -60], wobble: 0.1 });
      for (const k of [0.35, 0.6, 1.4, 1.65]) {
        key(t + k, b.pose, { dur: 0.04, ease: "lin", sx: 1.36, sy: 1.12, y: -40 });
        key(t + k + 0.05, b.pose, { dur: 0.14, ease: "back", sx: 1.22, sy: 1.22, y: -40, wobble: 0.08 });
      }
      for (const k of [0.35, 0.6, 1.4, 1.65]) { fx.push({ t: t + k, type: "tap" }); sfx.push({ t: t + k, name: "tap" }); }
      fx.push({ t: t + 1.65, type: "crack" });
      key(t + span - 0.25, "idle", { dur: 0.14, ease: "back", smear: [0, 60], wobble: 0.12, breathe: true });
    } else if (b.how === "doze") {
      key(t0, b.pose, { dur: 0.2, ease: "out", sy: 0.97, breathe: true });
      key(t0 + 1.9, "react_shocked-jolt", { dur: 0.06, ease: "snap", y: -40, smear: [0, -160], wobble: 0.25, jitter: 3 });
      key(t0 + 2.3, "react_shocked-jolt", { dur: 0.12, ease: "out", y: 0, wobble: 0.1 });
      sfx.push({ t: t0 + 1.9, name: "boing" });
      say(t + 0.25, line(b), { dur: 1.8 });
      say(t0 + 2.0, line(b, "after"), { dur: span - 2.1 });
      seg(span, V, V, "lin");
      return;
    } else if (b.how.startsWith("peek")) {
      // he dashes off, then peeks back in from an edge
      key(t0, "idle", { dur: 0.25, ease: "lin", x: -700, smear: [-300, 0], lines: { at: [900, 700] } });
      sfx.push({ t: t0, name: "whoosh" });
      const m = lib[b.pose] || {};
      const bx = m.box || [0, 0, 1200, 1140];
      let x = 0, y = 0, x0 = 0, y0 = 0;
      if (b.how === "peek-right") { x = SAFE_X[1] - toStageX(bx[2]); x0 = x + 300; y = -560; }   // beside the drum, above the bubble
      else if (b.how === "peek-bottom") { x = 380 - FEET_X; y = (1500 - FEET_Y) - (bx[3] - 1140) * SCALE + 10; y0 = y + 520; }
      else { x = 70 - toStageX(bx[0]); y = 290 - (FEET_Y + (bx[1] - 1140) * SCALE); y0 = y - 900; }   // hangs in below the ticker
      x = Math.round(x); y = Math.round(y);
      key(t0 + 0.6, b.pose, { dur: 0.01, x: x0 || x, y: y0 || y, raw: true });
      key(t0 + 0.75, b.pose, { dur: 0.3, ease: "back", x, y, raw: true, wobble: 0.1 });
      key(t0 + 2.2, b.pose, { dur: 0.12, ease: "out", x, y: y + (b.how === "peek-top" ? 12 : -12), raw: true, jitter: 0.6 });
      key(t + span - 0.35, b.pose, { dur: 0.2, ease: "lin", x: x0 || x, y: y0 || y, raw: true });
      key(t + span - 0.12, "idle", { dur: 0.12, ease: "back", smear: [0, 80], wobble: 0.14, breathe: true });
      say(t + 0.25, line(b), { dur: span - 0.3 });
      seg(span, V, V, "lin");
      return;
    } else {
      move(t0, b.pose, b.how, b.sign ? { sign: fill(b.sign) } : {});
      const end = t + span - 0.7;
      for (let k = 0; t0 + 1.0 + k * 1.9 < end; k++) {
        bounce(t0 + 1.0 + k * 1.9);
        if (b.sign) track[track.length - 1].sign = track[track.length - 2].sign = fill(b.sign);
        if (b.alt && t0 + 1.9 * (k + 1) < end) move(t0 + 1.9 * (k + 1), k % 2 ? b.pose : b.alt, "pop", { jitter: 1 });
      }
    }
    // a sign whose board sits where the speech bubble goes: the sign does the talking
    if (!(b.sign && signUnderBubble(b.pose))) say(t + 0.25, line(b), { dur: span - 0.3 });
    if (b.fx === "stickers") {
      const picks = R.shuffle(STICKERS).slice(0, 3);
      picks.forEach((s, k) => stickers.push({ t0: t - 0.6 + k * 0.45, t1: t + span, src: s,
        x: R.range(0.15, 0.85), y: R.range(0.15, 0.55), rot: R.range(-18, 18), scale: R.range(0.8, 1.1) }));
      picks.forEach((_, k) => sfx.push({ t: t - 0.6 + k * 0.45, name: "slap" }));
    }
    seg(span, V, V, "lin");
  };

  // injuries happen while the reel cruises
  const injury = (m) => {
    const t0 = t + 0.1;
    let span = 4.2;
    const bef = m.before ? line(m, "before") : null;
    if (m.kind === "anvil") {
      key(t0, "react_shocked-cheeks", { dur: 0.1, ease: "snap", smear: [0, -60], wobble: 0.14, jitter: 2 });
      if (bef) say(t0 + 0.05, bef, { dur: 1.0 });
      const hit = t0 + 1.05;
      fx.push({ t: hit, type: "anvil", from: hit - 0.75 });
      sfx.push({ t: hit - 0.75, name: "whistle", dur: 0.75 }, { t: hit, name: "clang" });
      key(hit, "sit_anvil-flat", { dur: 0.04, ease: "lin", sy: 0.8, impact: true, wobble: 0.3 });
      word(hit + 0.1, "CLANG!", [700, 1060]);
      key(hit + 1.3, "react_dizzy", { dur: 0.14, ease: "back", smear: [0, -120], wobble: 0.2 });
      hurt(hit, "stars"); hurt(hit + 1.3, m.status);
      say(hit + 1.4, line(m, "after"), { dur: span - 2.5 });
    } else if (m.kind === "banana") {
      key(t0, "idle", { dur: 0.1, ease: "back", wobble: 0.1 });
      fx.push({ t: t0, type: "peel", hit: t0 + 0.9 });
      if (bef) say(t0 + 0.1, bef, { dur: 0.9 });
      const slip = t0 + 0.9;
      sfx.push({ t: slip, name: "slip" });
      key(slip, "sit_banana-slip", { dur: 0.08, ease: "snap", y: -120, rot: -12, smear: [80, -160], lines: { at: [600, 600] }, wobble: 0.1 });
      key(slip + 0.35, "sit_banana-slip-b", { dur: 0.09, ease: "lin", y: 0, rot: 0, smear: [0, 220], impact: true, wobble: 0.3 });
      sfx.push({ t: slip + 0.44, name: "thud" });
      word(slip + 0.5, "SPLAT!", [700, 1250]);
      key(slip + 1.6, "react_cringe", { dur: 0.14, ease: "back", smear: [0, -120], wobble: 0.2 });
      hurt(slip + 0.44, m.status);
      say(slip + 1.6, line(m, "after"), { dur: span - 2.6 });
    } else if (m.kind === "cables") {
      key(t0, "sit_cables-tangled", { dur: 0.12, ease: "snap", smear: [0, 80], wobble: 0.2, jitter: 4 });
      sfx.push({ t: t0, name: "slip" });
      say(t0 + 0.1, bef, { dur: 2.2 });
      key(t0 + 1.2, "sit_cables-tangled", { dur: 0.1, ease: "out", rot: -6, jitter: 6 });
      key(t0 + 1.9, "sit_cables-tangled", { dur: 0.1, ease: "out", rot: 5, jitter: 6 });
      key(t0 + 2.6, "react_shocked-jump-back", { dur: 0.1, ease: "snap", rot: 0, smear: [0, -160], wobble: 0.2 });
      sfx.push({ t: t0 + 2.6, name: "boing" });
      say(t0 + 2.7, line(m, "after"), { dur: span - 2.9 });
    } else if (m.kind === "ball") {
      if (bef) say(t0, bef, { dur: 1.0 });
      key(t0, "react_suspicious-squint", { dur: 0.1, ease: "back", wobble: 0.1 });
      const hit = t0 + 0.95;
      fx.push({ t: hit, type: "ball", from: hit - 0.32 });
      sfx.push({ t: hit - 0.32, name: "whoosh" }, { t: hit, name: "bonk" });
      key(hit, "scene_goals-ball-face", { dur: 0.05, ease: "lin", x: -30, rot: -8, impact: true, wobble: 0.3 });
      word(hit + 0.08, "BONK!", [760, 940]);
      key(hit + 1.3, "react_dizzy", { dur: 0.14, ease: "back", rot: 0, smear: [0, -100], wobble: 0.2 });
      hurt(hit, "stars"); hurt(hit, m.status);
      say(hit + 0.9, line(m, "after"), { dur: span - 1.9 });
    } else if (m.kind === "balloon") {
      span = 5.2;
      key(t0, "sit_balloon-float", { dur: 0.15, ease: "back", y: -40, wobble: 0.1 });
      say(t0 + 0.1, bef, { dur: 1.9 });
      key(t0 + 0.3, "sit_balloon-float", { dur: 1.8, ease: "lin", y: -1400, rot: 6 });
      const pop = t0 + 2.4;
      sfx.push({ t: pop, name: "pop" }, { t: pop + 0.05, name: "whistle", dur: 0.6 });
      key(pop + 0.1, "sit_banana-slip-b", { dur: 0.01, y: -1500, rot: 20 });
      key(pop + 0.2, "sit_banana-slip-b", { dur: 0.5, ease: "lin", y: 0, rot: 0 });
      key(pop + 0.7, "sit_banana-slip-b", { dur: 0.05, ease: "lin", sy: 0.8, impact: true, wobble: 0.35 });
      sfx.push({ t: pop + 0.7, name: "thud" });
      word(pop + 0.75, "THUD.", [720, 1250]);
      key(pop + 1.6, "react_cringe", { dur: 0.14, ease: "back", smear: [0, -100], wobble: 0.2 });
      hurt(pop + 0.7, m.status);
      say(pop + 0.9, line(m, "after"), { dur: span - 3.4 });
    } else if (m.kind === "cliff") {
      span = 5.0;
      key(t0, "sit_run-away", { dur: 0.1, ease: "snap", smear: [-120, 0], wobble: 0.1 });
      say(t0 + 0.05, bef, { dur: 1.2 });
      key(t0 + 0.35, "sit_run-away", { dur: 0.35, ease: "lin", x: -800, smear: [-300, 0], lines: { at: [900, 700] } });
      sfx.push({ t: t0 + 0.35, name: "whoosh" });
      key(t0 + 1.2, "sit_cliff-wile", { dur: 0.01, x: 0, y: 0, sign: "UH OH" });
      key(t0 + 1.25, "sit_cliff-wile", { dur: 0.2, ease: "out", jitter: 1.5, sign: "UH OH" });
      say(t0 + 1.3, "...oh no.", { dur: 1.0 });
      key(t0 + 2.3, "sit_cliff-wile", { dur: 0.55, ease: "lin", y: 1100, sign: "UH OH" });
      sfx.push({ t: t0 + 2.3, name: "whistle", dur: 0.6 }, { t: t0 + 2.95, name: "thud" });
      fx.push({ t: t0 + 2.95, type: "puff", at: [480, 1470] });
      key(t0 + 3.3, "sit_peek-bottom", { dur: 0.01, x: 380 - FEET_X, y: 900, raw: true });
      key(t0 + 3.4, "sit_peek-bottom", { dur: 0.3, ease: "back", x: 380 - FEET_X, y: 140, raw: true });
      key(t0 + 4.4, "idle", { dur: 0.14, ease: "back", smear: [0, -120], wobble: 0.16, breathe: true });
      hurt(t0 + 3.3, m.status);
      say(t0 + 3.4, line(m, "after"), { dur: span - 3.5 });
    } else if (m.kind === "frozen") {
      key(t0, "react_shocked-frozen", { dur: 0.04, ease: "lin", impact: true, jitter: 7 });
      sfx.push({ t: t0, name: "zap", dur: 0.9 });
      say(t0 + 0.1, bef, { dur: 2.0 });
      key(t0 + 0.9, "frazzled-aftermath", { dur: 0.12, ease: "out", smear: [0, 90], wobble: 0.18, jitter: 0.6 });
      fx.push({ t: t0 + 0.9, type: "smoke", dur: 2.4 });
      sfx.push({ t: t0 + 0.9, name: "fizzle" });
      hurt(t0 + 0.9, m.status);
      say(t0 + 2.2, line(m, "after"), { dur: span - 2.3 });
    } else if (m.kind === "dizzy") {
      key(t0, "react_mindblown-spiral", { dur: 0.12, ease: "back", rot: -6, wobble: 0.2, jitter: 1.5 });
      say(t0 + 0.05, bef, { dur: 2.1 });
      key(t0 + 1.0, "react_mindblown-spiral", { dur: 0.5, ease: "out", rot: 6 });
      key(t0 + 1.6, "react_dizzy", { dur: 0.3, ease: "out", rot: -4, wobble: 0.2 });
      key(t0 + 2.4, "react_dizzy", { dur: 0.4, ease: "out", rot: 3 });
      sfx.push({ t: t0 + 1.6, name: "boing" });
      hurt(t0 + 1.6, m.status);
      say(t0 + 2.3, line(m, "after"), { dur: span - 2.4 });
    } else if (m.kind === "runaway") {
      key(t0, "sit_run-away", { dur: 0.1, ease: "snap", smear: [-120, 0], wobble: 0.1, jitter: 2 });
      say(t0 + 0.05, bef, { dur: 1.6 });
      key(t0 + 0.4, "sit_run-away", { dur: 0.4, ease: "lin", x: -800, smear: [-300, 0], lines: { at: [900, 700] } });
      sfx.push({ t: t0 + 0.4, name: "whoosh" });
      key(t0 + 1.5, "sit_run-away-front", { dur: 0.01, sx: 0.45, sy: 0.45, y: -260 });
      key(t0 + 1.6, "sit_run-away-front", { dur: 0.9, ease: "out", sx: 1, sy: 1, y: 0, jitter: 2 });
      sfx.push({ t: t0 + 1.6, name: "whoosh" });
      key(t0 + 2.6, "react_nervous-sweat", { dur: 0.12, ease: "back", wobble: 0.2 });
      say(t0 + 2.6, line(m, "after"), { dur: span - 2.7 });
    }
    seg(span, V, V, "lin");
  };

  const reelFake = (m) => {
    if (m.kind === "nap") {
      const T1 = 2.4, vEnd = 0;
      const pEnd = Math.ceil(p + segDist(T1, V, vEnd, "out") + 0.6 * V);
      const Tc = (pEnd - p - segDist(T1, V, vEnd, "out")) / V;
      seg(Tc, V, V);
      const tDecel = t;
      sfx.push({ t: tDecel, name: "drumroll", dur: T1 });
      seg(T1, V, vEnd, "out");
      const S = Math.round(p); p = S;
      say(tDecel + 0.2, "Ooh. Ooh. Is this it?", { dur: T1 - 0.2 });
      move(tDecel, "scheming", "rub", { jitter: 3 });
      const tLand = t;
      fx.push({ t: tLand, type: "fakeland", idx: S });
      sfx.push({ t: tLand, name: "thud" });
      fixed[S] = R.pick(pool.filter((g) => g.id !== result.id));
      say(tLand + 0.35, R.pick(["Hang on. That's not a stop. That's a nap. GO ON.",
        "Nope. It's not finished. It's just tired. MOVE.", "It didn't land. It wobbled. Wobbles don't count."]), { dur: 2.6 });
      const tPush = tLand + 1.9;
      key(tLand + 0.3, "idle", { dur: 0.1, ease: "back", smear: [0, -60], wobble: 0.14, jitter: 1.5 });
      key(tPush - 0.35, "idle", { dur: 0.2, ease: "out", x: -40, sx: 0.94, sy: 1.04 });
      key(tPush - 0.08, "shove-offscreen", { dur: 0.08, ease: "lin", x: 30, smear: [260, 0], lines: { at: [900, 640] }, impact: true, wobble: 0.2 });
      key(tPush + 0.9, "idle", { dur: 0.14, ease: "back", smear: [-80, 0], wobble: 0.12, breathe: true });
      hold(tPush - tLand);
      fx.push({ t: tPush, type: "shove", idx: S });
      sfx.push({ t: tPush, name: "shove" });
      shoved.push({ idx: S, t: tPush });
      seg(0.6, 0, V, "lin");
    } else {
      if (m.pre) {   // the "unplug" chain: a bad idea first
        move(t + 0.1, m.pre, "pop", { jitter: 1 });
        say(t + 0.15, line(m, "preLines"), { dur: 2.2 });
        seg(2.4, V, V, "lin");
      }
      const tb = t;
      key(tb, "electrocuted-a", { dur: 0, y: -30, zap: ["electrocuted-a", "electrocuted-b"], impact: true });
      key(tb + 2.8, "frazzled-aftermath", { dur: 0.1, ease: "out", y: 0, smear: [0, 90], wobble: 0.18, jitter: 0.6 });
      fx.push({ t: tb + 2.8, type: "smoke", dur: 2.4 });
      sfx.push({ t: tb, name: "zap", dur: 2.8 }, { t: tb + 2.8, name: "fizzle" });
      fx.push({ t: tb, type: "glitch", dur: 2.8 });
      sfx.push({ t: tb, name: "glitch", dur: 2.8 });
      hold(2.8, { jitter: true });
      say(tb + 0.4, R.pick(["Did you do that? You did that. Stop touching things.",
        "WHO UNPLUGGED IT. Was it you? It was you.", "Brilliant. You broke it. Turning it off and on again."]), { dur: 2.6 });
      hurt(tb + 2.8, "soot");
      fx.push({ t: t, type: "reboot" });
      sfx.push({ t: t, name: "whoosh" });
      seg(0.6, 0, V, "lin");
    }
  };

  const fixed = {}, shoved = [];
  cruiseBit();
  mishaps.forEach((m, i) => {
    picked.mishaps.push(m.id); picked.at[m.id] = +t.toFixed(2);
    if (m.kind === "nap" || m.kind === "break") reelFake(m); else injury(m);
    if (i < 1) cruiseBit();   // two mishaps: no third bit, so the spin doesn't drag
  });
  if (!mishaps.length) cruiseBit();

  // --- 2. the slowdown: decelerate, crawl, SLAM
  const sd = force.slowdown ? C.slowdown.find((g) => g.id === force.slowdown) : weighted(R, C.slowdown);
  picked.slowdown = sd.id;
  const T1 = R.range(3.0, 3.6), vc = R.range(1.1, 1.5), Tcr = R.range(1.3, 1.9), vc2 = vc * 0.7;
  const dTail = segDist(T1, V, vc, "out") + segDist(Tcr, vc, vc2, "lin");
  const S = Math.ceil(p + 1.0 * V + dTail);
  seg((S - dTail - p) / V, V, V);
  const tSlow = t;
  picked.at[sd.id] = +t.toFixed(2);
  move(tSlow, sd.pose, sd.pose === "scheming" ? "rub" : "lunge", { jitter: 2.6 });
  move(tSlow + (T1 + Tcr) / 2, sd.alt, "pop", { jitter: 2.6 });
  say(tSlow + 0.1, line(sd), { dur: T1 + Tcr - 0.2 });
  sfx.push({ t: tSlow, name: "drumroll", dur: T1 + Tcr });
  seg(T1, V, vc, "out");
  seg(Tcr, vc, vc2, "lin");
  p = S;
  const tStop = t;
  fixed[S] = result;
  hold(9, { bounce: 0.14 });

  // --- 3. the landing: genre costume (often, when the game's genre matches) or a mood
  const gen = (data.genres && data.genres[result.id]) || [];
  const genreFits = C.genre.filter((g) => (g.genres || []).some((x) => gen.includes(x)) || (g.title && g.title.test(result.title)));
  let reaction;
  if (force.reaction) reaction = [...C.reaction, ...C.genre].find((g) => g.id === force.reaction);
  else if (genreFits.length && R.float() < 0.45) reaction = weighted(R, genreFits);
  else reaction = weighted(R, C.reaction);
  picked.reaction = reaction.id; picked.at[reaction.id] = +tStop.toFixed(2);
  fx.push({ t: tStop, type: "land" });
  fx.push({ t: tStop + 0.12, type: "title" });
  fx.push({ t: tStop + 0.3, type: "stamp" });
  sfx.push({ t: tStop, name: "slam" });
  sfx.push({ t: tStop + 0.3, name: "stamp" });
  sfx.push({ t: tStop + 0.05, name: reaction.sfx });
  if (reaction.mood === "win") {
    move(tStop, reaction.pose, "jump", clearTitle(reaction.pose));
    fx.push({ t: tStop + 0.05, type: "confetti", dur: 3.2 });
  } else if (reaction.mood === "lose") move(tStop, reaction.pose, "drop", clearTitle(reaction.pose, 0));
  else move(tStop, reaction.pose, "lunge", { impact: true, ...clearTitle(reaction.pose, 0) });
  say(tStop + 0.3, line(reaction), { dur: 2.6, style: "big" });
  const tOut = tStop + 3.0;
  // the outro: back on his feet with a parting shot
  const outro = force.outro ? C.outro.find((g) => g.id === force.outro) : weighted(R, C.outro);
  picked.outro = outro.id; picked.at[outro.id] = +tOut.toFixed(2);
  move(tOut - 0.05, outro.pose, outro.pose === "shrug" ? "pop" : "lunge", { y: 0, ...clearTitle(outro.pose, 0) });
  say(tOut, line(outro), { dur: 3.2 });
  const duration = tOut + 3.6;

  // --- reel entries: a seeded shuffle of the pool, with the fixed cards placed
  const entries = [];
  const total = S + 4;
  const showPool = R.shuffle(pool).slice(0, Math.min(40, n));
  let bag = [];
  for (let i = 0; i < total; i++) {
    if (fixed[i]) { entries.push(fixed[i]); continue; }
    if (!bag.length) bag = R.shuffle(showPool);
    let g = bag.pop();
    if (Math.abs(i - S) <= 2 && g.id === result.id) g = bag.pop() || pool[(pool.indexOf(g) + 1) % n];
    entries.push(g);
  }

  track.sort((a, b) => a.t - b.t);
  // ticks: one per card that passes the window
  let last = Math.floor(reelAt({ segs }, 0).p);
  for (let k = 1; k <= Math.ceil(tStop * 200); k++) {
    const tt = k / 200, c = Math.floor(reelAt({ segs }, tt).p + 0.5);
    if (c !== last && tt < tStop - 0.02) { sfx.push({ t: tt, name: "tick" }); last = c; }
  }
  sfx.sort((a, b) => a.t - b.t);

  return {
    code, date, catalogDate: data.catalogDate, eligibleCount: n, v: 2,
    result, reaction: { pose: reaction.pose, mood: reaction.mood },
    gags: picked, status,
    duration, tStop, landing: [Math.max(0, tStop - 0.25), tStop + 1.35],
    reel: { segs, entries, shoved, V }, track, bubbles, stickers, fx, sfx,
  };
}

const STICKERS = ["shrug", "thumbs-down", "jazz-hands", "despair-collapse", "scheming", "celebrate",
  "pointing-accuse", "shush", "tap-watch", "electrocuted-b"];
