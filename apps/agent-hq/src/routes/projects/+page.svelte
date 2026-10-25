<script lang="ts">
  import { onMount } from 'svelte';
  import { connect } from '../../lib/live.svelte';
  import TopBar from '../../lib/components/TopBar.svelte';
  import ProjectsView from '../../lib/components/projects/ProjectsView.svelte';

  onMount(() => {
    return connect();
  });
</script>

<svelte:head>
  <title>Agent-HQ • Projektansicht</title>
</svelte:head>

<div class="flex min-h-screen w-full flex-col bg-slate-950 text-slate-100 font-sans">
  <TopBar />
  <ProjectsView />
</div>
