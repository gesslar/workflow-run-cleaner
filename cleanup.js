#!/usr/bin/env node

const core = require('@actions/core');
const github = require('@actions/github');
const axios = require('axios');

// Main function
(async () => {
  const result = {
    repos: 0,
    ignoredRepos: 0,
    wfRuns: 0,
    errors: 0
  };

  try {
    // Extracting inputs using core
    const TOKEN = core.getInput('token', { required: true });
    const REPO_OWNER = core.getInput('repo_owner', { required: true });
    const TARGET_CLEANUP_REPOS = core.getInput('target_cleanup_repos');
    const TARGET_IGNORE_REPOS = core.getInput('target_ignore_repos');
    const DAYS_THRESHOLD = core.getInput('days_threshold') || '7';
    const NOTIFICATION_WEBHOOK_URL = core.getInput('notification_webhook_url');

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - parseInt(DAYS_THRESHOLD));
    const errorOccurred = false;

    // GitHub API client setup
    const octokit = github.getOctokit(TOKEN);

    let reposArray = [];
    let ignoreReposArray = [];

    // Parse ignore repos
    if (TARGET_IGNORE_REPOS) {
      core.info('Using repositories to ignore from TARGET_IGNORE_REPOS input.');
      ignoreReposArray = TARGET_IGNORE_REPOS.split(',').map(repo => repo.trim());
    }

    // Parse target cleanup repos
    if (TARGET_CLEANUP_REPOS) {
      core.info('Using specified repositories from TARGET_CLEANUP_REPOS input.');
      reposArray = TARGET_CLEANUP_REPOS.split(',').map(repo => repo.trim());
    } else {
      core.info('No TARGET_CLEANUP_REPOS specified. Fetching all repositories except those in TARGET_IGNORE_REPOS.');

      // Fetch all repositories owned by REPO_OWNER
      let page = 1;
      while (true) {
        const response = await octokit.rest.repos.listForUser({
          username: REPO_OWNER,
          per_page: 100,
          page: page
        });

        const repos = response.data.map(repo => repo.full_name);
        if (repos.length === 0) {
          core.info('No more repositories found.');
          break;
        }

        for (const repo of repos) {
          if (ignoreReposArray.includes(repo)) {
            result.ignoredRepos += 1;
            core.info(`Skipping repository (ignored): ${repo}`);
          } else {
            result.repos += 1;
            reposArray.push(repo);
          }
        }

        page += 1;
      }
    }

    // Validate repository names
    for (const repo of reposArray) {
      if (!/^[^/]+\/[^/]+$/.test(repo)) {
        core.setFailed(`Invalid repository format: ${repo}. Expected format 'owner/repo'.`);
        return;
      }
    }

    if (reposArray.length === 0) {
      core.info('No repositories to process after applying filters.');
      return;
    }

    // Loop through repositories
    for (const repo of reposArray) {
      core.info(`Processing repository: ${repo}`);

      let runPage = 1;
      while (true) {
        try {
          const runsResponse = await octokit.rest.actions.listWorkflowRunsForRepo({
            owner: repo.split('/')[0],
            repo: repo.split('/')[1],
            per_page: 100,
            page: runPage
          });

          const runs = runsResponse.data.workflow_runs.filter(run => {
            return new Date(run.created_at) < sevenDaysAgo;
          });

          if (runs.length === 0) {
            core.info(`No more runs to process in repository: ${repo}.`);
            break;
          }

          for (const run of runs) {
            const runId = run.id;
            core.info(`Deleting workflow run ${runId} in repository ${repo}`);

            try {
              await octokit.rest.actions.deleteWorkflowRun({
                owner: repo.split('/')[0],
                repo: repo.split('/')[1],
                run_id: runId
              });
              core.info(`Successfully deleted run ${runId}.`);
              result.wfRuns += 1;
            } catch (deleteError) {
              core.error(`Failed to delete run ${runId}. Response: ${deleteError.message}`);
              result.errors += 1;
              errorOccurred = true;
            }
          }

          runPage += 1;
        } catch (runsError) {
          core.error(`Failed to fetch runs for repository ${repo}. Response: ${runsError.message}`);
          errorOccurred = true;
          break;
        }
      }
    }

    core.info(`Cleanup completed. `
      `Processed ${repos} repositories, `
      `${result.ignoredRepos} ignored repositories, `
      `${result.wfRuns} deleted workflow runs, and `
      `${result.errors} errors occurred.`);

    // Send notification if webhook URL is provided
    if (NOTIFICATION_WEBHOOK_URL) {
      const message = errorOccurred
        ? 'Workflow cleanup encountered errors.'
        : 'Workflow cleanup completed successfully.';

      result.text = message;

      try {
        await axios.post(NOTIFICATION_WEBHOOK_URL, result, {
          headers: {
            'Content-Type': 'application/json'
          }
        });
        core.info('Notification sent.');
      } catch (notifyError) {
        core.error(`Failed to send notification: ${notifyError.message}`);
      }
    }

    if (errorOccurred) {
      core.setFailed('Some errors occurred during the workflow cleanup.');
    }

  } catch (err) {
    core.setFailed(`Action failed with error: ${err.message}`);
  }
})();
