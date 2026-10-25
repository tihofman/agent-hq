<script lang="ts">
  import { onMount } from 'svelte';
  import { connect } from '../../lib/live.svelte';
  import ProjectsView from '../../lib/components/projects/ProjectsView.svelte';

  onMount(() => {
    return connect();
  });
</script>

<svelte:head>
  <title>Agent-HQ • Projektansicht</title>
</svelte:head>

<ProjectsView />
