/**
 * Client profanity censor — loads shared core (rules + neural net).
 */
import { censorProfanity, textContainsProfanity } from './skyhop-profanity-core.js';

window.SkyHopCensorProfanity = censorProfanity;
window.SkyHopTextContainsProfanity = textContainsProfanity;
