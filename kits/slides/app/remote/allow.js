// Every call the Slides app makes, and nothing else: remote mode's route refuses any other path
// (remote/core.js). Paths are what follows /api/harness/v1; :id is one id segment. To add a call to
// the app, add it here too, or it answers 404 when the app runs on its own hosting.
import { seg } from './core.js';

export default [
  { method: 'GET', path: seg('/harnesses'), pin: 'harness-list' },          // the kit's harness (lib/sl.js)
  { method: 'GET', path: seg('/sessions'), pin: 'session-list' },           // the deck list
  { method: 'GET', path: seg('/sessions/:id') },                            // a deck's turn state
  { method: 'PATCH', path: seg('/sessions/:id') },                          // rename a deck
  { method: 'DELETE', path: seg('/traces/:id') },                           // delete a deck
  { method: 'GET', path: seg('/sessions/:id/turns') },                      // the conversation
  { method: 'GET', path: seg('/sessions/:id/files') },                      // the images a deck uses
  { method: 'GET', path: seg('/sessions/:id/files/deck\\.json') },          // read the deck
  { method: 'PUT', path: seg('/sessions/:id/files/deck\\.json'), maxBody: 2 * 1024 * 1024 },  // save it
  { method: 'GET', path: seg('/containers/:id/files/:id/content') },        // an image or export
  { method: 'POST', path: seg('/responses'), pin: 'response' },             // a turn (streamed)
];
