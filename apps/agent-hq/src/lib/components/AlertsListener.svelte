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
  import { detectPendingInput } from '../feed';
  import type { HQEvent, InternalAction } from '@agent-hq/queue/types';

  let lastSeen: (HQEvent | InternalAction) | null = null;
  let initialized = false;
  let lastNotifiedPendingKey: string | null = null;
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;

  function evaluatePendingInput() {
    clearTimeout(pendingTimer);
    const result = detectPendingInput(
      liveStore.feed,
      liveStore.state.runs,
      Date.now(),
    );

    if (result.isPending && result.runId && result.timestamp) {
      const key = `${result.runId}:${result.timestamp}`;
      if (key !== lastNotifiedPendingKey) {
        lastNotifiedPendingKey = key;
        showNotification('Agent wartet auf Eingabe', {
          body:
            result.promptText ||
            'Bestätigung oder Eingabe im Terminal erforderlich.',
        });
      }
    } else if (
      !result.isPending &&
      result.remainingMs !== undefined &&
      result.remainingMs > 0
    ) {
      pendingTimer = setTimeout(() => {
        evaluatePendingInput();
      }, result.remainingMs + 50);
    }
  }

  $effect(() => {
    const feed = liveStore.feed;
    const len = feed.length;
    const latest = len > 0 ? feed[len - 1] : null;

    // Reactivity tracking for feed and runs (matching PendingInputCard.svelte)
    void len;
    void Object.keys(liveStore.state.runs).length;
    if (latest && 'data' in latest) {
      void latest.data?.logChunk;
    }

    // After INIT_STATE, feed is reset to empty []
    if (len === 0) {
      lastSeen = null;
      lastNotifiedPendingKey = null;
      clearTimeout(pendingTimer);
      initialized = true;
      return () => {
        clearTimeout(pendingTimer);
      };
    }

    if (!initialized) {
      // First run / reload: mark current end of feed as seen so old events are not played
      lastSeen = latest;
      const initialPending = detectPendingInput(
        liveStore.feed,
        liveStore.state.runs,
        Date.now(),
      );
      if (
        initialPending.isPending &&
        initialPending.runId &&
        initialPending.timestamp
      ) {
        lastNotifiedPendingKey = `${initialPending.runId}:${initialPending.timestamp}`;
      } else if (
        !initialPending.isPending &&
        initialPending.remainingMs !== undefined &&
        initialPending.remainingMs > 0
      ) {
        pendingTimer = setTimeout(() => {
          evaluatePendingInput();
        }, initialPending.remainingMs + 50);
      }
      initialized = true;
      return () => {
        clearTimeout(pendingTimer);
      };
    }

    evaluatePendingInput();

    if (lastSeen === latest) {
      return () => {
        clearTimeout(pendingTimer);
      };
    }

    const newEntries = findNewEntries(feed, lastSeen);
    lastSeen = latest;
    if (newEntries.length === 0) {
      return () => {
        clearTimeout(pendingTimer);
      };
    }

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

    return () => {
      clearTimeout(pendingTimer);
    };
  });
</script>
