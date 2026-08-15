// What this deployment can make, pinned.
//
// The distinction every test here defends is between "no" and "not asked yet". They render
// differently and they must: a page that has not heard back yet showing "no video model is
// connected" is a red banner over a product that works, and someone closes the tab.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canMakeVideo, capability, connectedSummary, exportAvailability, parseCapabilities,
  videoUnavailableReason,
} from './capabilities.js';

const RAW = {
  capabilities: [
    {
      name: 'text_to_video',
      available: true,
      model: 'MiniMax-Hailuo-2.3',
      estimated_usd_per_unit: 0.28,
      limits: { durations_s: [6, 10], resolution: '1366x768', accepts_input_image: false },
      skipped: [{ model: 'dreamina-seedance-2-5-hc', reason: 'the provider rejects this model id' }],
    },
    { name: 'text_to_music', available: false, model: null, reason: 'No music model is connected.', limits: {} },
    { name: 'export', available: true, model: null, limits: { max_shots: 40, max_total_s: 600 } },
  ],
};

test('an unanswered request is unknown, not "no"', () => {
  assert.equal(parseCapabilities(null), null);
  assert.equal(parseCapabilities({}), null);
  assert.equal(canMakeVideo(null), null);
  assert.equal(exportAvailability(null).available, null);
});

test('the model a capability currently resolves to is carried through', () => {
  // The agent asks for a capability and the server picks; the person is told which model it picked
  // because that is the thing they are about to spend money on.
  const caps = parseCapabilities(RAW);
  assert.equal(canMakeVideo(caps), true);
  assert.equal(capability(caps, 'text_to_video').model, 'MiniMax-Hailuo-2.3');
  assert.equal(capability(caps, 'text_to_video').usdPerUnit, 0.28);
  assert.equal(connectedSummary(caps), 'MiniMax-Hailuo-2.3');
});

test('a per-unit cost the server did not measure is absent, not zero', () => {
  const caps = parseCapabilities({ capabilities: [{ name: 'text_to_video', available: true, model: 'kling-v3' }] });
  assert.equal(capability(caps, 'text_to_video').usdPerUnit, null);
});

test('when video is unavailable the reason names every model that was tried', () => {
  // Four video models are listed and on a bad night two of them are broken upstream. Without the
  // chain, "unavailable" reads as a fault in this product.
  const caps = parseCapabilities({
    capabilities: [{
      name: 'text_to_video', available: false, model: null,
      reason: 'No video model is available right now.',
      skipped: [
        { model: 'dreamina-seedance-2-5-hc', reason: 'the provider rejects this model id' },
        { model: 'kling-v3', reason: 'failed 4 minutes ago' },
      ],
    }],
  });
  const why = videoUnavailableReason(caps);
  assert.match(why, /No video model is available/);
  assert.match(why, /dreamina-seedance-2-5-hc \(the provider rejects this model id\)/);
  assert.match(why, /kling-v3 \(failed 4 minutes ago\)/);
});

test('an available capability has no reason to give', () => {
  assert.equal(videoUnavailableReason(parseCapabilities(RAW)), '');
  assert.equal(connectedSummary(parseCapabilities({ capabilities: [{ name: 'text_to_video', available: false }] })), '');
});

test('a deployment that cannot assemble video says so in the server’s own words', () => {
  const caps = parseCapabilities({
    capabilities: [{
      name: 'export', available: false,
      reason: 'This deployment cannot assemble video — ffmpeg is not installed. The clips are all still here to download individually.',
    }],
  });
  const e = exportAvailability(caps);
  assert.equal(e.available, false);
  assert.match(e.reason, /ffmpeg is not installed/);
});

test('a capability the server never mentioned is unavailable rather than assumed', () => {
  const caps = parseCapabilities({ capabilities: [{ name: 'text_to_video', available: true, model: 'kling-v3' }] });
  assert.equal(exportAvailability(caps).available, false);
  assert.equal(capability(caps, 'text_to_music'), null);
});

test('a malformed row is skipped without taking the rest of the answer with it', () => {
  const caps = parseCapabilities({ capabilities: [null, { available: true }, RAW.capabilities[0]] });
  assert.equal(caps.list.length, 1);
  assert.equal(canMakeVideo(caps), true);
});
