<script lang="ts">
  import { liveStore } from '../live.svelte';
  import {
    soundFor,
    playLevelUp,
    playDoorbell,
    playBuzzer,
    isAudioEnabled,
  } from '../audio';
  import { notificationFor, showNotification, findNewEntries } from '../notify';
  import type { HQEvent, InternalAction } from '../server/state';

  let lastSeen: (HQEvent | InternalAction) | null = null;
  let initialized = false;

  $effect(() => {
    const feed = liveStore.feed;
    const len = feed.length;
    const latest = len > 0 ? feed[len - 1] : null;

    // After INIT_STATE, feed is reset to empty []
    if (len === 0) {
      lastSeen = null;
      initialized = true;
      return;
    }

    if (!initialized) {
      // First run / reload: mark current end of feed as seen so old events are not played
      lastSeen = latest;
      initialized = true;
      return;
    }

    if (lastSeen === latest) {
      return;
    }

    const newEntries = findNewEntries(feed, lastSeen);
    if (newEntries.length === 0) return;

    lastSeen = latest;

    for (const entry of newEntries) {
      // 1. Audio sound effect
      const sound = soundFor(entry);
      if (sound && isAudioEnabled()) {
        if (sound === 'levelUp') playLevelUp();
        else if (sound === 'doorbell') playDoorbell();
        else if (sound === 'buzzer') playBuzzer();
      }

      // 2. Browser notification
      const notif = notificationFor(entry, liveStore.state);
      if (notif) {
        showNotification(notif.title, { body: notif.body });
      }
    }
  });
</script>
