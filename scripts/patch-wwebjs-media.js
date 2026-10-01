/**
 * Repair media sending on whatsapp-web.js with recent WhatsApp Web builds.
 *
 * In recent WhatsApp Web builds, when media (image, video, document, audio) is sent,
 * whatsapp-web.js's `window.WWebJS.sendMessage` creates `mediaOptions` via `processMediaData`
 * and spreads it into `message`.
 *
 * Spreading `mediaOptions` into `message` clobbers `id: newMsgKey` and injects `__x_id: undefined`
 * into the message plain object. When `WAWebSendMsgChatAction.addAndSendMsgToChat(chat, message)`
 * instantiates the Msg model, WhatsApp Web's memoization getters throw:
 * "Data passed to getter must include an id property (it's how we memoize) but got undefined".
 *
 * The fix:
 * 1. Explicitly delete `__x_id` and `id` from `mediaOptions` so spreading cannot contaminate the message.
 * 2. Delete `message.__x_id` and guarantee `message.id = newMsgKey` after the message object is built.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_WWJS = path.join(__dirname, '..', 'node_modules', 'whatsapp-web.js');
const UTILS_PATH = path.join('src', 'util', 'Injected', 'Utils.js');

const MEDIA_OPTIONS_FIND = `            mediaOptions.isViewOnce = options.isViewOnce;
            delete options.media;
            delete options.sendMediaAsSticker;
        }`;

const MEDIA_OPTIONS_REPLACE = `            mediaOptions.isViewOnce = options.isViewOnce;
            delete options.media;
            delete options.sendMediaAsSticker;
            delete mediaOptions.__x_id;
            delete mediaOptions.id;
        }`;

const MSG_ID_FIND = `        const message = {
            ...options,
            id: newMsgKey,
            ack: 0,
            body: content,
            from: from,
            to: chat.id,
            local: true,
            self: 'out',
            t: parseInt(new Date().getTime() / 1000),
            isNewMsg: true,
            type: 'chat',
            ...ephemeralFields,
            ...mediaOptions,
            ...(mediaOptions.toJSON ? mediaOptions.toJSON() : {}),
            ...quotedMsgOptions,
            ...locationOptions,
            ...pollOptions,
            ...eventOptions,
            ...vcardOptions,
            ...buttonOptions,
            ...listOptions,
            ...botOptions,
            ...extraOptions,
        };

        // Bot's won't reply if canonicalUrl is set (linking)`;

const MSG_ID_REPLACE = `        const message = {
            ...options,
            id: newMsgKey,
            ack: 0,
            body: content,
            from: from,
            to: chat.id,
            local: true,
            self: 'out',
            t: parseInt(new Date().getTime() / 1000),
            isNewMsg: true,
            type: 'chat',
            ...ephemeralFields,
            ...mediaOptions,
            ...(mediaOptions.toJSON ? mediaOptions.toJSON() : {}),
            ...quotedMsgOptions,
            ...locationOptions,
            ...pollOptions,
            ...eventOptions,
            ...vcardOptions,
            ...buttonOptions,
            ...listOptions,
            ...botOptions,
            ...extraOptions,
        };

        delete message.__x_id;
        message.id = newMsgKey;

        // Bot's won't reply if canonicalUrl is set (linking)`;

const GROUPS = [
  {
    name: 'mediaOptions clean',
    find: MEDIA_OPTIONS_FIND,
    replace: MEDIA_OPTIONS_REPLACE,
  },
  {
    name: 'message id preservation',
    find: MSG_ID_FIND,
    replace: MSG_ID_REPLACE,
  },
];

function occurrences(text, search) {
  let count = 0;
  let pos = 0;
  while ((pos = text.indexOf(search, pos)) !== -1) {
    count++;
    pos += search.length;
  }
  return count;
}

function isApplied(depDir = DEFAULT_WWJS) {
  const utilsFile = path.join(depDir, UTILS_PATH);
  if (!fs.existsSync(utilsFile)) return false;
  const content = fs.readFileSync(utilsFile, 'utf8');
  return GROUPS.every(
    (group) => occurrences(content, group.find) === 0 && occurrences(content, group.replace) === 1,
  );
}

function applyMediaPatches(depDir = DEFAULT_WWJS) {
  const utilsFile = path.join(depDir, UTILS_PATH);
  if (!fs.existsSync(utilsFile)) {
    throw new Error(`whatsapp-web.js not found at ${depDir}`);
  }

  let source = fs.readFileSync(utilsFile, 'utf8');
  const applied = [];
  const skipped = [];

  for (const group of GROUPS) {
    const unpatchedCount = occurrences(source, group.find);
    const patchedCount = occurrences(source, group.replace);

    if (unpatchedCount === 0 && patchedCount === 1) {
      skipped.push(group.name);
      continue;
    }

    if (unpatchedCount === 1 && patchedCount === 0) {
      source = source.replace(group.find, group.replace);
      applied.push(group.name);
      continue;
    }

    throw new Error(
      `unsupported Utils.js shape for ${group.name} (unpatched: ${unpatchedCount}, patched: ${patchedCount})`,
    );
  }

  if (applied.length) {
    fs.writeFileSync(utilsFile, source);
  }

  return { applied, skipped };
}

function run() {
  const bestEffort = process.argv.includes('--best-effort');
  try {
    const { applied, skipped } = applyMediaPatches();
    const report = [
      ...applied.map((n) => `applied ${n}`),
      ...skipped.map((n) => `skipped ${n} (already present)`),
    ].join('; ');
    console.log(`patch-wwebjs-media: ${report}`);
  } catch (error) {
    if (bestEffort) {
      console.warn(`patch-wwebjs-media: skipped — ${error.message}`);
      return;
    }
    console.error(`patch-wwebjs-media: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) run();

module.exports = {
  applyMediaPatches,
  isApplied,
  GROUPS,
};
